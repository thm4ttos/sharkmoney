// SERVER-ONLY — Parser de data/hora FUTURA para compromissos.
//
// Diferente de extractDateHintSP (que é enviesado para o PASSADO, porque serve
// a lançamentos financeiros já ocorridos), aqui a referência sempre aponta para
// o próximo acontecimento: "sexta" = a próxima sexta, "dia 15" = o próximo 15.

import { MONTHS_PT as MONTHS, WEEKDAYS_PT as WEEKDAYS, WEEKDAY_NAME_PATTERN, MONTH_NAME_PATTERN, normalizeWeekdayKey } from "@/lib/temporal-vocab";

const SP_TZ = "America/Sao_Paulo";

const HOUR_WORDS: Record<string, number> = {
  uma: 1, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6,
  sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12,
};

const strip = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function partsSP(d: Date) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: SP_TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => Number(f.find((p) => p.type === t)?.value ?? 0);
  return { y: get("year"), m: get("month"), d: get("day") };
}

function weekdayOf(y: number, m: number, d: number) {
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
}

function addDays(y: number, m: number, d: number, delta: number) {
  const t = new Date(Date.UTC(y, m - 1, d + delta, 12));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

/** Monta ISO UTC a partir de data+hora locais de São Paulo (offset -03:00 fixo). */
function isoSP(y: number, m: number, d: number, hh: number, mm: number) {
  const p = (n: number) => String(n).padStart(2, "0");
  return new Date(`${y}-${p(m)}-${p(d)}T${p(hh)}:${p(mm)}:00-03:00`).toISOString();
}

export type FutureDateTime = {
  iso: string | null;
  hasDate: boolean;
  hasTime: boolean;
};

/**
 * Extrai data e/ou hora futura de um texto livre.
 * - Sem data mas com hora → assume hoje (ou amanhã, se o horário já passou).
 * - Sem hora mas com data → hasTime = false (quem chama decide perguntar).
 */
export function parseFutureDateTimeSP(text: string, base = new Date()): FutureDateTime {
  const raw = " " + (text ?? "") + " ";
  const norm = " " + strip(text ?? "") + " ";
  const today = partsSP(base);
  const todayWd = weekdayOf(today.y, today.m, today.d);

  let date: { y: number; m: number; d: number } | null = null;
  let hasDate = false;

  // --- Relativos ---
  if (/\bdepois\s+de\s+amanha\b/.test(norm)) { date = addDays(today.y, today.m, today.d, 2); hasDate = true; }
  else if (/\bamanha\b/.test(norm)) { date = addDays(today.y, today.m, today.d, 1); hasDate = true; }
  else if (/\b(hoje|hj|agora|essa\s+noite|esta\s+noite)\b/.test(norm)) { date = { ...today }; hasDate = true; }

  // --- DD/MM(/YYYY) ---
  if (!hasDate) {
    const dm = raw.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);
    if (dm) {
      const d = +dm[1], m = +dm[2];
      let y = dm[3] ? +dm[3] : today.y;
      if (y < 100) y += 2000;
      if (d >= 1 && d <= 31 && m >= 1 && m <= 12) {
        if (!dm[3]) {
          const cand = Date.UTC(y, m - 1, d, 12);
          if (cand < Date.UTC(today.y, today.m - 1, today.d, 12)) y += 1;
        }
        date = { y, m, d }; hasDate = true;
      }
    }
  }

  // --- "15 de julho" ---
  if (!hasDate) {
    const dmes = norm.match(new RegExp(String.raw`\b(\d{1,2})\s+(?:de\s+)?(${MONTH_NAME_PATTERN})\b(?:\s+de\s+(\d{2,4}))?`));
    if (dmes) {
      const d = +dmes[1], m = MONTHS[dmes[2]];
      let y = dmes[3] ? +dmes[3] : today.y;
      if (y < 100) y += 2000;
      if (d >= 1 && d <= 31 && m) {
        if (!dmes[3] && Date.UTC(y, m - 1, d, 12) < Date.UTC(today.y, today.m - 1, today.d, 12)) y += 1;
        date = { y, m, d }; hasDate = true;
      }
    }
  }

  // --- Dia da semana (sempre a PRÓXIMA ocorrência) ---
  // Quando o dia citado é HOJE (diff=0), não pula direto pra semana que vem —
  // fica em aberto até checar o horário (abaixo): se ainda não passou, é hoje
  // mesmo; se já passou, aí sim vai pra próxima ocorrência (+7).
  let weekdayIsToday = false;
  if (!hasDate) {
    const wd = norm.match(new RegExp(String.raw`\b(?:na\s+|no\s+|essa\s+|esta\s+|proxima\s+|proximo\s+)?(${WEEKDAY_NAME_PATTERN})\b`));
    if (wd) {
      const target = WEEKDAYS[normalizeWeekdayKey(wd[1])];
      let diff = target - todayWd;
      if (diff < 0) diff += 7;
      if (diff === 0) weekdayIsToday = true;
      date = addDays(today.y, today.m, today.d, diff); hasDate = true;
    }
  }

  // --- "semana que vem" sem dia específico: mantém o mesmo dia da semana, +7 dias ---
  if (!hasDate && /\bsemana\s+que\s+vem\b/.test(norm)) {
    date = addDays(today.y, today.m, today.d, 7); hasDate = true;
  }

  // --- "fim do mês" / "final do mês": último dia do mês local ---
  if (!hasDate && /\b(fim|final)\s+do\s+mes\b/.test(norm)) {
    const last = new Date(Date.UTC(today.y, today.m, 0, 12));
    let y = today.y, m = today.m, d = last.getUTCDate();
    if (today.d > d) {
      const nextLast = new Date(Date.UTC(today.y, today.m + 1, 0, 12));
      y = nextLast.getUTCFullYear(); m = nextLast.getUTCMonth() + 1; d = nextLast.getUTCDate();
    }
    date = { y, m, d }; hasDate = true;
  }

  // --- "dia 15" (próxima ocorrência) ---
  if (!hasDate) {
    const day = norm.match(/\b(?:no\s+)?dia\s+(\d{1,2})\b/);
    if (day) {
      const d = +day[1];
      if (d >= 1 && d <= 31) {
        let y = today.y, m = today.m;
        if (d < today.d) { const nx = new Date(Date.UTC(y, m, 1, 12)); y = nx.getUTCFullYear(); m = nx.getUTCMonth() + 1; }
        date = { y, m, d }; hasDate = true;
      }
    }
  }

  // --- Hora ---
  let hh: number | null = null;
  let mm = 0;
  const t1 = norm.match(/\b(\d{1,2})\s*[:h]\s*(\d{2})\b/);
  const t2 = norm.match(/\b(?:as\s+)?(\d{1,2})\s*h\b/);
  const t3 = norm.match(/\b(?:as\s+)?(\d{1,2})(?:\s*horas?)\b/);
  const t4 = norm.match(/\b(\d{1,2})\s*(?:e|:)\s*(meia|\d{1,2})\b/);
  const t5 = norm.match(/\b(?:as\s+)?(uma|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze)\b/);
  const t6 = norm.match(/\b(\d{1,2})\s*(am|pm)\b/);
  if (t1) { hh = +t1[1]; mm = +t1[2]; }
  else if (t2) { hh = +t2[1]; }
  else if (t3) { hh = +t3[1]; }
  else if (t4) { hh = +t4[1]; mm = t4[2] === "meia" ? 30 : +t4[2]; }
  else if (t5) { hh = HOUR_WORDS[t5[1]]; }
  else if (t6) { hh = +t6[1]; if (t6[2] === "pm" && hh < 12) hh += 12; if (t6[2] === "am" && hh === 12) hh = 0; }
  else if (/\bmeio[\s-]?dia\b/.test(norm)) { hh = 12; }
  else if (/\bmeia[\s-]?noite\b/.test(norm)) { hh = 0; }

  if (hh !== null) {
    const hasPeriod = /\b(da|de|a)\s+(manha|tarde|noite)\b/.test(norm);
    if (/\b(da|de|a)\s+(tarde|noite)\b/.test(norm) && hh < 12) hh += 12;
    if (/\b(da|de|a)\s+manha\b/.test(norm) && hh === 12) hh = 0;
    // Em frases de agenda, "às sete" costuma significar 19h; preserva a heurística antiga.
    if (!hasPeriod && t5 && hh >= 1 && hh <= 11) hh += 12;
    if (hh > 23 || mm > 59) hh = null;
  }

  const hasTime = hh !== null;
  if (!hasDate && !hasTime) return { iso: null, hasDate: false, hasTime: false };

  if (weekdayIsToday && hasTime) {
    // Dia citado é HOJE: só fica em hoje se o horário ainda não passou.
    const nowH = Number(new Intl.DateTimeFormat("pt-BR", { timeZone: SP_TZ, hour: "2-digit", hour12: false }).format(base));
    const nowM = Number(new Intl.DateTimeFormat("pt-BR", { timeZone: SP_TZ, minute: "2-digit" }).format(base));
    if ((hh! * 60 + mm) <= (nowH * 60 + nowM)) {
      date = addDays(today.y, today.m, today.d, 7);
    }
  }

  if (!hasDate) {
    // Só hora: hoje, ou amanhã se já passou.
    const nowH = Number(new Intl.DateTimeFormat("pt-BR", { timeZone: SP_TZ, hour: "2-digit", hour12: false }).format(base));
    const nowM = Number(new Intl.DateTimeFormat("pt-BR", { timeZone: SP_TZ, minute: "2-digit" }).format(base));
    date = (hh! * 60 + mm) <= (nowH * 60 + nowM)
      ? addDays(today.y, today.m, today.d, 1)
      : { ...today };
  }

  const iso = isoSP(date!.y, date!.m, date!.d, hasTime ? hh! : 9, hasTime ? mm : 0);
  return { iso, hasDate, hasTime };
}

