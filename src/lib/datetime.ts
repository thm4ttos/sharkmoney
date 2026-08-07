// Camada única de tratamento de datas do Abio.
// Todo o sistema trabalha internamente em UTC (ISO), mas exibe e interpreta
// as datas no fuso America/Sao_Paulo.

export const SP_TZ = "America/Sao_Paulo";

/** ISO do instante atual (mesmo valor em qualquer TZ; é um ponto no tempo). */
export function nowIso(): string {
  return new Date().toISOString();
}

function partsSP(iso: string | Date): { y: number; m: number; d: number; hh: number; mm: number; ss: number } {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: SP_TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map(p => [p.type, p.value])) as Record<string, string>;
  return {
    y: Number(parts.year), m: Number(parts.month), d: Number(parts.day),
    hh: Number(parts.hour === "24" ? "00" : parts.hour),
    mm: Number(parts.minute), ss: Number(parts.second),
  };
}

/** "DD/MM" no fuso SP. */
export function formatDayMonthSP(iso?: string | null): string {
  if (!iso) return "—";
  const p = partsSP(iso);
  return `${String(p.d).padStart(2, "0")}/${String(p.m).padStart(2, "0")}`;
}

/** "DD/MM/YYYY" no fuso SP. */
export function formatDateSP(iso?: string | null): string {
  if (!iso) return "—";
  const p = partsSP(iso);
  return `${String(p.d).padStart(2, "0")}/${String(p.m).padStart(2, "0")}/${p.y}`;
}

/** "YYYY-MM-DD" no fuso SP — pronto para <input type="date">. */
export function toDateInputSP(iso?: string | null): string {
  if (!iso) {
    const p = partsSP(new Date());
    return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
  }
  const p = partsSP(iso);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

/** Retorna o offset em minutos entre SP e UTC para uma data específica (respeita horário de verão histórico). */
function spOffsetMinutes(y: number, m: number, d: number, hh: number, mm: number, ss: number): number {
  // Interpreta o timestamp como se fosse UTC, extrai como SP, e mede a diferença.
  const asUtc = Date.UTC(y, m - 1, d, hh, mm, ss);
  const spParts = partsSP(new Date(asUtc));
  const asSp = Date.UTC(spParts.y, spParts.m - 1, spParts.d, spParts.hh, spParts.mm, spParts.ss);
  return (asUtc - asSp) / 60000; // minutos
}

/**
 * Converte uma data digitada (YYYY-MM-DD, interpretada em SP) para ISO UTC,
 * preservando o horário (h/m/s) do ISO original quando fornecido.
 */
export function dateInputSPToIso(dateStr: string, keepTimeFromIso?: string | null): string {
  const [ys, ms, ds] = dateStr.split("-");
  const y = Number(ys), m = Number(ms), d = Number(ds);
  let hh = 12, mm = 0, ss = 0;
  if (keepTimeFromIso) {
    const p = partsSP(keepTimeFromIso);
    hh = p.hh; mm = p.mm; ss = p.ss;
  } else {
    const p = partsSP(new Date());
    hh = p.hh; mm = p.mm; ss = p.ss;
  }
  const offset = spOffsetMinutes(y, m, d, hh, mm, ss);
  // SP time -> UTC: soma o offset (SP está atrás de UTC, offset positivo).
  const utcMs = Date.UTC(y, m - 1, d, hh, mm, ss) + offset * 60000;
  return new Date(utcMs).toISOString();
}

/** Dia do mês (1..31) no fuso SP. */
export function dayOfMonthSP(iso: string | Date): number {
  return partsSP(iso).d;
}

/**
 * Converte uma data impressa em documento ("DD/MM/AAAA", "DD/MM/AA" ou
 * "AAAA-MM-DD") para ISO (meio-dia no fuso SP). Retorna null se inválida.
 * Usado para dar prioridade à data da nota fiscal/comprovante.
 */
export function isoNoonSPFromPrintedDate(raw?: string | null): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  let y: number, m: number, d: number;
  let mt = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (mt) { y = +mt[1]!; m = +mt[2]!; d = +mt[3]!; }
  else {
    mt = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
    if (!mt) return null;
    d = +mt[1]!; m = +mt[2]!; y = +mt[3]!;
    if (y < 100) y += 2000;
  }
  if (!(m >= 1 && m <= 12) || !(d >= 1 && d <= 31) || y < 2000 || y > 2100) return null;
  const iso = toIsoNoonSP(y, m, d);
  // Nunca aceita data futura (comprovante não pode ser do futuro).
  if (new Date(iso).getTime() > Date.now() + 24 * 3600 * 1000) return null;
  return iso;
}

