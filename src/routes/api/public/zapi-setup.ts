import { createFileRoute } from "@tanstack/react-router";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// Normaliza a base p/ "https://api.z-api.io/instances/<id>/token/<token>" sem sufixo.
function normalizeBase(raw: string): string {
  let b = raw.trim().replace(/\/+$/, "");
  b = b.replace(/\/(send-text|send-message|send-messages|send-image|send-audio|update-[a-z-]+|webhook[a-z-]*)$/i, "");
  return b;
}

async function zapiCall(method: "PUT" | "POST", base: string, clientToken: string, path: string, body: any) {
  const url = `${base}/${path}`;
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", "Client-Token": clientToken },
    body: JSON.stringify(body),
  });
  const text = await res.text().catch(() => "");
  return { method, path, status: res.status, ok: res.ok, body: text.slice(0, 200) };
}

// Authorize as admin via Supabase bearer token. The route lives under /api/public/*
// (which bypasses the published-site auth wall) so we MUST validate the caller here.
async function requireAdmin(request: Request): Promise<{ ok: true } | { ok: false; res: Response }> {
  const auth = request.headers.get("authorization") || "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!bearer) return { ok: false, res: json(401, { error: "unauthorized" }) };

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: userRes, error } = await supabaseAdmin.auth.getUser(bearer);
  if (error || !userRes?.user) return { ok: false, res: json(401, { error: "unauthorized" }) };

  const { data: isAdmin } = await supabaseAdmin.rpc("has_role", {
    _user_id: userRes.user.id,
    _role: "admin",
  });
  if (!isAdmin) return { ok: false, res: json(403, { error: "forbidden" }) };
  return { ok: true };
}

export const Route = createFileRoute("/api/public/zapi-setup")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const guard = await requireAdmin(request);
        if (!guard.ok) return guard.res;

        const expected = process.env.UAZAPI_WEBHOOK_TOKEN;
        const url = new URL(request.url);
        const baseRaw = process.env.UAZAPI_BASE_URL;
        const clientToken = process.env.UAZAPI_INSTANCE_TOKEN;
        if (!expected) return json(500, { error: "UAZAPI_WEBHOOK_TOKEN não configurado" });
        if (!baseRaw || !clientToken) return json(500, { error: "Z-API env não configurado" });

        const base = normalizeBase(baseRaw);
        const webhookUrl = `${url.origin}/api/public/whatsapp?token=${encodeURIComponent(expected)}`;

        const results: any[] = [];
        results.push(await zapiCall("PUT", base, clientToken, "update-webhook-received", { value: webhookUrl }));
        results.push(await zapiCall("PUT", base, clientToken, "update-every-webhooks", {
          value: webhookUrl,
          notifySentByMe: false,
        }).catch(() => null));

        // NUNCA retornar o token no corpo. Apenas pista mascarada e status dos updates.
        const masked = `${expected.slice(0, 4)}***`;
        return json(200, {
          ok: results.some((r) => r && r.ok),
          base,
          webhook_token_hint: masked,
          results: results.filter(Boolean).map((r: any) => ({
            path: r.path, status: r.status, ok: r.ok,
          })),
        });
      },
    },
  },
});