/** Reconhece 1/2/3 (e sinônimos) nas opções de compromisso. */
export function readAppointmentChoice(text: string): "confirm" | "reschedule" | "cancel" | null {
  const t = strip(text ?? "").trim().replace(/[.!]+$/, "");
  if (!t) return null;
  if (/^(1|01|1️⃣|sim|s|confirmar|confirmado|confirmado sim|confirmo|ok|okay|blz|beleza|pode|pode ser|pode salvar|salva|salva ai|pode registrar|registra|pode agendar|pode fazer|pode ir|vai|bora|manda bala|manda ver|show|fechado|fechou|isso|isso ai|isso mesmo|e isso|certo|certinho|correto|exatamente|perfeito|logico|claro|positivo|👍|✅)$/.test(t)) return "confirm";
  if (/^(2|02|2️⃣|reagendar|reagenda|remarcar|remarca|trocar|troca|mudar|muda|alterar|altera|adiar|adia|outro dia|outro horario|🔄)$/.test(t)) return "reschedule";
  if (/^(3|03|3️⃣|cancelar|cancela|desistir|desisti|nao|nao vou|remover|remove|apagar|apaga|excluir|exclui|deletar|deleta|desmarcar|desmarca|❌)$/.test(t)) return "cancel";
  if (/\b(reagend|remarc|mudar (o )?(dia|horario)|trocar (o )?(dia|horario)|alterar para|muda para|passa para|coloca as)\b/.test(t)) return "reschedule";
  if (/\b(cancel|desmarc|nao vou|desisti)\b/.test(t)) return "cancel";
  return null;
}
