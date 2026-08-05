import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { normalizePhone, phoneLookupVariants } from "@/lib/phone";
import { runInBackground } from "@/lib/wa-background.server";
import { extractWhatsappMedia } from "@/lib/wa-media";

const ok = (body: unknown = { ok: true }) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

const fail = (status: number, msg: string) =>
  new Response(JSON.stringify({ error: msg }), { status, headers: { "Content-Type": "application/json" } });

/**
 * REGRA: NÃO existe mais mensagem automática de "estou lendo/ouvindo/analisando".
 * O Shark Money interpreta primeiro, executa depois e só então responde — uma única
 * mensagem, já com o resultado. Qualquer ACK intermediário está proibido.
 */






export const Route = createFileRoute("/api/public/whatsapp")({
  server: {
    handlers: {
      GET: async () => ok({ ok: true, hint: "POST Z-API webhook here" }),
      POST: async ({ request }) => {
        const expected = process.env.UAZAPI_WEBHOOK_TOKEN;
        const got =
          request.headers.get("x-webhook-token") ||
          new URL(request.url).searchParams.get("token");
        if (!expected || got !== expected) return fail(401, "invalid token");

        let payload: any;
        try { payload = await request.json(); } catch { return fail(400, "invalid json"); }

        const envelope = payload?.data ?? payload;
        const msg = payload?.message ?? envelope?.message ?? envelope;
        const fromMe = !!(msg?.fromMe ?? envelope?.fromMe ?? payload?.fromMe ?? msg?.key?.fromMe);
        if (fromMe) return ok({ ignored: "fromMe" });

        const senderRaw =
          payload?.phone || envelope?.phone || msg?.phone ||
          msg?.sender || msg?.from || msg?.chatid || msg?.chatId ||
          msg?.key?.remoteJid || payload?.chat?.id || "";
        const phone = normalizePhone(String(senderRaw).split("@")[0]);
        if (!phone) return ok({ ignored: "no sender" });

        const media = extractWhatsappMedia(payload);
        const { text, audioUrl, imageUrl, imageCaption, documentUrl } = media;


        const rawMessageId =
          payload?.messageId || envelope?.messageId || msg?.messageId ||
          msg?.id || msg?.key?.id || crypto.randomUUID();

        console.log("[wa-webhook] stage=media_detected", {
          phone, msgId: rawMessageId, audio: !!audioUrl, image: !!imageUrl,
          document: media.hasDocument, documentUrl: !!documentUrl,
          documentMime: media.documentMime ?? null, documentName: media.documentName ?? null,
        });

        // Idempotência: rejeita mensagens já registradas (evita respostas duplicadas).
        const { data: existing } = await supabaseAdmin
          .from("whatsapp_messages")
          .select("id")
          .eq("raw_message_id", rawMessageId)
          .maybeSingle();
        if (existing) {
          await supabaseAdmin.from("wa_duplicate_log").insert({
            phone, raw_message_id: rawMessageId, reason: "duplicate_message_id",
            content: text ?? null, matched_message_id: existing.id,
          });
          return ok({ duplicate: true });
        }

        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("id, name, phone, status")
          .in("phone", phoneLookupVariants(phone))
          .maybeSingle();
        const replyPhone = phone;

        const mediaType = media.hasDocument ? "document" : imageUrl ? "image" : audioUrl ? "audio" : text ? "text" : "other";

        const { data: logRow, error: insertErr } = await supabaseAdmin
          .from("whatsapp_messages")
          .insert({
            user_id: profile?.id ?? null,
            phone,
            direction: "in",
            media_type: mediaType,
            content: text ?? imageCaption ?? null,
            raw: payload,
            raw_message_id: rawMessageId,
            status: "queued",
          })
          .select("id, created_at")
          .single();

        if (insertErr) {
          const code = (insertErr as any).code;
          if (code === "23505") {
            await supabaseAdmin.from("wa_duplicate_log").insert({
              user_id: profile?.id ?? null, phone, raw_message_id: rawMessageId,
              reason: "duplicate_message_id_race", content: text ?? null,
            });
            return ok({ duplicate: true, race: true });
          }
          console.error("[wa-webhook] insert error", insertErr);
          return ok({ insertError: true });
        }

        // Sem ACK: nada é enviado antes da interpretação completa.



        // ===== PROCESSAMENTO EM BACKGROUND (waitUntil) =====
        // Não bloqueia a resposta ao webhook. Marca status=processing para
        // evitar corrida com o cron watchdog.
        await supabaseAdmin.from("whatsapp_messages")
          .update({ status: "processing", processing_started_at: new Date().toISOString() })
          .eq("id", logRow!.id);

        runInBackground(async () => {
          try {
            const { processInboundMessage } = await import("@/lib/wa-processor.server");
            await processInboundMessage(logRow!.id);
          } catch (e: any) {
            console.error("[wa-webhook] background processor crashed", e);
            try {
              const { sendWhatsAppText } = await import("@/lib/uazapi.server");
              await sendWhatsAppText(
                replyPhone,
                "⚠️ Ocorreu um erro ao processar sua mensagem. Vou tentar novamente automaticamente.",
              );
            } catch {}
            await supabaseAdmin.from("whatsapp_messages")
              .update({ status: "error", last_error: (e?.message ?? "processor_error").slice(0, 500) })
              .eq("id", logRow!.id);
          }
        }, request);

        return ok({ accepted: true, id: logRow!.id });
      },
    },
  },
});
