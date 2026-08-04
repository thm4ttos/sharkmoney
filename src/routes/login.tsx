import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { login } from "@/lib/user-session";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { AppLogo } from "@/components/brinzap/AppLogo";
import { AtSign } from "lucide-react";
import { PasswordInput } from "@/components/brinzap/PasswordInput";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Entrar · Shark Money" }] }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const { isReady, user, isAdminReady, isAdmin, recordRedirect } = useAuth();
  const [id, setId] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  // Already signed in? Redirect ONCE based on role.
  useEffect(() => {
    if (!isReady || !user || !isAdminReady) return;
    const dest = isAdmin ? "/admin" : "/app";
    recordRedirect(`LoginPage → ${dest} (already signed in, admin=${isAdmin})`);
    navigate({ to: dest, replace: true });
  }, [isReady, user, isAdminReady, isAdmin, navigate, recordRedirect]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr("");
    setLoading(true);

    const raw = id.trim();
    const isAlpha = !raw.includes("@") && !/^\+?\d/.test(raw);

    let error: { message: string } | null = null;
    if (isAlpha) {
      const email = `${raw}@abio.app`;
      const r = await supabase.auth.signInWithPassword({ email, password: pw });
      error = r.error;
    } else {
      const r = await login(raw, pw);
      if (!r.ok) error = { message: r.error ?? "Erro ao entrar." };
    }

    setLoading(false);
    if (error) { setErr(error.message || "Credenciais inválidas."); return; }
    // Do NOT navigate here. The auth-context will detect SIGNED_IN, the
    // effect above will redirect exactly once based on role.
  };

  return (
    <div className="min-h-screen grid place-items-center px-6 relative">
      <div className="absolute inset-0 grid-overlay pointer-events-none" />
      <div className="relative w-full max-w-md rounded-3xl border border-border bg-card/70 backdrop-blur-xl p-8 shadow-card">
        <Link to="/" className="flex items-center gap-3 mb-6">
          <AppLogo size={40} />
        </Link>

        <h1 className="font-display text-2xl">Entre na sua conta</h1>
        <p className="text-sm text-muted-foreground mt-1">Use seu e-mail ou celular cadastrado.</p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <div>
            <label className="text-xs text-muted-foreground">E-mail ou celular</label>
            <div className="relative mt-1">
              <AtSign className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input value={id} onChange={(e) => setId(e.target.value)} placeholder="você@email.com  ou  +55 11 99999-0000"
                className="w-full bg-input rounded-xl pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 transition-smooth" />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between">
              <label className="text-xs text-muted-foreground">Senha</label>
              <Link to="/forgot-password" className="text-[11px] text-primary hover:underline">Esqueci minha senha</Link>
            </div>
            <PasswordInput value={pw} onValueChange={setPw} placeholder="••••••••" autoComplete="current-password" />
          </div>

          {err && <p className="text-xs text-destructive">{err}</p>}

          <button type="submit" disabled={loading}
            className="w-full rounded-xl bg-gradient-brand text-primary-foreground font-medium py-2.5 glow-neon hover:scale-[1.01] transition-smooth disabled:opacity-60">
            {loading ? "Entrando…" : "Entrar"}
          </button>

          <p className="text-xs text-center text-muted-foreground">
            Não tem conta? <Link to="/signup" className="text-primary hover:underline">Criar conta grátis</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
