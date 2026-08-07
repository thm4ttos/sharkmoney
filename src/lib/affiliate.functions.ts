// Server functions for the affiliate module — Phase 1 foundation.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function ensureAdmin(supabase: any, userId: string) {
  const { data } = await supabase
    .from("user_roles").select("role")
    .eq("user_id", userId).eq("role", "admin").maybeSingle();
  if (!data) throw new Error("Forbidden");
}

function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 20);
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 6).toUpperCase();
}

// ===================== USER =====================

export const getMyAffiliate = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data } = await supabase
      .from("affiliates").select("*").eq("user_id", userId).maybeSingle();
    return data ?? null;
  });

export const getMyAffiliateOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: aff } = await supabase
      .from("affiliates").select("*").eq("user_id", userId).maybeSingle();
    if (!aff) return { affiliate: null };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [settingsRes, clicksRes, referralsRes, commissionsRes, payoutsRes] = await Promise.all([
      supabaseAdmin.from("affiliate_settings").select("*").eq("id", 1).maybeSingle(),
      supabaseAdmin.from("affiliate_clicks").select("id, created_at, campaign_slug, device, country", { count: "exact" }).eq("affiliate_id", aff.id).order("created_at", { ascending: false }).limit(50),
      supabaseAdmin.from("referrals").select("id, user_id, status, source_campaign, created_at", { count: "exact" }).eq("affiliate_id", aff.id).order("created_at", { ascending: false }).limit(50),
      supabaseAdmin.from("affiliate_commissions").select("status, commission_cents, created_at").eq("affiliate_id", aff.id),
      supabaseAdmin.from("affiliate_payouts").select("id, amount_cents, status, method, created_at").eq("affiliate_id", aff.id).order("created_at", { ascending: false }).limit(20),
    ]);

    let pending = 0, available = 0, paid = 0;
    for (const c of (commissionsRes.data ?? []) as any[]) {
      if (c.status === "pending") pending += c.commission_cents;
      else if (c.status === "available") available += c.commission_cents;
      else if (c.status === "paid") paid += c.commission_cents;
    }

    const referralUserIds = (referralsRes.data ?? []).map((r: any) => r.user_id);
    const { data: refProfiles } = referralUserIds.length
      ? await supabaseAdmin.from("profiles").select("id, name, email").in("id", referralUserIds)
      : { data: [] as any[] };
    const pMap = new Map((refProfiles ?? []).map((p: any) => [p.id, p]));
    const referrals = (referralsRes.data ?? []).map((r: any) => ({ ...r, profile: pMap.get(r.user_id) ?? null }));

    return {
      affiliate: aff,
      settings: settingsRes.data,
      clicks: clicksRes.data ?? [],
      clicksCount: clicksRes.count ?? 0,
      referrals,
      referralsCount: referralsRes.count ?? 0,
      commissions: {
        pendingCents: pending,
        availableCents: available,
        paidCents: paid,
      },
      payouts: payoutsRes.data ?? [],
    };
  });



export const requestAffiliateAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: existing } = await supabase
      .from("affiliates").select("id, status").eq("user_id", userId).maybeSingle();
    if (existing) return existing;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profile } = await supabaseAdmin
      .from("profiles").select("name, email").eq("id", userId).maybeSingle();

    const base = slugify(profile?.name ?? profile?.email ?? "Abio") || "Abio";
    let code = base;
    for (let i = 0; i < 5; i++) {
      const { data: exists } = await supabaseAdmin
        .from("affiliates").select("id").ilike("code", code).maybeSingle();
      if (!exists) break;
      code = `${base}${randomSuffix()}`;
    }

    const { data, error } = await supabaseAdmin
      .from("affiliates")
      .insert({ user_id: userId, code, status: "pending" })
      .select().single();
    if (error) throw new Error(error.message);
    return data;
  });

// ===================== ADMIN =====================

