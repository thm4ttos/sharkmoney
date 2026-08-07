import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AlertTriangle, Plus, Trash2, CheckCircle2, X } from "lucide-react";
import { listDebts, upsertDebt, deleteDebt, togglePaidDebt } from "@/lib/debts.functions";

export const Route = createFileRoute("/app/dividas")({
  head: () => ({ meta: [{ title: "Dívidas · Abio" }] }),
  component: Page,
});
const BRL = (n: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n ?? 0);

function Page() {
  const qc = useQueryClient();
  const list = useServerFn(listDebts);
  const save = useServerFn(upsertDebt);
  const del = useServerFn(deleteDebt);
  const tog = useServerFn(togglePaidDebt);
  const q = useQuery({ queryKey: ["debts"], queryFn: () => list() as any });
  const inv = () => qc.invalidateQueries({ queryKey: ["debts"] });
  const mSave = useMutation({ mutationFn: (d: any) => save({ data: d }) as any, onSuccess: () => { inv(); setOpen(false); } });
  const mDel = useMutation({ mutationFn: (id: string) => del({ data: { id } }) as any, onSuccess: inv });
  const mTog = useMutation({ mutationFn: (d: any) => tog({ data: d }) as any, onSuccess: inv });
  const [open, setOpen] = useState(false);

  const debts: any[] = q.data?.debts ?? [];
  const t = q.data?.totals ?? { open: 0, overdue: 0, upcoming: 0 };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 grid place-items-center rounded-2xl border border-border bg-card/60"><AlertTriangle className="h-6 w-6 text-primary" /></div>
          <div><h1 className="font-display text-3xl">Dívidas</h1><p className="text-sm text-muted-foreground">Controle dívidas, juros e vencimentos.</p></div>
        </div>
        <button onClick={() => setOpen(true)} className="inline-flex items-center gap-2 rounded-xl bg-gradient-brand text-primary-foreground px-4 py-2.5 text-sm glow-neon"><Plus className="h-4 w-4" /> Nova dívida</button>
      </header>

      <div className="grid md:grid-cols-3 gap-3">
        <Card label="Total em aberto" value={BRL(t.open)} tone="primary" />
        <Card label="Vencido" value={BRL(t.overdue)} tone="rose" />
        <Card label="Próximos 7 dias" value={BRL(t.upcoming)} tone="amber" />
      </div>

      {q.isLoading ? <div className="h-40 rounded-3xl bg-card/40 animate-pulse" /> :
        debts.length === 0 ? (
          <div className="rounded-3xl border border-border bg-card/40 p-12 text-center">
            <AlertTriangle className="h-10 w-10 text-primary mx-auto mb-3" />
            <p className="font-display text-xl">Nenhuma dívida cadastrada</p>
          </div>
        ) : (
          <div className="space-y-2">
            {debts.map((d) => (
              <div key={d.id} className={["rounded-2xl border bg-card/60 p-4 flex flex-wrap items-center gap-3", d.overdue ? "border-rose-500/40" : "border-border", d.paid ? "opacity-50" : ""].join(" ")}>
                <div className="flex-1 min-w-[200px]">
                  <p className="font-medium">{d.title}</p>
                  <p className="text-xs text-muted-foreground">{d.creditor ?? "—"} · {d.interest_rate > 0 ? `${d.interest_rate}% juros` : "sem juros"}{d.due_at ? ` · vence ${new Date(d.due_at + "T00:00:00").toLocaleDateString("pt-BR")}` : ""}</p>
                </div>
                <p className="font-display">{BRL(d.principal)}</p>
                <div className="flex gap-1.5">
                  <button onClick={() => mTog.mutate({ id: d.id, paid: !d.paid })} className="h-9 px-3 inline-flex items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-xs hover:bg-emerald-500/20"><CheckCircle2 className="h-3.5 w-3.5" /> {d.paid ? "Reabrir" : "Quitada"}</button>
                  <button onClick={() => mDel.mutate(d.id)} className="h-9 w-9 grid place-items-center rounded-lg border border-destructive/30 text-destructive hover:bg-destructive/10"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              </div>
            ))}
          </div>
        )
      }

      {open && <Dialog onClose={() => setOpen(false)} onSave={(d: any) => mSave.mutate(d)} saving={mSave.isPending} />}
    </div>
  );
}

function Card({ label, value, tone }: { label: string; value: string; tone: "primary" | "rose" | "amber" }) {
  const c = tone === "rose" ? "border-rose-500/30 bg-rose-500/10" : tone === "amber" ? "border-amber-500/30 bg-amber-500/10" : "border-primary/30 bg-gradient-brand-soft";
  return <div className={`rounded-2xl border p-4 ${c}`}><p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p><p className="font-display text-2xl mt-1">{value}</p></div>;
}

function Dialog({ onClose, onSave, saving }: any) {
  const [title, setTitle] = useState("");
  const [creditor, setCreditor] = useState("");
  const [principal, setPrincipal] = useState("");
  const [rate, setRate] = useState("0");
  const [due, setDue] = useState("");
  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 grid place-items-center p-4">
      <div className="w-full max-w-md rounded-3xl border border-border bg-card p-6">
        <div className="flex items-center justify-between mb-4"><h3 className="font-display text-xl">Nova dívida</h3><button onClick={onClose} className="h-8 w-8 grid place-items-center rounded-lg border border-border"><X className="h-4 w-4" /></button></div>
        <div className="space-y-3">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Nome da dívida" className="w-full bg-input rounded-xl px-3 py-2.5 text-sm" />
          <input value={creditor} onChange={(e) => setCreditor(e.target.value)} placeholder="Credor" className="w-full bg-input rounded-xl px-3 py-2.5 text-sm" />
          <div className="grid grid-cols-2 gap-2">
            <input value={principal} onChange={(e) => setPrincipal(e.target.value)} inputMode="decimal" placeholder="Valor R$" className="bg-input rounded-xl px-3 py-2.5 text-sm" />
            <input value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" placeholder="Juros % a.m." className="bg-input rounded-xl px-3 py-2.5 text-sm" />
          </div>
          <div><label className="text-xs text-muted-foreground">Vencimento</label><input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="mt-1 w-full bg-input rounded-xl px-3 py-2.5 text-sm" /></div>
          <button disabled={!title || !principal || saving} onClick={() => onSave({ title, creditor, principal: parseFloat(principal.replace(",", ".")), interest_rate: parseFloat(rate.replace(",", ".") || "0"), due_at: due || null })} className="w-full rounded-xl bg-gradient-brand text-primary-foreground py-2.5 glow-neon disabled:opacity-50">{saving ? "Salvando..." : "Salvar"}</button>
        </div>
      </div>
    </div>
  );
}
