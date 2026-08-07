import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import {
  Users,
  Activity,
  Wallet,
  TrendingUp,
  MessageCircle,
  Bot,
  ShieldAlert,
  ArrowUpRight,
} from "lucide-react";
import { KpiCard } from "@/components/brinzap/dashboard/KpiCard";
import { getExecutiveStats } from "@/lib/admin-executive.functions";

export const Route = createFileRoute("/admin/")({
  head: () => ({ meta: [{ title: "Dashboard executivo · Abio Admin" }, { name: "robots", content: "noindex" }] }),
  component: AdminDashboard,
});

function brl(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function AdminDashboard() {
  const run = useServerFn(getExecutiveStats);
  const { data, isLoading } = useQuery({
    queryKey: ["admin-executive"],
    queryFn: () => run() as any,
    refetchInterval: 60_000,
  });

  const k = data?.kpis ?? {
    total: 0, active: 0, blocked: 0, newWeek: 0, newMonth: 0,
    mrr: 0, arr: 0, msgs24: 0, msgs7: 0, msgs30: 0, aiHandled: 0, conversionRate: 0,
  };

  return (
    <div className="space-y-8">
      <motion.header
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="flex items-end justify-between flex-wrap gap-3"
      >
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-primary">Operação</p>
          <h1 className="font-display text-3xl mt-1">Dashboard executivo</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Pulso da plataforma Abio em tempo real.
          </p>
        </div>
        <span className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
          {isLoading ? "Carregando…" : "Atualizado agora"}
        </span>
      </motion.header>

      {/* KPIs principais */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Usuários ativos" value={String(k.active)} hint={`${k.conversionRate}% da base · ${k.total} total`} tone="brand" icon={Activity} delay={0.00} />
        <KpiCard label="Novos cadastros (30d)" value={String(k.newMonth)} hint={`+${k.newWeek} esta semana`} tone="income" icon={Users} delay={0.05} />
        <KpiCard label="Receita recorrente (MRR)" value={brl(k.mrr)} hint={`ARR ${brl(k.arr)}`} tone="brand" icon={Wallet} delay={0.10} />
        <KpiCard label="Mensagens (24h)" value={String(k.msgs24)} hint={`${k.msgs7} últimos 7d · ${k.aiHandled} via IA`} tone="neutral" icon={MessageCircle} delay={0.15} />
      </div>

      {/* Linha 2: secundárias */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Bloqueados" value={String(k.blocked)} tone={k.blocked > 0 ? "expense" : "neutral"} icon={ShieldAlert} delay={0.20} />
        <KpiCard label="IA processou (30d)" value={String(k.aiHandled)} hint="texto · áudio · imagem" tone="neutral" icon={Bot} delay={0.25} />
        <KpiCard label="Volume 30d" value={String(k.msgs30)} hint="mensagens totais" tone="neutral" icon={MessageCircle} delay={0.30} />
        <KpiCard label="Taxa de ativação" value={`${k.conversionRate}%`} hint="ativos / total" tone="brand" icon={TrendingUp} delay={0.35} />
      </div>

      {/* Gráficos */}
      <div className="grid lg:grid-cols-2 gap-5">
        <motion.section
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.4 }}
          className="rounded-3xl border border-border bg-card/60 backdrop-blur-xl p-5 shadow-card"
        >
          <header className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-display text-lg">Crescimento da plataforma</h2>
              <p className="text-xs text-muted-foreground">Novos cadastros nos últimos 30 dias</p>
            </div>
            <span className="text-xs text-primary inline-flex items-center gap-1">
              <TrendingUp className="h-3.5 w-3.5" /> +{k.newMonth}
            </span>
          </header>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data?.growth ?? []}>
                <defs>
                  <linearGradient id="growthGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="oklch(0.541 0.246 293)" stopOpacity={0.6} />
                    <stop offset="100%" stopColor="oklch(0.541 0.246 293)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(1 0 0 / 0.05)" />
                <XAxis dataKey="label" stroke="oklch(0.714 0.019 261.3)" fontSize={10} interval={3} />
                <YAxis stroke="oklch(0.714 0.019 261.3)" fontSize={10} allowDecimals={false} />
                <Tooltip contentStyle={{ background: "oklch(0.239 0.018 266.2)", border: "1px solid oklch(0.541 0.246 293 / 45%)", borderRadius: 12, color: "white" }} />
                <Area type="monotone" dataKey="novos" stroke="oklch(0.541 0.246 293)" strokeWidth={2} fill="url(#growthGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.5 }}
          className="rounded-3xl border border-border bg-card/60 backdrop-blur-xl p-5 shadow-card"
        >
          <header className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-display text-lg">Volume de mensagens</h2>
              <p className="text-xs text-muted-foreground">Recebidas vs enviadas — últimos 14 dias</p>
            </div>
          </header>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data?.volume ?? []}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(1 0 0 / 0.05)" />
                <XAxis dataKey="label" stroke="oklch(0.714 0.019 261.3)" fontSize={10} />
                <YAxis stroke="oklch(0.714 0.019 261.3)" fontSize={10} allowDecimals={false} />
                <Tooltip contentStyle={{ background: "oklch(0.239 0.018 266.2)", border: "1px solid oklch(0.541 0.246 293 / 45%)", borderRadius: 12, color: "white" }} />
                <Bar dataKey="in" name="Recebidas" fill="oklch(0.541 0.246 293)" radius={[6, 6, 0, 0]} />
                <Bar dataKey="out" name="Enviadas" fill="oklch(0.723 0.192 149.6)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </motion.section>
      </div>

      {/* Recentes */}
      <motion.section
        initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.6 }}
        className="rounded-3xl border border-border bg-card/60 backdrop-blur-xl p-5 shadow-card"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-lg">Últimos cadastros</h2>
          <Link to="/admin/users" className="text-xs text-primary inline-flex items-center gap-1 hover:underline">
            Gerenciar usuários <ArrowUpRight className="h-3 w-3" />
          </Link>
        </div>
        {(!data?.recent || data.recent.length === 0) ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Nenhum cadastro ainda.</p>
        ) : (
          <div className="divide-y divide-border">
            {data.recent.map((u: any) => (
              <Link
                key={u.id}
                to="/admin/users/$userId"
                params={{ userId: u.id }}
                className="flex items-center justify-between py-3 hover:bg-background/40 -mx-2 px-2 rounded-lg transition-smooth"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-9 w-9 rounded-full bg-gradient-brand grid place-items-center text-primary-foreground text-xs font-semibold">
                    {(u.plan || "U").slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{u.plan}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {new Date(u.created_at).toLocaleString("pt-BR")}
                    </p>
                  </div>
                </div>
                <span className={`text-[11px] px-2 py-0.5 rounded-full border ${u.status === "active" ? "border-primary/30 bg-primary/10 text-primary" : "border-destructive/40 bg-destructive/10 text-destructive"}`}>
                  {u.status === "active" ? "Ativo" : "Bloqueado"}
                </span>
              </Link>
            ))}
          </div>
        )}
      </motion.section>
    </div>
  );
}
