import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { period?: "all" | "month" | "quarter" | "year"; ref?: string }) => d)
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const ref = data.ref ? new Date(data.ref + "T00:00:00Z") : new Date();
    const period = data.period ?? "all";
    let start: Date | null = null, end: Date | null = null, label: string;
    if (period === "all") {
      label = "Histórico completo";
    } else if (period === "month") {
      start = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 1));
      end = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() + 1, 1));
      label = `${String(ref.getUTCMonth() + 1).padStart(2, "0")}/${ref.getUTCFullYear()}`;
    } else if (period === "quarter") {
      const q = Math.floor(ref.getUTCMonth() / 3);
      start = new Date(Date.UTC(ref.getUTCFullYear(), q * 3, 1));
      end = new Date(Date.UTC(ref.getUTCFullYear(), q * 3 + 3, 1));
      label = `Q${q + 1}/${ref.getUTCFullYear()}`;
    } else {
      start = new Date(Date.UTC(ref.getUTCFullYear(), 0, 1));
      end = new Date(Date.UTC(ref.getUTCFullYear() + 1, 0, 1));
      label = `${ref.getUTCFullYear()}`;
    }

    let query = supabase
      .from("transactions").select("kind, amount, category, description, occurred_at")
      .eq("user_id", userId);
    if (start) query = query.gte("occurred_at", start.toISOString());
    if (end) query = query.lt("occurred_at", end.toISOString());
    const { data: rows, error } = await query.order("occurred_at", { ascending: true });
    if (error) throw new Error(error.message);

    let income = 0, expense = 0;
    const byCat = new Map<string, number>();
    const byPeriod = new Map<string, { income: number; expense: number }>();
    const tx = (rows ?? []).map((r: any) => ({ ...r, amount: Number(r.amount) }));
    for (const r of tx) {
      const a = r.amount;
      if (r.kind === "income") income += a; else { expense += a; byCat.set(r.category, (byCat.get(r.category) ?? 0) + a); }
      const k = (r.occurred_at as string).slice(0, 7);
      const slot = byPeriod.get(k) ?? { income: 0, expense: 0 };
      if (r.kind === "income") slot.income += a; else slot.expense += a;
      byPeriod.set(k, slot);
    }
    const categories = [...byCat.entries()].map(([category, total]) => ({ category, total: Math.round(total * 100) / 100 })).sort((a, b) => b.total - a.total);
    const series = [...byPeriod.entries()].sort().map(([month, v]) => ({ month, receita: Math.round(v.income * 100) / 100, despesa: Math.round(v.expense * 100) / 100 }));

    return {
      label, period,
      income: Math.round(income * 100) / 100,
      expense: Math.round(expense * 100) / 100,
      balance: Math.round((income - expense) * 100) / 100,
      categories, series,
      transactions: tx,
    };
  });
