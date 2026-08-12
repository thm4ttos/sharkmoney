import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend } from "recharts";
import { Heart, Settings, ArrowUpRight, ArrowDownRight, Scale, Users, TrendingUp, TrendingDown } from "lucide-react";
import { getCoupleStatus, listCoupleItems, computeCoupleBalance } from "@/lib/couple.functions";
import { KpiCard } from "@/components/brinzap/dashboard/KpiCard";
import { SectionCard } from "@/components/brinzap/dashboard/SectionCard";
import { formatDayMonthSP } from "@/lib/datetime";

export const Route = createFileRoute("/app/casal-dashboard")({
  head: () => ({ meta: [{ title: "Dashboard do Casal · Abio" }] }),
  component: Page,
});

const BRL = (n: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n ?? 0);

const DONUT_COLORS = [
  "oklch(0.723 0.192 149.6)",
  "oklch(0.541 0.246 293)",
  "oklch(0.75 0.20 200)",
  "oklch(0.861 0.173 91.9)",
  "oklch(0.637 0.208 25.3)",
  "oklch(0.68 0.18 260)",
];

const TT = {
  background: "oklch(0.239 0.018 266.2)",
  border: "1px solid oklch(0.541 0.246 293 / 45%)",
  borderRadius: 12,
  color: "white",
};

