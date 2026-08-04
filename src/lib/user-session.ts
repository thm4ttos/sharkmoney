// Substitui o mock antigo por Supabase Auth real.
import { supabase } from "@/integrations/supabase/client";
import { normalizePhone, phoneLookupVariants } from "./phone";

export async function signup(input: { name: string; phone: string; email: string; password: string }) {
  const phone = normalizePhone(input.phone);
  if (phone.length < 10) return { ok: false as const, error: "Celular inválido." };
  if (input.password.length < 6) return { ok: false as const, error: "Senha deve ter ao menos 6 caracteres." };
  let ref: string | null = null;
  let refCampaign: string | null = null;
  try {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      ref = params.get("ref") || params.get("af") || localStorage.getItem("abio_ref");
      refCampaign = params.get("c") || params.get("campaign");
    }
  } catch {}
  const { error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      emailRedirectTo: typeof window !== "undefined" ? window.location.origin + "/app" : undefined,
      data: { name: input.name.trim(), phone, ...(ref ? { ref } : {}), ...(refCampaign ? { ref_campaign: refCampaign } : {}) },
    },
  });
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const };
}

export async function login(identifier: string, password: string) {
  const id = identifier.trim();
  let email = id;
  // Se parece celular, busca o email no profiles
  if (!id.includes("@")) {
    const phone = normalizePhone(id);
    const { data } = await supabase.from("profiles").select("email").in("phone", phoneLookupVariants(phone)).maybeSingle();
    if (!data?.email) return { ok: false as const, error: "Conta não encontrada para este celular." };
    email = data.email;
  }
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const };
}

export async function logout() {
  await supabase.auth.signOut();
}

export function onAuthChange(cb: (userId: string | null) => void) {
  return supabase.auth.onAuthStateChange((_e, session) => cb(session?.user?.id ?? null));
}

export async function getCurrentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}
