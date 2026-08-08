// Watchdog dos disparos em massa do Admin > WhatsApp. Chamado via pg_cron a
// cada ~20s (mesmo padrão do wa-reprocess) — processa um lote pequeno de
// destinatários pendentes por vez, nunca a fila inteira numa única chamada.
import { createFileRoute } from "@tanstack/react-router";
import { processWaBroadcastBatch } from "@/lib/wa-broadcast.server";

const ok = (b: unknown = { ok: true }) =>
  new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });
const fail = (s: number, m: string) =>
  new Response(JSON.stringify({ error: m }), { status: s, headers: { "Content-Type": "application/json" } });

export const Route = createFileRoute("/api/public/hooks/wa-broadcast-process")({
  server: {
    handlers: {
      GET: async ({ request }) => handle(request),
      POST: async ({ request }) => handle(request),
    },
  },
});

async function handle(request: Request) {
  const url = new URL(request.url);
  const apikey = request.headers.get("apikey") || url.searchParams.get("apikey");
  const tok = request.headers.get("x-webhook-token") || url.searchParams.get("token");
  const validApi = !!apikey && apikey === (process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY);
  const validTok = !!tok && tok === process.env.UAZAPI_WEBHOOK_TOKEN;
  if (!validApi && !validTok) return fail(401, "unauthorized");

  try {
    const result = await processWaBroadcastBatch(20);
    return ok(result);
  } catch (e: any) {
    console.error("[wa-broadcast-process] error", e);
    return fail(500, e?.message ?? "internal error");
  }
}
