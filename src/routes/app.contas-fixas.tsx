import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Repeat, Plus, Trash2, X, Bell, BellOff, CheckCircle2, AlertTriangle, Wallet, History, Undo2 } from "lucide-react";
import { listBills, upsertBill, toggleBill, deleteBill, chargeBillNow, registerBillPartialPayment, listBillPayments, reverseBillPayment } from "@/lib/bills.functions";

export const Route = createFileRoute("/app/contas-fixas")({
  head: () => ({ meta: [{ title: "Contas Fixas · Shark Money" }] }),
  component: Page,
});

const BRL = (n: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n ?? 0);
const FREQ_LABEL: Record<string, string> = { weekly: "Semanal", biweekly: "Quinzenal", monthly: "Mensal", yearly: "Anual" };

function computePeriodSummary(bills: any[], period: "week" | "month") {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let start: Date, end: Date;
  if (period === "week") {
    // Semana: segunda a domingo (padrão BR)
    const dow = today.getDay(); // 0=Dom .. 6=Sáb
    const offsetToMonday = dow === 0 ? -6 : 1 - dow;
    start = new Date(today); start.setDate(today.getDate() + offsetToMonday);
    end = new Date(start); end.setDate(start.getDate() + 6); end.setHours(23, 59, 59, 999);
  } else {
    start = new Date(today.getFullYear(), today.getMonth(), 1);
    end = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999);
  }

  const inRange = bills.filter((b) => {
    if (!b.active || !b.next_due_at) return false;
    const d = new Date(String(b.next_due_at) + "T00:00:00");
    return d >= start && d <= end;
  });

  let total = 0, paid = 0, remaining = 0;
  for (const b of inRange) {
    const original = Number(b.original_amount ?? b.amount ?? 0);
    const p = Number(b.paid_amount ?? 0);
    const rem = Math.max(0, Math.round((original - p) * 100) / 100);
    total += original;
    paid += Math.min(p, original);
    remaining += rem;
  }
  total = Math.round(total * 100) / 100;
  paid = Math.round(paid * 100) / 100;
  remaining = Math.round(remaining * 100) / 100;
  const percent = total > 0 ? Math.round((paid / total) * 100) : 0;
  return { total, paid, remaining, percent, count: inRange.length };
}

