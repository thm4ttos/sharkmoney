// Centro do usuário: visão geral do perfil, gerenciamento e WhatsApp.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normalizePhone } from "@/lib/phone";

// ============================================================
// Visão geral do perfil (dados pessoais + financeiros + conta)
// ============================================================
export const getProfileOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const { data: profile, error: pErr } = await supabase
      .from("profiles")
      .select(
        "id, name, phone, email, plan, status, created_at, updated_at, trial_ends_at, notify_whatsapp, notify_email, weekly_summary_enabled, last_seen_at, avatar_url, gender",
      )
      .eq("id", userId)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);

    const [
      { count: totalTx },
      { data: allRows },
      { data: catRows },
      { count: goalsCount },
      { count: apptCount },
      { count: billsCount },
      waAgg,
    ] = await Promise.all([
      supabase.from("transactions").select("id", { count: "exact", head: true }).eq("user_id", userId),
      supabase.from("transactions").select("kind, amount").eq("user_id", userId),
      supabase.from("transactions").select("category").eq("user_id", userId),
      supabase.from("financial_goals").select("id", { count: "exact", head: true }).eq("user_id", userId),
      supabase.from("appointments").select("id", { count: "exact", head: true }).eq("user_id", userId),
      supabase.from("recurring_bills").select("id", { count: "exact", head: true }).eq("user_id", userId),
      supabase.from("whatsapp_messages").select("media_type, direction, ai_intent").eq("user_id", userId),
    ]);

    let balance = 0, totalIncome = 0, totalExpense = 0;
    for (const r of allRows ?? []) {
      const a = Number((r as any).amount) || 0;
      if ((r as any).kind === "income") { balance += a; totalIncome += a; }
      else { balance -= a; totalExpense += a; }
    }
    const distinctCategories = new Set<string>();
    for (const r of catRows ?? []) {
      const c = (r as any).category;
      if (c) distinctCategories.add(String(c));
    }

    // WhatsApp totals
    const waRows = (waAgg.data ?? []) as Array<{ media_type: string; direction: string; ai_intent: string | null }>;
    const msgsTotal = waRows.length;
    const audioCount = waRows.filter((m) => m.media_type === "audio").length;
    const imageCount = waRows.filter((m) => m.media_type === "image").length;
    const aiCount = waRows.filter((m) => m.direction === "out" && m.ai_intent).length;

    // touch last_seen_at (best effort)
    await supabase.from("profiles").update({ last_seen_at: new Date().toISOString() } as any).eq("id", userId);

    // === Security: last sign in / IP (admin) ===
    let security: {
      lastSignInAt: string | null;
      lastIp: string | null;
      provider: string | null;
      sessions: number;
    } = { lastSignInAt: null, lastIp: null, provider: null, sessions: 0 };
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: u } = await supabaseAdmin.auth.admin.getUserById(userId);
      const usr: any = u?.user ?? null;
      security = {
        lastSignInAt: usr?.last_sign_in_at ?? null,
        lastIp:
          usr?.user_metadata?.last_ip ??
          usr?.app_metadata?.last_ip ??
          usr?.last_sign_in_ip ?? null,
        provider:
          (usr?.app_metadata?.provider as string) ??
          (Array.isArray(usr?.identities) && usr.identities[0]?.provider) ?? null,
        sessions: Array.isArray((u as any)?.user?.factors) ? 1 : 1, // best-effort: 1 known session
      };
    } catch { /* ignore */ }

    // === AI settings (admin-read; safe to surface model/status without key) ===
    let ai: {
      enabled: boolean;
      model: string | null;
      hasKey: boolean;
      lastUsedAt: string | null;
    } = { enabled: false, model: null, hasKey: false, lastUsedAt: null };
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: row } = await supabaseAdmin
        .from("ai_settings")
        .select("enabled, model, api_key, last_used_at")
        .eq("id", 1)
        .maybeSingle();
      if (row) {
        ai = {
          enabled: !!(row as any).enabled,
          model: ((row as any).model ?? null) as string | null,
          hasKey: !!((row as any).api_key && String((row as any).api_key).length > 0),
          lastUsedAt: ((row as any).last_used_at ?? null) as string | null,
        };
      }
    } catch { /* ignore */ }

    return {
      profile,
      finance: {
        balance: Math.round(balance * 100) / 100,
        incomeMonth: Math.round(totalIncome * 100) / 100,
        expenseMonth: Math.round(totalExpense * 100) / 100,
        savedMonth: Math.round((totalIncome - totalExpense) * 100) / 100,
        totalTransactions: totalTx ?? 0,
        totalIncome: Math.round(totalIncome * 100) / 100,
        totalExpense: Math.round(totalExpense * 100) / 100,
      },
      counts: {
        transactions: totalTx ?? 0,
        categoriesUsed: distinctCategories.size,
        goals: goalsCount ?? 0,
        appointments: apptCount ?? 0,
        bills: billsCount ?? 0,
        remindersTotal: (apptCount ?? 0) + (billsCount ?? 0),
        whatsappMessages: msgsTotal,
        audios: audioCount,
        images: imageCount,
        aiReplies: aiCount,
      },
      ai,
      security,
    };
  });

