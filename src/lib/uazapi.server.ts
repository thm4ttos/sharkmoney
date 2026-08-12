// SERVER-ONLY. Envio WhatsApp via Z-API.
// Lê credenciais da tabela `zapi_credentials` (mesma fonte usada pelo envio manual do admin)
// com fallback para process.env.UAZAPI_BASE_URL / UAZAPI_INSTANCE_TOKEN.
//
// Endpoint Z-API: https://api.z-api.io/instances/<ID>/token/<TOKEN>/send-text
// Header obrigatório: Client-Token: <CLIENT_TOKEN da conta>

import { supabaseAdmin } from "@/integrations/supabase/client.server";

const MAX_ATTEMPTS = 4;
const BASE_DELAY_MS = 500;

function isRetryableStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status < 600);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type ZapiCreds = {
  instanceId: string;
  instanceToken: string;
  clientToken: string;
  source: "db" | "env" | "mixed";
};

// Credenciais mudam raramente (só quando o admin reconecta a instância) mas
// eram buscadas no banco a CADA mensagem enviada — 1 round-trip extra em toda
// resposta do WhatsApp. Cache curto em memória elimina essa espera na maioria
// das vezes; 60s é seguro porque uma reconexão real também exige nova ligação
// do WhatsApp, que não é instantânea.
const CREDS_TTL_MS = 60_000;
let credsCache: { creds: ZapiCreds; at: number } | null = null;

export async function loadZapiCreds(): Promise<ZapiCreds> {
  const now = Date.now();
  if (credsCache && now - credsCache.at < CREDS_TTL_MS) return credsCache.creds;

  // 1) Tenta DB (mesma fonte do envio manual)
  try {
    const { data } = await supabaseAdmin
      .from("zapi_credentials")
      .select("instance_id, instance_token, client_token")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data?.instance_id && data?.instance_token && data?.client_token) {
      const creds: ZapiCreds = {
        instanceId: data.instance_id,
        instanceToken: data.instance_token,
        clientToken: data.client_token,
        source: "db",
      };
      credsCache = { creds, at: now };
      return creds;
    }
  } catch (e) {
    console.warn("[zapi] failed to load creds from DB, falling back to env:", (e as any)?.message);
  }

  // 2) Fallback env
  const base = process.env.UAZAPI_BASE_URL ?? "";
  const m = base.match(/instances\/([^/]+)\/token\/([^/]+)/);
  const creds: ZapiCreds = {
    instanceId: m?.[1] ?? "",
    instanceToken: m?.[2] ?? "",
    clientToken: process.env.UAZAPI_INSTANCE_TOKEN ?? "",
    source: "env",
  };
  credsCache = { creds, at: now };
  return creds;
}

/** Invalida o cache — chamar depois que o admin salvar novas credenciais Z-API. */
export function invalidateZapiCredsCache(): void {
  credsCache = null;
}

export type SendResult = {
  ok: boolean;
  status?: number;
  url: string;
  response?: any;
  error?: string;
  credsSource: ZapiCreds["source"];
};

