import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ALLOWED_MODELS = [
  "gpt-5",
  "gpt-5-mini",
  "gpt-4.1",
  "gpt-4o",
  "gpt-4o-mini",
] as const;

const ALLOWED_TONES = ["formal", "amigavel", "vendedor"] as const;
export type AiTone = typeof ALLOWED_TONES[number];


async function ensureAdmin(supabase: any, userId: string) {
  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Error("Forbidden");
}

function maskKey(k: string | null | undefined): string | null {
  if (!k) return null;
  const s = String(k);
  if (s.length <= 8) return "••••";
  return `${s.slice(0, 3)}…${s.slice(-4)}`;
}

export const adminGetAiSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await ensureAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("ai_settings" as any)
      .select("model, enabled, api_key, last_used_at, updated_at, master_prompt, welcome_message, guest_message, signup_done_message, tone")
      .eq("id", 1)
      .maybeSingle();
    const row: any = data ?? { model: "gpt-4o", enabled: true, api_key: null, last_used_at: null, updated_at: null };
    return {
      model: row.model as string,
      enabled: !!row.enabled,
      hasKey: !!row.api_key,
      keyMasked: maskKey(row.api_key),
      last_used_at: row.last_used_at as string | null,
      updated_at: row.updated_at as string | null,
      allowedModels: ALLOWED_MODELS as readonly string[] as string[],
      allowedTones: ALLOWED_TONES as readonly string[] as string[],
      master_prompt: (row.master_prompt as string | null) ?? "",
      welcome_message: (row.welcome_message as string | null) ?? "",
      guest_message: (row.guest_message as string | null) ?? "",
      signup_done_message: (row.signup_done_message as string | null) ?? "",
      tone: ((row.tone as string | null) ?? "amigavel") as AiTone,
    };
  });

export const adminSaveAiSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      apiKey: z.string().trim().max(300).optional(),
      model: z.enum(ALLOWED_MODELS),
      enabled: z.boolean(),
      tone: z.enum(ALLOWED_TONES).optional(),
      master_prompt: z.string().max(8000).optional(),
      welcome_message: z.string().max(2000).optional(),
      guest_message: z.string().max(2000).optional(),
      signup_done_message: z.string().max(2000).optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await ensureAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const patch: any = {
      id: 1,
      model: data.model,
      enabled: data.enabled,
      updated_at: new Date().toISOString(),
      updated_by: userId,
    };
    if (data.apiKey && data.apiKey.length > 0) patch.api_key = data.apiKey;
    if (data.tone !== undefined) patch.tone = data.tone;
    if (data.master_prompt !== undefined) patch.master_prompt = data.master_prompt;
    if (data.welcome_message !== undefined) patch.welcome_message = data.welcome_message;
    if (data.guest_message !== undefined) patch.guest_message = data.guest_message;
    if (data.signup_done_message !== undefined) patch.signup_done_message = data.signup_done_message;

    const { error } = await supabaseAdmin
      .from("ai_settings" as any)
      .upsert(patch, { onConflict: "id" });
    if (error) throw new Error(error.message);

    // invalida cache do runtime de IA
    try {
      const { invalidateAiConfigCache } = await import("@/lib/ai-classify.server");
      invalidateAiConfigCache();
    } catch {}

    return { ok: true };
  });

export const adminTestAiReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      message: z.string().min(1).max(2000),
      mode: z.enum(["guest", "user"]).default("guest"),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await ensureAdmin(supabase, userId);
    const t0 = Date.now();
    try {
      const { guestReply, chatReply } = await import("@/lib/ai-classify.server");
      const reply = data.mode === "user"
        ? await chatReply(data.message, "Admin", [])
        : await guestReply(data.message, []);
      return { ok: true, reply, ms: Date.now() - t0 };
    } catch (e: any) {
      return { ok: false, error: e?.message ?? "erro", ms: Date.now() - t0 };
    }
  });


export const adminTestAiConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await ensureAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("ai_settings" as any)
      .select("api_key")
      .eq("id", 1)
      .maybeSingle();
    const key = (data as any)?.api_key || process.env.OPENAI_API_KEY;
    if (!key) return { ok: false, status: 0, error: "Nenhuma chave configurada." };
    try {
      const res = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (res.ok) {
        const j: any = await res.json().catch(() => ({}));
        return { ok: true, status: res.status, modelCount: Array.isArray(j?.data) ? j.data.length : undefined };
      }
      const txt = await res.text().catch(() => "");
      return { ok: false, status: res.status, error: txt.slice(0, 240) || `HTTP ${res.status}` };
    } catch (e: any) {
      return { ok: false, status: 0, error: e?.message ?? "network error" };
    }
  });

export const adminGetAiStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await ensureAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [processed, audios, images, last] = await Promise.all([
      supabaseAdmin.from("whatsapp_messages").select("*", { count: "exact", head: true }).not("ai_intent", "is", null),
      supabaseAdmin.from("whatsapp_messages").select("*", { count: "exact", head: true }).eq("media_type", "audio").eq("direction", "in"),
      supabaseAdmin.from("whatsapp_messages").select("*", { count: "exact", head: true }).eq("media_type", "image").eq("direction", "in"),
      supabaseAdmin
        .from("whatsapp_messages")
        .select("created_at")
        .not("ai_intent", "is", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    return {
      processed: processed.count ?? 0,
      audios: audios.count ?? 0,
      images: images.count ?? 0,
      lastUsed: (last.data as any)?.created_at ?? null,
    };
  });
