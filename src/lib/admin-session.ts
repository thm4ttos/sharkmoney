// Real admin session backed by Supabase auth + user_roles.role = 'admin'.
import { supabase } from "@/integrations/supabase/client";

export async function adminLogin(
  email: string,
  password: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    return { ok: false, error: error?.message ?? "Credenciais inválidas." };
  }
  const isAdmin = await checkIsAdmin(data.user.id);
  if (!isAdmin) {
    await supabase.auth.signOut();
    return { ok: false, error: "Esta conta não tem permissão de administrador." };
  }
  return { ok: true };
}

export async function adminLogout() {
  await supabase.auth.signOut();
}

async function checkIsAdmin(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) return false;
  return !!data;
}

export async function getAdminSession(): Promise<
  { email: string; userId: string } | null
> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  const ok = await checkIsAdmin(data.user.id);
  if (!ok) return null;
  return { email: data.user.email ?? "", userId: data.user.id };
}
