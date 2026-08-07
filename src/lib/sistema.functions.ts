// SERVER-ONLY. Métricas do sistema Abio.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function ensureAdmin(supabase: any, userId: string) {
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
  if (!data) throw new Error("Forbidden");
}

const DAY_LABELS_PT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export const adminSystemMetrics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await ensureAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [recentMsgs, failures, last7d] = await Promise.all([
      supabaseAdmin
        .from("whatsapp_messages")
        .select("id, phone, direction, media_type, content, status, ai_intent, created_at")
        .order("created_at", { ascending: false })
        .limit(20),
      supabaseAdmin
        .from("whatsapp_messages")
        .select("id, phone, content, status, created_at, ai_meta")
        .in("status", ["send_error", "ai_error", "ai_disabled"])
        .order("created_at", { ascending: false })
        .limit(20),
      supabaseAdmin
        .from("whatsapp_messages")
        .select("direction, ai_intent, created_at")
        .gte("created_at", since7d.toISOString()),
    ]);

    // Consumo 7 dias
    const days = new Map<string, { label: string; in: number; out: number; ai: number }>();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const k = d.toISOString().slice(0, 10);
      days.set(k, { label: DAY_LABELS_PT[d.getDay()], in: 0, out: 0, ai: 0 });
    }
    for (const r of (last7d.data ?? []) as any[]) {
      const k = String(r.created_at).slice(0, 10);
      const d = days.get(k);
      if (!d) continue;
      if (r.direction === "in") d.in++;
      else d.out++;
      if (r.ai_intent) d.ai++;
    }
    const usage = [...days.values()];

    const totals = {
      in: usage.reduce((s, d) => s + d.in, 0),
      out: usage.reduce((s, d) => s + d.out, 0),
      ai: usage.reduce((s, d) => s + d.ai, 0),
      failures: failures.data?.length ?? 0,
    };

    return {
      recent: recentMsgs.data ?? [],
      failures: failures.data ?? [],
      usage,
      totals,
      timestamp: new Date().toISOString(),
    };
  });
