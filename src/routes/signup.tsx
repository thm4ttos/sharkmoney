import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { signup } from "@/lib/user-session";
import { useAuth } from "@/lib/auth-context";
import { AppLogo } from "@/components/brinzap/AppLogo";
import { Phone, Mail, User } from "lucide-react";
import { PasswordInput, PasswordStrengthMeter, passwordStrength } from "@/components/brinzap/PasswordInput";
import { PLAN_SLUGS } from "@/lib/plans";

export const Route = createFileRoute("/signup")({
  validateSearch: (s: Record<string, unknown>) => ({
    plan: (typeof s.plan === "string" && PLAN_SLUGS.includes(s.plan) ? s.plan : undefined) as string | undefined,
  }),
  head: () => ({ meta: [{ title: "Criar conta · Abio" }] }),
  component: SignupPage,
});

// Cadastro exige confirmação de e-mail (sem sessão imediata após signup()),
// então o plano escolhido na landing page é guardado aqui e só é retomado
// depois que a pessoa efetivamente loga pela primeira vez — ver AppLayout.tsx.
const PENDING_PLAN_KEY = "abio_pending_plan";

function SignupPage() {
  const navigate = useNavigate();
  const { plan } = Route.useSearch();
  const { isReady, user, recordRedirect } = useAuth();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState("");
  const [ok, setOk] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isReady && user) {
      recordRedirect("SignupPage → /app (already signed in)");
      navigate({ to: "/app", replace: true });
    }
  }, [isReady, user, navigate, recordRedirect]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr("");
    if (!name.trim()) return setErr("Informe seu nome.");
    if (!email.trim()) return setErr("E-mail é obrigatório.");
    if (pw.length < 6) return setErr("A senha precisa ter pelo menos 6 caracteres.");
    if (pw !== pw2) return setErr("As senhas não coincidem.");
    if (passwordStrength(pw).score < 2) return setErr("Escolha uma senha mais forte.");
    setLoading(true);
    const r = await signup({ name, phone, email, password: pw });
    if (r.ok) {
      try {
        const { sendWelcomeWhatsapp } = await import("@/lib/brinzap.functions");
        sendWelcomeWhatsapp({ data: { phone } }).catch(() => {});
      } catch {}
      if (plan) {
        try { localStorage.setItem(PENDING_PLAN_KEY, plan); } catch {}
      }
    }
    setLoading(false);
    if (r.ok) setOk(true);
    else setErr(r.error ?? "Erro ao cadastrar.");
  };


  return (
    <div className="min-h-screen grid place-items-center px-6 py-12 relative">
      <div className="absolute inset-0 grid-overlay pointer-events-none" />
      <div className="relative w-full max-w-md rounded-3xl border border-border bg-card/70 backdrop-blur-xl p-8 shadow-card">
        <Link to="/" className="flex items-center gap-3 mb-6">
          <AppLogo size={40} />
        </Link>

        <h1 className="font-display text-2xl">Crie sua conta</h1>
        <p className="text-sm text-muted-foreground mt-1">7 dias grátis. Sem cartão.</p>

        {ok ? (
          <div className="mt-6 rounded-xl border border-primary/30 bg-primary/10 p-4 text-sm">
            Confirme seu e-mail e depois <Link to="/login" className="text-primary underline">entre aqui</Link>.
          </div>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-3.5">
            <Field icon={User} label="Nome" value={name} onChange={setName} placeholder="Seu nome" />
            <Field icon={Phone} label="Celular (obrigatório)" value={phone} onChange={setPhone} placeholder="+55 11 99999-0000" />
            <Field icon={Mail} label="E-mail" value={email} onChange={setEmail} placeholder="você@email.com" type="email" />
            <div>
              <label className="text-xs text-muted-foreground">Senha</label>
              <PasswordInput value={pw} onValueChange={setPw} placeholder="mínimo 6 caracteres" autoComplete="new-password" />
              <PasswordStrengthMeter value={pw} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Confirmar senha</label>
              <PasswordInput value={pw2} onValueChange={setPw2} placeholder="repita a senha" autoComplete="new-password" />
            </div>

            {err && <p className="text-xs text-destructive">{err}</p>}

            <button type="submit" disabled={loading}
              className="w-full rounded-xl bg-gradient-brand text-primary-foreground font-medium py-2.5 glow-neon hover:scale-[1.01] transition-smooth disabled:opacity-60">
              {loading ? "Criando…" : "Criar conta e começar grátis"}
            </button>

            <p className="text-xs text-center text-muted-foreground pt-1">
              Já tem conta? <Link to="/login" className="text-primary hover:underline">Entrar</Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

function Field({ icon: Icon, label, value, onChange, placeholder, type = "text" }: {
  icon: typeof User; label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <div>
      <label className="text-xs text-muted-foreground">{label}</label>
      <div className="relative mt-1">
        <Icon className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
          className="w-full bg-input rounded-xl pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 transition-smooth" />
      </div>
    </div>
  );
}
