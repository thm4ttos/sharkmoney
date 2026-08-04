import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  ResponsiveContainer,
  LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
  PieChart, Pie, Cell,
  BarChart, Bar,
  AreaChart, Area,
} from "recharts";
import {
  TrendingUp, TrendingDown, Wallet, PiggyBank, ArrowUpRight, ArrowDownRight,
  Sparkles, Activity, CalendarClock, Bell, Target, Flame, MessageCircle,
  Receipt, CreditCard, AlertTriangle, CheckCircle2, Info, Trophy, Hash, Layers,
} from "lucide-react";
import { getDashboardStats, type DashboardRange } from "@/lib/dashboard.functions";
import { formatDayMonthSP } from "@/lib/datetime";
import { KpiCard } from "@/components/brinzap/dashboard/KpiCard";
import { SectionCard } from "@/components/brinzap/dashboard/SectionCard";
import { ClickableKpi, TxListPanel, BalancePanel, useKpiPopover } from "@/components/brinzap/dashboard/KpiPopover";
import { BalanceBreakdownDialog } from "@/components/brinzap/dashboard/BalanceBreakdownDialog";
import { PeriodFilter, usePeriodFilter, type PeriodValue } from "@/components/brinzap/dashboard/PeriodFilter";
import { useState } from "react";


export const Route = createFileRoute("/app/dashboard")({
  head: () => ({ meta: [{ title: "Central Financeira · Shark Money" }] }),
  component: DashboardPage,
});

const BRL = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n ?? 0);

const DONUT_COLORS = [
  "oklch(0.723 0.192 149.6)",
  "oklch(0.544 0.252 262.5)",
  "oklch(0.75 0.20 200)",
  "oklch(0.861 0.173 91.9)",
  "oklch(0.637 0.208 25.3)",
  "oklch(0.68 0.18 260)",
];

const TT = {
  background: "oklch(0.239 0.018 266.2)",
  border: "1px solid oklch(0.544 0.252 262.5 / 45%)",
  borderRadius: 12,
  color: "white",
};

