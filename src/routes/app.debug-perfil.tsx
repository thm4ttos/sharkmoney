import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { useAuthProfile } from "@/hooks/use-auth-profile";

export const Route = createFileRoute("/app/debug-perfil")({
  component: DebugPerfilPage,
});

function Field({ label, value, missing }: { label: string; value: unknown; missing?: boolean }) {
  return (
    <div className="grid grid-cols-3 gap-3 py-2 border-b border-border/60 text-sm">
      <div className="text-muted-foreground">{label}</div>
      <div className={`col-span-2 font-mono break-all ${missing ? "text-destructive" : "text-foreground"}`}>
        {value === null || value === undefined || value === "" ? (
          <span className="italic text-destructive">— ausente —</span>
        ) : typeof value === "object" ? (
          JSON.stringify(value, null, 2)
        ) : (
          String(value)
        )}
      </div>
    </div>
  );
}

function DebugPerfilPage() {
  const { user, isReady, isAdmin } = useAuth();
  const { profile, loading, error } = useAuthProfile();
  const [rolesRows, setRolesRows] = useState<any[] | null>(null);
  const [rolesErr, setRolesErr] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    supabase.from("user_roles").select("*").eq("user_id", user.id).then(({ data, error }) => {
      if (error) setRolesErr(error.message);
      else setRolesRows(data ?? []);
    });
  }, [user?.id]);

  const missing: string[] = [];
  if (!profile) missing.push("profile (row inteira)");
  else {
    if (!profile.name) missing.push("profile.name");
    if (!profile.email) missing.push("profile.email");
    if (!profile.phone) missing.push("profile.phone");
  }

  return (
    <div className="max-w-3xl space-y-6">
      <header>
        <h1 className="font-display text-2xl">Diagnóstico do perfil</h1>
        <p className="text-sm text-muted-foreground">
          Rota temporária para identificar de onde vêm (e onde estão faltando) os dados do usuário autenticado.
        </p>
      </header>

      {missing.length > 0 && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          ⚠️ Campos ausentes: <b>{missing.join(", ")}</b>
        </div>
      )}
      {error && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          Erro ao carregar perfil: {error}
        </div>
      )}

      <section className="rounded-2xl border border-border bg-card/60 p-4">
        <h2 className="font-display text-lg mb-2">auth.user (Supabase Auth)</h2>
        <Field label="isReady" value={isReady} />
        <Field label="auth.user.id" value={user?.id} missing={!user?.id} />
        <Field label="auth.user.email" value={user?.email} missing={!user?.email} />
        <Field label="auth.user.phone" value={user?.phone} />
        <Field label="auth.user.user_metadata" value={user?.user_metadata} />
        <Field label="auth.user.app_metadata" value={user?.app_metadata} />
        <Field label="auth.user.last_sign_in_at" value={user?.last_sign_in_at} />
        <Field label="isAdmin (user_roles)" value={isAdmin} />
      </section>

      <section className="rounded-2xl border border-border bg-card/60 p-4">
        <h2 className="font-display text-lg mb-2">public.profiles (linha do usuário)</h2>
        <Field label="loading" value={loading} />
        <Field label="profile.id" value={profile?.id} missing={!profile?.id} />
        <Field label="profile.name" value={profile?.name} missing={!profile?.name} />
        <Field label="profile.email" value={profile?.email} missing={!profile?.email} />
        <Field label="profile.phone" value={profile?.phone} missing={!profile?.phone} />
        <Field label="profile.plan" value={profile?.plan} />
        <Field label="profile.status" value={profile?.status} />
        <Field label="profile.avatar_url" value={profile?.avatar_url} />
        <Field label="profile.created_at" value={profile?.created_at} />
        <Field label="profile.welcome_sent_at" value={profile?.welcome_sent_at} />
      </section>

      <section className="rounded-2xl border border-border bg-card/60 p-4">
        <h2 className="font-display text-lg mb-2">public.user_roles</h2>
        {rolesErr && <p className="text-destructive text-sm">{rolesErr}</p>}
        <Field label="rows" value={rolesRows} />
      </section>

      <section className="rounded-2xl border border-border bg-card/60 p-4">
        <h2 className="font-display text-lg mb-2">Conclusão automática</h2>
        <p className="text-sm text-muted-foreground">
          O nome exibido em toda a interface vem de <b className="text-foreground font-mono">public.profiles.name</b>,
          populado pelo trigger <b className="text-foreground font-mono">handle_new_user()</b> a partir de
          <b className="text-foreground font-mono"> auth.users.raw_user_meta_data-&gt;&gt;'name'</b>.
          Se o campo estiver vazio, edite o nome em <b>Meu Perfil</b> ou atualize a linha de <code>profiles</code>.
        </p>
      </section>
    </div>
  );
}
