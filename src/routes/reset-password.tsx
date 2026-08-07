import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PasswordInput, PasswordStrengthMeter, passwordStrength } from "@/components/brinzap/PasswordInput";
import { AppLogo } from "@/components/brinzap/AppLogo";

export const Route = createFileRoute("/reset-password")({
  head: () => ({ meta: [{ title: "Redefinir senha · Abio" }, { name: "robots", content: "noindex" }] }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const sub = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if ((event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") && session) {
        setReady(true);
      }
    });

    (async () => {
      try {
        const url = new URL(window.location.href);
        const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));

        // PKCE flow: ?code=...
        const code = url.searchParams.get("code");
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
          // clean URL
          url.searchParams.delete("code");
          window.history.replaceState({}, "", url.pathname + url.search);
        }

        // Implicit/recovery hash flow: #access_token=...&refresh_token=...&type=recovery
        const access_token = hash.get("access_token");
        const refresh_token = hash.get("refresh_token");
        if (access_token && refresh_token) {
          const { error } = await supabase.auth.setSession({ access_token, refresh_token });
          if (error) throw error;
          window.history.replaceState({}, "", url.pathname);
        }

        // OTP token flow: ?token=...&type=recovery&email=...
        const token = url.searchParams.get("token") ?? hash.get("token");
        const type = url.searchParams.get("type") ?? hash.get("type");
        const email = url.searchParams.get("email") ?? hash.get("email");
        if (token && type === "recovery" && email) {
          const { error } = await supabase.auth.verifyOtp({ email, token, type: "recovery" });
          if (error) throw error;
        }

        const { data } = await supabase.auth.getSession();
        if (!cancelled && data.session) setReady(true);
        else if (!cancelled && !code && !access_token && !token) {
          setErr("Link de recuperação inválido ou expirado. Solicite um novo.");
        }
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || "Não foi possível validar o link de recuperação.");
      }
    })();

    return () => {
      cancelled = true;
      sub.data.subscription.unsubscribe();
    };
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr("");
    if (pw.length < 6) return setErr("A senha precisa ter pelo menos 6 caracteres.");
    if (pw !== pw2) return setErr("As senhas não coincidem.");
    if (passwordStrength(pw).score < 2) return setErr("Escolha uma senha mais forte.");
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setLoading(false);
    if (error) return setErr(error.message);
    setOk(true);
    setTimeout(() => navigate({ to: "/login", replace: true }), 1800);
  };

  return (
    <div className="min-h-screen grid place-items-center px-6 relative">
      <div className="absolute inset-0 grid-overlay pointer-events-none" />
      <div className="relative w-full max-w-md rounded-3xl border border-border bg-card/70 backdrop-blur-xl p-8 shadow-card">
        <div className="flex items-center gap-3 mb-6">
          <AppLogo size={40} />
        </div>

        <h1 className="font-display text-2xl">Defina sua nova senha</h1>
        <p className="text-sm text-muted-foreground mt-1">Use uma senha forte que você consiga lembrar.</p>

        {!ready ? (
          <div className="mt-6 rounded-xl border border-border bg-muted/20 p-4 text-xs text-muted-foreground">
            Validando link de recuperação… Se nada acontecer, peça um novo link em{" "}
            <Link to="/forgot-password" className="text-primary underline">esqueci minha senha</Link>.
          </div>
        ) : ok ? (
          <div className="mt-6 rounded-xl border border-accent/40 bg-accent/10 p-4 text-sm">
            Senha atualizada! Redirecionando para o login…
          </div>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-4">
            <div>
              <label className="text-xs text-muted-foreground">Nova senha</label>
              <PasswordInput value={pw} onValueChange={setPw} placeholder="mínimo 6 caracteres" autoComplete="new-password" />
              <PasswordStrengthMeter value={pw} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Confirmar nova senha</label>
              <PasswordInput value={pw2} onValueChange={setPw2} placeholder="repita a senha" autoComplete="new-password" />
            </div>

            {err && <p className="text-xs text-destructive">{err}</p>}

            <button type="submit" disabled={loading}
              className="w-full rounded-xl bg-gradient-brand text-primary-foreground font-medium py-2.5 glow-neon hover:scale-[1.01] transition-smooth disabled:opacity-60">
              {loading ? "Salvando…" : "Salvar nova senha"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
