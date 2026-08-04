// Normalização monetária de fala/transcrição PT-BR.
//
// Objetivo: transformar valores falados ("trinta e sete reais e vinte e cinco
// centavos") em UM único número decimal ("37,25") ANTES de qualquer parser
// financeiro ou chamada de IA. Isso evita o bug crítico em que reais e
// centavos eram lidos como dois lançamentos independentes.
//
// Regras principais:
//  - "[X] reais e [Y] centavos"      → "X,YY"
//  - "[X] reais e [Y]"               → "X,YY"  (Y com 1-2 dígitos e sem "reais")
//  - "[Y] centavos" (sozinho)        → "0,YY"
//  - "X vírgula Y"                   → "X,YY"
//  - grupos por extenso adjacentes unidos por "e" ("trinta e sete e vinte e
//    cinco") → "37,25"
//  - "37 reais no sorvete e 25 reais no lanche" → NÃO junta (dois valores reais)
//  - "37 e 25" em dígitos, sem "reais/centavos" → NÃO junta (ambíguo; o
//    sistema pergunta ao usuário)

const UNITS: Record<string, number> = {
  zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5,
  seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, treze: 13,
  catorze: 14, quatorze: 14, quinze: 15, dezesseis: 16, dezasseis: 16,
  dezessete: 17, dezassete: 17, dezoito: 18, dezenove: 19, dezanove: 19,
};

const TENS: Record<string, number> = {
  vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, cincoenta: 50,
  sessenta: 60, setenta: 70, oitenta: 80, noventa: 90,
};

const HUNDREDS: Record<string, number> = {
  cem: 100, cento: 100, duzentos: 200, duzentas: 200, trezentos: 300,
  trezentas: 300, quatrocentos: 400, quatrocentas: 400, quinhentos: 500,
  quinhentas: 500, seiscentos: 600, seiscentas: 600, setecentos: 700,
  setecentas: 700, oitocentos: 800, oitocentas: 800, novecentos: 900,
  novecentas: 900,
};

