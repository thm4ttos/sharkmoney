import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  auditLedger, auditUpdateTransaction, auditDeleteTransaction, listAuditCorrections,
} from "@/lib/audit.functions";
import { formatBRL } from "@/lib/user-mock";
import { AuditDetails } from "@/components/brinzap/transactions/AuditDetails";
import { PeriodFilter, type PeriodValue } from "@/components/brinzap/dashboard/PeriodFilter";
import { AUDIT_RANGE_OPTIONS, resolveAuditPeriod } from "@/lib/period-range";
import {
  ShieldCheck, Loader2, AlertTriangle, Download, Search, X, RefreshCw, Copy, CheckCircle2,
  Pencil, Trash2, ExternalLink, History, Columns2,
} from "lucide-react";

export const Route = createFileRoute("/app/auditoria")({
  head: () => ({
    meta: [
      { title: "Auditoria financeira — Abio" },
      { name: "description", content: "Relação auditável das transações que compõem o seu saldo no abio: período, origem, vínculos, duplicidades e correções." },
      { property: "og:title", content: "Auditoria financeira — Abio" },
      { property: "og:description", content: "Veja, filtre por período e corrija exatamente os lançamentos que formam o seu saldo." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuditPage,
});

const PERIOD_KEY = "abio:auditoria:period";

type EditState = {
  id: string;
  kind: "income" | "expense";
  amount: string;
  category: string;
  description: string;
  occurred_at: string; // yyyy-MM-ddTHH:mm
  reason: string;
  hasBillPayment: boolean;
  linkedInstallment: string | null;
};

function toLocalInput(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function AuditPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const run = useServerFn(auditLedger);
  const runUpdate = useServerFn(auditUpdateTransaction);
  const runDelete = useServerFn(auditDeleteTransaction);
  const runCorrections = useServerFn(listAuditCorrections);

  const [period, setPeriod] = useState<PeriodValue>(() => {
    if (typeof window === "undefined") return { range: "all" };
    try {
      const raw = window.localStorage.getItem(PERIOD_KEY);
      if (raw) {
        const p = JSON.parse(raw) as PeriodValue;
        if (p?.range) return p;
      }
    } catch { /* noop */ }
    return { range: "all" };
  });
  function changePeriod(v: PeriodValue) {
    setPeriod(v);
    try { window.localStorage.setItem(PERIOD_KEY, JSON.stringify(v)); } catch { /* noop */ }
  }

  const resolved = useMemo(
    () => resolveAuditPeriod(period.range, period.start, period.end),
    [period],
  );

  const [tab, setTab] = useState<"rows" | "history">("rows");
  const [q, setQ] = useState("");
  const [originFilter, setOriginFilter] = useState("all");
  const [onlySuspect, setOnlySuspect] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [del, setDel] = useState<{ id: string; description: string; amount: number; hasBillPayment: boolean; linkedInstallment: string | null; mode: string; reason: string } | null>(null);
  const [compare, setCompare] = useState<string[] | null>(null);

  const { data, isLoading, isFetching, refetch } = useQuery<any>({
    queryKey: ["audit-ledger", resolved.from, resolved.to],
    queryFn: () => run({ data: { from: resolved.from ?? undefined, to: resolved.to ?? undefined } }) as any,
    staleTime: 30_000,
  });

  const corrections = useQuery<any[]>({
    queryKey: ["audit-corrections"],
    queryFn: () => runCorrections({ data: {} }) as any,
    enabled: tab === "history",
    staleTime: 15_000,
  });

  function afterMutation(msg: string) {
    toast.success(msg);
    queryClient.invalidateQueries({ queryKey: ["audit-ledger"] });
    queryClient.invalidateQueries({ queryKey: ["audit-corrections"] });
    queryClient.invalidateQueries({ queryKey: ["tx-origin"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    queryClient.invalidateQueries({ queryKey: ["transactions"] });
    queryClient.invalidateQueries({ queryKey: ["bills"] });
    queryClient.invalidateQueries({ queryKey: ["installments"] });
    queryClient.invalidateQueries({ queryKey: ["balance"] });
  }

  const updateMut = useMutation({
    mutationFn: (v: EditState) =>
      runUpdate({
        data: {
          id: v.id,
          kind: v.kind,
          amount: Number(v.amount.replace(/\./g, "").replace(",", ".")),
          category: v.category,
          description: v.description || undefined,
          occurred_at: new Date(v.occurred_at).toISOString(),
          reason: v.reason || undefined,
        },
      }) as any,
    onSuccess: () => { setEdit(null); setDetailId(null); afterMutation("Lançamento atualizado — saldo, painel e WhatsApp já refletem a correção."); },
    onError: (e: any) => toast.error(e?.message ?? "Não foi possível atualizar o lançamento."),
  });

  const deleteMut = useMutation({
    mutationFn: (v: { id: string; mode: string; reason: string }) =>
      runDelete({ data: { id: v.id, mode: v.mode as any, reason: v.reason || undefined } }) as any,
    onSuccess: () => { setDel(null); setDetailId(null); afterMutation("Lançamento excluído com registro no histórico de correções."); },
    onError: (e: any) => toast.error(e?.message ?? "Não foi possível excluir o lançamento."),
  });

  const rowById = useMemo(() => {
    const m = new Map<string, any>();
    for (const r of (data?.rows ?? []) as any[]) m.set(r.id, r);
    return m;
  }, [data]);

  const rows = useMemo(() => {
    const list: any[] = data?.rows ?? [];
    const term = q.trim().toLowerCase();
    return list.filter((r) => {
      if (originFilter !== "all" && r.originKey !== originFilter) return false;
      if (onlySuspect && !r.duplicateOf.length && r.status === "confirmado") return false;
      if (!term) return true;
      return (
        r.description.toLowerCase().includes(term) ||
        r.category.toLowerCase().includes(term) ||
        r.id.toLowerCase().includes(term) ||
        String(r.amount).includes(term)
      );
    });
  }, [data, q, originFilter, onlySuspect]);

  function openEdit(id: string) {
    const r = rowById.get(id);
    if (!r) return;
    setEdit({
      id: r.id,
      kind: r.kind,
      amount: String(r.amount).replace(".", ","),
      category: r.category,
      description: r.description === "(sem descrição)" ? "" : r.description,
      occurred_at: toLocalInput(r.occurredAtIso),
      reason: "",
      hasBillPayment: !!r.hasBillPayment,
      linkedInstallment: r.linkedInstallment ?? null,
    });
  }

  function openDelete(id: string) {
    const r = rowById.get(id);
    if (!r) return;
    setDel({
      id: r.id,
      description: r.description,
      amount: r.amount,
      hasBillPayment: !!r.hasBillPayment,
      linkedInstallment: r.linkedInstallment ?? null,
      mode: r.hasBillPayment ? "reopen_bill" : "plain",
      reason: "",
    });
  }

  function exportCsv() {
    const list: any[] = rows;
    const head = ["id", "data", "hora", "tipo", "valor", "categoria", "descricao", "origem", "canal", "conta_fixa", "parcela", "comprovante", "status", "duplicado_de"];
    const lines = [head.join(";")];
    for (const r of list) {
      lines.push([
        r.id, r.date, r.time, r.kind === "income" ? "receita" : "despesa",
        String(r.amount).replace(".", ","), r.category, (r.description ?? "").replace(/[;\n]/g, " "),
        r.originLabel, r.channel, r.linkedBill ?? "", r.linkedInstallment ?? "", r.receipt ?? "",
        r.status, r.duplicateOf.join(" "),
      ].join(";"));
    }
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `auditoria-abio-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const t = data?.totals;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-primary" /> Auditoria financeira
          </h1>
          <p className="text-xs text-muted-foreground mt-1 max-w-2xl">
            Montada exclusivamente a partir da tabela oficial de transações. Período:{" "}
            <b className="text-foreground">{resolved.rangeLabel}</b> · {resolved.label}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <PeriodFilter value={period} onChange={changePeriod} options={AUDIT_RANGE_OPTIONS} compact />
          <button onClick={() => refetch()} disabled={isFetching}
            className="rounded-xl border border-border bg-background/40 px-3 py-2 text-xs inline-flex items-center gap-2 hover:border-primary/50 disabled:opacity-60">
            {isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Recalcular
          </button>
          <button onClick={exportCsv} disabled={!data}
            className="rounded-xl border border-border bg-background/40 px-3 py-2 text-xs inline-flex items-center gap-2 hover:border-primary/50 disabled:opacity-60">
            <Download className="h-3.5 w-3.5" /> Exportar CSV
          </button>
        </div>
      </div>

      <div className="flex gap-2">
        <TabBtn active={tab === "rows"} onClick={() => setTab("rows")} icon={<ShieldCheck className="h-3.5 w-3.5" />}>Lançamentos auditados</TabBtn>
        <TabBtn active={tab === "history"} onClick={() => setTab("history")} icon={<History className="h-3.5 w-3.5" />}>Histórico de correções</TabBtn>
      </div>

      {tab === "history" && (
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          {corrections.isLoading && (
            <div className="p-10 grid place-items-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
          )}
          <div className="divide-y divide-border">
            {(corrections.data ?? []).map((c) => (
              <div key={c.id} className="p-4 text-xs space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-md px-1.5 py-0.5 text-[10px] border ${c.action.startsWith("delete") ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-primary/40 bg-primary/10 text-primary"}`}>
                    {c.actionLabel}
                  </span>
                  <span className="text-muted-foreground">{c.at} · {c.origin}</span>
                </div>
                <p>
                  {c.descriptionBefore ?? "(sem descrição)"}
                  {c.descriptionAfter && c.descriptionAfter !== c.descriptionBefore ? ` → ${c.descriptionAfter}` : ""}
                  {" · "}
                  <b>{c.amountBefore !== null ? formatBRL(c.amountBefore) : "—"}</b>
                  {c.amountAfter !== null && c.amountAfter !== c.amountBefore ? ` → ${formatBRL(c.amountAfter)}` : ""}
                  {c.categoryAfter && c.categoryAfter !== c.categoryBefore ? ` · categoria: ${c.categoryBefore} → ${c.categoryAfter}` : ""}
                </p>
                {c.reason && <p className="text-muted-foreground">Motivo: {c.reason}</p>}
                <p className="text-[10px] font-mono text-muted-foreground">{c.transactionId}</p>
              </div>
            ))}
            {!corrections.isLoading && !(corrections.data ?? []).length && (
              <div className="p-10 text-center text-xs text-muted-foreground">Nenhuma correção registrada até agora.</div>
            )}
          </div>
        </div>
      )}

      {tab === "rows" && isLoading && (
        <div className="rounded-2xl border border-border bg-card p-10 grid place-items-center text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
          <p className="text-xs mt-3">Reconciliando seus lançamentos…</p>
        </div>
      )}

      {tab === "rows" && t && (
        <>
          {/* Totais */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi label="Receitas do período" value={formatBRL(t.income)} tone="income" sub={`${t.count} lançamentos no período`} />
            <Kpi label="Despesas do período" value={formatBRL(t.expense)} tone="expense" />
            <Kpi label="Saldo do período" value={formatBRL(t.periodBalance)} tone={t.periodBalance < 0 ? "expense" : "income"} sub="entradas − saídas do intervalo" />
            <Kpi label="Saldo atual geral" value={formatBRL(t.currentBalance)} tone={t.currentBalance < 0 ? "expense" : "income"} sub={`${t.currentCount} lançamentos no histórico completo`} />
          </div>

          <div className={`rounded-2xl border p-4 flex items-start gap-3 ${t.difference === 0 ? "border-emerald-500/30 bg-emerald-500/5" : "border-destructive/40 bg-destructive/5"}`}>
            {t.difference === 0
              ? <CheckCircle2 className="h-5 w-5 text-emerald-400 mt-0.5 shrink-0" />
              : <AlertTriangle className="h-5 w-5 text-destructive mt-0.5 shrink-0" />}
            <div className="text-xs space-y-1">
              <p className="font-medium text-sm">
                {t.difference === 0
                  ? "Painel, WhatsApp e transações reais batem exatamente neste período."
                  : "Divergência detectada entre o saldo oficial e a soma das transações."}
              </p>
              <p className="text-muted-foreground">
                Função oficial (período): <b className="text-foreground">{formatBRL(t.ledgerBalance)}</b> ·
                Soma linha a linha: <b className="text-foreground">{formatBRL(t.periodBalance)}</b> ·
                Diferença: <b className="text-foreground">{formatBRL(t.difference)}</b> ·
                Saldo inicial: <b className="text-foreground">{formatBRL(t.openingBalance)}</b> ·
                Transações: <b className="text-foreground">{t.ledgerCount}</b> / {t.count}
              </p>
              {t.duplicateGroups > 0 && (
                <p className="text-amber-300">
                  {t.duplicateGroups} grupo(s) de possível duplicidade, somando <b>{formatBRL(t.duplicateAmount)}</b> em valor excedente — compare antes de decidir.
                </p>
              )}
            </div>
          </div>

          {/* Duplicidades */}
          {data.duplicateGroups.length > 0 && (
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5 space-y-2">
              <h2 className="font-display text-base text-amber-300">Possíveis duplicidades</h2>
              {data.duplicateGroups.map((g: any) => (
                <div key={g.ids.join("-")} className="flex flex-wrap items-center justify-between gap-2 text-xs rounded-xl border border-border bg-background/30 px-3 py-2">
                  <span className="truncate">
                    {g.description || "(sem descrição)"} · <b>{formatBRL(g.amount)}</b> · {g.ids.length} lançamentos · excedente {formatBRL(g.total)}
                  </span>
                  <button onClick={() => setCompare(g.ids)}
                    className="rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-200 px-2 py-1 inline-flex items-center gap-1.5">
                    <Columns2 className="h-3.5 w-3.5" /> Comparar lado a lado
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Contas fixas */}
          <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
            <h2 className="font-display text-base">Investigação — Contas Fixas</h2>
            <div className="grid sm:grid-cols-3 gap-3 text-xs">
              <Mini label="Despesas geradas por contas fixas" value={`${data.billFindings.recurringTransactions} · ${formatBRL(data.billFindings.recurringTotal)}`} />
              <Mini label="Pagamentos oficialmente registrados" value={`${data.billFindings.registeredPayments} · ${formatBRL(data.billFindings.registeredPaymentsTotal)}`} />
              <Mini label="Contas pendentes/futuras no saldo" value="R$ 0,00 (nunca entram)" />
            </div>
            {data.billFindings.orphanRecurring.length > 0 && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
                <p className="text-xs font-medium text-amber-300 flex items-center gap-2">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {data.billFindings.orphanRecurring.length} despesa(s) de conta fixa sem pagamento correspondente registrado
                </p>
                <ul className="mt-2 space-y-1">
                  {data.billFindings.orphanRecurring.map((o: any) => (
                    <li key={o.id} className="text-[11px] text-muted-foreground flex flex-wrap gap-2">
                      <button onClick={() => setDetailId(o.id)} className="text-primary underline underline-offset-2">{o.id.slice(0, 8)}…</button>
                      <span>{o.description}</span>
                      <span className="text-foreground">{formatBRL(o.amount)}</span>
                      <span>· lançada em {o.date} · registrada {o.createdAt}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {data.pendingBills.length > 0 && (
              <div className="text-[11px] text-muted-foreground">
                Contas fixas em aberto (não afetam o saldo):{" "}
                {data.pendingBills.map((b: any) => `${b.title} ${formatBRL(b.amount)}${b.nextDue ? ` (vence ${b.nextDue})` : ""}`).join(" · ")}
              </div>
            )}
          </div>

          {/* Totais por origem e categoria */}
          <div className="grid lg:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-border bg-card p-5">
              <h2 className="font-display text-base mb-3">Totais por origem</h2>
              <div className="space-y-2">
                {data.byOrigin.map((o: any) => (
                  <div key={o.key} className="flex items-center justify-between text-xs gap-2">
                    <span className="truncate">{o.label} <span className="text-muted-foreground">({o.count})</span></span>
                    <span className="shrink-0">
                      <span className="text-emerald-400">{formatBRL(o.income)}</span>
                      {" / "}
                      <span className="text-rose-400">{formatBRL(o.expense)}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-2xl border border-border bg-card p-5">
              <h2 className="font-display text-base mb-3">Totais por categoria</h2>
              <div className="space-y-2 max-h-72 overflow-auto pr-1">
                {data.byCategory.map((c: any) => (
                  <div key={c.category} className="flex items-center justify-between text-xs gap-2">
                    <span className="truncate">{c.category} <span className="text-muted-foreground">({c.count})</span></span>
                    <span className="shrink-0">
                      <span className="text-emerald-400">{formatBRL(c.income)}</span>
                      {" / "}
                      <span className="text-rose-400">{formatBRL(c.expense)}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Relação auditável */}
          <div className="rounded-2xl border border-border bg-card overflow-hidden">
            <div className="p-4 flex flex-wrap items-center gap-2 border-b border-border">
              <div className="relative flex-1 min-w-48">
                <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por ID, descrição, valor ou categoria"
                  className="w-full bg-input rounded-xl pl-9 pr-3 py-2 text-xs" />
              </div>
              <select value={originFilter} onChange={(e) => setOriginFilter(e.target.value)}
                className="bg-input rounded-xl px-3 py-2 text-xs">
                <option value="all">Todas as origens</option>
                {data.byOrigin.map((o: any) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
              <button onClick={() => setOnlySuspect((v) => !v)}
                className={`rounded-xl border px-3 py-2 text-xs ${onlySuspect ? "border-amber-500/60 bg-amber-500/10 text-amber-300" : "border-border bg-background/40"}`}>
                Só itens a revisar
              </button>
            </div>
            <div className="divide-y divide-border">
              {rows.map((r) => (
                <div key={r.id} className="p-4 flex flex-wrap items-start gap-3">
                  <div className="flex-1 min-w-52">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm truncate">{r.description}</p>
                      {r.duplicateOf.length > 0 && (
                        <span className="text-[10px] rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-300 px-1.5 py-0.5">possível duplicidade</span>
                      )}
                      {r.status !== "confirmado" && (
                        <span className="text-[10px] rounded-md border border-destructive/40 bg-destructive/10 text-destructive px-1.5 py-0.5">{r.status}</span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {r.category} · {r.date} {r.time} · {r.originLabel}
                      {r.linkedBill ? ` · ${r.linkedBill}` : ""}
                      {r.linkedInstallment ? ` · ${r.linkedInstallment}` : ""}
                      {r.receipt ? ` · ${r.receipt}` : ""}
                    </p>
                    <div className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1">
                      <span className="font-mono">{r.id}</span>
                      <button onClick={() => navigator.clipboard?.writeText(r.id)} title="Copiar ID"
                        className="h-5 w-5 grid place-items-center rounded hover:bg-background/60"><Copy className="h-3 w-3" /></button>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className={`text-sm font-semibold whitespace-nowrap ${r.kind === "income" ? "text-emerald-400" : "text-rose-400"}`}>
                      {r.kind === "income" ? "+" : "-"} {formatBRL(r.amount)}
                    </span>
                    <div className="flex items-center gap-1">
                      <button onClick={() => openEdit(r.id)} title="Editar"
                        className="h-7 w-7 grid place-items-center rounded-lg border border-border bg-background/40 hover:border-primary/50 hover:text-primary">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => openDelete(r.id)} title="Excluir"
                        className="h-7 w-7 grid place-items-center rounded-lg border border-border bg-background/40 hover:border-destructive/60 hover:text-destructive">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => setDetailId(r.id)}
                        className="text-[11px] rounded-lg border border-border bg-background/40 px-2 py-1 hover:border-primary/50 hover:text-primary">
                        Ver auditoria
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {!rows.length && <div className="p-10 text-center text-xs text-muted-foreground">Nenhum lançamento neste período/filtro.</div>}
            </div>
            <div className="px-4 py-3 border-t border-border bg-background/20 text-[11px] text-muted-foreground">
              Exibindo {rows.length.toLocaleString("pt-BR")} de {t.count.toLocaleString("pt-BR")} lançamentos auditados no período.
              Regra absoluta: todo valor que compõe o saldo existe aqui com ID e origem.
            </div>
          </div>
        </>
      )}

      {/* Modal de auditoria do lançamento */}
      {detailId && (
        <Modal title="Auditoria do lançamento" onClose={() => setDetailId(null)}>
          <AuditDetails
            id={detailId}
            actions={() => (
              <div className="grid grid-cols-2 gap-2">
                <ActionBtn onClick={() => openEdit(detailId)} icon={<Pencil className="h-3.5 w-3.5" />}>Editar</ActionBtn>
                <ActionBtn onClick={() => openDelete(detailId)} tone="danger" icon={<Trash2 className="h-3.5 w-3.5" />}>Excluir</ActionBtn>
                <ActionBtn
                  onClick={() => {
                    const r = rowById.get(detailId);
                    if (!r) return;
                    setEdit({
                      id: r.id,
                      kind: r.kind === "income" ? "expense" : "income",
                      amount: String(r.amount).replace(".", ","),
                      category: r.category,
                      description: r.description === "(sem descrição)" ? "" : r.description,
                      occurred_at: toLocalInput(r.occurredAtIso),
                      reason: "Estorno: inversão do tipo do lançamento",
                      hasBillPayment: !!r.hasBillPayment,
                      linkedInstallment: r.linkedInstallment ?? null,
                    });
                  }}
                  icon={<RefreshCw className="h-3.5 w-3.5" />}
                >
                  Estornar
                </ActionBtn>
                <ActionBtn onClick={() => navigate({ to: "/app/transacoes" })} icon={<ExternalLink className="h-3.5 w-3.5" />}>
                  Abrir em Transações
                </ActionBtn>
              </div>
            )}
          />
        </Modal>
      )}

      {/* Edição */}
      {edit && (
        <Modal title="Editar lançamento oficial" onClose={() => setEdit(null)}>
          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Tipo">
                <select value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value as any })}
                  className="w-full bg-input rounded-xl px-3 py-2">
                  <option value="expense">Despesa</option>
                  <option value="income">Receita</option>
                </select>
              </Field>
              <Field label="Valor (R$)">
                <input value={edit.amount} onChange={(e) => setEdit({ ...edit, amount: e.target.value })}
                  inputMode="decimal" className="w-full bg-input rounded-xl px-3 py-2" />
              </Field>
            </div>
            <Field label="Categoria">
              <input value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value })}
                maxLength={60} className="w-full bg-input rounded-xl px-3 py-2" />
            </Field>
            <Field label="Descrição">
              <input value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })}
                maxLength={280} className="w-full bg-input rounded-xl px-3 py-2" />
            </Field>
            <Field label="Data e hora do lançamento">
              <input type="datetime-local" value={edit.occurred_at}
                onChange={(e) => setEdit({ ...edit, occurred_at: e.target.value })}
                className="w-full bg-input rounded-xl px-3 py-2" />
            </Field>
            <Field label="Observação da correção (fica no histórico)">
              <input value={edit.reason} onChange={(e) => setEdit({ ...edit, reason: e.target.value })}
                maxLength={280} placeholder="Ex.: valor digitado errado no comprovante"
                className="w-full bg-input rounded-xl px-3 py-2" />
            </Field>
            {edit.hasBillPayment && (
              <p className="rounded-xl border border-primary/30 bg-primary/5 px-3 py-2">
                Este lançamento é o pagamento de uma conta fixa. O valor pago e o status da conta serão ajustados junto.
              </p>
            )}
            {edit.linkedInstallment && (
              <p className="rounded-xl border border-primary/30 bg-primary/5 px-3 py-2">
                Vinculado a compra parcelada: {edit.linkedInstallment}. Para devolver a parcela para pendente, use a exclusão.
              </p>
            )}
            <div className="flex gap-2 pt-1">
              <button onClick={() => setEdit(null)} className="flex-1 rounded-xl border border-border bg-background/40 px-3 py-2">Cancelar</button>
              <button
                disabled={updateMut.isPending || !Number(edit.amount.replace(/\./g, "").replace(",", "."))}
                onClick={() => updateMut.mutate(edit)}
                className="flex-1 rounded-xl bg-primary text-primary-foreground px-3 py-2 inline-flex items-center justify-center gap-2 disabled:opacity-60">
                {updateMut.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Salvar correção
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Exclusão */}
      {del && (
        <Modal title="Excluir lançamento" onClose={() => setDel(null)}>
          <div className="space-y-3 text-xs">
            <p className="rounded-xl border border-destructive/40 bg-destructive/5 px-3 py-2">
              Confirmação obrigatória: <b>{del.description}</b> · {formatBRL(del.amount)}. O saldo será recalculado
              e a exclusão ficará registrada no histórico de correções.
            </p>
            {del.hasBillPayment && (
              <Field label="Vínculo com conta fixa">
                <select value={del.mode} onChange={(e) => setDel({ ...del, mode: e.target.value })}
                  className="w-full bg-input rounded-xl px-3 py-2">
                  <option value="reopen_bill">Excluir e reabrir o pagamento (conta volta a pendente)</option>
                  <option value="transaction_only">Excluir só a transação (mantém o registro do pagamento)</option>
                </select>
              </Field>
            )}
            {del.linkedInstallment && (
              <p className="rounded-xl border border-primary/30 bg-primary/5 px-3 py-2">
                A parcela de <b>{del.linkedInstallment}</b> voltará a ficar pendente.
              </p>
            )}
            <Field label="Motivo (opcional)">
              <input value={del.reason} onChange={(e) => setDel({ ...del, reason: e.target.value })}
                maxLength={280} className="w-full bg-input rounded-xl px-3 py-2" />
            </Field>
            <div className="flex gap-2 pt-1">
              <button onClick={() => setDel(null)} className="flex-1 rounded-xl border border-border bg-background/40 px-3 py-2">Cancelar</button>
              <button disabled={deleteMut.isPending}
                onClick={() => deleteMut.mutate({ id: del.id, mode: del.mode, reason: del.reason })}
                className="flex-1 rounded-xl bg-destructive text-destructive-foreground px-3 py-2 inline-flex items-center justify-center gap-2 disabled:opacity-60">
                {deleteMut.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Excluir definitivamente
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Comparação de duplicidades */}
      {compare && (
        <Modal title="Comparar possíveis duplicados" onClose={() => setCompare(null)} wide>
          <div className="grid sm:grid-cols-2 gap-3">
            {compare.map((id) => {
              const r = rowById.get(id);
              if (!r) return null;
              return (
                <div key={id} className="rounded-xl border border-border bg-background/30 p-3 text-xs space-y-1">
                  <p className="text-sm">{r.description}</p>
                  <p className={r.kind === "income" ? "text-emerald-400" : "text-rose-400"}>
                    {r.kind === "income" ? "+" : "-"} {formatBRL(r.amount)}
                  </p>
                  <p className="text-muted-foreground">{r.category} · {r.date} {r.time}</p>
                  <p className="text-muted-foreground">{r.originLabel} · {r.channel}</p>
                  <p className="text-muted-foreground">Registrado {r.createdAt}</p>
                  <p className="text-[10px] font-mono text-muted-foreground break-all">{id}</p>
                  <div className="flex gap-2 pt-1">
                    <button onClick={() => { setCompare(null); openEdit(id); }}
                      className="flex-1 rounded-lg border border-border px-2 py-1.5 hover:border-primary/50 hover:text-primary">Manter e editar</button>
                    <button onClick={() => { setCompare(null); openDelete(id); }}
                      className="flex-1 rounded-lg border border-destructive/40 text-destructive px-2 py-1.5">Excluir este</button>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-muted-foreground mt-3">
            Nada é removido automaticamente: compare os dois lados e decida qual lançamento deve permanecer.
          </p>
        </Modal>
      )}
    </div>
  );
}

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className={`w-full ${wide ? "max-w-2xl" : "max-w-lg"} rounded-2xl border border-border bg-card p-5 shadow-card max-h-[85vh] overflow-auto`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-lg">{title}</h2>
          <button onClick={onClose} className="h-8 w-8 grid place-items-center rounded-lg hover:bg-background/60"><X className="h-4 w-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ActionBtn({ children, onClick, icon, tone }: { children: React.ReactNode; onClick: () => void; icon?: React.ReactNode; tone?: "danger" }) {
  return (
    <button onClick={onClick}
      className={`rounded-xl border px-3 py-2 text-xs inline-flex items-center justify-center gap-2 ${tone === "danger" ? "border-destructive/40 text-destructive hover:bg-destructive/10" : "border-border bg-background/40 hover:border-primary/50 hover:text-primary"}`}>
      {icon} {children}
    </button>
  );
}

function TabBtn({ children, active, onClick, icon }: { children: React.ReactNode; active: boolean; onClick: () => void; icon?: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`rounded-xl border px-3 py-2 text-xs inline-flex items-center gap-2 ${active ? "border-primary/50 bg-primary/10 text-primary" : "border-border bg-background/40"}`}>
      {icon} {children}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "income" | "expense" }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 isolate">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`font-display text-xl mt-1 ${tone === "income" ? "text-emerald-400" : tone === "expense" ? "text-rose-400" : ""}`}>{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-1">{sub}</p>}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-background/30 p-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-sm mt-0.5">{value}</p>
    </div>
  );
}
