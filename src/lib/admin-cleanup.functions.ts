// SERVER-ONLY. Limpeza de dados de demonstração (is_demo = true).
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

const TABLES = ["transactions", "appointments", "whatsapp_messages", "wa_broadcasts"] as const;

export const getDemoDataStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await ensureAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const result: Record<string, { demo: number; real: number }> = {};
    for (const t of TABLES) {
      const [{ count: demo }, { count: real }] = await Promise.all([
        supabaseAdmin.from(t).select("*", { count: "exact", head: true }).eq("is_demo", true),
        supabaseAdmin.from(t).select("*", { count: "exact", head: true }).eq("is_demo", false),
      ]);
      result[t] = { demo: demo ?? 0, real: real ?? 0 };
    }
    return result;
  });

export const cleanupDemoData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await ensureAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const removed: Record<string, number> = {};
    const preserved: Record<string, number> = {};

    for (const t of TABLES) {
      const { count: toDelete } = await supabaseAdmin
        .from(t).select("*", { count: "exact", head: true }).eq("is_demo", true);
      const { error } = await supabaseAdmin.from(t).delete().eq("is_demo", true);
      if (error) throw new Error(`Falha ao limpar ${t}: ${error.message}`);
      removed[t] = toDelete ?? 0;

      const { count: keepCount } = await supabaseAdmin
        .from(t).select("*", { count: "exact", head: true }).eq("is_demo", false);
      preserved[t] = keepCount ?? 0;
    }

    return {
      removed,
      preserved,
      totals: {
        removed: Object.values(removed).reduce((a, b) => a + b, 0),
        preserved: Object.values(preserved).reduce((a, b) => a + b, 0),
      },
      at: new Date().toISOString(),
    };
  });
