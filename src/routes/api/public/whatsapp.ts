import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { normalizePhone, phoneLookupVariants } from "@/lib/phone";
import { extractWhatsappMedia } from "@/lib/wa-media";

const ok = (body: unknown = { ok: true }) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

const fail = (status: number, msg: string) =>
  new Response(JSON.stringify({ error: msg }), { status, headers: { "Content-Type": "application/json" } });

/**
 * REGRA: NÃO existe mais mensagem automática de "estou lendo/ouvindo/analisando".
 * O Abio interpreta primeiro, executa depois e só então responde — uma única
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

        // ===== ENFILEIRADO — processamento fica por conta do watchdog =====
        // Este runtime não entrega um `ctx.waitUntil` utilizável ao handler
        // (o Worker mata qualquer tarefa em segundo plano assim que a
        // Response é enviada) — confirmado via diagnóstico. Processar de
        // forma síncrona também não é viável: a Z-API já reenvia a mensagem
        // se não receber resposta em poucos segundos, bem menos tempo do que
        // uma classificação com imagem/PDF costuma levar.
        //
        // Por isso a mensagem fica "queued" e quem processa de verdade é o
        // watchdog `/api/public/hooks/wa-reprocess`, chamado via pg_cron a
        // cada ~30s — sem o prazo apertado do webhook.
        return ok({ accepted: true, id: logRow!.id, status: "queued" });
      },
    },
  },
});
