import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Tx = { id?: string; kind: "income" | "expense"; amount: number; category: string; description: string | null; occurred_at: string; created_at?: string };

const MONTH_LABELS_PT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const DAY_LABELS_PT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function dayKey(d: Date) {
  return d.toISOString().slice(0, 10);
}
function daysInMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

export type DashboardRange =
  | "all" | "today" | "yesterday"
  | "last_3_days" | "last_7_days" | "last_15_days" | "last_30_days"
  | "this_week"
  | "this_month" | "last_month"
  | "last_3_months" | "last_6_months"
  | "this_year" | "last_year"
  | "custom" | "month";

export const RANGE_LABELS: Record<DashboardRange, string> = {
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
  custom: "Personalizado",
  month: "Este mês",
};

function startOfDay(d: Date) { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0); }
function endOfDay(d: Date) { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999); }
function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

function lastNDays(now: Date, n: number) {
  const today = startOfDay(now);
  const start = addDays(today, -(n - 1));
  const end = endOfDay(now);
  const prevStart = addDays(start, -n);
  const prevEnd = endOfDay(addDays(prevStart, n - 1));
  return { start, end, prevStart, prevEnd };
}

function lastNMonths(now: Date, n: number) {
  const start = new Date(now.getFullYear(), now.getMonth() - (n - 1), 1);
  const end = endOfDay(now);
  const prevStart = new Date(start.getFullYear(), start.getMonth() - n, 1);
  const prevEnd = endOfDay(new Date(start.getFullYear(), start.getMonth(), 0));
  return { start, end, prevStart, prevEnd };
}

function computePeriod(range: DashboardRange, now: Date, customStart?: string, customEnd?: string) {
  const today = startOfDay(now);
  switch (range) {
    case "all":
      return { start: null as Date | null, end: null as Date | null, prevStart: null as Date | null, prevEnd: null as Date | null, label: "Desde o início", greetingPrefix: "desde que começou a usar o Abio" };
    case "today":
      return { start: today, end: endOfDay(now), prevStart: addDays(today, -1), prevEnd: endOfDay(addDays(today, -1)), label: "Hoje", greetingPrefix: "Hoje" };
    case "yesterday": {
      const y = addDays(today, -1);
      return { start: y, end: endOfDay(y), prevStart: addDays(today, -2), prevEnd: endOfDay(addDays(today, -2)), label: "Ontem", greetingPrefix: "Ontem" };
    }
    case "last_3_days":  return { ...lastNDays(now, 3),  label: "Últimos 3 dias",  greetingPrefix: "Nos últimos 3 dias" };
    case "last_7_days":  return { ...lastNDays(now, 7),  label: "Últimos 7 dias",  greetingPrefix: "Nos últimos 7 dias" };
    case "last_15_days": return { ...lastNDays(now, 15), label: "Últimos 15 dias", greetingPrefix: "Nos últimos 15 dias" };
    case "last_30_days": return { ...lastNDays(now, 30), label: "Últimos 30 dias", greetingPrefix: "Nos últimos 30 dias" };
    case "this_week": {
      const dow = (today.getDay() + 6) % 7;
      const start = addDays(today, -dow);
      const end = endOfDay(addDays(start, 6));
      const prevStart = addDays(start, -7);
      const prevEnd = endOfDay(addDays(prevStart, 6));
      return { start, end, prevStart, prevEnd, label: "Esta semana", greetingPrefix: "Esta semana" };
    }
    case "this_month":
    case "month": {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = endOfDay(new Date(now.getFullYear(), now.getMonth() + 1, 0));
      const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const prevEnd = endOfDay(new Date(now.getFullYear(), now.getMonth(), 0));
      return { start, end, prevStart, prevEnd, label: "Este mês", greetingPrefix: "Neste mês" };
    }
    case "last_month": {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = endOfDay(new Date(now.getFullYear(), now.getMonth(), 0));
      const prevStart = new Date(now.getFullYear(), now.getMonth() - 2, 1);
      const prevEnd = endOfDay(new Date(now.getFullYear(), now.getMonth() - 1, 0));
      return { start, end, prevStart, prevEnd, label: "Mês passado", greetingPrefix: "No mês passado" };
    }
    case "last_3_months": return { ...lastNMonths(now, 3), label: "Últimos 3 meses", greetingPrefix: "Nos últimos 3 meses" };
    case "last_6_months": return { ...lastNMonths(now, 6), label: "Últimos 6 meses", greetingPrefix: "Nos últimos 6 meses" };
    case "this_year": {
      const start = new Date(now.getFullYear(), 0, 1);
      const end = endOfDay(new Date(now.getFullYear(), 11, 31));
      const prevStart = new Date(now.getFullYear() - 1, 0, 1);
      const prevEnd = endOfDay(new Date(now.getFullYear() - 1, 11, 31));
      return { start, end, prevStart, prevEnd, label: "Este ano", greetingPrefix: "Neste ano" };
    }
    case "last_year": {
      const start = new Date(now.getFullYear() - 1, 0, 1);
      const end = endOfDay(new Date(now.getFullYear() - 1, 11, 31));
      const prevStart = new Date(now.getFullYear() - 2, 0, 1);
      const prevEnd = endOfDay(new Date(now.getFullYear() - 2, 11, 31));
      return { start, end, prevStart, prevEnd, label: "Ano passado", greetingPrefix: "No ano passado" };
    }
    case "custom": {
      const s = customStart ? startOfDay(new Date(customStart)) : today;
      const e = customEnd ? endOfDay(new Date(customEnd)) : endOfDay(now);
      const durMs = e.getTime() - s.getTime();
      const prevEnd = new Date(s.getTime() - 1);
      const prevStart = new Date(prevEnd.getTime() - durMs);
      return { start: s, end: e, prevStart, prevEnd, label: "Período personalizado", greetingPrefix: "No período selecionado" };
    }
  }
}

