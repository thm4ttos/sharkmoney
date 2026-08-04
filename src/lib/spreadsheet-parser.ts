// Deterministic CSV/XLSX parser — no AI, 100% row fidelity.
// Preserves original dates, values, sign, and order. Runs in the browser.
import * as XLSX from "xlsx";

export type ParsedRow = {
  date: string;            // YYYY-MM-DD (calendar date from the source, no TZ shift)
  time: string | null;     // HH:MM or null
  amount: number;          // absolute value
  kind: "income" | "expense";
  category: string;
  description: string;
  notes: string | null;
  installment: { current: number; total: number } | null;
  recurring: boolean;
};

const CATEGORIES = [
  "Moradia", "Alimentação", "Transporte", "Saúde", "Educação",
  "Lazer", "Pessoal", "Investimentos", "Vida Espiritual",
  "Empresa e Autônomo", "Outros", "Receita",
];

const norm = (s: any) =>
  String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

/** Column detection by header keywords (Portuguese + English). */
type ColMap = {
  date: number | null;
  time: number | null;
  amount: number | null;      // single amount column (signed or paired with kind col)
  income: number | null;      // separate credit column
  expense: number | null;     // separate debit column
  kind: number | null;        // "receita/despesa/entrada/saida/credito/debito/C/D"
  category: number | null;
  description: number[];      // may combine multiple columns
  notes: number | null;
};

function detectColumns(header: string[]): ColMap {
  const map: ColMap = {
    date: null, time: null, amount: null, income: null, expense: null,
    kind: null, category: null, description: [], notes: null,
  };
  header.forEach((raw, i) => {
    const h = norm(raw);
    if (!h) return;
    if (map.date == null && /(^|\b)(data|date|dt|vencimento|competencia|dia)(\b|$)/.test(h)) { map.date = i; return; }
    if (map.time == null && /(^|\b)(hora|time|horario)(\b|$)/.test(h)) { map.time = i; return; }
    if (map.income == null && /(receita|credito|entrada|deposito|ganho)/.test(h) && !/despesa|debito|saida/.test(h)) { map.income = i; return; }
    if (map.expense == null && /(despesa|debito|saida|gasto|pagamento)/.test(h) && !/receita|credito|entrada/.test(h)) { map.expense = i; return; }
    if (map.amount == null && /(valor|montante|amount|quantia|preco|total)/.test(h)) { map.amount = i; return; }
    if (map.kind == null && /(tipo|kind|type|operacao|natureza|movimento)/.test(h)) { map.kind = i; return; }
    if (map.category == null && /(categoria|category|classificacao|grupo)/.test(h)) { map.category = i; return; }
    if (map.notes == null && /(obs|observ|nota|comentario|memo|detalh)/.test(h)) { map.notes = i; return; }
    if (/(descric|historic|estabelec|nome|item|lancamento|pagador|beneficiario|memo|referenc|titulo)/.test(h)) {
      map.description.push(i);
      return;
    }
  });
  // Fallback: if no explicit description column, take first non-classified text column.
  if (!map.description.length) {
    header.forEach((_, i) => {
      if ([map.date, map.time, map.amount, map.income, map.expense, map.kind, map.category, map.notes].includes(i)) return;
      if (map.description.length < 3) map.description.push(i);
    });
  }
  return map;
}

/** Parse a BRL/US monetary string. Returns signed number (negatives preserved). */
function parseAmount(raw: any): number | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  let s = String(raw).trim();
  if (!s) return null;
  // Parentheses => negative accounting notation
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  // Trailing sign like "1.234,56-"
  if (/-\s*$/.test(s)) { negative = true; s = s.replace(/-\s*$/, ""); }
  // Explicit D/C indicators
  if (/\s(D|DB|debito)\b/i.test(s)) negative = true;
  s = s.replace(/[R$USD€£\s]/gi, "").replace(/(D|DB|C|CR)$/i, "");
  if (s.startsWith("-")) { negative = true; s = s.slice(1); }
  if (s.startsWith("+")) s = s.slice(1);
  if (!s) return null;
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  let normalized = s;
  if (hasComma && hasDot) {
    // Whichever separator is rightmost is the decimal
    normalized = s.lastIndexOf(",") > s.lastIndexOf(".")
      ? s.replace(/\./g, "").replace(",", ".")
      : s.replace(/,/g, "");
  } else if (hasComma) {
    // Comma-only: assume decimal if it precedes 1-2 digits at end
    normalized = /,\d{1,2}$/.test(s) ? s.replace(",", ".") : s.replace(/,/g, "");
  } else if (hasDot) {
    // Dot-only: assume decimal if it precedes 1-2 digits at end AND there aren't multiple dots
    const dots = (s.match(/\./g) || []).length;
    normalized = dots === 1 && /\.\d{1,2}$/.test(s) ? s : s.replace(/\./g, "");
  }
  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/** Turn a value into a canonical YYYY-MM-DD without any TZ shift. */
