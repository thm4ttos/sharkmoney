// SERVER-ONLY. Cliente da API do Mercado Pago (gateway de pagamento,
// assinatura recorrente via Preapproval). Endpoints e payloads verificados
// diretamente contra a documentação oficial (mercadopago.com/developers):
// POST /preapproval_plan, POST /preapproval, PUT /preapproval/{id},
// GET /preapproval/{id}. Tokenização de cartão acontece no navegador via
// SDK JS (@mercadopago/sdk-js / Bricks) — o servidor só recebe o
// `card_token_id` já gerado, nunca o PAN/CVV (ver getMercadoPagoPublicConfig
// em mercadopago.functions.ts e app.checkout.tsx).
//
// Credenciais: lidas da tabela `mercadopago_credentials` (editável só por
// admin, mesmo padrão de `zapi_credentials`), com fallback pra
// process.env.MERCADOPAGO_ACCESS_TOKEN / MERCADOPAGO_PUBLIC_KEY /
// MERCADOPAGO_WEBHOOK_SECRET / MERCADOPAGO_ENV.
//
// Segurança: diferente da Appmax, o Mercado Pago ASSINA os webhooks
// (header x-signature, HMAC-SHA256) — verifyMercadoPagoSignature() confirma
// autenticidade antes de qualquer webhook ativar/cancelar uma assinatura
// (ver src/routes/api/public/hooks/mercadopago-webhook.ts).

import { createHmac, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type MercadoPagoEnv = "sandbox" | "production";

export type MercadoPagoCreds = {
  accessToken: string;
  publicKey: string;
  webhookSecret: string;
  environment: MercadoPagoEnv;
  source: "db" | "env";
};

const CREDS_TTL_MS = 60_000;
let credsCache: { creds: MercadoPagoCreds; at: number } | null = null;

export async function loadMercadoPagoCreds(): Promise<MercadoPagoCreds> {
  const now = Date.now();
  if (credsCache && now - credsCache.at < CREDS_TTL_MS) return credsCache.creds;

  try {
    const { data } = await supabaseAdmin
      .from("mercadopago_credentials")
      .select("access_token, public_key, webhook_secret, environment")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) {
      const creds: MercadoPagoCreds = {
        accessToken: data.access_token ?? "",
        publicKey: data.public_key ?? "",
        webhookSecret: data.webhook_secret ?? "",
        environment: (data.environment as MercadoPagoEnv) ?? "sandbox",
        source: "db",
      };
      credsCache = { creds, at: now };
      return creds;
    }
  } catch (e) {
    console.warn("[mercadopago] failed to load creds from DB, falling back to env:", (e as any)?.message);
  }

  const creds: MercadoPagoCreds = {
    accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN ?? "",
    publicKey: process.env.MERCADOPAGO_PUBLIC_KEY ?? "",
    webhookSecret: process.env.MERCADOPAGO_WEBHOOK_SECRET ?? "",
    environment: (process.env.MERCADOPAGO_ENV as MercadoPagoEnv) ?? "sandbox",
    source: "env",
  };
  credsCache = { creds, at: now };
  return creds;
}

/** Invalida o cache de credenciais — chamar após salvar novas credenciais no admin. */
export function invalidateMercadoPagoCredsCache(): void {
  credsCache = null;
}

// A API do Mercado Pago usa o MESMO host pra teste e produção — o que muda é
// o access_token (TEST-... vs credencial de produção), não a URL.
const API_BASE = "https://api.mercadopago.com";

