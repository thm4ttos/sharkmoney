import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatBRL, categoryGroups, groupOf } from "@/lib/user-mock";
import { useAuthProfile, initialsOf, firstNameOf } from "@/hooks/use-auth-profile";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { sendWelcomeWhatsapp, listTransactions } from "@/lib/brinzap.functions";
import { getDashboardStats, type DashboardRange } from "@/lib/dashboard.functions";
import { formatDateSP } from "@/lib/datetime";
import { motion } from "framer-motion";
import { ArrowDownRight, ArrowUpRight, MessageCircle, Sparkles, Plus, CalendarRange } from "lucide-react";
import { ClickableKpi, TxListPanel, BalancePanel, useKpiPopover } from "@/components/brinzap/dashboard/KpiPopover";
import { BalanceBreakdownDialog } from "@/components/brinzap/dashboard/BalanceBreakdownDialog";
import { UpcomingBillsCard } from "@/components/brinzap/dashboard/UpcomingBillsCard";

export const Route = createFileRoute("/app/")({
  component: HomePage,
});

const RANGE_OPTIONS: { key: DashboardRange; label: string }[] = [
  { key: "all", label: "Histórico completo" },
  { key: "today", label: "Hoje" },
  { key: "yesterday", label: "Ontem" },
  { key: "this_week", label: "Esta semana" },
  { key: "last_7_days", label: "Últimos 7 dias" },
  { key: "this_month", label: "Este mês" },
  { key: "last_month", label: "Mês passado" },
  { key: "this_year", label: "Este ano" },
  { key: "custom", label: "Personalizado" },
];

