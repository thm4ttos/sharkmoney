import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { extractDateHintSP } from "@/lib/datetime";

// ===== Read =====
export const getMyProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  });

export const listTransactions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      from: z.string().optional(),
      to: z.string().optional(),
      category: z.string().optional(),
      categories: z.array(z.string()).optional(),
      kind: z.enum(["income", "expense"]).optional(),
      q: z.string().optional(),
      limit: z.number().min(1).max(1000).optional(),
      offset: z.number().min(0).optional(),
      withCount: z.boolean().optional(),
    }).parse(i ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const limit = data.limit ?? 200;
    const offset = data.offset ?? 0;
    const withCount = data.withCount !== false;
    let q = withCount
      ? supabase.from("transactions").select("*", { count: "exact" })
      : supabase.from("transactions").select("*");
    q = q.eq("user_id", userId)
      .order("occurred_at", { ascending: false })
      .order("created_at", { ascending: false });
    if (data.from) q = q.gte("occurred_at", data.from);
    if (data.to) q = q.lte("occurred_at", data.to);
    if (data.category) q = q.eq("category", data.category);
    if (data.categories && data.categories.length) q = q.in("category", data.categories);
    if (data.kind) q = q.eq("kind", data.kind);
    if (data.q && data.q.trim()) {
      const term = data.q.trim().replace(/[%,()]/g, " ");
      q = q.or(`description.ilike.%${term}%,category.ilike.%${term}%`);
    }
    q = q.range(offset, offset + limit - 1);
    const { data: rows, error, count } = await q;
    if (error) throw new Error(error.message);
    return { rows: rows ?? [], total: count ?? (rows?.length ?? 0), limit, offset };
  });

export const listAppointments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("appointments")
      .select("*")
      .eq("user_id", context.userId)
      .order("scheduled_at", { ascending: true })
      .limit(200);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const listMyWhatsappMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("whatsapp_messages")
      .select("*")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getDashboardSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("transactions")
      .select("kind, amount, category, occurred_at")
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    let income = 0, expense = 0;
    const byCat: Record<string, number> = {};
    const byMonth: Record<string, { income: number; expense: number }> = {};
    for (const r of rows) {
      const amt = Number(r.amount);
      if (r.kind === "income") income += amt; else expense += amt;
      const m = (r.occurred_at as string).slice(0, 7);
      byMonth[m] ??= { income: 0, expense: 0 };
      if (r.kind === "income") byMonth[m].income += amt; else byMonth[m].expense += amt;
      if (r.kind === "expense") byCat[r.category] = (byCat[r.category] ?? 0) + amt;
    }
    return { income, expense, balance: income - expense, byCat, byMonth };
  });

export const getCategorySummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      category: z.string().min(1),
      from: z.string().optional(),
      to: z.string().optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    let q = supabase
      .from("transactions")
      .select("id, amount, description, category, occurred_at, kind")
      .eq("user_id", userId)
      .eq("category", data.category)
      .order("occurred_at", { ascending: false });
    if (data.from) q = q.gte("occurred_at", data.from);
    if (data.to) q = q.lte("occurred_at", data.to);
    const { data: rows, error } = await q.limit(500);
    if (error) throw new Error(error.message);
    const list = rows ?? [];
    const amounts = list.map((r) => Number(r.amount));
    const total = amounts.reduce((a, b) => a + b, 0);
    const count = list.length;
    const max = count ? Math.max(...amounts) : 0;
    const min = count ? Math.min(...amounts) : 0;
    const avg = count ? total / count : 0;
    return {
      category: data.category,
      total,
      count,
      max,
      min,
      avg,
      last: list.slice(0, 5).map((r) => ({
        id: r.id,
        amount: Number(r.amount),
        description: r.description ?? "",
        occurred_at: r.occurred_at,
        kind: r.kind,
      })),
    };
  });

