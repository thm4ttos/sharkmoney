// Webhook do Mercado Pago (assinatura/pagamento). Rota pública — mas,
// diferente da Appmax, o Mercado Pago ASSINA o corpo (header x-signature,
// HMAC-SHA256) — verifyMercadoPagoSignature() confirma autenticidade antes
// de processar qualquer coisa. Eventos com assinatura inválida são logados
// e ignorados, nunca ativam/cancelam uma assinatura.
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getPlan } from "@/lib/plans";
import { sendWhatsAppText } from "@/lib/uazapi.server";

const ok = (b: unknown = { ok: true }) =>
  new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });

export const Route = createFileRoute("/api/public/hooks/mercadopago-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => handle(request),
      GET: async ({ request }) => handle(request), // MP também pode chamar via query string (formato IPN legado)
    },
  },
});

async function handle(request: Request) {
  const url = new URL(request.url);
  let body: any = null;
  try { body = await request.json(); } catch { /* GET/IPN sem corpo */ }

  const dataId = body?.data?.id ?? url.searchParams.get("data.id") ?? url.searchParams.get("id");
  const type = body?.type ?? url.searchParams.get("type") ?? url.searchParams.get("topic");
  if (!dataId || !type) return ok({ ok: true, ignored: true });

  const { loadMercadoPagoCreds, verifyMercadoPagoSignature } = await import("@/lib/mercadopago.server");
  const creds = await loadMercadoPagoCreds();
  const validSig = verifyMercadoPagoSignature({
    xSignature: request.headers.get("x-signature"),
    xRequestId: request.headers.get("x-request-id"),
    dataId: String(dataId),
    secret: creds.webhookSecret,
  });

  const externalKey = `${type}:${dataId}`;
  const { data: logRow, error: logErr } = await supabaseAdmin
    .from("payment_webhook_events")
    .upsert(
      { provider: "mercadopago", event: String(type), event_type: String(type), external_key: externalKey, payload: body ?? { type, dataId }, verified: validSig },
      { onConflict: "provider,external_key", ignoreDuplicates: true },
    )
    .select()
    .maybeSingle();
  if (logErr) {
    console.error("[mercadopago-webhook] failed to log event", logErr);
    return ok({ ok: true });
  }
  if (!logRow) return ok({ ok: true, dedup: true }); // reenvio de evento já processado

  if (!validSig) {
    // Assinatura ausente/inválida — nunca confia num evento assim. Fica só
    // registrado pra investigação; nenhuma assinatura é ativada/cancelada.
    await supabaseAdmin.from("payment_webhook_events")
      .update({ processed_at: new Date().toISOString(), error: "assinatura x-signature inválida ou ausente" })
      .eq("id", logRow.id);
    return ok({ ok: true });
  }

  try {
    if (type === "subscription_preapproval") await handlePreapprovalEvent(String(dataId));
    else if (type === "subscription_authorized_payment") await handleAuthorizedPaymentEvent(String(dataId));
    else if (type === "payment") await handlePaymentEvent(String(dataId));
    await supabaseAdmin.from("payment_webhook_events").update({ processed_at: new Date().toISOString() }).eq("id", logRow.id);
  } catch (e: any) {
    console.error("[mercadopago-webhook] processing failed", type, e?.message ?? e);
    await supabaseAdmin.from("payment_webhook_events")
      .update({ processed_at: new Date().toISOString(), error: e?.message ?? String(e) })
      .eq("id", logRow.id);
    // Ainda responde 200: o erro já está registrado pra investigação manual,
    // e devolver 4xx/5xx só faria o Mercado Pago reenviar o mesmo evento problemático.
  }
  return ok({ ok: true });
}

async function handlePreapprovalEvent(preapprovalId: string) {
  const { getMercadoPagoSubscription } = await import("@/lib/mercadopago.server");
  const remote = await getMercadoPagoSubscription(preapprovalId);
  const status = String(remote?.status ?? "").toLowerCase();

  if (status === "authorized") {
    const { data: intent } = await supabaseAdmin
      .from("checkout_intents")
      .select("*")
      .eq("mp_preapproval_id", preapprovalId)
      .eq("status", "pending")
      .maybeSingle();
    if (!intent) return; // já processado (checkout síncrono) ou não é nosso.

    const plan = getPlan(intent.plan_slug);
    if (!plan) {
      await supabaseAdmin.from("checkout_intents").update({ status: "failed" }).eq("id", intent.id);
      return;
    }

    const now = new Date();
    const endsAt = new Date(now.getTime() + plan.durationDays * 86400_000).toISOString();
    await supabaseAdmin.from("subscriptions").insert({
      user_id: intent.user_id, plan_slug: plan.slug, plan_name: plan.name,
      period: plan.id === "six_months" ? "semiannual" : plan.id,
      status: "active", price_cents: Math.round(plan.totalPrice * 100),
      started_at: now.toISOString(), ends_at: endsAt,
      mp_preapproval_id: preapprovalId, payment_method: intent.payment_method,
    });
    await supabaseAdmin.from("profiles").update({ plan: plan.name, trial_ends_at: endsAt }).eq("id", intent.user_id);
    await supabaseAdmin.from("checkout_intents").update({ status: "completed" }).eq("id", intent.id);

    const { data: profile } = await supabaseAdmin.from("profiles").select("phone").eq("id", intent.user_id).maybeSingle();
    if (profile?.phone) {
      await sendWhatsAppText(profile.phone, `🎉 Pagamento confirmado! Seu ${plan.name} já está ativo no Abio.`);
    }
    return;
  }

  if (status === "cancelled" || status === "canceled") {
    await supabaseAdmin.from("subscriptions")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
      .eq("mp_preapproval_id", preapprovalId);
  }
}

