// ===== PIPELINE DE DOCUMENTOS (PDF/comprovantes) =====
// Download -> validação (magic bytes) -> extração de texto (unpdf) -> hash.
// Roda no Worker (pure JS, sem binários nativos).

export type FetchedDoc = {
  bytes: Uint8Array;
  size: number;
  mime: string;
  hash: string;
  isPdf: boolean;
};

export function mediaBytesToDataUrl(bytes: Uint8Array, mime: string): string {
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

function sniffMime(bytes: Uint8Array, fallback?: string): string {
  const b = bytes;
  if (b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "application/pdf";
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 12 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return (fallback && fallback !== "application/octet-stream" ? fallback : "application/octet-stream");
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Baixa o documento com 1 retry. Lança DOC_FETCH_FAILED_* / DOC_TOO_LARGE / DOC_EMPTY. */
export async function fetchDocument(url: string, hintMime?: string): Promise<FetchedDoc> {
  let lastStatus = 0;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      console.log(`[doc] download start attempt=${attempt} url=${url.slice(0, 120)}`);
      const res = await fetch(url);
      lastStatus = res.status;
      if (!res.ok) {
        if (attempt === 2) throw new Error(`DOC_FETCH_FAILED_${res.status}`);
        continue;
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength === 0) throw new Error("DOC_EMPTY");
      if (bytes.byteLength > 18 * 1024 * 1024) throw new Error("DOC_TOO_LARGE");
      const headerMime = res.headers.get("content-type")?.split(";")[0]?.trim();
      const mime = sniffMime(bytes, hintMime || headerMime || undefined);
      const hash = await sha256Hex(bytes);
      console.log(`[doc] download done size=${bytes.byteLength} mime=${mime} hash=${hash.slice(0, 12)}`);
      return { bytes, size: bytes.byteLength, mime, hash, isPdf: mime === "application/pdf" };
    } catch (e: any) {
      const msg = String(e?.message ?? "");
      if (msg === "DOC_TOO_LARGE" || msg === "DOC_EMPTY") throw e;
      if (attempt === 2) throw new Error(msg.startsWith("DOC_") ? msg : `DOC_FETCH_FAILED_${lastStatus || "NETWORK"}`);
    }
  }
  throw new Error("DOC_FETCH_FAILED_UNKNOWN");
}

/** Extrai o texto de um PDF. Retorna string vazia quando o PDF é só imagem (escaneado). */
export async function extractPdfText(bytes: Uint8Array): Promise<{ text: string; pages: number }> {
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text, totalPages } = await extractText(pdf, { mergePages: true });
    const clean = (Array.isArray(text) ? text.join("\n") : String(text ?? ""))
      .replace(/\u0000/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    console.log(`[doc] pdf text extracted pages=${totalPages} chars=${clean.length}`);
    return { text: clean, pages: totalPages ?? 0 };
  } catch (e: any) {
    console.warn("[doc] pdf text extraction failed", e?.message ?? e);
    return { text: "", pages: 0 };
  }
}

// ===== TIPOS DE DOCUMENTO SUPORTADOS =====
// PDF e imagem são detectados por magic bytes (sniffMime, acima). Planilha,
// Word, CSV e TXT não têm assinatura binária própria confiável (xlsx/docx são
// ambos ZIP por dentro) — por isso combinamos nome/mimetype informados pelo
// WhatsApp com uma espiada no conteúdo do ZIP quando necessário.
export type DocKind = "pdf" | "image" | "xlsx" | "docx" | "csv" | "txt" | "unknown";

function isZipSignature(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07);
}

