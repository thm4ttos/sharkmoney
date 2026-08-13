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
      .select("client_id, client_secret, external_id, environment")
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
