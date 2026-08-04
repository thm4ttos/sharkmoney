// Resolução de períodos para a Auditoria Financeira (client-safe).
// Calculado no fuso do próprio usuário — o intervalo é enviado ao servidor
// como ISO, para que a auditoria use exatamente as transações do período.
import type { DashboardRange } from "@/lib/dashboard.functions";

export const AUDIT_RANGE_OPTIONS: DashboardRange[] = [
  "all", "today", "yesterday", "this_week", "last_7_days",
  "this_month", "last_month", "this_year", "custom",
];

export const AUDIT_RANGE_LABELS: Partial<Record<DashboardRange, string>> = {
  all: "Histórico completo",
  today: "Hoje",
  yesterday: "Ontem",
  this_week: "Esta semana",
  last_7_days: "Últimos 7 dias",
  this_month: "Este mês",
  last_month: "Mês passado",
  this_year: "Este ano",
  custom: "Personalizado",
};

function startOfDay(d: Date) { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0); }
function endOfDay(d: Date) { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999); }
function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

export function fmtDayBR(d: Date) {
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export type ResolvedPeriod = {
  from: string | null;
  to: string | null;
  label: string;
  rangeLabel: string;
};

export function resolveAuditPeriod(
  range: DashboardRange,
  customStart?: string,
  customEnd?: string,
  now: Date = new Date(),
): ResolvedPeriod {
  const today = startOfDay(now);
  const rangeLabel = AUDIT_RANGE_LABELS[range] ?? "Período";
  const wrap = (start: Date, end: Date): ResolvedPeriod => ({
    from: start.toISOString(),
    to: end.toISOString(),
    label: `${fmtDayBR(start)} a ${fmtDayBR(end)}`,
    rangeLabel,
  });

  switch (range) {
    case "today": return wrap(today, endOfDay(now));
    case "yesterday": { const y = addDays(today, -1); return wrap(y, endOfDay(y)); }
    case "this_week": {
      const dow = (today.getDay() + 6) % 7;
      const start = addDays(today, -dow);
      return wrap(start, endOfDay(addDays(start, 6)));
    }
    case "last_7_days": return wrap(addDays(today, -6), endOfDay(now));
    case "this_month": {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return wrap(start, endOfDay(new Date(now.getFullYear(), now.getMonth() + 1, 0)));
    }
    case "last_month": {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return wrap(start, endOfDay(new Date(now.getFullYear(), now.getMonth(), 0)));
    }
    case "this_year": {
      const start = new Date(now.getFullYear(), 0, 1);
      return wrap(start, endOfDay(new Date(now.getFullYear(), 11, 31)));
    }
    case "custom": {
      const s = customStart ? startOfDay(new Date(customStart)) : today;
      const e = customEnd ? endOfDay(new Date(customEnd)) : endOfDay(now);
      return wrap(s, e);
    }
    default:
      return { from: null, to: null, label: "Todo o histórico confirmado", rangeLabel: AUDIT_RANGE_LABELS.all! };
  }
}
