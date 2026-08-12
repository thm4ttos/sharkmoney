import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { logout } from "@/lib/user-session";
import { useAuthProfile, trialDaysLeft, initialsOf, firstNameOf, greetingFor } from "@/hooks/use-auth-profile";
import { useAuth } from "@/lib/auth-context";
import { AppLogo } from "@/components/brinzap/AppLogo";
import { WhatsappConnectionCard } from "@/components/brinzap/WhatsappConnectionCard";
import { MobileBottomNav } from "@/components/brinzap/MobileBottomNav";
import { DesktopSidebar } from "@/components/brinzap/DesktopSidebar";

import {
  LayoutDashboard, Home, Zap, ArrowLeftRight, FolderTree, PiggyBank,
  CreditCard, AlertTriangle, Sparkles, Bell, FileBarChart2, Wallet,
  LifeBuoy, User as UserIcon, LogOut, MessageCircle, Menu, X, CalendarDays, Target, Repeat, Upload, Handshake, Heart, type LucideIcon
} from "lucide-react";

type NavItem = { to: string; label: string; icon: LucideIcon; exact?: boolean };
const nav: NavItem[] = [
  { to: "/app/perfil", label: "Meu Perfil", icon: UserIcon },
  { to: "/app", label: "Início", icon: Home, exact: true },
  { to: "/app/dashboard", label: "Central Financeira", icon: LayoutDashboard },
  { to: "/app/calendario", label: "Calendário", icon: CalendarDays },
  { to: "/app/metas", label: "Metas", icon: Target },
  { to: "/app/casal", label: "Casal", icon: Heart },
  { to: "/app/contas-fixas", label: "Contas Fixas", icon: Repeat },
  { to: "/app/lancar", label: "Lançar Rápido", icon: Zap },
  { to: "/app/transacoes", label: "Transações", icon: ArrowLeftRight },
  { to: "/app/importar", label: "Importar Histórico", icon: Upload },
  { to: "/app/whatsapp", label: "WhatsApp", icon: MessageCircle },
  { to: "/app/categorias", label: "Categorias", icon: FolderTree },
  { to: "/app/orcamento", label: "Orçamento", icon: PiggyBank },
  { to: "/app/parcelados", label: "Compras Parceladas", icon: CreditCard },
  { to: "/app/dividas", label: "Dívidas", icon: AlertTriangle },
  { to: "/app/liberdade", label: "Liberdade Financeira", icon: Sparkles },
  { to: "/app/habitos", label: "Rotina & Hábitos", icon: Sparkles },
  { to: "/app/compromissos", label: "Lembretes", icon: Bell },
  { to: "/app/relatorios", label: "Relatórios", icon: FileBarChart2 },
  { to: "/app/salario", label: "Salário", icon: Wallet },
  { to: "/app/afiliados", label: "Afiliados", icon: Handshake },
  { to: "/app/suporte", label: "Suporte", icon: LifeBuoy },
] as const;

export function AppLayout() {
  const navigate = useNavigate();
  const state = useRouterState();
  const { isReady, user: sessionUser, isAdminReady, isAdmin, recordRedirect } = useAuth();
  const { profile, loading: profileLoading } = useAuthProfile();
  const [open, setOpen] = useState(false);

  // Redirect ONLY on confirmed unauthenticated state — never on missing profile.
  useEffect(() => {
    if (!isReady) return;
    if (!sessionUser) {
      recordRedirect(`AppLayout → /login (no session at ${state.location.pathname})`);
      navigate({ to: "/login" });
      return;
    }
    // Admins never use the user dashboard — bounce to /admin.
    if (isAdminReady && isAdmin) {
      recordRedirect(`AppLayout → /admin (admin landed on ${state.location.pathname})`);
      navigate({ to: "/admin", replace: true });
    }
  }, [isReady, sessionUser, isAdminReady, isAdmin, navigate, recordRedirect, state.location.pathname]);

  // Safety-net: dispara boas-vindas no WhatsApp se ainda não foi enviada
  // (idempotente: o servidor checa welcome_sent_at).
  useEffect(() => {
    if (!profile || !profile.phone || (profile as any).welcome_sent_at) return;
    (async () => {
      try {
        const { sendWelcomeWhatsapp } = await import("@/lib/brinzap.functions");
        await sendWelcomeWhatsapp({ data: { phone: profile.phone } });
      } catch { /* silencioso */ }
    })();
  }, [profile]);

  useEffect(() => { setOpen(false); }, [state.location.pathname]);

  const qc = useQueryClient();

  // Realtime: qualquer INSERT/UPDATE/DELETE em transactions do usuário
  // invalida os totais em todas as telas (Dashboard, Início, Resumo, Perfil, Transações).
  useEffect(() => {
    if (!sessionUser?.id) return;
    const invalidateAll = () => {
      qc.invalidateQueries({ queryKey: ["dashboard-stats-v2"] });
      qc.invalidateQueries({ queryKey: ["home-stats"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["monthly-summary"] });
      qc.invalidateQueries({ queryKey: ["reports"] });
      qc.invalidateQueries({ queryKey: ["calendar-month"] });
      qc.invalidateQueries({ queryKey: ["appointments"] });
    };
    const channel = supabase
      .channel(`tx-live-${sessionUser.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "transactions", filter: `user_id=eq.${sessionUser.id}` },
        invalidateAll,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "appointments", filter: `user_id=eq.${sessionUser.id}` },
        invalidateAll,
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [sessionUser?.id, qc]);


  // Render shell once we know the session exists, even if the profile is still loading.
  if (!isReady || !sessionUser) return null;
  // Don't flash the user shell to an admin while we're redirecting them to /admin.
  if (isAdminReady && isAdmin) return null;

  const days = profile ? trialDaysLeft(profile) : 0;
  const path = state.location.pathname;
  const firstName = firstNameOf(profile?.name);
  const initials = initialsOf(profile?.name);
  const greetingLabel = firstName ? greetingFor(firstName) : (profileLoading ? "Carregando…" : "Perfil não encontrado");



  return (
    <div className="min-h-screen flex bg-background">
      {/* Mobile topbar (logo + profile) */}
      <div className="lg:hidden fixed top-0 inset-x-0 z-40 h-14 flex items-center justify-between px-4 border-b border-primary/20 bg-card/80 backdrop-blur-xl">
        <Link to="/app" className="flex items-center min-w-0">
          <AppLogo size={32} />
        </Link>
        <Link to="/app/perfil" className="flex items-center gap-2 min-w-0">
          {profile?.avatar_url ? (
            <img src={profile.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover ring-2 ring-primary/40" />
          ) : (
            <div className="h-8 w-8 rounded-full bg-gradient-brand grid place-items-center text-primary-foreground font-display text-xs">
              {initials || "?"}
            </div>
          )}
        </Link>
      </div>


      <DesktopSidebar />


      <main className="flex-1 min-w-0 max-w-full px-4 min-[400px]:px-5 lg:px-8 pt-[4.5rem] lg:pt-8 pb-[calc(7.5rem+env(safe-area-inset-bottom))] lg:pb-8 overflow-x-hidden">
        <div className="app-container">
          <Outlet />
        </div>
      </main>


      <MobileBottomNav />
    </div>
  );
}
