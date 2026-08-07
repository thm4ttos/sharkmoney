import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { Wallet, TrendingUp, Users, AlertTriangle, Crown, Search } from "lucide-react";
import { KpiCard } from "@/components/brinzap/dashboard/KpiCard";
import { getFinanceStats } from "@/lib/admin-finance.functions";

export const Route = createFileRoute("/admin/financeiro")({
  head: () => ({ meta: [{ title: "Financeiro · Abio Admin" }, { name: "robots", content: "noindex" }] }),
  component: Page,
});

const COLORS = [
  "oklch(0.541 0.246 293)",
  "oklch(0.723 0.192 149.6)",
  "oklch(0.861 0.173 91.9)",
  "oklch(0.637 0.208 25.3)",
  "oklch(0.72 0.16 293)",
];

function brl(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function Page() {
  const run = useServerFn(getFinanceStats);
  const { data, isLoading } = useQuery({
    queryKey: ["admin-finance"],
    queryFn: () => run() as any,
    refetchInterval: 120_000,
  });

  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "blocked">("all");

  const k = data?.kpis ?? {
    activeCount: 0, payingCount: 0, trialCount: 0, blockedCount: 0,
    mrr: 0, arr: 0, retention: 0, expiringTrials: 0,
  };

  const subs = useMemo(() => {
    const list = (data?.subscribers ?? []) as any[];
    const term = q.trim().toLowerCase();
    return list.filter((s) => {
      if (statusFilter !== "all" && s.status !== statusFilter) return false;
      if (!term) return true;
      return [s.name, s.email, s.phone, s.plan]
        .filter(Boolean)
        .some((v: string) => String(v).toLowerCase().includes(term));
    });
  }, [data, q, statusFilter]);

  return (
    <div className="space-y-8">
      <motion.header
        initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
        className="flex items-end justify-between flex-wrap gap-3"
      >
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 grid place-items-center rounded-2xl border border-primary/30 bg-gradient-brand-soft text-primary">
            <Wallet className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-primary">Finance</p>
            <h1 className="font-display text-3xl mt-1">Central Financeira</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Receita, assinantes, retenção e top contas.
            </p>
          </div>
        </div>
        <span className="text-xs text-muted-foreground">{isLoading ? "Carregando…" : "Atualizado"}</span>
      </motion.header>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="MRR" value={brl(k.mrr)} hint={`ARR ${brl(k.arr)}`} tone="brand" icon={Wallet} delay={0} />
        <KpiCard label="Assinantes pagantes" value={String(k.payingCount)} hint={`${k.trialCount} em trial`} tone="income" icon={Users} delay={0.05} />
        <KpiCard label="Taxa de retenção" value={`${k.retention}%`} hint="ativos / total" tone="brand" icon={TrendingUp} delay={0.10} />
        <KpiCard label="Trials vencendo (7d)" value={String(k.expiringTrials)} tone={k.expiringTrials > 0 ? "expense" : "neutral"} icon={AlertTriangle} delay={0.15} />
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        <motion.section
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.2 }}
          className="lg:col-span-2 rounded-3xl border border-border bg-card/60 backdrop-blur-xl p-5 shadow-card"
        >
          <header className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-display text-lg">Receita estimada (6 meses)</h2>
              <p className="text-xs text-muted-foreground">Projeção baseada em planos ativos por mês</p>
            </div>
          </header>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data?.monthly ?? []}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(1 0 0 / 0.05)" />
                <XAxis dataKey="label" stroke="oklch(0.714 0.019 261.3)" fontSize={11} />
                <YAxis stroke="oklch(0.714 0.019 261.3)" fontSize={11} tickFormatter={(v) => `R$${v}`} />
                <Tooltip
                  formatter={(v: any) => brl(Number(v))}
                  contentStyle={{ background: "oklch(0.239 0.018 266.2)", border: "1px solid oklch(0.541 0.246 293 / 45%)", borderRadius: 12, color: "white" }}
                />
                <Line type="monotone" dataKey="receita" stroke="oklch(0.541 0.246 293)" strokeWidth={3} dot={{ r: 4, fill: "oklch(0.541 0.246 293)" }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.25 }}
          className="rounded-3xl border border-border bg-card/60 backdrop-blur-xl p-5 shadow-card"
        >
          <h2 className="font-display text-lg mb-2">Distribuição por plano</h2>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data?.byPlan ?? []}
                  dataKey="count"
                  nameKey="plan"
                  cx="50%"
                  cy="50%"
                  innerRadius={45}
                  outerRadius={75}
                  paddingAngle={2}
                >
                  {(data?.byPlan ?? []).map((_: any, i: number) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ background: "oklch(0.239 0.018 266.2)", border: "1px solid oklch(0.541 0.246 293 / 45%)", borderRadius: 12, color: "white" }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </motion.section>
      </div>

      <motion.section
        initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.3 }}
        className="rounded-3xl border border-border bg-card/60 backdrop-blur-xl p-5 shadow-card"
      >
        <h2 className="font-display text-lg mb-4 inline-flex items-center gap-2">
          <Crown className="h-4 w-4 text-primary" /> Top contas por valor
        </h2>
        {(data?.top ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">Sem assinantes pagantes ainda.</p>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {(data?.top ?? []).map((t: any, i: number) => (
              <div key={t.id} className="rounded-2xl border border-border bg-background/40 p-3">
                <p className="text-[10px] text-muted-foreground">#{i + 1}</p>
                <p className="text-sm font-medium truncate">{t.name}</p>
                <p className="text-xs text-muted-foreground truncate">{t.plan}</p>
                <p className="font-display text-lg text-primary mt-1">{brl(t.value)}/mo</p>
              </div>
            ))}
          </div>
        )}
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.35 }}
        className="rounded-3xl border border-border bg-card/60 backdrop-blur-xl p-5 shadow-card"
      >
        <header className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <h2 className="font-display text-lg">Assinantes</h2>
          <div className="flex items-center gap-2">
            {(["all", "active", "blocked"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={[
                  "px-3 py-1.5 rounded-xl text-xs border transition-smooth",
                  statusFilter === s ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-background/40 text-muted-foreground hover:text-foreground",
                ].join(" ")}
              >
                {s === "all" ? "Todos" : s === "active" ? "Ativos" : "Bloqueados"}
              </button>
            ))}
            <div className="relative">
              <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar nome, email, telefone…"
                className="pl-7 pr-3 py-1.5 text-xs rounded-xl border border-border bg-background/40 w-56"
              />
            </div>
          </div>
        </header>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border">
                <th className="py-2 pr-3">Cliente</th>
                <th className="py-2 pr-3">Plano</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Valor (mês)</th>
                <th className="py-2 pr-3">Trial até</th>
                <th className="py-2 pr-3">Desde</th>
              </tr>
            </thead>
            <tbody>
              {subs.length === 0 ? (
                <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">Nenhum resultado.</td></tr>
              ) : subs.map((s: any) => (
                <tr key={s.id} className="border-b border-border/40 hover:bg-background/30">
                  <td className="py-2 pr-3">
                    <p className="font-medium truncate">{s.name || "—"}</p>
                    <p className="text-[11px] text-muted-foreground font-mono">{s.phone}</p>
                  </td>
                  <td className="py-2 pr-3">{s.plan}</td>
                  <td className="py-2 pr-3">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] border ${s.status === "active" ? "border-primary/30 bg-primary/10 text-primary" : "border-destructive/40 bg-destructive/10 text-destructive"}`}>
                      {s.status === "active" ? "Ativo" : "Bloqueado"}
                    </span>
                  </td>
                  <td className="py-2 pr-3 font-medium">{brl(s.value)}</td>
                  <td className="py-2 pr-3 text-muted-foreground">{s.trial_ends_at ? new Date(s.trial_ends_at).toLocaleDateString("pt-BR") : "—"}</td>
                  <td className="py-2 pr-3 text-muted-foreground">{new Date(s.created_at).toLocaleDateString("pt-BR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </motion.section>
    </div>
  );
}
