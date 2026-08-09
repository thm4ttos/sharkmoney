import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Sparkles, Plus, Trash2, X } from "lucide-react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { getFreedomSnapshot, upsertAsset, deleteAsset } from "@/lib/freedom.functions";

export const Route = createFileRoute("/app/liberdade")({
  head: () => ({ meta: [{ title: "Liberdade Financeira · Abio" }] }),
  component: Page,
});
const BRL = (n: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n ?? 0);
const KIND: Record<string, string> = { cash: "Reserva/Caixa", investment: "Investimento", property: "Imóvel/Bem", other: "Outro" };

function Page() {
  const qc = useQueryClient();
  const list = useServerFn(getFreedomSnapshot);
  const save = useServerFn(upsertAsset);
  const del = useServerFn(deleteAsset);
  const q = useQuery({ queryKey: ["freedom"], queryFn: () => list() as any });
  const inv = () => qc.invalidateQueries({ queryKey: ["freedom"] });
  const mSave = useMutation({ mutationFn: (d: any) => save({ data: d }) as any, onSuccess: () => { inv(); setOpen(false); } });
  const mDel = useMutation({ mutationFn: (id: string) => del({ data: { id } }) as any, onSuccess: inv });
  const [open, setOpen] = useState(false);

  const d = q.data ?? { total_assets: 0, reserve: 0, reserve_target: 0, reserve_pct: 0, target_assets: 0, freedom_pct: 0, avg_income: 0, avg_expense: 0, assets: [], evolution: [] };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 grid place-items-center rounded-2xl border border-border bg-card/60"><Sparkles className="h-6 w-6 text-primary" /></div>
          <div><h1 className="font-display text-3xl">Liberdade Financeira</h1><p className="text-sm text-muted-foreground">Acompanhe seu patrimônio rumo à independência.</p></div>
        </div>
        <button onClick={() => setOpen(true)} className="inline-flex items-center gap-2 rounded-xl bg-gradient-brand text-primary-foreground px-4 py-2.5 text-sm glow-neon"><Plus className="h-4 w-4" /> Adicionar bem</button>
      </header>

      <section className="rounded-3xl border border-primary/30 bg-gradient-brand-soft p-6">
        <p className="text-xs uppercase tracking-wider text-primary">Sua liberdade financeira</p>
        <p className="font-display text-4xl mt-2">{d.freedom_pct}%</p>
        <p className="text-sm text-muted-foreground mt-1">Você alcançou {d.freedom_pct}% da sua liberdade financeira (meta: {BRL(d.target_assets)}).</p>
        <div className="h-3 mt-3 bg-background/60 rounded-full overflow-hidden">
          <div className="h-full bg-gradient-brand transition-all" style={{ width: `${Math.min(100, d.freedom_pct)}%` }} />
        </div>
      </section>

      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Patrimônio" value={BRL(d.total_assets)} />
        <Stat label="Reserva" value={BRL(d.reserve)} sub={`${d.reserve_pct}% da meta`} />
        <Stat label="Ganho médio/mês" value={BRL(d.avg_income)} />
        <Stat label="Gasto médio/mês" value={BRL(d.avg_expense)} />
      </div>

      {d.evolution.length > 0 && (
        <div className="rounded-3xl border border-border bg-card/60 p-5">
          <h2 className="font-display text-lg mb-3">Evolução patrimonial</h2>
          <ResponsiveContainer width="100%" height={220} debounce={200}>
            <LineChart data={d.evolution}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" />
              <YAxis stroke="hsl(var(--muted-foreground))" />
              <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} formatter={(v: any) => BRL(Number(v))} />
              <Line type="monotone" dataKey="total" stroke="hsl(var(--primary))" strokeWidth={2} dot />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="rounded-3xl border border-border bg-card/60 p-5">
        <h2 className="font-display text-lg mb-3">Patrimônio</h2>
        {d.assets.length === 0 ? <p className="text-sm text-muted-foreground">Cadastre seus bens para acompanhar a evolução.</p> :
          <div className="divide-y divide-border">
            {d.assets.map((a: any) => (
              <div key={a.id} className="py-3 flex items-center gap-3 text-sm">
                <div className="flex-1"><p>{a.label}</p><p className="text-xs text-muted-foreground">{KIND[a.kind] ?? a.kind} · {new Date(a.as_of + "T00:00:00").toLocaleDateString("pt-BR")}</p></div>
                <p className="font-medium">{BRL(Number(a.amount))}</p>
                <button onClick={() => mDel.mutate(a.id)} className="h-8 w-8 grid place-items-center rounded-lg border border-destructive/30 text-destructive hover:bg-destructive/10"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            ))}
          </div>
        }
      </div>

      {open && <Dialog onClose={() => setOpen(false)} onSave={(x: any) => mSave.mutate(x)} saving={mSave.isPending} />}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <div className="rounded-2xl border border-border bg-card/60 p-4"><p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p><p className="font-display text-xl mt-1">{value}</p>{sub && <p className="text-[11px] text-muted-foreground mt-1">{sub}</p>}</div>;
}

function Dialog({ onClose, onSave, saving }: any) {
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState("cash");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 grid place-items-center p-4">
      <div className="w-full max-w-md rounded-3xl border border-border bg-card p-6">
        <div className="flex items-center justify-between mb-4"><h3 className="font-display text-xl">Adicionar bem</h3><button onClick={onClose} className="h-8 w-8 grid place-items-center rounded-lg border border-border"><X className="h-4 w-4" /></button></div>
        <div className="space-y-3">
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ex: Conta poupança, Tesouro Selic" className="w-full bg-input rounded-xl px-3 py-2.5 text-sm" />
          <select value={kind} onChange={(e) => setKind(e.target.value)} className="w-full bg-input rounded-xl px-3 py-2.5 text-sm">
            <option value="cash">Reserva/Caixa</option><option value="investment">Investimento</option><option value="property">Imóvel/Bem</option><option value="other">Outro</option>
          </select>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="Valor R$" className="w-full bg-input rounded-xl px-3 py-2.5 text-sm" />
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full bg-input rounded-xl px-3 py-2.5 text-sm" />
          <button disabled={!label || !amount || saving} onClick={() => onSave({ label, kind, amount: parseFloat(amount.replace(",", ".")), as_of: date })} className="w-full rounded-xl bg-gradient-brand text-primary-foreground py-2.5 glow-neon disabled:opacity-50">{saving ? "Salvando..." : "Salvar"}</button>
        </div>
      </div>
    </div>
  );
}
