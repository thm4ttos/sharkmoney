// SERVER-ONLY. Health check de todos os subsistemas do Abio.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function ensureAdmin(supabase: any, userId: string) {
  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Error("Forbidden");
}

type Check = { name: string; ok: boolean; detail?: string; latencyMs?: number };

export const adminSystemHealth = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await ensureAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const results: Check[] = [];
    const t = () => Date.now();

    // 1) DB
    {
      const t0 = t();
      try {
        const { error } = await supabaseAdmin.from("profiles").select("id", { count: "exact", head: true }).limit(1);
        results.push({ name: "Banco de dados", ok: !error, detail: error?.message, latencyMs: t() - t0 });
      } catch (e: any) {
        results.push({ name: "Banco de dados", ok: false, detail: e?.message, latencyMs: t() - t0 });
      }
    }

    // 2) OpenAI
    {
      const t0 = t();
      try {
        const { data } = await supabaseAdmin.from("ai_settings" as any).select("api_key, enabled").eq("id", 1).maybeSingle();
        const key = (data as any)?.api_key || process.env.OPENAI_API_KEY;
        const enabled = (data as any)?.enabled !== false;
        if (!key) {
          results.push({ name: "OpenAI", ok: false, detail: "Sem chave configurada", latencyMs: t() - t0 });
        } else if (!enabled) {
          results.push({ name: "OpenAI", ok: false, detail: "Desativada no painel", latencyMs: t() - t0 });
        } else {
          const r = await fetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${key}` } });
          results.push({ name: "OpenAI", ok: r.ok, detail: r.ok ? "Chave válida" : `HTTP ${r.status}`, latencyMs: t() - t0 });
        }
      } catch (e: any) {
        results.push({ name: "OpenAI", ok: false, detail: e?.message, latencyMs: t() - t0 });
      }
    }

    // 3) Z-API status
    {
      const t0 = t();
      try {
        const { loadZapiCreds } = await import("@/lib/uazapi.server");
        const creds = await loadZapiCreds();
        if (!creds.instanceId || !creds.instanceToken || !creds.clientToken) {
          results.push({ name: "Z-API (credenciais)", ok: false, detail: `creds incompletas (source=${creds.source})`, latencyMs: t() - t0 });
        } else {
          const url = `https://api.z-api.io/instances/${creds.instanceId}/token/${creds.instanceToken}/status`;
          const r = await fetch(url, { headers: { "Client-Token": creds.clientToken } });
          const body = await r.text().catch(() => "");
          let connected = false;
          try { connected = !!JSON.parse(body)?.connected; } catch {}
          results.push({ name: "Z-API (instância)", ok: r.ok, detail: r.ok ? (connected ? "Conectada" : "Desconectada") : `HTTP ${r.status}`, latencyMs: t() - t0 });
          results.push({ name: "WhatsApp", ok: connected, detail: connected ? "Online" : "Aguardando QR Code", latencyMs: 0 });
        }
      } catch (e: any) {
        results.push({ name: "Z-API (instância)", ok: false, detail: e?.message, latencyMs: t() - t0 });
      }
    }

    // 4) Webhook (mensagens recebidas última hora)
    {
      const t0 = t();
      try {
        const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        const { count } = await supabaseAdmin
          .from("whatsapp_messages")
          .select("*", { count: "exact", head: true })
          .eq("direction", "in")
          .gte("created_at", since);
        results.push({ name: "Webhook (1h)", ok: true, detail: `${count ?? 0} mensagens recebidas`, latencyMs: t() - t0 });
      } catch (e: any) {
        results.push({ name: "Webhook (1h)", ok: false, detail: e?.message, latencyMs: t() - t0 });
      }
    }

    // 5) Server fn (sempre ok se chegou aqui)
    results.push({ name: "Server functions", ok: true, detail: "Operacionais" });

    const allOk = results.every((r) => r.ok);
    return { ok: allOk, checks: results, timestamp: new Date().toISOString() };
  });