export async function sendWhatsAppText(toPhone: string, text: string): Promise<SendResult> {
  const creds = await loadZapiCreds();
  if (!creds.instanceId || !creds.instanceToken || !creds.clientToken) {
    const err = `Z-API creds ausentes (source=${creds.source}, hasId=${!!creds.instanceId}, hasToken=${!!creds.instanceToken}, hasClientToken=${!!creds.clientToken})`;
    console.error("[zapi] " + err);
    return { ok: false, url: "", error: err, credsSource: creds.source };
  }

  const url = `https://api.z-api.io/instances/${creds.instanceId}/token/${creds.instanceToken}/send-text`;
  console.log(`[zapi] send-text → ${toPhone} (creds=${creds.source}, instance=${creds.instanceId}, textLen=${text.length})`);

  let lastErr: any = null;
  let lastStatus: number | undefined;
  let lastBody: string | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Client-Token": creds.clientToken },
        body: JSON.stringify({ phone: toPhone, message: text }),
      });

      const body = await res.text().catch(() => "");
      lastStatus = res.status;
      lastBody = body;

      let json: any = null;
      try { json = JSON.parse(body); } catch { /* ignore */ }

      if (res.ok) {
        console.log(`[zapi] send-text OK attempt=${attempt} status=${res.status} resp=${body.slice(0, 200)}`);
        return { ok: true, status: res.status, url, response: json ?? { raw: body }, credsSource: creds.source };
      }

      console.error(`[zapi] send-text FAIL attempt=${attempt}/${MAX_ATTEMPTS} status=${res.status} body=${body.slice(0, 300)}`);

      if (res.status === 401 || res.status === 403) {
        return { ok: false, status: res.status, url, response: json ?? { raw: body }, error: "ZAPI_CLIENT_TOKEN_INVALID", credsSource: creds.source };
      }
      if (!isRetryableStatus(res.status)) {
        return { ok: false, status: res.status, url, response: json ?? { raw: body }, error: `ZAPI_SEND_FAILED_${res.status}`, credsSource: creds.source };
      }
      lastErr = new Error(`ZAPI_SEND_FAILED_${res.status}`);
    } catch (err: any) {
      console.error(`[zapi] send-text NETWORK ERROR attempt=${attempt}/${MAX_ATTEMPTS}:`, err?.message || err);
      lastErr = err;
    }

    if (attempt < MAX_ATTEMPTS) {
      await sleep(BASE_DELAY_MS * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 200));
    }
  }

  return {
    ok: false,
    status: lastStatus,
    url,
    response: lastBody ? { raw: lastBody } : null,
    error: lastErr?.message ?? "ZAPI_SEND_FAILED_RETRY_EXHAUSTED",
    credsSource: creds.source,
  };
}

export type WhatsAppButton = { id: string; label: string };

/**
 * Botões de resposta rápida (WhatsApp, via Z-API send-button-list). Máximo
 * 3 botões (limite da própria plataforma WhatsApp). A Z-API documenta
 * instabilidade nesse recurso e exige aceite prévio dos "termos de uso dos
 * botões" no painel deles — por isso NUNCA chame isso diretamente num fluxo
 * que precisa de garantia de entrega; use sempre `sendReplyWithOptions`,
 * que cai automaticamente pra texto puro se isso falhar por qualquer motivo.
 */
export async function sendWhatsAppButtons(toPhone: string, message: string, buttons: WhatsAppButton[]): Promise<SendResult> {
  const creds = await loadZapiCreds();
  if (!creds.instanceId || !creds.instanceToken || !creds.clientToken) {
    const err = `Z-API creds ausentes (source=${creds.source}, hasId=${!!creds.instanceId}, hasToken=${!!creds.instanceToken}, hasClientToken=${!!creds.clientToken})`;
    console.error("[zapi] " + err);
    return { ok: false, url: "", error: err, credsSource: creds.source };
  }

  const url = `https://api.z-api.io/instances/${creds.instanceId}/token/${creds.instanceToken}/send-button-list`;
  console.log(`[zapi] send-button-list → ${toPhone} (creds=${creds.source}, instance=${creds.instanceId}, buttons=${buttons.length})`);

  let lastErr: any = null;
  let lastStatus: number | undefined;
  let lastBody: string | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Client-Token": creds.clientToken },
        body: JSON.stringify({
          phone: toPhone, message,
          buttonList: { buttons: buttons.map((b) => ({ id: b.id, label: b.label })) },
        }),
      });

      const body = await res.text().catch(() => "");
      lastStatus = res.status;
      lastBody = body;

      let json: any = null;
      try { json = JSON.parse(body); } catch { /* ignore */ }

      if (res.ok) {
        console.log(`[zapi] send-button-list OK attempt=${attempt} status=${res.status} resp=${body.slice(0, 200)}`);
        return { ok: true, status: res.status, url, response: json ?? { raw: body }, credsSource: creds.source };
      }

      console.error(`[zapi] send-button-list FAIL attempt=${attempt}/${MAX_ATTEMPTS} status=${res.status} body=${body.slice(0, 300)}`);

      if (res.status === 401 || res.status === 403) {
        return { ok: false, status: res.status, url, response: json ?? { raw: body }, error: "ZAPI_CLIENT_TOKEN_INVALID", credsSource: creds.source };
      }
      if (!isRetryableStatus(res.status)) {
        return { ok: false, status: res.status, url, response: json ?? { raw: body }, error: `ZAPI_SEND_FAILED_${res.status}`, credsSource: creds.source };
      }
      lastErr = new Error(`ZAPI_SEND_FAILED_${res.status}`);
    } catch (err: any) {
      console.error(`[zapi] send-button-list NETWORK ERROR attempt=${attempt}/${MAX_ATTEMPTS}:`, err?.message || err);
      lastErr = err;
    }

    if (attempt < MAX_ATTEMPTS) {
      await sleep(BASE_DELAY_MS * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 200));
    }
  }

  return {
    ok: false,
    status: lastStatus,
    url,
    response: lastBody ? { raw: lastBody } : null,
    error: lastErr?.message ?? "ZAPI_SEND_FAILED_RETRY_EXHAUSTED",
    credsSource: creds.source,
  };
}