export const getCategoriesOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      from: z.string().optional(),
      to: z.string().optional(),
      kind: z.enum(["income", "expense"]).optional(),
    }).parse(i ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    let q = supabase
      .from("transactions")
      .select("id, amount, category, description, occurred_at, kind, source")
      .eq("user_id", userId);
    if (data.from) q = q.gte("occurred_at", data.from);
    if (data.to) q = q.lte("occurred_at", data.to);
    if (data.kind) q = q.eq("kind", data.kind);
    const { data: rows, error } = await q.order("occurred_at", { ascending: false }).limit(10000);
    if (error) throw new Error(error.message);
    const list = rows ?? [];

    type Cat = {
      category: string;
      total: number;
      count: number;
      income: number;
      expense: number;
      lastAt: string | null;
      lastDescription: string | null;
      spark: number[];
    };
    const map = new Map<string, Cat>();
    const now = new Date();
    const bucketEnd = data.to ? new Date(data.to) : now;
    const bucketStart = data.from ? new Date(data.from) : new Date(bucketEnd.getTime() - 13 * 86400000);
    const days = Math.max(1, Math.min(30, Math.ceil((+bucketEnd - +bucketStart) / 86400000) + 1));

    let grandTotal = 0;
    for (const r of list) {
      const cat = r.category || "Sem categoria";
      let c = map.get(cat);
      if (!c) {
        c = { category: cat, total: 0, count: 0, income: 0, expense: 0, lastAt: null, lastDescription: null, spark: new Array(days).fill(0) };
        map.set(cat, c);
      }
      const amt = Number(r.amount) || 0;
      c.total += amt;
      c.count += 1;
      if (r.kind === "income") c.income += amt; else c.expense += amt;
      if (!c.lastAt || (r.occurred_at as string) > c.lastAt) {
        c.lastAt = r.occurred_at as string;
        c.lastDescription = r.description ?? null;
      }
      const idx = Math.min(days - 1, Math.max(0, Math.floor((+new Date(r.occurred_at as string) - +bucketStart) / 86400000)));
      c.spark[idx] += amt;
      grandTotal += amt;
    }
    const categories = Array.from(map.values())
      .map((c) => ({ ...c, avg: c.count ? c.total / c.count : 0, percent: grandTotal > 0 ? (c.total / grandTotal) * 100 : 0 }))
      .sort((a, b) => b.total - a.total);
    return { categories, grandTotal, count: list.length };
  });





// ===== Write =====
const txInput = z.object({
  kind: z.enum(["income", "expense"]),
  amount: z.number().min(0).max(1_000_000),
  category: z.string().min(1).max(60),
  description: z.string().max(280).optional(),
  occurred_at: z.string().optional(),
});

export const createTransaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => txInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { writeVerifiedTransaction } = await import("@/lib/transaction-ledger.server");
    return writeVerifiedTransaction(supabase, {
      userId, kind: data.kind, amount: data.amount, category: data.category,
      description: data.description ?? null,
      occurredAt: data.occurred_at ?? new Date().toISOString(), source: "web",
    });
  });

export const deleteTransaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("transactions")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateTransaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      id: z.string().uuid(),
      kind: z.enum(["income", "expense"]),
      amount: z.number().min(0).max(1_000_000),
      category: z.string().min(1).max(60),
      description: z.string().max(280).optional(),
      occurred_at: z.string().optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data;
    const { data: row, error } = await context.supabase
      .from("transactions")
      .update(patch)
      .eq("id", id)
      .eq("user_id", context.userId)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const createAppointment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      title: z.string().min(1).max(140),
      notes: z.string().max(500).optional(),
      scheduled_at: z.string(),
      category: z.string().max(40).optional(),
      priority: z.string().max(20).optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (isNaN(new Date(data.scheduled_at).getTime())) throw new Error("Data/hora inválida.");
    const { data: row, error } = await supabase
      .from("appointments")
      .insert({ ...data, user_id: userId, source: "web", status: "pending", ai_confidence: 1, source_text: data.title } as any)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const updateAppointment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      id: z.string().uuid(),
      title: z.string().min(1).max(140).optional(),
      notes: z.string().max(500).nullable().optional(),
      scheduled_at: z.string().optional(),
      category: z.string().max(40).nullable().optional(),
      priority: z.string().max(20).nullable().optional(),
      status: z.enum(["pending", "done", "cancelled"]).optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { id, ...patch } = data;
    if (patch.scheduled_at && isNaN(new Date(patch.scheduled_at).getTime())) throw new Error("Data/hora inválida.");
    const { data: row, error } = await supabase
      .from("appointments")
      .update(patch as any)
      .eq("id", id)
      .eq("user_id", userId)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const deleteAppointment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("appointments").delete().eq("id", data.id).eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });


