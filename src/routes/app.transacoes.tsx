import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { formatBRL, groupOf, categoryGroups } from "@/lib/user-mock";
import { listTransactions, deleteTransaction, updateTransaction } from "@/lib/brinzap.functions";
import { resetUserHistory } from "@/lib/user-extras.functions";
import { getCoupleStatus, setItemVisibility } from "@/lib/couple.functions";
import { formatDateSP, toDateInputSP, dateInputSPToIso } from "@/lib/datetime";
import { Search, MessageCircle, Loader2, Pencil, Trash2, X, AlertTriangle, Calendar as CalendarIcon, ChevronLeft, ChevronRight, ShieldCheck, Heart } from "lucide-react";
import { AuditDetails } from "@/components/brinzap/transactions/AuditDetails";


export const Route = createFileRoute("/app/transacoes")({
  validateSearch: (s: Record<string, unknown>) => ({
    kind: (s.kind === "income" || s.kind === "expense" ? s.kind : undefined) as "income" | "expense" | undefined,
  }),
  component: TxPage,
});

const CATEGORIES = [
  "Moradia", "Alimentação", "Transporte", "Saúde", "Educação",
  "Lazer", "Pessoal", "Investimentos", "Vida Espiritual",
  "Empresa e Autônomo", "Outros", "Receita",
];

const PAGE_SIZES = [10, 20, 50, 100, 250];