function pickGranularity(spanDays: number): "day" | "week" | "month" {
  if (spanDays <= 45) return "day";
  if (spanDays <= 120) return "week";
  return "month";
}

function fmtDayLabel(d: Date) {
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function weekKey(d: Date) {
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (day.getDay() + 6) % 7;
  day.setDate(day.getDate() - dow);
  return dayKey(day);
}


export const getDashboardStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d?: { range?: DashboardRange; start?: string; end?: string }) => d ?? {})
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const range = (data.range ?? "all") as DashboardRange;

    const now = new Date();
    const period = computePeriod(range, now, data.start, data.end);
    const hasCompare = range !== "all";

    const start12m = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    const start7d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
    const todayISO = dayKey(now);

    // Lower bound for tx fetch: we need txs to cover [period.prevStart .. now] AND 12m series AND weekly.
    let txQuery = supabase
      .from("transactions")
      .select("id, kind, amount, category, description, occurred_at, created_at")
      .eq("user_id", userId)
      .order("occurred_at", { ascending: false })
      .order("created_at", { ascending: false });
    if (range !== "all") {
      const candidates = [period.prevStart, period.start, start12m, start7d].filter(Boolean) as Date[];
      const lower = new Date(Math.min(...candidates.map((d) => d.getTime())));
      txQuery = txQuery.gte("occurred_at", lower.toISOString());
    }

    const [txRes, goalsRes, billsRes, debtsRes, instRes, apptRes, waCountRes, waLastInRes, waLastOutRes, waLastAiRes] = await Promise.all([
      txQuery,
      supabase.from("financial_goals").select("id, title, target_amount, current_amount, target_date").eq("user_id", userId).order("updated_at", { ascending: false }),
      supabase.from("recurring_bills").select("id, title, amount, next_due_at, category, active").eq("user_id", userId).eq("active", true).gte("next_due_at", todayISO).order("next_due_at", { ascending: true }).limit(6),
      supabase.from("debts").select("id, title, principal, due_at, paid").eq("user_id", userId).eq("paid", false),
      supabase.from("installment_purchases").select("id, title, total_amount, installments_total, installments_paid, first_due_at, active").eq("user_id", userId).eq("active", true),
      supabase.from("appointments").select("id, title, scheduled_at").eq("user_id", userId).gte("scheduled_at", now.toISOString()).order("scheduled_at", { ascending: true }).limit(5),
      supabase.from("whatsapp_messages").select("id", { count: "exact", head: true }).eq("user_id", userId).gte("created_at", new Date(now.getTime() - 30 * 86400_000).toISOString()),
      supabase.from("whatsapp_messages").select("content, created_at, ai_intent").eq("user_id", userId).eq("direction", "in").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("whatsapp_messages").select("content, created_at").eq("user_id", userId).eq("direction", "out").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("whatsapp_messages").select("content, ai_intent, ai_payload, created_at").eq("user_id", userId).not("ai_intent", "is", null).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);

    if (txRes.error) throw new Error(txRes.error.message);
    const txs = (txRes.data ?? []) as Tx[];

    // === Period aggregates ===
    let income = 0, expense = 0, prevIncome = 0, prevExpense = 0;
    const byCategoryAmount = new Map<string, number>();
    const byCategoryCount = new Map<string, number>();
    const periodTxs: Tx[] = [];
    const pStart = period.start ? period.start.getTime() : -Infinity;
    const pEnd = period.end ? period.end.getTime() : Infinity;
    const prevS = period.prevStart ? period.prevStart.getTime() : NaN;
    const prevE = period.prevEnd ? period.prevEnd.getTime() : NaN;

    for (const t of txs) {
      const d = new Date(t.occurred_at).getTime();
      const a = Number(t.amount);
      if (d >= pStart && d <= pEnd) {
        periodTxs.push(t);
        if (t.kind === "income") income += a;
        else {
          expense += a;
          byCategoryAmount.set(t.category, (byCategoryAmount.get(t.category) ?? 0) + a);
        }
        byCategoryCount.set(t.category, (byCategoryCount.get(t.category) ?? 0) + 1);
      } else if (hasCompare && !isNaN(prevS) && d >= prevS && d <= prevE) {
        if (t.kind === "income") prevIncome += a;
        else prevExpense += a;
      }
    }
    // Saldo ATUAL (histórico completo) vem da função oficial do banco — a mesma
    // usada pelo WhatsApp. O período filtra gráficos e KPIs, nunca o saldo real.
    const { fetchFinanceSnapshot } = await import("@/lib/finance-snapshot.server");
    const lifetime = await fetchFinanceSnapshot(supabase, userId);

    // Receita/despesa/saldo do PERÍODO também vêm da mesma fonte oficial —
    // antes eram uma soma feita à mão em JS sobre os `txs` já buscados, um
    // segundo caminho de agregação que podia divergir do que o WhatsApp
    // responderia pro mesmo período (mesma tabela, lógica reimplementada).
    // A soma manual (loop acima) continua alimentando gráficos/séries/
    // insights, que não têm equivalente na função SQL — só os KPIs de
    // cabeçalho passam a vir do snapshot.
    if (range !== "all" && period.start && period.end) {
      const periodSnapshot = await fetchFinanceSnapshot(supabase, userId, {
        from: period.start.toISOString(),
        to: period.end.toISOString(),
      });
      income = periodSnapshot.income;
      expense = periodSnapshot.expense;
    } else {
      income = lifetime.income;
      expense = lifetime.expense;
    }
    const balance = income - expense;
    const prevBalance = prevIncome - prevExpense;

    const savingsRate = income > 0 ? Math.max(0, Math.min(1, (income - expense) / income)) : 0;
    const dim = daysInMonth(now);
    const dayOfMonth = now.getDate();

    const firstPeriodDate = periodTxs.length > 0
      ? new Date(Math.min(...periodTxs.map((t) => new Date(t.occurred_at).getTime())))
      : startOfDay(now);
    const spanStart = period.start ?? firstPeriodDate;
    const spanEnd = period.end ?? now;
    const periodDays = Math.max(1, Math.ceil((spanEnd.getTime() - spanStart.getTime() + 1) / 86400_000));
    const dailyAvgExpense = expense / periodDays;

    let forecastBalance: number | null = null;
    if (range === "this_month" || range === "month") {
      const projectedIncome = (income / Math.max(1, dayOfMonth)) * dim;
      const projectedExpense = (expense / Math.max(1, dayOfMonth)) * dim;
      forecastBalance = projectedIncome - projectedExpense;
    }

    // === Period-aware bucketed series ===
    // For "all": last 12 months by month. Otherwise pick day/week/month by span.
    type Bucket = { key: string; label: string; income: number; expense: number };
    const buckets = new Map<string, Bucket>();
    let granularity: "day" | "week" | "month";

    const isAll = range === "all";
    if (isAll) {
      granularity = "month";
      for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const k = monthKey(d);
        buckets.set(k, { key: k, label: MONTH_LABELS_PT[d.getMonth()], income: 0, expense: 0 });
      }
    } else {
      const sStart = period.start!;
      const sEnd = period.end!;
      const spanDays = Math.max(1, Math.ceil((sEnd.getTime() - sStart.getTime() + 1) / 86400_000));
      granularity = pickGranularity(spanDays);
      if (granularity === "day") {
        const cursor = new Date(sStart);
        while (cursor.getTime() <= sEnd.getTime()) {
          const k = dayKey(cursor);
          buckets.set(k, { key: k, label: fmtDayLabel(cursor), income: 0, expense: 0 });
          cursor.setDate(cursor.getDate() + 1);
        }
      } else if (granularity === "week") {
        const cursor = new Date(sStart);
        const dow = (cursor.getDay() + 6) % 7;
        cursor.setDate(cursor.getDate() - dow);
        while (cursor.getTime() <= sEnd.getTime()) {
          const k = dayKey(cursor);
          const wEnd = new Date(cursor); wEnd.setDate(wEnd.getDate() + 6);
          buckets.set(k, { key: k, label: `${fmtDayLabel(cursor)}–${fmtDayLabel(wEnd)}`, income: 0, expense: 0 });
          cursor.setDate(cursor.getDate() + 7);
        }
      } else {
        const cursor = new Date(sStart.getFullYear(), sStart.getMonth(), 1);
        while (cursor.getTime() <= sEnd.getTime()) {
          const k = monthKey(cursor);
          const lbl = `${MONTH_LABELS_PT[cursor.getMonth()]}/${String(cursor.getFullYear()).slice(2)}`;
          buckets.set(k, { key: k, label: lbl, income: 0, expense: 0 });
          cursor.setMonth(cursor.getMonth() + 1);
        }
      }
    }

    const bucketKeyFor = (d: Date) => {
      if (granularity === "month") return monthKey(d);
      if (granularity === "week") return weekKey(d);
      return dayKey(d);
    };

    // Aggregate txs into buckets
    for (const t of txs) {
      const d = new Date(t.occurred_at);
      const k = bucketKeyFor(d);
      const b = buckets.get(k);
      if (!b) continue;
      // For "all" we bucket the last-12-months window; for period ranges we only fill within period.
      if (!isAll) {
        const ts = d.getTime();
        if (ts < pStart || ts > pEnd) continue;
      }
      const a = Number(t.amount);
      if (t.kind === "income") b.income += a;
      else b.expense += a;
    }

    const series = [...buckets.values()];

    // === Balance accumulated series (period-scoped for ranges, 12m for all) ===
    let acc = 0;
    if (isAll) {
      for (const t of txs) {
        const d = new Date(t.occurred_at);
        if (d >= start12m) continue;
        acc += t.kind === "income" ? Number(t.amount) : -Number(t.amount);
      }
    } else {
      // Starting balance = pre-period balance from fetched txs (approximation from lower bound)
      for (const t of txs) {
        const d = new Date(t.occurred_at).getTime();
        if (d < pStart) acc += t.kind === "income" ? Number(t.amount) : -Number(t.amount);
      }
    }
    const balanceSeries = series.map((s) => {
      acc += s.income - s.expense;
      return { label: s.label, saldo: Math.round(acc * 100) / 100 };
    });

    // === Best bucket (best month/week/day) ===
    const best = series.reduce<{ label: string; savings: number } | null>((b, s) => {
      const sv = s.income - s.expense;
      if (!b || sv > b.savings) return { label: s.label, savings: sv };
      return b;
    }, null);

    // === "Entradas x Saídas" — same buckets as series (period-aware) ===
    const weekly = series.map((s) => ({ label: s.label, entrada: Math.round(s.income * 100) / 100, saida: Math.round(s.expense * 100) / 100 }));


    // === Top categories (period) ===
    const topCategories = [...byCategoryAmount.entries()]
      .map(([category, total]) => ({ category, total: Math.round(total * 100) / 100 }))
      .sort((a, b) => b.total - a.total);

    const mostUsedCategory = [...byCategoryCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const expenseCount = periodTxs.filter((t) => t.kind === "expense").length;
    const avgExpensePerTx = expenseCount > 0 ? expense / expenseCount : 0;
    const overAvgCategory = topCategories.find((c) => c.total > avgExpensePerTx * 3)?.category ?? null;

    // === Streak ===
    const txDaySet = new Set(txs.map((t) => dayKey(new Date(t.occurred_at))));
    let streak = 0;
    const cursor = new Date(now);
    if (!txDaySet.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
    while (txDaySet.has(dayKey(cursor))) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    }

    // === Recent (within period) ===
    const recentSource = range === "all" ? txs : periodTxs;
    const mapTx = (t: any) => ({
      id: t.id, kind: t.kind, amount: Number(t.amount), category: t.category,
      description: t.description, occurred_at: t.occurred_at, created_at: t.created_at,
    });
    const recent = recentSource.slice(0, 8).map(mapTx);
    const recentIncome = recentSource.filter((t) => t.kind === "income").slice(0, 5).map(mapTx);
    const recentExpense = recentSource.filter((t) => t.kind === "expense").slice(0, 5).map(mapTx);
    const largestExpenseRaw = [...(range === "all" ? txs : periodTxs)]
      .filter((t) => t.kind === "expense")
      .sort((a, b) => Number(b.amount) - Number(a.amount))[0] ?? null;
    const largestExpense = largestExpenseRaw ? mapTx(largestExpenseRaw) : null;
    const lastTx = recentSource[0] ? mapTx(recentSource[0]) : null;
    const lastIncome = txs.find((t) => t.kind === "income") ?? null;
    const lastExpense = txs.find((t) => t.kind === "expense") ?? null;

    // === Goals ===
    const goals = (goalsRes.data ?? []).map((g: any) => ({
      id: g.id, title: g.title,
      target: Number(g.target_amount), current: Number(g.current_amount),
      target_date: g.target_date,
      progress: g.target_amount > 0 ? Math.min(1, Number(g.current_amount) / Number(g.target_amount)) : 0,
    }));
    const primaryGoal = goals.sort((a, b) => b.progress - a.progress)[0] ?? null;
    const nearGoal = goals.find((g) => g.progress >= 0.8 && g.progress < 1) ?? null;

    const upcomingBills = (billsRes.data ?? []).map((b: any) => ({
      id: b.id, title: b.title, amount: Number(b.amount), due: b.next_due_at, category: b.category,
    }));
    const debts = debtsRes.data ?? [];
    const debtTotal = debts.reduce((s: number, d: any) => s + Number(d.principal), 0);
    const installments = (instRes.data ?? []).map((i: any) => ({
      id: i.id, title: i.title, total: Number(i.total_amount),
      paid: i.installments_paid, of: i.installments_total,
      remaining: Math.max(0, i.installments_total - i.installments_paid),
      installmentValue: Number(i.total_amount) / Math.max(1, i.installments_total),
    }));
    const installmentsRemainingValue = installments.reduce((s, i) => s + i.installmentValue * i.remaining, 0);

    const appointments = (apptRes.data ?? []).map((a: any) => ({ id: a.id, title: a.title, scheduled_at: a.scheduled_at }));

    const whatsapp = {
      msgsLast30d: waCountRes.count ?? 0,
      lastIn: waLastInRes.data ?? null,
      lastOut: waLastOutRes.data ?? null,
      lastAi: waLastAiRes.data ?? null,
    };

    // === Insights (period-aware) ===
    const insights: { tone: "good" | "warn" | "info"; text: string }[] = [];
    if (hasCompare && prevExpense > 0) {
      const diff = ((expense - prevExpense) / prevExpense) * 100;
      if (Math.abs(diff) >= 3) {
        insights.push(diff < 0
          ? { tone: "good", text: `Você gastou ${Math.abs(diff).toFixed(0)}% menos que no período anterior.` }
          : { tone: "warn", text: `Suas despesas subiram ${diff.toFixed(0)}% em relação ao período anterior.` });
      }
    }
    if (topCategories[0]) insights.push({ tone: "info", text: `Sua maior despesa foi em ${topCategories[0].category}.` });
    if (savingsRate >= 0.2) insights.push({ tone: "good", text: `Você está economizando ${Math.round(savingsRate * 100)}% da sua renda. Excelente!` });
    if (forecastBalance !== null && forecastBalance < 0) insights.push({ tone: "warn", text: `Previsão de fechar o mês negativo em R$ ${Math.abs(forecastBalance).toFixed(0)}.` });
    if (nearGoal) insights.push({ tone: "good", text: `Sua meta "${nearGoal.title}" está em ${Math.round(nearGoal.progress * 100)}%.` });
    if (debts.length > 0) insights.push({ tone: "warn", text: `Você tem ${debts.length} dívida(s) em aberto totalizando R$ ${debtTotal.toFixed(2)}.` });
    if (overAvgCategory) insights.push({ tone: "warn", text: `Categoria ${overAvgCategory} está com gastos acima da média.` });
    if (upcomingBills.length > 0) {
      const next = upcomingBills[0];
      const due = new Date(next.due);
      const daysTo = Math.ceil((due.getTime() - now.getTime()) / 86400_000);
      if (daysTo <= 7) insights.push({ tone: "warn", text: `Conta "${next.title}" vence em ${daysTo} dia(s).` });
    }

    return {
      // Period metadata
      range,
      rangeLabel: period.label,
      greetingPrefix: period.greetingPrefix,
      rangeStart: period.start?.toISOString() ?? null,
      rangeEnd: period.end?.toISOString() ?? null,
      hasCompare,
      // KPIs (period)
      income: round(income), expense: round(expense), balance: round(balance),
      // Saldo real (todo o histórico) — idêntico ao respondido no WhatsApp.
      currentBalance: lifetime.balance,
      lifetimeIncome: lifetime.income,
      lifetimeExpense: lifetime.expense,
      lifetimeTxCount: lifetime.txCount,

      prevIncome: round(prevIncome), prevExpense: round(prevExpense), prevBalance: round(prevBalance),
      savingsRate,
      transactionCount: periodTxs.length,
      dailyAvgExpense: round(dailyAvgExpense),
      forecastBalance: forecastBalance === null ? null : round(forecastBalance),
      // Series
      series: series.map((s) => ({ label: s.label, receita: round(s.income), despesa: round(s.expense) })),
      balanceSeries,
      weekly: weekly.map((w) => ({ label: w.label, entrada: round(w.entrada), saida: round(w.saida) })),
      comparison: [
        { label: "Período anterior", receita: round(prevIncome), despesa: round(prevExpense) },
        { label: period.label, receita: round(income), despesa: round(expense) },
      ],
      topCategories,
      streak,
      mostUsedCategory,
      bestMonth: best ? { label: best.label, savings: round(best.savings) } : null,
      totalEntriesLast12m: txs.length,
      recent, recentIncome, recentExpense, largestExpense, lastTx, lastIncome, lastExpense,
      primaryGoal, goals,
      upcomingBills, appointments,
      debtsCount: debts.length, debtTotal: round(debtTotal),
      installmentsCount: installments.length, installmentsRemainingValue: round(installmentsRemainingValue),
      installments: installments.slice(0, 4),
      whatsapp,
      insights,
    };
  });

function round(n: number) { return Math.round(n * 100) / 100; }
