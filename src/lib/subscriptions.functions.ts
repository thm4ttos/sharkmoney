// Núcleo de Assinaturas — Abio (Fase A)
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function ensureAdmin(supabase: any, userId: string) {
  const { data } = await supabase
    .from("user_roles").select("role")
    .eq("user_id", userId).eq("role", "admin").maybeSingle();
  if (!data) throw new Error("Forbidden");
}

const PERIODS = ["trial","monthly","quarterly","semiannual","annual","lifetime"] as const;
const STATUSES = ["trial","active","expired","cancelled"] as const;

// ===== Plans catalog =====
export const listPlans = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("plans").select("*").eq("active", true).order("sort_order");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

// ===== Current user subscription =====
export const getMySubscription = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("subscriptions").select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1).maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  });

// ===== Admin: list user subscription + stats =====
export const adminListSubscriptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await ensureAdmin(supabase, userId);
    const { data, error } = await supabase
      .from("subscriptions").select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const adminSubscriptionStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await ensureAdmin(supabase, userId);
    const { data, error } = await supabase
      .from("subscriptions").select("status, period, price_cents, ends_at");
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    const now = Date.now();
    let trials = 0, active = 0, expired = 0, cancelled = 0, mrrCents = 0, expiringSoon = 0;
    for (const r of rows) {
      if (r.status === "trial") trials++;
      else if (r.status === "active") active++;
      else if (r.status === "expired") expired++;
      else if (r.status === "cancelled") cancelled++;
      if (r.status === "active" && r.period === "monthly") mrrCents += r.price_cents ?? 0;
      if (r.status === "active" && r.period === "annual") mrrCents += Math.round((r.price_cents ?? 0) / 12);
      if (r.status === "active" && r.period === "quarterly") mrrCents += Math.round((r.price_cents ?? 0) / 3);
      if (r.status === "active" && r.period === "semiannual") mrrCents += Math.round((r.price_cents ?? 0) / 6);
      if (r.ends_at) {
        const d = new Date(r.ends_at).getTime();
        if (d > now && d - now < 7 * 86400_000) expiringSoon++;
      }
    }
    return { total: rows.length, trials, active, expired, cancelled, mrrCents, expiringSoon };
  });

// ===== Admin: assign/replace user subscription =====
export const adminAssignSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      userId: z.string().uuid(),
      planSlug: z.string().min(1).max(60),
      durationDaysOverride: z.number().int().min(1).max(3650).optional(),
      adminNote: z.string().max(500).optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await ensureAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: plan, error: pErr } = await supabaseAdmin
      .from("plans").select("*").eq("slug", data.planSlug).maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!plan) throw new Error("Plano não encontrado.");
    if (!plan.active) throw new Error("Plano descontinuado: escolha Mensal, 6 meses ou 12 meses.");

    const now = new Date();
    const durDays = data.durationDaysOverride ?? plan.duration_days;
    const ends_at = plan.period === "lifetime" || !durDays
      ? null
      : new Date(now.getTime() + durDays * 86400_000).toISOString();
    const status = plan.period === "trial" ? "trial" : "active";

    const { data: row, error } = await supabaseAdmin
      .from("subscriptions")
      .insert({
        user_id: data.userId,
        plan_slug: plan.slug,
        plan_name: plan.name,
        period: plan.period,
        status,
        price_cents: plan.price_cents,
        started_at: now.toISOString(),
        ends_at,
        admin_note: data.adminNote ?? null,
      })
      .select().single();
    if (error) throw new Error(error.message);

    // Se a pessoa já tinha uma assinatura recorrente ativa na Appmax,
    // atribuir um plano novo por aqui não pode deixar a cobrança automática
    // antiga rodando em paralelo sem o admin saber.
    try {
      const { supersedeActiveAppmaxSubscriptions } = await import("@/lib/appmax.server");
      await supersedeActiveAppmaxSubscriptions(data.userId);
    } catch (e) {
      console.error("[adminAssignSubscription] falha ao verificar assinaturas Appmax anteriores", e);
    }

    await supabaseAdmin.from("profiles").update({
      plan: plan.name,
      trial_ends_at: ends_at ?? new Date(now.getTime() + 365 * 10 * 86400_000).toISOString(),
    }).eq("id", data.userId);

    const { logAudit } = await import("@/lib/admin-audit.functions");
    const { data: admin } = await supabaseAdmin.auth.admin.getUserById(userId);
    await logAudit({
      targetUserId: data.userId, adminUserId: userId,
      adminEmail: admin?.user?.email ?? null,
      action: "subscription_assign",
      description: `Plano alterado para ${plan.name}`,
      metadata: { plan: plan.slug, ends_at },
    });
    return row;
  });

