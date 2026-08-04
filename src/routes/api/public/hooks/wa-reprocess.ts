// Worker de reprocessamento de mensagens WhatsApp pendentes.
// Chamado via pg_cron (a cada minuto) e via botão no admin.
//
// Encontra mensagens inbound em status:
//   queued, error, send_error, transcribe_error, ai_error, reprocessing
// + 'processing' travado há mais de 2 minutos (rebaixado para reprocessing).
//
// Processa em série (1 por telefone por rodada) preservando ordem cronológica.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/wa-reprocess")({
  server: {
    handlers: {
      GET: async () => {
        const { reprocessPending, getPendingMessagesStats } = await import("@/lib/wa-processor.server");
        const stats = await getPendingMessagesStats();
        return Response.json({ ok: true, stats });
      },
      POST: async ({ request }) => {
        let limit = 25;
        try {
          const body = await request.json().catch(() => ({}));
          if (body?.limit) limit = Math.min(200, Math.max(1, Number(body.limit)));
        } catch {}
        const { reprocessPending } = await import("@/lib/wa-processor.server");
        const t0 = Date.now();
        const result = await reprocessPending({ limit });
        return Response.json({ ok: true, durationMs: Date.now() - t0, ...result });
      },
    },
  },
});
