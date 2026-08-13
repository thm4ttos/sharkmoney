// Webhook da Appmax (pagamento/assinatura). Rota pública — a Appmax não
// assina nem autentica o corpo do webhook (confirmado na documentação
// oficial deles), então NUNCA confiamos direto no que chega aqui: todo
// evento é logado com dedupe (a Appmax reenvia até 4x o mesmo evento) e
// reconfirmado via GET na API deles antes de ativar/cancelar qualquer coisa.
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getAppmaxOrder, getAppmaxSubscription } from "@/lib/appmax.server";
import { getPlan } from "@/lib/plans";
import { sendWhatsAppText } from "@/lib/uazapi.server";

const ok = (b: unknown = { ok: true }) =>
  new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });
const fail = (s: number, m: string) =>
  new Response(JSON.stringify({ error: m }), { status: s, headers: { "Content-Type": "application/json" } });

const ORDER_PAID_EVENTS = new Set(["order_approved", "order_paid", "order_paid_by_pix"]);
const ORDER_FAILED_EVENTS = new Set(["order_refused_by_risk", "payment_not_authorized"]);

export const Route = createFileRoute("/api/public/hooks/appmax-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => handle(request),
    },
  },
});

async function handle(request: Request) {
  let envelope: any = null;
  try {
    envelope = await request.json();
  } catch {
    return fail(400, "invalid json");
  }
  const event = String(envelope?.event ?? "");
  const eventType = envelope?.event_type ? String(envelope.event_type) : null;
  const data = envelope?.data ?? {};
  if (!event) return fail(400, "missing event");

  const orderId: number | null = data.order_id ?? null;
  const subscriptionId: number | null = data.subscription_id ?? null;
  const externalKey = orderId != null ? `${event}:order:${orderId}`
    : subscriptionId != null ? `${event}:sub:${subscriptionId}`
    : null;

  const { data: logRow, error: logErr } = await supabaseAdmin
    .from("payment_webhook_events")
    .upsert(
      { provider: "appmax", event, event_type: eventType, external_key: externalKey, payload: envelope },
      { onConflict: "provider,external_key", ignoreDuplicates: true },
    )
    .select()
    .maybeSingle();
  if (logErr) {
    console.error("[appmax-webhook] failed to log event", logErr);
    return fail(500, logErr.message);
  }
  if (!logRow) {
    // Reenvio de um evento já processado (dedupe por external_key) — a Appmax
    // tenta até 4x o mesmo evento; responder 200 sem reprocessar é o correto.
    return ok({ ok: true, dedup: true });
  }

  try {
    if (orderId != null && (ORDER_PAID_EVENTS.has(event) || ORDER_FAILED_EVENTS.has(event))) {
      await handleOrderEvent(event, orderId);
    } else if (subscriptionId != null) {
      await handleSubscriptionEvent(event, subscriptionId);
    }
    await supabaseAdmin.from("payment_webhook_events")
      .update({ verified: true, processed_at: new Date().toISOString() })
      .eq("id", logRow.id);
  } catch (e: any) {
    console.error("[appmax-webhook] processing failed", event, e?.message ?? e);
    await supabaseAdmin.from("payment_webhook_events")
      .update({ processed_at: new Date().toISOString(), error: e?.message ?? String(e) })
      .eq("id", logRow.id);
    // Ainda responde 200: o erro já está registrado pra investigação manual,
    // e devolver 4xx/5xx só faria a Appmax reenviar o mesmo evento problemático.
  }
  return ok({ ok: true });
}

