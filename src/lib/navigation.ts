import {
  User as UserIcon, ArrowLeftRight, Bell, Sparkles, Zap,
  Wallet, CalendarDays, Repeat, CreditCard, PiggyBank,
  AlertTriangle, Target, Crown, Heart, Settings2,
  type LucideIcon,
} from "lucide-react";

export type NavItem = { to: string; label: string; icon: LucideIcon };
export type NavSection = { title: string; items: NavItem[] };

/**
 * Fonte única de navegação — consumida pelo menu lateral (desktop)
 * e pelo menu "Mais" (mobile). A ordem aqui é a ordem oficial do produto.
 */
export const navigationSections: NavSection[] = [
  {
    title: "PRINCIPAL",
    items: [
      { to: "/app/perfil", label: "Meu Perfil", icon: UserIcon },
      { to: "/app/casal", label: "Casal", icon: Heart },
      { to: "/app/transacoes", label: "Transações", icon: ArrowLeftRight },
      { to: "/app/compromissos", label: "Lembretes", icon: Bell },
      { to: "/app/habitos", label: "Rotina & Hábitos", icon: Sparkles },
      { to: "/app/lancar", label: "Lançar rápido", icon: Zap },
    ],
  },
  {
    title: "FINANCEIRO",
    items: [
      { to: "/app/dashboard", label: "Central Financeira", icon: Wallet },
      { to: "/app/calendario", label: "Calendário Financeiro", icon: CalendarDays },
      { to: "/app/contas-fixas", label: "Contas Fixas", icon: Repeat },
      { to: "/app/parcelados", label: "Compras Parceladas", icon: CreditCard },
      { to: "/app/orcamento", label: "Orçamento", icon: PiggyBank },
      { to: "/app/dividas", label: "Dívidas", icon: AlertTriangle },
      { to: "/app/metas", label: "Metas", icon: Target },
      { to: "/app/liberdade", label: "Liberdade Financeira", icon: Crown },
      { to: "/app/salario", label: "Salário", icon: Wallet },
      { to: "/app/sistema", label: "Sistema", icon: Settings2 },
    ],
  },
];

export function isNavItemActive(to: string, path: string) {
  return to === "/app" ? path === "/app" : path === to || path.startsWith(to + "/");
}

/** Cor do nome definida SOMENTE pelo gênero informado pelo usuário. */
export function nameColorForGender(gender?: string | null) {
  if (gender === "female") return "#39D353";
  if (gender === "male") return "#0A5BFF";
  return "#E9E4F5";
}

export function initialsFrom(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
}