function deaccent(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function pad2(digits: string): string {
  return digits.length === 1 ? `0${digits}` : digits.slice(0, 2);
}

type Tok = { raw: string; space: boolean; word: string };

function tokenize(text: string): Tok[] {
  const parts = text.match(/\s+|[\p{L}]+|\d+(?:[.,]\d+)*|[^\s\p{L}\d]+/gu) ?? [];
  return parts.map((raw) => ({
    raw,
    space: /^\s+$/.test(raw),
    word: deaccent(raw),
  }));
}

type Group = { value: number; end: number; words: number };

/** Lê um grupo numérico por extenso a partir de `i` (índice em tokens não-espaço). */
function readWordNumber(tokens: Tok[], start: number): Group | null {
  let i = start;
  let total = 0;
  let current = 0;
  let words = 0;
  let usedHundreds = false;
  let usedTens = false;
  let usedUnits = false;
  let usedThousand = false;
  let lastConsumed = start;

  const next = (idx: number) => {
    let j = idx;
    while (j < tokens.length && tokens[j].space) j++;
    return j;
  };

  i = next(i);
  while (i < tokens.length) {
    const w = tokens[i].word;
    if (w === "e" && words > 0) {
      // "e" só continua o grupo se vier outro termo numérico compatível
      const j = next(i + 1);
      if (j >= tokens.length) break;
      const nw = tokens[j].word;
      const isNum = nw in UNITS || nw in TENS || nw in HUNDREDS || nw === "mil";
      if (!isNum) break;
      if (nw in HUNDREDS && (usedHundreds || usedTens || usedUnits)) break;
      if (nw in TENS && (usedTens || usedUnits)) break;
      if (nw in UNITS && (usedUnits || (usedTens && UNITS[nw] >= 10))) break;
      i = j;
      continue;
    }
    if (w in HUNDREDS) {
      if (usedHundreds || usedTens || usedUnits) break;
      current += HUNDREDS[w];
      usedHundreds = true;
    } else if (w in TENS) {
      if (usedTens || usedUnits) break;
      current += TENS[w];
      usedTens = true;
    } else if (w in UNITS) {
      if (usedUnits) break;
      if (usedTens && UNITS[w] >= 10) break;
      current += UNITS[w];
      usedUnits = true;
    } else if (w === "mil") {
      if (usedThousand) break;
      total += (current || 1) * 1000;
      current = 0;
      usedThousand = true;
      usedHundreds = usedTens = usedUnits = false;
    } else if (w === "milhao" || w === "milhoes") {
      total = (total + (current || 1)) * 1000000;
      current = 0;
      usedThousand = false;
      usedHundreds = usedTens = usedUnits = false;
    } else {
      break;
    }
    words++;
    lastConsumed = i;
    i = next(i + 1);
  }

  if (words === 0) return null;
  const value = total + current;
  return { value, end: lastConsumed + 1, words };
}

/**
 * Converte números por extenso em dígitos e une grupos adjacentes ligados por
 * "e" (reais + centavos falados sem a palavra "centavos").
 */
export function ptNumberWordsToDigits(text: string): string {
  if (!text) return text;
  const tokens = tokenize(text);
  const out: string[] = [];
  let i = 0;

  const skipSpaces = () => {
    while (i < tokens.length && tokens[i].space) {
      out.push(tokens[i].raw);
      i++;
    }
  };

  while (i < tokens.length) {
    if (tokens[i].space) {
      skipSpaces();
      continue;
    }
    const group = readWordNumber(tokens, i);
    if (!group) {
      out.push(tokens[i].raw);
      i++;
      continue;
    }

    // Verifica se logo após o grupo vem "e" + outro grupo por extenso (< 100),
    // sem menção a "reais/centavos" entre eles → é o par reais+centavos falado.
    let j = group.end;
    while (j < tokens.length && tokens[j].space) j++;
    if (tokens[j]?.word === "e" && group.value >= 1) {
      let k = j + 1;
      while (k < tokens.length && tokens[k].space) k++;
      const second = readWordNumber(tokens, k);
      if (second && second.value >= 1 && second.value <= 99) {
        out.push(`${group.value},${pad2(String(second.value))}`);
        i = second.end;
        continue;
      }
    }

    out.push(String(group.value));
    i = group.end;
  }

  return out.join("");
}

const CURRENCY_WORD = String.raw`reais?|real|contos?|conto|pila|paus|mangos?`;

/**
 * Normaliza valores monetários falados/escritos para um único decimal.
 * Idempotente e seguro para textos que não contenham valores.
 */
export function normalizeSpokenMoney(text: string): string {
  if (!text || !text.trim()) return text;
  let out = ptNumberWordsToDigits(text);

  // "X vírgula Y" → "X,YY"
  out = out.replace(
    /(\d{1,3}(?:\.\d{3})*|\d+)\s*v[ií]rgula\s*(\d{1,2})\b/gi,
    (_m, a: string, b: string) => `${a},${pad2(b)}`,
  );

  // "X reais e Y centavos" / "X reais com Y" / "X conto e Y centavos"
  out = out.replace(
    new RegExp(
      String.raw`(\d{1,3}(?:\.\d{3})*|\d+)\s*(?:${CURRENCY_WORD})\s*(?:e|com|,)\s*(\d{1,2})\b(?!\s*(?:${CURRENCY_WORD})\b)(\s*centavos?)?`,
      "gi",
    ),
    (_m, a: string, b: string) => `${a},${pad2(b)}`,
  );

  // "X e Y centavos" (sem a palavra "reais")
  out = out.replace(
    /(\d{1,3}(?:\.\d{3})*|\d+)\s*(?:e|com|,)\s*(\d{1,2})\s*centavos?\b/gi,
    (_m, a: string, b: string) => `${a},${pad2(b)}`,
  );

  // "Y centavos" isolado → "0,YY"
  out = out.replace(
    /(^|[^\d,.])(\d{1,2})\s*centavos?\b/gi,
    (_m, pre: string, b: string) => `${pre}0,${pad2(b)}`,
  );

  // "X,YY reais" → mantém o número, remove ruído duplicado de moeda
  return out;
}

/**
 * Verdadeiro quando o texto contém a construção explícita "reais e centavos"
 * (ou apenas "centavos"), caso em que NUNCA se deve perguntar nem dividir:
 * é um único valor decimal.
 */
export function hasExplicitCentsConstruction(text: string): boolean {
  if (!text) return false;
  const t = deaccent(text);
  if (/\bcentavos?\b/.test(t)) return true;
  return new RegExp(String.raw`\d+\s*(?:${CURRENCY_WORD})\s*(?:e|com)\s*\d{1,2}\b`, "i").test(t);
}

/**
 * Detecta o caso realmente ambíguo: dois números inteiros colados por "e",
 * sem "reais"/"centavos", e nenhum outro valor na frase
 * ("paguei 37 e 25 no sorvete"). Nesse caso NÃO registramos: perguntamos.
 */
export function detectCentsAmbiguity(text: string): { whole: number; cents: number } | null {
  if (!text) return null;
  const t = deaccent(text);
  if (/\bcentavos?\b/.test(t)) return null;
  const numbers = t.match(/\d+(?:[.,]\d+)?/g) ?? [];
  if (numbers.length !== 2) return null;
  const m = t.match(/(?:^|[^\d.,])(\d{1,4})\s+e\s+(\d{1,2})(?![\d.,])/);
  if (!m) return null;
  // "37 reais e 25 reais" (dois valores independentes) nunca chega aqui:
  // a normalização já resolveu ou existem palavras de moeda em ambos.
  const between = t.slice((m.index ?? 0) + m[0].length);
  if (new RegExp(String.raw`^\s*(?:${CURRENCY_WORD})\b`).test(between)) return null;
  const whole = Number(m[1]);
  const cents = Number(m[2]);
  if (!(whole > 0) || !(cents > 0)) return null;
  return { whole, cents };
}
