import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type AssetInput = {
  id?: string;
  label: string;
  kind: "cash" | "investment" | "property" | "other";
  amount: number;
  as_of?: string;
  notes?: string | null;
};

export const getFreedomSnapshot = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [aRes, tRes] = await Promise.all([
      supabase.from("assets").select("*").eq("user_id", userId).order("as_of", { ascending: false }),
      supabase.from("transactions").select("kind, amount, occurred_at").eq("user_id", userId),
    ]);
    if (aRes.error) throw new Error(aRes.error.message);
    if (tRes.error) throw new Error(tRes.error.message);

    const assets = (aRes.data ?? []).map((a: any) => ({ ...a, amount: Number(a.amount) }));
    const totalAssets = assets.reduce((s: number, a: any) => s + a.amount, 0);
    const reserve = assets.filter((a: any) => a.kind === "cash").reduce((s: number, a: any) => s + a.amount, 0);

    const txs = tRes.data ?? [];
    const monthsBuckets = new Map<string, { income: number; expense: number }>();
    for (const t of txs) {
      const m = (t.occurred_at as string).slice(0, 7);
      const slot = monthsBuckets.get(m) ?? { income: 0, expense: 0 };
      const a = Number(t.amount);
      if (t.kind === "income") slot.income += a; else slot.expense += a;
      monthsBuckets.set(m, slot);
    }
    const monthsCount = Math.max(1, monthsBuckets.size);
    const totalIncome = [...monthsBuckets.values()].reduce((s, v) => s + v.income, 0);
    const totalExpense = [...monthsBuckets.values()].reduce((s, v) => s + v.expense, 0);
    const avgIncome = totalIncome / monthsCount;
    const avgExpense = totalExpense / monthsCount;

    // Patrimônio necessário para liberdade financeira ≈ gastos anuais × 25 (regra dos 4%)
    const yearExpense = avgExpense * 12;
    const targetAssets = Math.max(yearExpense * 25, 1);
    const freedomPct = Math.min(100, Math.round((totalAssets / targetAssets) * 100));

    // Reserva de emergência: 6× gasto médio mensal
    const reserveTarget = avgExpense * 6;
    const reservePct = reserveTarget > 0 ? Math.min(100, Math.round((reserve / reserveTarget) * 100)) : 0;

    // Série de evolução patrimonial: usa snapshots por mês
    const byMonthAsset = new Map<string, number>();
    for (const a of assets) {
      const m = (a.as_of as string).slice(0, 7);
      byMonthAsset.set(m, (byMonthAsset.get(m) ?? 0) + a.amount);
    }
    const evolution = [...byMonthAsset.entries()].sort().slice(-12).map(([month, total]) => ({ month, total: Math.round(total * 100) / 100 }));

    return {
      total_assets: Math.round(totalAssets * 100) / 100,
      reserve: Math.round(reserve * 100) / 100,
      reserve_target: Math.round(reserveTarget * 100) / 100,
      reserve_pct: reservePct,
      target_assets: Math.round(targetAssets * 100) / 100,
      freedom_pct: freedomPct,
      avg_income: Math.round(avgIncome * 100) / 100,
      avg_expense: Math.round(avgExpense * 100) / 100,
      assets, evolution,
    };
  });

export const upsertAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: AssetInput) => d)
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    if (!data.label?.trim()) throw new Error("Informe um nome.");
    if (!Number.isFinite(data.amount) || data.amount < 0) throw new Error("Valor inválido.");
    if (!["cash", "investment", "property", "other"].includes(data.kind)) throw new Error("Tipo inválido.");
    const payload: any = {
      user_id: userId, label: data.label.trim().slice(0, 120), kind: data.kind,
      amount: Number(data.amount), as_of: data.as_of || new Date().toISOString().slice(0, 10),
      notes: data.notes || null,
    };
    if (data.id) {
      const { error } = await supabase.from("assets").update(payload).eq("id", data.id).eq("user_id", userId);
      if (error) throw new Error(error.message);
      return { ok: true };
    }
    const { error } = await supabase.from("assets").insert(payload);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("assets").delete().eq("id", data.id).eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
