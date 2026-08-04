// Utilidades de datas das compras parceladas (browser + server).

/** Soma meses a uma data YMD preservando o dia (com clamp no fim do mês). */
export function addMonthsYMD(ymd: string, months: number): string {
  const [y, m, d] = String(ymd).slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return String(ymd).slice(0, 10);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  const mm = String(target.getUTCMonth() + 1).padStart(2, "0");
  return `${target.getUTCFullYear()}-${mm}-${String(day).padStart(2, "0")}`;
}

/** Data de vencimento da parcela N (1-based). */
export function installmentDueDate(firstDueAt: string, n: number): string {
  return addMonthsYMD(firstDueAt, Math.max(0, n - 1));
}

/** Hoje em America/Sao_Paulo no formato YYYY-MM-DD. */
export function todaySP(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function diffDaysYMD(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}

export function formatYMD(ymd?: string | null): string {
  if (!ymd) return "—";
  const [y, m, d] = String(ymd).slice(0, 10).split("-");
  if (!y || !m || !d) return "—";
  return `${d}/${m}/${y}`;
}

export const REMINDER_OPTIONS = [
  { value: 7, label: "7 dias antes" },
  { value: 5, label: "5 dias antes" },
  { value: 3, label: "3 dias antes" },
  { value: 1, label: "1 dia antes" },
  { value: 0, label: "No dia do vencimento" },
] as const;

export function reminderLabel(offsets: number[] | null | undefined): string {
  const list = (offsets ?? []).slice().sort((a, b) => b - a);
  if (list.length === 0) return "—";
  return list.map((o) => (o === 0 ? "no dia" : `${o} ${o === 1 ? "dia" : "dias"} antes`)).join(" + ");
}
