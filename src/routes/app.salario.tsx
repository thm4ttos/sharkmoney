import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Wallet, Plus, Trash2, X } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { listSalary, upsertSalary, deleteSalary } from "@/lib/salary.functions";

export const Route = createFileRoute("/app/salario")({
  head: () => ({ meta: [{ title: "Salário · Shark Money" }] }),
  component: Page,
});
const BRL = (n: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n ?? 0);
const KIND: Record<string, string> = { salary: "Salário", extra: "Renda extra", commission: "Comissão", bonus: "Bônus" };

function Page() {
  const qc = useQueryClient();
  const list = useServerFn(listSalary);
  const save = useServerFn(upsertSalary);
  const del = useServerFn(deleteSalary);
  const q = useQuery({ queryKey: ["salary"], queryFn: () => list() as any });
  const inv = () => qc.invalidateQueries({ queryKey: ["salary"] });
  const mSave = useMutation({ mutationFn: (d: any) => save({ data: d }) as any, onSuccess: () => { inv(); setOpen(false); } });
  const mDel = useMutation({ mutationFn: (id: string) => del({ data: { id } }) as any, onSuccess: inv });
  const [open, setOpen] = useState(false);

  const entries: any[] = q.data?.entries ?? [];
  const series: any[] = q.data?.series ?? [];

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 grid place-items-center rounded-2xl border border-border bg-card/60"><Wallet className="h-6 w-6 text-primary" /></div>
          <div><h1 className="font-display text-3xl">Salário</h1><p className="text-sm text-muted-foreground">Receba e acompanhe sua renda mensal.</p></div>
        </div>
        <button onClick={() => setOpen(true)} className="inline-flex items-center gap-2 rounded-xl bg-gradient-brand text-primary-foreground px-4 py-2.5 text-sm glow-neon"><Plus className="h-4 w-4" /> Novo recebimento</button>
      </header>

      <div className="grid md:grid-cols-2 gap-3">
        <div className="rounded-2xl border border-primary/30 bg-gradient-brand-soft p-5"><p className="text-xs uppercase tracking-wider text-primary">Total recebido</p><p className="font-display text-3xl mt-1">{BRL(q.data?.month_total ?? 0)}</p></div>
        <div className="rounded-2xl border border-border bg-card/60 p-5"><p className="text-xs uppercase tracking-wider text-muted-foreground">Próximo salário</p><p className="font-display text-xl mt-1">{q.data?.next ? `${BRL(Number(q.data.next.amount))} · ${new Date(q.data.next.received_at + "T00:00:00").toLocaleDateString("pt-BR")}` : "—"}</p></div>
      </div>

      {series.length > 0 && (
        <div className="rounded-3xl border border-border bg-card/60 p-5">
          <h2 className="font-display text-lg mb-3">Evolução mensal</h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={series}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" />
              <YAxis stroke="hsl(var(--muted-foreground))" />
              <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} formatter={(v: any) => BRL(Number(v))} />
              <Bar dataKey="total" fill="hsl(var(--primary))" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="rounded-3xl border border-border bg-card/60 p-5">
        <h2 className="font-display text-lg mb-3">Histórico</h2>
        {entries.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum recebimento ainda.</p> :
          <div className="divide-y divide-border">
            {entries.map((e) => (
              <div key={e.id} className="py-3 flex items-center gap-3 text-sm">
                <div className="flex-1"><p>{KIND[e.kind] ?? e.kind}{e.notes ? ` · ${e.notes}` : ""}</p><p className="text-xs text-muted-foreground">{new Date(e.received_at + "T00:00:00").toLocaleDateString("pt-BR")}</p></div>
                <p className="font-medium text-emerald-300">{BRL(e.amount)}</p>
                <button onClick={() => mDel.mutate(e.id)} className="h-8 w-8 grid place-items-center rounded-lg border border-destructive/30 text-destructive hover:bg-destructive/10"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            ))}
          </div>
        }
      </div>

      {open && <Dialog onClose={() => setOpen(false)} onSave={(d: any) => mSave.mutate(d)} saving={mSave.isPending} />}
    </div>
  );
}

function Dialog({ onClose, onSave, saving }: any) {
  const [kind, setKind] = useState("salary");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 grid place-items-center p-4">
      <div className="w-full max-w-md rounded-3xl border border-border bg-card p-6">
        <div className="flex items-center justify-between mb-4"><h3 className="font-display text-xl">Novo recebimento</h3><button onClick={onClose} className="h-8 w-8 grid place-items-center rounded-lg border border-border"><X className="h-4 w-4" /></button></div>
        <div className="space-y-3">
          <select value={kind} onChange={(e) => setKind(e.target.value)} className="w-full bg-input rounded-xl px-3 py-2.5 text-sm">
            <option value="salary">Salário principal</option><option value="extra">Renda extra</option><option value="commission">Comissão</option><option value="bonus">Bônus</option>
          </select>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="Valor R$" className="w-full bg-input rounded-xl px-3 py-2.5 text-sm" />
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full bg-input rounded-xl px-3 py-2.5 text-sm" />
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Observação (opcional)" className="w-full bg-input rounded-xl px-3 py-2.5 text-sm" />
          <button disabled={!amount || saving} onClick={() => onSave({ kind, amount: parseFloat(amount.replace(",", ".")), received_at: date, notes })} className="w-full rounded-xl bg-gradient-brand text-primary-foreground py-2.5 glow-neon disabled:opacity-50">{saving ? "Salvando..." : "Salvar"}</button>
        </div>
      </div>
    </div>
  );
}
