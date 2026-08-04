import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const MONTH_PT = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

function parseYM(input: { year: number; month: number }) {
  const year = Number.isFinite(input.year) ? input.year : new Date().getFullYear();
  const month = Math.min(12, Math.max(1, Number(input.month) || new Date().getMonth() + 1));
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  return { year, month, start, end };
}

export const getCalendarMonth = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { year: number; month: number }) => data)
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { year, month, start, end } = parseYM(data);

    const [txRes, apRes] = await Promise.all([
      supabase.from("transactions")
        .select("id, kind, amount, category, description, occurred_at")
        .eq("user_id", userId)
        .gte("occurred_at", start.toISOString())
        .lt("occurred_at", end.toISOString())
        .order("occurred_at", { ascending: true }),
      supabase.from("appointments")
        .select("id, title, notes, scheduled_at")
        .eq("user_id", userId)
        .gte("scheduled_at", start.toISOString())
        .lt("scheduled_at", end.toISOString())
        .order("scheduled_at", { ascending: true }),
    ]);
    if (txRes.error) throw new Error(txRes.error.message);
    if (apRes.error) throw new Error(apRes.error.message);

    return {
      year, month, monthLabel: MONTH_PT[month - 1],
      transactions: (txRes.data ?? []).map((t: any) => ({ ...t, amount: Number(t.amount) })),
      appointments: apRes.data ?? [],
    };
  });

export const getMonthlySummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data?: { period?: "all" | "month"; year?: number; month?: number }): { period?: "all" | "month"; year?: number; month?: number } => data ?? { period: "all" })
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const period = data.period ?? "all";
    const fallback = { year: new Date().getFullYear(), month: new Date().getMonth() + 1 };
    const cur = parseYM({ year: data.year ?? fallback.year, month: data.month ?? fallback.month });
    const prevDate = new Date(Date.UTC(cur.year, cur.month - 2, 1));
    const prev = parseYM({ year: prevDate.getUTCFullYear(), month: prevDate.getUTCMonth() + 1 });

    let query = supabase
      .from("transactions")
      .select("kind, amount, category, occurred_at")
      .eq("user_id", userId);
    if (period === "month") {
      query = query.gte("occurred_at", prev.start.toISOString()).lt("occurred_at", cur.end.toISOString());
    }
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);

    const calc = (s: Date | null, e: Date | null, groupByMonth = false) => {
      let income = 0, expense = 0, count = 0;
      const byCat = new Map<string, number>();
      const byDay = new Map<string, { receita: number; despesa: number }>();
      for (const r of rows ?? []) {
        const d = new Date(r.occurred_at);
        if (s && d < s) continue;
        if (e && d >= e) continue;
        count++;
        const a = Number(r.amount);
        const dayKey = groupByMonth ? (r.occurred_at as string).slice(0, 7) : `${d.getUTCDate()}`.padStart(2, "0");
        const slot = byDay.get(dayKey) ?? { receita: 0, despesa: 0 };
        if (r.kind === "income") { income += a; slot.receita += a; }
        else { expense += a; slot.despesa += a; byCat.set(r.category, (byCat.get(r.category) ?? 0) + a); }
        byDay.set(dayKey, slot);
      }
      const top = [...byCat.entries()].map(([category, total]) => ({ category, total: Math.round(total * 100) / 100 })).sort((a, b) => b.total - a.total);
      const daySeries = [...byDay.entries()].map(([day, v]) => ({ day, receita: Math.round(v.receita * 100) / 100, despesa: Math.round(v.despesa * 100) / 100 })).sort((a, b) => a.day.localeCompare(b.day));
      return { income, expense, balance: income - expense, count, top, daySeries };
    };

    const c = period === "month" ? calc(cur.start, cur.end) : calc(null, null, true);
    const p = period === "month" ? calc(prev.start, prev.end) : { income: 0, expense: 0, balance: 0, count: 0 };

    const pct = (now: number, before: number) => {
      if (before === 0) return now === 0 ? 0 : 100;
      return Math.round(((now - before) / before) * 100);
    };
    const expensePct = pct(c.expense, p.expense);
    const incomePct = pct(c.income, p.income);
    const balancePct = pct(c.balance, p.balance);

    const topCat = c.top[0]?.category;
    const parts: string[] = [];
    if (c.count === 0) parts.push(period === "month"
      ? `Você ainda não registrou movimentações em ${MONTH_PT[cur.month - 1]}. Mande uma mensagem no WhatsApp e o Shark Money começa a organizar sua vida financeira.`
      : "Você ainda não registrou movimentações financeiras. Mande uma mensagem no WhatsApp e o Shark Money começa a organizar sua vida financeira.");
    else {
      if (period === "month" && p.expense > 0) parts.push(expensePct <= 0 ? `Neste mês você gastou ${Math.abs(expensePct)}% menos que no mês anterior.` : `Suas despesas subiram ${expensePct}% em relação ao mês anterior.`);
      if (topCat) parts.push(`Seu maior gasto foi ${topCat}.`);
      if (c.balance > 0) parts.push(`Seu saldo atual está positivo em R$ ${c.balance.toFixed(2).replace(".", ",")}. Mantendo esse ritmo, está no caminho certo para melhorar sua saúde financeira.`);
      else if (c.balance < 0) parts.push(`Cuidado: seu saldo atual está negativo em R$ ${Math.abs(c.balance).toFixed(2).replace(".", ",")}. Vale revisar gastos em ${topCat ?? "categorias frequentes"}.`);
      else parts.push(`Você equilibrou receitas e despesas no histórico analisado.`);
    }

    return {
      period,
      label: period === "month" ? `${MONTH_PT[cur.month - 1]} ${cur.year}` : "Histórico completo",
      hasCompare: period === "month",
      year: cur.year, month: cur.month, monthLabel: MONTH_PT[cur.month - 1],
      current: { ...c, income: Math.round(c.income * 100) / 100, expense: Math.round(c.expense * 100) / 100, balance: Math.round(c.balance * 100) / 100 },
      previous: { income: Math.round(p.income * 100) / 100, expense: Math.round(p.expense * 100) / 100, balance: Math.round(p.balance * 100) / 100, count: p.count },
      delta: { expensePct, incomePct, balancePct },
      insight: parts.join(" "),
    };
  });

