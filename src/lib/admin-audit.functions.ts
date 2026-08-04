// SERVER-ONLY. Auditoria administrativa + impersonação + reset de senha.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function ensureAdmin(supabase: any, userId: string) {
  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Error("Forbidden");
}

async function getAdminEmail(supabaseAdmin: any, userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin.auth.admin.getUserById(userId);
  return data?.user?.email ?? null;
}

export async function logAudit(opts: {
  targetUserId: string;
  adminUserId: string;
  adminEmail: string | null;
  action: string;
  description: string;
  metadata?: Record<string, unknown>;
}) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin.from("admin_audit_log").insert({
    target_user_id: opts.targetUserId,
    admin_user_id: opts.adminUserId,
    admin_email: opts.adminEmail,
    action: opts.action,
    description: opts.description,
    metadata: (opts.metadata ?? {}) as any,
  });
}

export const adminListAuditLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      targetUserId: z.string().uuid().optional(),
      limit: z.number().min(1).max(500).optional(),
    }).parse(i ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await ensureAdmin(supabase, userId);
    let q = supabase
      .from("admin_audit_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 100);
    if (data.targetUserId) q = q.eq("target_user_id", data.targetUserId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const adminImpersonateUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ targetUserId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await ensureAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: target } = await supabaseAdmin.auth.admin.getUserById(data.targetUserId);
    if (!target?.user?.email) throw new Error("Usuário sem e-mail cadastrado.");

    const origin = process.env.SUPABASE_URL ? "" : "";
    // Generate magic link. redirectTo será resolvido pelo cliente ao abrir.
    const { data: link, error } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email: target.user.email,
    });
    if (error) throw new Error(error.message);

    const adminEmail = await getAdminEmail(supabaseAdmin, userId);
    await logAudit({
      targetUserId: data.targetUserId,
      adminUserId: userId,
      adminEmail,
      action: "impersonate",
      description: `Magic link de impersonação gerado para ${target.user.email}`,
      metadata: { target_email: target.user.email },
    });

    return {
      ok: true as const,
      actionLink: link?.properties?.action_link ?? null,
      email: target.user.email,
    };
  });

export const adminSendPasswordReset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      targetUserId: z.string().uuid(),
      redirectTo: z.string().url().optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await ensureAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: target } = await supabaseAdmin.auth.admin.getUserById(data.targetUserId);
    if (!target?.user?.email) throw new Error("Usuário sem e-mail cadastrado.");

    const { data: link, error } = await supabaseAdmin.auth.admin.generateLink({
      type: "recovery",
      email: target.user.email,
      options: data.redirectTo ? { redirectTo: data.redirectTo } : undefined,
    });
    if (error) throw new Error(error.message);

    const adminEmail = await getAdminEmail(supabaseAdmin, userId);
    await logAudit({
      targetUserId: data.targetUserId,
      adminUserId: userId,
      adminEmail,
      action: "password_reset",
      description: `Link de redefinição de senha gerado para ${target.user.email}`,
      metadata: { target_email: target.user.email },
    });

    return {
      ok: true as const,
      actionLink: link?.properties?.action_link ?? null,
      email: target.user.email,
    };
  });
