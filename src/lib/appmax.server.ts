// SERVER-ONLY. Cliente da API da Appmax (gateway de pagamento, assinatura
// recorrente). Endpoints e payloads verificados diretamente contra a
// documentação oficial (docs.appmax.com.br), incluindo o payload de
// `/v1/payments/credit-card` (`payment_data.credit_card: { token,
// holder_document_number, installments }`) e o contrato do Appmax.js
// (tokenização via formulário `data-appmax-checkout` no browser — ver
// `getAppmaxPublicConfig` em appmax.functions.ts e app.checkout.tsx).
//
// Credenciais: lidas da tabela `appmax_credentials` (editável só por admin,
// mesmo padrão de `zapi_credentials`/`loadZapiCreds`), com fallback pra
// process.env.APPMAX_CLIENT_ID / APPMAX_CLIENT_SECRET / APPMAX_ENV.
//
// Segurança: os webhooks da Appmax não têm assinatura HMAC nem token —
// por isso `getAppmaxOrder`/`getAppmaxSubscription` existem especificamente
// pra reconfirmar via GET qualquer evento recebido antes de ativar algo
// (ver src/routes/api/public/hooks/appmax-webhook.ts).

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type AppmaxEnv = "sandbox" | "production";

export type AppmaxCreds = {
  clientId: string;
  clientSecret: string;
  /** Identificador do "app" no Appstore da Appmax — exigido pelo Appmax.js no browser. Não é secreto. */
  externalId: string;
  /** UUID do app (aba "Identificação" no painel da Appmax) — exigido só pelo fluxo de instalação (/app/authorize). */
  appId: string;
  environment: AppmaxEnv;
  source: "db" | "env";
};

const CREDS_TTL_MS = 60_000;
let credsCache: { creds: AppmaxCreds; at: number } | null = null;
let tokenCache: { token: string; expiresAt: number; forCreds: string } | null = null;

export async function loadAppmaxCreds(): Promise<AppmaxCreds> {
  const now = Date.now();
  if (credsCache && now - credsCache.at < CREDS_TTL_MS) return credsCache.creds;

  try {
    const { data } = await supabaseAdmin
      .from("appmax_credentials")
      .select("client_id, client_secret, external_id, app_id, environment")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) {
      // A linha do banco pode existir com só o external_id preenchido (etapa
      // exigida pela Appmax antes mesmo do client_id/secret existirem) — por
      // isso não exige client_id/client_secret pra considerar a linha válida.
      const creds: AppmaxCreds = {
        clientId: data.client_id ?? "",
        clientSecret: data.client_secret ?? "",
        externalId: data.external_id ?? "",
        appId: data.app_id ?? "",
        environment: (data.environment as AppmaxEnv) ?? "sandbox",
        source: "db",
      };
      credsCache = { creds, at: now };
      return creds;
    }
  } catch (e) {
    console.warn("[appmax] failed to load creds from DB, falling back to env:", (e as any)?.message);
  }

  const creds: AppmaxCreds = {
    clientId: process.env.APPMAX_CLIENT_ID ?? "",
    clientSecret: process.env.APPMAX_CLIENT_SECRET ?? "",
    externalId: process.env.APPMAX_EXTERNAL_ID ?? "",
    appId: process.env.APPMAX_APP_ID ?? "",
    environment: (process.env.APPMAX_ENV as AppmaxEnv) ?? "sandbox",
    source: "env",
  };
  credsCache = { creds, at: now };
  return creds;
}

/** Invalida os caches de credenciais e token — chamar após salvar novas credenciais no admin. */
export function invalidateAppmaxCredsCache(): void {
  credsCache = null;
  tokenCache = null;
}

function authBase(env: AppmaxEnv) {
  return env === "production" ? "https://auth.appmax.com.br" : "https://auth.sandboxappmax.com.br";
}
function apiBase(env: AppmaxEnv) {
  return env === "production" ? "https://api.appmax.com.br" : "https://api.sandboxappmax.com.br";
}