/** Decide o tipo real do documento já baixado, combinando magic bytes + nome/mimetype do WhatsApp. */
export async function resolveDocKind(fetched: FetchedDoc, name?: string, hintMime?: string): Promise<DocKind> {
  if (fetched.isPdf) return "pdf";
  if (fetched.mime.startsWith("image/")) return "image";
  const n = (name ?? "").toLowerCase();
  const m = (hintMime ?? "").toLowerCase();
  if (n.endsWith(".xlsx") || n.endsWith(".xls") || m.includes("spreadsheet") || m.includes("ms-excel")) return "xlsx";
  if (n.endsWith(".docx") || m.includes("wordprocessingml.document")) return "docx";
  if (n.endsWith(".csv") || m.includes("csv")) return "csv";
  if (n.endsWith(".txt") || m === "text/plain") return "txt";
  if (isZipSignature(fetched.bytes)) {
    // ZIP sem pista clara no nome/mimetype (ex.: instância mandou só "documento"):
    // olha os nomes internos para diferenciar planilha (xl/) de Word (word/).
    try {
      const { unzipSync } = await import("fflate");
      const names = Object.keys(unzipSync(fetched.bytes));
      if (names.some((x) => x.startsWith("xl/"))) return "xlsx";
      if (names.some((x) => x.startsWith("word/"))) return "docx";
    } catch (e: any) {
      console.warn("[doc] zip probe failed", e?.message ?? e);
    }
  }
  return "unknown";
}

/** Extrai texto de uma planilha (.xlsx/.xls) — todas as abas, em formato CSV. */
export async function extractXlsxText(bytes: Uint8Array): Promise<string> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(bytes, { type: "array" });
  const parts: string[] = [];
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false }).trim();
    if (csv) parts.push(`== Planilha: ${sheetName} ==\n${csv}`);
  }
  const text = parts.join("\n\n").trim();
  console.log(`[doc] xlsx text extracted sheets=${wb.SheetNames.length} chars=${text.length}`);
  return text;
}

/** Extrai o texto de um documento Word (.docx) lendo diretamente word/document.xml dentro do ZIP. */
export async function extractDocxText(bytes: Uint8Array): Promise<string> {
  const { unzipSync, strFromU8 } = await import("fflate");
  const files = unzipSync(bytes);
  const xmlBytes = files["word/document.xml"];
  if (!xmlBytes) return "";
  const raw = strFromU8(xmlBytes);
  const text = raw
    .replace(/<\/w:p>/g, "\n")
    .replace(/<w:tab\s*\/?>/g, "\t")
    .replace(/<w:br\s*\/?>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  console.log(`[doc] docx text extracted chars=${text.length}`);
  return text;
}

/** Decodifica bytes como texto simples (CSV/TXT). */
export function extractPlainText(bytes: Uint8Array): string {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes).replace(/\x00/g, " ").trim();
  console.log(`[doc] plain text decoded chars=${text.length}`);
  return text;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

/** OCR multimodal para PDFs escaneados. Executado somente quando o PDF não possui texto útil. */
export async function extractScannedPdfText(
  bytes: Uint8Array,
  filename = "documento.pdf",
): Promise<string> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("DOC_OCR_UNAVAILABLE");
  console.log("[doc] ocr start", { filename, size: bytes.byteLength });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Lovable-API-Key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3.6-flash",
        messages: [{
          role: "user",
          content: [
            {
              type: "text",
              text: "Faça OCR de todas as páginas deste PDF. Retorne somente o texto integral visível, preservando linhas, valores, datas, nomes, instituições e identificadores. Não resuma e não invente.",
            },
            {
              type: "file",
              file: { filename, file_data: `data:application/pdf;base64,${bytesToBase64(bytes)}` },
            },
          ],
        }],
        temperature: 0,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      console.error("[doc] ocr failed", { status: res.status, detail });
      throw new Error(`DOC_OCR_FAILED_${res.status}`);
    }
    const data = await res.json() as any;
    const text = String(data?.choices?.[0]?.message?.content ?? "")
      .replace(/\u0000/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (!hasUsefulText(text)) throw new Error("DOC_OCR_FAILED_EMPTY");
    console.log("[doc] ocr done", { chars: text.length });
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * OCR de comprovantes/notas enviados como IMAGEM (inclusive quando chegam pelo
 * WhatsApp como "documento"). Mesmo pipeline usado para PDFs escaneados.
 */
export async function extractImageText(bytes: Uint8Array, mime: string): Promise<string> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("DOC_OCR_UNAVAILABLE");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Lovable-API-Key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3.6-flash",
        messages: [{
          role: "user",
          content: [
            {
              type: "text",
              text: "Faça OCR desta imagem. Retorne somente o texto integral visível, preservando linhas, rótulos, valores (incluindo VALOR TOTAL), datas, horas, estabelecimento e identificadores. Não resuma e não invente.",
            },
            { type: "image_url", image_url: { url: mediaBytesToDataUrl(bytes, mime) } },
          ],
        }],
        temperature: 0,
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`DOC_OCR_FAILED_${res.status}`);
    const data = await res.json() as any;
    return String(data?.choices?.[0]?.message?.content ?? "").replace(/\u0000/g, " ").trim();
  } finally {
    clearTimeout(timeout);
  }
}

