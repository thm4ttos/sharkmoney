import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type BudgetInput = { id?: string; category?: string | null; amount: number; period?: string };

function currentPeriod() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export const listBudgets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const period = currentPeriod();
    const [bRes, tRes] = await Promise.all([
      supabase.from("budgets").select("*").eq("user_id", userId).eq("period", period),
      supabase.from("transactions")
        .select("category, amount, kind, occurred_at")
        .eq("user_id", userId)
        .gte("occurred_at", `${period}-01T00:00:00Z`),
    ]);
    if (bRes.error) throw new Error(bRes.error.message);
    if (tRes.error) throw new Error(tRes.error.message);

    const byCat = new Map<string, number>();
    let totalSpent = 0;
    for (const r of tRes.data ?? []) {
      if (r.kind !== "expense") continue;
      const d = new Date(r.occurred_at as string);
      if (d.getUTCMonth() + 1 !== Number(period.slice(5)) || d.getUTCFullYear() !== Number(period.slice(0, 4))) continue;
      const a = Number(r.amount);
      totalSpent += a;
      byCat.set(r.category, (byCat.get(r.category) ?? 0) + a);
    }

    const budgets = (bRes.data ?? []).map((b: any) => {
      const isGlobal = !b.category;
      const spent = isGlobal ? totalSpent : (byCat.get(b.category) ?? 0);
      const amount = Number(b.amount);
      const pct = amount > 0 ? Math.min(999, Math.round((spent / amount) * 100)) : 0;
      return {
        id: b.id, category: b.category, amount, period: b.period,
        spent: Math.round(spent * 100) / 100,
        remaining: Math.round((amount - spent) * 100) / 100,
        pct,
      };
    });
    return { period, budgets };
  });

export const upsertBudget = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: BudgetInput) => d)
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    if (!Number.isFinite(data.amount) || data.amount < 0) throw new Error("Valor inválido.");
    const period = data.period || currentPeriod();
    const payload: any = {
      user_id: userId,
      period,
      category: data.category?.trim() || null,
      amount: Number(data.amount),
    };
    if (data.id) {
      const { error } = await supabase.from("budgets").update({ amount: payload.amount }).eq("id", data.id).eq("user_id", userId);
      if (error) throw new Error(error.message);
      return { ok: true };
    }
    // upsert on (user_id, period, COALESCE(category,''))
    const { data: existing } = await supabase.from("budgets").select("id")
      .eq("user_id", userId).eq("period", period)
      .is(payload.category ? "category" : "category", payload.category ? null : null);
    // simpler: fetch and decide
    const { data: rows } = await supabase.from("budgets").select("id, category").eq("user_id", userId).eq("period", period);
    const found = (rows ?? []).find((r: any) => (r.category ?? null) === payload.category);
    if (found) {
      const { error } = await supabase.from("budgets").update({ amount: payload.amount }).eq("id", found.id);
      if (error) throw new Error(error.message);
      return { ok: true, id: found.id };
    }
    const { error } = await supabase.from("budgets").insert(payload);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteBudget = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("budgets").delete().eq("id", data.id).eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