export const resetUserHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { confirm: string }) => data)
  .handler(async ({ context, data }) => {
    const ok = (data?.confirm ?? "").trim().toUpperCase();
    if (ok !== "CONFIRMAR" && ok !== "ZERAR") {
      throw new Error("Confirmação inválida. Digite CONFIRMAR para concluir.");
    }
    const { userId } = context;
    // Use admin client to guarantee deletion regardless of RLS quirks,
    // strictly scoped to the authenticated user. Only transactions are wiped —
    // appointments, goals, recurring_bills, installments, debts, profile,
    // subscription and WhatsApp credentials are preserved.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: removed, error, count } = await supabaseAdmin
      .from("transactions")
      .delete({ count: "exact" })
      .eq("user_id", userId)
      .select("id");
    if (error) throw new Error(error.message);
    const total = count ?? (removed?.length ?? 0);
    return { ok: true, removed: { transactions: total }, total };
  });

export const adminResetUserData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { userId: string; confirm: string }) => data)
  .handler(async ({ context, data }) => {
    if ((data?.confirm ?? "").trim().toUpperCase() !== "CONFIRMAR") {
      throw new Error("Confirmação inválida.");
    }
    const { supabase } = context;
    const { data: removed, error } = await supabase.rpc("admin_reset_user_data" as any, { target: data.userId });
    if (error) throw new Error(error.message);
    const r = (removed ?? {}) as Record<string, number>;
    const total = Object.values(r).reduce((a, b) => a + (Number(b) || 0), 0);
    return { ok: true, removed: r, total };
  });
