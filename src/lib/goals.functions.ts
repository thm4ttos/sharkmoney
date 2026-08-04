import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type GoalInput = {
  id?: string;
  title: string;
  kind?: string;
  target_amount: number;
  current_amount?: number;
  target_date?: string | null;
  notes?: string | null;
};

export const listGoals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("financial_goals")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map(enrich);
  });

export const upsertGoal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: GoalInput) => data)
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    if (!data.title?.trim()) throw new Error("Informe um título.");
    if (!Number.isFinite(data.target_amount) || data.target_amount <= 0) throw new Error("Valor da meta inválido.");
    const payload: any = {
      user_id: userId,
      title: data.title.trim().slice(0, 120),
      kind: (data.kind ?? "custom").slice(0, 40),
      target_amount: Number(data.target_amount),
      current_amount: Math.max(0, Number(data.current_amount ?? 0)),
      target_date: data.target_date || null,
      notes: data.notes?.toString().slice(0, 500) || null,
    };
    if (data.id) {
      const { error } = await supabase.from("financial_goals").update(payload).eq("id", data.id).eq("user_id", userId);
      if (error) throw new Error(error.message);
      return { ok: true, id: data.id };
    }
    const { data: row, error } = await supabase.from("financial_goals").insert(payload).select("id").single();
    if (error) throw new Error(error.message);
    return { ok: true, id: row.id };
  });

export const addToGoal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string; amount: number }) => data)
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const amt = Number(data.amount);
    if (!Number.isFinite(amt) || amt === 0) throw new Error("Valor inválido.");
    const { data: cur, error: e1 } = await supabase.from("financial_goals").select("current_amount").eq("id", data.id).eq("user_id", userId).single();
    if (e1) throw new Error(e1.message);
    const next = Math.max(0, Number(cur.current_amount) + amt);
    const { error } = await supabase.from("financial_goals").update({ current_amount: next }).eq("id", data.id).eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true, current_amount: next };
  });

export const deleteGoal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("financial_goals").delete().eq("id", data.id).eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

function enrich(g: any) {
  const target = Number(g.target_amount);
  const current = Number(g.current_amount);
  const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
  const remaining = Math.max(0, target - current);
  let monthsToTarget: number | null = null;
  let monthlyNeed: number | null = null;
  if (g.target_date) {
    const now = new Date();
    const td = new Date(g.target_date);
    const months = Math.max(1, (td.getFullYear() - now.getFullYear()) * 12 + (td.getMonth() - now.getMonth()));
    monthsToTarget = months;
    monthlyNeed = Math.round((remaining / months) * 100) / 100;
  }
  const suggestion = remaining === 0
    ? `Parabéns! Você já alcançou a meta "${g.title}". 🎉`
    : monthlyNeed
    ? `Para atingir "${g.title}" até ${new Date(g.target_date).toLocaleDateString("pt-BR")}, guarde cerca de R$ ${monthlyNeed.toFixed(2).replace(".", ",")} por mês.`
    : `Faltam R$ ${remaining.toFixed(2).replace(".", ",")}. Guardando R$ 500/mês você atinge em aproximadamente ${Math.max(1, Math.ceil(remaining / 500))} meses.`;
  return { ...g, target_amount: target, current_amount: current, progress_pct: pct, remaining, months_to_target: monthsToTarget, monthly_need: monthlyNeed, suggestion };
}
