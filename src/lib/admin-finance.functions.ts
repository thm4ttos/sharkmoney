// SERVER-ONLY. Central Financeira do admin.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function ensureAdmin(supabase: any, userId: string) {
  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Error("Forbidden");
}

function planPrice(plan: string): number {
  const p = (plan || "").toLowerCase();
  if (p.includes("trial")) return 0;
  if (p.includes("premium") || p.includes("plus")) return 49.9;
  if (p.includes("pro")) return 39.9;
  return 29.9;
}

export const getFinanceStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await ensureAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data } = await supabaseAdmin
      .from("profiles")
      .select("id, name, email, phone, plan, status, created_at, trial_ends_at, blocked_at");

    const profiles = (data ?? []) as any[];

    const active = profiles.filter((p) => p.status === "active");
    const blocked = profiles.filter((p) => p.status === "blocked");
    const trial = profiles.filter((p) => (p.plan || "").toLowerCase().includes("trial"));
    const paying = active.filter((p) => !(p.plan || "").toLowerCase().includes("trial"));

    const mrr = paying.reduce((s, p) => s + planPrice(p.plan), 0);
    const arr = mrr * 12;

    // Por plano
    const byPlanMap = new Map<string, { plan: string; count: number; mrr: number }>();
    for (const p of active) {
      const key = p.plan || "Sem plano";
      const cur = byPlanMap.get(key) ?? { plan: key, count: 0, mrr: 0 };
      cur.count++;
      cur.mrr += planPrice(p.plan);
      byPlanMap.set(key, cur);
    }
    const byPlan = [...byPlanMap.values()].sort((a, b) => b.count - a.count);

    // Receita acumulada estimada nos últimos 6 meses (proxy: ativos no mês × preço)
    const now = Date.now();
    const monthly: { label: string; receita: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const cutoff = new Date(d.getFullYear(), d.getMonth() + 1, 0).getTime();
      // estima: usuários ativos criados antes do fim daquele mês × preço atual do plano
      const receita = paying
        .filter((p) => new Date(p.created_at).getTime() <= cutoff)
        .reduce((s, p) => s + planPrice(p.plan), 0);
      monthly.push({
        label: d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", ""),
        receita: Math.round(receita * 100) / 100,
      });
    }

    // Top usuários por valor
    const top = [...paying]
      .map((p) => ({
        id: p.id,
        name: p.name || p.email || p.phone,
        plan: p.plan,
        value: planPrice(p.plan),
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);

    // Subscribers (ativos com vencimento de trial próximo)
    const soon = new Date(now + 7 * 24 * 60 * 60 * 1000);
    const expiringTrials = trial.filter(
      (p) => p.trial_ends_at && new Date(p.trial_ends_at) <= soon,
    ).length;

    const total = profiles.length;
    const retention = total > 0 ? Math.round((active.length / total) * 100) : 0;

    return {
      kpis: {
        activeCount: active.length,
        payingCount: paying.length,
        trialCount: trial.length,
        blockedCount: blocked.length,
        mrr,
        arr,
        retention,
        expiringTrials,
      },
      byPlan,
      monthly,
      top,
      subscribers: profiles
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
        .map((p) => ({
          id: p.id,
          name: p.name,
          email: p.email,
          phone: p.phone,
          plan: p.plan,
          status: p.status,
          trial_ends_at: p.trial_ends_at,
          created_at: p.created_at,
          value: planPrice(p.plan),
        })),
    };
  });