async function handleOrderEvent(event: string, orderId: number) {
  // Reconfirma via GET — nunca confia no status que veio dentro do webhook.
  const order = await getAppmaxOrder(orderId);
  const orderStatus = String(order.status ?? "").toLowerCase();
  const reallyApproved = /aprovad|approved|paid|integrado/.test(orderStatus);

  const { data: intent } = await supabaseAdmin
    .from("checkout_intents")
    .select("*")
    .eq("appmax_order_id", orderId)
    .eq("status", "pending")
    .maybeSingle();
  if (!intent) return; // já processado (pelo checkout síncrono de cartão) ou não é nosso.

  if (ORDER_FAILED_EVENTS.has(event) || !reallyApproved) {
    await supabaseAdmin.from("checkout_intents").update({ status: "failed" }).eq("id", intent.id);
    return;
  }

  const plan = getPlan(intent.plan_slug);
  if (!plan) {
    await supabaseAdmin.from("checkout_intents").update({ status: "failed" }).eq("id", intent.id);
    return;
  }

  const { createAppmaxSubscription } = await import("@/lib/appmax.server");
  const intervalCount = Math.max(1, Math.round(plan.durationDays / 30));
  const sub = await createAppmaxSubscription({ orderId, intervalCount });

  const now = new Date();
  const endsAt = new Date(now.getTime() + plan.durationDays * 86400_000).toISOString();
  await supabaseAdmin.from("subscriptions").insert({
    user_id: intent.user_id, plan_slug: plan.slug, plan_name: plan.name,
    period: plan.id === "six_months" ? "semiannual" : plan.id,
    status: "active", price_cents: Math.round(plan.totalPrice * 100),
    started_at: now.toISOString(), ends_at: endsAt,
    appmax_customer_id: intent.appmax_customer_id, appmax_order_id: orderId,
    appmax_subscription_id: sub.id, payment_method: intent.payment_method,
  });
  await supabaseAdmin.from("profiles").update({ plan: plan.name, trial_ends_at: endsAt }).eq("id", intent.user_id);
  await supabaseAdmin.from("checkout_intents").update({ status: "completed" }).eq("id", intent.id);

  const { data: profile } = await supabaseAdmin.from("profiles").select("phone").eq("id", intent.user_id).maybeSingle();
  if (profile?.phone) {
    await sendWhatsAppText(profile.phone, `🎉 Pagamento confirmado! Seu ${plan.name} já está ativo no Abio.`);
  }
}

async function handleSubscriptionEvent(event: string, subscriptionId: number) {
  const { data: sub } = await supabaseAdmin
    .from("subscriptions")
    .select("*")
    .eq("appmax_subscription_id", subscriptionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!sub) return; // assinatura não rastreada por aqui (ex: assinatura de teste avulsa no painel Appmax).

  if (event === "subscription_cancelation") {
    await supabaseAdmin.from("subscriptions")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
      .eq("id", sub.id);
    return;
  }

  // Reconfirma via GET — next_charge_at da própria Appmax vira a nova data de validade.
  const remote = await getAppmaxSubscription(subscriptionId);
  const remoteStatus = String(remote.status ?? "").toLowerCase();

  if (event === "subscription_charge_failed" || /cancel|expirad|failed/.test(remoteStatus)) {
    await supabaseAdmin.from("subscriptions").update({ status: "expired" }).eq("id", sub.id);
    const { data: profile } = await supabaseAdmin.from("profiles").select("phone").eq("id", sub.user_id).maybeSingle();
    if (profile?.phone) {
      await sendWhatsAppText(profile.phone,
        `⚠️ Não conseguimos renovar sua assinatura do Abio automaticamente. Atualize seu cartão em abio.fun/app/checkout?plan=${sub.plan_slug} pra continuar com acesso.`);
    }
    return;
  }

  if (event === "subscription_charge_success") {
    const newEnds = remote.next_charge_at
      ? new Date(remote.next_charge_at).toISOString()
      : new Date(Date.now() + 30 * 86400_000).toISOString();
    await supabaseAdmin.from("subscriptions")
      .update({ status: "active", ends_at: newEnds })
      .eq("id", sub.id);
    await supabaseAdmin.from("profiles").update({ trial_ends_at: newEnds }).eq("id", sub.user_id);
  }
}
