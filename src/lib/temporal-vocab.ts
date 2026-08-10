// Vocabulário temporal compartilhado (PT-BR): meses e dias da semana.
//
// Antes existiam 3 cópias divergentes destes mapas (datetime.ts,
// appointment-datetime.server.ts, wa-processor.server.ts), cada uma escrita
// à mão — o que deixava abreviações reconhecidas num parser e não nos
// outros (ex.: o parser de compromissos futuros não reconhecia "ter"/"seg",
// só o nome completo). Os parsers de mais alto nível continuam separados
// (passado vs. futuro têm vieses de resolução intencionalmente diferentes)
// — só o vocabulário/regex de reconhecimento é compartilhado aqui.

/** Mês (1-12). Aceita nome completo e abreviação de 3 letras. */
export const MONTHS_PT: Record<string, number> = {
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

/** Dia da semana (0=domingo..6=sábado). Aceita nome completo, "nome-feira"/"nome feira" e abreviação de 3 letras. */
export const WEEKDAYS_PT: Record<string, number> = {
  domingo: 0, dom: 0,
  segunda: 1, "segunda-feira": 1, seg: 1,
  terca: 2, "terca-feira": 2, ter: 2,
  quarta: 3, "quarta-feira": 3, qua: 3,
  quinta: 4, "quinta-feira": 4, qui: 4,
  sexta: 5, "sexta-feira": 5, sex: 5,
  sabado: 6, "sabado-feira": 6, sab: 6,
};

/**
 * Fragmento de regex (sem `\b` nas pontas) que casa qualquer forma de dia da
 * semana reconhecida em WEEKDAYS_PT: nome completo, "nome-feira"/"nome
 * feira" ou abreviação de 3 letras. Usar dentro de um `\b(...)\b` maior.
 */
export const WEEKDAY_NAME_PATTERN = String.raw`domingo|dom|segunda(?:[\s-]feira)?|seg|terca(?:[\s-]feira)?|ter|quarta(?:[\s-]feira)?|qua|quinta(?:[\s-]feira)?|qui|sexta(?:[\s-]feira)?|sex|sabado(?:[\s-]feira)?|sab`;

/** Normaliza uma captura de WEEKDAY_NAME_PATTERN (removendo "-feira"/" feira") para a chave usada em WEEKDAYS_PT. */
export function normalizeWeekdayKey(raw: string): string {
  return raw.replace(/[\s-]feira$/i, "");
}

/**
 * Fragmento de regex (sem `\b` nas pontas) que casa qualquer forma de mês
 * reconhecida em MONTHS_PT: nome completo ou abreviação de 3 letras.
 */
export const MONTH_NAME_PATTERN = String.raw`janeiro|jan|fevereiro|fev|mar[cç]o|mar|abril|abr|maio|mai|junho|jun|julho|jul|agosto|ago|setembro|set|outubro|out|novembro|nov|dezembro|dez`;
