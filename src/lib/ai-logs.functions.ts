// Logs detalhados da IA para central de monitoramento.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function ensureAdmin(supabase: any, userId: string) {
  const { data } = await supabase
    .from("user_roles").select("role")
    .eq("user_id", userId).eq("role", "admin").maybeSingle();
  if (!data) throw new Error("Forbidden");
}

const RangeSchema = z.object({
  range: z.enum(["today", "week", "month"]).default("week"),
  search: z.string().trim().max(80).optional(),
}).default({ range: "week" });

export const adminAiLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => RangeSchema.parse(i ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await ensureAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const now = Date.now();
    const since = new Date(
      now - (data.range === "today" ? 1 : data.range === "week" ? 7 : 30) * 24 * 60 * 60 * 1000,
    ).toISOString();

    let queryIn = supabaseAdmin
      .from("whatsapp_messages")
      .select("id, phone, content, transcription, ai_intent, ai_payload, ai_meta, status, media_type, created_at")
      .eq("direction", "in")
      .not("ai_intent", "is", null)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(80);

    if (data.search) queryIn = queryIn.ilike("phone", `%${data.search}%`);

    const { data: ins, error } = await queryIn;
    if (error) throw new Error(error.message);

    const phones = [...new Set((ins ?? []).map((r: any) => r.phone))];
    let outsByPhone = new Map<string, any[]>();
    if (phones.length) {
      const { data: outs } = await supabaseAdmin
        .from("whatsapp_messages")
        .select("phone, content, status, created_at")
        .eq("direction", "out")
        .in("phone", phones)
        .gte("created_at", since)
        .order("created_at", { ascending: true });
      for (const o of (outs ?? []) as any[]) {
        const list = outsByPhone.get(o.phone) ?? [];
        list.push(o);
        outsByPhone.set(o.phone, list);
      }
    }

    const logs = (ins ?? []).map((r: any) => {
      const replies = outsByPhone.get(r.phone) ?? [];
      const replyAfter = replies.find((o) => new Date(o.created_at).getTime() >= new Date(r.created_at).getTime());
      const meta = (r.ai_meta ?? {}) as any;
      return {
        id: r.id,
        phone: r.phone,
        prompt: r.transcription || r.content || "(sem texto)",
        intent: r.ai_intent,
        payload: r.ai_payload,
        model: meta.model ?? null,
        tokens: meta.tokens ?? null,
        latencyMs: meta.latencyMs ?? null,
        mode: meta.mode ?? r.media_type,
        status: r.status,
        error: r.status === "ai_error" || r.status === "ai_disabled" ? meta.error ?? r.status : null,
        reply: replyAfter?.content ?? null,
        replyStatus: replyAfter?.status ?? null,
        created_at: r.created_at,
      };
    });

    const totalTokens = logs.reduce((s, l) => s + (Number(l.tokens) || 0), 0);
    const errorCount = logs.filter((l) => !!l.error).length;
    const avgLatency = logs.length
      ? Math.round(logs.reduce((s, l) => s + (Number(l.latencyMs) || 0), 0) / logs.length)
      : 0;
    // Estimativa simples: $0.005 / 1k tokens (custo médio entrada+saída gpt-4o)
    const estCostUsd = (totalTokens / 1000) * 0.005;

    return {
      logs,
      summary: {
        total: logs.length,
        totalTokens,
        avgLatencyMs: avgLatency,
        errorCount,
        estCostUsd: Math.round(estCostUsd * 100) / 100,
      },
    };
  });
