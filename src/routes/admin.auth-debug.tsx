import { createFileRoute, useRouterState } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { ShieldCheck, ShieldAlert } from "lucide-react";

export const Route = createFileRoute("/admin/auth-debug")({
  head: () => ({ meta: [{ title: "Auth Debug · Abio Admin" }, { name: "robots", content: "noindex" }] }),
  component: Page,
});

function Row({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4 py-2 border-b border-border/60 last:border-0">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={"text-sm text-foreground break-all text-right " + (mono ? "font-mono" : "")}>{value}</span>
    </div>
  );
}

function Pill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={[
      "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs border",
      ok
        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
        : "border-destructive/40 bg-destructive/10 text-destructive",
    ].join(" ")}>
      {ok ? <ShieldCheck className="h-3 w-3" /> : <ShieldAlert className="h-3 w-3" />} {label}
    </span>
  );
}

function Page() {
  const { isReady, session, user, isAdminReady, isAdmin, lastRedirectReason, debugLog } = useAuth();
  const state = useRouterState();
  const expiresAt = session?.expires_at ? new Date(session.expires_at * 1000) : null;
  const tokenValid = !!expiresAt && expiresAt.getTime() > Date.now();

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-2xl">Diagnóstico de autenticação</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Estado em tempo real do contexto único de auth (`AuthProvider`).
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Pill ok={isReady} label={isReady ? "Auth pronto" : "Inicializando…"} />
          <Pill ok={!!user} label={user ? "Sessão ativa" : "Sem sessão"} />
          <Pill ok={tokenValid} label={tokenValid ? "Token válido" : "Token expirado"} />
          <Pill ok={isAdmin} label={isAdminReady ? (isAdmin ? "Admin" : "Não admin") : "Verificando role…"} />
        </div>
      </header>

      <section className="rounded-2xl border border-border bg-card/60 backdrop-blur-xl p-5">
        <h2 className="text-sm font-medium mb-3">Sessão</h2>
        <Row label="User ID" value={user?.id ?? "—"} />
        <Row label="E-mail" value={user?.email ?? "—"} />
        <Row label="Telefone" value={user?.phone ?? "—"} />
        <Row label="Provedor" value={user?.app_metadata?.provider ?? "—"} />
        <Row label="Criado em" value={user?.created_at ?? "—"} />
        <Row label="Access token expira" value={expiresAt ? expiresAt.toISOString() : "—"} />
        <Row label="Refresh token" value={session?.refresh_token ? "presente" : "—"} mono={false} />
      </section>

      <section className="rounded-2xl border border-border bg-card/60 backdrop-blur-xl p-5">
        <h2 className="text-sm font-medium mb-3">Rota</h2>
        <Row label="Rota atual" value={state.location.pathname} />
        <Row label="Último motivo de redirect" value={lastRedirectReason ?? "—"} mono={false} />
      </section>

      <section className="rounded-2xl border border-border bg-card/60 backdrop-blur-xl p-5">
        <h2 className="text-sm font-medium mb-3">Eventos recentes</h2>
        <ul className="space-y-1 text-xs font-mono">
          {debugLog.length === 0 && <li className="text-muted-foreground">Nenhum evento registrado ainda.</li>}
          {debugLog.map((d, i) => (
            <li key={i} className="flex gap-3 py-1 border-b border-border/40 last:border-0">
              <span className="text-muted-foreground shrink-0">{d.at.slice(11, 19)}</span>
              <span className="text-primary shrink-0">{d.event}</span>
              <span className="text-foreground break-all">{d.detail ?? ""}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
