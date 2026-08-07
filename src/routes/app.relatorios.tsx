import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { FileBarChart2, Download, FileSpreadsheet } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from "recharts";
import { getReport } from "@/lib/reports.functions";

export const Route = createFileRoute("/app/relatorios")({
  head: () => ({ meta: [{ title: "Relatórios · Abio" }] }),
  component: Page,
});
const BRL = (n: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n ?? 0);

function Page() {
  const run = useServerFn(getReport);
  const [period, setPeriod] = useState<"all" | "month" | "quarter" | "year">("all");
  const m = useMutation<any>({ mutationFn: () => run({ data: { period } }) as any });
  const r: any = m.data;

  const exportXlsx = async () => {
    if (!r) return;
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.json_to_sheet(r.transactions.map((t: any) => ({
      Data: t.occurred_at.slice(0, 10), Tipo: t.kind, Categoria: t.category, Descrição: t.description, Valor: t.amount,
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Transações");
    XLSX.writeFile(wb, `abio-${r.label}.xlsx`);
  };

  const exportPdf = async () => {
    if (!r) return;
    const { default: jsPDF } = await import("jspdf");
    const { default: autoTable } = await import("jspdf-autotable");
    const doc = new jsPDF();
    doc.text(`Relatório Abio · ${r.label}`, 14, 16);
    doc.setFontSize(10);
    doc.text(`Receita: ${BRL(r.income)}   Despesa: ${BRL(r.expense)}   Saldo: ${BRL(r.balance)}`, 14, 24);
    autoTable(doc, {
      startY: 30,
      head: [["Data", "Tipo", "Categoria", "Descrição", "Valor"]],
      body: r.transactions.map((t: any) => [t.occurred_at.slice(0, 10), t.kind, t.category, t.description ?? "", BRL(t.amount)]),
    });
    doc.save(`abio-${r.label}.pdf`);
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <header className="flex items-center gap-4">
        <div className="h-14 w-14 grid place-items-center rounded-2xl border border-border bg-card/60"><FileBarChart2 className="h-6 w-6 text-primary" /></div>
        <div><h1 className="font-display text-3xl">Relatórios</h1><p className="text-sm text-muted-foreground">Gere e exporte relatórios financeiros.</p></div>
      </header>

      <div className="rounded-3xl border border-border bg-card/60 p-5 space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[180px]">
            <label className="text-xs text-muted-foreground">Período</label>
            <select value={period} onChange={(e) => setPeriod(e.target.value as any)} className="mt-1 w-full bg-input rounded-xl px-3 py-2.5 text-sm">
              <option value="all">Histórico completo</option><option value="month">Mensal</option><option value="quarter">Trimestral</option><option value="year">Anual</option>
            </select>
          </div>
          <button onClick={() => m.mutate()} disabled={m.isPending} className="rounded-xl bg-gradient-brand text-primary-foreground px-4 py-2.5 text-sm glow-neon disabled:opacity-50">
            {m.isPending ? "Gerando..." : "Gerar relatório"}
          </button>
          {r && <>
            <button onClick={exportPdf} className="inline-flex items-center gap-2 rounded-xl border border-border bg-background/40 px-3 py-2.5 text-sm hover:border-primary/40"><Download className="h-4 w-4" /> PDF</button>
            <button onClick={exportXlsx} className="inline-flex items-center gap-2 rounded-xl border border-border bg-background/40 px-3 py-2.5 text-sm hover:border-primary/40"><FileSpreadsheet className="h-4 w-4" /> Excel</button>
          </>}
        </div>
      </div>

      {r && (
        <>
          <div className="grid md:grid-cols-3 gap-3">
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4"><p className="text-xs text-muted-foreground">Receita</p><p className="font-display text-2xl mt-1 text-emerald-300">{BRL(r.income)}</p></div>
            <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4"><p className="text-xs text-muted-foreground">Despesa</p><p className="font-display text-2xl mt-1 text-rose-300">{BRL(r.expense)}</p></div>
            <div className="rounded-2xl border border-primary/30 bg-gradient-brand-soft p-4"><p className="text-xs text-muted-foreground">Saldo</p><p className="font-display text-2xl mt-1">{BRL(r.balance)}</p></div>
          </div>

          {r.series.length > 0 && (
            <div className="rounded-3xl border border-border bg-card/60 p-5">
              <h2 className="font-display text-lg mb-3">Evolução</h2>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={r.series}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" />
                  <YAxis stroke="hsl(var(--muted-foreground))" />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} formatter={(v: any) => BRL(Number(v))} />
                  <Legend />
                  <Bar dataKey="receita" fill="hsl(var(--primary))" name="Receita" />
                  <Bar dataKey="despesa" fill="#f43f5e" name="Despesa" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {r.categories.length > 0 && (
            <div className="rounded-3xl border border-border bg-card/60 p-5">
              <h2 className="font-display text-lg mb-3">Despesas por categoria</h2>
              <div className="space-y-2">
                {r.categories.map((c: any) => (
                  <div key={c.category} className="flex justify-between text-sm border-b border-border py-2"><span>{c.category}</span><span className="font-medium">{BRL(c.total)}</span></div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