export const adminListAffiliates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await ensureAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: rows, error } = await supabaseAdmin
      .from("affiliates")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const ids = (rows ?? []).map((r: any) => r.user_id);
    const { data: profiles } = ids.length
      ? await supabaseAdmin.from("profiles").select("id, name, email, phone").in("id", ids)
      : { data: [] as any[] };

    const map = new Map((profiles ?? []).map((p: any) => [p.id, p]));

    const affiliateIds = (rows ?? []).map((r: any) => r.id);
    let clickCounts: Map<string, number> = new Map();
    let signupCounts: Map<string, number> = new Map();
    if (affiliateIds.length) {
      const [{ data: clicks }, { data: signups }] = await Promise.all([
        supabaseAdmin.from("affiliate_clicks").select("affiliate_id").in("affiliate_id", affiliateIds),
        supabaseAdmin.from("referrals").select("affiliate_id, status").in("affiliate_id", affiliateIds),
      ]);
      for (const c of (clicks ?? []) as any[]) {
        clickCounts.set(c.affiliate_id, (clickCounts.get(c.affiliate_id) ?? 0) + 1);
      }
      for (const s of (signups ?? []) as any[]) {
        signupCounts.set(s.affiliate_id, (signupCounts.get(s.affiliate_id) ?? 0) + 1);
      }
    }

    return (rows ?? []).map((r: any) => ({
      ...r,
      profile: map.get(r.user_id) ?? null,
      clicksCount: clickCounts.get(r.id) ?? 0,
      signupsCount: signupCounts.get(r.id) ?? 0,
    }));
  });

export const adminPromoteToAffiliate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      userId: z.string().uuid(),
      customCommissionPct: z.number().min(0).max(100).optional(),
      couponCode: z.string().min(2).max(30).optional(),
      adminNote: z.string().max(500).optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await ensureAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: existing } = await supabaseAdmin
      .from("affiliates").select("*").eq("user_id", data.userId).maybeSingle();

    if (existing) {
      const patch: any = { status: "active" };
      if (data.customCommissionPct !== undefined) patch.custom_commission_pct = data.customCommissionPct;
      if (data.couponCode) patch.coupon_code = data.couponCode.toUpperCase();
      if (data.adminNote) patch.admin_note = data.adminNote;
      const { data: row, error } = await supabaseAdmin
        .from("affiliates").update(patch).eq("id", existing.id).select().single();
      if (error) throw new Error(error.message);
      return row;
    }

    const { data: profile } = await supabaseAdmin
      .from("profiles").select("name, email").eq("id", data.userId).maybeSingle();
    const base = slugify(profile?.name ?? profile?.email ?? "Abio") || "Abio";
    let code = base;
    for (let i = 0; i < 5; i++) {
      const { data: exists } = await supabaseAdmin
        .from("affiliates").select("id").ilike("code", code).maybeSingle();
      if (!exists) break;
      code = `${base}${randomSuffix()}`;
    }

    const { data: row, error } = await supabaseAdmin
      .from("affiliates").insert({
        user_id: data.userId,
        code,
        status: "active",
        custom_commission_pct: data.customCommissionPct ?? null,
        coupon_code: data.couponCode?.toUpperCase() ?? null,
        admin_note: data.adminNote ?? null,
      }).select().single();
    if (error) throw new Error(error.message);

    try {
      const { logAudit } = await import("@/lib/admin-audit.functions");
      await logAudit({
        targetUserId: data.userId, adminUserId: userId, adminEmail: null,
        action: "affiliate_promote",
        description: `Usuário promovido a afiliado (${code})`,
        metadata: { code },
      });
    } catch {}
    return row;
  });

export const adminUpdateAffiliate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      affiliateId: z.string().uuid(),
      status: z.enum(["active","blocked","pending"]).optional(),
      customCommissionPct: z.number().min(0).max(100).nullable().optional(),
      couponCode: z.string().min(2).max(30).nullable().optional(),
      adminNote: z.string().max(500).nullable().optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await ensureAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: any = {};
    if (data.status) patch.status = data.status;
    if (data.customCommissionPct !== undefined) patch.custom_commission_pct = data.customCommissionPct;
    if (data.couponCode !== undefined) patch.coupon_code = data.couponCode ? data.couponCode.toUpperCase() : null;
    if (data.adminNote !== undefined) patch.admin_note = data.adminNote;
    const { data: row, error } = await supabaseAdmin
      .from("affiliates").update(patch).eq("id", data.affiliateId).select().single();
    if (error) throw new Error(error.message);
    return row;
  });

