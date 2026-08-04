// Diagnóstico de usuários e recuperação de permissões de administrador.
// Listar usuários (auth + profiles + roles) e promover/rebaixar admin.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { logAudit } from "@/lib/admin-audit.functions";

async function ensureAdmin(supabase: any, userId: string) {
  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Error("Forbidden");
}

export type DebugUserRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string;
  roles: string[];
  is_admin: boolean;
  status: string;
  blocked_at: string | null;
  email_confirmed_at: string | null;
  last_sign_in_at: string | null;
  created_at: string;
};

export const adminDebugListUsers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DebugUserRow[]> => {
    const { supabase, userId } = context;
    await ensureAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: profiles, error: pErr } = await supabaseAdmin
      .from("profiles")
      .select("id, name, email, phone, status, blocked_at, created_at")
      .order("created_at", { ascending: true });
    if (pErr) throw new Error(pErr.message);

    const { data: roles, error: rErr } = await supabaseAdmin
      .from("user_roles")
      .select("user_id, role");
    if (rErr) throw new Error(rErr.message);

    const rolesByUser = new Map<string, string[]>();
    for (const r of roles ?? []) {
      const arr = rolesByUser.get(r.user_id) ?? [];
      arr.push(r.role);
      rolesByUser.set(r.user_id, arr);
    }

    // Auth metadata (confirmed_at / last_sign_in_at) — paginate.
    const authByUser = new Map<string, { email_confirmed_at: string | null; last_sign_in_at: string | null }>();
    let page = 1;
    for (;;) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw new Error(error.message);
      for (const u of data.users) {
        authByUser.set(u.id, {
          email_confirmed_at: u.email_confirmed_at ?? null,
          last_sign_in_at: u.last_sign_in_at ?? null,
        });
      }
      if (data.users.length < 200) break;
      page += 1;
      if (page > 25) break;
    }

    return (profiles ?? []).map((p: any) => {
      const userRoles = rolesByUser.get(p.id) ?? [];
      const auth = authByUser.get(p.id) ?? { email_confirmed_at: null, last_sign_in_at: null };
      return {
        id: p.id,
        name: p.name ?? "",
        email: p.email ?? null,
        phone: p.phone ?? "",
        roles: userRoles,
        is_admin: userRoles.includes("admin"),
        status: p.status ?? "active",
        blocked_at: p.blocked_at ?? null,
        email_confirmed_at: auth.email_confirmed_at,
        last_sign_in_at: auth.last_sign_in_at,
        created_at: p.created_at,
      };
    });
  });

export const adminPromoteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ targetUserId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await ensureAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { error } = await supabaseAdmin
      .from("user_roles")
      .upsert(
        { user_id: data.targetUserId, role: "admin" },
        { onConflict: "user_id,role", ignoreDuplicates: true },
      );
    if (error) throw new Error(error.message);

    const { data: target } = await supabaseAdmin.auth.admin.getUserById(data.targetUserId);
    const { data: self } = await supabaseAdmin.auth.admin.getUserById(userId);
    await logAudit({
      targetUserId: data.targetUserId,
      adminUserId: userId,
      adminEmail: self?.user?.email ?? null,
      action: "promote_admin",
      description: `Concedeu papel admin a ${target?.user?.email ?? data.targetUserId}`,
    });
    return { ok: true as const };
  });

export const adminDemoteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ targetUserId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await ensureAdmin(supabase, userId);
    if (data.targetUserId === userId) {
      throw new Error("Você não pode remover seu próprio papel de administrador.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Garantir que sempre exista pelo menos 1 admin.
    const { count } = await supabaseAdmin
      .from("user_roles")
      .select("user_id", { count: "exact", head: true })
      .eq("role", "admin");
    if ((count ?? 0) <= 1) {
      throw new Error("Não é possível remover o último administrador do sistema.");
    }

    const { error } = await supabaseAdmin
      .from("user_roles")
      .delete()
      .eq("user_id", data.targetUserId)
      .eq("role", "admin");
    if (error) throw new Error(error.message);

    const { data: target } = await supabaseAdmin.auth.admin.getUserById(data.targetUserId);
    const { data: self } = await supabaseAdmin.auth.admin.getUserById(userId);
    await logAudit({
      targetUserId: data.targetUserId,
      adminUserId: userId,
      adminEmail: self?.user?.email ?? null,
      action: "demote_admin",
      description: `Removeu papel admin de ${target?.user?.email ?? data.targetUserId}`,
    });
    return { ok: true as const };
  });