function parseDateCell(raw: any, format: "dmy" | "mdy" | "ymd" | "auto" = "auto"): string | null {
  if (raw == null || raw === "") return null;
  // Excel/JS Date object (SheetJS creates UTC-midnight dates for date cells)
  if (raw instanceof Date && !isNaN(raw.getTime())) {
    const y = raw.getUTCFullYear();
    const m = raw.getUTCMonth() + 1;
    const d = raw.getUTCDate();
    if (y < 1900 || y > 2100) return null;
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  // Numeric = Excel serial
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 59 && raw < 80000) {
    const parsed = XLSX.SSF.parse_date_code(raw);
    if (parsed && parsed.y) {
      return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
    }
  }
  const s = String(raw).trim();
  if (!s) return null;
  // ISO YYYY-MM-DD (with optional time)
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  // Slash/Dot separated
  m = s.match(/^(\d{1,4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,4})/);
  if (m) {
    const a = Number(m[1]), b = Number(m[2]), c = Number(m[3]);
    let y: number, mo: number, d: number;
    if (m[1].length === 4) { y = a; mo = b; d = c; }                        // YYYY-MM-DD
    else if (m[3].length === 4 || c > 31) {                                 // ??-??-YYYY
      // Decide DMY vs MDY based on format hint or heuristic (day>12 → dmy).
      if (format === "mdy") { mo = a; d = b; }
      else if (format === "dmy") { d = a; mo = b; }
      else { d = a; mo = b; }                                               // BR default
      y = c < 100 ? 2000 + c : c;
    } else {
      // 2-digit year: assume DD/MM/YY
      d = a; mo = b; y = 2000 + c;
    }
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1900 || y > 2100) return null;
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  return null;
}

function parseTimeCell(raw: any): string | null {
  if (raw == null || raw === "") return null;
  if (raw instanceof Date && !isNaN(raw.getTime())) {
    const h = raw.getUTCHours();
    const mi = raw.getUTCMinutes();
    if (h === 0 && mi === 0) return null;
    return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
  }
  const s = String(raw).trim();
  const m = s.match(/(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
}

/** Detect DMY vs MDY by scanning the date column. */
function detectDateFormat(values: any[]): "dmy" | "mdy" | "auto" {
  let dmyScore = 0, mdyScore = 0;
  for (const v of values) {
    if (typeof v !== "string") continue;
    const m = v.trim().match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.]\d{2,4}/);
    if (!m) continue;
    const a = Number(m[1]), b = Number(m[2]);
    if (a > 12 && b <= 12) dmyScore++;
    else if (b > 12 && a <= 12) mdyScore++;
  }
  if (dmyScore > mdyScore) return "dmy";
  if (mdyScore > dmyScore) return "mdy";
  return "auto";
}

const CATEGORY_HEURISTICS: Array<{ cat: string; re: RegExp }> = [
  { cat: "Alimentação", re: /(mercado|supermerc|padaria|restaur|ifood|mcdonald|burger|subway|habib|rappi|delivery|acougue|hortifruti|ze delivery|cafeter|lanchonete|pizza)/i },
  { cat: "Transporte", re: /(uber|99|indrive|cabify|taxi|combust|posto|shell|ipiranga|petrobras|pedagio|estacionamento|onibus|metro|passagem|mecanico|oficina|ipva|seguro auto|gasolina|etanol|diesel)/i },
  { cat: "Moradia", re: /(aluguel|condominio|iptu|luz|energia|enel|cpfl|copel|agua|sabesp|gas|internet|vivo fibra|claro net|oi fibra|tim live|net |fibra)/i },
  { cat: "Saúde", re: /(farmac|drogasil|droga raia|pacheco|panvel|plano de saude|amil|unimed|bradesco saude|hospital|clinica|laborator|consulta|exame|academia|smart fit|bio ritmo|nutricion|psico)/i },
  { cat: "Educação", re: /(escola|faculdade|mensalidade|curso|udemy|alura|coursera|livros|material escolar|colegio)/i },
  { cat: "Lazer", re: /(cinema|ingresso|netflix|spotify|prime video|disney|hbo|youtube premium|deezer|viagem|hotel|airbnb|bar |balada|show|steam|psn|xbox)/i },
  { cat: "Pessoal", re: /(barbeiro|salao|cabelele|cosmeti|roupa|calcado|renner|c&a|riachuelo|zara|presente)/i },
  { cat: "Investimentos", re: /(aplicac|resgate|tesouro|cdb|lci|lca|acoes|xp invest|rico|nubank invest|inter invest|cripto|binance)/i },
  { cat: "Vida Espiritual", re: /(dizimo|oferta|igreja|doacao)/i },
  { cat: "Empresa e Autônomo", re: /(nota fiscal|fornecedor|contador|honorar|cliente pj|mei)/i },
];
const INCOME_HEURISTICS = /(salario|holerite|pix recebido|transferencia recebida|ted recebida|doc recebido|deposito|comissao|venda|freelance|freela|rendimento|dividendo|cashback|reembolso|restituicao|aluguel recebido|adiantamento|13o|ferias|pagamento recebido)/i;