export const adminAffiliateStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await ensureAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ count: totalAff }, { count: activeAff }, { count: clicks }, { count: signups }, comm] =
      await Promise.all([
        supabaseAdmin.from("affiliates").select("*", { count: "exact", head: true }),
        supabaseAdmin.from("affiliates").select("*", { count: "exact", head: true }).eq("status","active"),
        supabaseAdmin.from("affiliate_clicks").select("*", { count: "exact", head: true }),
        supabaseAdmin.from("referrals").select("*", { count: "exact", head: true }),
        supabaseAdmin.from("affiliate_commissions").select("status, commission_cents"),
      ]);
    let pending = 0, available = 0, paid = 0;
    for (const r of (comm.data ?? []) as any[]) {
      if (r.status === "pending") pending += r.commission_cents;
      else if (r.status === "available") available += r.commission_cents;
      else if (r.status === "paid") paid += r.commission_cents;
    }
    return {
      totalAff: totalAff ?? 0,
      activeAff: activeAff ?? 0,
      clicks: clicks ?? 0,
      signups: signups ?? 0,
      pendingCents: pending,
      availableCents: available,
      paidCents: paid,
    };
  });

// ===================== SETTINGS =====================

export const getAffiliateSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase.from("affiliate_settings").select("*").eq("id",1).maybeSingle();
    return data;
  });

export const adminUpdateAffiliateSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      cookie_days: z.number().int().min(1).max(365).optional(),
      min_payout_cents: z.number().int().min(100).max(1_000_000).optional(),
      commission_pct_monthly: z.number().min(0).max(100).optional(),
      commission_pct_quarterly: z.number().min(0).max(100).optional(),
      commission_pct_semiannual: z.number().min(0).max(100).optional(),
      commission_pct_annual: z.number().min(0).max(100).optional(),
      commission_pct_lifetime: z.number().min(0).max(100).optional(),
      hold_days: z.number().int().min(0).max(90).optional(),
      payout_methods: z.array(z.string()).optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await ensureAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("affiliate_settings").update({ ...data, updated_at: new Date().toISOString() })
      .eq("id",1).select().single();
    if (error) throw new Error(error.message);
    return row;
  });

// ===================== MATURATION (admin manual trigger) =====================

export const adminMatureAffiliateCommissions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await ensureAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("affiliate_mature_commissions");
    if (error) throw new Error(error.message);
    return data ?? { matured: 0 };
  });

// ===================== PAYOUTS (user) =====================

export const requestPayout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      method: z.enum(["pix", "bank", "wallet"]),
      payload: z.record(z.string(), z.any()).optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: aff } = await supabase
      .from("affiliates").select("*").eq("user_id", userId).maybeSingle();
    if (!aff || aff.status !== "active") throw new Error("Afiliado inativo");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: settings } = await supabaseAdmin
      .from("affiliate_settings").select("*").eq("id", 1).maybeSingle();

    const { data: openPayout } = await supabaseAdmin
      .from("affiliate_payouts").select("id").eq("affiliate_id", aff.id)
      .in("status", ["pending", "approved"]).maybeSingle();
    if (openPayout) throw new Error("Você já tem um saque em andamento");

    const { data: commissions, error: cerr } = await supabaseAdmin
      .from("affiliate_commissions")
      .select("id, commission_cents")
      .eq("affiliate_id", aff.id).eq("status", "available").is("payout_id", null);
    if (cerr) throw new Error(cerr.message);
    const list = commissions ?? [];
    const total = list.reduce((s: number, c: any) => s + c.commission_cents, 0);
    const min = settings?.min_payout_cents ?? 5000;
    if (total < min) throw new Error(`Saldo insuficiente. Mínimo: R$ ${(min / 100).toFixed(2)}`);

    const { data: payout, error: perr } = await supabaseAdmin
      .from("affiliate_payouts").insert({
        affiliate_id: aff.id,
        amount_cents: total,
        method: data.method,
        payload: data.payload ?? {},
        status: "pending",
        requested_at: new Date().toISOString(),
      }).select().single();
    if (perr) throw new Error(perr.message);

    await supabaseAdmin
      .from("affiliate_commissions")
      .update({ payout_id: payout.id, updated_at: new Date().toISOString() })
      .in("id", list.map((c: any) => c.id));

    return payout;
  });

// ===================== PAYOUTS (admin) =====================