function Page() {
  const statusFn = useServerFn(getCoupleStatus);
  const itemsFn = useServerFn(listCoupleItems);
  const balanceFn = useServerFn(computeCoupleBalance);

  const status = useQuery({ queryKey: ["couple-status"], queryFn: () => statusFn() as any });
  const link = (status.data as any)?.link ?? null;
  const partner = (status.data as any)?.partner ?? null;
  const role = (status.data as any)?.role ?? null;
  const isAccepted = link?.status === "accepted";

  const items = useQuery({ queryKey: ["couple-shared"], queryFn: () => itemsFn() as any, enabled: isAccepted });
  const balance = useQuery({ queryKey: ["couple-balance"], queryFn: () => balanceFn() as any, enabled: isAccepted });

  if (status.isLoading) {
    return <SkeletonGrid />;
  }

  if (!isAccepted) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="rounded-3xl border border-border bg-card/40 backdrop-blur-xl p-12 text-center">
          <Heart className="h-10 w-10 text-primary mx-auto mb-3" />
          <p className="font-display text-xl">Você ainda não tem um vínculo ativo</p>
          <p className="text-sm text-muted-foreground mt-1">Vincule sua conta com a do seu parceiro(a) pra desbloquear esse painel.</p>
          <Link to="/app/casal" className="mt-4 inline-flex items-center gap-2 rounded-xl bg-gradient-brand text-primary-foreground px-4 py-2 text-sm">
            <Heart className="h-4 w-4" /> Abrir Modo Casal
          </Link>
        </div>
      </div>
    );
  }

  const b: any = balance.data;
  const s: any = items.data;
  const meIsRequester = role === "requester";
  const partnerName = (partner?.name || "seu parceiro(a)").split(" ")[0];

  const myIncome = b ? (meIsRequester ? b.requesterIncome : b.partnerIncome) : 0;
  const myExpense = b ? (meIsRequester ? b.requesterExpense : b.partnerExpense) : 0;
  const theirIncome = b ? (meIsRequester ? b.partnerIncome : b.requesterIncome) : 0;
  const theirExpense = b ? (meIsRequester ? b.partnerExpense : b.requesterExpense) : 0;
  const myPaid = b ? (meIsRequester ? b.requesterPaid : b.partnerPaid) : 0;
  const theirPaid = b ? (meIsRequester ? b.partnerPaid : b.requesterPaid) : 0;
  const myDelta = b ? (meIsRequester ? b.requesterDelta : -b.requesterDelta) : 0;

  const transactions = s?.transactions ?? [];
  const bills = s?.bills ?? [];
  const installments = s?.installments ?? [];
  const goals = s?.goals ?? [];

  return (
    <div className="w-full max-w-full space-y-6">
      <motion.header initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
        className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.25em] text-primary inline-flex items-center gap-2">
            <Heart className="h-3.5 w-3.5" /> Modo Casal
          </p>
          <h1 className="font-display text-3xl mt-1">Dashboard do <span className="text-gradient-brand">Casal</span></h1>
          <p className="text-sm text-muted-foreground mt-1">Vínculo com {partnerName} — este mês.</p>
        </div>
        <Link to="/app/casal" className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm hover:bg-background/40">
          <Settings className="h-4 w-4" /> Gerenciar vínculo
        </Link>
      </motion.header>

      {!b || !s ? (
        <SkeletonGrid />
      ) : (
        <>
          {/* Painel lado a lado */}
          <div className="grid md:grid-cols-2 gap-4">
            <PersonCard label="Você" income={myIncome} expense={myExpense} paid={myPaid} delay={0} />
            <PersonCard label={partnerName} income={theirIncome} expense={theirExpense} paid={theirPaid} delay={0.05} />
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <KpiCard label="Gastos do casal" value={BRL(b.totalExpense)} hint="Total combinado este mês" tone="expense" icon={Scale} delay={0.1} />
            <KpiCard label="Divisão combinada" value={`${Number(link.split_ratio_requester)}% / ${100 - Number(link.split_ratio_requester)}%`} hint="Percentual de cada um" tone="neutral" icon={Users} delay={0.15} />
            <KpiCard
              label="Saldo entre vocês"
              value={Math.abs(myDelta) < 0.01 ? "Em dia" : BRL(Math.abs(myDelta))}
              hint={Math.abs(myDelta) < 0.01 ? "Nada a acertar" : myDelta > 0 ? `${partnerName} te deve` : `Você deve pra ${partnerName}`}
              tone={Math.abs(myDelta) < 0.01 ? "income" : "brand"}
              icon={Scale} delay={0.2}
            />
          </div>

          <div className="grid lg:grid-cols-[1fr_1fr] gap-4">
            <SectionCard title="Gastos do casal por categoria" delay={0.25}>
              {(b.topCategories ?? []).length === 0 ? (
                <Empty msg="Nenhuma despesa registrada este mês." />
              ) : (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%" debounce={200}>
                    <PieChart>
                      <Pie data={b.topCategories} dataKey="total" nameKey="category" innerRadius={55} outerRadius={95} paddingAngle={2}>
                        {b.topCategories.map((_: any, i: number) => (
                          <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} stroke="transparent" />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={TT} formatter={(v: any) => BRL(Number(v))} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </SectionCard>

            <SectionCard title="Últimos lançamentos do casal" subtitle="Receitas e despesas dos dois" delay={0.3}>
              {transactions.length === 0 ? (
                <Empty msg="Nenhum lançamento este mês." />
              ) : (
                <ul className="divide-y divide-border max-h-72 overflow-y-auto">
                  {transactions.slice(0, 20).map((t: any) => {
                    const isIn = t.kind === "income";
                    const isMine = t.user_id !== partner?.id;
                    return (
                      <li key={t.id} className="py-2.5 flex items-center gap-3">
                        <div className={`h-8 w-8 grid place-items-center rounded-lg border shrink-0 ${isIn ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-rose-500/30 bg-rose-500/10 text-rose-300"}`}>
                          {isIn ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm truncate">{t.description || t.category}</p>
                          <p className="text-[11px] text-muted-foreground">{isMine ? "Você" : partnerName} · {formatDayMonthSP(t.occurred_at)}</p>
                        </div>
                        <span className={`text-sm font-display shrink-0 ${isIn ? "text-emerald-300" : "text-rose-300"}`}>
                          {isIn ? "+" : "−"} {BRL(Number(t.amount))}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </SectionCard>
          </div>

          <div className="grid lg:grid-cols-3 gap-4">
            <SectionCard title="Contas fixas" subtitle="Dos dois" delay={0.35}>
              {bills.length === 0 ? <Empty msg="Nenhuma conta fixa cadastrada." /> : (
                <ul className="space-y-2">
                  {bills.slice(0, 6).map((b2: any) => (
                    <li key={b2.id} className="flex items-center justify-between rounded-xl border border-border bg-background/30 px-3 py-2 text-sm">
                      <span className="truncate">{b2.title}</span>
                      <span className="text-muted-foreground text-xs shrink-0 ml-2">{BRL(Number(b2.amount ?? 0))}</span>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>

            <SectionCard title="Parcelamentos" subtitle="Dos dois" delay={0.4}>
              {installments.length === 0 ? <Empty msg="Nenhum parcelamento ativo." /> : (
                <ul className="space-y-2">
                  {installments.slice(0, 6).map((i: any) => (
                    <li key={i.id} className="flex items-center justify-between rounded-xl border border-border bg-background/30 px-3 py-2 text-sm">
                      <span className="truncate">{i.title}</span>
                      <span className="text-muted-foreground text-xs shrink-0 ml-2">{i.installments_paid}/{i.installments_total}</span>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>

            <SectionCard title="Metas" subtitle="Dos dois" delay={0.45}>
              {goals.length === 0 ? <Empty msg="Nenhuma meta cadastrada." /> : (
                <ul className="space-y-2">
                  {goals.slice(0, 6).map((g: any) => (
                    <li key={g.id} className="flex items-center justify-between rounded-xl border border-border bg-background/30 px-3 py-2 text-sm">
                      <span className="truncate">{g.title}</span>
                      <span className="text-muted-foreground text-xs shrink-0 ml-2">{BRL(Number(g.current_amount ?? 0))} / {BRL(Number(g.target_amount ?? 0))}</span>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          </div>
        </>
      )}
    </div>
  );
}

function PersonCard({ label, income, expense, paid, delay }: { label: string; income: number; expense: number; paid: number; delay: number }) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }}
      className="rounded-2xl border border-border bg-card shadow-card p-5">
      <p className="font-display text-lg mb-3">{label}</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1"><ArrowUpRight className="h-3 w-3" /> Receitas</p>
          <p className="font-display text-xl text-emerald-400 mt-1">{BRL(income)}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1"><ArrowDownRight className="h-3 w-3" /> Despesas</p>
          <p className="font-display text-xl text-rose-400 mt-1">{BRL(expense)}</p>
        </div>
      </div>
      <p className="text-xs text-muted-foreground mt-3">Pagou {BRL(paid)} de gastos do casal este mês.</p>
    </motion.div>
  );
}

function SkeletonGrid() {
  return (
    <div className="space-y-4">
      <div className="grid md:grid-cols-2 gap-4">
        <div className="h-40 rounded-2xl border border-border bg-card/40 animate-pulse" />
        <div className="h-40 rounded-2xl border border-border bg-card/40 animate-pulse" />
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-32 rounded-3xl border border-border bg-card/40 animate-pulse" />)}
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="h-80 rounded-3xl border border-border bg-card/40 animate-pulse" />
        <div className="h-80 rounded-3xl border border-border bg-card/40 animate-pulse" />
      </div>
    </div>
  );
}

function Empty({ msg }: { msg: string }) {
  return <div className="h-full min-h-[140px] grid place-items-center text-center text-sm text-muted-foreground px-4">{msg}</div>;
}