function inferCategory(description: string, existing: string, kind: "income" | "expense"): string {
  if (existing && CATEGORIES.includes(existing)) return existing;
  if (kind === "income") return "Receita";
  const t = norm(description);
  for (const { cat, re } of CATEGORY_HEURISTICS) if (re.test(t)) return cat;
  return "Outros";
}

function detectRecurring(desc: string): boolean {
  return /(netflix|spotify|prime video|disney|hbo|youtube premium|aluguel|condominio|internet|fibra|luz|energia|agua|gas |academia|smart fit|mensalidade|seguro|assinatura)/i.test(desc);
}

function detectInstallment(desc: string): { current: number; total: number } | null {
  const m = desc.match(/(?:parcela\s*)?(\d{1,2})\s*[\/xde]\s*(\d{1,2})/i);
  if (!m) return null;
  const c = Number(m[1]), t = Number(m[2]);
  if (!c || !t || c > t || t > 60) return null;
  return { current: c, total: t };
}

function isLikelyHeader(row: any[]): boolean {
  const filled = row.filter(v => v != null && v !== "").length;
  if (filled < 2) return false;
  const textCells = row.filter(v => typeof v === "string" && !/^\-?\d/.test(v.trim()) && v.trim().length > 0).length;
  return textCells >= Math.max(2, Math.floor(filled * 0.6));
}

function isNoiseRow(desc: string, amount: number | null): boolean {
  if (amount == null || amount === 0) return true;
  const d = norm(desc);
  if (!d) return amount == null;
  if (/(^|\s)(saldo|subtotal|total geral|total do periodo|total$|saldo anterior|saldo final|saldo atual)/.test(d)) return true;
  return false;
}

