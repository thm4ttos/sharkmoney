// SERVER-ONLY. Dashboard executivo do admin Abio.
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

// Preço estimado por plano (R$/mês). Trial = 0.
function planPrice(plan: string): number {
  const p = (plan || "").toLowerCase();
  if (p.includes("trial")) return 0;
  if (p.includes("premium") || p.includes("plus")) return 49.9;
  if (p.includes("pro")) return 39.9;
  return 29.9;
}

export const getExecutiveStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await ensureAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const now = Date.now();
    const since30 = new Date(now - 30 * 24 * 60 * 60 * 1000);
    const since14 = new Date(now - 14 * 24 * 60 * 60 * 1000);
    const since7 = new Date(now - 7 * 24 * 60 * 60 * 1000);
    const since24h = new Date(now - 24 * 60 * 60 * 1000);
    const sinceMonth = new Date(now - 30 * 24 * 60 * 60 * 1000);

    const [profilesRes, msgsRes] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("id, plan, status, created_at, trial_ends_at"),
      supabaseAdmin
        .from("whatsapp_messages")
        .select("direction, created_at, ai_intent")
        .gte("created_at", since30.toISOString()),
    ]);

    const profiles = (profilesRes.data ?? []) as any[];
    const msgs = (msgsRes.data ?? []) as any[];

    const total = profiles.length;
    const active = profiles.filter((p) => p.status === "active").length;
    const blocked = profiles.filter((p) => p.status === "blocked").length;
    const newWeek = profiles.filter((p) => new Date(p.created_at) >= since7).length;
    const newMonth = profiles.filter((p) => new Date(p.created_at) >= since30).length;

    const mrr = profiles
      .filter((p) => p.status === "active")
      .reduce((s, p) => s + planPrice(p.plan), 0);

    const msgs24 = msgs.filter((m) => new Date(m.created_at) >= since24h).length;
    const msgs7 = msgs.filter((m) => new Date(m.created_at) >= since7).length;
    const msgs30 = msgs.length;
    const aiHandled = msgs.filter((m) => m.ai_intent).length;

    // Crescimento últimos 30 dias (novos cadastros / dia)
    const growth: { date: string; label: string; novos: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now - i * 24 * 60 * 60 * 1000);
      const k = d.toISOString().slice(0, 10);
      growth.push({
        date: k,
        label: d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
        novos: 0,
      });
    }
    const growthMap = new Map(growth.map((g) => [g.date, g]));
    for (const p of profiles) {
      const k = String(p.created_at).slice(0, 10);
      const g = growthMap.get(k);
      if (g) g.novos++;
    }

    // Volume 14 dias (mensagens in/out)
    const vol: { date: string; label: string; in: number; out: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now - i * 24 * 60 * 60 * 1000);
      const k = d.toISOString().slice(0, 10);
      vol.push({
        date: k,
        label: d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
        in: 0,
        out: 0,
      });
    }
    const volMap = new Map(vol.map((v) => [v.date, v]));
    for (const m of msgs.filter((m) => new Date(m.created_at) >= since14)) {
      const k = String(m.created_at).slice(0, 10);
      const v = volMap.get(k);
      if (!v) continue;
      if (m.direction === "in") v.in++;
      else v.out++;
    }

    // Recentes
    const recent = [...profiles]
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .slice(0, 6)
      .map((p) => ({
        id: p.id,
        plan: p.plan,
        status: p.status,
        created_at: p.created_at,
      }));

    return {
      kpis: {
        total,
        active,
        blocked,
        newWeek,
        newMonth,
        mrr,
        arr: mrr * 12,
        msgs24,
        msgs7,
        msgs30,
        aiHandled,
        conversionRate: total > 0 ? Math.round((active / total) * 100) : 0,
      },
      growth,
      volume: vol,
      recent,
      generatedAt: new Date().toISOString(),
    };
  });