function Page() {
  const qc = useQueryClient();
  const run = useServerFn(listBills);
  const save = useServerFn(upsertBill);
  const tog = useServerFn(toggleBill);
  const del = useServerFn(deleteBill);
  const charge = useServerFn(chargeBillNow);
  const partial = useServerFn(registerBillPartialPayment);
  const q = useQuery({ queryKey: ["bills"], queryFn: () => run() as any });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [payFor, setPayFor] = useState<any | null>(null);
  const [historyFor, setHistoryFor] = useState<any | null>(null);

  const invalidate = () => {
    [
      "bills", "transactions", "home-stats", "dashboard", "home",
      "calendar", "reports", "categorias", "freedom", "upcoming-bills",
      "balance", "balance-breakdown", "recent-transactions", "bill-payments",
    ].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    qc.refetchQueries({ type: "active" });
  };
  const mSave = useMutation({ mutationFn: (d: any) => save({ data: d }) as any, onSuccess: () => { invalidate(); setOpen(false); setEditing(null); } });
  const mTog = useMutation({ mutationFn: (d: any) => tog({ data: d }) as any, onSuccess: invalidate });
  const mDel = useMutation({ mutationFn: (id: string) => del({ data: { id } }) as any, onSuccess: invalidate });
  const mCharge = useMutation({ mutationFn: (id: string) => charge({ data: { id } }) as any, onSuccess: invalidate });
  const mPartial = useMutation({
    mutationFn: (d: { id: string; paidAmount: number; occurredAt?: string; notes?: string | null }) => partial({ data: d }) as any,
    onSuccess: () => { invalidate(); setPayFor(null); },
  });

  const bills: any[] = q.data ?? [];
  const [period, setPeriod] = useState<"week" | "month">("week");

  const summary = computePeriodSummary(bills, period);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <motion.header initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 grid place-items-center rounded-2xl border border-border bg-card/60">
            <Repeat className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="font-display text-3xl">Contas Fixas</h1>
            <p className="text-sm text-muted-foreground">Despesas recorrentes com lembrete automático no WhatsApp.</p>
          </div>
        </div>
        <button onClick={() => { setEditing(null); setOpen(true); }}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-brand text-primary-foreground px-4 py-2.5 text-sm glow-neon hover:scale-[1.02] transition-smooth">
          <Plus className="h-4 w-4" /> Nova conta fixa
        </button>
      </motion.header>

      {bills.length > 0 ? (
        <motion.div layout className="rounded-3xl border border-primary/30 bg-gradient-brand-soft p-5">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
            <div>
              <p className="text-xs uppercase tracking-wider text-primary">
                {period === "week" ? "Total da Semana" : "Total do Mês"}
              </p>
              <p key={summary.total} className="font-display text-3xl mt-1">{BRL(summary.total)}</p>
            </div>
            <div className="inline-flex rounded-xl border border-border bg-background/40 p-1 text-xs">
              <button
                onClick={() => setPeriod("week")}
                className={["px-3 py-1.5 rounded-lg transition-smooth", period === "week" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"].join(" ")}
              >🟢 Semana</button>
              <button
                onClick={() => setPeriod("month")}
                className={["px-3 py-1.5 rounded-lg transition-smooth", period === "month" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"].join(" ")}
              >⚪ Mês</button>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <div className="rounded-xl border border-border bg-background/30 p-2.5">
              <p className="text-[10px] uppercase text-muted-foreground">Contas</p>
              <p className="font-display text-lg mt-0.5">{summary.count}</p>
            </div>
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-2.5">
              <p className="text-[10px] uppercase text-emerald-300">Já pago</p>
              <p key={summary.paid} className="font-display text-lg mt-0.5 text-emerald-200">{BRL(summary.paid)}</p>
            </div>
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-2.5">
              <p className="text-[10px] uppercase text-amber-300">Restante</p>
              <p key={summary.remaining} className="font-display text-lg mt-0.5 text-amber-200">{BRL(summary.remaining)}</p>
            </div>
            <div className="rounded-xl border border-border bg-background/30 p-2.5">
              <p className="text-[10px] uppercase text-muted-foreground">% quitado</p>
              <p className="font-display text-lg mt-0.5">{summary.percent}%</p>
            </div>
          </div>
          <div className="mt-3 h-1.5 w-full rounded-full bg-background/40 overflow-hidden">
            <div className="h-full bg-gradient-brand transition-all" style={{ width: `${Math.min(100, summary.percent)}%` }} />
          </div>
        </motion.div>
      ) : null}

      {q.isLoading ? (
        <div className="h-44 rounded-3xl border border-border bg-card/40 animate-pulse" />
      ) : bills.length === 0 ? (
        <div className="rounded-3xl border border-border bg-card/40 backdrop-blur-xl p-12 text-center">
          <Repeat className="h-10 w-10 text-primary mx-auto mb-3" />
          <p className="font-display text-xl">Nenhuma conta fixa cadastrada</p>
          <p className="text-sm text-muted-foreground mt-1">Cadastre aluguel, internet, assinaturas e receba lembretes automáticos.</p>
        </div>
      ) : (
        <div className="rounded-3xl border border-border bg-card/60 backdrop-blur-xl divide-y divide-border overflow-hidden">
          {bills.map((b, i) => {
            const overdue = b.days_until < 0;
            const dueSoon = b.days_until >= 0 && b.days_until <= 3;
            const original = Number(b.original_amount ?? b.amount ?? 0);
            const paid = Number(b.paid_amount ?? 0);
            const remaining = Math.max(0, Math.round((original - paid) * 100) / 100);
            const isPartial = paid > 0 && remaining > 0.01;
            const rawStatus = (b.payment_status || "pending") as string;
            const status = (isPartial ? "partial" : rawStatus) as "pending" | "awaiting" | "paid" | "late" | "partial";
            const statusMeta: Record<string, { label: string; cls: string; dot: string }> = {
              paid: { label: "Pago", cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300", dot: "🟢" },
              awaiting: { label: "Aguardando confirmação", cls: "border-amber-500/30 bg-amber-500/10 text-amber-200", dot: "🟡" },
              late: { label: "Atrasado", cls: "border-rose-500/30 bg-rose-500/10 text-rose-200", dot: "🔴" },
              partial: { label: "Pagamento parcial", cls: "border-orange-500/30 bg-orange-500/10 text-orange-200", dot: "🟠" },
              pending: { label: "Pendente", cls: "border-border bg-background/40 text-muted-foreground", dot: "⚪" },
            };
            const st = statusMeta[status] ?? statusMeta.pending;
            const paidAt = b.last_paid_at ? new Date(b.last_paid_at).toLocaleDateString("pt-BR") : null;
            const overdueDays = overdue && status !== "paid" ? Math.abs(b.days_until) : 0;
            const percentPaid = original > 0 ? Math.min(100, Math.round((paid / original) * 100)) : 0;
            const showProgress = paid > 0 || status === "partial" || status === "paid";
            const barColor = status === "paid" ? "bg-emerald-400" : status === "partial" || isPartial ? "bg-orange-400" : "bg-primary";
            return (
              <motion.div key={b.id}
                initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }}
                className={["p-4 flex flex-wrap items-start gap-4", !b.active ? "opacity-60" : ""].join(" ")}>
                <div className={["h-11 w-11 grid place-items-center rounded-xl border shrink-0", overdue ? "border-rose-500/40 bg-rose-500/10 text-rose-300" : dueSoon ? "border-amber-500/40 bg-amber-500/10 text-amber-300" : "border-border bg-background/40"].join(" ")}>
                  {overdue ? <AlertTriangle className="h-5 w-5" /> : <Repeat className="h-5 w-5 text-primary" />}
                </div>
                <div className="flex-1 min-w-[200px]">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium">{b.title}</p>
                    <span className={["text-[10px] px-2 py-0.5 rounded-full border", st.cls].join(" ")}>{st.dot} {st.label}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {b.category} · {FREQ_LABEL[b.frequency]}
                    {b.frequency === "monthly" ? ` · Dia ${new Date(b.next_due_at + "T00:00:00").getDate().toString().padStart(2, "0")}` : ""}
                    {" · "}
                    {b.notify_whatsapp ? "🔔 Lembretes ON" : "🔕 Lembretes OFF"}
                    {paidAt ? ` · Último pgto ${paidAt}` : ""}
                    {overdueDays > 0 ? ` · ${overdueDays}d em atraso` : ""}
                  </p>

                  {b.total_installments ? (
                    <div className="mt-2 rounded-xl border border-border bg-background/30 p-2.5">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-0.5 text-[11px]">
                        <span className="text-muted-foreground">
                          Parcela <span className="text-foreground font-medium">{b.current_installment} de {b.total_installments}</span>
                          {" · "}Pagas <span className="text-emerald-300 font-medium">{b.paid_installments}</span>
                          {" · "}Pendentes <span className="text-amber-300 font-medium">{b.remaining_installments}</span>
                        </span>
                        <span className={b.installment_settled ? "text-emerald-300 font-semibold" : "text-primary font-semibold"}>
                          {b.installment_settled ? "Quitado" : `${String(b.installment_percent).replace(".", ",")}% concluído`}
                        </span>
                      </div>
                      <div className="mt-1.5 h-1.5 w-full rounded-full bg-background/60 overflow-hidden border border-border/60">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${Math.min(100, b.installment_percent)}%` }}
                          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                          className={["h-full", b.installment_settled ? "bg-emerald-400" : "bg-gradient-brand"].join(" ")}
                        />
                      </div>
                    </div>
                  ) : null}


                  {showProgress ? (
                    <div className="mt-2">
                      <div className="flex items-center justify-between text-[11px] mb-1">
                        <span className="text-muted-foreground">
                          Original: <span className="text-foreground font-medium">{BRL(original)}</span>
                          {" · "}Pago: <span className="text-emerald-300 font-medium">{BRL(paid)}</span>
                          {" · "}Falta: <span className={remaining > 0 ? "text-orange-300 font-medium" : "text-emerald-300 font-medium"}>{BRL(remaining)}</span>
                        </span>
                        <span className={status === "paid" ? "text-emerald-300 font-semibold" : "text-orange-300 font-semibold"}>{percentPaid}%</span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-background/60 overflow-hidden border border-border/60">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${percentPaid}%` }}
                          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                          className={["h-full", barColor].join(" ")}
                        />
                      </div>
                    </div>
                  ) : null}
                </div>
                <div className="text-right">
                  <p className="font-display text-base">{BRL(isPartial ? remaining : original)}</p>
                  <p className={["text-[11px]", overdue ? "text-rose-300" : dueSoon ? "text-amber-300" : "text-muted-foreground"].join(" ")}>
                    {overdue ? `Atrasada ${Math.abs(b.days_until)}d` : b.days_until === 0 ? "Vence hoje" : `Vence em ${b.days_until}d`}
                    {" · "}
                    {new Date(b.next_due_at + "T00:00:00").toLocaleDateString("pt-BR")}
                  </p>
                </div>

                <div className="flex items-center gap-1.5 flex-wrap">
                  <button onClick={() => setPayFor(b)} title="Registrar pagamento parcial"
                    className="h-9 px-3 inline-flex items-center gap-1 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-200 text-xs hover:bg-amber-500/20">
                    <Wallet className="h-3.5 w-3.5" /> Abater
                  </button>
                  <button onClick={() => mCharge.mutate(b.id)}
                    disabled={b.installment_settled}
                    title={b.total_installments ? "Dar baixa na parcela atual" : "Quitar totalmente e avançar vencimento"}
                    className="h-9 px-3 inline-flex items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-xs hover:bg-emerald-500/20 disabled:opacity-40">
                    <CheckCircle2 className="h-3.5 w-3.5" /> {b.total_installments ? "Paguei parcela" : "Paguei tudo"}
                  </button>

                  <button onClick={() => setHistoryFor(b)} title="Histórico de pagamentos"
                    className="h-9 px-3 inline-flex items-center gap-1 rounded-lg border border-border text-xs hover:bg-background/40">
                    <Undo2 className="h-3.5 w-3.5" /> Desfazer pagamento
                  </button>
                  <button onClick={() => mTog.mutate({ id: b.id, active: !b.active })} title={b.active ? "Desativar" : "Ativar"}
                    className="h-9 w-9 grid place-items-center rounded-lg border border-border hover:bg-background/40">
                    {b.active ? <Bell className="h-3.5 w-3.5" /> : <BellOff className="h-3.5 w-3.5" />}
                  </button>
                  <button onClick={() => { setEditing(b); setOpen(true); }}
                    className="h-9 px-2.5 text-xs rounded-lg border border-border hover:bg-background/40">Editar</button>
                  <button onClick={() => mDel.mutate(b.id)}
                    className="h-9 w-9 grid place-items-center rounded-lg border border-destructive/30 text-destructive hover:bg-destructive/10">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </motion.div>
            );
          })}

        </div>
      )}

      <AnimatePresence>
        {open ? (
          <BillDialog initial={editing} onClose={() => { setOpen(false); setEditing(null); }}
            onSave={(d) => mSave.mutate({ ...d, id: editing?.id })} saving={mSave.isPending} />
        ) : null}
        {payFor ? (
          <PartialPaymentDialog
            bill={payFor}
            onClose={() => setPayFor(null)}
            onSave={(d) => mPartial.mutate({ id: payFor.id, ...d })}
            saving={mPartial.isPending}
            error={(mPartial.error as any)?.message ?? null}
          />
        ) : null}
        {historyFor ? (
          <HistoryDialog bill={historyFor} onClose={() => setHistoryFor(null)} onChanged={invalidate} />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function BillDialog({ initial, onClose, onSave, saving }: { initial: any | null; onClose: () => void; onSave: (d: any) => void; saving: boolean }) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [category, setCategory] = useState(initial?.category ?? "Contas Fixas");
  const [amount, setAmount] = useState(initial ? String(initial.amount) : "");
  const [frequency, setFrequency] = useState(initial?.frequency ?? "monthly");
  const [nextDue, setNextDue] = useState(initial?.next_due_at ?? new Date().toISOString().slice(0, 10));
  const [notify, setNotify] = useState(initial?.notify_whatsapp ?? true);
  const [hasTerm, setHasTerm] = useState(!!initial?.total_installments);
  const [totalInst, setTotalInst] = useState(initial?.total_installments ? String(initial.total_installments) : "");
  const [paidInst, setPaidInst] = useState(String(initial?.paid_installments ?? 0));

  const submit = () => onSave({
    title, category, amount: parseFloat(amount.replace(",", ".")), frequency,
    next_due_at: nextDue, notify_whatsapp: notify, active: true,
    total_installments: hasTerm ? parseInt(totalInst || "0", 10) : null,
    paid_installments: hasTerm ? parseInt(paidInst || "0", 10) : 0,
  });


  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 grid place-items-center p-4">
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        className="w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display text-xl">{initial ? "Editar conta fixa" : "Nova conta fixa"}</h3>
          <button onClick={onClose} className="h-8 w-8 grid place-items-center rounded-lg border border-border"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground">Título</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 w-full bg-input rounded-xl px-3 py-2.5 text-sm" placeholder="Ex.: Aluguel, Internet, Netflix" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Categoria</label>
              <input value={category} onChange={(e) => setCategory(e.target.value)} className="mt-1 w-full bg-input rounded-xl px-3 py-2.5 text-sm" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Valor (R$)</label>
              <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className="mt-1 w-full bg-input rounded-xl px-3 py-2.5 text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Frequência</label>
              <select value={frequency} onChange={(e) => setFrequency(e.target.value)} className="mt-1 w-full bg-input rounded-xl px-3 py-2.5 text-sm">
                <option value="weekly">Semanal</option>
                <option value="biweekly">Quinzenal</option>
                <option value="monthly">Mensal</option>
                <option value="yearly">Anual</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Próximo vencimento</label>
              <input type="date" value={nextDue} onChange={(e) => setNextDue(e.target.value)} className="mt-1 w-full bg-input rounded-xl px-3 py-2.5 text-sm" />
            </div>
          </div>
          <div className="rounded-2xl border border-border bg-background/30 p-3 space-y-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={hasTerm} onChange={(e) => setHasTerm(e.target.checked)} className="h-4 w-4 accent-primary" />
              Contrato com prazo determinado (consórcio, financiamento)
            </label>
            {hasTerm ? (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground">Total de parcelas</label>
                  <input value={totalInst} onChange={(e) => setTotalInst(e.target.value.replace(/\D/g, ""))} inputMode="numeric"
                    placeholder="Ex.: 220" className="mt-1 w-full bg-input rounded-xl px-3 py-2.5 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Parcelas já pagas</label>
                  <input value={paidInst} onChange={(e) => setPaidInst(e.target.value.replace(/\D/g, ""))} inputMode="numeric"
                    placeholder="0" className="mt-1 w-full bg-input rounded-xl px-3 py-2.5 text-sm" />
                </div>
                <p className="col-span-2 text-[11px] text-muted-foreground">
                  Pendentes: <span className="text-foreground font-medium">{Math.max(0, (parseInt(totalInst || "0", 10) || 0) - (parseInt(paidInst || "0", 10) || 0))}</span>
                </p>
              </div>
            ) : null}
          </div>

          <label className="flex items-center gap-2 text-sm pt-1">
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="h-4 w-4 accent-primary" />
            Avisar no WhatsApp quando estiver próximo do vencimento
          </label>
          <button onClick={submit} disabled={saving || !title || !amount}
            className="w-full rounded-xl bg-gradient-brand text-primary-foreground font-medium py-2.5 glow-neon disabled:opacity-50">
            {saving ? "Salvando..." : "Salvar conta fixa"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function PartialPaymentDialog({ bill, onClose, onSave, saving, error }: {
  bill: any;
  onClose: () => void;
  onSave: (d: { paidAmount: number; occurredAt: string; notes: string | null }) => void;
  saving: boolean;
  error: string | null;
}) {
  const original = Number(bill.original_amount ?? bill.amount ?? 0);
  const alreadyPaid = Number(bill.paid_amount ?? 0);
  const remainingBefore = Math.max(0, Math.round((original - alreadyPaid) * 100) / 100);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");

  // Aceita "100", "100,00", "R$ 100,00", "1.200,50" → number
  const parseBRL = (raw: string): number => {
    const cleaned = raw.replace(/[^\d.,-]/g, "").trim();
    if (!cleaned) return 0;
    const normalized = cleaned.includes(",")
      ? cleaned.replace(/\./g, "").replace(",", ".")
      : cleaned;
    const n = parseFloat(normalized);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
  };

  const paidNow = parseBRL(amount);
  const projectedRemaining = Math.max(0, Math.round((remainingBefore - paidNow) * 100) / 100);
  const isFullPayment = paidNow > 0 && projectedRemaining <= 0.01;
  const exceeds = paidNow > remainingBefore + 0.01;

  const submit = () => {
    if (paidNow <= 0 || exceeds || saving) return;
    onSave({ paidAmount: paidNow, occurredAt: date, notes: notes.trim() || null });
  };


  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 grid place-items-center p-4">
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        className="w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display text-xl">Registrar Pagamento Parcial</h3>
          <button onClick={onClose} className="h-8 w-8 grid place-items-center rounded-lg border border-border"><X className="h-4 w-4" /></button>
        </div>

        <div className="rounded-2xl border border-border bg-background/40 p-3 mb-4 text-xs space-y-1">
          <p className="font-medium text-sm">{bill.title}</p>
          <p className="text-muted-foreground">Valor original: <span className="text-foreground">{BRL(original)}</span></p>
          <p className="text-muted-foreground">Já pago: <span className="text-foreground">{BRL(alreadyPaid)}</span></p>
          <p className="text-muted-foreground">Pendente: <span className="text-amber-300 font-medium">{BRL(remainingBefore)}</span></p>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground">Valor pago (R$)</label>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" autoFocus
              placeholder="Ex.: 200,00"
              className="mt-1 w-full bg-input rounded-xl px-3 py-2.5 text-sm" />
            <div className="flex gap-2 mt-2 flex-wrap">
              <button type="button" onClick={() => setAmount(String(remainingBefore).replace(".", ","))}
                className="text-[11px] rounded-lg border border-primary/30 bg-primary/10 text-primary px-2 py-1">
                Quitar restante ({BRL(remainingBefore)})
              </button>
              {[50, 100, 200].map((v) => v < remainingBefore ? (
                <button key={v} type="button" onClick={() => setAmount(String(v))}
                  className="text-[11px] rounded-lg border border-border px-2 py-1 hover:bg-background/40">
                  {BRL(v)}
                </button>
              ) : null)}
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Data do pagamento</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
              className="mt-1 w-full bg-input rounded-xl px-3 py-2.5 text-sm" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Observação (opcional)</label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Ex.: transferência PIX"
              className="mt-1 w-full bg-input rounded-xl px-3 py-2.5 text-sm" />
          </div>

          {paidNow > 0 ? (
            exceeds ? (
              <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                ⚠️ O valor informado é maior que o pendente ({BRL(remainingBefore)}). Ajuste o valor para continuar.
              </div>
            ) : (
              <div className={["rounded-xl border p-3 text-xs", isFullPayment ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : "border-orange-500/30 bg-orange-500/10 text-orange-200"].join(" ")}>
                {isFullPayment ? (
                  <>✅ Conta será <strong>quitada</strong>. Próximo vencimento avançará automaticamente.</>
                ) : (
                  <>🟠 Após este pagamento, restarão <strong>{BRL(projectedRemaining)}</strong>.</>
                )}
              </div>
            )
          ) : null}

          {error ? <p className="text-xs text-destructive">{error}</p> : null}

          <button onClick={submit} disabled={saving || paidNow <= 0 || exceeds}
            className="w-full rounded-xl bg-gradient-brand text-primary-foreground font-medium py-2.5 glow-neon disabled:opacity-50">
            {saving ? "Registrando pagamento…" : `Registrar ${paidNow > 0 ? BRL(paidNow) : "pagamento"}`}
          </button>

        </div>
      </motion.div>
    </motion.div>
  );
}

function HistoryDialog({ bill, onClose, onChanged }: { bill: any; onClose: () => void; onChanged: () => void }) {
  const list = useServerFn(listBillPayments);
  const reverse = useServerFn(reverseBillPayment);
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState<any | null>(null);
  const q = useQuery({ queryKey: ["bill-payments", bill.id], queryFn: () => list({ data: { billId: bill.id } }) as any });
  const undo = useMutation({
    mutationFn: (paymentId: string) => reverse({ data: { paymentId } }) as any,
    onSuccess: async () => {
      setConfirming(null);
      onChanged();
      await qc.invalidateQueries({ queryKey: ["bill-payments", bill.id] });
    },
  });
  const payments: any[] = q.data ?? [];

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 grid place-items-center p-4">
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        className="w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-card">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-display text-xl">Histórico de pagamentos</h3>
            <p className="text-xs text-muted-foreground mt-0.5">{bill.title}</p>
          </div>
          <button onClick={onClose} className="h-8 w-8 grid place-items-center rounded-lg border border-border"><X className="h-4 w-4" /></button>
        </div>

        {q.isLoading ? (
          <div className="h-24 rounded-xl border border-border bg-background/30 animate-pulse" />
        ) : payments.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-8">
            Nenhum pagamento registrado ainda.
          </div>
        ) : (
          <div className="rounded-2xl border border-border divide-y divide-border overflow-hidden max-h-80 overflow-y-auto">
            {payments.map((p) => (
              <div key={p.id} className="px-3 py-2.5 text-sm">
                <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{new Date(p.paid_at ?? p.created_at).toLocaleDateString("pt-BR")}</p>
                  {p.notes ? <p className="text-[11px] text-muted-foreground truncate">{p.notes}</p> : null}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <p className="text-emerald-300 font-medium">{BRL(p.amount)}</p>
                  <button onClick={() => setConfirming(p)} title="Desfazer este pagamento"
                    className="h-8 w-8 grid place-items-center rounded-lg border border-destructive/30 text-destructive hover:bg-destructive/10">
                    <Undo2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                </div>
                {confirming?.id === p.id ? (
                  <div className="mt-3 rounded-xl border border-destructive/30 bg-destructive/10 p-3">
                    <p className="text-xs">Tem certeza que deseja desfazer este pagamento?</p>
                    <p className="text-[11px] text-muted-foreground mt-1">A despesa correspondente também será removida das Transações.</p>
                    {undo.error ? <p className="text-xs text-destructive mt-2">{(undo.error as Error).message}</p> : null}
                    <div className="flex justify-end gap-2 mt-3">
                      <button onClick={() => setConfirming(null)} disabled={undo.isPending}
                        className="h-8 px-3 rounded-lg border border-border text-xs">Cancelar</button>
                      <button onClick={() => undo.mutate(p.id)} disabled={undo.isPending}
                        className="h-8 px-3 rounded-lg bg-destructive text-destructive-foreground text-xs disabled:opacity-50">
                        {undo.isPending ? "Desfazendo..." : "Confirmar"}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