export const adminListPayouts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await ensureAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("affiliate_payouts").select("*")
      .order("created_at", { ascending: false }).limit(200);
    if (error) throw new Error(error.message);
    const affIds = Array.from(new Set((rows ?? []).map((r: any) => r.affiliate_id)));
    const { data: affs } = affIds.length
      ? await supabaseAdmin.from("affiliates").select("id, code, user_id").in("id", affIds)
      : { data: [] as any[] };
    const userIds = (affs ?? []).map((a: any) => a.user_id);
    const { data: profiles } = userIds.length
      ? await supabaseAdmin.from("profiles").select("id, name, email").in("id", userIds)
      : { data: [] as any[] };
    const aMap = new Map((affs ?? []).map((a: any) => [a.id, a]));
    const pMap = new Map((profiles ?? []).map((p: any) => [p.id, p]));
    return (rows ?? []).map((r: any) => {
      const aff = aMap.get(r.affiliate_id);
      return { ...r, affiliate: aff, profile: aff ? pMap.get(aff.user_id) : null };
    });
  });

export const adminUpdatePayoutStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      payoutId: z.string().uuid(),
      status: z.enum(["approved", "paid", "rejected"]),
      adminNote: z.string().max(500).optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await ensureAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: payout } = await supabaseAdmin
      .from("affiliate_payouts").select("*").eq("id", data.payoutId).maybeSingle();
    if (!payout) throw new Error("Saque não encontrado");

    const now = new Date().toISOString();
    const patch: any = { status: data.status, updated_at: now };
    if (data.adminNote) patch.admin_note = data.adminNote;
    if (data.status === "approved") patch.approved_at = now;
    if (data.status === "paid") {
      patch.approved_at = payout.approved_at ?? now;
      patch.paid_at = now;
    }

    const { data: updated, error } = await supabaseAdmin
      .from("affiliate_payouts").update(patch).eq("id", data.payoutId).select().single();
    if (error) throw new Error(error.message);

    if (data.status === "paid") {
      await supabaseAdmin.from("affiliate_commissions")
        .update({ status: "paid", paid_at: now, updated_at: now })
        .eq("payout_id", data.payoutId);
    } else if (data.status === "rejected") {
      await supabaseAdmin.from("affiliate_commissions")
        .update({ payout_id: null, updated_at: now })
        .eq("payout_id", data.payoutId);
    }

    try {
      const { logAudit } = await import("@/lib/admin-audit.functions");
      await logAudit({
        targetUserId: userId, adminUserId: userId, adminEmail: null,
        action: `affiliate_payout_${data.status}`,
        description: `Saque ${data.payoutId} atualizado para ${data.status}`,
        metadata: { payoutId: data.payoutId, amount_cents: payout.amount_cents },
      });
    } catch {}

    return updated;
  });

// ===================== PHASE 6: LEADERBOARD / GOALS / EXPORT =====================

export const getAffiliateLeaderboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const [{ data: comms }, { data: refs }, { data: affs }, { data: mine }] = await Promise.all([
      supabaseAdmin.from("affiliate_commissions").select("affiliate_id, commission_cents, status, created_at").gte("created_at", since),
      supabaseAdmin.from("referrals").select("affiliate_id, status, created_at").gte("created_at", since),
      supabaseAdmin.from("affiliates").select("id, user_id, code").eq("status", "active"),
      supabase.from("affiliates").select("id").eq("user_id", userId).maybeSingle(),
    ]);

    const stats = new Map<string, { conversions: number; commission_cents: number }>();
    for (const a of (affs ?? []) as any[]) stats.set(a.id, { conversions: 0, commission_cents: 0 });
    for (const r of (refs ?? []) as any[]) {
      if (r.status === "converted") {
        const s = stats.get(r.affiliate_id); if (s) s.conversions += 1;
      }
    }
    for (const c of (comms ?? []) as any[]) {
      const s = stats.get(c.affiliate_id); if (s) s.commission_cents += c.commission_cents;
    }

    const userIds = (affs ?? []).map((a: any) => a.user_id);
    const { data: profiles } = userIds.length
      ? await supabaseAdmin.from("profiles").select("id, name").in("id", userIds)
      : { data: [] as any[] };
    const pMap = new Map((profiles ?? []).map((p: any) => [p.id, p]));

    const rows = (affs ?? []).map((a: any) => ({
      affiliate_id: a.id,
      code: a.code,
      name: pMap.get(a.user_id)?.name || "Afiliado",
      conversions: stats.get(a.id)?.conversions ?? 0,
      commission_cents: stats.get(a.id)?.commission_cents ?? 0,
    })).sort((a, b) => b.commission_cents - a.commission_cents || b.conversions - a.conversions).slice(0, 20);

    let myRank: number | null = null;
    if (mine?.id) {
      const idx = rows.findIndex((r: any) => r.affiliate_id === mine.id);
      myRank = idx >= 0 ? idx + 1 : null;
    }
    return { rows, myRank, since };
  });

