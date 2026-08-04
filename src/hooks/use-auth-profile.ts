// Single source of truth for the loaded profile of the authenticated user.
// Reads the session from <AuthProvider> (no second onAuthStateChange listener,
// no race against getUser()), then fetches the row from public.profiles.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";

export type Profile = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  plan: string;
  status?: string | null;
  avatar_url?: string | null;
  gender?: string | null;
  trial_ends_at: string;
  created_at?: string | null;
  welcome_sent_at?: string | null;
};

export function useAuthProfile() {
  const { isReady, user } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // Recarrega quando o perfil é alterado em outra tela (ex.: nova foto).
  useEffect(() => {
    const h = () => setTick((t) => t + 1);
    window.addEventListener("abio:profile-updated", h);
    return () => window.removeEventListener("abio:profile-updated", h);
  }, []);

  useEffect(() => {
    let mounted = true;
    if (!isReady) return;
    if (!user) {
      setProfile(null);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    (async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .maybeSingle();
      if (!mounted) return;
      if (error) {
        console.error("[useAuthProfile] erro ao carregar profile", { userId: user.id, error });
        setError(error.message);
        setProfile(null);
      } else if (!data) {
        console.error("[useAuthProfile] profile não encontrado para user", user.id);
        setError("Perfil não encontrado.");
        setProfile(null);
      } else {
        if (!(data as any).name) {
          console.error("[useAuthProfile] profile sem nome (campo 'name' vazio)", { userId: user.id, profile: data });
        }
        setProfile(data as Profile);
        setError(null);
      }
      setLoading(false);
    })();
    return () => { mounted = false; };
  }, [isReady, user?.id, tick]);

  return { profile, loading, error };
}

export function trialDaysLeft(p: Profile) {
  return Math.max(0, Math.ceil((new Date(p.trial_ends_at).getTime() - Date.now()) / 86400_000));
}

export function initialsOf(name: string | null | undefined): string {
  if (!name) return "";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0]!.charAt(0).toUpperCase();
  return (parts[0]!.charAt(0) + parts[parts.length - 1]!.charAt(0)).toUpperCase();
}

export function firstNameOf(name: string | null | undefined): string {
  return (name ?? "").trim().split(/\s+/)[0] ?? "";
}

export function greetingFor(firstName: string): string {
  const h = new Date().getHours();
  if (h < 12) return `Bom dia, ${firstName} ☀️`;
  if (h < 18) return `Boa tarde, ${firstName} 🌤️`;
  return `Boa noite, ${firstName} 🌙`;
}