// ===== AI Quick Add =====
export const quickAddNlp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ text: z.string().min(1).max(500) }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { classifyMessage } = await import("./ai-classify.server");
    const actions = await import("./brinzap-actions.server");
    const { normalizeSpokenMoney } = await import("./money-speech");
    // "trinta e sete reais e vinte e cinco centavos" → "37,25" (um único valor)
    const text = normalizeSpokenMoney(data.text);
    const deterministic = actions.detectSpontaneousExpenseIntent(text);
    const result = deterministic ?? await classifyMessage(text);
    if (result.kind === "expense" || result.kind === "income") {
      const hint = extractDateHintSP(text);
      if (hint?.future) return { type: "unknown", ai: result };
      const inferred = actions.inferTransactionCategory(`${result.description ?? ""} ${text}`);
      const { writeVerifiedTransaction } = await import("@/lib/transaction-ledger.server");
      const row = await writeVerifiedTransaction(supabase, {
        userId, kind: result.kind, amount: result.amount ?? 0,
        category: result.kind === "income" ? "Receita" : (result.category && result.category !== "Outros" ? result.category : inferred),
        description: result.description ?? text,
        occurredAt: hint?.iso ?? result.occurred_at ?? new Date().toISOString(), source: "web",
      });
      return { type: "transaction", row, ai: result };
    }
    if (result.kind === "appointment") {
      const { data: row, error } = await supabase
        .from("appointments")
        .insert({
          user_id: userId,
          title: result.appointment_title ?? data.text,
          scheduled_at: result.scheduled_at ?? new Date().toISOString(),
          source: "web",
        })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return { type: "appointment", row, ai: result };
    }
    return { type: "unknown", ai: result };
  });

// ===== Admin =====
async function ensureAdmin(supabase: any, userId: string) {
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
  if (!data) throw new Error("Forbidden");
}

export const adminMetrics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await ensureAdmin(supabase, userId);
    const [{ count: total }, { count: trials }, { data: txs }] = await Promise.all([
      supabase.from("profiles").select("*", { count: "exact", head: true }),
      supabase.from("profiles").select("*", { count: "exact", head: true }).gt("trial_ends_at", new Date().toISOString()),
      supabase.from("transactions").select("amount, kind").limit(10000),
    ]);
    return {
      total: total ?? 0,
      trials: trials ?? 0,
      active: (total ?? 0) - (trials ?? 0),
      mrr: 0, // placeholder até integração de pagamento
      txCount: txs?.length ?? 0,
    };
  });

export const adminListUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await ensureAdmin(supabase, userId);
    const { data, error } = await supabase.from("profiles").select("*").order("created_at", { ascending: false }).limit(500);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const adminSetUserStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      userId: z.string().uuid(),
      status: z.enum(["active", "blocked"]),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await ensureAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({
        status: data.status,
        blocked_at: data.status === "blocked" ? new Date().toISOString() : null,
      })
      .eq("id", data.userId);
    if (error) throw new Error(error.message);
    const { logAudit } = await import("@/lib/admin-audit.functions");
    const { data: admin } = await supabaseAdmin.auth.admin.getUserById(userId);
    await logAudit({
      targetUserId: data.userId,
      adminUserId: userId,
      adminEmail: admin?.user?.email ?? null,
      action: data.status === "blocked" ? "block" : "unblock",
      description: data.status === "blocked" ? "Usuário bloqueado" : "Usuário desbloqueado",
    });
    return { ok: true };
  });

// Welcome WhatsApp (chamado direto pelo signup; público mas idempotente por welcome_sent_at)
export const sendWelcomeWhatsapp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ phone: z.string().min(8).max(20) }).parse(i))

  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { normalizePhone, phoneLookupVariants } = await import("@/lib/phone");
    const phone = normalizePhone(data.phone);
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id, name, phone, welcome_sent_at")
      .in("phone", phoneLookupVariants(phone))
      .maybeSingle();
    if (!profile) return { ok: false, reason: "no_profile" };
    if (profile.welcome_sent_at) return { ok: true, already: true };

    // Idempotência atômica: tenta "reservar" o envio marcando welcome_sent_at
    // apenas se ainda estiver nulo. Se outra execução concorrente reservar
    // primeiro, esta retorna sem enviar nada.
    const { data: claimed, error: claimErr } = await supabaseAdmin
      .from("profiles")
      .update({ welcome_sent_at: new Date().toISOString() })
      .eq("id", profile.id)
      .is("welcome_sent_at", null)
      .select("id")
      .maybeSingle();
    if (claimErr || !claimed) return { ok: true, already: true };

    const { inviteMessage, ensureOnboardingRow } = await import("@/lib/onboarding.server");
    await ensureOnboardingRow(profile.id);
    const msg = `🎉 *Bem-vindo ao Shark Money!*

Seu assistente financeiro pelo WhatsApp já está pronto.

${inviteMessage()}`;
    const { sendWhatsAppText } = await import("@/lib/uazapi.server");
    const result = await sendWhatsAppText(profile.phone, msg);
    if (!result.ok) {
      // Falhou no envio: libera o lock para permitir nova tentativa futura.
      await supabaseAdmin
        .from("profiles")
        .update({ welcome_sent_at: null })
        .eq("id", profile.id);
    }
    await supabaseAdmin.from("whatsapp_messages").insert({
      user_id: profile.id, phone: profile.phone, direction: "out",
      media_type: "text", content: msg, status: result.ok ? "sent" : "send_error",
    });
    return { ok: result.ok };
  });

