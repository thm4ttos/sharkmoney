import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { requestPasswordRecovery } from "@/lib/password-recovery.functions";
import { AppLogo } from "@/components/brinzap/AppLogo";
import { Mail, Phone, ArrowLeft, CheckCircle2, AlertTriangle, RotateCw } from "lucide-react";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({ meta: [{ title: "Recuperar senha · Abio" }, { name: "robots", content: "noindex" }] }),
  component: ForgotPasswordPage,
});

type Feedback =
  | { kind: "success"; message: string }
  | { kind: "warning"; message: string }
  | { kind: "error"; message: string }
  | null;

function ForgotPasswordPage() {
  const [method, setMethod] = useState<"email" | "whatsapp">("email");
  const [identifier, setIdentifier] = useState("");
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const recover = useServerFn(requestPasswordRecovery);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    setFeedback(null);
    if (!identifier.trim()) {
      setFeedback({
        kind: "error",
        message: "Informe seu " + (method === "email" ? "e-mail" : "celular") + ".",
      });
      return;
    }
    setLoading(true);
    try {
      const res = await recover({ data: { method, identifier: identifier.trim() } });
      if (res.status === "sent") {
        setFeedback({
          kind: "success",
          message:
            method === "whatsapp"
              ? "Link enviado com sucesso para o WhatsApp."
              : "Se o e-mail estiver cadastrado, você receberá o link em instantes.",
        });
      } else if (res.status === "not_found") {
        setFeedback({
          kind: "warning",
          message: method === "whatsapp"
            ? "Número não encontrado. Verifique e tente novamente."
            : "Conta não localizada.",
        });
      } else if (res.status === "rate_limited") {
        setFeedback({
          kind: "warning",
          message: "Aguarde alguns minutos antes de solicitar novamente.",
        });
      } else {
        setFeedback({
          kind: "error",
          message: res.error ?? "Não foi possível enviar o link agora. Tente novamente.",
        });
      }
    } catch {
      setFeedback({
        kind: "error",
        message: "Não foi possível processar sua solicitação. Tente novamente.",
      });
    } finally {
      setLoading(false);
    }
  };

  const success = feedback?.kind === "success";

  return (
    <div className="min-h-screen grid place-items-center px-6 relative">
      <div className="absolute inset-0 grid-overlay pointer-events-none" />
      <div className="relative w-full max-w-md rounded-3xl border border-border bg-card/70 backdrop-blur-xl p-8 shadow-card">
        <Link to="/login" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="h-3.5 w-3.5" /> Voltar ao login
        </Link>
        <div className="flex items-center gap-3 mb-6">
          <AppLogo size={40} />
        </div>

        <h1 className="font-display text-2xl">Recuperar senha</h1>
        <p className="text-sm text-muted-foreground mt-1">Enviaremos um link para você criar uma nova senha.</p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <div className="grid grid-cols-2 gap-2 p-1 bg-input rounded-xl">
            <button type="button" onClick={() => { setMethod("email"); setFeedback(null); }}
              className={`text-xs py-2 rounded-lg transition-smooth ${method === "email" ? "bg-gradient-brand text-primary-foreground glow-neon" : "text-muted-foreground hover:text-foreground"}`}>
              <Mail className="h-3.5 w-3.5 inline mr-1" /> E-mail
            </button>
            <button type="button" onClick={() => { setMethod("whatsapp"); setFeedback(null); }}
              className={`text-xs py-2 rounded-lg transition-smooth ${method === "whatsapp" ? "bg-gradient-brand text-primary-foreground glow-neon" : "text-muted-foreground hover:text-foreground"}`}>
              <Phone className="h-3.5 w-3.5 inline mr-1" /> WhatsApp
            </button>
          </div>

          <div>
            <label className="text-xs text-muted-foreground">{method === "email" ? "E-mail cadastrado" : "Celular cadastrado (com DDD)"}</label>
            <div className="relative mt-1">
              {method === "email" ? (
                <Mail className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              ) : (
                <Phone className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              )}
              <input
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder={method === "email" ? "você@email.com" : "+55 11 99999-0000"}
                inputMode={method === "whatsapp" ? "tel" : "email"}
                className="w-full bg-input rounded-xl pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 transition-smooth"
              />
            </div>
          </div>

          {feedback && (
            <div
              className={`rounded-xl border p-3 text-xs flex items-start gap-2 ${
                feedback.kind === "success"
                  ? "border-primary/30 bg-primary/10 text-foreground"
                  : feedback.kind === "warning"
                  ? "border-amber-500/30 bg-amber-500/10 text-foreground"
                  : "border-destructive/30 bg-destructive/10 text-destructive"
              }`}
            >
              {feedback.kind === "success" ? (
                <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
              ) : (
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              )}
              <span>{feedback.message}</span>
            </div>
          )}

          <button type="submit" disabled={loading}
            className="w-full rounded-xl bg-gradient-brand text-primary-foreground font-medium py-2.5 glow-neon hover:scale-[1.01] transition-smooth disabled:opacity-60">
            {loading
              ? "Enviando…"
              : success
              ? <span className="inline-flex items-center gap-1"><RotateCw className="h-3.5 w-3.5" /> Reenviar link</span>
              : `Enviar link por ${method === "email" ? "e-mail" : "WhatsApp"}`}
          </button>

          {success && (
            <Link to="/login" className="block text-center text-xs text-primary hover:underline">
              Voltar para entrar
            </Link>
          )}
        </form>
      </div>
    </div>
  );
}
