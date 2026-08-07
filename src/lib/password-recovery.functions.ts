import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { phoneLookupVariants, normalizePhone } from "@/lib/phone";

const SCHEMA = z.object({
  method: z.enum(["email", "whatsapp"]),
  identifier: z.string().trim().min(3).max(120),
});

const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX = 3;

export type RecoveryResult =
  | { status: "sent"; method: "email" | "whatsapp" }
  | { status: "not_found" }
  | { status: "rate_limited"; retryAfterMinutes: number }
  | { status: "send_failed"; error?: string };

export const requestPasswordRecovery = createServerFn({ method: "POST" })
  .inputValidator((data) => SCHEMA.parse(data))
  .handler(async ({ data }): Promise<RecoveryResult> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const siteUrl =
      process.env.SITE_URL ??
      process.env.VITE_SITE_URL ??
      "https://abio.fun";
    const redirectTo = `${siteUrl}/reset-password`;

    const identifier = data.identifier.trim();

    // ---------- Rate limiting (by identifier) ----------
    const sinceIso = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
    const { count: recentCount } = await supabaseAdmin
      .from("password_recovery_log")
      .select("id", { count: "exact", head: true })
      .eq("identifier", identifier)
      .gte("created_at", sinceIso);

    if ((recentCount ?? 0) >= RATE_LIMIT_MAX) {
      return { status: "rate_limited", retryAfterMinutes: 60 };
    }

    const logAttempt = async (entry: {
      user_id?: string | null;
      phone?: string | null;
      email?: string | null;
      ok: boolean;
      error?: string;
      details?: Record<string, unknown>;
    }) => {
      try {
        await supabaseAdmin.from("password_recovery_log").insert({
          method: data.method,
          identifier,
          user_id: entry.user_id ?? null,
          phone: entry.phone ?? null,
          email: entry.email ?? null,
          ok: entry.ok,
          error: entry.error ?? null,
          details: (entry.details ?? {}) as any,
        });
      } catch (e) {
        console.warn("[recovery] log insert failed:", (e as any)?.message);
      }
    };

    // =================== EMAIL ===================
    if (data.method === "email") {
      const email = identifier.includes("@") ? identifier : `${identifier}@abio.app`;
      const { error } = await supabaseAdmin.auth.resetPasswordForEmail(email, { redirectTo });
      await logAttempt({ email, ok: !error, error: error?.message });
      // Don't leak whether the email exists.
      return { status: "sent", method: "email" };
    }

    // =================== WHATSAPP ===================
    const variants = phoneLookupVariants(identifier);
    const normalized = normalizePhone(identifier);
    if (!variants.length) {
      await logAttempt({ ok: false, error: "INVALID_PHONE" });
      return { status: "not_found" };
    }

    // Try to find profile via any phone variant
    const orClause = variants
      .flatMap((v) => [`phone.eq.${v}`, `phone.eq.+${v}`])
      .join(",");

    const { data: profile, error: profErr } = await supabaseAdmin
      .from("profiles")
      .select("id, email, phone")
      .or(orClause)
      .maybeSingle();

    if (profErr || !profile?.email) {
      await logAttempt({ phone: normalized, ok: false, error: "PHONE_NOT_FOUND" });
      return { status: "not_found" };
    }

    // Generate recovery link via Admin API
    const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
      type: "recovery",
      email: profile.email,
      options: { redirectTo },
    });

    const actionLink = linkData?.properties?.action_link;
    if (linkErr || !actionLink) {
      await logAttempt({
        user_id: profile.id,
        phone: profile.phone,
        email: profile.email,
        ok: false,
        error: linkErr?.message ?? "NO_ACTION_LINK",
      });
      return { status: "send_failed", error: "Não foi possível gerar o link de recuperação." };
    }

    const message =
      `🔐 *Abio - Recuperação de Senha*\n\n` +
      `Recebemos uma solicitação para redefinir sua senha.\n` +
      `Clique no link abaixo para criar uma nova senha:\n\n` +
      `${actionLink}\n\n` +
      `Este link é válido por 30 minutos. Se você não fez esta solicitação, ignore esta mensagem.`;

    try {
      const { sendWhatsAppText } = await import("@/lib/uazapi.server");
      const sendRes = await sendWhatsAppText(profile.phone, message);
      await logAttempt({
        user_id: profile.id,
        phone: profile.phone,
        email: profile.email,
        ok: sendRes.ok,
        error: sendRes.ok ? undefined : sendRes.error,
        details: { zapi_status: sendRes.status, zapi_source: sendRes.credsSource },
      });
      if (!sendRes.ok) {
        return { status: "send_failed", error: sendRes.error ?? "Falha ao enviar pelo WhatsApp." };
      }
      return { status: "sent", method: "whatsapp" };
    } catch (e: any) {
      await logAttempt({
        user_id: profile.id,
        phone: profile.phone,
        email: profile.email,
        ok: false,
        error: e?.message ?? "ZAPI_EXCEPTION",
      });
      return { status: "send_failed", error: "Falha ao enviar pelo WhatsApp." };
    }
  });