/**
 * ⚠️ Fluxo de renovação recorrente (2ª cobrança em diante) — os nomes exatos
 * de campo abaixo (`preapproval_id` num pagamento, `next_payment_date` numa
 * preapproval) não vieram 100% confirmados verbatim na documentação
 * pesquisada; a leitura é defensiva (tenta os nomes mais prováveis, cai pra
 * "+1 mês a partir de agora" se não achar). PRECISA ser validado contra uma
 * assinatura real chegando na data de renovação em sandbox antes de confiar
 * cegamente nisso em produção.
 */
async function handleAuthorizedPaymentEvent(paymentId: string) {
  const { mpRequest, getMercadoPagoSubscription } = await import("@/lib/mercadopago.server");
  const payment = await mpRequest<any>("GET", `/v1/payments/${paymentId}`);
  const preapprovalId: string | null =
    payment?.preapproval_id ?? payment?.metadata?.preapproval_id
    ?? payment?.point_of_interaction?.transaction_data?.subscription_id ?? null;
  if (!preapprovalId) {
    console.warn("[mercadopago-webhook] pagamento recorrente sem preapproval_id reconhecido", paymentId, Object.keys(payment ?? {}));
    return;
  }

  const { data: sub } = await supabaseAdmin
    .from("subscriptions").select("*")
    .eq("mp_preapproval_id", preapprovalId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!sub) return;

  const approved = String(payment.status ?? "").toLowerCase() === "approved";
  if (!approved) {
    await supabaseAdmin.from("subscriptions").update({ status: "expired" }).eq("id", sub.id);
    const { data: profile } = await supabaseAdmin.from("profiles").select("phone").eq("id", sub.user_id).maybeSingle();
    if (profile?.phone) {
      await sendWhatsAppText(profile.phone,
        `⚠️ Não conseguimos renovar sua assinatura do Abio automaticamente. Atualize seu cartão em abio.fun/app/checkout?plan=${sub.plan_slug} pra continuar com acesso.`);
    }
    return;
  }

  const remote = await getMercadoPagoSubscription(preapprovalId);
  const nextChargeAt = (remote as any)?.next_payment_date ?? (remote as any)?.auto_recurring?.next_payment_date ?? null;
  const newEnds = nextChargeAt ? new Date(nextChargeAt).toISOString() : new Date(Date.now() + 30 * 86400_000).toISOString();
  await supabaseAdmin.from("subscriptions").update({ status: "active", ends_at: newEnds }).eq("id", sub.id);
  await supabaseAdmin.from("profiles").update({ trial_ends_at: newEnds }).eq("id", sub.user_id);
}

/**
 * Pagamento Pix avulso (não-recorrente) — confirmação chega no tópico
 * "payment" (não "subscription_authorized_payment", que é só pra cobranças
 * de assinatura de cartão). Se o pagamento não for Pix, ignora aqui: cobrança
 * recorrente de cartão já é tratada por handleAuthorizedPaymentEvent, e o
 * mesmo id de pagamento pode chegar nos dois tópicos.
 */
async function handlePaymentEvent(paymentId: string) {
  const { getMercadoPagoPayment } = await import("@/lib/mercadopago.server");
  const payment = await getMercadoPagoPayment(paymentId);
  if (payment.payment_method_id !== "pix") return;

  const intentId = payment.external_reference;
  if (!intentId) return;

  const { data: intent } = await supabaseAdmin
    .from("checkout_intents")
    .select("*")
    .eq("id", intentId)
    .eq("status", "pending")
    .maybeSingle();
  if (!intent) return; // já processado ou não é nosso.

  const approved = String(payment.status ?? "").toLowerCase() === "approved";
  if (!approved) {
    if (["cancelled", "rejected"].includes(String(payment.status ?? "").toLowerCase())) {
      await supabaseAdmin.from("checkout_intents").update({ status: "failed" }).eq("id", intent.id);
    }
    return;
  }

  const plan = getPlan(intent.plan_slug);
  if (!plan) {
    await supabaseAdmin.from("checkout_intents").update({ status: "failed" }).eq("id", intent.id);
    return;
  }

  const now = new Date();
  const endsAt = new Date(now.getTime() + plan.durationDays * 86400_000).toISOString();
  await supabaseAdmin.from("subscriptions").insert({
    user_id: intent.user_id, plan_slug: plan.slug, plan_name: plan.name,
    period: plan.id === "six_months" ? "semiannual" : plan.id,
    status: "active", price_cents: Math.round(plan.totalPrice * 100),
    started_at: now.toISOString(), ends_at: endsAt,
    mp_payment_id: String(payment.id), payment_method: "pix",
  });
  await supabaseAdmin.from("profiles").update({ plan: plan.name, trial_ends_at: endsAt }).eq("id", intent.user_id);
  await supabaseAdmin.from("checkout_intents").update({ status: "completed" }).eq("id", intent.id);

  const { data: profile } = await supabaseAdmin.from("profiles").select("phone").eq("id", intent.user_id).maybeSingle();
  if (profile?.phone) {
    await sendWhatsAppText(profile.phone, `🎉 Pagamento confirmado! Seu ${plan.name} já está ativo no Abio.`);
  }
}
