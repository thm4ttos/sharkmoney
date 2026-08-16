// Checkout self-service (Mercado Pago) — assinatura recorrente de cartão via Preapproval.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getPlan } from "@/lib/plans";

const PERIOD_BY_PLAN_ID: Record<string, string> = {
  monthly: "monthly",
  six_months: "semiannual",
  annual: "annual",
};

const BACK_URL = "https://abio.fun/app/perfil";

// publicKey não é secreta (vai pro navegador, exigida pelo SDK JS do Mercado
// Pago pra tokenizar cartão no checkout) — só o access_token (usado no
// server-to-server) fica restrito ao servidor.
export const getMercadoPagoPublicConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { loadMercadoPagoCreds } = await import("@/lib/mercadopago.server");
    const creds = await loadMercadoPagoCreds();
    return { publicKey: creds.publicKey, environment: creds.environment };
  });

// Cada plano do Abio vira um "preapproval_plan" no Mercado Pago — criado uma
// única vez, sob demanda, e reaproveitado depois (id salvo em plans.mp_plan_id).
async function ensureMercadoPagoPlanId(planSlug: string, planName: string, priceCents: number, frequencyMonths: number, forceFresh = false): Promise<string> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  if (!forceFresh) {
    const { data: dbPlan } = await supabaseAdmin.from("plans").select("mp_plan_id").eq("slug", planSlug).maybeSingle();
    if (dbPlan?.mp_plan_id) return dbPlan.mp_plan_id;
  }

  const { createMercadoPagoPlan } = await import("@/lib/mercadopago.server");
  const mpPlan = await createMercadoPagoPlan({
    reason: planName, amountCents: priceCents, frequency: frequencyMonths, backUrl: BACK_URL,
  });
  console.log("[mercadopago] preapproval_plan criado", JSON.stringify(mpPlan));
  // Observado em sandbox: usar o plano recém-criado na mesma resposta às
  // vezes falha com "template ... does not exist" (POST /preapproval) —
  // parece um pequeno delay de propagação do lado da Mercado Pago.
  await new Promise((r) => setTimeout(r, 1500));
  await supabaseAdmin.from("plans").update({ mp_plan_id: mpPlan.id }).eq("slug", planSlug);
  return mpPlan.id;
}

const checkoutInput = z.object({
  planSlug: z.string().min(1).max(60),
  cardToken: z.string().min(10).max(500),
});

export const startCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => checkoutInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const plan = getPlan(data.planSlug);
    if (!plan) throw new Error("Plano não encontrado.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profile, error: pErr } = await supabase
      .from("profiles").select("email").eq("id", userId).maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!profile?.email) throw new Error("Seu perfil não tem e-mail cadastrado.");

    // Grava a intent antes de seguir pro Mercado Pago — se algo falhar depois
    // fica um registro rastreável em vez de o clique do usuário sumir sem rastro.
    const { data: intent, error: iErr } = await supabase
      .from("checkout_intents")
      .insert({ user_id: userId, plan_slug: plan.slug, payment_method: "credit_card", status: "pending" })
      .select().single();
    if (iErr) throw new Error(iErr.message);

    try {
      const priceCents = Math.round(plan.totalPrice * 100);
      const frequencyMonths = Math.max(1, Math.round(plan.durationDays / 30));
      let mpPlanId = await ensureMercadoPagoPlanId(plan.slug, plan.name, priceCents, frequencyMonths);

      const { createMercadoPagoSubscription, supersedeActiveMercadoPagoSubscriptions } = await import("@/lib/mercadopago.server");
      let sub;
      try {
        sub = await createMercadoPagoSubscription({
          planId: mpPlanId, cardTokenId: data.cardToken, payerEmail: profile.email,
          externalReference: userId, amountCents: priceCents, frequency: frequencyMonths, backUrl: BACK_URL,
        });
      } catch (e: any) {
        // O plano cacheado (plans.mp_plan_id) pode ter ficado inválido do lado
        // da Mercado Pago ("template ... does not exist") — descarta o cache
        // e tenta uma vez mais com um plano recém-criado antes de desistir.
        if (!/does not exist|template/i.test(String(e?.message ?? ""))) throw e;
        console.warn("[mercadopago] plano cacheado inválido, recriando", plan.slug, e?.message);
        mpPlanId = await ensureMercadoPagoPlanId(plan.slug, plan.name, priceCents, frequencyMonths, true);
        sub = await createMercadoPagoSubscription({
          planId: mpPlanId, cardTokenId: data.cardToken, payerEmail: profile.email,
          externalReference: userId, amountCents: priceCents, frequency: frequencyMonths, backUrl: BACK_URL,
        });
      }

      await supabaseAdmin.from("checkout_intents").update({ mp_preapproval_id: sub.id }).eq("id", intent.id);

      if (sub.status === "pending") {
        // Precisa de confirmação assíncrona (webhook) — o checkout faz polling.
        return { intentId: intent.id as string, status: "pending" as const };
      }
      if (sub.status !== "authorized") {
        await supabaseAdmin.from("checkout_intents").update({ status: "failed" }).eq("id", intent.id);
        return { intentId: intent.id as string, status: "failed" as const, reason: String(sub.status ?? "recusado") };
      }

      // Evita cobrança dupla em paralelo se a pessoa já tinha uma assinatura
      // ativa (ex: upgrade de mensal pra anual).
      await supersedeActiveMercadoPagoSubscriptions(userId, sub.id);

      const now = new Date();
      const endsAt = new Date(now.getTime() + plan.durationDays * 86400_000).toISOString();
      await supabaseAdmin.from("subscriptions").insert({
        user_id: userId, plan_slug: plan.slug, plan_name: plan.name,
        period: PERIOD_BY_PLAN_ID[plan.id] ?? "monthly",
        status: "active", price_cents: priceCents,
        started_at: now.toISOString(), ends_at: endsAt,
        mp_preapproval_id: sub.id, payment_method: "credit_card",
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
    if (sub.mp_preapproval_id) {
      const { cancelMercadoPagoSubscription } = await import("@/lib/mercadopago.server");
      try {
        await cancelMercadoPagoSubscription(sub.mp_preapproval_id);
      } catch (e) {
        // Segue cancelando localmente mesmo se a chamada ao Mercado Pago falhar —
        // o usuário não pode ficar preso pagando por uma falha de rede nossa;
        // pior caso vira uma cobrança a mais que precisa de estorno manual.
        console.error("[cancelMySubscription] falha ao cancelar no Mercado Pago", e);
      }
    }
    const { data: row, error: uErr } = await supabaseAdmin
      .from("subscriptions")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
      .eq("id", sub.id).select().single();
    if (uErr) throw new Error(uErr.message);
    return row;
  });
