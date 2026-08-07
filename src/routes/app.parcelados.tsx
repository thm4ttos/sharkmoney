import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { CreditCard, Plus, Trash2, CheckCircle2, X, CalendarDays, Bell, BellOff, AlertTriangle, Pencil } from "lucide-react";
import { listInstallments, upsertInstallment, payInstallment, deleteInstallment } from "@/lib/installments.functions";
import { REMINDER_OPTIONS, reminderLabel, formatYMD, installmentDueDate } from "@/lib/installments-dates";

export const Route = createFileRoute("/app/parcelados")({
  head: () => ({ meta: [{ title: "Compras Parceladas · Abio" }] }),
  component: Page,
});
const BRL = (n: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n ?? 0);

function Page() {
  const qc = useQueryClient();
  const list = useServerFn(listInstallments);
  const save = useServerFn(upsertInstallment);
  const pay = useServerFn(payInstallment);
  const del = useServerFn(deleteInstallment);
  const q = useQuery({ queryKey: ["installments"], queryFn: () => list() as any });
  // Pagamento reflete em saldo, dashboard, relatórios e histórico.
  const inv = () => { qc.invalidateQueries(); };
  const mSave = useMutation({ mutationFn: (d: any) => save({ data: d }) as any, onSuccess: () => { inv(); setEditing(null); setOpen(false); } });
  const mPay = useMutation({ mutationFn: (id: string) => pay({ data: { id } }) as any, onSuccess: inv });
  const mDel = useMutation({ mutationFn: (id: string) => del({ data: { id } }) as any, onSuccess: inv });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);

  const rows: any[] = q.data ?? [];

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 grid place-items-center rounded-2xl border border-border bg-card/60"><CreditCard className="h-6 w-6 text-primary" /></div>
          <div>
            <h1 className="font-display text-3xl">Compras Parceladas</h1>
            <p className="text-sm text-muted-foreground">Cadastre e acompanhe parcelas restantes.</p>
          </div>
        </div>
        <button onClick={() => { setEditing(null); setOpen(true); }} className="inline-flex items-center gap-2 rounded-xl bg-gradient-brand text-primary-foreground px-4 py-2.5 text-sm glow-neon"><Plus className="h-4 w-4" /> Nova compra</button>
      </header>

      {q.isLoading ? <div className="h-40 rounded-3xl bg-card/40 animate-pulse" /> :
        rows.length === 0 ? (
          <div className="rounded-3xl border border-border bg-card/40 p-12 text-center">
            <CreditCard className="h-10 w-10 text-primary mx-auto mb-3" />
            <p className="font-display text-xl">Nenhuma compra parcelada</p>
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map((p) => (
              <div key={p.id} className={`rounded-2xl border bg-card/60 p-4 ${p.is_overdue ? "border-destructive/40" : "border-border"}`}>
                <div className="flex justify-between items-start mb-2 gap-2 flex-wrap">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{p.title}</p>
                    <p className="text-xs text-muted-foreground">{p.category} · {BRL(p.installment_value)}/mês</p>
                  </div>
                  <div className="text-right">
                    <p className="font-display">{p.installments_paid}/{p.installments_total}</p>
                    <p className="text-[11px] text-muted-foreground">faltam {p.installments_remaining}</p>
                  </div>
                </div>
                <div className="h-2 bg-background/60 rounded-full overflow-hidden mb-2">
                  <div className="h-full bg-gradient-brand transition-all" style={{ width: `${p.progress_pct}%` }} />
                </div>

                {/* Próxima parcela · vencimento · status do lembrete */}
                <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                  {p.next_installment_number ? (
                    <>
                      <span className="inline-flex items-center gap-1">
                        <CalendarDays className="h-3 w-3 shrink-0" />
                        Parcela atual: <span className="text-foreground">{p.next_installment_number}/{p.installments_total}</span>
                      </span>
                      <span className="inline-flex items-center gap-1">
                        Próximo vencimento: <span className="text-foreground">{formatYMD(p.next_due_at)}</span>
                      </span>
                      <span className="inline-flex items-center gap-1">
                        {p.notify_whatsapp ? <Bell className="h-3 w-3 shrink-0 text-primary" /> : <BellOff className="h-3 w-3 shrink-0" />}
                        Lembrete: <span className="text-foreground">{p.notify_whatsapp ? reminderLabel(p.reminder_offsets) : "desativado"}</span>
                      </span>
                      {p.is_overdue && (
                        <span className="inline-flex items-center gap-1 rounded-md border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-destructive">
                          <AlertTriangle className="h-3 w-3 shrink-0" /> Parcela atrasada
                        </span>
                      )}
                      {p.is_due_today && (
                        <span className="rounded-md border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-amber-300">Vence hoje</span>
                      )}
                    </>
                  ) : (
                    <span className="text-emerald-300">Compra quitada 🎉</span>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
                  <span>Pago: <span className="text-emerald-300">{BRL(p.paid_amount)}</span> · Restante: <span className="text-foreground">{BRL(p.remaining_amount)}</span></span>
                  <div className="flex gap-1.5">
                    <button onClick={() => mPay.mutate(p.id)} disabled={p.installments_paid >= p.installments_total || mPay.isPending} className="h-8 px-3 inline-flex items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-xs hover:bg-emerald-500/20 disabled:opacity-40">
                      <CheckCircle2 className="h-3 w-3" /> Paguei parcela
                    </button>
                    <button onClick={() => { setEditing(p); setOpen(true); }} className="h-8 w-8 grid place-items-center rounded-lg border border-border text-muted-foreground hover:text-foreground"><Pencil className="h-3.5 w-3.5" /></button>
                    <button onClick={() => mDel.mutate(p.id)} className="h-8 w-8 grid place-items-center rounded-lg border border-destructive/30 text-destructive hover:bg-destructive/10"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      }

      {open && (
        <Dialog
          initial={editing}
          onClose={() => { setOpen(false); setEditing(null); }}
          onSave={(d: any) => mSave.mutate(d)}
          saving={mSave.isPending}
        />
      )}
    </div>
  );
}

function Dialog({ onClose, onSave, saving, initial }: any) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [category, setCategory] = useState(initial?.category ?? "Compras");
  const [total, setTotal] = useState(initial ? String(initial.total_amount) : "");
  const [parcelas, setParcelas] = useState(initial ? String(initial.installments_total) : "");
  const [first, setFirst] = useState<string>(
    initial?.next_due_at || initial?.first_due_at?.slice(0, 10) || new Date().toISOString().slice(0, 10),
  );
  const [notify, setNotify] = useState<boolean>(!!initial?.notify_whatsapp);
  const [offsets, setOffsets] = useState<number[]>(initial?.reminder_offsets?.length ? initial.reminder_offsets : [3, 0]);

  const nTotal = parseInt(parcelas) || 0;
  const alreadyPaid = initial ? Number(initial.installments_paid ?? 0) : 0;
  // Ao editar, "Data da próxima parcela" refere-se à parcela em aberto:
  // recalculamos o 1º vencimento retroagindo as parcelas já pagas.
  const firstDueForSave = alreadyPaid > 0 ? installmentDueDate(first, 1 - alreadyPaid) : first;
  const preview = nTotal > 0 && /^\d{4}-\d{2}-\d{2}$/.test(first)
    ? Array.from({ length: Math.min(nTotal - alreadyPaid, 3) }, (_, i) => installmentDueDate(first, i + 1))
    : [];

  const toggle = (v: number) =>
    setOffsets((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 grid place-items-center p-4 overflow-y-auto">
      <div className="w-full max-w-md rounded-3xl border border-border bg-card p-5 my-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display text-xl">{initial ? "Editar compra parcelada" : "Nova compra parcelada"}</h3>
          <button onClick={onClose} className="h-8 w-8 grid place-items-center rounded-lg border border-border"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Nome da compra" className="w-full bg-input rounded-xl px-3 py-2.5 text-sm" />
          <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Categoria" className="w-full bg-input rounded-xl px-3 py-2.5 text-sm" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input value={total} onChange={(e) => setTotal(e.target.value)} inputMode="decimal" placeholder="Valor total R$" className="bg-input rounded-xl px-3 py-2.5 text-sm" />
            <input value={parcelas} onChange={(e) => setParcelas(e.target.value)} inputMode="numeric" placeholder="Nº de parcelas" className="bg-input rounded-xl px-3 py-2.5 text-sm" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Data da próxima parcela</label>
            <input type="date" value={first} onChange={(e) => setFirst(e.target.value)} className="mt-1 w-full bg-input rounded-xl px-3 py-2.5 text-sm" />
            {preview.length > 0 && (
              <p className="mt-1.5 text-[11px] text-muted-foreground leading-relaxed">
                Próximas: {preview.map((d, i) => `${alreadyPaid + i + 1}ª ${formatYMD(d)}`).join(" · ")}
                {nTotal - alreadyPaid > 3 ? " · ..." : ""}
              </p>
            )}
          </div>

          <div className="rounded-2xl border border-border bg-background/40 p-3">
            <label className="flex items-center justify-between gap-3 cursor-pointer">
              <span className="text-sm inline-flex items-center gap-2"><Bell className="h-4 w-4 text-primary" /> Quero ser lembrado</span>
              <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="h-4 w-4 accent-[hsl(var(--primary))]" />
            </label>
            {notify && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {REMINDER_OPTIONS.map((o) => {
                  const on = offsets.includes(o.value);
                  return (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => toggle(o.value)}
                      className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${on ? "border-primary/50 bg-primary/15 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
                    >{o.label}</button>
                  );
                })}
                {offsets.length === 0 && <p className="text-[11px] text-destructive w-full">Escolha ao menos uma antecedência.</p>}
                <p className="text-[11px] text-muted-foreground w-full mt-1">Os avisos chegam no seu WhatsApp.</p>
              </div>
            )}
          </div>

          <button
            disabled={!title || !total || !parcelas || !first || (notify && offsets.length === 0) || saving}
            onClick={() => onSave({
              id: initial?.id,
              title,
              category,
              total_amount: parseFloat(String(total).replace(",", ".")),
              installments_total: parseInt(parcelas),
              installments_paid: alreadyPaid,
              first_due_at: firstDueForSave,
              purchased_at: initial?.purchased_at ?? undefined,
              notify_whatsapp: notify,
              reminder_offsets: notify ? offsets : [],
            })}
            className="w-full rounded-xl bg-gradient-brand text-primary-foreground py-2.5 glow-neon disabled:opacity-50"
          >{saving ? "Salvando..." : "Salvar"}</button>
        </div>
      </div>
    </div>
  );
}