export async function getAppmaxToken(): Promise<{ token: string; creds: AppmaxCreds }> {
  const creds = await loadAppmaxCreds();
  if (!creds.clientId || !creds.clientSecret) {
    throw new Error("Credenciais Appmax não configuradas.");
  }
  const cacheKey = `${creds.clientId}:${creds.environment}`;
  const now = Date.now();
  if (tokenCache && tokenCache.forCreds === cacheKey && now < tokenCache.expiresAt) {
    return { token: tokenCache.token, creds };
  }

  const res = await fetch(`${authBase(creds.environment)}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
    }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Appmax OAuth falhou (${res.status}): ${body.slice(0, 300)}`);
  const json = JSON.parse(body) as { access_token: string; expires_in: number };

  // Renova ~5min antes de vencer (token dura 1h e a Appmax não usa refresh token).
  tokenCache = {
    token: json.access_token,
    expiresAt: now + Math.max(60, json.expires_in - 300) * 1000,
    forCreds: cacheKey,
  };
  return { token: json.access_token, creds };
}

function installBase(env: AppmaxEnv) {
  return env === "production" ? "https://admin.appmax.com.br" : "https://breakingcode.sandboxappmax.com.br";
}

/**
 * Passo 2 do fluxo de instalação (docs.appmax.com.br/guides/instalacao.html):
 * troca o token de nível de APP (obtido com o client_id/secret salvos) por
 * uma "hash" de autorização, usando app_id (UUID do app) + external_key.
 * A forma exata do corpo da resposta não veio verbatim na documentação
 * pesquisada — por isso a busca do campo `hash` é defensiva e, se não achar,
 * devolve o corpo bruto pra inspeção em vez de falhar silenciosamente.
 */
export async function authorizeAppmaxInstall(callbackUrl: string): Promise<{ hash: string; redirectUrl: string; raw: any }> {
  const { token, creds } = await getAppmaxToken();
  if (!creds.appId) throw new Error("App ID (UUID do app na Appmax) não configurado.");
  const res = await fetch(`${apiBase(creds.environment)}/app/authorize`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ app_id: creds.appId, external_key: creds.externalId, url_callback: callbackUrl }),
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* ignore */ }
  if (!res.ok) throw new Error(`Appmax /app/authorize falhou (${res.status}): ${text.slice(0, 300)}`);
  // Confirmado em produção: o campo real é `data.token`, não `hash`.
  const hash = json?.data?.token ?? json?.token ?? json?.hash ?? json?.data?.hash ?? json?.authorization_hash ?? null;
  if (!hash) throw new Error(`Resposta sem campo "token"/"hash" reconhecido: ${text.slice(0, 500)}`);
  return { hash, redirectUrl: `${installBase(creds.environment)}/appstore/integration/${hash}`, raw: json };
}

/**
 * Passo 5 do fluxo: troca a hash (já autorizada pelo merchant via redirect
 * manual no navegador) pelas credenciais de MERCHANT — as únicas que
 * funcionam em /v1/customers, /v1/orders etc. Durante essa chamada a Appmax
 * dispara nossa URL de health-check pra validar a instalação.
 */
