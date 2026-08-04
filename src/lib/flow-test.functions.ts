import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function ensureAdmin(supabase: any, userId: string) {
  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Error("Forbidden");
}

/**
 * Executa o fluxo completo: classifica (OpenAI) -> envia WhatsApp (mesma função do auto-reply).
 * Retorna log passo-a-passo para diagnóstico.
 */
export const adminTestFullFlow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      phone: z.string().min(10).max(20),
      message: z.string().min(1).max(500),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await ensureAdmin(supabase, userId);

    const steps: Array<{ step: string; ok: boolean; detail: any }> = [];
    const t0 = Date.now();

    // 1) Classificar via OpenAI
    let intent: any = null;
    let replyText = "";
    try {
      const { classifyMessage, chatReply } = await import("@/lib/ai-classify.server");
      intent = await classifyMessage(data.message, []);
      steps.push({ step: "openai_classify", ok: true, detail: { intent, ms: Date.now() - t0 } });

      replyText = await chatReply(data.message, "Teste", []);
      steps.push({ step: "openai_reply", ok: true, detail: { len: replyText.length, preview: replyText.slice(0, 200) } });
    } catch (e: any) {
      steps.push({ step: "openai", ok: false, detail: { error: e?.message ?? String(e) } });
      return { ok: false, steps };
    }

    // 2) Carregar credenciais Z-API (mesma fonte do envio manual)
    const { loadZapiCreds, sendWhatsAppText } = await import("@/lib/uazapi.server");
    const creds = await loadZapiCreds();
    steps.push({
      step: "load_creds",
      ok: !!(creds.instanceId && creds.instanceToken && creds.clientToken),
      detail: {
        source: creds.source,
        instanceId: creds.instanceId ? creds.instanceId.slice(0, 6) + "…" : null,
        hasInstanceToken: !!creds.instanceToken,
        hasClientToken: !!creds.clientToken,
      },
    });

    // 3) Enviar via mesma função do auto-reply
    const sendResult = await sendWhatsAppText(data.phone, `[TESTE FLUXO] ${replyText}`);
    steps.push({
      step: "send_whatsapp",
      ok: sendResult.ok,
      detail: {
        status: sendResult.status,
        credsSource: sendResult.credsSource,
        url: sendResult.url,
        error: sendResult.error,
        response: sendResult.response,
      },
    });

    // 4) Registrar no histórico
    await supabaseAdmin.from("whatsapp_messages").insert({
      user_id: null,
      phone: data.phone,
      direction: "out",
      media_type: "text",
      content: `[TESTE FLUXO] ${replyText}`,
      status: sendResult.ok ? "sent" : "send_error",
      raw: { test: true, steps } as any,
    });

    return { ok: sendResult.ok, steps, totalMs: Date.now() - t0 };
  });
