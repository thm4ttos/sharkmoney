// Contas fixas com PRAZO DETERMINADO (consórcio, financiamento, contrato).
// Utilidades puras (browser + server) para interpretar e exibir parcelas.

import { ptNumberWordsToDigits } from "@/lib/money-speech";

export type BillInstallmentPatch = {
  total_installments?: number;
  paid_installments?: number;
  payment_day?: number;
  frequency?: string;
  amount?: number;
};

const COUNT_WORD = String.raw`x|vezes|parcelas?|prestac(?:oes|ao)|mensalidades?|pagamentos?|meses`;

function norm(s: string): string {
  const base = String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  // O conversor de extenso une "duzentas e vinte" como "200,20" (padrão
  // reais+centavos). Em contagem de parcelas isso significa 220.
  return ptNumberWordsToDigits(base).replace(
    new RegExp(String.raw`\b(\d{1,4}),(\d{2})(\s*(?:${COUNT_WORD})\b)`, "g"),
    (_m, a: string, b: string, tail: string) => `${Number(a) + Number(b)}${tail}`,
  );
}


const ORDINAL_PAID: Record<string, number> = {
  primeira: 1, segunda: 2, terceira: 3, quarta: 4, quinta: 5, sexta: 6,
  setima: 7, oitava: 8, nona: 9, decima: 10, "decima primeira": 11,
  "decima segunda": 12, "decima terceira": 13,
};

/** Total de parcelas: "220 parcelas", "220x", "em 220 vezes", "total de 220". */
export function parseTotalInstallments(raw: string): number | null {
  // Remove trechos de parcelas PAGAS ("já paguei 10 parcelas") para não
  // confundir quantidade paga com total do contrato.
  const t = norm(raw).replace(
    new RegExp(String.raw`\b(?:ja\s+)?(?:paguei|quitei|quite|foram|pagas?)\s*(?:ja\s*)?\d{1,4}(?:\s*(?:${COUNT_WORD}))?`, "g"),
    " ",
  );

  const pats: RegExp[] = [
    /\b(\d{1,4})\s*(?:x|vezes|parcelas?|prestac(?:oes|ao)|mensalidades?|pagamentos?|meses)\b/,
    /\b(?:parcelei|parcelado|dividi|divid[io]|pagar|pagando)\s+(?:em|por)\s+(\d{1,4})\b/,
    /\b(?:tem|sao|total\s+de|s[ãa]o\s+de)\s+(\d{1,4})\b/,
  ];
  for (const re of pats) {
    const m = t.match(re);
    if (m) {
      const n = Number(m[1]);
      if (n >= 2 && n <= 2000) return n;
    }
  }
  return null;
}

/** Parcelas já pagas: "já paguei 10", "estou na parcela 12", "faltam 210". */
export function parsePaidInstallments(raw: string, total?: number | null): number | null {
  const t = norm(raw);

  // "já paguei 10", "quitei 10 de 220", "já foram 10"
  let m = t.match(/\b(?:ja\s+)?(?:paguei|quitei|quite|foram|pagas?)\s*(?:ja\s*)?(\d{1,4})\b/);
  if (m) return clampPaid(Number(m[1]), total);

  // "estou na parcela 12", "vai vencer a parcela 11", "parcela 11 de 220"
  m = t.match(/\bparcela\s*(?:numero\s*)?(\d{1,4})\b/);
  if (m) return clampPaid(Number(m[1]) - 1, total);

  // "estou na décima primeira"
  m = t.match(/\b(?:estou\s+na|na)\s+((?:decima\s+)?\w+)\b/);
  if (m) {
    const key = m[1].trim();
    const ord = ORDINAL_PAID[key];
    if (ord) return clampPaid(ord - 1, total);
  }

  // "faltam 210" / "restam 210"
  m = t.match(/\b(?:faltam|falta|restam|resta)\s+(\d{1,4})\b/);
  if (m && total && total > 0) return clampPaid(total - Number(m[1]), total);

  return null;
}

function clampPaid(n: number, total?: number | null): number | null {
  if (!Number.isFinite(n) || n < 0) return null;
  if (total && total > 0) return Math.min(Math.round(n), total);
  return Math.round(n);
}

