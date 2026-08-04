import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ChevronsLeft, ChevronsRight, LogOut } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { logout } from "@/lib/user-session";
import { useAuthProfile } from "@/hooks/use-auth-profile";
import { navigationSections, isNavItemActive, nameColorForGender, initialsFrom } from "@/lib/navigation";

const STORAGE_KEY = "abio.sidebar.collapsed";

export function DesktopSidebar() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const { profile } = useAuthProfile();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(STORAGE_KEY) === "1");
    } catch { /* ignore */ }
  }, []);

  const toggle = () => {
    setCollapsed((c) => {
      const next = !c;
      try { localStorage.setItem(STORAGE_KEY, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  };

  const displayName = profile?.name?.trim() || "Minha conta";
  const initials = initialsFrom(displayName) || "?";
  const nameColor = nameColorForGender(profile?.gender);

  const itemBase = "relative flex items-center rounded-lg transition-colors";
  const itemStyle = { height: "clamp(28px, 3.8vh, 34px)", paddingLeft: collapsed ? 0 : 8, paddingRight: collapsed ? 0 : 8 } as const;
  const iconStyle = { width: 16, height: 16 } as const;

  return (
    <TooltipProvider delayDuration={120}>
      <aside
        className="hidden lg:flex sticky top-0 h-screen shrink-0 z-30 flex-col overflow-hidden border-r border-border bg-card"
        style={{ width: collapsed ? 64 : 236, transition: "width 260ms cubic-bezier(0.4,0,0.2,1)" }}
      >
        {/* Cabeçalho compacto: foto + nome (mesma linha) */}
        <div
          className="shrink-0 flex items-center gap-2 border-b border-border/60"
          style={{ height: 52, paddingLeft: collapsed ? 0 : 12, paddingRight: collapsed ? 0 : 8, justifyContent: collapsed ? "center" : undefined }}
        >
          <Link
            to="/app/perfil"
            aria-label="Abrir Meu Perfil"
            className="h-8 w-8 shrink-0 rounded-full overflow-hidden grid place-items-center bg-secondary text-[11px] font-semibold text-foreground border border-border"
          >
            {profile?.avatar_url
              ? <img src={profile.avatar_url} alt={`Foto de ${displayName}`} className="h-full w-full object-cover" />
              : initials}
          </Link>
          {!collapsed && (
            <>
              <Link
                to="/app/perfil"
                className="min-w-0 flex-1 truncate text-[14px] font-semibold leading-tight"
                style={{ color: nameColor }}
              >
                {displayName}
              </Link>
              <button
                type="button"
                onClick={toggle}
                aria-label="Recolher menu"
                className="shrink-0 h-7 w-7 grid place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
              >
                <ChevronsLeft className="h-4 w-4" />
              </button>
            </>
          )}
        </div>

        {collapsed && (
          <button
            type="button"
            onClick={toggle}
            aria-label="Expandir menu"
            className="shrink-0 mx-auto mt-1 h-7 w-7 grid place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
          >
            <ChevronsRight className="h-4 w-4" />
          </button>
        )}

        <nav className="flex-1 min-h-0 overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={{ paddingLeft: collapsed ? 6 : 12, paddingRight: collapsed ? 6 : 12, paddingTop: 4, paddingBottom: 4 }}>
          {navigationSections.map((section) => (
            <div key={section.title} style={{ marginTop: 14 }} className="first:mt-0">
              {!collapsed && (
                <p
                  className="px-2 pb-[2px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70 leading-none"
                  style={{ fontSize: 9.5, letterSpacing: "0.14em" }}
                >
                  {section.title}
                </p>
              )}
              <ul className="flex flex-col" style={{ gap: 2 }}>
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const active = isNavItemActive(item.to, path);
                  const link = (
                    <Link
                      to={item.to}
                      aria-current={active ? "page" : undefined}
                      className={[
                        itemBase,
                        collapsed ? "justify-center" : "gap-2.5",
                        active
                          ? "bg-secondary text-foreground font-medium"
                          : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                      ].join(" ")}
                      style={itemStyle}
                    >
                      {active && (
                        <span className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[2px] rounded-full bg-primary" />
                      )}
                      <Icon
                        className={["shrink-0", active ? "text-primary" : "text-muted-foreground"].join(" ")}
                        style={iconStyle}
                        strokeWidth={1.75}
                      />
                      {!collapsed && (
                        <span className="truncate leading-none" style={{ fontSize: 13 }}>{item.label}</span>
                      )}
                    </Link>
                  );
                  return (
                    <li key={item.to}>
                      {collapsed ? (
                        <Tooltip>
                          <TooltipTrigger asChild>{link}</TooltipTrigger>
                          <TooltipContent side="right">{item.label}</TooltipContent>
                        </Tooltip>
                      ) : link}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}

          <ul className="flex flex-col" style={{ gap: 1, marginTop: 1 }}>
            <li>
              {(() => {
                const btn = (
                  <button
                    type="button"
                    onClick={() => { logout(); navigate({ to: "/" }); }}
                    className={[
                      itemBase, "w-full",
                      collapsed ? "justify-center" : "gap-2.5",
                      "text-muted-foreground hover:bg-destructive/10 hover:text-destructive",
                    ].join(" ")}
                    style={itemStyle}
                  >
                    <LogOut className="shrink-0 text-muted-foreground" style={iconStyle} strokeWidth={1.75} />
                    {!collapsed && <span className="leading-none" style={{ fontSize: 13 }}>Sair</span>}
                  </button>
                );
                return collapsed ? (
                  <Tooltip>
                    <TooltipTrigger asChild>{btn}</TooltipTrigger>
                    <TooltipContent side="right">Sair</TooltipContent>
                  </Tooltip>
                ) : btn;
              })()}
            </li>
          </ul>
        </nav>

      </aside>
    </TooltipProvider>
  );
}