// ===== Admin: extend current subscription by N days =====
export const adminExtendSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      subscriptionId: z.string().uuid(),
      days: z.number().int().min(1).max(3650),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await ensureAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: sub, error } = await supabaseAdmin
      .from("subscriptions").select("*").eq("id", data.subscriptionId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!sub) throw new Error("Assinatura não encontrada.");

    const base = sub.ends_at && new Date(sub.ends_at).getTime() > Date.now()
      ? new Date(sub.ends_at)
      : new Date();
    const newEnds = new Date(base.getTime() + data.days * 86400_000).toISOString();
    const newStatus = sub.status === "expired" ? "active" : sub.status;

    const { data: row, error: uErr } = await supabaseAdmin
      .from("subscriptions").update({ ends_at: newEnds, status: newStatus })
      .eq("id", sub.id).select().single();
    if (uErr) throw new Error(uErr.message);

    await supabaseAdmin.from("profiles").update({ trial_ends_at: newEnds }).eq("id", sub.user_id);

    const { logAudit } = await import("@/lib/admin-audit.functions");
    const { data: admin } = await supabaseAdmin.auth.admin.getUserById(userId);
    await logAudit({
      targetUserId: sub.user_id, adminUserId: userId,
      adminEmail: admin?.user?.email ?? null,
      action: "subscription_extend",
      description: `Assinatura estendida +${data.days} dias`,
      metadata: { days: data.days, ends_at: newEnds },
    });
    return row;
  });

// ===== Admin: cancel subscription =====
export const adminCancelSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ subscriptionId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await ensureAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: existing } = await supabaseAdmin
      .from("subscriptions").select("appmax_subscription_id").eq("id", data.subscriptionId).maybeSingle();
    if (existing?.appmax_subscription_id) {
      // Sem isso, cancelar pelo admin só apaga o registro local — a Appmax
      // continua cobrando automaticamente a assinatura, já que a criação foi
      // feita lá e ela não sabe que cancelamos aqui.
      try {
        const { cancelAppmaxSubscription } = await import("@/lib/appmax.server");
        await cancelAppmaxSubscription(existing.appmax_subscription_id);
      } catch (e) {
        console.error("[adminCancelSubscription] falha ao cancelar na Appmax", e);
      }
    }

    const { data: row, error } = await supabaseAdmin
      .from("subscriptions").update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
      }).eq("id", data.subscriptionId).select().single();
    if (error) throw new Error(error.message);

    const { logAudit } = await import("@/lib/admin-audit.functions");
    const { data: admin } = await supabaseAdmin.auth.admin.getUserById(userId);
    await logAudit({
      targetUserId: row.user_id, adminUserId: userId,
      adminEmail: admin?.user?.email ?? null,
      action: "subscription_cancel",
      description: `Assinatura cancelada`,
    });
    return row;
  });