// ---------------------------------------------------------------
// Interpretação natural de datas em português (BR).
// Reconhece "ontem", "antes de ontem", "hoje", "amanhã", "depois de amanhã",
// dias da semana ("na sexta", "última segunda"), "semana passada/retrasada",
// "mês passado/retrasado", "esse mês", "dia 15", "15/07", "15-07", "15/07/2025",
// "15 de julho", "15 julho", "em janeiro".
// Retorna o ISO no fuso SP (meio-dia local) para o dia identificado, além
// do trecho da string que representa a referência (útil para limpar a descrição).
// Referências futuras (amanhã / depois de amanhã / dias na frente) retornam
// `future: true` — o chamador NÃO deve usar isso como data de despesa (o item
// deve virar compromisso).
// ---------------------------------------------------------------

const MONTHS_PT: Record<string, number> = {
  janeiro: 1, jan: 1,
  fevereiro: 2, fev: 2,
  marco: 3, mar: 3, "março": 3,
  abril: 4, abr: 4,
  maio: 5, mai: 5,
  junho: 6, jun: 6,
  julho: 7, jul: 7,
  agosto: 8, ago: 8,
  setembro: 9, set: 9,
  outubro: 10, out: 10,
  novembro: 11, nov: 11,
  dezembro: 12, dez: 12,
};

const WEEKDAYS_PT: Record<string, number> = {
  domingo: 0,
  segunda: 1, "segunda-feira": 1, seg: 1,
  terca: 2, "terca-feira": 2, ter: 2,
  quarta: 3, "quarta-feira": 3, qua: 3,
  quinta: 4, "quinta-feira": 4, qui: 4,
  sexta: 5, "sexta-feira": 5, sex: 5,
  sabado: 6, "sabado-feira": 6, sab: 6,
};

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function toIsoNoonSP(y: number, m: number, d: number): string {
  const off = spOffsetMinutes(y, m, d, 12, 0, 0);
  const utcMs = Date.UTC(y, m - 1, d, 12, 0, 0) + off * 60000;
  return new Date(utcMs).toISOString();
}

