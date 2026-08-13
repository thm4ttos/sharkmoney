// Health-check exigido pela Appmax pra validar a instalação do app privado
// do Abio (configurado em "URL de validação / Health check" no painel deles).
// Requisito deles: responder com o campo `external_id` (mesmo UUID usado no
// Appmax.js — ver getAppmaxPublicConfig em appmax.functions.ts), formato UUID,
// não pode ser um valor fixo hardcoded no código-fonte — por isso ele vem da
// mesma fonte (tabela `appmax_credentials`, com fallback de env var) que
// alimenta o checkout, garantindo que os dois lados sempre concordem.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/appmax-health")({
  server: {
    handlers: {
      GET: async () => handle(),
      POST: async () => handle(),
    },
  },
});

async function handle() {
  const { loadAppmaxCreds } = await import("@/lib/appmax.server");
  const creds = await loadAppmaxCreds();
  return new Response(
    JSON.stringify({ status: "ok", external_id: creds.externalId || null }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}