function HomePage() {
  const { profile: user, loading: profileLoading, error: profileError } = useAuthProfile();
  const sendWelcome = useServerFn(sendWelcomeWhatsapp);
  const fetchStats = useServerFn(getDashboardStats);
  const fetchTransactions = useServerFn(listTransactions);
  const tried = useRef(false);
  useEffect(() => {
    if (tried.current) return;
    if (!user?.phone) return;
    tried.current = true;
    sendWelcome({ data: { phone: user.phone } }).catch(() => {});
  }, [user?.phone, sendWelcome]);

  const { openCard, toggle, close } = useKpiPopover();
  const [explainOpen, setExplainOpen] = useState(false);
  const [range, setRange] = useState<DashboardRange>("all");
  const [customStart, setCustomStart] = useState<string>("");
  const [customEnd, setCustomEnd] = useState<string>("");

  const effectiveArgs = useMemo(() => {
    if (range === "custom" && customStart && customEnd) {
      return { range, start: customStart, end: customEnd };
    }
    return { range };
  }, [range, customStart, customEnd]);

  const { data: live } = useQuery({
    queryKey: ["home-stats", user?.id, effectiveArgs.range, effectiveArgs.start ?? "", effectiveArgs.end ?? ""],
    queryFn: () => fetchStats({ data: effectiveArgs }) as any,
    enabled: !!user?.id && (range !== "custom" || (!!customStart && !!customEnd)),
    staleTime: 30_000,
  });

  // Fonte única de verdade: mesma query usada em /app/transacoes (página 1, sem filtros).
  // "Últimos lançamentos" = SELECT * FROM transactions ORDER BY occurred_at DESC, created_at DESC LIMIT 5.
  const { data: latestTx } = useQuery<{ rows: any[]; total: number }>({
    queryKey: ["transactions", { q: undefined, kind: undefined, categories: undefined, limit: 5, offset: 0, withCount: true }],
    queryFn: () => fetchTransactions({ data: { limit: 5, offset: 0, withCount: true } }) as any,
    enabled: !!user?.id,
    staleTime: 15_000,
  });
  const latestRows = latestTx?.rows ?? [];

  const stats = useMemo(() => {
    const income = Number(live?.income ?? 0);
    const expense = Number(live?.expense ?? 0);
    const top = live?.topCategories?.[0];
    return {
      income,
      expense,
      balance: income - expense,
      topGroup: top ? { name: top.category } : null,
      hasData: (live?.transactionCount ?? 0) > 0 || income > 0 || expense > 0,
      prevExpense: Number(live?.prevExpense ?? 0),
      prevIncome: Number(live?.prevIncome ?? 0),
      recent: (live?.recent ?? []) as Array<any>,
      appointments: (live?.appointments ?? []) as Array<any>,
      rangeLabel: (live?.rangeLabel ?? "Histórico completo") as string,
      greetingPrefix: (live?.greetingPrefix ?? "desde que começou a usar o Abio") as string,
      hasCompare: Boolean(live?.hasCompare),
    };
  }, [live]);

  const firstName = firstNameOf(user?.name);
  const initials = initialsOf(user?.name);




  const comparative = useMemo(() => {
    if (!stats.hasCompare || !stats.hasData) return null;
    if (stats.prevExpense > 0 && stats.expense < stats.prevExpense) {
      const pct = Math.round(((stats.prevExpense - stats.expense) / stats.prevExpense) * 100);
      return `🚀 Você gastou ${pct}% menos que no período anterior. Continue assim!`;
    }
    if (stats.prevExpense > 0 && stats.expense > stats.prevExpense) {
      const pct = Math.round(((stats.expense - stats.prevExpense) / stats.prevExpense) * 100);
      return `⚠️ Suas despesas subiram ${pct}% em relação ao período anterior.`;
    }
    if (stats.prevIncome > 0 && stats.income > stats.prevIncome) {
      const pct = Math.round(((stats.income - stats.prevIncome) / stats.prevIncome) * 100);
      return `📈 Sua receita aumentou ${pct}% em relação ao período anterior.`;
    }
    return null;
  }, [stats]);

  const motivational = useMemo(() => {
    if (!stats.hasData) return "💡 Dica: envie fotos de comprovantes pelo WhatsApp para registrar gastos automaticamente.";
    if (comparative) return comparative;
    if (stats.balance > 0) return `💰 Seu saldo está positivo em ${formatBRL(stats.balance)}. Bom trabalho!`;
    return "💡 Envie mensagens no WhatsApp para registrar suas movimentações sem esforço.";
  }, [stats, comparative]);

  return (
    <div className="w-full max-w-full space-y-6 md:space-y-8 animate-fade-in">
      <header className="w-full rounded-3xl border border-border bg-card/60 backdrop-blur-xl px-4 py-5 sm:px-6 md:bg-transparent md:border-0 md:backdrop-blur-none md:p-0">
        <div className="flex flex-col items-center text-center gap-3 md:flex-row md:items-start md:text-left md:justify-between md:gap-6">
          <div className="flex w-full min-w-0 flex-col items-center gap-3 text-center md:flex-row md:items-start md:text-left md:gap-4">
            {user?.avatar_url ? (
              <img src={user.avatar_url} alt={user.name} className="h-14 w-14 shrink-0 rounded-2xl object-cover glow-neon" />
            ) : (
              <div className="h-14 w-14 shrink-0 rounded-2xl bg-gradient-brand text-primary-foreground grid place-items-center font-display text-lg glow-neon">
                {profileLoading ? <span className="animate-pulse">…</span> : (initials || "?")}
              </div>
            )}
            <div className="w-full min-w-0">
              <p className="text-[11px] uppercase tracking-[0.2em] text-primary">{stats.rangeLabel}</p>
              <h1
                className="font-display mt-1 leading-[1.08]"
                style={{ fontSize: "clamp(1.75rem, 7.5vw, 2.25rem)" }}
              >
                {profileLoading ? (
                  <span className="text-muted-foreground">Carregando…</span>
                ) : firstName ? (
                  <>Olá, {firstName} 👋</>
                ) : (
                  <span className="text-destructive text-base">⚠️ Perfil sem nome — verifique <Link to="/app/debug-perfil" className="underline">/app/debug-perfil</Link></span>
                )}
              </h1>
              {profileError && (
                <p className="text-xs text-destructive mt-1 break-words">Erro ao carregar perfil: {profileError}</p>
              )}

              {stats.hasData ? (
                <ul className="mt-3 w-full space-y-1.5 text-sm md:text-base">
                  <SummaryLine emoji="📊" label="Receitas" value={formatBRL(stats.income)} valueClass="text-emerald-300" />
                  <SummaryLine emoji="📉" label="Despesas" value={formatBRL(stats.expense)} valueClass="text-rose-300" />
                  <SummaryLine emoji="💰" label="Saldo" value={formatBRL(stats.balance)} valueClass="text-foreground" />
                  {stats.topGroup && (
                    <SummaryLine emoji="🏆" label="Maior categoria" value={stats.topGroup.name} valueClass="text-foreground" />
                  )}
                </ul>
              ) : (
                <p className="text-muted-foreground mt-2 leading-relaxed text-sm md:text-base">
                  Nenhum lançamento no período selecionado. Envie uma mensagem pelo WhatsApp para registrar.
                </p>
              )}

              <p className="text-sm mt-3 text-primary/90 leading-relaxed max-w-full mx-auto md:mx-0 md:max-w-xl">
                {motivational}
              </p>
            </div>
          </div>

          <Link
            to="/app/lancar"
            className="mt-4 w-full max-w-[300px] mx-auto inline-flex items-center justify-center gap-2 rounded-full bg-gradient-brand text-primary-foreground font-medium px-5 py-3 text-sm min-h-[44px] glow-neon hover:scale-[1.02] active:scale-[0.99] transition-smooth md:mt-0 md:mx-0 md:w-auto md:shrink-0"
          >
            <Plus className="h-4 w-4" /> Lançar rápido
          </Link>
        </div>
      </header>


      {/* Period filter */}
      <section className="rounded-3xl border border-border bg-card/60 backdrop-blur-xl p-4">
        <div className="flex items-center gap-2 mb-3 text-xs uppercase tracking-[0.2em] text-primary">
          <CalendarRange className="h-3.5 w-3.5" /> Período
        </div>
        <div className="flex flex-wrap gap-2">
          {RANGE_OPTIONS.map((opt) => {
            const active = range === opt.key;
            return (
              <button
                key={opt.key}
                onClick={() => setRange(opt.key)}
                className={[
                  "px-3 py-1.5 rounded-xl text-xs border transition-smooth",
                  active
                    ? "border-primary/50 bg-primary/15 text-primary"
                    : "border-border bg-background/40 text-muted-foreground hover:text-foreground hover:border-primary/30",
                ].join(" ")}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
        {range === "custom" && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <label className="text-muted-foreground">De</label>
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="px-2 py-1.5 rounded-xl border border-border bg-background/40 text-foreground"
            />
            <label className="text-muted-foreground">até</label>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="px-2 py-1.5 rounded-xl border border-border bg-background/40 text-foreground"
            />
          </div>
        )}
      </section>

      <BalanceBreakdownDialog
        open={explainOpen}
        onClose={() => setExplainOpen(false)}
        from={range === "custom" && customStart ? customStart : undefined}
        to={range === "custom" && customEnd ? customEnd : undefined}
        periodLabel={stats.rangeLabel}
      />

      <div className="grid md:grid-cols-3 gap-4">
        <ClickableKpi open={openCard === "balance"} onToggle={() => toggle("balance")} onClose={close} panel={<BalancePanel d={live} onClose={close} onExplain={() => setExplainOpen(true)} />}>
          <BigCard label="Saldo" value={formatBRL(stats.balance)} accent="bg-gradient-brand-soft border-primary/30" icon={Sparkles} />
        </ClickableKpi>
        <ClickableKpi open={openCard === "income"} onToggle={() => toggle("income")} onClose={close} panel={<TxListPanel title="💰 Últimas receitas" kind="income" items={(live as any)?.recentIncome ?? []} onClose={close} />}>
          <BigCard label="Receitas" value={formatBRL(stats.income)} accent="bg-emerald-500/10 border-emerald-500/30" icon={ArrowUpRight} subtle="text-emerald-300" />
        </ClickableKpi>
        <ClickableKpi open={openCard === "expense"} onToggle={() => toggle("expense")} onClose={close} panel={<TxListPanel title="💸 Últimas despesas" kind="expense" items={(live as any)?.recentExpense ?? []} onClose={close} />}>
          <BigCard label="Despesas" value={formatBRL(stats.expense)} accent="bg-rose-500/10 border-rose-500/30" icon={ArrowDownRight} subtle="text-rose-300" />
        </ClickableKpi>
      </div>

      <div className="grid lg:grid-cols-[1.4fr_1fr] gap-4">
        <section className="rounded-3xl border border-border bg-card/60 backdrop-blur-xl p-5 hover:border-primary/40 transition-smooth">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl">Últimos lançamentos</h2>
            {latestRows.length > 0 && (
              <Link to="/app/transacoes" search={{ kind: undefined, view: "lista" }} className="text-xs text-primary hover:underline">Ver todos</Link>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">Mesma fonte de dados da aba Transações.</p>
          {latestRows.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-dashed border-border bg-background/30 p-6 text-center">
              <p className="text-sm text-muted-foreground">Nenhum lançamento registrado ainda.</p>
              <p className="text-xs text-muted-foreground mt-1">Envie uma mensagem pelo WhatsApp para começar.</p>
            </div>
          ) : (
            <div className="mt-4 divide-y divide-border">
              {latestRows.slice(0, 5).map((t: any) => {
                const g = groupOf(groupKeyForCategory(t.category));
                const Icon = g.icon;
                const occurredAt = String(t.occurred_at ?? "");
                const isIncome = t.kind === "income";
                return (
                  <div key={t.id} className="flex items-center gap-3 py-3 text-sm">
                    <div className={`h-9 w-9 grid place-items-center rounded-xl bg-background/50 ${g.color}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="truncate font-medium">{t.description || t.category || "Lançamento"}</p>
                      <p className="text-xs text-muted-foreground">
                        {t.category}{occurredAt ? ` · ${formatDateSP(occurredAt)}` : ""}
                      </p>
                    </div>
                    <p className={`font-medium ${isIncome ? "text-emerald-400" : "text-rose-400"}`}>
                      {isIncome ? "+" : "-"} {formatBRL(Number(t.amount ?? 0))}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {stats.appointments.length > 0 ? (
          <section className="rounded-3xl border border-border bg-card/60 backdrop-blur-xl p-5 hover:border-primary/40 transition-smooth">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xl">Próximos lembretes</h2>
              <Link to="/app/compromissos" className="text-xs text-primary hover:underline">Ver todos</Link>
            </div>
            <div className="mt-4 space-y-3">
              {stats.appointments.slice(0, 4).map((a: any) => {
                const when = new Date(a.scheduled_at);
                return (
                  <div key={a.id} className="flex items-center gap-3 rounded-2xl border border-border bg-background/40 p-3 hover:border-primary/30 transition-smooth">
                    <div className="h-10 w-10 grid place-items-center rounded-xl bg-primary/10 text-primary">
                      <MessageCircle className="h-4 w-4" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm truncate">{a.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {when.toLocaleDateString("pt-BR")} · {when.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ) : (
          <UpcomingBillsCard />
        )}
      </div>

      <section className="rounded-3xl border border-border bg-card/60 backdrop-blur-xl p-5">
        <h2 className="font-display text-xl">Atalhos por categoria</h2>
        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {categoryGroups.slice(0, 12).map((g) => {
            const Icon = g.icon;
            return (
              <Link key={g.key} to="/app/transacoes" search={{ kind: undefined, view: "categorias" }} className="rounded-2xl border border-border bg-background/40 p-4 hover:border-primary/40 hover:scale-[1.02] transition-smooth group">
                <div className={`${g.color}`}><Icon className="h-5 w-5" /></div>
                <p className="text-sm mt-3 group-hover:text-primary transition-smooth">{g.name}</p>
                <p className="text-[11px] text-muted-foreground">{g.categories.length} categorias</p>
              </Link>
            );
          })}
        </div>
      </section>

    </div>
  );
}

function SummaryLine({ emoji, label, value, valueClass }: { emoji: string; label: string; value: string; valueClass?: string }) {
  return (
    <li className="flex w-full items-baseline justify-center gap-2 md:justify-start">
      <span className="shrink-0">{emoji}</span>
      <span className="text-muted-foreground shrink-0">{label}:</span>
      <span className={`font-semibold tabular-nums truncate ${valueClass ?? ""}`}>{value}</span>
    </li>
  );
}

function BigCard({ label, value, accent, icon: Icon, subtle }: { label: string; value: string; accent: string; icon: typeof Sparkles; subtle?: string }) {
  return (
    <motion.div
      whileHover={{ y: -3 }}
      className={`relative isolate w-full overflow-hidden rounded-3xl border p-5 max-[380px]:p-4 backdrop-blur-xl transition-smooth hover:shadow-lg ${accent}`}
    >
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="truncate">{label}</span>
        <Icon className={`h-4 w-4 shrink-0 ${subtle ?? "text-primary"}`} />
      </div>
      <p
        key={value}
        className="font-display mt-2 tabular-nums whitespace-nowrap truncate"
        style={{ willChange: "auto", backfaceVisibility: "hidden", fontSize: "clamp(1.5rem, 7vw, 1.875rem)" }}
      >
        {value}
      </p>
    </motion.div>
  );

}

function groupKeyForCategory(category?: string | null) {
  const raw = String(category ?? "").toLowerCase().trim();
  if (!raw) return "outros";
  const found = categoryGroups.find((g) =>
    g.name.toLowerCase() === raw || g.categories.some((c) => c.toLowerCase() === raw)
  );
  return found?.key ?? "outros";
}