function DashboardPage() {
  const run = useServerFn(getDashboardStats);
  const [period, setPeriod] = usePeriodFilter("all");
  const q = useQuery({
    queryKey: ["dashboard-stats-v2", period.range, period.start ?? null, period.end ?? null],
    queryFn: () => run({ data: { range: period.range, start: period.start, end: period.end } }) as any,
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
  });
  const d: any = q.data;
  const { openCard, toggle, close } = useKpiPopover();
  const [explainOpen, setExplainOpen] = useState(false);


  return (
    <div className="w-full max-w-full space-y-6">
      <BalanceBreakdownDialog
        open={explainOpen}
        onClose={() => setExplainOpen(false)}
        from={period.start}
        to={period.end}
      />
      <motion.header
        initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
        className="w-full flex flex-col gap-4 md:flex-row md:items-end md:justify-between"
      >
        <div className="w-full min-w-0 text-center md:text-left">
          <p className="text-[11px] uppercase tracking-[0.25em] text-primary inline-flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 shrink-0" /> Visão inteligente
          </p>
          <h1
            className="font-display mt-1 tracking-tight leading-[1.08]"
            style={{ fontSize: "clamp(1.85rem, 8vw, 2.25rem)" }}
          >
            Central <span className="text-gradient-brand">Financeira</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-2 mx-auto md:mx-0 max-w-md">
            Acompanhe sua vida financeira em tempo real com inteligência artificial.
          </p>
        </div>
        <div className="w-full min-w-0 flex flex-col gap-2 md:w-auto md:items-end">
          <PeriodFilter
            value={period}
            onChange={setPeriod}
            align="center"
            className="w-full justify-between min-h-[44px] md:w-auto md:justify-center"
          />
          {d ? (
            <div className="grid w-full grid-cols-1 min-[360px]:grid-cols-2 gap-2 md:flex md:w-auto md:flex-wrap md:justify-end">
              <Pill icon={Flame} tone="accent">{d.streak} dias seguidos</Pill>
              <Pill icon={PiggyBank} tone="primary">Economia {Math.round(d.savingsRate * 100)}%</Pill>
              <Pill icon={Hash} tone="emerald" full>{d.transactionCount} lançamentos</Pill>
            </div>
          ) : null}
        </div>
      </motion.header>



      {q.isLoading || !d ? (
        <SkeletonGrid />
      ) : (
        <>
          {/* KPIs principais — Histórico completo por padrão */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <ClickableKpi open={openCard === "balance"} onToggle={() => toggle("balance")} onClose={close} panel={<BalancePanel d={d} onClose={close} onExplain={() => setExplainOpen(true)} />}>
              <KpiCard label="Saldo atual" value={BRL(d.balance)} hint={d.balance >= 0 ? "Histórico completo" : "Saldo acumulado negativo"} tone="brand" icon={Wallet} delay={0.0} />
            </ClickableKpi>
            <ClickableKpi open={openCard === "income"} onToggle={() => toggle("income")} onClose={close} panel={<TxListPanel title="💰 Últimas receitas" kind="income" items={d.recentIncome ?? []} onClose={close} />}>
              <KpiCard label="Receitas totais" value={BRL(d.income)} hint="Histórico completo" tone="income" icon={ArrowUpRight} delay={0.05} />
            </ClickableKpi>
            <ClickableKpi open={openCard === "expense"} onToggle={() => toggle("expense")} onClose={close} panel={<TxListPanel title="💸 Últimas despesas" kind="expense" items={d.recentExpense ?? []} onClose={close} />}>
              <KpiCard label="Despesas totais" value={BRL(d.expense)} hint="Histórico completo" tone="expense" icon={ArrowDownRight} delay={0.10} />
            </ClickableKpi>
            <KpiCard label="Economia (%)" value={`${Math.round(d.savingsRate * 100)}%`} hint="da sua renda" tone="neutral" icon={PiggyBank} delay={0.15} />
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard label="Lançamentos" value={String(d.transactionCount)} hint="Total registrado" tone="neutral" icon={Activity} delay={0.18} />
            <KpiCard label="Média diária" value={BRL(d.dailyAvgExpense)} hint="de despesas no período" tone="expense" icon={TrendingDown} delay={0.21} />
            <KpiCard
              label="Meta principal"
              value={d.primaryGoal ? `${Math.round(d.primaryGoal.progress * 100)}%` : "—"}
              hint={d.primaryGoal?.title ?? "Crie sua primeira meta"}
              tone="brand" icon={Target} delay={0.24}
            />
            <KpiCard
              label="Maior categoria"
              value={d.topCategories?.[0]?.category ?? "—"}
              hint={d.topCategories?.[0] ? BRL(d.topCategories[0].total) : "Histórico completo"}
              tone="neutral"
              icon={TrendingUp} delay={0.27}
            />
          </div>

          {/* Análise IA */}
          <SectionCard title="Análise financeira" subtitle="Resumo inteligente com base nos seus dados" delay={0.3}>
            {d.insights.length === 0 ? (
              <Empty msg="Registre algumas movimentações para a IA gerar análises personalizadas." />
            ) : (
              <ul className="grid sm:grid-cols-2 gap-3">
                {d.insights.map((i: any, k: number) => {
                  const Icon = i.tone === "good" ? CheckCircle2 : i.tone === "warn" ? AlertTriangle : Info;
                  const map = {
                    good: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
                    warn: "border-amber-500/30 bg-amber-500/10 text-amber-300",
                    info: "border-primary/30 bg-primary/10 text-primary",
                  } as const;
                  return (
                    <motion.li
                      key={k} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 + k * 0.04 }}
                      className={`rounded-2xl border p-3 flex items-start gap-3 ${map[i.tone as keyof typeof map]}`}
                    >
                      <Icon className="h-4 w-4 mt-0.5 shrink-0" />
                      <p className="text-sm text-foreground/95">{i.text}</p>
                    </motion.li>
                  );
                })}
              </ul>
            )}
          </SectionCard>

          {/* Gráficos principais */}
          <div className="grid lg:grid-cols-[1.4fr_1fr] gap-4">
            <ChartWithPeriod title="Receita x Despesa" globalPeriod={period} delay={0.35}>
              {(cd) => cd.series.every((s: any) => s.receita === 0 && s.despesa === 0) ? (
                <Empty msg="Os gráficos serão exibidos após seus primeiros lançamentos." />
              ) : (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={cd.series} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="oklch(1 0 0 / 0.06)" />
                      <XAxis dataKey="label" stroke="oklch(0.714 0.019 261.3)" fontSize={11} />
                      <YAxis stroke="oklch(0.714 0.019 261.3)" fontSize={11} tickFormatter={(v) => `R$${Math.round(v / 1000)}k`} />
                      <Tooltip contentStyle={TT} formatter={(v: any) => BRL(Number(v))} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Line type="monotone" dataKey="receita" stroke="oklch(0.723 0.192 149.6)" strokeWidth={3} dot={{ r: 3 }} name="Receita" />
                      <Line type="monotone" dataKey="despesa" stroke="oklch(0.637 0.208 25.3)" strokeWidth={3} dot={{ r: 3 }} name="Despesa" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </ChartWithPeriod>

            <ChartWithPeriod title="Gastos por categoria" globalPeriod={period} delay={0.4}>
              {(cd) => cd.topCategories.length === 0 ? (
                <Empty msg="Nenhuma despesa registrada no período." />
              ) : (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={cd.topCategories} dataKey="total" nameKey="category" innerRadius={55} outerRadius={95} paddingAngle={2}>
                        {cd.topCategories.map((_: any, i: number) => (
                          <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} stroke="transparent" />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={TT} formatter={(v: any) => BRL(Number(v))} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </ChartWithPeriod>
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <ChartWithPeriod title="Evolução do saldo" globalPeriod={period} delay={0.42}>
              {(cd) => (
                <div className="h-60">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={cd.balanceSeries} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                      <defs>
                        <linearGradient id="saldoFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="oklch(0.544 0.252 262.5)" stopOpacity={0.5} />
                          <stop offset="100%" stopColor="oklch(0.544 0.252 262.5)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="oklch(1 0 0 / 0.06)" />
                      <XAxis dataKey="label" stroke="oklch(0.714 0.019 261.3)" fontSize={11} />
                      <YAxis stroke="oklch(0.714 0.019 261.3)" fontSize={11} tickFormatter={(v) => `R$${Math.round(v / 1000)}k`} />
                      <Tooltip contentStyle={TT} formatter={(v: any) => BRL(Number(v))} />
                      <Area type="monotone" dataKey="saldo" stroke="oklch(0.544 0.252 262.5)" strokeWidth={2.5} fill="url(#saldoFill)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </ChartWithPeriod>

            <ChartWithPeriod title="Entradas x Saídas" globalPeriod={period} delay={0.45}>
              {(cd) => (
                <div className="h-60">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={cd.weekly} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="oklch(1 0 0 / 0.06)" />
                      <XAxis dataKey="label" stroke="oklch(0.714 0.019 261.3)" fontSize={11} />
                      <YAxis stroke="oklch(0.714 0.019 261.3)" fontSize={11} tickFormatter={(v) => `R$${Math.round(v)}`} />
                      <Tooltip contentStyle={TT} formatter={(v: any) => BRL(Number(v))} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="entrada" fill="oklch(0.723 0.192 149.6)" radius={[6, 6, 0, 0]} name="Entradas" />
                      <Bar dataKey="saida" fill="oklch(0.637 0.208 25.3)" radius={[6, 6, 0, 0]} name="Saídas" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </ChartWithPeriod>
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <ChartWithPeriod title="Comparativo entre períodos" subtitle="Período atual vs período anterior" globalPeriod={period} delay={0.48}>
              {(cd) => (
                <div className="h-60">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={cd.comparison} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="oklch(1 0 0 / 0.06)" />
                      <XAxis dataKey="label" stroke="oklch(0.714 0.019 261.3)" fontSize={11} />
                      <YAxis stroke="oklch(0.714 0.019 261.3)" fontSize={11} tickFormatter={(v) => `R$${Math.round(v / 1000)}k`} />
                      <Tooltip contentStyle={TT} formatter={(v: any) => BRL(Number(v))} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="receita" fill="oklch(0.723 0.192 149.6)" radius={[8, 8, 0, 0]} name="Receita" />
                      <Bar dataKey="despesa" fill="oklch(0.637 0.208 25.3)" radius={[8, 8, 0, 0]} name="Despesa" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </ChartWithPeriod>

            <ChartWithPeriod title="Top 5 categorias" globalPeriod={period} delay={0.51}>
              {(cd) => cd.topCategories.length === 0 ? (
                <Empty msg="Sem despesas registradas no período." />
              ) : (
                <ol className="space-y-3">
                  {cd.topCategories.slice(0, 5).map((c: any, i: number) => {
                    const max = cd.topCategories[0].total || 1;
                    const pct = (c.total / max) * 100;
                    return (
                      <li key={c.category} className="space-y-1.5">
                        <div className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2">
                            <span className="h-6 w-6 grid place-items-center rounded-lg text-[11px] font-display border border-border bg-background/40">{i + 1}º</span>
                            <span className="font-medium">{c.category}</span>
                          </div>
                          <span className="text-muted-foreground">{BRL(c.total)}</span>
                        </div>
                        <div className="h-2 rounded-full bg-background/40 overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.8, delay: 0.5 + i * 0.05 }}
                            className="h-full rounded-full"
                            style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </ChartWithPeriod>
          </div>


          {/* Lembretes + Insights automáticos */}
          <div className="grid lg:grid-cols-3 gap-4">
            <SectionCard title="Próximos vencimentos" subtitle="Contas dos próximos dias" delay={0.54}>
              {d.upcomingBills.length === 0 ? (
                <Empty msg="Sem contas próximas a vencer." />
              ) : (
                <ul className="space-y-2">
                  {d.upcomingBills.map((b: any) => (
                    <li key={b.id} className="flex items-center gap-3 p-3 rounded-xl border border-border bg-background/30">
                      <div className="h-9 w-9 grid place-items-center rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-300">
                        <Receipt className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{b.title}</p>
                        <p className="text-[11px] text-muted-foreground">{new Date(b.due).toLocaleDateString("pt-BR")} · {b.category}</p>
                      </div>
                      <span className="text-sm font-display">{BRL(b.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>

            <SectionCard title="Próximos compromissos" subtitle="Agenda" delay={0.57}>
              {d.appointments.length === 0 ? (
                <Empty msg="Sem compromissos agendados." />
              ) : (
                <ul className="space-y-2">
                  {d.appointments.map((a: any) => (
                    <li key={a.id} className="flex items-center gap-3 p-3 rounded-xl border border-border bg-background/30">
                      <div className="h-9 w-9 grid place-items-center rounded-lg border border-primary/30 bg-primary/10 text-primary">
                        <CalendarClock className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{a.title}</p>
                        <p className="text-[11px] text-muted-foreground">{new Date(a.scheduled_at).toLocaleString("pt-BR")}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>

            <SectionCard title="Alertas ativos" subtitle="Dívidas e parcelas" delay={0.6}>
              <div className="space-y-3">
                <AlertRow
                  icon={CreditCard} tone="rose"
                  title={`${d.debtsCount} dívida(s) em aberto`}
                  value={BRL(d.debtTotal)}
                  empty="Sem dívidas pendentes 🎉"
                  show={d.debtsCount > 0}
                />
                <AlertRow
                  icon={Layers} tone="primary"
                  title={`${d.installmentsCount} compra(s) parcelada(s)`}
                  value={BRL(d.installmentsRemainingValue)}
                  empty="Nenhuma compra parcelada ativa."
                  show={d.installmentsCount > 0}
                />
                {d.installments.slice(0, 3).map((i: any) => (
                  <div key={i.id} className="rounded-xl border border-border bg-background/30 p-3">
                    <div className="flex justify-between text-xs">
                      <span className="truncate">{i.title}</span>
                      <span className="text-muted-foreground">{i.paid}/{i.of}</span>
                    </div>
                    <div className="mt-1.5 h-1.5 rounded-full bg-background/40 overflow-hidden">
                      <div className="h-full bg-gradient-brand" style={{ width: `${(i.paid / i.of) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>
          </div>

          {/* Meta + Performance + WhatsApp */}
          <div className="grid lg:grid-cols-3 gap-4">
            <SectionCard title="Meta financeira" subtitle="Progresso atual" delay={0.63}>
              {!d.primaryGoal ? (
                <Empty msg='Crie sua primeira meta em "Metas".' />
              ) : (
                <div className="space-y-4">
                  <div>
                    <p className="text-sm font-medium">{d.primaryGoal.title}</p>
                    {d.primaryGoal.target_date && (
                      <p className="text-[11px] text-muted-foreground">Até {new Date(d.primaryGoal.target_date).toLocaleDateString("pt-BR")}</p>
                    )}
                  </div>
                  <div className="flex items-end justify-between">
                    <span className="font-display text-3xl text-gradient-brand">{Math.round(d.primaryGoal.progress * 100)}%</span>
                    <span className="text-xs text-muted-foreground">{BRL(d.primaryGoal.current)} / {BRL(d.primaryGoal.target)}</span>
                  </div>
                  <div className="h-3 rounded-full bg-background/40 overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }} animate={{ width: `${Math.min(100, d.primaryGoal.progress * 100)}%` }}
                      transition={{ duration: 1, delay: 0.6 }}
                      className="h-full bg-gradient-brand rounded-full"
                    />
                  </div>
                  <Link to="/app/metas" className="inline-block text-xs text-primary hover:underline">Ver todas as metas →</Link>
                </div>
              )}
            </SectionCard>

            <SectionCard title="Performance" subtitle="Seus números gerais" delay={0.66}>
              <ul className="grid grid-cols-2 gap-3 text-sm">
                <PerfItem icon={Flame} label="Dias consecutivos" value={`${d.streak}`} />
                <PerfItem icon={PiggyBank} label="Taxa de economia" value={`${Math.round(d.savingsRate * 100)}%`} />
                <PerfItem icon={Trophy} label="Melhor mês" value={d.bestMonth?.label ?? "—"} hint={d.bestMonth ? BRL(d.bestMonth.savings) : undefined} />
                <PerfItem icon={Layers} label="Categoria top" value={d.mostUsedCategory ?? "—"} />
                <PerfItem icon={Hash} label="Lançamentos" value={`${d.transactionCount}`} />
                <PerfItem icon={Activity} label="Período" value={d.rangeLabel ?? "Histórico completo"} />
              </ul>
            </SectionCard>

            <SectionCard title="Resumo WhatsApp" subtitle="Atividade recente" delay={0.69}>
              <ul className="space-y-3 text-sm">
                <li className="flex items-center justify-between">
                  <span className="text-muted-foreground inline-flex items-center gap-2"><MessageCircle className="h-4 w-4" /> Mensagens (30d)</span>
                  <span className="font-display">{d.whatsapp.msgsLast30d}</span>
                </li>
                <WaRow label="Última recebida" content={d.whatsapp.lastIn?.content} when={d.whatsapp.lastIn?.created_at} />
                <WaRow label="Última receita" content={d.lastIncome ? `${d.lastIncome.description ?? d.lastIncome.category} · ${BRL(Number(d.lastIncome.amount))}` : null} when={d.lastIncome?.occurred_at} />
                <WaRow label="Última despesa" content={d.lastExpense ? `${d.lastExpense.description ?? d.lastExpense.category} · ${BRL(Number(d.lastExpense.amount))}` : null} when={d.lastExpense?.occurred_at} />
                <WaRow label="Última IA" content={d.whatsapp.lastAi?.ai_intent ? `Intent: ${d.whatsapp.lastAi.ai_intent}` : null} when={d.whatsapp.lastAi?.created_at} />
              </ul>
            </SectionCard>
          </div>

          {/* Últimos lançamentos */}
          <SectionCard title="Últimos lançamentos" subtitle="Movimentações mais recentes" delay={0.72}>
            {d.recent.length === 0 ? (
              <Empty msg="Envie sua primeira mensagem no WhatsApp para registrar uma movimentação." />
            ) : (
              <ul className="divide-y divide-border">
                {d.recent.map((t: any, i: number) => {
                  const isIn = t.kind === "income";
                  return (
                    <motion.li
                      key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.7 + i * 0.03 }}
                      className="py-3 flex items-center gap-3 hover:bg-background/30 -mx-2 px-2 rounded-xl transition-smooth"
                    >
                      <div className={`h-10 w-10 grid place-items-center rounded-xl border ${isIn ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-rose-500/30 bg-rose-500/10 text-rose-300"}`}>
                        {isIn ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{t.description ?? t.category}</p>
                        <p className="text-[11px] text-muted-foreground">{t.category} · {formatDayMonthSP(t.occurred_at)}</p>
                      </div>
                      <p className={`font-display text-sm ${isIn ? "text-emerald-300" : "text-rose-300"}`}>
                        {isIn ? "+" : "−"} {BRL(Number(t.amount))}
                      </p>
                    </motion.li>
                  );
                })}
              </ul>
            )}
          </SectionCard>
        </>
      )}
    </div>
  );
}

/**
 * ChartWithPeriod — Wraps a chart in a SectionCard with its own optional period override.
 * If no override is selected, it uses the global dashboard data (avoids extra requests).
 * If an override is set, it runs its own scoped `getDashboardStats` query.
 */
function ChartWithPeriod({
  title,
  subtitle,
  globalPeriod,
  delay,
  children,
}: {
  title: string;
  subtitle?: string;
  globalPeriod: PeriodValue;
  delay?: number;
  children: (data: any) => React.ReactNode;
}) {
  const [override, setOverride] = useState<PeriodValue | null>(null);
  const effective = override ?? globalPeriod;
  const run = useServerFn(getDashboardStats);
  const q = useQuery({
    queryKey: ["dashboard-stats-v2", "chart", effective.range, effective.start ?? null, effective.end ?? null],
    queryFn: () => run({ data: { range: effective.range, start: effective.start, end: effective.end } }) as any,
    placeholderData: (prev) => prev,
    // If no override and global data available, we won't render this; but keep query enabled to reuse cache.
    enabled: !!override,
  });

  // When no override, reuse the parent's cache entry (from React Query cache).
  const parentCache = useQueryClient().getQueryData<any>(["dashboard-stats-v2", globalPeriod.range, globalPeriod.start ?? null, globalPeriod.end ?? null]);
  const cd = override ? q.data : parentCache;

  const sub = subtitle ?? effectiveSubtitle(effective);
  return (
    <SectionCard
      title={title}
      subtitle={sub}
      delay={delay}
      action={
        <div className="flex items-center gap-1.5">
          {override ? (
            <button
              type="button"
              onClick={() => setOverride(null)}
              className="text-[10px] text-muted-foreground hover:text-primary underline underline-offset-2"
            >
              usar global
            </button>
          ) : null}
          <PeriodFilter
            compact
            value={effective}
            onChange={(v) => setOverride(v)}
          />
        </div>
      }
    >
      {cd ? children(cd) : <div className="h-60 grid place-items-center text-xs text-muted-foreground">Carregando…</div>}
    </SectionCard>
  );
}

function effectiveSubtitle(p: PeriodValue) {
  if (p.range === "custom" && p.start && p.end) {
    return `${new Date(p.start).toLocaleDateString("pt-BR")} – ${new Date(p.end).toLocaleDateString("pt-BR")}`;
  }
  const labels: Record<string, string> = {
    all: "Desde o início",
    today: "Hoje",
    yesterday: "Ontem",
    last_3_days: "Últimos 3 dias",
    last_7_days: "Últimos 7 dias",
    last_15_days: "Últimos 15 dias",
    last_30_days: "Últimos 30 dias",
    this_week: "Esta semana",
    this_month: "Este mês",
    last_month: "Mês passado",
    last_3_months: "Últimos 3 meses",
    last_6_months: "Últimos 6 meses",
    this_year: "Este ano",
    last_year: "Ano passado",
  };
  return labels[p.range] ?? "Período";
}


function Pill({ icon: Icon, tone, children, full }: { icon: any; tone: "primary" | "accent" | "emerald"; children: React.ReactNode; full?: boolean }) {
  const map = {
    primary: "border-primary/30 bg-primary/10 text-primary",
    accent: "border-accent/40 bg-accent/10 text-accent",
    emerald: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  };
  return (
    <span
      className={[
        "inline-flex min-h-[38px] w-full items-center justify-center gap-1.5 rounded-full border px-3 py-1.5 text-xs text-center md:w-auto",
        full ? "min-[360px]:col-span-2" : "",
        map[tone],
      ].join(" ")}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{children}</span>
    </span>
  );
}


function PerfItem({ icon: Icon, label, value, hint }: { icon: any; label: string; value: string; hint?: string }) {
  return (
    <li className="rounded-xl border border-border bg-background/30 p-3">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3.5 w-3.5 text-primary" /> {label}
      </div>
      <p className="font-display text-lg mt-1 truncate">{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </li>
  );
}

function AlertRow({ icon: Icon, tone, title, value, empty, show }: { icon: any; tone: "rose" | "primary"; title: string; value: string; empty: string; show: boolean }) {
  const map = {
    rose: "border-rose-500/30 bg-rose-500/10 text-rose-300",
    primary: "border-primary/30 bg-primary/10 text-primary",
  };
  if (!show) return <div className="text-xs text-muted-foreground rounded-xl border border-dashed border-border p-3">{empty}</div>;
  return (
    <div className={`rounded-xl border p-3 flex items-center gap-3 ${map[tone]}`}>
      <Icon className="h-4 w-4" />
      <div className="flex-1">
        <p className="text-sm text-foreground/95">{title}</p>
      </div>
      <span className="font-display text-sm">{value}</span>
    </div>
  );
}

function WaRow({ label, content, when }: { label: string; content: string | null | undefined; when?: string | null }) {
  return (
    <li className="rounded-xl border border-border bg-background/30 p-3">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
      {content ? (
        <>
          <p className="text-sm mt-1 line-clamp-2">{content}</p>
          {when && <p className="text-[10px] text-muted-foreground mt-0.5">{new Date(when).toLocaleString("pt-BR")}</p>}
        </>
      ) : (
        <p className="text-xs text-muted-foreground mt-1">—</p>
      )}
    </li>
  );
}

function SkeletonGrid() {
  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-32 rounded-3xl border border-border bg-card/40 animate-pulse" />)}
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-32 rounded-3xl border border-border bg-card/40 animate-pulse" />)}
      </div>
      <div className="grid lg:grid-cols-[1.4fr_1fr] gap-4">
        <div className="h-80 rounded-3xl border border-border bg-card/40 animate-pulse" />
        <div className="h-80 rounded-3xl border border-border bg-card/40 animate-pulse" />
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="h-72 rounded-3xl border border-border bg-card/40 animate-pulse" />
        <div className="h-72 rounded-3xl border border-border bg-card/40 animate-pulse" />
      </div>
    </div>
  );
}

function Empty({ msg }: { msg: string }) {
  return (
    <div className="h-full min-h-[180px] grid place-items-center text-center text-sm text-muted-foreground px-4">
      {msg}
    </div>
  );
}