function TxPage() {
  const qc = useQueryClient();
  const search = Route.useSearch();
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [filterGroup, setFilterGroup] = useState<string>("all");
  const [filterKind, setFilterKind] = useState<"all" | "income" | "expense">(search.kind ?? "all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [auditId, setAuditId] = useState<string | null>(null);

  const fetchTransactions = useServerFn(listTransactions);
  const removeFn = useServerFn(deleteTransaction);
  const updateFn = useServerFn(updateTransaction);
  const resetFn = useServerFn(resetUserHistory);
  const coupleStatusFn = useServerFn(getCoupleStatus);
  const shareFn = useServerFn(setItemVisibility);

  // Debounce search input
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);

  // Reset to page 1 when filters change
  useEffect(() => { setPage(1); }, [debouncedQ, filterGroup, filterKind, pageSize]);

  const categoriesForGroup = useMemo(() => {
    if (filterGroup === "all") return undefined;
    const g = categoryGroups.find(gg => gg.key === filterGroup);
    if (!g) return undefined;
    // Map group.categories (subcategories) → registered top-level categories in DB.
    // Nossa base grava a categoria como o nome do grupo (Moradia, Alimentação, etc.),
    // então filtramos por g.name; incluímos também as subcategorias para dados legados.
    return Array.from(new Set([g.name, ...g.categories]));
  }, [filterGroup]);

  const queryParams = {
    q: debouncedQ || undefined,
    kind: filterKind === "all" ? undefined : filterKind,
    categories: categoriesForGroup,
    limit: pageSize,
    offset: (page - 1) * pageSize,
    withCount: true,
  };

  const { data, isLoading, isFetching } = useQuery<{ rows: any[]; total: number }>({
    queryKey: ["transactions", queryParams],
    queryFn: () => fetchTransactions({ data: queryParams }) as any,
    placeholderData: keepPreviousData,
  });

  const transactions = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const showingFrom = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const showingTo = Math.min(page * pageSize, total);

  const [editing, setEditing] = useState<any | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetConfirm, setResetConfirm] = useState("");
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetMsg, setResetMsg] = useState<string | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["transactions"] });
    qc.invalidateQueries({ queryKey: ["home-stats"] });
    qc.refetchQueries({ type: "active" });
  };

  const removeMut = useMutation({
    mutationFn: (id: string) => removeFn({ data: { id } }) as any,
    onSuccess: () => { setDeletingId(null); invalidate(); },
  });

  const updateMut = useMutation({
    mutationFn: (payload: any) => updateFn({ data: payload }) as any,
    onSuccess: () => { setEditing(null); invalidate(); },
  });

  const { data: coupleStatus } = useQuery({ queryKey: ["couple-status"], queryFn: () => coupleStatusFn() as any });
  const hasCouplePartner = coupleStatus?.link?.status === "accepted";
  const shareMut = useMutation({
    mutationFn: (v: { id: string; visibility: "personal" | "shared" }) =>
      shareFn({ data: { table: "transactions", id: v.id, visibility: v.visibility } }) as any,
    onSuccess: invalidate,
  });

  const resetMut = useMutation({
    mutationFn: () => resetFn({ data: { confirm: "CONFIRMAR" } }) as any,
    onSuccess: () => {
      setResetOpen(false); setResetConfirm("");
      setResetMsg("✅ Todas as suas transações foram zeradas com sucesso.");
      qc.setQueryData(["transactions"], { rows: [], total: 0 });
      invalidate();
      setTimeout(() => setResetMsg(null), 5000);
    },
    onError: (e: any) => setResetError(e?.message ?? "Falha ao zerar dados."),
  });

  const list = transactions;
  const hasActiveFilters = !!debouncedQ || filterGroup !== "all" || filterKind !== "all";

  // Pagination page numbers with ellipsis
  const pageNumbers = useMemo(() => buildPageNumbers(page, totalPages), [page, totalPages]);

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      <header>
        <p className="text-xs uppercase tracking-[0.2em] text-primary">Histórico</p>
        <h1 className="font-display text-3xl mt-1">Transações</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {total.toLocaleString("pt-BR")} {total === 1 ? "transação encontrada" : "transações encontradas"}
          {total > 0 && <> · exibindo {showingFrom.toLocaleString("pt-BR")}–{showingTo.toLocaleString("pt-BR")}</>}
          {hasActiveFilters && <> (com filtros aplicados)</>}.
        </p>
      </header>

      <div className="flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar descrição ou categoria…"
            className="w-full bg-card/60 border border-border rounded-xl pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:border-primary/60" />
        </div>
        <select
          value={filterGroup}
          onChange={(e) => setFilterGroup(e.target.value)}
          className="bg-card/60 border border-border rounded-xl px-3 py-2.5 text-sm"
        >
          <option value="all">Todas categorias</option>
          {categoryGroups.map(g => <option key={g.key} value={g.key}>{g.name}</option>)}
        </select>
        <select
          value={filterKind}
          onChange={(e) => setFilterKind(e.target.value as any)}
          className="bg-card/60 border border-border rounded-xl px-3 py-2.5 text-sm"
        >
          <option value="all">Todos os tipos</option>
          <option value="income">Apenas Receitas (+)</option>
          <option value="expense">Apenas Despesas (−)</option>
        </select>
        <select
          value={pageSize}
          onChange={(e) => setPageSize(Number(e.target.value))}
          className="bg-card/60 border border-border rounded-xl px-3 py-2.5 text-sm"
          title="Registros por página"
        >
          {PAGE_SIZES.map(s => <option key={s} value={s}>{s} / página</option>)}
        </select>
      </div>

      <div className="rounded-2xl border border-border bg-card/60 backdrop-blur-xl overflow-hidden">
        <div className="hidden md:grid grid-cols-12 px-5 py-3 text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border bg-background/30">
          <div className="col-span-4">Descrição</div>
          <div className="col-span-2">Categoria</div>
          <div className="col-span-2">Data</div>
          <div className="col-span-2 text-right">Valor</div>
          <div className="col-span-2 text-right">Ações</div>
        </div>
        <div className="divide-y divide-border relative">
          {isFetching && !isLoading && (
            <div className="absolute right-4 top-3 z-10 text-xs text-muted-foreground inline-flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" /> Atualizando…
            </div>
          )}
          {isLoading && <div className="p-10 text-center text-sm text-muted-foreground inline-flex items-center justify-center gap-2 w-full"><Loader2 className="h-4 w-4 animate-spin" /> Carregando transações...</div>}
          {!isLoading && list.map(t => {
            const g = groupOf(groupKeyForCategory(t.category));
            const Icon = g.icon;
            const isIncome = t.kind === "income";
            const occurredAt = String(t.occurred_at ?? "");
            return (
              <div key={t.id} className="px-3 md:px-5 py-2.5 md:py-3.5 hover:bg-background/30 transition-smooth">
                {/* Desktop */}
                <div className="hidden md:grid md:grid-cols-12 items-center text-sm gap-3">
                  <div className="md:col-span-4 flex items-center gap-3 min-w-0">
                    <div className={`h-9 w-9 grid place-items-center rounded-xl bg-background/50 ${g.color} shrink-0`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-medium">{t.description || t.category || "Lançamento"}</p>
                      {t.source === "whatsapp" && (
                        <span className="text-[11px] text-primary flex items-center gap-1"><MessageCircle className="h-3 w-3" /> via WhatsApp</span>
                      )}
                    </div>
                  </div>
                  <div className="md:col-span-2 text-muted-foreground truncate">{t.category}</div>
                  <div className="md:col-span-2 text-muted-foreground">{formatDateSP(occurredAt)}</div>
                  <div className={`md:col-span-2 text-right font-medium ${isIncome ? "text-emerald-400" : "text-rose-400"}`}>
                    {isIncome ? "+" : "-"} {formatBRL(Number(t.amount ?? 0))}
                  </div>
                  <div className="md:col-span-2 flex md:justify-end gap-1.5">
                    {hasCouplePartner && (
                      <button
                        onClick={() => shareMut.mutate({ id: t.id, visibility: t.visibility === "shared" ? "personal" : "shared" })}
                        title={t.visibility === "shared" ? "Compartilhado — clique pra tornar privado" : "Compartilhar com o parceiro(a)"}
                        className={`h-8 w-8 grid place-items-center rounded-lg border transition-smooth ${t.visibility === "shared" ? "border-primary/50 bg-primary/10 text-primary" : "border-border bg-background/40 hover:border-primary/50 hover:text-primary"}`}>
                        <Heart className="h-3.5 w-3.5" fill={t.visibility === "shared" ? "currentColor" : "none"} />
                      </button>
                    )}
                    <button onClick={() => setEditing(t)} title="Editar"
                      className="h-8 w-8 grid place-items-center rounded-lg border border-border bg-background/40 hover:border-primary/50 hover:text-primary transition-smooth">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => setDeletingId(t.id)} title="Excluir"
                      className="h-8 w-8 grid place-items-center rounded-lg border border-border bg-background/40 hover:border-destructive/50 hover:text-destructive transition-smooth">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {/* Mobile — layout compacto */}
                <div className="md:hidden grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5">
                  <div className={`h-9 w-9 grid place-items-center rounded-xl bg-background/50 ${g.color} shrink-0`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium leading-tight">{t.description || t.category || "Lançamento"}</p>
                    <p className="text-[11px] text-muted-foreground truncate leading-tight mt-0.5">
                      {t.category ? <>{t.category} · </> : null}{formatDateSP(occurredAt)}
                      {t.source === "whatsapp" ? " · via WhatsApp" : ""}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className={`text-sm font-semibold whitespace-nowrap ${isIncome ? "text-emerald-400" : "text-rose-400"}`}>
                      {isIncome ? "+" : "-"} {formatBRL(Number(t.amount ?? 0))}
                    </span>
                    <div className="flex gap-1">
                      {hasCouplePartner && (
                        <button
                          onClick={() => shareMut.mutate({ id: t.id, visibility: t.visibility === "shared" ? "personal" : "shared" })}
                          aria-label="Compartilhar com o parceiro(a)"
                          className={`h-7 w-7 grid place-items-center rounded-md border active:scale-95 transition-smooth ${t.visibility === "shared" ? "border-primary/50 bg-primary/10 text-primary" : "border-border bg-background/40"}`}>
                          <Heart className="h-3 w-3" fill={t.visibility === "shared" ? "currentColor" : "none"} />
                        </button>
                      )}
                      <button onClick={() => setAuditId(t.id)} aria-label="Ver auditoria"
                        className="h-7 w-7 grid place-items-center rounded-md border border-border bg-background/40 active:scale-95 transition-smooth"
                        title="Ver auditoria / origem">
                        <ShieldCheck className="h-3 w-3" />
                      </button>
                      <button onClick={() => setEditing(t)} aria-label="Editar"
                        className="h-7 w-7 grid place-items-center rounded-md border border-border bg-background/40 active:scale-95 transition-smooth">
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button onClick={() => setDeletingId(t.id)} aria-label="Excluir"
                        className="h-7 w-7 grid place-items-center rounded-md border border-destructive/30 text-destructive bg-background/40 active:scale-95 transition-smooth">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>

                  </div>
                </div>
              </div>
            );
          })}
          {!isLoading && !list.length && <div className="p-10 text-center text-sm text-muted-foreground">{hasActiveFilters ? "Nenhum lançamento encontrado para este filtro." : "Nenhum lançamento."}</div>}
        </div>

        {/* Pagination */}
        {total > 0 && (
          <div className="flex flex-col md:flex-row items-center justify-between gap-3 px-5 py-3 border-t border-border bg-background/20 text-xs text-muted-foreground">
            <div>
              Exibindo <b className="text-foreground">{showingFrom.toLocaleString("pt-BR")}</b>–<b className="text-foreground">{showingTo.toLocaleString("pt-BR")}</b> de <b className="text-foreground">{total.toLocaleString("pt-BR")}</b> transações
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="h-8 px-2 grid place-items-center rounded-lg border border-border bg-background/40 hover:border-primary/50 hover:text-primary transition-smooth disabled:opacity-40 disabled:hover:border-border disabled:hover:text-muted-foreground"
                title="Página anterior"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              {pageNumbers.map((n, i) => n === "…" ? (
                <span key={`e-${i}`} className="px-2">…</span>
              ) : (
                <button
                  key={n}
                  onClick={() => setPage(n as number)}
                  className={`h-8 min-w-8 px-2 rounded-lg border text-xs transition-smooth ${n === page ? "border-primary/60 bg-primary/10 text-primary" : "border-border bg-background/40 hover:border-primary/50 hover:text-primary"}`}
                >
                  {n}
                </button>
              ))}
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="h-8 px-2 grid place-items-center rounded-lg border border-border bg-background/40 hover:border-primary/50 hover:text-primary transition-smooth disabled:opacity-40 disabled:hover:border-border disabled:hover:text-muted-foreground"
                title="Próxima página"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>


      {/* Zerar todos os dados */}
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-5">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
          <div className="flex-1">
            <h3 className="font-display text-base text-destructive">Zerar todos os dados financeiros</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Remove permanentemente todas as suas receitas e despesas. Sua conta, perfil, assinatura, WhatsApp, lembretes, metas, contas fixas, parcelados e dívidas permanecem intactos.
            </p>
          </div>
          <button
            onClick={() => { setResetOpen(true); setResetError(null); }}
            className="rounded-xl border border-destructive/40 bg-destructive/10 text-destructive px-4 py-2 text-sm hover:bg-destructive/20 inline-flex items-center gap-2 shrink-0"
          >
            <Trash2 className="h-3.5 w-3.5" /> Zerar todos os dados
          </button>
        </div>
        {resetMsg && <p className="text-xs text-emerald-300 mt-3">{resetMsg}</p>}
      </div>

      {/* Audit modal (somente leitura) */}
      {auditId && (
        <Modal onClose={() => setAuditId(null)} title="Auditoria do lançamento">
          <AuditDetails id={auditId} />
        </Modal>
      )}

      {/* Edit modal */}

      {editing && (
        <Modal onClose={() => setEditing(null)} title="Editar lançamento">
          <EditForm
            initial={editing}
            busy={updateMut.isPending}
            onCancel={() => setEditing(null)}
            onSubmit={(payload) => updateMut.mutate({ id: editing.id, ...payload })}
          />
        </Modal>
      )}

      {/* Delete confirmation */}
      {deletingId && (
        <Modal onClose={() => setDeletingId(null)} title="Excluir lançamento">
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Tem certeza que deseja excluir essa transação? Esta ação não pode ser desfeita.</p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setDeletingId(null)}
                className="rounded-xl border border-border px-4 py-2 text-sm hover:bg-background/40"
              >Cancelar</button>
              <button
                onClick={() => removeMut.mutate(deletingId)}
                disabled={removeMut.isPending}
                className="rounded-xl bg-destructive text-destructive-foreground px-4 py-2 text-sm font-medium disabled:opacity-60"
              >{removeMut.isPending ? "Excluindo…" : "Sim, excluir"}</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Reset confirmation */}
      {resetOpen && (
        <Modal onClose={() => { setResetOpen(false); setResetConfirm(""); setResetError(null); }} title="Zerar todos os dados">
          <div className="space-y-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive mt-0.5" />
              <p className="text-xs text-destructive font-medium">Todos os seus lançamentos, lembretes e histórico financeiro serão apagados permanentemente.</p>
            </div>
            <p className="text-xs">Digite <b className="text-destructive">CONFIRMAR</b> para concluir:</p>
            <input
              value={resetConfirm}
              onChange={(e) => setResetConfirm(e.target.value)}
              placeholder="CONFIRMAR"
              className="w-full bg-input rounded-xl px-3 py-2.5 text-sm"
            />
            {resetError && <p className="text-xs text-destructive">{resetError}</p>}
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => { setResetOpen(false); setResetConfirm(""); setResetError(null); }}
                className="rounded-xl border border-border px-4 py-2 text-sm hover:bg-background/40"
              >Cancelar</button>
              <button
                onClick={() => resetMut.mutate()}
                disabled={resetMut.isPending || resetConfirm.trim().toUpperCase() !== "CONFIRMAR"}
                className="rounded-xl bg-destructive text-destructive-foreground px-4 py-2 text-sm font-medium disabled:opacity-50"
              >{resetMut.isPending ? "Zerando…" : "Zerar agora"}</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/70 backdrop-blur-sm p-4 animate-fade-in" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-card" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-lg">{title}</h2>
          <button onClick={onClose} className="h-8 w-8 grid place-items-center rounded-lg hover:bg-background/60">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function EditForm({
  initial, busy, onCancel, onSubmit,
}: {
  initial: any; busy: boolean;
  onCancel: () => void;
  onSubmit: (payload: { kind: "income" | "expense"; amount: number; category: string; description?: string; occurred_at?: string }) => void;
}) {
  const [kind, setKind] = useState<"income" | "expense">(initial.kind ?? "expense");
  const [amount, setAmount] = useState(String(initial.amount ?? "0"));
  const [category, setCategory] = useState(initial.category ?? "Outros");
  const [description, setDescription] = useState(initial.description ?? "");
  const [dateStr, setDateStr] = useState(toDateInputSP(initial.occurred_at));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const num = Number(String(amount).replace(",", "."));
        if (!Number.isFinite(num) || num < 0) return;
        const occurred_at = dateStr ? dateInputSPToIso(dateStr, initial.occurred_at) : undefined;
        onSubmit({ kind, amount: num, category, description: description.trim() || undefined, occurred_at });
      }}
      className="space-y-3"
    >
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => setKind("income")}
          className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition-smooth ${kind === "income" ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-300" : "border-border bg-background/40 text-muted-foreground"}`}>
          + Receita
        </button>
        <button type="button" onClick={() => setKind("expense")}
          className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition-smooth ${kind === "expense" ? "border-rose-500/60 bg-rose-500/10 text-rose-300" : "border-border bg-background/40 text-muted-foreground"}`}>
          − Despesa
        </button>
      </div>
      <div>
        <label className="text-xs text-muted-foreground">Descrição</label>
        <input value={description} onChange={(e) => setDescription(e.target.value)}
          className="mt-1 w-full bg-input rounded-xl px-3 py-2.5 text-sm" placeholder="Ex.: Almoço, salário, conta de luz" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-muted-foreground">Valor (R$)</label>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal"
            className="mt-1 w-full bg-input rounded-xl px-3 py-2.5 text-sm" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Categoria</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)}
            className="mt-1 w-full bg-input rounded-xl px-3 py-2.5 text-sm">
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className="text-xs text-muted-foreground flex items-center gap-1.5"><CalendarIcon className="h-3.5 w-3.5" /> Data do lançamento</label>
        <input
          type="date"
          value={dateStr}
          onChange={(e) => setDateStr(e.target.value)}
          className="mt-1 w-full bg-input rounded-xl px-3 py-2.5 text-sm"
        />
        <p className="text-[11px] text-muted-foreground mt-1">Fuso: America/Sao_Paulo. Alterar a data recalcula Dashboard, Resumo, Relatórios e Calendário automaticamente.</p>
      </div>
      <div className="flex gap-2 justify-end pt-2">
        <button type="button" onClick={onCancel}
          className="rounded-xl border border-border px-4 py-2 text-sm hover:bg-background/40">Cancelar</button>
        <button type="submit" disabled={busy}
          className="rounded-xl bg-gradient-brand text-primary-foreground px-4 py-2 text-sm font-medium glow-neon disabled:opacity-60">
          {busy ? "Salvando…" : "Salvar alterações"}
        </button>
      </div>
    </form>
  );
}

function groupKeyForCategory(category?: string | null) {
  const raw = String(category ?? "").toLowerCase().trim();
  if (!raw) return "outros";
  const found = categoryGroups.find((g) =>
    g.name.toLowerCase() === raw || g.categories.some((c) => c.toLowerCase() === raw)
  );
  return found?.key ?? "outros";
}

function buildPageNumbers(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: (number | "…")[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) out.push("…");
  for (let i = start; i <= end; i++) out.push(i);
  if (end < total - 1) out.push("…");
  out.push(total);
  return out;
}
