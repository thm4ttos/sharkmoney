// Fonte única de verdade dos planos comerciais do Abio.
// Qualquer página, checkout, API ou mensagem DEVE consumir esta configuração.

export type SubscriptionPlanId = "monthly" | "six_months" | "annual";

export const BASE_MONTHLY_PRICE = 49.8;

export type SubscriptionPlan = {
  id: SubscriptionPlanId;
  /** slug usado na tabela `plans` / `subscriptions` */
  slug: string;
  name: string;
  months: number;
  durationDays: number;
  /** preço-base mensal de referência */
  originalPrice: number;
  discountPercentage: number;
  /** valor mensal equivalente */
  monthlyPrice: number;
  /** valor total cobrado na transação */
  totalPrice: number;
  /** "monthly" = cobrança recorrente mensal; "one_time" = pagamento único antecipado */
  billing: "monthly" | "one_time";
  billingLabel: string;
  accessLabel: string;
  badges: string[];
  cta: string;
  highlight?: boolean;
  features: string[];
};

export const subscriptionPlans: SubscriptionPlan[] = [
  {
    id: "monthly",
    slug: "monthly",
    name: "Plano Mensal",
    months: 1,
    durationDays: 30,
    originalPrice: 49.8,
    discountPercentage: 50,
    monthlyPrice: 24.9,
    totalPrice: 24.9,
    billing: "monthly",
    billingLabel: "Cobrança mensal",
    accessLabel: "Renovação mensal",
    badges: [],
    cta: "Assinar plano mensal",
    features: [
      "WhatsApp ilimitado",
      "Central Financeira completa",
      "Áudio, imagem e PDF com IA",
      "Lembretes e contas fixas",
    ],
  },
  {
    id: "six_months",
    slug: "six_months",
    name: "Plano Semestral",
    months: 6,
    durationDays: 180,
    originalPrice: 49.8,
    discountPercentage: 60,
    monthlyPrice: 19.92,
    totalPrice: 119.52,
    billing: "one_time",
    billingLabel: "Pagamento único de R$ 119,52",
    accessLabel: "6 meses de acesso",
    badges: ["Mais escolhido"],
    cta: "Assinar 6 meses",
    highlight: true,
    features: [
      "Tudo do Mensal",
      "Relatórios avançados",
      "Alertas inteligentes",
      "Suporte prioritário",
    ],
  },
  {
    id: "annual",
    slug: "annual",
    name: "Plano Anual",
    months: 12,
    durationDays: 365,
    originalPrice: 49.8,
    discountPercentage: 70,
    monthlyPrice: 14.94,
    totalPrice: 179.28,
    billing: "one_time",
    billingLabel: "Pagamento único de R$ 179,28",
    accessLabel: "12 meses de acesso",
    badges: ["Melhor oferta"],
    cta: "Assinar 12 meses",
    features: [
      "Tudo do 6 meses",
      "Maior economia do ano",
      "Histórico ilimitado",
      "Exportação completa",
    ],
  },
];

export const PLAN_IDS = subscriptionPlans.map((p) => p.id);
export const PLAN_SLUGS = subscriptionPlans.map((p) => p.slug);

export const isActivePlanSlug = (slug: string | null | undefined) =>
  !!slug && PLAN_SLUGS.includes(slug);

export const getPlan = (idOrSlug: string) =>
  subscriptionPlans.find((p) => p.id === idOrSlug || p.slug === idOrSlug);

export const monthlyEquivalent = (p: SubscriptionPlan) => p.monthlyPrice;
export const savings = (p: SubscriptionPlan) =>
  p.originalPrice * p.months - p.totalPrice;

export const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Validação matemática — roda em dev para impedir divergência de preço. */
export function validatePlans() {
  const errors: string[] = [];
  for (const p of subscriptionPlans) {
    const expected = round2(BASE_MONTHLY_PRICE * (1 - p.discountPercentage / 100));
    if (Math.abs(expected - p.monthlyPrice) > 0.01) {
      errors.push(`${p.id}: mensal esperado ${expected} e configurado ${p.monthlyPrice}`);
    }
    if (Math.abs(round2(p.monthlyPrice * p.months) - p.totalPrice) > 0.01) {
      errors.push(`${p.id}: total divergente do equivalente mensal`);
    }
  }
  return errors;
}

if (import.meta.env?.DEV) {
  const errs = validatePlans();
  if (errs.length) console.error("[plans] validação falhou:", errs);
}