// ============================================================
// Atualizar dados básicos
// ============================================================
export const updateMyProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        name: z.string().trim().min(1).max(120).optional(),
        email: z.string().trim().email().max(255).optional().or(z.literal("")),
        phone: z.string().trim().min(8).max(20).optional(),
        notify_whatsapp: z.boolean().optional(),
        notify_email: z.boolean().optional(),
        weekly_summary_enabled: z.boolean().optional(),
        gender: z.enum(["male", "female", "other"]).nullable().optional(),
        // data URI (imagem recortada) ou null para remover
        avatar_url: z.string().max(3_000_000).nullable().optional(),
      })
      .parse(i),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const patch: Record<string, any> = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.email !== undefined) patch.email = data.email || null;
    if (data.phone !== undefined) patch.phone = normalizePhone(data.phone);
    if (data.notify_whatsapp !== undefined) patch.notify_whatsapp = data.notify_whatsapp;
    if (data.notify_email !== undefined) patch.notify_email = data.notify_email;
    if (data.weekly_summary_enabled !== undefined) patch.weekly_summary_enabled = data.weekly_summary_enabled;
    if (data.gender !== undefined) patch.gender = data.gender;
    if (data.avatar_url !== undefined) {
      if (data.avatar_url && !/^data:image\/(png|jpe?g|webp);base64,/.test(data.avatar_url)) {
        throw new Error("Formato de imagem inválido.");
      }
      patch.avatar_url = data.avatar_url;
    }
    if (Object.keys(patch).length === 0) return { ok: true };
    const { error } = await supabase.from("profiles").update(patch as any).eq("id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============================================================
// Encerrar todas as sessões (logout global)
// ============================================================
export const signOutAllSessions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.signOut(userId, "global");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============================================================
// Exportar todos os meus dados (JSON)
// ============================================================
export const exportMyData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const tables = [
      "transactions", "appointments", "financial_goals", "recurring_bills",
      "installment_purchases", "debts", "salary_entries", "budgets", "assets",
      "support_tickets", "whatsapp_messages",
    ] as const;
    const dump: Record<string, any[]> = {};
    for (const t of tables) {
      const { data } = await supabase.from(t as any).select("*").eq("user_id", userId);
      dump[t] = data ?? [];
    }
    const { data: profile } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
    return {
      generated_at: new Date().toISOString(),
      profile,
      data: dump,
    };
  });

// ============================================================
// WhatsApp: status real da conexão Z-API + métricas do usuário
// ============================================================
async function loadZapiCredsAdmin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("zapi_credentials")
    .select("instance_id, instance_token, client_token, updated_at")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (data?.instance_id && data?.instance_token && data?.client_token) {
    return {
      instanceId: data.instance_id,
      instanceToken: data.instance_token,
      clientToken: data.client_token,
      updatedAt: data.updated_at as string | null,
    };
  }
  const base = process.env.UAZAPI_BASE_URL ?? "";
  const m = base.match(/instances\/([^/]+)\/token\/([^/]+)/);
  return {
    instanceId: m?.[1] ?? "",
    instanceToken: m?.[2] ?? "",
    clientToken: process.env.UAZAPI_INSTANCE_TOKEN ?? "",
    updatedAt: null as string | null,
  };
}

async function zapiGet(
  creds: { instanceId: string; instanceToken: string; clientToken: string },
  path: string,
) {
  if (!creds.instanceId || !creds.instanceToken || !creds.clientToken) {
    return { ok: false, status: 0, data: null as any, error: "ZAPI_NOT_CONFIGURED" };
  }
  try {
    const url = `https://api.z-api.io/instances/${creds.instanceId}/token/${creds.instanceToken}/${path}`;
    const res = await fetch(url, { headers: { "Client-Token": creds.clientToken } });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* ignore */ }
    return { ok: res.ok, status: res.status, data: json ?? { raw: text } };
  } catch (e: any) {
    return { ok: false, status: 0, data: null as any, error: e?.message ?? "ZAPI_FETCH_FAILED" };
  }
}

