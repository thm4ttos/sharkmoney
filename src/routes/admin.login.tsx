import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { adminLogin } from "@/lib/admin-session";
import { useAuth } from "@/lib/auth-context";
import { AppLogo } from "@/components/brinzap/AppLogo";
import { ShieldCheck } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { PasswordInput } from "@/components/brinzap/PasswordInput";

export const Route = createFileRoute("/admin/login")({
  head: () => ({ meta: [{ title: "Admin · Login · Abio" }, { name: "robots", content: "noindex" }] }),
  component: AdminLogin,
});

function AdminLogin() {
  const navigate = useNavigate();
  const { isReady, user, isAdminReady, isAdmin, recordRedirect } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isReady || !user || !isAdminReady) return;
    if (isAdmin) {
      recordRedirect("AdminLogin → /admin (already admin)");
      navigate({ to: "/admin", replace: true });
    }
    // user but not admin: do nothing; they will see an error if they try.
  }, [isReady, user, isAdminReady, isAdmin, navigate, recordRedirect]);

  const handle = async (e: FormEvent) => {
    e.preventDefault();
    setErr("");
    setLoading(true);
    const loginEmail = email.includes("@") ? email.trim() : `${email.trim()}@abio.app`;
    const res = await adminLogin(loginEmail, password);
    setLoading(false);
    if (!res.ok) setErr(res.error);
    // On success, auth-context picks up SIGNED_IN and the effect above redirects.
  };



  return (
    <div className="min-h-screen grid place-items-center px-6 relative">
      <div className="absolute inset-0 grid-overlay pointer-events-none" />
      <div className="relative w-full max-w-md rounded-3xl border border-border bg-card/70 backdrop-blur-xl p-8 shadow-card">
        <div className="flex items-center gap-3 mb-6">
          <AppLogo size={40} />
          <div>
            <p className="text-[10px] uppercase tracking-[0.25em] text-primary flex items-center gap-1">
              <ShieldCheck className="h-3 w-3" /> Painel administrativo
            </p>
          </div>

        </div>

        <h1 className="font-display text-2xl">Acesso restrito</h1>
        <p className="text-sm text-muted-foreground mt-1">Entre com sua conta de operação.</p>

        <form onSubmit={handle} className="mt-6 space-y-4">
          <div>
            <label className="text-xs text-muted-foreground">Usuário</label>
            <input
              type="text"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin"
              className="mt-1 w-full bg-input rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 transition-smooth"
            />
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label className="text-xs text-muted-foreground">Senha</label>
              <Link to="/forgot-password" className="text-[11px] text-primary hover:underline">Esqueci minha senha</Link>
            </div>
            <PasswordInput value={password} onValueChange={setPassword} placeholder="••••••••" autoComplete="current-password" />
          </div>

          {err && <p className="text-xs text-destructive">{err}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-gradient-brand text-primary-foreground font-medium py-2.5 glow-neon hover:scale-[1.01] transition-smooth disabled:opacity-60"
          >
            {loading ? "Entrando…" : "Entrar no admin"}
          </button>


          <p className="text-[11px] text-muted-foreground text-center pt-2">
            Acesso restrito a administradores Abio.
          </p>

        </form>
      </div>
    </div>
  );
}