/**
 * Envia uma pergunta com botões de resposta rápida (até 3 opções) e cai
 * automaticamente pra texto puro (opções listadas inline) se o envio de
 * botão falhar por qualquer motivo — token/ToS de botões não aceito no
 * painel da Z-API, instabilidade documentada da própria Z-API nesse
 * recurso, erro de rede, etc. O fluxo do usuário NUNCA trava esperando um
 * botão: digitar o rótulo da opção sempre funciona igual a tocar nela,
 * então cair pra texto não muda o resultado, só a forma de responder.
 * Sem `options` (null/undefined), comportamento idêntico a `sendWhatsAppText`.
 */
export async function sendReplyWithOptions(toPhone: string, text: string, options?: WhatsAppButton[] | null): Promise<SendResult> {
  if (options && options.length >= 2 && options.length <= 3) {
    const res = await sendWhatsAppButtons(toPhone, text, options);
    if (res.ok) return res;
  }
  const fallbackText = options && options.length
    ? `${text}\n\nResponda: ${options.map((o) => o.label).join(" / ")}`
    : text;
  return sendWhatsAppText(toPhone, fallbackText);
}

export async function sendWhatsAppImage(toPhone: string, imageUrl: string, caption?: string): Promise<SendResult> {
  const creds = await loadZapiCreds();
  if (!creds.instanceId || !creds.instanceToken || !creds.clientToken) {
    const err = `Z-API creds ausentes (source=${creds.source}, hasId=${!!creds.instanceId}, hasToken=${!!creds.instanceToken}, hasClientToken=${!!creds.clientToken})`;
    console.error("[zapi] " + err);
    return { ok: false, url: "", error: err, credsSource: creds.source };
  }

  const url = `https://api.z-api.io/instances/${creds.instanceId}/token/${creds.instanceToken}/send-image`;
  console.log(`[zapi] send-image → ${toPhone} (creds=${creds.source}, instance=${creds.instanceId})`);

  let lastErr: any = null;
  let lastStatus: number | undefined;
  let lastBody: string | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Client-Token": creds.clientToken },
        body: JSON.stringify({ phone: toPhone, image: imageUrl, caption: caption ?? "" }),
      });

      const body = await res.text().catch(() => "");
      lastStatus = res.status;
      lastBody = body;

      let json: any = null;
      try { json = JSON.parse(body); } catch { /* ignore */ }

      if (res.ok) {
        console.log(`[zapi] send-image OK attempt=${attempt} status=${res.status} resp=${body.slice(0, 200)}`);
        return { ok: true, status: res.status, url, response: json ?? { raw: body }, credsSource: creds.source };
      }

      console.error(`[zapi] send-image FAIL attempt=${attempt}/${MAX_ATTEMPTS} status=${res.status} body=${body.slice(0, 300)}`);

      if (res.status === 401 || res.status === 403) {
        return { ok: false, status: res.status, url, response: json ?? { raw: body }, error: "ZAPI_CLIENT_TOKEN_INVALID", credsSource: creds.source };
      }
      if (!isRetryableStatus(res.status)) {
        return { ok: false, status: res.status, url, response: json ?? { raw: body }, error: `ZAPI_SEND_FAILED_${res.status}`, credsSource: creds.source };
      }
      lastErr = new Error(`ZAPI_SEND_FAILED_${res.status}`);
    } catch (err: any) {
      console.error(`[zapi] send-image NETWORK ERROR attempt=${attempt}/${MAX_ATTEMPTS}:`, err?.message || err);
      lastErr = err;
    }

    if (attempt < MAX_ATTEMPTS) {
      await sleep(BASE_DELAY_MS * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 200));
    }
  }

  return {
    ok: false,
    status: lastStatus,
    url,
    response: lastBody ? { raw: lastBody } : null,
    error: lastErr?.message ?? "ZAPI_SEND_FAILED_RETRY_EXHAUSTED",
    credsSource: creds.source,
  };
}