function addDaysSP(base: { y: number; m: number; d: number }, delta: number): { y: number; m: number; d: number } {
  const t = new Date(Date.UTC(base.y, base.m - 1, base.d, 12));
  t.setUTCDate(t.getUTCDate() + delta);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

function weekdaySP(y: number, m: number, d: number): number {
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
}

export type DateHint = { iso: string; matched: string; future: boolean };

/**
 * Extrai a primeira referência natural de data encontrada em `text`.
 * Retorna null se nada for encontrado.
 */
export function extractDateHintSP(text: string): DateHint | null {
  if (!text) return null;
  const raw = " " + text + " ";
  const norm = " " + stripAccents(text.toLowerCase()) + " ";
  const today = partsSP(new Date());
  const todayWd = weekdaySP(today.y, today.m, today.d);

  const build = (delta: number, matched: string, future = false): DateHint => {
    const t = addDaysSP({ y: today.y, m: today.m, d: today.d }, delta);
    return { iso: toIsoNoonSP(t.y, t.m, t.d), matched, future };
  };
  const buildYMD = (y: number, m: number, d: number, matched: string): DateHint => {
    const now = new Date(Date.UTC(today.y, today.m - 1, today.d, 12)).getTime();
    const cand = new Date(Date.UTC(y, m - 1, d, 12)).getTime();
    return { iso: toIsoNoonSP(y, m, d), matched, future: cand > now + 12 * 3600 * 1000 };
  };

  // ---- Referências relativas explícitas ----
  const REL: Array<[RegExp, number]> = [
    [/\bdepois\s+de\s+amanha\b/, 2],
    [/\bantes\s+de\s+ontem\b/, -2],
    [/\banteontem\b/, -2],
    [/\bhoje\b/, 0],
    [/\bontem\b/, -1],
    [/\bamanha\b/, 1],
  ];
  for (const [re, delta] of REL) {
    const m = norm.match(re);
    if (m) return build(delta, m[0].trim(), delta > 0);
  }

  // ---- Semana passada / retrasada ----
  if (/\bsemana\s+retrasada\b/.test(norm)) return build(-14, "semana retrasada");
  if (/\bsemana\s+passada\b/.test(norm)) return build(-7, "semana passada");

  // ---- Mês passado / retrasado / esse mês ----
  if (/\bmes\s+retrasado\b/.test(norm)) {
    const t = new Date(Date.UTC(today.y, today.m - 1 - 2, Math.min(today.d, 28), 12));
    return { iso: toIsoNoonSP(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()), matched: "mês retrasado", future: false };
  }
  if (/\bmes\s+passado\b/.test(norm) || /\bno\s+mes\s+passado\b/.test(norm)) {
    const t = new Date(Date.UTC(today.y, today.m - 1 - 1, Math.min(today.d, 28), 12));
    return { iso: toIsoNoonSP(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()), matched: "mês passado", future: false };
  }
  if (/\b(esse|este)\s+mes\b/.test(norm)) return build(0, "esse mês");

  // ---- Datas escritas: DD/MM(/YYYY) ou DD-MM(-YYYY) ----
  const dm = raw.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);
  if (dm) {
    const d = parseInt(dm[1], 10);
    const m = parseInt(dm[2], 10);
    let y = dm[3] ? parseInt(dm[3], 10) : today.y;
    if (y < 100) y += 2000;
    if (d >= 1 && d <= 31 && m >= 1 && m <= 12) {
      // Sem ano explícito: se a data cair no futuro do ano corrente, usa ano anterior.
      if (!dm[3]) {
        const cand = new Date(Date.UTC(y, m - 1, d, 12)).getTime();
        const now = new Date(Date.UTC(today.y, today.m - 1, today.d, 12)).getTime();
        if (cand > now + 12 * 3600 * 1000) y -= 1;
      }
      return buildYMD(y, m, d, dm[0]);
    }
  }

  // ---- "15 de julho", "15 julho" ----
  const dmes = norm.match(/\b(\d{1,2})\s+(?:de\s+)?(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\b(?:\s+de\s+(\d{2,4}))?/);
  if (dmes) {
    const d = parseInt(dmes[1], 10);
    const m = MONTHS_PT[dmes[2]];
    let y = dmes[3] ? parseInt(dmes[3], 10) : today.y;
    if (y < 100) y += 2000;
    if (d >= 1 && d <= 31 && m) {
      if (!dmes[3]) {
        const cand = new Date(Date.UTC(y, m - 1, d, 12)).getTime();
        const now = new Date(Date.UTC(today.y, today.m - 1, today.d, 12)).getTime();
        if (cand > now + 12 * 3600 * 1000) y -= 1;
      }
      return buildYMD(y, m, d, dmes[0]);
    }
  }

  // ---- "em janeiro" / "no mês de janeiro" (sem dia) → dia 15 do mês ----
  const monthOnly = norm.match(/\b(?:em|no\s+mes\s+de)\s+(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/);
  if (monthOnly) {
    const m = MONTHS_PT[monthOnly[1]];
    let y = today.y;
    const cand = new Date(Date.UTC(y, m - 1, 15, 12)).getTime();
    const now = new Date(Date.UTC(today.y, today.m - 1, today.d, 12)).getTime();
    if (cand > now + 12 * 3600 * 1000) y -= 1;
    return buildYMD(y, m, 15, monthOnly[0]);
  }

  // ---- Dia da semana ----
  //   "última sexta" / "ultima sexta" → semana anterior (>=7 dias)
  //   "na sexta" / "sexta" isolado → ocorrência mais recente no passado (1..7)
  const lastWd = norm.match(/\b(?:na\s+)?ultima\s+(domingo|segunda(?:-feira)?|terca(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|sabado)\b/);
  if (lastWd) {
    const target = WEEKDAYS_PT[lastWd[1]];
    let diff = todayWd - target;
    if (diff <= 0) diff += 7;
    diff += 7; // semana ANTERIOR
    return build(-diff, lastWd[0]);
  }
  const wd = norm.match(/\b(?:na\s+|no\s+)?(domingo|segunda(?:-feira)?|terca(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|sabado)\b/);
  if (wd) {
    const target = WEEKDAYS_PT[wd[1]];
    let diff = todayWd - target;
    if (diff <= 0) diff += 7; // sempre ocorrência PASSADA (regra do usuário)
    return build(-diff, wd[0]);
  }

  // ---- "dia 15" / "no dia 03" ----
  const day = norm.match(/\b(?:no\s+)?dia\s+(\d{1,2})\b/);
  if (day) {
    const d = parseInt(day[1], 10);
    if (d >= 1 && d <= 31) {
      let y = today.y, m = today.m;
      const cand = new Date(Date.UTC(y, m - 1, d, 12)).getTime();
      const now = new Date(Date.UTC(today.y, today.m - 1, today.d, 12)).getTime();
      if (cand > now + 12 * 3600 * 1000) {
        // dia futuro no mês atual → mês anterior
        const prev = new Date(Date.UTC(y, m - 1 - 1, d, 12));
        y = prev.getUTCFullYear(); m = prev.getUTCMonth() + 1;
      }
      return buildYMD(y, m, d, day[0]);
    }
  }

  return null;
}

/** Remove o trecho da referência de data para uso em descrição. */
export function stripDateHint(text: string, hint: DateHint | null): string {
  if (!hint || !text) return text;
  // Regex case/acento-insensitiva construída a partir do trecho identificado.
  const escaped = hint.matched.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  const re = new RegExp("\\b" + escaped + "\\b", "gi");
  return text.replace(re, " ").replace(/\s+/g, " ").trim();
}

