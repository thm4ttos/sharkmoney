// Internal endpoint chamado em background pelo webhook do WhatsApp.
// Recebe o id da mensagem (já persistida em whatsapp_messages) e executa
// o pipeline pesado (IA, gravação, confirmação estruturada) sem bloquear
// o webhook original.
//
// Autenticação: header x-internal-token = UAZAPI_WEBHOOK_TOKEN.
// Se o worker de origem morrer antes de acionar este endpoint, o cron
// wa-reprocess (executado a cada minuto) recupera a mensagem.

import { createFileRoute } from "@tanstack/react-router";

const ok = (body: unknown = { ok: true }) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

const fail = (status: number, msg: string) =>
  new Response(JSON.stringify({ error: msg }), { status, headers: { "Content-Type": "application/json" } });

export const Route = createFileRoute("/api/public/hooks/wa-process")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.UAZAPI_WEBHOOK_TOKEN;
        const got = request.headers.get("x-internal-token");
        if (!expected || got !== expected) return fail(401, "invalid token");

        let body: any;
        try { body = await request.json(); } catch { return fail(400, "invalid json"); }
        const id = String(body?.id ?? "");
        if (!id) return fail(400, "missing id");

        try {
          const { processInboundMessage } = await import("@/lib/wa-processor.server");
          const t0 = Date.now();
          const result = await processInboundMessage(id);
          return ok({ durationMs: Date.now() - t0, ...result });
        } catch (e: any) {
          console.error("[wa-process] processor crashed", e);
          return ok({ ok: false, error: e?.message ?? "processor_error" });
        }
      },
    },
  },
});
