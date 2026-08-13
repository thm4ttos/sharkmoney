import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { adminLogout } from "@/lib/admin-session";
import { useAuth } from "@/lib/auth-context";
import { AppLogo } from "@/components/brinzap/AppLogo";
import { LayoutDashboard, Users, LogOut, ShieldCheck, MessageCircle, Bot, Activity, Server, Wallet, Shield, Copy, ClipboardList, Inbox, Gauge, Handshake, CreditCard } from "lucide-react";

const nav = [
  { to: "/admin", label: "Visão geral", icon: LayoutDashboard, exact: true },
  { to: "/admin/users", label: "Usuários", icon: Users, exact: false },
  { to: "/admin/afiliados", label: "Afiliados", icon: Handshake, exact: false },
  { to: "/admin/financeiro", label: "Financeiro", icon: Wallet, exact: false },
  { to: "/admin/pagamentos", label: "Pagamentos", icon: CreditCard, exact: false },
  { to: "/admin/whatsapp", label: "WhatsApp", icon: MessageCircle, exact: false },
  { to: "/admin/pending-messages", label: "Mensagens Pendentes", icon: Inbox, exact: false },
  { to: "/admin/onboarding", label: "Onboarding", icon: ClipboardList, exact: false },
  { to: "/admin/duplicates", label: "Mensagens Duplicadas", icon: Copy, exact: false },
  { to: "/admin/ia", label: "Inteligência Artificial", icon: Bot, exact: false },
  { to: "/admin/sistema", label: "Sistema", icon: Server, exact: false },
  { to: "/admin/diagnostico", label: "Diagnóstico", icon: Activity, exact: false },
  { to: "/admin/metricas", label: "Métricas & Fila", icon: Gauge, exact: false },
  { to: "/admin/debug-users", label: "Debug Usuários", icon: Shield, exact: false },
  { to: "/admin/auth-debug", label: "Auth Debug", icon: ShieldCheck, exact: false },
];


export function AdminLayout() {
  const navigate = useNavigate();
  const state = useRouterState();
  const path = state.location.pathname;
  const isLoginRoute = path === "/admin/login" || path.startsWith("/admin/login/");
  const { isReady, user, isAdminReady, isAdmin, recordRedirect } = useAuth();
  const email = user?.email ?? null;

  useEffect(() => {
    if (isLoginRoute) return;
    if (!isReady) return;
    if (!user) {
      recordRedirect(`AdminLayout → /admin/login (no session at ${path})`);
      navigate({ to: "/admin/login" });
      return;
    }
    if (isAdminReady && !isAdmin) {
      recordRedirect(`AdminLayout → /admin/login (user ${user.id} is not admin)`);
      navigate({ to: "/admin/login" });
    }
  }, [isLoginRoute, isReady, user, isAdminReady, isAdmin, navigate, path, recordRedirect]);

  // The login page renders its own full-screen layout — bypass the admin shell.
  if (isLoginRoute) {
    return <Outlet />;
  }



  return (
    <div className="min-h-screen flex bg-background">
      <aside className="w-64 shrink-0 border-r border-border bg-card/50 backdrop-blur-xl p-5 flex flex-col">
        <Link to="/admin" className="flex items-center gap-2 mb-8">
          <AppLogo size={36} />
          <p className="text-[10px] uppercase tracking-[0.2em] text-primary">Admin</p>

        </Link>

        <nav className="space-y-1 flex-1">
          {nav.map((n) => {
            const active = n.exact ? path === n.to : path.startsWith(n.to);
            const Icon = n.icon;
            return (
              <Link
                key={n.to}
                to={n.to}
                className={[
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-smooth",
                  active
                    ? "bg-gradient-brand-soft border border-border text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-card/60",
                ].join(" ")}
              >
                <Icon className="h-4 w-4" />
                {n.label}
              </Link>
            );
          })}
        </nav>

        <div className="rounded-xl border border-border bg-card/60 p-3 text-xs">
          <div className="flex items-center gap-2 text-primary mb-1">
            <ShieldCheck className="h-3.5 w-3.5" /> Sessão admin
          </div>
          <p className="text-muted-foreground truncate">{email ?? "—"}</p>
          <button
            onClick={async () => { await adminLogout(); navigate({ to: "/admin/login" }); }}
            className="mt-3 w-full inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-background/60 px-3 py-1.5 hover:border-destructive/40 hover:text-destructive transition-smooth"
          >
            <LogOut className="h-3.5 w-3.5" /> Sair
          </button>
        </div>
      </aside>

      <main className="flex-1 min-w-0 p-8 overflow-x-hidden">
        {isReady && user && isAdminReady && isAdmin ? <Outlet /> : null}
      </main>

    </div>
  );
}

