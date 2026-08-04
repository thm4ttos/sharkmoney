import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { PiggyBank, Plus, Trash2 } from "lucide-react";
import { listBudgets, upsertBudget, deleteBudget } from "@/lib/budgets.functions";

export const Route = createFileRoute("/app/orcamento")({
  head: () => ({ meta: [{ title: "Orçamento · Shark Money" }] }),
  component: Page,
});

const BRL = (n: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n ?? 0);

function Page() {
  const qc = useQueryClient();
  const run = useServerFn(listBudgets);
  const save = useServerFn(upsertBudget);
  const del = useServerFn(deleteBudget);
  const q = useQuery({ queryKey: ["budgets"], queryFn: () => run() as any });
  const inv = () => qc.invalidateQueries({ queryKey: ["budgets"] });
  const mSave = useMutation({ mutationFn: (d: any) => save({ data: d }) as any, onSuccess: inv });
  const mDel = useMutation({ mutationFn: (id: string) => del({ data: { id } }) as any, onSuccess: inv });

  const [cat, setCat] = useState("");
  const [amount, setAmount] = useState("");

  const budgets: any[] = q.data?.budgets ?? [];

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <header className="flex items-center gap-4">
        <div className="h-14 w-14 grid place-items-center rounded-2xl border border-border bg-card/60"><PiggyBank className="h-6 w-6 text-primary" /></div>
        <div>
          <h1 className="font-display text-3xl">Orçamento</h1>
          <p className="text-sm text-muted-foreground">Defina limites mensais e acompanhe o consumo em tempo real.</p>
        </div>
      </header>

      <section className="rounded-3xl border border-border bg-card/60 p-5 space-y-3">
        <h2 className="font-display text-lg">Adicionar orçamento</h2>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_180px_auto] gap-2">
          <input value={cat} onChange={(e) => setCat(e.target.value)} placeholder="Categoria (vazio = mensal global)" className="bg-input rounded-xl px-3 py-2.5 text-sm" />
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="Valor R$" className="bg-input rounded-xl px-3 py-2.5 text-sm" />
          <button
            disabled={!amount || mSave.isPending}
            onClick={() => { mSave.mutate({ category: cat || null, amount: parseFloat(amount.replace(",", ".")) }); setCat(""); setAmount(""); }}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-brand text-primary-foreground px-4 py-2.5 text-sm glow-neon disabled:opacity-50"
          ><Plus className="h-4 w-4" /> Salvar</button>
        </div>
      </section>

      {q.isLoading ? (
        <div className="h-40 rounded-3xl bg-card/40 animate-pulse" />
      ) : budgets.length === 0 ? (
        <div className="rounded-3xl border border-border bg-card/40 p-12 text-center">
          <PiggyBank className="h-10 w-10 text-primary mx-auto mb-3" />
          <p className="font-display text-xl">Nenhum orçamento ainda</p>
          <p className="text-sm text-muted-foreground mt-1">Crie um teto mensal global ou por categoria.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {budgets.map((b) => {
            const over = b.pct >= 100;
            const warn = b.pct >= 80 && !over;
            return (
              <div key={b.id} className="rounded-2xl border border-border bg-card/60 p-4">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="font-medium">{b.category ?? "Orçamento mensal (total)"}</p>
                    <p className="text-xs text-muted-foreground">{BRL(b.spent)} de {BRL(b.amount)} · {b.pct}% consumido</p>
                  </div>
                  <button onClick={() => mDel.mutate(b.id)} className="h-8 w-8 grid place-items-center rounded-lg border border-destructive/30 text-destructive hover:bg-destructive/10"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
                <div className="h-2 bg-background/60 rounded-full overflow-hidden">
                  <div className={["h-full transition-all", over ? "bg-destructive" : warn ? "bg-amber-500" : "bg-gradient-brand"].join(" ")} style={{ width: `${Math.min(100, b.pct)}%` }} />
                </div>
                <p className="text-[11px] mt-2 text-muted-foreground">
                  {b.remaining >= 0 ? `Disponível: ${BRL(b.remaining)}` : `Estouro: ${BRL(Math.abs(b.remaining))}`}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