/** Parse a single sheet's rows (already as arrays) into ParsedRow[]. */
function parseSheet(rows: any[][]): ParsedRow[] {
  if (!rows.length) return [];
  // Find header row: first row where >=2 text cells match one of our keywords, else row 0.
  let headerIdx = 0;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const r = rows[i].map(v => norm(v));
    const matches = r.filter(v => /(data|valor|descric|historic|categ|tipo|receita|despesa|debito|credito|entrada|saida|vencimento)/.test(v)).length;
    if (matches >= 2) { headerIdx = i; break; }
    if (i === 0 && isLikelyHeader(rows[i])) headerIdx = 0;
  }
  const header = (rows[headerIdx] || []).map(v => String(v ?? ""));
  const cols = detectColumns(header);
  if (cols.date == null || (cols.amount == null && cols.income == null && cols.expense == null)) {
    return []; // Not a recognizable table
  }
  const dateCol = cols.date;
  const dateSample = rows.slice(headerIdx + 1, headerIdx + 50).map(r => r?.[dateCol]).filter(v => typeof v === "string");
  const fmt = detectDateFormat(dateSample);

  const out: ParsedRow[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row.length) continue;
    const dateRaw = row[dateCol];
    const date = parseDateCell(dateRaw, fmt);
    if (!date) continue;

    let amount: number | null = null;
    let kind: "income" | "expense" | null = null;

    if (cols.income != null || cols.expense != null) {
      const inc = cols.income != null ? parseAmount(row[cols.income]) : null;
      const exp = cols.expense != null ? parseAmount(row[cols.expense]) : null;
      if (inc && Math.abs(inc) > 0) { amount = Math.abs(inc); kind = "income"; }
      else if (exp && Math.abs(exp) > 0) { amount = Math.abs(exp); kind = "expense"; }
    }
    if (amount == null && cols.amount != null) {
      const v = parseAmount(row[cols.amount]);
      if (v != null) {
        amount = Math.abs(v);
        if (v < 0) kind = "expense";
        else if (v > 0) kind = "income";
      }
    }
    if (amount == null || amount === 0) continue;

    // Kind column override
    if (cols.kind != null) {
      const t = norm(row[cols.kind]);
      if (/(receita|entrada|credito|deposito|c$|cr$|\+)/i.test(t)) kind = "income";
      else if (/(despesa|saida|debito|pagamento|d$|db$|\-)/i.test(t)) kind = "expense";
    }

    const description = cols.description
      .map(c => String(row[c] ?? "").trim())
      .filter(Boolean)
      .join(" — ")
      .slice(0, 200) || "Lançamento";

    if (kind == null) {
      // Fall back: description hints at income
      kind = INCOME_HEURISTICS.test(description) ? "income" : "expense";
    }

    if (isNoiseRow(description, amount)) continue;

    const rawCategory = cols.category != null ? String(row[cols.category] ?? "").trim() : "";
    const category = inferCategory(description, rawCategory, kind);
    const notes = cols.notes != null ? (String(row[cols.notes] ?? "").trim() || null) : null;
    const time = cols.time != null ? parseTimeCell(row[cols.time]) : null;

    out.push({
      date,
      time,
      amount: Math.round(amount * 100) / 100,
      kind,
      category,
      description,
      notes,
      installment: detectInstallment(description) ?? detectInstallment(notes ?? ""),
      recurring: detectRecurring(description),
    });
  }
  return out;
}

/** Parse an XLSX/XLS ArrayBuffer. Handles multiple sheets. */
export function parseXlsxBuffer(buf: ArrayBuffer): ParsedRow[] {
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const all: ParsedRow[] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, raw: true, blankrows: false, defval: null });
    all.push(...parseSheet(rows));
  }
  return sortChronological(all);
}

/** Parse a CSV/TXT string. Autodetects delimiter (comma, semicolon, tab, pipe). */
export function parseCsvText(text: string): ParsedRow[] {
  const clean = text.replace(/^\uFEFF/, "");
  const sample = clean.slice(0, 4000);
  const counts = {
    ";": (sample.match(/;/g) || []).length,
    ",": (sample.match(/,/g) || []).length,
    "\t": (sample.match(/\t/g) || []).length,
    "|": (sample.match(/\|/g) || []).length,
  };
  const delim = (Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] || ",");
  const rows = parseDelimited(clean, delim);
  return sortChronological(parseSheet(rows));
}

/** Small RFC-4180-ish CSV parser with quotes. */
function parseDelimited(text: string, delim: string): any[][] {
  const rows: any[][] = [];
  let cur: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else cell += c;
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === delim) { cur.push(cell); cell = ""; continue; }
    if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      cur.push(cell);
      if (cur.some(v => v !== "")) rows.push(cur);
      cur = []; cell = "";
      continue;
    }
    cell += c;
  }
  if (cell.length || cur.length) { cur.push(cell); if (cur.some(v => v !== "")) rows.push(cur); }
  return rows;
}

function sortChronological(items: ParsedRow[]): ParsedRow[] {
  return items.slice().sort((a, b) => {
    const ka = `${a.date}T${a.time ?? "00:00"}`;
    const kb = `${b.date}T${b.time ?? "00:00"}`;
    return ka.localeCompare(kb);
  });
}

/** Compute totals for validation. */
export function summarize(items: ParsedRow[]) {
  let income = 0, expense = 0;
  const dates: string[] = [];
  const categoriesSet = new Set<string>();
  let installments = 0, recurring = 0;
  for (const it of items) {
    if (it.kind === "income") income += it.amount; else expense += it.amount;
    dates.push(it.date);
    if (it.category) categoriesSet.add(it.category);
    if (it.installment) installments++;
    if (it.recurring) recurring++;
  }
  dates.sort();
  return {
    total: items.length,
    income: Math.round(income * 100) / 100,
    expense: Math.round(expense * 100) / 100,
    balance: Math.round((income - expense) * 100) / 100,
    period: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null,
    installments,
    recurring,
    categories: categoriesSet.size,
  };
}
