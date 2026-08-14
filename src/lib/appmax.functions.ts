// Checkout self-service (Appmax) — assinatura recorrente de cartão ou Pix.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getPlan } from "@/lib/plans";

const PERIOD_BY_PLAN_ID: Record<string, string> = {
  monthly: "monthly",
  six_months: "semiannual",
  annual: "annual",
};

const checkoutInput = z.object({
  planSlug: z.string().min(1).max(60),
  paymentMethod: z.enum(["credit_card", "pix"]),
  document: z.string().min(11).max(18),
  cardToken: z.string().min(10).max(500).optional(),
  installments: z.number().int().min(1).max(12).optional(),
});

// externalId não é secreto (é o identificador do "app" no Appstore da
// Appmax, exigido pelo Appmax.js pra tokenizar cartão no browser) — só
// client_id/client_secret (usados no OAuth2 server-to-server) ficam
// restritos ao servidor.
export const getAppmaxPublicConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { loadAppmaxCreds } = await import("@/lib/appmax.server");
    const creds = await loadAppmaxCreds();
    return { externalId: creds.externalId, environment: creds.environment };
  });

export const startCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => checkoutInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (data.paymentMethod === "credit_card" && !data.cardToken) {
      throw new Error("Token do cartão ausente — tokenização falhou no navegador.");
    }
    const plan = getPlan(data.planSlug);
    if (!plan) throw new Error("Plano não encontrado.");
    const documentNumber = data.document.replace(/\D/g, "");
    if (documentNumber.length !== 11 && documentNumber.length !== 14) {
      throw new Error("CPF/CNPJ inválido.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profile, error: pErr } = await supabase
      .from("profiles").select("name, email, phone").eq("id", userId).maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!profile?.email) throw new Error("Seu perfil não tem e-mail cadastrado.");

    const {
      createAppmaxCustomer, createAppmaxOrder, payAppmaxOrderCreditCard,
      payAppmaxOrderPix, createAppmaxSubscription,
    } = await import("@/lib/appmax.server");

    const [firstName, ...rest] = (profile.name || "Cliente Abio").trim().split(/\s+/);
    const lastName = rest.join(" ") || "Abio";
    const customer = await createAppmaxCustomer({
      firstName, lastName, email: profile.email, phone: profile.phone ?? "",
    });

    // Grava a intent antes de seguir pra Appmax de novo — se algo falhar depois
    // fica um registro rastreável em vez de o clique do usuário sumir sem rastro.
    const { data: intent, error: iErr } = await supabase
      .from("checkout_intents")
      .insert({
        user_id: userId, plan_slug: plan.slug, appmax_customer_id: customer.id,
        payment_method: data.paymentMethod, status: "pending",
      })
      .select().single();
    if (iErr) throw new Error(iErr.message);

    try {
      const order = await createAppmaxOrder({
        customerId: customer.id, sku: plan.slug, name: plan.name,
        priceCents: Math.round(plan.totalPrice * 100),
      });
      const orderId: number = order.id ?? (order as any).order_id;
      await supabaseAdmin.from("checkout_intents").update({ appmax_order_id: orderId }).eq("id", intent.id);

      if (data.paymentMethod === "pix") {
        const pix = await payAppmaxOrderPix({ orderId, documentNumber });
        return {
          intentId: intent.id as string,
          status: "pending" as const,
          pixQrCode: pix.pix_qrcode ?? null,
          pixEmv: pix.pix_emv ?? null,
        };
      }

      const payment = await payAppmaxOrderCreditCard({
        orderId, cardToken: data.cardToken!, installments: data.installments ?? 1, documentNumber,
      });
      const approved = /aprovad|approved|paid|integrado/i.test(String(payment.status ?? ""));
      if (!approved) {
        await supabaseAdmin.from("checkout_intents").update({ status: "failed" }).eq("id", intent.id);
        return { intentId: intent.id as string, status: "failed" as const, reason: String(payment.status ?? "recusado") };
      }

      const intervalCount = Math.max(1, Math.round(plan.durationDays / 30));
      const sub = await createAppmaxSubscription({ orderId, intervalCount });

      // Evita cobrança dupla em paralelo se a pessoa já tinha uma assinatura
      // ativa (ex: upgrade de mensal pra anual) — cancela a anterior agora
      // que a nova já foi criada com sucesso.
      const { supersedeActiveAppmaxSubscriptions } = await import("@/lib/appmax.server");
      await supersedeActiveAppmaxSubscriptions(userId, sub.id);

      const now = new Date();
      const endsAt = new Date(now.getTime() + plan.durationDays * 86400_000).toISOString();
      await supabaseAdmin.from("subscriptions").insert({
        user_id: userId, plan_slug: plan.slug, plan_name: plan.name,
        period: PERIOD_BY_PLAN_ID[plan.id] ?? "monthly",
        status: "active", price_cents: Math.round(plan.totalPrice * 100),
        started_at: now.toISOString(), ends_at: endsAt,
        appmax_customer_id: customer.id, appmax_order_id: orderId,
        appmax_subscription_id: sub.id, payment_method: "credit_card",
      });
      await supabaseAdmin.from("profiles").update({ plan: plan.name, trial_ends_at: endsAt }).eq("id", userId);
      await supabaseAdmin.from("checkout_intents").update({ status: "completed" }).eq("id", intent.id);

      return { intentId: intent.id as string, status: "completed" as const };
    } catch (e: any) {
      await supabaseAdmin.from("checkout_intents").update({ status: "failed" }).eq("id", intent.id);
      throw new Error(e?.message ?? "Falha ao processar pagamento.");
    }
  });

export const getMyCheckoutIntent = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ intentId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("checkout_intents").select("*")
      .eq("id", data.intentId).eq("user_id", userId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Tentativa de pagamento não encontrada.");
    return row;
  });

export const cancelMySubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: sub, error } = await supabase
      .from("subscriptions").select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1).maybeSingle();
    if (error) throw new Error(error.message);
    if (!sub) throw new Error("Nenhuma assinatura encontrada.");
    if (sub.status === "cancelled") return sub;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (sub.appmax_subscription_id) {
      const { cancelAppmaxSubscription } = await import("@/lib/appmax.server");
      try {
        await cancelAppmaxSubscription(sub.appmax_subscription_id);
      } catch (e) {
        // Segue cancelando localmente mesmo se a chamada à Appmax falhar — o
        // usuário não pode ficar preso pagando por uma falha de rede nossa;
        // pior caso vira uma cobrança a mais que precisa de estorno manual.
        console.error("[cancelMySubscription] falha ao cancelar na Appmax", e);
      }
    }
    const { data: row, error: uErr } = await supabaseAdmin
      .from("subscriptions")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
      .eq("id", sub.id).select().single();
    if (uErr) throw new Error(uErr.message);
    return row;
  });