/** Heurística: o texto extraído é suficiente para interpretar? */
export function hasUsefulText(text: string): boolean {
  return text.replace(/\s+/g, "").length >= 40;
}

/** Identificador da operação (Pix/TED) dentro do texto do comprovante. */
export function extractOperationId(text: string): string | null {
  const patterns = [
    /(?:id|identificador|c[oó]digo)\s*(?:da)?\s*(?:transa[cç][aã]o|opera[cç][aã]o|autentica[cç][aã]o|e2e)?\s*[:#]?\s*([A-Za-z0-9]{12,})/i,
    /\bE\d{8,}[A-Za-z0-9]{6,}\b/,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return (m[1] ?? m[0]).slice(0, 80);
  }
  return null;
}

// ===== PRIORIDADE DOS DADOS DO COMPROVANTE =====
// O valor impresso no comprovante é a FONTE OFICIAL da transação. Estes
// extratores rodam antes da IA para montar um objeto estruturado
// { attachment: { amount, date, institution }, user_message } — evitando
// que a IA reaproveite valores de mensagens anteriores.

function toNumberBR(raw: string): number | null {
  const s = raw.replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

/** Rótulos que NUNCA representam o valor da transação. */
const NON_TOTAL_LABEL = /(troco|sub\s*-?\s*total|subtotal|desconto|acr[eé]scimo|juros|multa|dinheiro\s+recebido|valor\s+recebido\s+em\s+dinheiro|saldo|limite|economia|frete\s+gr[aá]tis|unit[aá]rio|qtd)/i;

/** Rótulo INEQUÍVOCO de total da compra — nunca é uma forma de pagamento parcial. */
const STRONG_TOTAL_LABEL = /(valor\s*total|total\s*a\s*pagar|total\s*geral|total\s*da\s*(nota|compra|venda)|vl\s*total)/i;

/**
 * Rótulo AMBÍGUO: "total"/"valor pago" bare também aparece em linhas de
 * DETALHAMENTO de forma de pagamento ("Valor Pago em Dinheiro: R$120,00"),
 * que não é o total da compra — é só uma fatia dele.
 */
const WEAK_TOTAL_LABEL = /(valor\s*pago|valor\s*do\s*pix|valor\s*da\s*transa[cç][aã]o|total)/i;

/**
 * Linha de detalhamento de FORMA DE PAGAMENTO (dinheiro/pix/cartão/cheque).
 * Um valor nessa linha é uma PARTE do pagamento, nunca o total da compra.
 * Bug real: nota com "VALOR TOTAL: R$472,93" seguida de um detalhamento
 * "Dinheiro: R$120,00 / PIX: R$352,93" registrou R$120 — a linha de
 * detalhamento batia num rótulo ambíguo de total e "última ocorrência
 * vence" sobrescreveu o valor certo.
 */
const PAYMENT_METHOD_LABEL = /(forma\s+de\s+pagamento|em\s+dinheiro|em\s+esp[eé]cie|no\s+pix|via\s+pix|do\s+pix|no\s+cart[aã]o|cart[aã]o\s+de\s+(cr[eé]dito|d[eé]bito)|\bpix\s*:|\bdinheiro\s*:|\bcr[eé]dito\s*:|\bd[eé]bito\s*:|\bcheque\b)/i;

/** Valor OFICIAL do comprovante/nota. Sempre o VALOR TOTAL — nunca subtotal/troco/forma de pagamento parcial. */
export function extractReceiptAmount(text: string): number | null {
  if (!text) return null;
  const money = /R?\$?\s*([\d.]{1,12},\d{2})/;
  const lines = text.split(/\r?\n/);

  // 1) Rótulo inequívoco de total (última ocorrência vence — notas fiscais
  //    repetem "TOTAL" e o valor final impresso costuma ser o certo).
  let strong: number | null = null;
  for (const line of lines) {
    if (!STRONG_TOTAL_LABEL.test(line) || NON_TOTAL_LABEL.test(line)) continue;
    const m = line.match(money);
    const n = m?.[1] ? toNumberBR(m[1]) : null;
    if (n) strong = n;
  }
  if (strong) return strong;

  // 2) Rótulo ambíguo ("total"/"valor pago" bare) — uma linha que também é
  //    detalhamento de forma de pagamento (dinheiro/pix/cartão) NUNCA vira o
  //    total; só é considerada como candidata a soma no passo 3.
  let weak: number | null = null;
  const paymentLines: number[] = [];
  for (const line of lines) {
    if (NON_TOTAL_LABEL.test(line) || !WEAK_TOTAL_LABEL.test(line)) continue;
    const m = line.match(money);
    const n = m?.[1] ? toNumberBR(m[1]) : null;
    if (!n) continue;
    if (PAYMENT_METHOD_LABEL.test(line)) paymentLines.push(n);
    else weak = n;
  }
  if (weak) return weak;

  // 3) Sem total explícito, mas com ≥2 linhas de forma de pagamento
  //    (dinheiro + pix + cartão...): soma como validação/reconstrução do total.
  if (paymentLines.length >= 2) {
    const sum = Math.round(paymentLines.reduce((a, b) => a + b, 0) * 100) / 100;
    if (sum > 0) return sum;
  }

  // 4) Rótulo e valor em linhas diferentes (layout de comprovantes PIX).
  const inline = text.match(/(?:valor\s*(?:total|pago)?|total)\s*[:\-]?\s*(?:R\$)?\s*([\d.]{1,12},\d{2})/i);
  const inlineN = inline?.[1] ? toNumberBR(inline[1]) : null;
  if (inlineN) return inlineN;

  // 5) Sem rótulo: só aceita quando há um único valor monetário no documento.
  const all = Array.from(text.matchAll(/R\$\s*([\d.]{1,12},\d{2})/g))
    .map((m) => toNumberBR(m[1]!))
    .filter((n): n is number => n !== null);
  if (all.length === 1) return all[0]!;
  return null;
}

/** Data impressa no comprovante (dd/mm/aaaa, dd/mm/aa ou aaaa-mm-dd). */
export function extractReceiptDate(text: string): string | null {
  if (!text) return null;
  const labeled = text.match(
    /(?:data(?:\s*(?:e\s*hora|da\s*(?:opera[cç][aã]o|transa[cç][aã]o|emiss[aã]o|compra|venda)))?)\s*[:\-]?\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/i,
  );
  if (labeled?.[1]) return labeled[1].replace(/[-.]/g, "/");
  const br = text.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})\b/);
  if (br) return `${br[1]!.padStart(2, "0")}/${br[2]!.padStart(2, "0")}/${br[3]}`;
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  const br2 = text.match(/\b(\d{2})[\/\-.](\d{2})[\/\-.](\d{2})\b/);
  if (br2) return `${br2[1]}/${br2[2]}/20${br2[3]}`;
  return null;
}

/** Instituição financeira citada no comprovante. */
export function extractInstitution(text: string): string | null {
  const banks = [
    "PicPay", "Nubank", "Mercado Pago", "Banco Inter", "Inter", "Itaú", "Itau", "Bradesco",
    "Santander", "Caixa", "Banco do Brasil", "Sicredi", "Sicoob", "C6 Bank", "C6", "Neon",
    "BTG", "XP", "PagBank", "PagSeguro", "Will Bank", "Original", "Safra", "Banrisul",
  ];
  for (const b of banks) {
    if (new RegExp(`\\b${b.replace(/ /g, "\\s+")}\\b`, "i").test(text)) return b;
  }
  return null;
}
