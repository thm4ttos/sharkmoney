import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
  Home, Wallet, Bell, Menu, LogOut, ArrowLeft,
  type LucideIcon,
} from "lucide-react";
import { Sheet, SheetContent, SheetTitle, SheetClose } from "@/components/ui/sheet";
import { logout } from "@/lib/user-session";
import { useAuthProfile } from "@/hooks/use-auth-profile";
import { navigationSections, isNavItemActive, nameColorForGender, initialsFrom } from "@/lib/navigation";

type SideTab = { to: string; label: string; icon: LucideIcon; match: (path: string) => boolean };

const leftTab: SideTab = {
  to: "/app/dashboard",
  label: "Central",
  icon: Wallet,
  match: (p) => p.startsWith("/app/dashboard"),
};

const rightTab: SideTab = {
  to: "/app/compromissos",
  label: "Lembretes",
  icon: Bell,
  match: (p) => p.startsWith("/app/compromissos"),
};

const centerTab = {
  to: "/app",
  label: "Início",
  icon: Home,
  match: (p: string) => p === "/app",
};

const moreGroups = navigationSections;



const BAR_HEIGHT = 80;
const CENTER_SIZE = 62;
// ~45% acima da barra: 62 * 0.45 ≈ 28px → top offset -28
const CENTER_TOP_OFFSET = -28;
const SIDE_ICON = 26;
const LABEL_SIZE = 14;

function SideButton({ tab, active }: { tab: SideTab; active: boolean }) {
  const Icon = tab.icon;
  return (
    <Link
      to={tab.to}
      aria-current={active ? "page" : undefined}
      className={[
        "flex-1 h-full flex flex-col items-center justify-center gap-1 px-1 transition-all duration-200 active:scale-95",
        active ? "text-neon" : "text-primary/85 hover:text-primary",
      ].join(" ")}
    >
      <Icon
        className={["shrink-0 transition-transform duration-200", active ? "scale-[1.05]" : ""].join(" ")}
        style={{ width: SIDE_ICON, height: SIDE_ICON }}
        strokeWidth={active ? 2.4 : 2}
      />
      <span
        className={["leading-none truncate max-w-full transition-colors", active ? "font-semibold" : "font-medium"].join(" ")}
        style={{ fontSize: LABEL_SIZE }}
      >
        {tab.label}
      </span>
    </Link>
  );
}