export const listAffiliateGoals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { supabase, userId } = context;

    const [{ data: goals }, { data: aff }] = await Promise.all([
      supabaseAdmin.from("affiliate_goals").select("*").eq("active", true).order("sales_count", { ascending: true }),
      supabase.from("affiliates").select("id").eq("user_id", userId).maybeSingle(),
    ]);

    let converted = 0;
    if (aff?.id) {
      const { count } = await supabaseAdmin.from("referrals")
        .select("id", { count: "exact", head: true })
        .eq("affiliate_id", aff.id).eq("status", "converted");
      converted = count ?? 0;
    }
    return { goals: goals ?? [], converted };
  });

export const adminUpsertGoal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({
    id: z.string().uuid().optional(),
    sales_count: z.number().int().min(1),
    reward_type: z.enum(["bonus_cents", "commission_boost", "gift"]),
    reward_value_cents: z.number().int().min(0),
    description: z.string().max(300).optional(),
    active: z.boolean().default(true),
  }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await ensureAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.id) {
      const { data: r, error } = await supabaseAdmin.from("affiliate_goals").update({
        sales_count: data.sales_count,
        reward_type: data.reward_type,
        reward_value_cents: data.reward_value_cents,
        description: data.description ?? null,
        active: data.active,
      }).eq("id", data.id).select().single();
      if (error) throw new Error(error.message);
      return r;
    }
    const { data: r, error } = await supabaseAdmin.from("affiliate_goals").insert({
      sales_count: data.sales_count,
      reward_type: data.reward_type,
      reward_value_cents: data.reward_value_cents,
      description: data.description ?? null,
      active: data.active,
    }).select().single();
    if (error) throw new Error(error.message);
    return r;
  });

export const adminDeleteGoal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await ensureAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("affiliate_goals").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

function toCsv(rows: any[]): string {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const escape = (v: any) => {
    if (v == null) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(","), ...rows.map(r => headers.map(h => escape(r[h])).join(","))].join("\n");
}

export const adminExportAffiliatesCsv = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({
    dataset: z.enum(["affiliates", "commissions", "payouts", "referrals"]).default("affiliates"),
  }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await ensureAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let rows: any[] = [];
    if (data.dataset === "affiliates") {
      const { data: affs } = await supabaseAdmin.from("affiliates").select("*").order("created_at", { ascending: false }).limit(5000);
      const userIds = (affs ?? []).map((a: any) => a.user_id);
      const { data: profiles } = userIds.length
        ? await supabaseAdmin.from("profiles").select("id, name, email, phone").in("id", userIds)
        : { data: [] as any[] };
      const pMap = new Map((profiles ?? []).map((p: any) => [p.id, p]));
      rows = (affs ?? []).map((a: any) => ({
        code: a.code, status: a.status, coupon_code: a.coupon_code,
        custom_commission_pct: a.custom_commission_pct,
        name: pMap.get(a.user_id)?.name, email: pMap.get(a.user_id)?.email, phone: pMap.get(a.user_id)?.phone,
        created_at: a.created_at,
      }));
    } else if (data.dataset === "commissions") {
      const { data: rr } = await supabaseAdmin.from("affiliate_commissions").select("*").order("created_at", { ascending: false }).limit(10000);
      rows = rr ?? [];
    } else if (data.dataset === "payouts") {
      const { data: rr } = await supabaseAdmin.from("affiliate_payouts").select("*").order("created_at", { ascending: false }).limit(5000);
      rows = rr ?? [];
    } else {
      const { data: rr } = await supabaseAdmin.from("referrals").select("*").order("created_at", { ascending: false }).limit(10000);
      rows = rr ?? [];
    }
    return { csv: toCsv(rows), count: rows.length, filename: `abio-${data.dataset}-${new Date().toISOString().slice(0,10)}.csv` };
  });