export async function generateAppmaxMerchantCreds(hash: string): Promise<{ clientId: string; clientSecret: string; raw: any }> {
  const { token, creds } = await getAppmaxToken();
  const res = await fetch(`${apiBase(creds.environment)}/app/client/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    // Envia sob os dois nomes possíveis (a Appmax chamou o campo de retorno
    // do /app/authorize de "token", não "hash" — o nome esperado aqui pode
    // seguir o mesmo padrão; campos extras desconhecidos costumam ser ignorados).
    body: JSON.stringify({ hash, token: hash }),
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* ignore */ }
  if (!res.ok) throw new Error(`Appmax /app/client/generate falhou (${res.status}): ${text.slice(0, 300)}`);
  const clientId = json?.client_id ?? json?.data?.client_id ?? null;
  const clientSecret = json?.client_secret ?? json?.data?.client_secret ?? null;
  if (!clientId || !clientSecret) throw new Error(`Resposta sem client_id/client_secret reconhecidos: ${text.slice(0, 500)}`);
  return { clientId, clientSecret, raw: json };
}

export async function appmaxRequest<T = any>(
  method: "GET" | "POST" | "PATCH",
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const { token, creds } = await getAppmaxToken();
  const url = `${apiBase(creds.environment)}${path}`;

  const doFetch = () =>
    fetch(url, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined,
    });

  let res = await doFetch();
  if (!res.ok && res.status >= 500) {
    // um retry simples pra falha transitória — checkout é síncrono com o usuário,
    // não vale a pena aplicar o backoff de 4 tentativas usado no envio de WhatsApp.
    res = await doFetch();
  }
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* ignore */ }
  if (!res.ok) {
    console.error(`[appmax] ${method} ${path} FAIL status=${res.status} body=${text.slice(0, 400)}`);
    throw new Error(`Appmax ${method} ${path} falhou (${res.status}): ${text.slice(0, 300)}`);
  }
  return (json ?? {}) as T;
}

export type AppmaxCustomer = { id: number; [k: string]: any };
export async function createAppmaxCustomer(input: {
  firstName: string; lastName: string; email: string; phone: string; ip?: string;
}): Promise<AppmaxCustomer> {
  return appmaxRequest("POST", "/v1/customers", {
    first_name: input.firstName,
    last_name: input.lastName,
    email: input.email,
    phone: input.phone,
    ip: input.ip ?? "0.0.0.0",
  });
}

export type AppmaxOrder = { id: number; order_id?: number; status: string; [k: string]: any };
export async function createAppmaxOrder(input: {
  customerId: number; sku: string; name: string; priceCents: number;
}): Promise<AppmaxOrder> {
  return appmaxRequest("POST", "/v1/orders", {
    customer_id: input.customerId,
    products_value: input.priceCents,
    discount_value: 0,
    shipping_value: 0,
    products: [{ sku: input.sku, name: input.name, quantity: 1, unit_value: input.priceCents, type: "digital" }],
  });
}

export type AppmaxPaymentResult = { status: string; [k: string]: any };

/** Payload confirmado em docs.appmax.com.br/api-reference/payments/cartao-credito.html. */
export async function payAppmaxOrderCreditCard(input: {
  orderId: number; cardToken: string; installments: number; documentNumber: string;
}): Promise<AppmaxPaymentResult> {
  return appmaxRequest("POST", "/v1/payments/credit-card", {
    order_id: input.orderId,
    payment_data: {
      credit_card: {
        token: input.cardToken,
        installments: input.installments,
        holder_document_number: input.documentNumber,
      },
    },
  });
}

export async function payAppmaxOrderPix(input: {
  orderId: number; documentNumber: string;
}): Promise<AppmaxPaymentResult & { pix_qrcode?: string; pix_emv?: string }> {
  return appmaxRequest("POST", "/v1/payments/pix", {
    order_id: input.orderId,
    payment_data: { pix: { document_number: input.documentNumber } },
  });
}

export type AppmaxSubscription = { id: number; next_charge_at?: string; [k: string]: any };
export async function createAppmaxSubscription(input: {
  orderId: number; intervalCount: number;
}): Promise<AppmaxSubscription> {
  return appmaxRequest("POST", "/v1/subscriptions", {
    order_id: input.orderId,
    interval: "month",
    interval_count: input.intervalCount,
  });
}

export async function cancelAppmaxSubscription(subscriptionId: number): Promise<AppmaxSubscription> {
  return appmaxRequest("PATCH", `/v1/subscriptions/${subscriptionId}/cancel`);
}

export async function getAppmaxOrder(orderId: number): Promise<AppmaxOrder> {
  return appmaxRequest("GET", `/v1/orders/${orderId}`);
}

export async function getAppmaxSubscription(subscriptionId: number): Promise<AppmaxSubscription> {
  return appmaxRequest("GET", `/v1/subscriptions/${subscriptionId}`);
}