export async function mpRequest<T = any>(
  method: "GET" | "POST" | "PUT",
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const creds = await loadMercadoPagoCreds();
  if (!creds.accessToken) throw new Error("Credenciais Mercado Pago não configuradas.");

  const doFetch = () =>
    fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${creds.accessToken}`,
        // Confirmado na doc oficial (subscriptions/.../authorized-payments):
        // requisições com credenciais de teste precisam desse header pra
        // achar o card_token_id (também gerado em modo teste) — sem ele,
        // /preapproval procura o token no escopo de produção e devolve
        // "Card token service not found" mesmo com um token válido.
        ...(creds.environment === "sandbox" ? { "X-scope": "stage" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

  let res = await doFetch();
  if (!res.ok && res.status >= 500) {
    // um retry simples pra falha transitória — checkout é síncrono com o usuário.
    res = await doFetch();
  }
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* ignore */ }
  if (!res.ok) {
    console.error(`[mercadopago] ${method} ${path} FAIL status=${res.status} body=${text.slice(0, 400)}`);
    throw new Error(`Mercado Pago ${method} ${path} falhou (${res.status}): ${text.slice(0, 300)}`);
  }
  return (json ?? {}) as T;
}

export type MercadoPagoPlan = { id: string; status?: string; [k: string]: any };

/**
 * Cria o "molde" de assinatura recorrente pra um plano do Abio — feito uma
 * única vez por plano (mensal/semestral/anual), sob demanda, no primeiro
 * checkout; o id retornado (`plans.mp_plan_id`) é reaproveitado depois.
 * Payload confirmado em developers.mercadopago.com/.../subscription-associated-plan.
 */
export async function createMercadoPagoPlan(input: {
  reason: string; amountCents: number; frequency: number; backUrl: string;
}): Promise<MercadoPagoPlan> {
  return mpRequest("POST", "/preapproval_plan", {
    reason: input.reason,
    auto_recurring: {
      frequency: input.frequency,
      frequency_type: "months",
      transaction_amount: input.amountCents / 100,
      currency_id: "BRL",
    },
    back_url: input.backUrl,
  });
}

export type MercadoPagoSubscription = { id: string; status: string; [k: string]: any };

/**
 * Cria a assinatura de um usuário vinculada a um plano já existente —
 * `card_token_id` vem da tokenização feita no navegador (SDK JS), nunca do
 * nosso servidor. `status: "authorized"` pede pro Mercado Pago já tentar
 * cobrar a primeira mensalidade na hora (resolve síncrono, mesmo padrão do
 * checkout de cartão da Appmax).
 */
export async function createMercadoPagoSubscription(input: {
  planId: string; cardTokenId: string; payerEmail: string; externalReference: string;
  amountCents: number; frequency: number; backUrl: string;
}): Promise<MercadoPagoSubscription> {
  return mpRequest("POST", "/preapproval", {
    preapproval_plan_id: input.planId,
    reason: "Assinatura Abio",
    external_reference: input.externalReference,
    payer_email: input.payerEmail,
    card_token_id: input.cardTokenId,
    auto_recurring: {
      frequency: input.frequency,
      frequency_type: "months",
      transaction_amount: input.amountCents / 100,
      currency_id: "BRL",
    },
    back_url: input.backUrl,
    status: "authorized",
  });
}

export async function getMercadoPagoSubscription(id: string): Promise<MercadoPagoSubscription> {
  return mpRequest("GET", `/preapproval/${id}`);
}

export async function cancelMercadoPagoSubscription(id: string): Promise<MercadoPagoSubscription> {
  // Valor exato confirmado na doc oficial: "canceled" (grafia americana, um só L).
  return mpRequest("PUT", `/preapproval/${id}`, { status: "canceled" });
}

/**
 * Verifica o header x-signature (HMAC-SHA256) que o Mercado Pago manda em
 * todo webhook — diferente da Appmax, dá pra confirmar autenticidade sem
 * precisar reconsultar a API. Formato confirmado na doc oficial:
 * manifest = "id:{data.id};request-id:{x-request-id};ts:{ts};",
 * comparado em tempo constante contra o v1 do header.
 */
export function verifyMercadoPagoSignature(input: {
  xSignature: string | null; xRequestId: string | null; dataId: string; secret: string;
}): boolean {
  if (!input.xSignature || !input.secret) return false;
  const parts: Record<string, string> = {};
  for (const p of input.xSignature.split(",")) {
    const [k, v] = p.split("=");
    if (k && v) parts[k.trim()] = v.trim();
  }
  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1) return false;
  const manifest = `id:${input.dataId};request-id:${input.xRequestId ?? ""};ts:${ts};`;
  const computed = createHmac("sha256", input.secret).update(manifest).digest("hex");
  const a = Buffer.from(computed, "hex");
  const b = Buffer.from(v1, "hex");
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Cancela na Mercado Pago e marca como `cancelled` localmente qualquer
 * assinatura ainda `active` do usuário além da que acabou de ser criada —
 * mesma proteção contra cobrança dupla já aplicada pra Appmax (upgrade de
 * plano nunca pode deixar duas assinaturas cobrando em paralelo).
 */
export async function supersedeActiveMercadoPagoSubscriptions(userId: string, keepPreapprovalId?: string): Promise<void> {
  const { data: rows } = await supabaseAdmin
    .from("subscriptions")
    .select("id, mp_preapproval_id")
    .eq("user_id", userId)
    .eq("status", "active")
    .not("mp_preapproval_id", "is", null);
  for (const row of rows ?? []) {
    if (keepPreapprovalId && row.mp_preapproval_id === keepPreapprovalId) continue;
    try {
      await cancelMercadoPagoSubscription(row.mp_preapproval_id as string);
    } catch (e) {
      console.error("[mercadopago] falha ao cancelar assinatura substituída", row.id, e);
    }
    await supabaseAdmin.from("subscriptions")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
      .eq("id", row.id);
  }
}
