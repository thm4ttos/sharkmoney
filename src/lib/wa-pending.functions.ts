// Painel Admin: estatísticas e reprocessamento de mensagens WhatsApp pendentes.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function ensureAdmin(supabase: any, userId: string) {
  const { data } = await supabase
    .from("user_roles").select("role")
    .eq("user_id", userId).eq("role", "admin").maybeSingle();
  if (!data) throw new Error("Forbidden");
}

export const getPendingMessagesPanel = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await ensureAdmin(context.supabase, context.userId);
    const { getPendingMessagesStats } = await import("@/lib/wa-processor.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const stats = await getPendingMessagesStats();
    const { data: list } = await supabaseAdmin
      .from("whatsapp_messages")
      .select("id, phone, status, content, transcription, created_at, ai_intent")
      .eq("direction", "in")
      .in("status", ["queued", "error", "send_error", "transcribe_error", "ai_error", "reprocessing", "processing"])
      .order("created_at", { ascending: false })
      .limit(50);
    return { stats, list: list ?? [] };
  });

export const reprocessPendingMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { limit?: number } | undefined) => d ?? {})
  .handler(async ({ context, data }) => {
    await ensureAdmin(context.supabase, context.userId);
    const { reprocessPending } = await import("@/lib/wa-processor.server");
    const t0 = Date.now();
    const result = await reprocessPending({ limit: Math.min(200, Math.max(1, Number(data.limit ?? 50))) });
    return { durationMs: Date.now() - t0, ...result };
  });