export function MobileBottomNav() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const [openMore, setOpenMore] = useState(false);
  const { profile } = useAuthProfile();

  const displayName = profile?.name?.trim() || "Minha conta";
  const initials = initialsFrom(displayName);
  // Cor do nome definida SOMENTE pelo gênero informado no cadastro.
  const nameColor = nameColorForGender(profile?.gender);





  const leftActive = leftTab.match(path);
  const rightActive = rightTab.match(path);
  const centerActive = centerTab.match(path);
  const CenterIcon = centerTab.icon;

  return (
    <>
      {/* Spacer to prevent content from being hidden behind the nav */}
      <div className="lg:hidden" style={{ height: `calc(${BAR_HEIGHT}px + env(safe-area-inset-bottom))` }} aria-hidden />

      <nav
        aria-label="Navegação principal"
        className="lg:hidden fixed bottom-0 inset-x-0 z-40"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div
          className="relative mx-auto flex items-stretch bg-card/95 backdrop-blur-2xl border-t border-primary/20 shadow-[0_-8px_24px_-12px_rgba(124,58,237,0.35)]"
          style={{ height: BAR_HEIGHT, borderTopLeftRadius: 30, borderTopRightRadius: 30 }}
        >
          <SideButton tab={leftTab} active={leftActive} />

          {/* Center slot — invisible icon spacer keeps the label vertically
              aligned with the other three; the circle sits absolutely above. */}
          <Link
            to={centerTab.to}
            aria-label={centerTab.label}
            aria-current={centerActive ? "page" : undefined}
            className="flex-1 h-full flex flex-col items-center justify-center gap-1 px-1 group relative"
          >
            {/* placeholder to match SideButton vertical rhythm */}
            <span aria-hidden style={{ width: SIDE_ICON, height: SIDE_ICON }} className="block" />

            <span
              className={[
                "absolute left-1/2 -translate-x-1/2 grid place-items-center rounded-full transition-all duration-200 group-active:scale-95",
                centerActive
                  ? "bg-gradient-to-br from-neon to-[#2fb84a] text-background"
                  : "bg-gradient-to-br from-primary to-[#5b21b6] text-white",
              ].join(" ")}
              style={{
                width: CENTER_SIZE,
                height: CENTER_SIZE,
                top: CENTER_TOP_OFFSET,
                boxShadow: centerActive
                  ? "0 6px 14px -6px rgba(57,211,83,0.28), 0 2px 5px rgba(0,0,0,0.14)"
                  : "0 6px 14px -6px rgba(124,58,237,0.42), 0 2px 5px rgba(0,0,0,0.16)",
              }}
            >
              <span className="absolute inset-x-2 top-1 h-3 rounded-full bg-white/15 blur-[2px] pointer-events-none" />
              <CenterIcon style={{ width: 28, height: 28 }} strokeWidth={2.4} className="relative" />
            </span>

            <span
              className={["leading-none font-semibold transition-colors", centerActive ? "text-neon" : "text-primary"].join(" ")}
              style={{ fontSize: LABEL_SIZE }}
            >
              {centerTab.label}
            </span>
          </Link>

          <SideButton tab={rightTab} active={rightActive} />

          <button
            type="button"
            onClick={() => setOpenMore(true)}
            aria-label="Mais opções"
            className="flex-1 h-full flex flex-col items-center justify-center gap-1 px-1 transition-all duration-200 active:scale-95 text-primary/85 hover:text-primary"
          >
            <Menu style={{ width: SIDE_ICON, height: SIDE_ICON }} strokeWidth={2} />
            <span className="leading-none font-medium" style={{ fontSize: LABEL_SIZE }}>Mais</span>
          </button>
        </div>
      </nav>


      <Sheet open={openMore} onOpenChange={setOpenMore}>
        <SheetContent
          side="left"
          className="w-[82vw] max-w-[330px] p-0 duration-[240ms] bg-card border-r border-primary/25 flex flex-col gap-0 overflow-hidden [&>button]:hidden"
          style={{
            height: "100dvh",
            maxHeight: "100dvh",
            paddingTop: "env(safe-area-inset-top)",
            paddingBottom: "env(safe-area-inset-bottom)",
          }}
        >
          {/* Cabeçalho em linha única: foto + nome + seta de retorno */}
          <div
            className="shrink-0 flex items-center gap-2.5 px-4 border-b border-border/60"
            style={{ height: 60 }}
          >
            <Link
              to="/app/perfil"
              onClick={() => setOpenMore(false)}
              aria-label="Abrir Meu Perfil"
              className="h-9 w-9 shrink-0 rounded-full overflow-hidden grid place-items-center bg-gradient-to-br from-primary to-[#5b21b6] text-[12px] font-bold text-white ring-2 ring-primary/30"
            >
              {profile?.avatar_url
                ? <img src={profile.avatar_url} alt={`Foto de ${displayName}`} className="h-full w-full object-cover" />
                : initials}
            </Link>
            <SheetTitle
              className="min-w-0 flex-1 truncate text-left text-[16px] font-semibold leading-tight"
              style={{ color: nameColor }}
            >
              {displayName}
            </SheetTitle>
            <SheetClose
              aria-label="Voltar"
              className="shrink-0 h-9 w-9 grid place-items-center rounded-full text-primary hover:bg-primary/10 transition-colors active:scale-95"
            >
              <ArrowLeft className="h-5 w-5" strokeWidth={2.2} />
            </SheetClose>
          </div>

          <nav className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-2 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {moreGroups.map((g) => (
              <div key={g.title} className="mt-[6px] first:mt-0">
                <p
                  className="px-2 pb-[2px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70 leading-none"
                  style={{ fontSize: 8.5 }}
                >
                  {g.title}
                </p>
                <ul className="flex flex-col gap-[1px]">
                  {g.items.map((m) => {
                    const Icon = m.icon;
                    const active = isNavItemActive(m.to, path);
                    return (
                      <li key={m.to}>
                        <Link
                          to={m.to}
                          onClick={() => setOpenMore(false)}
                          aria-current={active ? "page" : undefined}
                          className={[
                            "relative flex items-center gap-2.5 rounded-md px-2.5 transition-colors",
                            active
                              ? "bg-neon/10 text-neon font-semibold"
                              : "text-foreground/90 hover:bg-primary/10 hover:text-foreground",
                          ].join(" ")}
                          style={{ height: "clamp(25px, 3.5vh, 34px)" }}
                        >
                          {active && (
                            <span className="absolute left-0 top-1/2 -translate-y-1/2 h-3.5 w-[3px] rounded-full bg-neon" />
                          )}
                          <Icon
                            className={["shrink-0", active ? "text-neon" : "text-primary"].join(" ")}
                            style={{ width: "clamp(15px, 2vh, 18px)", height: "clamp(15px, 2vh, 18px)" }}
                            strokeWidth={2}
                          />
                          <span
                            className="truncate leading-none"
                            style={{ fontSize: "clamp(12px, 1.75vh, 14px)" }}
                          >
                            {m.label}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}

            <ul className="flex flex-col gap-[1px]">
              <li>
                <button
                  onClick={() => { setOpenMore(false); logout(); navigate({ to: "/" }); }}
                  className="w-full flex items-center gap-2.5 rounded-md px-2.5 text-foreground/90 hover:bg-destructive/10 hover:text-destructive transition-colors"
                  style={{ height: "clamp(25px, 3.5vh, 34px)" }}
                >
                  <LogOut
                    className="shrink-0 text-primary"
                    style={{ width: "clamp(15px, 2vh, 18px)", height: "clamp(15px, 2vh, 18px)" }}
                    strokeWidth={2}
                  />
                  <span className="leading-none" style={{ fontSize: "clamp(12px, 1.75vh, 14px)" }}>Sair</span>
                </button>
              </li>
            </ul>
          </nav>
        </SheetContent>
      </Sheet>
    </>
  );
}