/** Dia do vencimento mensal: "todo dia 15", "vence dia 15", "pago dia 15". */
export function parsePaymentDay(raw: string): number | null {
  const t = norm(raw);
  const m = t.match(/\b(?:todo\s+(?:mes\s+)?dia|dia|vence(?:\s+(?:todo|no|dia))?|vencimento\s+(?:dia|todo\s+dia)?)\s*(\d{1,2})\b/);
  if (!m) return null;
  const d = Number(m[1]);
  return d >= 1 && d <= 31 ? d : null;
}

/**
 * Valor corrigido/atualizado citado com um VERBO EXPLÍCITO — nunca um valor
 * solto (isso ficaria ambíguo com um lançamento novo). Cobre tanto correção
 * de erro ("corrige pra 850", "na verdade é 90") quanto mudança real de valor
 * ("aluguel aumentou pra 1300", "internet agora custa 130", "netflix ficou em 59,90").
 */
export function parseCorrectedAmount(raw: string): number | null {
  const t = norm(raw);
  const m = t.match(
    /\b(?:corrige(?:\s+(?:o\s+)?valor)?|valor\s+(?:certo|correto|de\s+cada\s+parcela)|muda(?:r)?\s+(?:o\s+)?valor|troca(?:r)?\s+(?:o\s+)?valor|na\s+verdade\s+(?:e|sao|eh)|aumentou|subiu|reajustou|ficou\s+em|agora\s+(?:e|eh|custa|esta|ta))\s*(?:pra|para|e|eh|de|em)?\s*(?:r\$)?\s*(\d{1,7}(?:[.,]\d{2})?)\b/,
  );
  if (!m) return null;
  const n = Number(m[1].replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Interpreta uma mensagem complementar sobre uma conta/parcelamento já
 * criado. Genérico o bastante para `recurring_bills` (conta fixa com prazo)
 * e `installment_purchases` (compra parcelada) — ambos usam a mesma forma
 * de patch (total/pagas/dia/valor).
 */
export function parseBillFollowUp(raw: string, total?: number | null): BillInstallmentPatch | null {
  const patch: BillInstallmentPatch = {};
  const totalParsed = parseTotalInstallments(raw);
  if (totalParsed) patch.total_installments = totalParsed;
  const paid = parsePaidInstallments(raw, totalParsed ?? total ?? null);
  if (paid !== null) patch.paid_installments = paid;
  const day = parsePaymentDay(raw);
  if (day) patch.payment_day = day;
  const correctedAmount = parseCorrectedAmount(raw);
  if (correctedAmount !== null) patch.amount = correctedAmount;
  return Object.keys(patch).length > 0 ? patch : null;
}

/** Próximo vencimento mensal a partir de um dia do mês (fuso America/Sao_Paulo). */
export function nextDueFromDaySP(day: number, fromYMD?: string): string {
  const base = fromYMD
    ? fromYMD
    : new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const [y, m, d] = base.split("-").map(Number);
  let year = y!, month = m! - 1;
  const clamp = Math.min(31, Math.max(1, day));
  if (clamp < d!) month += 1;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const target = new Date(Date.UTC(year, month, Math.min(clamp, last)));
  return target.toISOString().slice(0, 10);
}

export function addMonthKeepDay(ymd: string, day?: number | null): string {
  const [y, m, d] = String(ymd).slice(0, 10).split("-").map(Number);
  const wanted = day && day >= 1 ? day : d!;
  const t = new Date(Date.UTC(y!, m!, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  const dt = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), Math.min(wanted, last)));
  return dt.toISOString().slice(0, 10);
}

export type BillInstallmentInfo = {
  isInstallment: boolean;
  total: number;
  paid: number;
  remaining: number;
  current: number;
  percent: number;
  settled: boolean;
};

export function billInstallmentInfo(bill: any): BillInstallmentInfo {
  const total = Number(bill?.total_installments ?? 0);
  if (!Number.isFinite(total) || total <= 0) {
    return { isInstallment: false, total: 0, paid: 0, remaining: 0, current: 0, percent: 0, settled: false };
  }
  const paid = Math.max(0, Math.min(total, Number(bill?.paid_installments ?? 0)));
  const remaining = Math.max(0, total - paid);
  return {
    isInstallment: true,
    total,
    paid,
    remaining,
    current: remaining > 0 ? paid + 1 : total,
    percent: Math.round((paid / total) * 10000) / 100,
    settled: remaining === 0,
  };
}

export function formatYMDBr(ymd?: string | null): string {
  if (!ymd) return "—";
  const [y, m, d] = String(ymd).slice(0, 10).split("-");
  if (!y || !m || !d) return "—";
  return `${d}/${m}/${y}`;
}