// ===== Admin: update subscription (plan/price/ends_at/status) =====
export const adminUpdateSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      subscriptionId: z.string().uuid(),
      planSlug: z.string().min(1).max(60).optional(),
      priceCents: z.number().int().min(0).max(10_000_000).optional(),
      startedAt: z.string().datetime().nullable().optional(),
      endsAt: z.string().datetime().nullable().optional(),
      status: z.enum(STATUSES).optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await ensureAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const patch: any = {};
    if (data.planSlug) {
      const { data: plan } = await supabaseAdmin.from("plans").select("*").eq("slug", data.planSlug).maybeSingle();
      if (!plan) throw new Error("Plano não encontrado.");
      if (!plan.active) throw new Error("Plano descontinuado: escolha Mensal, 6 meses ou 12 meses.");
      patch.plan_slug = plan.slug;
      patch.plan_name = plan.name;
      patch.period = plan.period;
      if (data.priceCents === undefined) patch.price_cents = plan.price_cents;
    }
    if (data.priceCents !== undefined) patch.price_cents = data.priceCents;
    if (data.startedAt !== undefined) patch.started_at = data.startedAt;
    if (data.endsAt !== undefined) patch.ends_at = data.endsAt;
    if (data.status) patch.status = data.status;

    const { data: row, error } = await supabaseAdmin
      .from("subscriptions").update(patch).eq("id", data.subscriptionId).select().single();
    if (error) throw new Error(error.message);

    if (patch.ends_at !== undefined) {
      await supabaseAdmin.from("profiles").update({ trial_ends_at: patch.ends_at }).eq("id", row.user_id);
    }

    const { logAudit } = await import("@/lib/admin-audit.functions");
    const { data: admin } = await supabaseAdmin.auth.admin.getUserById(userId);
    await logAudit({
      targetUserId: row.user_id, adminUserId: userId,
      adminEmail: admin?.user?.email ?? null,
      action: "subscription_update",
      description: `Assinatura editada (${Object.keys(patch).join(", ")})`,
      metadata: patch,
    });
    return row;
  });

// ===== Admin: reactivate cancelled/expired subscription =====
export const adminReactivateSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      subscriptionId: z.string().uuid(),
      days: z.number().int().min(1).max(3650).optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await ensureAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: sub } = await supabaseAdmin
      .from("subscriptions").select("*").eq("id", data.subscriptionId).maybeSingle();
    if (!sub) throw new Error("Assinatura não encontrada.");

    const days = data.days ?? 30;
    const newEnds = sub.period === "lifetime"
      ? null
      : new Date(Date.now() + days * 86400_000).toISOString();

    // Cancelamento na Appmax é permanente ("nenhuma nova cobrança será
    // gerada" — não existe API pra "descancelar"). Reativar aqui sem tratar
    // isso deixaria o registro mostrando "Ativo" sem nenhuma cobrança real
    // acontecendo de novo — limpa o vínculo pra ficar claro que virou uma
    // assinatura só manual (admin decide renovação) a partir de agora.
    const patch: Record<string, any> = { status: "active", cancelled_at: null, ends_at: newEnds };
    if (sub.appmax_subscription_id) {
      patch.appmax_subscription_id = null;
      patch.appmax_order_id = null;
      patch.payment_method = null;
    }

    const { data: row, error } = await supabaseAdmin
      .from("subscriptions").update(patch).eq("id", sub.id).select().single();
    if (error) throw new Error(error.message);

    if (newEnds) await supabaseAdmin.from("profiles").update({ trial_ends_at: newEnds }).eq("id", sub.user_id);

    const { logAudit } = await import("@/lib/admin-audit.functions");
    const { data: admin } = await supabaseAdmin.auth.admin.getUserById(userId);
    await logAudit({
      targetUserId: sub.user_id, adminUserId: userId,
      adminEmail: admin?.user?.email ?? null,
      action: "subscription_reactivate",
      description: `Assinatura reativada (+${days} dias)`,
      metadata: { days, ends_at: newEnds },
    });
    return row;
  });

// ===== User: own renewal history =====
export const getMySubscriptionHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("subscriptions").select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