function formatIntl(phone?: string | null) {
  if (!phone) return "";
  const d = String(phone).replace(/\D/g, "");
  if (d.length === 13 && d.startsWith("55")) {
    return `+55 ${d.slice(2, 4)} ${d.slice(4, 9)}-${d.slice(9)}`;
  }
  if (d.length === 12 && d.startsWith("55")) {
    return `+55 ${d.slice(2, 4)} ${d.slice(4, 8)}-${d.slice(8)}`;
  }
  return phone.startsWith("+") ? phone : `+${d}`;
}

export const getWhatsAppConnection = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const creds = await loadZapiCredsAdmin();

    const [status, device, profileRes, msgsRes] = await Promise.all([
      zapiGet(creds, "status"),
      zapiGet(creds, "device"),
      supabase.from("profiles").select("phone").eq("id", userId).maybeSingle(),
      supabase
        .from("whatsapp_messages")
        .select("direction, ai_intent", { count: "exact" })
        .eq("user_id", userId),
    ]);

    const connected = !!(status.data && (status.data.connected === true || status.data.smartphoneConnected === true));
    const deviceData = device.data ?? {};
    const connectedPhoneRaw: string =
      deviceData.phone ?? deviceData.id ?? status.data?.phone ?? "";
    const connectedPhone = String(connectedPhoneRaw).replace(/\D/g, "");
    const ownerName: string = deviceData.name ?? deviceData.pushname ?? deviceData.user ?? "";

    const userPhone = (profileRes.data as any)?.phone ?? "";
    const userPhoneNorm = normalizePhone(userPhone);
    const mismatch = !!(connected && connectedPhone && userPhoneNorm && connectedPhone !== userPhoneNorm);

    // counts
    const all = (msgsRes.data ?? []) as Array<{ direction: string; ai_intent: string | null }>;
    const processed = all.length;
    const aiReplies = all.filter((m) => m.direction === "out" && m.ai_intent).length;

    return {
      connected,
      configured: !!(creds.instanceId && creds.clientToken),
      connectedPhone,
      connectedPhoneFormatted: formatIntl(connectedPhone),
      ownerName,
      userPhone: userPhoneNorm,
      userPhoneFormatted: formatIntl(userPhoneNorm),
      mismatch,
      processed,
      aiReplies,
      lastSyncAt: new Date().toISOString(),
      credsUpdatedAt: creds.updatedAt,
      raw: { status: status.data, device: deviceData, statusCode: status.status, deviceCode: device.status },
    };
  });

// ============================================================
// Enviar mensagem de teste para o telefone do próprio usuário
// ============================================================
export const sendWhatsAppTest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: profile } = await supabase
      .from("profiles")
      .select("phone, name")
      .eq("id", userId)
      .maybeSingle();
    const phone = (profile as any)?.phone;
    if (!phone) throw new Error("Cadastre seu celular antes de enviar um teste.");
    const { sendWhatsAppText } = await import("@/lib/uazapi.server");
    const first = ((profile as any)?.name ?? "").split(" ")[0] || "tudo certo";
    const res = await sendWhatsAppText(
      phone,
      `✅ *Abio* — Teste de conexão\n\nOlá ${first}! Esta é uma mensagem de teste enviada do painel para confirmar que seu WhatsApp está conectado corretamente.`,
    );
    return { ok: res.ok, status: res.status, error: res.error };
  });

// ============================================================
// Reconectar / desconectar (apenas comandos suportados pela Z-API)
// ============================================================
async function zapiAction(path: string, method: "POST" | "GET" = "GET") {
  const creds = await loadZapiCredsAdmin();
  if (!creds.instanceId || !creds.clientToken) {
    return { ok: false, status: 0, error: "ZAPI_NOT_CONFIGURED" };
  }
  try {
    const url = `https://api.z-api.io/instances/${creds.instanceId}/token/${creds.instanceToken}/${path}`;
    const res = await fetch(url, {
      method,
      headers: { "Client-Token": creds.clientToken, "Content-Type": "application/json" },
    });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* ignore */ }
    return { ok: res.ok, status: res.status, data: json ?? { raw: text } };
  } catch (e: any) {
    return { ok: false, status: 0, error: e?.message ?? "ZAPI_FETCH_FAILED" };
  }
}

export const reconnectWhatsApp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => zapiAction("restart"));

export const disconnectWhatsApp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => zapiAction("disconnect"));
