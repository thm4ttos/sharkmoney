// SERVER-ONLY. Executores de intents detectadas pela OpenAI no fluxo do WhatsApp.
// Mensagens humanizadas, premium, sempre incluindo contexto (saldo atual, dicas).
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { CATEGORIES } from "./ai-classify.server";
import { extractDateHintSP, stripDateHint } from "./datetime";
import { writeVerifiedTransaction, type PersistedTransaction } from "./transaction-ledger.server";
import { pickReply, pickReplySync, maybeDashboardLink } from "./wa-replies";
import { billInstallmentInfo, nextDueFromDaySP, formatYMDBr, type BillInstallmentPatch } from "./bill-installments";
import { ptNumberWordsToDigits, parseMoneyAmount, parseMoneyToken, MONEY_TOKEN_PATTERN } from "@/lib/money-speech";


// Lookup rápido do phone do usuário para variar respostas sem repetir.
async function phoneOf(userId: string): Promise<string | null> {
  try {
    const { data } = await supabaseAdmin
      .from("profiles").select("phone").eq("id", userId).maybeSingle();
    return (data?.phone as string | null) ?? null;
  } catch { return null; }
}


const BRL = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });

const TZ = "America/Sao_Paulo";

function formatDatePT(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const date = new Intl.DateTimeFormat("pt-BR", {
    timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric",
  }).format(d);
  const time = new Intl.DateTimeFormat("pt-BR", {
    timeZone: TZ, hour: "2-digit", minute: "2-digit",
  }).format(d);
  return `${date} às ${time}`;
}

function normalizeAppointmentTitle(title: string): string {
  return (title ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(compromisso|lembrete|agenda|agendar|marcar|anotar|reuniao|consulta)\b/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function appointmentTitlesSimilar(a: string, b: string): boolean {
  const na = normalizeAppointmentTitle(a);
  const nb = normalizeAppointmentTitle(b);
  if (!na || !nb) return false;
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;
  const aw = new Set(na.split(" ").filter((w) => w.length > 2));
  const bw = nb.split(" ").filter((w) => w.length > 2);
  if (aw.size === 0 || bw.length === 0) return false;
  const hits = bw.filter((w) => aw.has(w)).length;
  return hits >= Math.min(2, Math.max(1, Math.ceil(Math.min(aw.size, bw.length) * 0.6)));
}

// Data-only (sem hora) — usada nas confirmações de lançamento pra deixar
// a mensagem mais limpa (respostas humanizadas do Abio v1).
function formatDateOnlyPT(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric",
  }).format(d);
}

// Emoji por categoria — deixa mensagens contextuais
const CAT_EMOJI: Record<string, string> = {
  Moradia: "🏠",
  Alimentação: "🍔",
  Transporte: "⛽",
  Saúde: "💊",
  Educação: "🎓",
  Lazer: "🎉",
  Pessoal: "🧴",
  Investimentos: "📈",
  "Vida Espiritual": "🙏",
  "Empresa e Autônomo": "💼",
  Outros: "🛒",
  Receita: "💰",
};

const CAT_TIP: Record<string, string> = {
  Alimentação: "Mercado costuma pesar — vale acompanhar semanalmente. 🍴",
  Transporte: "Combustível costuma ser uma das maiores despesas. Acompanhe essa categoria. ⛽",
  Moradia: "Aluguel e contas fixas: registre todo mês pra ter visão real. 🏠",
  Lazer: "Lazer faz bem ao bolso quando entra no orçamento. 🎯",
  Saúde: "Saúde é investimento — vale separar uma reserva. 💚",
  Educação: "Investir em estudos rende sempre. 📚",
};

// ===== Saldo helper (histórico completo) =====
// Usa a MESMA função do banco que o painel (public.finance_snapshot), então o
// saldo do WhatsApp é, por construção, idêntico ao saldo do site.
async function getCurrentBalance(userId: string): Promise<{ income: number; expense: number; balance: number }> {
  const { fetchFinanceSnapshot } = await import("@/lib/finance-snapshot.server");
  const snap = await fetchFinanceSnapshot(supabaseAdmin, userId);
  return { income: snap.income, expense: snap.expense, balance: snap.balance };
}

// ===== Saldo do MÊS ATUAL =====
// Regra: toda confirmação de lançamento e a resposta padrão de "saldo" usam o
// saldo do mês corrente. O saldo histórico/total só aparece quando o usuário
// pede explicitamente ("saldo geral", "saldo total", "desde o início").
export async function getMonthBalance(userId: string): Promise<{ income: number; expense: number; balance: number }> {
  const { fetchFinanceSnapshot } = await import("@/lib/finance-snapshot.server");
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 3, 0, 0)).toISOString();
  const snap = await fetchFinanceSnapshot(supabaseAdmin, userId, { from });
  return { income: snap.income, expense: snap.expense, balance: snap.balance };
}

/** true quando o usuário pediu explicitamente o saldo histórico/total. */
export function wantsLifetimeBalance(text: string): boolean {
  const t = (text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return /\bsaldo\s+(geral|total|acumulado|hist[oó]rico)\b/.test(t) ||
    /\bhist[oó]rico\s+completo\b/.test(t) ||
    /\bdesde\s+o\s+in[ií]cio\b/.test(t) ||
    /\btotal\s+(geral|acumulado)\b/.test(t);
}



// ===== Expense =====
const ExpenseSchema = z.object({
  amount: z.number().positive().max(1_000_000),
  category: z.string().min(1).max(60).optional(),
  description: z.string().max(280).optional(),
  occurred_at: z.string().optional(),
});

// ===== Idempotency context (per-inbound-message) =====
// AsyncLocalStorage lets recordExpense/recordIncome and processBulk know which
// WhatsApp message row (whatsapp_messages.id) is currently being processed —
// without threading the id through every call site. Every transaction created
// in that context is stamped with `source_message_id`, protected by a UNIQUE
// index. If the same inbound message is ever reprocessed (webhook retry,
// watchdog, worker crash, reconnect), the second INSERT hits the unique
// violation and we treat it as an already-processed duplicate.
import { AsyncLocalStorage } from "node:async_hooks";

type SourceMsgCtx = { messageId: string; origin: "whatsapp" | "site" | "import" | "api"; consumed?: boolean };
const sourceMessageStore = new AsyncLocalStorage<SourceMsgCtx>();

export function setCurrentSourceMessage(ctx: SourceMsgCtx | null) {
  if (ctx) sourceMessageStore.enterWith(ctx);
}
/** Returns the id and marks it as consumed so subsequent inserts (bulk items 2..N) don't reuse it. */
export function getCurrentSourceMessageId(): string | null {
  const store = sourceMessageStore.getStore();
  if (!store || store.consumed) return null;
  store.consumed = true;
  return store.messageId;
}
/** Look up the current source message id without consuming it (for read-only checks). */
export function peekCurrentSourceMessageId(): string | null {
  return sourceMessageStore.getStore()?.messageId ?? null;
}
export async function runWithSourceMessage<T>(ctx: SourceMsgCtx, fn: () => Promise<T>): Promise<T> {
  return sourceMessageStore.run({ ...ctx, consumed: false }, fn);
}


function isUniqueSourceMessageViolation(err: any): boolean {
  if (!err) return false;
  const code = (err as any).code;
  const msg = String((err as any).message ?? "");
  return code === "23505" && /uq_transactions_source_message_id|source_message_id/.test(msg);
}


// Detecta duplicidade por conteúdo nos últimos 30s (mesmo usuário+kind+amount,
// descrição opcionalmente igual). Evita lançamento duplicado quando a Z-API
// reenvia o webhook com message_id diferente, ou quando a IA reprocessa item.
async function findRecentDuplicate(
  userId: string,
  kind: "expense" | "income",
  amount: number,
  description?: string | null,
  category?: string | null,
): Promise<{ id: string } | null> {
  const sinceISO = new Date(Date.now() - 60_000).toISOString();
  const { data } = await supabaseAdmin
    .from("transactions")
    .select("id, description, category")
    .eq("user_id", userId)
    .eq("kind", kind)
    .eq("amount", amount)
    .eq("source", "whatsapp")
    .gte("created_at", sinceISO)
    .order("created_at", { ascending: false })
    .limit(10);
  if (!data || data.length === 0) return null;
  const desc = (description ?? "").trim().toLowerCase();
  const cat = (category ?? "").trim();
  const exact = data.find((r: any) =>
    ((r.description ?? "").trim().toLowerCase()) === desc &&
    ((r.category ?? "").trim()) === cat,
  );
  return exact ?? null;
}

async function logDuplicate(opts: {
  userId: string;
  reason: string;
  kind: "expense" | "income";
  amount: number;
  description?: string | null;
  matchedTxId?: string | null;
}) {
  try {
    // phone pode vir do contexto; aqui só registramos o que sabemos.
    const { data: prof } = await supabaseAdmin
      .from("profiles").select("phone").eq("id", opts.userId).maybeSingle();
    await supabaseAdmin.from("wa_duplicate_log").insert({
      user_id: opts.userId,
      phone: (prof as any)?.phone ?? "",
      reason: opts.reason,
      content: opts.description ?? null,
      amount: opts.amount,
      kind: opts.kind,
      matched_transaction_id: opts.matchedTxId ?? null,
    });
  } catch (e) { console.error("[actions] logDuplicate", e); }
}

export async function recordExpense(
  userId: string,
  input: { amount?: number; category?: string; description?: string; occurred_at?: string; credit_card_hint?: string | null },
): Promise<{ replyText: string; ok: boolean; row?: PersistedTransaction; duplicate?: boolean }> {
  const parsed = ExpenseSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, replyText: "Hmm, não captei o valor 🤔\nPode mandar de novo? Exemplo:\n• _gastei 50 no mercado_" };
  }
  const data = parsed.data;
  const inferredCategory = inferCategoryFromText(`${data.description ?? ""} ${data.category ?? ""}`);
  const category = inferredCategory !== "Outros"
    ? inferredCategory
    : (data.category && data.category !== "Outros" ? data.category.trim().slice(0, 60) : "Outros");

  const dup = await findRecentDuplicate(userId, "expense", data.amount, data.description, category);
  if (dup) {
    await logDuplicate({ userId, reason: "duplicate_content_60s", kind: "expense", amount: data.amount, description: data.description, matchedTxId: dup.id });
    return { ok: true, duplicate: true, replyText: "Esse lançamento já foi registrado." };
  }

  // "no cartão X" / "no crédito" — vincula a despesa à fatura certa sem
  // precisar de uma etapa separada. Sem hint nenhum e mais de um cartão
  // cadastrado, não adivinha: fica sem cartão (o usuário sempre pode contar
  // depois via correção).
  let creditCardId: string | null = null;
  if (input.credit_card_hint) {
    const card = await findCreditCardByHint(userId, input.credit_card_hint);
    if (card) creditCardId = card.id;
  }

  const currentSourceMessageId = getCurrentSourceMessageId();
  let row: PersistedTransaction;
  try {
    row = await writeVerifiedTransaction(supabaseAdmin, {
      userId, kind: "expense", amount: data.amount, category,
      description: data.description ?? null,
      occurredAt: data.occurred_at ?? new Date().toISOString(),
      source: "whatsapp", sourceMessageId: currentSourceMessageId,
      creditCardId,
    });
  } catch (error: any) {
    if (isUniqueSourceMessageViolation(error)) {
      await logDuplicate({ userId, reason: "duplicate_source_message", kind: "expense", amount: data.amount, description: data.description });
      return { ok: true, duplicate: true, replyText: "Esse lançamento já foi registrado." };
    }
    if (typeof error.message === "string" && error.message.includes("ABIO_DUPLICATE_TX")) {
      await logDuplicate({ userId, reason: "duplicate_trigger_60s", kind: "expense", amount: data.amount, description: data.description });
      return { ok: true, duplicate: true, replyText: "Esse lançamento já foi registrado." };
    }

    console.error("[actions] recordExpense", error);
    return { ok: false, replyText: "Ocorreu um erro interno e o gasto não foi confirmado. Tente novamente em instantes." };
  }
  const emoji = CAT_EMOJI[category] ?? "🛒";
  const descLine = `${emoji} ${data.description || category}`;
  const phone = await phoneOf(userId);
  const header = await pickReply("expense_header", phone);
  const linkBlock = await maybeDashboardLink(phone);
  // Contexto conversacional 30-min (Goal D) — permite correções encadeadas
  // ("era combustível", "foi ontem") acharem o último lançamento sem query nova.
  try {
    const { writeConversationContext } = await import("./ai-confidence.server");
    void writeConversationContext(userId, {
      last_transaction_id: row.id ?? null,
      last_intent: "expense",
      last_amount: data.amount,
      last_category: category,
    });
  } catch {}
  const monthBal = await getMonthBalance(userId);
  return {
    ok: true,
    row,
    replyText:
// Confirmação curta: descrição, valor, categoria e saldo do MÊS ATUAL.
`${header}

${descLine}
💸 ${BRL(data.amount)}
🏷️ ${category}
💰 Saldo do mês: *${BRL(monthBal.balance)}*${linkBlock}`,

  };
}

// ===== Income =====
const IncomeSchema = z.object({
  amount: z.number().positive().max(1_000_000),
  description: z.string().max(280).optional(),
  occurred_at: z.string().optional(),
});

export async function recordIncome(
  userId: string,
  input: { amount?: number; description?: string; occurred_at?: string },
): Promise<{ replyText: string; ok: boolean; row?: PersistedTransaction; duplicate?: boolean }> {
  const parsed = IncomeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, replyText: "Não captei o valor da receita 🤔\nExemplo: _recebi 2000_" };
  }
  const { amount, description, occurred_at } = parsed.data;

  const dup = await findRecentDuplicate(userId, "income", amount, description, "Receita");
  if (dup) {
    await logDuplicate({ userId, reason: "duplicate_content_60s", kind: "income", amount, description, matchedTxId: dup.id });
    return { ok: true, duplicate: true, replyText: "Esse lançamento já foi registrado." };
  }

  const currentSourceMessageId = getCurrentSourceMessageId();
  let row: PersistedTransaction;
  try {
    row = await writeVerifiedTransaction(supabaseAdmin, {
      userId, kind: "income", amount, category: "Receita",
      description: description ?? null,
      occurredAt: occurred_at ?? new Date().toISOString(),
      source: "whatsapp", sourceMessageId: currentSourceMessageId,
    });
  } catch (error: any) {
    if (isUniqueSourceMessageViolation(error)) {
      await logDuplicate({ userId, reason: "duplicate_source_message", kind: "income", amount, description });
      return { ok: true, duplicate: true, replyText: "Esse lançamento já foi registrado." };
    }
    if (typeof error.message === "string" && error.message.includes("ABIO_DUPLICATE_TX")) {
      await logDuplicate({ userId, reason: "duplicate_trigger_60s", kind: "income", amount, description });

      return { ok: true, duplicate: true, replyText: "Esse lançamento já foi registrado." };
    }
    console.error("[actions] recordIncome", error);
    return { ok: false, replyText: "Ocorreu um erro interno e a receita não foi confirmada. Tente novamente em instantes." };
  }
  const descLine = `💼 ${description || "Receita"}`;
  const phone = await phoneOf(userId);
  const header = await pickReply("income_header", phone);
  const linkBlock = await maybeDashboardLink(phone);
  try {
    const { writeConversationContext } = await import("./ai-confidence.server");
    void writeConversationContext(userId, {
      last_transaction_id: row.id ?? null,
      last_intent: "income",
      last_amount: amount,
      last_category: "Receita",
    });
  } catch {}
  const monthBalIn = await getMonthBalance(userId);
  return {
    ok: true,
    row,
    replyText:
`${header}

${descLine}
💰 ${BRL(amount)}
🏷️ Receita
💰 Saldo do mês: *${BRL(monthBalIn.balance)}*${linkBlock}`,



  };
}


// ===== Appointment =====
const ApptSchema = z.object({
  title: z.string().min(1).max(140),
  scheduled_at: z.string().min(1),
  notes: z.string().max(500).optional(),
});

export async function recordAppointment(
  userId: string,
  input: { title?: string; scheduled_at?: string; notes?: string; confidence?: number | null; source_text?: string | null; source?: string },
): Promise<{ replyText: string; row?: { id: string } }> {
  const parsed = ApptSchema.safeParse({ title: input.title, scheduled_at: input.scheduled_at, notes: input.notes });
  if (!parsed.success || isNaN(new Date(parsed.data.scheduled_at).getTime())) {
    console.log("[commitment-parser] recordAppointment REJECTED", {
      title: input.title, scheduled_at: input.scheduled_at, source: input.source ?? null,
      source_text: input.source_text ?? null, zodError: parsed.success ? null : parsed.error.flatten(),
    });
    return { replyText: "Pra agendar preciso do que é e quando 🗓️" };
  }
  const { title, scheduled_at } = parsed.data;
  const when = new Date(scheduled_at);
  const windowStart = new Date(when.getTime() - 15 * 60 * 1000).toISOString();
  const windowEnd = new Date(when.getTime() + 15 * 60 * 1000).toISOString();
  const { data: existing } = await supabaseAdmin
    .from("appointments")
    .select("id, title, scheduled_at, status")
    .eq("user_id", userId)
    .gte("scheduled_at", windowStart)
    .lte("scheduled_at", windowEnd)
    .in("status", ["pending"])
    .limit(10);
  const duplicate = ((existing ?? []) as Array<{ title?: string | null; scheduled_at?: string | null }>).find((appt) =>
    appointmentTitlesSimilar(appt.title ?? "", title),
  );
  if (duplicate?.scheduled_at) {
    return {
      replyText:
`📌 Esse compromisso já estava na sua agenda.

📝 ${duplicate.title ?? title}
🕒 ${formatDatePT(duplicate.scheduled_at)}`,
    };
  }
  const { data: inserted, error } = await supabaseAdmin.from("appointments").insert({
    user_id: userId,
    title,
    scheduled_at,
    notes: parsed.data.notes ?? null,
    source: input.source ?? "whatsapp",
    ai_confidence: typeof input.confidence === "number" ? input.confidence : null,
    source_text: (input.source_text ?? "").slice(0, 500) || null,
  } as any).select("id").single();
  if (error) {
    console.error("[actions] recordAppointment", error);
    return { replyText: "Não consegui criar o compromisso 🙏." };
  }

  const header = await pickReply("appointment_header", await phoneOf(userId));
  const footer = pickReplySync("appointment_footer");
  return {
    row: inserted ? { id: inserted.id } : undefined,
    replyText:
`${header}

📝 ${title}
🕒 ${formatDatePT(scheduled_at)}

${footer}`,
  };
}

// ===== Queries =====
export async function queryBalance(userId: string, rawText?: string): Promise<{ replyText: string }> {
  // Padrão: saldo do MÊS ATUAL. Histórico completo só quando pedido explicitamente.
  if (rawText && wantsLifetimeBalance(rawText)) return buildReport(userId, { range: "all" });
  return buildReport(userId, { range: "month" });
}


export function openDashboardReply(): { replyText: string } {
  return {
    replyText:
`📊 Acesse seu painel do Abio

Pelo painel você pode acompanhar:

💰 Saldo atualizado
📈 Receitas e despesas
📅 Calendário financeiro
📊 Gráficos e relatórios
📋 Histórico completo
🔔 Contas fixas e lembretes
🎯 Metas financeiras

🌐 Acesse agora:
https://abio.fun

Caso ainda não tenha uma conta, clique em Criar conta e aproveite 7 dias gratuitos.`,
  };
}

type ReportRange =
  | "all" | "today" | "yesterday" | "week" | "last_week" | "last_7_days"
  | "last_30_days" | "month" | "last_month" | "year" | "custom";

export type ReportOpts = {
  range?: ReportRange;
  start?: string; // YYYY-MM-DD (inclusive)
  end?: string;   // YYYY-MM-DD (inclusive)
  label?: string;
};

function pad(n: number) { return String(n).padStart(2, "0"); }
/** "Agora" no fuso do usuário (America/Sao_Paulo), para cálculos de data. */
export function nowSP(): Date {
  const s = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(new Date());
  const [dpart, tpart] = s.replace(/,\s*/, "T").split("T");
  const d = new Date(`${dpart}T${(tpart || "00:00:00").replace("24:", "00:")}`);
  return isNaN(d.getTime()) ? new Date() : d;
}
/** Offset de São Paulo (sem horário de verão desde 2019). */
const SP_OFFSET = "-03:00";
function toISOStart(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T00:00:00.000${SP_OFFSET}`; }
function toISOEndInclusive(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T23:59:59.999${SP_OFFSET}`; }
function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

function computeRange(opts: ReportOpts): { since: string | null; until: string | null; label: string } {
  const range: ReportRange = opts.range ?? "all";
  const now = nowSP();

  if (opts.start || opts.end) {
    const s = opts.start ? new Date(`${opts.start}T00:00:00`) : null;
    const e = opts.end ? new Date(`${opts.end}T00:00:00`) : null;
    return {
      since: s ? toISOStart(s) : null,
      until: e ? toISOEndInclusive(e) : null,
      label: opts.label ?? "Período personalizado",
    };
  }
  switch (range) {
    case "all":
      return { since: null, until: null, label: opts.label ?? "Histórico completo" };
    case "today": {
      return { since: toISOStart(now), until: toISOEndInclusive(now), label: opts.label ?? "Hoje" };
    }
    case "yesterday": {
      const y = addDays(now, -1);
      return { since: toISOStart(y), until: toISOEndInclusive(y), label: opts.label ?? "Ontem" };
    }
    case "week": {
      const day = now.getDay();
      const diff = (day + 6) % 7;
      const start = addDays(now, -diff);
      return { since: toISOStart(start), until: toISOEndInclusive(now), label: opts.label ?? "Esta semana" };
    }
    case "last_week": {
      const day = now.getDay();
      const diff = (day + 6) % 7;
      const startThis = addDays(now, -diff);
      const endLast = addDays(startThis, -1);
      const startLast = addDays(endLast, -6);
      return { since: toISOStart(startLast), until: toISOEndInclusive(endLast), label: opts.label ?? "Semana passada" };
    }
    case "last_7_days":
      return { since: toISOStart(addDays(now, -6)), until: toISOEndInclusive(now), label: opts.label ?? "Últimos 7 dias" };
    case "last_30_days":
      return { since: toISOStart(addDays(now, -29)), until: toISOEndInclusive(now), label: opts.label ?? "Últimos 30 dias" };
    case "month": {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { since: toISOStart(start), until: toISOEndInclusive(now), label: opts.label ?? "Este mês" };
    }
    case "last_month": {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0);
      return { since: toISOStart(start), until: toISOEndInclusive(end), label: opts.label ?? "Mês passado" };
    }
    case "year": {
      const start = new Date(now.getFullYear(), 0, 1);
      return { since: toISOStart(start), until: toISOEndInclusive(now), label: opts.label ?? `${now.getFullYear()}` };
    }
    case "custom":
    default:
      return { since: null, until: null, label: opts.label ?? "Histórico completo" };
  }
}

// Aceita tanto a assinatura antiga (buildReport(userId, "month" | "week"))
// quanto a nova (buildReport(userId, { range, start, end, label })).
// Formato oficial: resumo consolidado (entradas, saídas, resultado, saldo atual).
export async function buildReport(
  userId: string,
  arg: ReportOpts | "month" | "week" | "all" = { range: "month" },
): Promise<{ replyText: string }> {
  const opts: ReportOpts = typeof arg === "string" ? { range: arg as ReportRange } : arg;
  return buildDetailedFinanceReport(userId, opts, {
    wantExpense: true, wantIncome: true, wantSummary: true,
    wantBalance: true, wantCategories: false, mode: "summary",
  });
}

export async function querySummary(userId: string): Promise<{ replyText: string }> {
  return buildReport(userId, { range: "month" });
}


// ================================================================
// Interpretação inteligente de perguntas do tipo:
//   "Quanto gastei essa semana?"
//   "Qual foi meu gasto e o que entrou de receita essa semana?"
//   "Me mostra o resumo do mês"
//   "Quanto recebi nos últimos 15 dias?"
// Detecta período + intenção (gastos, receitas, saldo, resumo, categorias)
// e devolve um relatório organizado — nunca apenas uma lista solta.
// ================================================================

export type FinanceAsk = {
  wantExpense: boolean;
  wantIncome: boolean;
  wantSummary: boolean;
  wantBalance: boolean;
  wantCategories: boolean;
  /** summary = consolidado (padrão) · categories = por categoria · extract = extrato */
  mode?: "summary" | "categories" | "extract";
};


function normText(s: string): string {
  return (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

const MONTH_NAMES: Record<string, number> = {
  janeiro: 0, jan: 0, fevereiro: 1, fev: 1, marco: 2, mar: 2, abril: 3, abr: 3,
  maio: 4, mai: 4, junho: 5, jun: 5, julho: 6, jul: 6, agosto: 7, ago: 7,
  setembro: 8, set: 8, outubro: 9, out: 9, novembro: 10, nov: 10, dezembro: 11, dez: 11,
};

/** Detecta o período mencionado na mensagem. Retorna null se não achar. */
export function detectPeriodFromText(text: string): ReportOpts | null {
  const t = normText(text);
  if (!t) return null;
  const now = nowSP();

  if (/\bhoje\b/.test(t)) return { range: "today" };
  if (/\bontem\b/.test(t)) return { range: "yesterday" };
  if (/\banteontem|antes\s+de\s+ontem\b/.test(t)) {
    const d = addDays(now, -2);
    const iso = fmtDate(d);
    return { start: iso, end: iso, label: "Anteontem" };
  }

  // Intervalo explícito: "de 01/07 a 18/07", "do dia 10 ao dia 20", "entre 5 e 15 de julho"
  const between = t.match(/\b(?:de|do|entre)\s+(?:dia\s+)?(\d{1,2})(?:\/(\d{1,2}))?(?:\/(\d{2,4}))?\s*(?:a|ate|at(e|é)|e|ao)\s+(?:o\s+)?(?:dia\s+)?(\d{1,2})(?:\/(\d{1,2}))?(?:\/(\d{2,4}))?/);
  if (between) {
    const monthName = Object.keys(MONTH_NAMES).find((m) => new RegExp(`\\b${m}\\b`).test(t));
    const fallbackMonth = monthName ? MONTH_NAMES[monthName] : now.getMonth();
    const d1 = Number(between[1]);
    const m1 = between[2] ? Number(between[2]) - 1 : fallbackMonth;
    const y1 = between[3] ? normYear(between[3]) : now.getFullYear();
    const d2 = Number(between[5]);
    const m2 = between[6] ? Number(between[6]) - 1 : (between[2] ? Number(between[2]) - 1 : fallbackMonth);
    const y2 = between[7] ? normYear(between[7]) : y1;
    const start = new Date(y1, m1, d1);
    const end = new Date(y2, m2, d2);
    if (!isNaN(start.getTime()) && !isNaN(end.getTime()) && end >= start) {
      return { start: fmtDate(start), end: fmtDate(end), label: "Período personalizado" };
    }
  }

  // "desde o dia 15", "do começo do mês até agora", "desde o dia 1º"
  const sinceDay = t.match(/\bdesde\s+(?:o\s+)?dia\s+(\d{1,2})|\bdo\s+dia\s+(\d{1,2})\s+(?:at(e|é)|ate)\s+(?:agora|hoje)/);
  if (sinceDay) {
    const d = Number(sinceDay[1] ?? sinceDay[2]);
    if (d >= 1 && d <= 31) {
      const start = new Date(now.getFullYear(), now.getMonth(), d);
      if (start > now) start.setMonth(start.getMonth() - 1);
      return { start: fmtDate(start), end: fmtDate(now), label: "Período personalizado" };
    }
  }
  if (/\b(do|desde\s+o)\s+(come(c|ç)o|in(i|í)cio)\s+do\s+m(e|ê)s\b/.test(t)) return { range: "month" };

  // Últimos N dias / meses
  const lastDays = t.match(/ultim[oa]s?\s+(\d{1,3})\s+dias?/);
  if (lastDays) {
    const n = Math.max(1, Math.min(365, parseInt(lastDays[1], 10)));
    return { start: fmtDate(addDays(now, -(n - 1))), end: fmtDate(now), label: `Últimos ${n} dias` };
  }
  if (/ultim[oa]s?\s+(sete|7)\s+dias?/.test(t)) return { range: "last_7_days" };
  if (/ultim[oa]s?\s+(trinta|30)\s+dias?/.test(t)) return { range: "last_30_days" };
  if (/\bultimo\s+m(e|ê)s\s+corrido\b|\bm(e|ê)s\s+corrido\b/.test(t)) return { range: "last_30_days" };
  const lastMonths = t.match(/ultim[oa]s?\s+(\d{1,2})\s+(mes|meses|m(ê|e)s)/);
  if (lastMonths) {
    const n = Math.max(1, Math.min(24, parseInt(lastMonths[1], 10)));
    const start = new Date(now.getFullYear(), now.getMonth() - (n - 1), 1);
    return { start: fmtDate(start), end: fmtDate(now), label: `Últimos ${n} meses` };
  }

  if (/\bsemana\s+passada\b|\bsemana\s+anterior\b|\bultima\s+semana\s+fechada\b/.test(t)) return { range: "last_week" };
  if (/\b(essa|esta|nesta|dessa|desta)\s+semana\b|semana\s+atual\b|\bfechamento\s+semanal\b|\bna\s+semana\b/.test(t)) return { range: "week" };
  if (/\bultima\s+semana\b|\bsemana\s+passada\s+at(e|é)\s+hoje\b/.test(t)) return { range: "last_7_days" };
  if (/\bm(e|ê)s\s+passado\b|\bultimo\s+m(e|ê)s\b|\bm(e|ê)s\s+anterior\b|\bultimo\s+m(e|ê)s\s+fechado\b/.test(t)) return { range: "last_month" };
  if (/\b(esse|este|neste|deste)\s+m(e|ê)s\b|m(e|ê)s\s+atual\b|no\s+m(e|ê)s\b|\bdo\s+m(e|ê)s\b|\bmeu\s+m(e|ê)s\b/.test(t)) return { range: "month" };
  if (/\b(esse|este|neste|deste)\s+ano\b|ano\s+atual\b/.test(t)) return { range: "year" };
  if (/\bano\s+passado\b|ultimo\s+ano\b/.test(t)) {
    const y = now.getFullYear() - 1;
    return { start: `${y}-01-01`, end: `${y}-12-31`, label: `Ano ${y}` };
  }

  // Nome do mês: "resumo de julho", "fechamento de junho"
  for (const [name, idx] of Object.entries(MONTH_NAMES)) {
    if (name.length < 4) continue;
    if (new RegExp(`\\b${name}\\b`).test(t)) {
      const year = now.getMonth() >= idx ? now.getFullYear() : now.getFullYear() - 1;
      const start = new Date(year, idx, 1);
      const end = new Date(year, idx + 1, 0);
      const cappedEnd = end > now ? now : end;
      return { start: fmtDate(start), end: fmtDate(cappedEnd), label: capitalize(name) };
    }
  }

  if (/desde\s+que\s+(comecei|come(ç|c)ei)|hist(o|ó)rico\s+completo|desde\s+o\s+in(i|í)cio|tudo\s+que\s+j(a|á)/.test(t)) {
    return { range: "all" };
  }

  return null;
}

function normYear(y: string): number {
  const n = Number(y);
  return n < 100 ? 2000 + n : n;
}
function capitalize(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }


/** Pedido explícito de detalhamento por categoria. */
export const CATEGORY_REQUEST_RE = /\b(por\s+categoria|categorias?|categorizad|separa(r|do)?\s+(por|os\s+gastos)|separado\s+por|divid(e|ir)\s+por\s+tipo|onde\s+(eu\s+)?(mais\s+)?(estou\s+)?gast(o|ei|ando)|onde\s+gastei)\b/;
/** Pedido de extrato / lista de lançamentos. */
export const EXTRACT_REQUEST_RE = /\b(extrato|lan(c|ç)amentos?|lista(r|\s+tudo)?|listagem|me\s+manda\s+o\s+extrato|quais\s+(foram|sao)\s+(minhas|meus)\s+(despesas|gastos|receitas)|quais\s+compras|item\s+por\s+item|discrimina)\b/;

/** Detecta o que o usuário quer ver na resposta. */
export function detectFinanceAsk(text: string): FinanceAsk {
  const t = normText(text);
  const wantExpense = /\bgast(o|os|ei|ando|amos)?\b|\bdespes|\bsaid|\bsa(i|í)da|\bpaguei|\bo\s+que\s+sa[ií]|\bquanto\s+sa[ií]|\btorrei\b|\bqueimei\b|\bfoi\s+embora\b/.test(t);
  const wantIncome = /\breceit|\bganh(o|os|ei)|\bentrad|\bentrou|\brecebi(?!bo)|\brecebid|\bo\s+que\s+entrou|\bquanto\s+entrou|\bquanto\s+recebi|\bquanto\s+caiu\b/.test(t);
  const wantBalance = /\bsaldo\b|\bquanto\s+tenho\b|\bquanto\s+sobra\b|\bquanto\s+sobrou\b|\bresultado\b|\bpositivo\s+ou\s+negativo\b|\bcaixa\b/.test(t);
  const wantCategories = CATEGORY_REQUEST_RE.test(t);
  const wantSummary = /\bresumo\b|\bfechament|\bfecha\s+(as|meu|minha|o)\b|\bbalan(c|ç)o\b|\bmovimenta(ç|c)|\bcomo\s+(foi|est(a|ã)o|estou|esta)\b|\bsitua(c|ç)(a|ã)o\s+financ|\bfinanceiramente\b|\btudo\s+que\s+aconteceu|\bmostra\s+tudo|\brelat(o|ó)rio\b|\bpanorama\b|\braio-?x\b|\bme\s+d(a|á)\s+os\s+numeros\b|\btotal\s+geral\b|\bqual\s+(o\s+)?meu\s+total\b|\bfa(z|ca)\s+as\s+contas\b|\bminhas\s+finan(c|ç)as\b|\bvida\s+financeira\b/.test(t);
  const mode: FinanceAsk["mode"] = wantCategories
    ? "categories"
    : (EXTRACT_REQUEST_RE.test(t) ? "extract" : "summary");
  return { wantExpense, wantIncome, wantSummary, wantBalance, wantCategories, mode };
}

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function fmtBR(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}
function fmtBRShort(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit" }).format(d);

}

/** Busca TODAS as transações do período (paginado — nunca trunca em 1000). */
async function fetchAllTransactions(
  userId: string, since: string | null, until: string | null,
): Promise<any[]> {
  const out: any[] = [];
  const PAGE = 1000;
  for (let page = 0; page < 60; page++) {
    let q = supabaseAdmin
      .from("transactions")
      .select("kind, amount, category, description, occurred_at")
      .eq("user_id", userId);
    if (since) q = q.gte("occurred_at", since);
    if (until) q = q.lte("occurred_at", until);
    const { data, error } = await q
      .order("occurred_at", { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) break;
    const rows = (data ?? []) as any[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/** Saldo atual real = todo o histórico confirmado (entradas - saídas). */
async function computeCurrentBalance(userId: string): Promise<{ balance: number; hasHistory: boolean }> {
  const { fetchFinanceSnapshot } = await import("@/lib/finance-snapshot.server");
  const snap = await fetchFinanceSnapshot(supabaseAdmin, userId);
  return { balance: snap.balance, hasHistory: snap.txCount > 0 };
}


function periodHeaderLabel(since: string | null, until: string | null): string {
  if (!since && !until) return "histórico completo";
  if (since && until) {
    const a = fmtBRShort(since), b = fmtBRShort(until);
    return a === b ? a : `${a} a ${b}`;
  }
  if (since) return `desde ${fmtBRShort(since)}`;
  return `até ${fmtBRShort(until!)}`;
}

/**
 * Resposta consolidada de resumo financeiro (formato oficial do Abio):
 * período, entradas, saídas, resultado do período e saldo atual.
 * Nunca destaca "maior gasto" e nunca devolve apenas lista de lançamentos.
 * mode = "categories" abre todas as categorias; mode = "extract" lista os
 * lançamentos após um cabeçalho resumido.
 */
export async function buildDetailedFinanceReport(
  userId: string,
  period: ReportOpts,
  ask: FinanceAsk,
): Promise<{ replyText: string }> {
  const { since, until } = computeRange(period);
  const rows = await fetchAllTransactions(userId, since, until);

  let income = 0, expense = 0;
  const expenseByCat = new Map<string, number>();
  const incomeByCat = new Map<string, number>();
  const incomes: any[] = [];
  const expenses: any[] = [];
  for (const r of rows) {
    const a = Number(r.amount) || 0;
    const k = (r.category || "Outros").toString();
    if (r.kind === "income") {
      income += a; incomes.push(r);
      incomeByCat.set(k, (incomeByCat.get(k) || 0) + a);
    } else {
      expense += a; expenses.push(r);
      expenseByCat.set(k, (expenseByCat.get(k) || 0) + a);
    }
  }

  const head = periodHeaderLabel(since, until);
  const isSingleDay = !!(since && until && fmtBRShort(since) === fmtBRShort(until));
  const mode = ask.mode ?? "summary";

  if (rows.length === 0) {
    return {
      replyText:
`📊 Resumo financeiro — ${head}

📭 Nenhuma movimentação registrada nesse período.

_Me mande seus gastos e recebimentos por texto, áudio ou imagem que eu organizo tudo._`,
    };
  }

  // ---------- Detalhamento por categoria ----------
  if (mode === "categories") {
    const parts: string[] = [];
    if (expenseByCat.size > 0) {
      const lines = Array.from(expenseByCat.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([c, v]) => `${CAT_EMOJI[c] ?? "•"} ${c}: ${BRL(v)}`)
        .join("\n");
      parts.push(`📂 *Gastos por categoria — ${head}*\n\n${lines}\n\n💸 *Total de saídas:* ${BRL(expense)}`);
    }
    if (incomeByCat.size > 0) {
      const lines = Array.from(incomeByCat.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([c, v]) => `${CAT_EMOJI[c] ?? "•"} ${c}: ${BRL(v)}`)
        .join("\n");
      parts.push(`💰 *Entradas por categoria*\n\n${lines}\n\n💰 *Total de entradas:* ${BRL(income)}`);
    }
    if (!parts.length) parts.push(`📂 *Gastos por categoria — ${head}*\n\nNenhuma categoria com movimentação nesse período.`);
    return { replyText: parts.join("\n\n") };
  }

  // ---------- Extrato (lista de lançamentos) ----------
  if (mode === "extract") {
    const list = (ask.wantIncome && !ask.wantExpense) ? incomes : (ask.wantExpense && !ask.wantIncome ? expenses : rows);
    const headerTotal = (ask.wantIncome && !ask.wantExpense)
      ? `💰 *Total de entradas:* ${BRL(income)}`
      : `💸 *Total de saídas:* ${BRL(expense)}`;
    const lines = list.map((r) => {
      const emoji = r.kind === "income" ? "💰" : (CAT_EMOJI[r.category] ?? "💸");
      const sign = r.kind === "income" ? "+" : "-";
      const desc = (r.description || r.category || "Lançamento").toString().slice(0, 40);
      return `${emoji} ${fmtBRShort(r.occurred_at)} • ${desc} — ${sign}${BRL(Number(r.amount) || 0)}`;
    }).join("\n");
    return {
      replyText:
`${headerTotal}
📅 *Período:* ${head}
🧾 ${list.length} lançamento${list.length === 1 ? "" : "s"}

${lines}`,
    };
  }

  // ---------- Resumo consolidado (padrão) ----------
  const result = income - expense;
  const resultEmoji = result < 0 ? "📉" : "📈";
  const resultLabel = isSingleDay ? "Resultado do dia" : "Resultado do período";
  const { balance, hasHistory } = await computeCurrentBalance(userId);

  const lines = [
    `📊 *Resumo financeiro — ${head}*`,
    "",
    `💰 Entradas: ${BRL(income)}`,
    `💸 Saídas: ${BRL(expense)}`,
    `${resultEmoji} ${resultLabel}: ${BRL(result)}`,
  ];
  if (hasHistory) lines.push(`🏦 Saldo atual: ${BRL(balance)}`);
  lines.push("", hasHistory
    ? "Quer que eu mostre também todos os gastos separados por categoria?"
    : "Ainda não tenho histórico suficiente para calcular seu saldo atual.\n\nQuer que eu mostre os gastos separados por categoria?");

  return { replyText: lines.join("\n") };
}



export async function queryAppointments(userId: string): Promise<{ replyText: string }> {
  const { data, error } = await supabaseAdmin
    .from("appointments")
    .select("title, scheduled_at")
    .eq("user_id", userId)
    .gte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(5);
  if (error) return { replyText: "Não consegui buscar seus compromissos 🙏." };
  if (!data || data.length === 0) {
    return { replyText: "📭 Você não tem compromissos futuros agendados.\n\nQuer marcar algum? Ex.: _reunião sexta às 9h_" };
  }
  const lines = data.map((a) => `• *${a.title}* — ${formatDatePT(a.scheduled_at as string)}`);
  return { replyText: `📅 *Próximos compromissos*\n\n${lines.join("\n")}` };
}

export function helpMessage(name?: string): string {
  const first = (name || "").split(" ")[0];
  return `👋 ${first ? `Olá ${first}!` : "Olá!"} Sou o *Abio* — seu assistente financeiro no WhatsApp.

Você pode me mandar mensagens como:

• _gastei cinquenta reais no mercado_
• _abasteci 100_
• _recebi pix de quinhentos_
• _qual meu saldo?_
• _quanto gastei esse mês?_
• _relatório financeiro_
• _zerar meu histórico_ (apaga tudo)

Também aceito *áudios* 🎙️ e *imagens* 🖼️ (comprovantes, recibos, prints).

Estou pronto pra organizar sua vida financeira 🚀`;
}

export async function resetUserData(userId: string): Promise<{ replyText: string; ok: boolean; total: number }> {
  const tables = [
    "whatsapp_messages",
    "transactions",
    "appointments",
    "financial_goals",
    "recurring_bills",
    "installment_purchases",
    "debts",
    "budgets",
    "salary_entries",
    "assets",
  ];
  let total = 0;
  for (const t of tables) {
    try {
      const { error, count } = await supabaseAdmin
        .from(t as any)
        .delete({ count: "exact" })
        .eq("user_id", userId);
      if (!error && typeof count === "number") total += count;
    } catch {
      // ignore individual table errors
    }
  }
  try {
    await supabaseAdmin.from("reset_audit_logs" as any).insert({
      user_id: userId,
      total_removed: total,
      ok: true,
      details: { source: "whatsapp" },
    });
  } catch { /* ignore */ }
  return {
    ok: true,
    total,
    replyText: `✅ Pronto! Apaguei ${total} registro${total === 1 ? "" : "s"} do seu histórico.\n\nSua conta, login e assinatura continuam intactos. Pode começar do zero quando quiser 🚀`,
  };
}

// ===== Recurring bill =====
export function nextDueFromDay(day: number): string {
  const clamp = Math.min(Math.max(1, day | 0), 31);
  const now = new Date();
  let y = now.getFullYear();
  let m = now.getMonth();
  const today = now.getDate();
  if (clamp < today) m += 1;
  const lastOfMonth = new Date(y, m + 1, 0).getDate();
  const d = Math.min(clamp, lastOfMonth);
  const target = new Date(y, m, d);
  // normalize to YYYY-MM-DD ignoring tz
  const yy = target.getFullYear();
  const mm = String(target.getMonth() + 1).padStart(2, "0");
  const dd = String(target.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export async function recordBill(
  userId: string,
  input: {
    title?: string; amount?: number; frequency?: string; next_due_at?: string; due_day?: number; category?: string;
    total_installments?: number; paid_installments?: number;
  },
): Promise<{ replyText: string; ok: boolean; needsDay?: boolean; draft?: any; billId?: string }> {
  const title = (input.title || "").trim();
  const amount = Number(input.amount);
  if (!title || !(amount > 0)) {
    return { ok: false, replyText: "Não captei a conta fixa. Ex.: _aluguel fixo R$ 1.000 vence dia 10_" };
  }
  const frequency = ["weekly", "biweekly", "monthly", "yearly"].includes(input.frequency || "")
    ? input.frequency!
    : "monthly";

  let nextDue = input.next_due_at;
  if (!nextDue && input.due_day && input.due_day >= 1 && input.due_day <= 31) {
    nextDue = nextDueFromDay(input.due_day);
  }

  // Se conta MENSAL sem dia/data → pedir dia ao usuário
  if (!nextDue && frequency === "monthly") {
    return {
      ok: false,
      needsDay: true,
      draft: {
        title, amount, frequency, category: input.category || "Contas Fixas",
        total_installments: input.total_installments, paid_installments: input.paid_installments,
      },
      replyText:
`✅ *Conta fixa identificada:* ${title} — ${BRL(amount)}.

Qual é o *dia do vencimento* dessa conta todos os meses? (Ex.: 05, 10, 15, 30)`,
    };
  }

  // nextDueFromDay() é "dia do MÊS" — não faz sentido como fallback pra conta
  // semanal/quinzenal sem data informada (ex.: "aluguel do carro 600 toda
  // semana", sem dia definido). Nesses casos, ancora em hoje + 1 ciclo.
  const dueDate = nextDue || (
    frequency === "weekly" ? new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10)
    : frequency === "biweekly" ? new Date(Date.now() + 14 * 86400_000).toISOString().slice(0, 10)
    : frequency === "yearly" ? new Date(Date.now() + 365 * 86400_000).toISOString().slice(0, 10)
    : nextDueFromDay(5)
  );
  const total = Number(input.total_installments);
  const hasTotal = Number.isFinite(total) && total >= 2;
  const paidCount = hasTotal ? Math.max(0, Math.min(total, Number(input.paid_installments ?? 0) || 0)) : 0;
  const payDay = input.due_day && input.due_day >= 1 && input.due_day <= 31
    ? input.due_day
    : Number(String(dueDate).slice(8, 10)) || null;

  const { data: created, error } = await supabaseAdmin.from("recurring_bills").insert({
    user_id: userId,
    title,
    amount,
    frequency,
    next_due_at: dueDate,
    category: input.category || "Contas Fixas",
    total_installments: hasTotal ? total : null,
    paid_installments: paidCount,
    payment_day: payDay,
    first_due_date: dueDate,
  } as any).select("id").single();
  if (error || !created) { console.error("[actions] recordBill", error); return { ok: false, replyText: "Não consegui salvar essa conta 🙏." }; }
  const bal = await getMonthBalance(userId);
  const dayLabel = payDay ? `dia *${String(payDay).padStart(2, "0")}*` : `*${formatYMDBr(dueDate)}*`;

  if (hasTotal) {
    return {
      ok: true,
      billId: created.id as string,
      replyText:
`✅ *${title}* cadastrado!

💰 Valor da parcela: *${BRL(amount)}*
📊 Total de parcelas: *${total}*
✔️ Pagas: *${paidCount}*
⏳ Pendentes: *${total - paidCount}*
🔢 Parcela atual: *${Math.min(total, paidCount + 1)} de ${total}*
📅 Vencimento: todo ${dayLabel}
📆 Próximo vencimento: *${formatYMDBr(dueDate)}*
📌 Status: Ativo

💰 Saldo do mês: *${BRL(bal.balance)}*`,
    };
  }

  return {
    ok: true,
    billId: created.id as string,
    replyText:
`✅ Perfeito! Sua conta fixa *${title}* (${BRL(amount)}) foi cadastrada com vencimento ${frequency === "monthly" ? `todo ${dayLabel}` : dayLabel}.

💰 Saldo do mês: *${BRL(bal.balance)}*

🔔 Vou te lembrar 3 dias antes e 1 dia antes do vencimento aqui no WhatsApp.`,
  };
}

/** Conta mais recente do usuário — usada para associar mensagens complementares. */
export async function findRecentBillForFollowUp(
  userId: string,
  hint?: string | null,
  maxAgeHours = 72,
): Promise<any | null> {
  const { data } = await supabaseAdmin
    .from("recurring_bills")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(10);
  const list = (data ?? []) as any[];
  if (list.length === 0) return null;
  const term = (hint || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  if (term.length >= 4) {
    const byTitle = list.find((b) =>
      term.includes(String(b.title || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")),
    );
    if (byTitle) return byTitle;
  }
  const newest = list[0];
  const ageH = (Date.now() - new Date(newest.created_at).getTime()) / 3600000;
  return ageH <= maxAgeHours ? newest : null;
}

/** Card padrão com o estado de parcelas de uma conta. */
export function billInstallmentCardText(bill: any): string {
  const info = billInstallmentInfo(bill);
  const dueLabel = formatYMDBr(bill.next_due_at);
  if (!info.isInstallment) {
    return `📌 *${bill.title}*\n💰 ${BRL(Number(bill.amount))} por mês\n📆 Próximo vencimento: *${dueLabel}*`;
  }
  return `📌 *${bill.title}*
💰 ${BRL(Number(bill.amount))} por mês
🔢 Parcela: *${info.current} de ${info.total}*
✔️ Pagas: *${info.paid}*
⏳ Pendentes: *${info.remaining}*
📆 Próximo vencimento: *${dueLabel}*
📊 ${info.percent.toString().replace(".", ",")}% concluído
📌 Status: ${info.settled ? "Quitado" : "Ativo"}`;
}

/**
 * Atualiza uma conta já criada com dados complementares (total de parcelas,
 * parcelas pagas, dia de vencimento) — sem criar registros duplicados.
 */
export async function applyBillInstallmentFollowUp(
  userId: string,
  billId: string,
  patch: BillInstallmentPatch,
): Promise<{ ok: boolean; replyText: string }> {
  const { data: bill } = await supabaseAdmin
    .from("recurring_bills").select("*").eq("id", billId).eq("user_id", userId).maybeSingle();
  if (!bill) return { ok: false, replyText: "Não encontrei essa conta para atualizar." };

  const update: Record<string, unknown> = {};
  const total = patch.total_installments ?? (bill as any).total_installments ?? null;
  if (patch.total_installments) {
    update.total_installments = patch.total_installments;
    if ((bill as any).paid_installments == null) update.paid_installments = 0;
  }
  if (typeof patch.paid_installments === "number") {
    update.paid_installments = total ? Math.min(total, patch.paid_installments) : patch.paid_installments;
  }
  // next_due_at explícito ("dia 10 de dezembro de 2026") é mais específico
  // que payment_day sozinho ("dia 10", que perde o mês) — vence primeiro.
  if (patch.next_due_at) {
    update.next_due_at = patch.next_due_at;
    update.payment_day = Number(patch.next_due_at.slice(8, 10));
    if (!(bill as any).first_due_date) update.first_due_date = patch.next_due_at;
  } else if (patch.payment_day) {
    update.payment_day = patch.payment_day;
    update.next_due_at = nextDueFromDaySP(patch.payment_day);
    if (!(bill as any).first_due_date) update.first_due_date = update.next_due_at;
  }
  if (patch.frequency && ["weekly", "biweekly", "monthly", "yearly"].includes(patch.frequency)) {
    update.frequency = patch.frequency;
    // Sem dia de vencimento explícito nesta mesma correção: se a conta ainda
    // não tem next_due_at coerente com a nova frequência, ancora em hoje + 1
    // ciclo em vez de deixar uma data de outro ritmo (ex.: mensal → semanal).
    if (!patch.payment_day && patch.frequency !== "monthly") {
      update.next_due_at = patch.frequency === "weekly"
        ? new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10)
        : patch.frequency === "biweekly"
        ? new Date(Date.now() + 14 * 86400_000).toISOString().slice(0, 10)
        : new Date(Date.now() + 365 * 86400_000).toISOString().slice(0, 10);
    }
  }
  if (typeof patch.amount === "number" && patch.amount > 0) {
    update.amount = patch.amount;
    update.original_amount = patch.amount;
  }
  if (Object.keys(update).length === 0) return { ok: false, replyText: "" };
  update.updated_at = new Date().toISOString();

  const { data: saved, error } = await supabaseAdmin
    .from("recurring_bills").update(update as any)
    .eq("id", billId).eq("user_id", userId)
    .select("*").single();
  if (error || !saved) {
    console.error("[actions] applyBillInstallmentFollowUp", error);
    return { ok: false, replyText: "Não consegui atualizar essa conta agora 🙏." };
  }
  return { ok: true, replyText: `✅ Atualizei sua conta!\n\n${billInstallmentCardText(saved)}` };
}


// ===== Confirmação de pagamento de conta fixa =====
function advanceDueDate(iso: string, frequency: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  if (frequency === "weekly") dt.setUTCDate(dt.getUTCDate() + 7);
  else if (frequency === "biweekly") dt.setUTCDate(dt.getUTCDate() + 14);
  else if (frequency === "yearly") dt.setUTCFullYear(dt.getUTCFullYear() + 1);
  else dt.setUTCMonth(dt.getUTCMonth() + 1);
  return dt.toISOString().slice(0, 10);
}

/**
 * Localiza contas fixas aguardando confirmação (awaiting/late) para o usuário,
 * opcionalmente filtrando por dica de título (ex: "aluguel").
 */
export async function findPendingBillsForUser(
  userId: string,
  hint?: string,
): Promise<any[]> {
  const { data } = await supabaseAdmin
    .from("recurring_bills")
    .select("id, title, amount, frequency, next_due_at, payment_status, awaiting_for")
    .eq("user_id", userId)
    .eq("active", true)
    .in("payment_status", ["awaiting", "late"]);
  const list = (data ?? []) as any[];
  if (!hint) return list;
  const h = hint.toLowerCase();
  const filtered = list.filter((b) => (b.title || "").toLowerCase().includes(h) || h.includes((b.title || "").toLowerCase()));
  return filtered.length > 0 ? filtered : list;
}

/**
 * Confirma o pagamento das contas: cria a despesa para cada uma, avança next_due_at
 * e atualiza payment_status='paid' com last_paid_at/last_paid_due.
 */
export async function confirmBillPayments(
  userId: string,
  billIds: string[],
  occurredAt = new Date().toISOString(),
): Promise<{ replyText: string; ok: boolean; count: number }> {
  if (!billIds || billIds.length === 0) return { ok: false, count: 0, replyText: "Nenhuma conta fixa pendente encontrada." };
  const { data: bills, error } = await supabaseAdmin
    .from("recurring_bills")
    .select("*")
    .in("id", billIds)
    .eq("user_id", userId);
  if (error || !bills || bills.length === 0) return { ok: false, count: 0, replyText: "Não encontrei as contas para confirmar." };

  const nowIso = new Date().toISOString();
  let total = 0;
  const lines: string[] = [];
  for (const b of bills as any[]) {
    const amount = Number(b.amount);
    const dueDate = b.next_due_at as string;
    // Registra despesa
    try {
      await writeVerifiedTransaction(supabaseAdmin, {
        userId, kind: "expense", amount,
        category: b.category || "Contas Fixas", description: b.title,
        occurredAt, source: "recurring",
      });
    } catch (writeError) {
      console.error("[actions] confirmBillPayments transaction", writeError);
      return { ok: false, count: lines.length, replyText: "Ocorreu um erro interno e o pagamento não foi confirmado. Tente novamente em instantes." };
    }
    // Avança e marca como pago
    const next = advanceDueDate(dueDate, b.frequency || "monthly");
    await supabaseAdmin.from("recurring_bills").update({
      last_paid_at: nowIso,
      last_paid_due: dueDate,
      payment_status: "paid",
      awaiting_for: null,
      last_charged_at: nowIso,
      next_due_at: next,
    }).eq("id", b.id).eq("user_id", userId);
    total += amount;
    lines.push(`${b.title} — ${BRL(amount)}`);
  }

  const bal = await getMonthBalance(userId);
  return {
    ok: true,
    count: bills.length,
    replyText:
`✅ *Pagamento confirmado!*

${lines.map((l) => `• ${l}`).join("\n")}

Total registrado: *${BRL(total)}*
💰 Saldo do mês: *${BRL(bal.balance)}*

Já atualizei seu Dashboard, Relatórios e Histórico automaticamente 🚀`,
  };
}

/**
 * Marca as contas como "ainda não paguei" (payment_status='late') e reagenda a cobrança para amanhã.
 */
export async function deferBillPayments(userId: string, billIds: string[]): Promise<{ replyText: string }> {
  if (billIds && billIds.length > 0) {
    await supabaseAdmin.from("recurring_bills")
      .update({ payment_status: "late", last_reminder_sent_at: new Date().toISOString() })
      .in("id", billIds).eq("user_id", userId);
  }
  return { replyText: "👍 Tudo bem. Vou te lembrar novamente amanhã às 09:00. Se pagar antes, é só me avisar por aqui." };
}

// ===== Installment =====
export async function recordInstallment(
  userId: string,
  input: {
    title?: string; amount?: number; installments_total?: number; installments_paid?: number; total_amount?: number;
    /** Vencimento da 1ª parcela: dia do mês ("vencimento dia 10") ou data ISO explícita ("primeira parcela em setembro"). */
    due_day?: number; next_due_at?: string;
  },
): Promise<{ replyText: string; ok: boolean; row?: { id: string } }> {
  const title = (input.title || "").trim();
  const parcel = Number(input.amount);
  const total = Number(input.installments_total) || 1;
  const paid = Math.min(Number(input.installments_paid) || 0, total);
  if (!title || !(parcel > 0) || !(total > 0)) {
    return { ok: false, replyText: "Não captei o parcelamento. Ex.: _Fórum (9ª de 10) — R$ 70_" };
  }
  // Segunda linha de defesa contra duplicata: se uma mensagem seguinte (ex.:
  // uma correção que o followup não soube tratar) acabar caindo de volta na
  // criação, um parcelamento idêntico criado há pouco é quase certamente o
  // mesmo, não um novo. Mesma janela/lógica já usada em despesa e receita.
  const recentSinceISO = new Date(Date.now() - 5 * 60_000).toISOString();
  const { data: recentDup } = await supabaseAdmin
    .from("installment_purchases").select("id, title, installments_total, total_amount")
    .eq("user_id", userId).gte("created_at", recentSinceISO)
    .order("created_at", { ascending: false }).limit(10);
  const dupMatch = (recentDup ?? []).find((r: any) =>
    Number(r.installments_total) === total &&
    Math.abs(Number(r.total_amount) - parcel * total) < 1,
  );
  if (dupMatch) {
    return { ok: true, row: { id: dupMatch.id }, replyText: "Esse parcelamento já foi registrado." };
  }
  // O total é sempre DERIVADO de parcela × quantidade — os dois fatos que o
  // usuário realmente enunciou ("10 parcelas de mil reais"). Um total_amount
  // vindo de fora (ex.: OCR de um contrato) só é aceito quando CONCORDA com
  // o produto; se divergir, o produto vence — nunca um número solto e
  // potencialmente trocado com a contagem de parcelas.
  const computedTotal = parcel * total;
  const inputTotal = Number(input.total_amount);
  const totalAmount = (Number.isFinite(inputTotal) && inputTotal > 0
    && Math.abs(inputTotal - computedTotal) <= Math.max(1, computedTotal * 0.02))
    ? inputTotal
    : computedTotal;
  // Vencimento da 1ª parcela: usa o que o usuário disse ("primeira parcela
  // em setembro", "vence dia 10"); sem isso, cai no antigo padrão (dia 10 do
  // mês corrente/seguinte). nextDueFromDaySP já rola pro mês seguinte quando
  // o dia citado já passou este mês — nunca cria vencimento no passado.
  const firstDueAt = input.next_due_at
    ? String(input.next_due_at).slice(0, 10)
    : nextDueFromDaySP(input.due_day && input.due_day >= 1 && input.due_day <= 31 ? input.due_day : 10);
  const { data: created, error } = await supabaseAdmin.from("installment_purchases").insert({
    user_id: userId,
    title,
    total_amount: totalAmount,
    installments_total: total,
    installments_paid: paid,
    first_due_at: firstDueAt,
  }).select("id").single();
  if (error || !created) { console.error("[actions] recordInstallment", error); return { ok: false, replyText: "Não consegui salvar o parcelamento 🙏." }; }
  const remaining = total - paid;
  // Parcelamento é um COMPROMISSO, não dinheiro que saiu agora — só a parcela
  // paga vira despesa de verdade. Por isso a confirmação mostra data e
  // parcelas, não o saldo do mês (que só muda quando uma parcela é paga).
  return {
    ok: true,
    row: { id: created.id as string },
    replyText: `💳 Parcelamento *${title}* — ${paid}/${total} pagas (${remaining} restantes)
💰 ${BRL(parcel)}/parcela — total ${BRL(totalAmount)}
📆 Próximo vencimento: *${formatYMDBr(firstDueAt)}*`,
  };
}

/** Parcelamento mais recente do usuário — usado para associar mensagens complementares. */
export async function findRecentInstallmentForFollowUp(
  userId: string,
  hint?: string | null,
  maxAgeHours = 72,
): Promise<any | null> {
  const { data } = await supabaseAdmin
    .from("installment_purchases")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(10);
  const list = (data ?? []) as any[];
  if (list.length === 0) return null;
  const stripAccents = (s: string) => s.normalize("NFD").replace(/\p{Mn}/gu, "");
  const term = stripAccents((hint || "").toLowerCase()).trim();
  if (term.length >= 4) {
    const byTitle = list.find((b) => term.includes(stripAccents(String(b.title || "").toLowerCase())));
    if (byTitle) return byTitle;
  }
  const newest = list[0];
  const ageH = (Date.now() - new Date(newest.created_at).getTime()) / 3600000;
  return ageH <= maxAgeHours ? newest : null;
}

/** Card padrão com o estado de um parcelamento. */
export function installmentCardText(inst: any): string {
  const total = Number(inst.installments_total ?? 0);
  const paid = Math.max(0, Math.min(total, Number(inst.paid_installments ?? 0)));
  const remaining = Math.max(0, total - paid);
  const parcel = total > 0 ? Number(inst.total_amount ?? 0) / total : 0;
  return `💳 *${inst.title}*
💰 ${BRL(parcel)}/parcela — total ${BRL(Number(inst.total_amount ?? 0))}
🔢 Parcela: *${Math.min(total, paid + 1)} de ${total}*
✔️ Pagas: *${paid}*
⏳ Pendentes: *${remaining}*
📆 Primeiro vencimento: *${formatYMDBr(String(inst.first_due_at ?? "").slice(0, 10))}*`;
}

/**
 * Atualiza um parcelamento já criado (total de parcelas, parcelas pagas,
 * valor da parcela) — sem criar registros duplicados. O valor total é
 * sempre recalculado como parcela × quantidade.
 */
export async function applyInstallmentFollowUp(
  userId: string,
  installmentId: string,
  patch: BillInstallmentPatch,
): Promise<{ ok: boolean; replyText: string }> {
  const { data: inst } = await supabaseAdmin
    .from("installment_purchases").select("*").eq("id", installmentId).eq("user_id", userId).maybeSingle();
  if (!inst) return { ok: false, replyText: "Não encontrei esse parcelamento para atualizar." };

  const currentTotal = Number((inst as any).installments_total ?? 0);
  const currentTotalAmount = Number((inst as any).total_amount ?? 0);
  const currentParcel = currentTotal > 0 ? currentTotalAmount / currentTotal : 0;
  const newTotal = patch.total_installments ?? currentTotal;
  const newParcel = patch.amount ?? currentParcel;

  const update: Record<string, unknown> = {};
  if (patch.total_installments || patch.amount) {
    update.installments_total = newTotal;
    update.total_amount = Math.round(newParcel * newTotal * 100) / 100;
  }
  if (typeof patch.paid_installments === "number") {
    update.paid_installments = Math.min(newTotal, patch.paid_installments);
  }
  // next_due_at explícito ("dia 10 de dezembro de 2026") é mais específico
  // que payment_day sozinho ("dia 10", que perde o mês e resolvia errado).
  if (patch.next_due_at) {
    update.first_due_at = patch.next_due_at;
  } else if (patch.payment_day && patch.payment_day >= 1 && patch.payment_day <= 31) {
    update.first_due_at = nextDueFromDaySP(patch.payment_day);
  }
  if (Object.keys(update).length === 0) return { ok: false, replyText: "" };
  update.updated_at = new Date().toISOString();

  const { data: saved, error } = await supabaseAdmin
    .from("installment_purchases").update(update as any)
    .eq("id", installmentId).eq("user_id", userId)
    .select("*").single();
  if (error || !saved) {
    console.error("[actions] applyInstallmentFollowUp", error);
    return { ok: false, replyText: "Não consegui atualizar esse parcelamento agora 🙏." };
  }
  return { ok: true, replyText: `✅ Atualizei!\n\n${installmentCardText(saved)}` };
}

// ===== Credit Cards =====
// A fatura NUNCA é armazenada à parte — é sempre computada ao vivo (soma das
// despesas com credit_card_id preenchido, dentro do ciclo de fechamento
// atual), o mesmo padrão de getMonthBalance.

function spToday(): { y: number; m: number; d: number } {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const g = (t: string) => Number(f.find((p) => p.type === t)?.value ?? 0);
  return { y: g("year"), m: g("month"), d: g("day") };
}
function clampDayInMonth(y: number, m: number, day: number): number {
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Math.min(Math.max(1, day), last);
}
// Nome diferente de propósito: já existe um ymd(d: Date) mais abaixo no
// arquivo (formata uma data existente); este monta uma data a partir de
// ano/mês/dia soltos — mesmo nome causaria colisão de símbolo no build.
function ymdParts(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Ciclo da fatura ABERTA agora: transações após cycleStart e até cycleEnd (inclusive) pertencem a ela. */
function currentInvoiceCycle(closingDay: number): { cycleStart: string; cycleEnd: string } {
  const { y, m, d } = spToday();
  let ny = y, nm = m;
  if (d > closingDay) { nm += 1; if (nm > 12) { nm = 1; ny += 1; } }
  const cycleEnd = ymdParts(ny, nm, clampDayInMonth(ny, nm, closingDay));
  let py = ny, pm = nm - 1;
  if (pm < 1) { pm = 12; py -= 1; }
  const cycleStart = ymdParts(py, pm, clampDayInMonth(py, pm, closingDay));
  return { cycleStart, cycleEnd };
}

export async function createCreditCard(
  userId: string,
  input: { name?: string; closing_day?: number; due_day?: number; is_default?: boolean },
): Promise<{ ok: boolean; replyText: string; row?: { id: string } }> {
  const name = (input.name || "").trim();
  const closingDay = Number(input.closing_day);
  const dueDay = Number(input.due_day);
  if (!name || !(closingDay >= 1 && closingDay <= 31) || !(dueDay >= 1 && dueDay <= 31)) {
    return { ok: false, replyText: "Não captei os dados do cartão. Me diz o nome, o dia de fechamento e o dia de vencimento (ex.: _Nubank, fecha dia 3, vence dia 10_)." };
  }
  const { data: existing } = await supabaseAdmin
    .from("credit_cards" as any).select("id").eq("user_id", userId).eq("active", true);
  const isFirst = !existing || existing.length === 0;
  if (input.is_default || isFirst) {
    await supabaseAdmin.from("credit_cards" as any).update({ is_default: false }).eq("user_id", userId);
  }
  const { data: created, error } = await supabaseAdmin.from("credit_cards" as any).insert({
    user_id: userId, name, closing_day: closingDay, due_day: dueDay, is_default: input.is_default || isFirst,
  } as any).select("id").single();
  if (error || !created) { console.error("[actions] createCreditCard", error); return { ok: false, replyText: "Não consegui cadastrar o cartão 🙏." }; }
  return {
    ok: true,
    row: { id: (created as any).id },
    replyText: `💳 Cartão *${name}* cadastrado!\n📆 Fecha todo dia *${closingDay}*, vence dia *${dueDay}*.\n\nAgora é só falar "no cartão ${name}" numa despesa que eu já vinculo à fatura.`,
  };
}

/** Resolve "cartão X" / "no crédito" (sem nome) pro cartão certo do usuário. */
export async function findCreditCardByHint(userId: string, hint?: string | null): Promise<{ id: string; name: string; closing_day: number; due_day: number } | null> {
  const { data } = await supabaseAdmin
    .from("credit_cards" as any).select("id, name, closing_day, due_day, is_default")
    .eq("user_id", userId).eq("active", true);
  const list = (data ?? []) as any[];
  if (list.length === 0) return null;
  const term = (hint || "").toLowerCase().normalize("NFD").replace(/\p{Mn}/gu, "").trim();
  if (term.length >= 3) {
    const byName = list.find((c) => term.includes(String(c.name || "").toLowerCase().normalize("NFD").replace(/\p{Mn}/gu, "")));
    if (byName) return byName;
  }
  if (list.length === 1) return list[0];
  return list.find((c) => c.is_default) ?? null;
}

export async function queryCreditCardInvoice(userId: string, hint?: string | null): Promise<{ replyText: string }> {
  const card = await findCreditCardByHint(userId, hint);
  if (!card) {
    const { data } = await supabaseAdmin.from("credit_cards" as any).select("id").eq("user_id", userId).eq("active", true).limit(1);
    if (!data || data.length === 0) return { replyText: "Você ainda não tem nenhum cartão cadastrado. Me diz o nome, o dia de fechamento e o dia de vencimento que eu cadastro." };
    return { replyText: "Você tem mais de um cartão — de qual você quer a fatura?" };
  }
  const { cycleStart, cycleEnd } = currentInvoiceCycle(card.closing_day);
  const { data: txs } = await supabaseAdmin
    .from("transactions").select("amount")
    .eq("user_id", userId).eq("kind", "expense").eq("credit_card_id" as any, card.id)
    .gt("occurred_at", `${cycleStart}T00:00:00-03:00`).lte("occurred_at", `${cycleEnd}T23:59:59-03:00`);
  const total = (txs ?? []).reduce((s: number, r: any) => s + Number(r.amount || 0), 0);
  return {
    replyText: `💳 *${card.name}*\n💰 Fatura atual: *${BRL(total)}*\n📆 Fecha dia *${card.closing_day}* — vence dia *${card.due_day}*`,
  };
}

// ===== Debt =====
export async function recordDebt(
  userId: string,
  input: { title?: string; amount?: number; creditor?: string; description?: string },
): Promise<{ replyText: string; ok: boolean }> {
  const title = (input.title || input.description || "").trim();
  const principal = Number(input.amount);
  if (!title || !(principal > 0)) {
    return { ok: false, replyText: "Não captei a dívida. Ex.: _empréstimo banco X — R$ 1500_" };
  }
  const { error } = await supabaseAdmin.from("debts").insert({
    user_id: userId,
    title,
    principal,
    creditor: input.creditor ?? null,
  });
  if (error) { console.error("[actions] recordDebt", error); return { ok: false, replyText: "Não consegui salvar a dívida 🙏." }; }
  const bal = await getMonthBalance(userId);
  return { ok: true, replyText: `📌 Dívida registrada: *${title}* — ${BRL(principal)}

💰 Saldo do mês: *${BRL(bal.balance)}*` };
}

// ===== Goal =====
export async function recordGoal(
  userId: string,
  input: { title?: string; target_amount?: number; amount?: number; target_date?: string },
): Promise<{ replyText: string; ok: boolean }> {
  const title = (input.title || "").trim();
  const target = Number(input.target_amount ?? input.amount);
  if (!title || !(target > 0)) {
    return { ok: false, replyText: "Não captei a meta. Ex.: _meta viagem R$ 5000_" };
  }
  const { error } = await supabaseAdmin.from("financial_goals").insert({
    user_id: userId,
    title,
    target_amount: target,
    target_date: input.target_date ?? null,
  });
  if (error) { console.error("[actions] recordGoal", error); return { ok: false, replyText: "Não consegui salvar a meta 🙏." }; }
  return { ok: true, replyText: `🎯 Meta criada: *${title}* — alvo ${BRL(target)}` };
}

// ===== Correction =====
export async function correctLastTransaction(
  userId: string,
  input: { correction_field?: "amount" | "category" | "description" | "payment_method"; new_amount?: number; new_category?: string; new_description?: string; new_payment_method?: string; match_hint?: string },
): Promise<{ replyText: string; ok: boolean; needsConfirmation?: boolean }> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: recent } = await supabaseAdmin
    .from("transactions")
    .select("id, kind, amount, category, description, occurred_at")
    .eq("user_id", userId)
    .gte("occurred_at", since)
    .order("occurred_at", { ascending: false })
    .limit(10);

  if (!recent || recent.length === 0) {
    return { ok: false, replyText: "Não achei um lançamento recente pra corrigir 🤔. Pode me dizer qual?" };
  }

  const hint = (input.match_hint || "").toLowerCase().trim();
  let candidates = recent;
  if (hint) {
    const filtered = recent.filter((r) =>
      (r.category || "").toLowerCase().includes(hint) ||
      (r.description || "").toLowerCase().includes(hint),
    );
    if (filtered.length > 0) candidates = filtered;
  }

  if (candidates.length > 1 && !hint && input.correction_field !== "payment_method") {
    const list = candidates.slice(0, 3).map((c, i) =>
      `${i + 1}. ${c.kind === "income" ? "💰" : "💸"} ${BRL(Number(c.amount))} — ${c.category}${c.description ? ` (${c.description})` : ""}`,
    ).join("\n");
    return {
      ok: false,
      needsConfirmation: true,
      replyText: `Achei mais de um lançamento recente. Qual você quer corrigir?\n\n${list}\n\nResponda com mais detalhes (ex.: "o do mercado").`,
    };
  }

  const target = candidates[0];
  const field = input.correction_field
    || (input.new_amount != null ? "amount"
      : input.new_category ? "category"
      : input.new_payment_method ? "payment_method"
      : input.new_description ? "description"
      : "amount");

  const patch: Record<string, any> = {};
  const oldValue: any = field === "payment_method" ? (target.description || "") : (target as any)[field];
  let newValue: any = null;

  if (field === "amount" && input.new_amount != null) { patch.amount = input.new_amount; newValue = input.new_amount; }
  else if (field === "category" && input.new_category) { patch.category = input.new_category; newValue = input.new_category; }
  else if (field === "description" && input.new_description) { patch.description = input.new_description; newValue = input.new_description; }
  else if (field === "payment_method" && input.new_payment_method) {
    const method = input.new_payment_method.trim().toLowerCase();
    // Remove tag de método anterior e anexa a nova: "[método: cartão]"
    const baseDesc = (target.description || "").replace(/\s*\[método:[^\]]+\]\s*/i, "").trim();
    newValue = `[método: ${method}]`;
    patch.description = baseDesc ? `${baseDesc} ${newValue}` : newValue;
  }
  else {
    return { ok: false, replyText: "Não entendi o que devo corrigir. Pode me dizer o novo valor ou descrição?" };
  }

  const { error } = await supabaseAdmin.from("transactions").update(patch as any).eq("id", target.id).eq("user_id", userId);
  if (error) { console.error("[actions] correctLastTransaction", error); return { ok: false, replyText: "Não consegui atualizar agora 🙏." }; }
  const bal = await getMonthBalance(userId);

  try {
    await supabaseAdmin.from("transaction_edits" as any).insert({
      user_id: userId,
      transaction_id: target.id,
      field,
      old_value: oldValue,
      new_value: newValue,
      source: "whatsapp",
    });
  } catch { /* ignore */ }

  const label = target.description || target.category || "lançamento";
  const saldoLine = `🏦 Saldo do mês: *${BRL(bal.balance)}*`;
  if (field === "amount") {
    return { ok: true, replyText: `✅ Lançamento atualizado com sucesso!

📝 Descrição: ${label}
💰 Valor anterior: ${BRL(Number(oldValue))}
💰 Novo valor: ${BRL(Number(newValue))}
${saldoLine}` };
  }
  if (field === "payment_method") {
    return { ok: true, replyText: `✅ Lançamento atualizado com sucesso!

📝 Descrição: ${label}
💳 Forma de pagamento: ${input.new_payment_method}
${saldoLine}` };
  }
  return { ok: true, replyText: `✅ Lançamento atualizado com sucesso!

📝 Descrição: ${label}
${field === "category" ? "🏷️ Nova categoria" : "📝 Nova descrição"}: ${newValue}
${saldoLine}` };
}

// ===== Bulk =====

// Inferência de categoria por palavras-chave — usada como fallback quando o
// usuário envia listas multi-linhas sem categoria explícita.
const KEYWORD_CATEGORY: Array<[RegExp, string]> = [
  [/agua|água|luz|energia|internet|wifi|wi-?fi|aluguel|condom|iptu|gas\b|gás|cabo|telefone|celular|plano|mensalidade/i, "Moradia"],
  [/netflix|spotify|prime|streaming|hbo|disney|deezer|youtube\s*premium|apple\s*music|paramount|globoplay|max\b/i, "Assinaturas"],
  [/chatgpt|open\s*ai|midjourney|capcut|canva|notion|figma|adobe|dom[íi]nio|hospedagem|servidor|vps|cloud|aws|google\s*(one|workspace|drive)|microsoft\s*365|office\s*365|dropbox|icloud|zap[iy]|tiktok\s*shop|tiktok|meta\s*ads|facebook\s*ads|google\s*ads|an[úu]ncios?|impuls[ãa]o|tr[áa]fego|marketing|ferramenta|saas|licen[çc]a|assinatura|renova[çc][ãa]o/i, "Serviços Digitais"],
  [/mercado|supermercad|feira|padaria|pão|pao|lanche|restaur|ifood|hamb|pizza|almoço|almoco|janta|cafe|café|comida|açougue|hortifruti/i, "Alimentação"],
  [/gasolina|combust|etanol|alcool|álcool|posto|abasteci/i, "Combustível"],
  [/uber|99|taxi|táxi|onibus|ônibus|metr[ôo]|passagem|estaciona|pedagio|pedágio|carro|moto|oficina|mecanic|mecânic|ipva|licenciamento/i, "Transporte"],
  [/farmacia|farmácia|remedio|remédio|consulta|medic|hospital|dentist|exame|plano de saude|plano de saúde|psic[oó]log|academia|gym|crossfit/i, "Saúde"],
  [/curso|livro|escola|faculd|aula|material escolar|f[oó]rum|treinamento|mentoria/i, "Educação"],
  [/cinema|bar\b|cerveja|balada|festa|show|viagem|hotel|pousada|jogo|game|lazer/i, "Lazer"],
  [/cabelo|barbe|salão|salao|manicure|cosm[eé]tic|roupa|sapato|t[eê]nis|presente|perfume|shopping|celular\s*novo|smartphone|tv\b|televis[ãa]o|eletr[ôo]nico/i, "Pessoal"],
  [/picpay|caixinha|investiment|cdb|tesouro|ações|acoes|cripto|bitcoin/i, "Investimentos"],
  [/d[ií]zimo|oferta|igreja|culto/i, "Vida Espiritual"],
  [/cnpj|sócio|socio|funcionário|funcionario|escritório|escritorio|fornecedor/i, "Empresa e Autônomo"],
];
function inferCategoryFromText(text: string): string {
  for (const [re, cat] of KEYWORD_CATEGORY) if (re.test(text)) return cat;
  return "Outros";
}

export function inferTransactionCategory(text: string): string {
  return inferCategoryFromText(text);
}

type BulkFinancialItem = { kind: "expense" | "income"; amount: number; category: string; description: string; occurred_at?: string };
type SmartFinancialParse =
  | { ok: true; items: BulkFinancialItem[] }
  | { ok: false; replyText: string; reason: "divergence" | "missing_unit" | "ambiguous" };

// Mesmo padrão usado em todo o app (src/lib/money-speech.ts) — antes esta
// cópia local usava `*` em vez de `+` no grupo de milhar e permitia ponto OU
// vírgula como decimal solto, o que truncava valores sem separador de
// milhar: "1200,50" virava só "120" (o `\d{1,3}` bounded casava e parava
// aí, já que o resto da alternativa era opcional).
const MONEY_NUMBER = MONEY_TOKEN_PATTERN;
const MONEY_RE_GLOBAL = new RegExp(String.raw`(?:r\$\s*)?(${MONEY_NUMBER})(?:\s*(?:reais?|conto|pila))?`, "gi");
const INCOME_LINE_RE = /\b(recebi|ganhei|entrou|caiu|sal[áa]rio|freela|pix recebido)\b/i;
const HEADER_LINE_RE = /^[^0-9R$]+:\s*$/;

// Verbo de ação → substantivo canônico usado como descrição quando o texto
// não traz o objeto explícito ("Ontem abasteci R$ 200" → "Combustível").
const VERB_NOUN_MAP: Array<{ re: RegExp; noun: string; category?: string }> = [
  { re: /\babasteci\b/i, noun: "Combustível", category: "Transporte" },
  { re: /\balmocei\b/i, noun: "Almoço", category: "Alimentação" },
  { re: /\bjantei\b/i, noun: "Jantar", category: "Alimentação" },
  { re: /\bcafezinho\b|\bcafe\b/i, noun: "Café", category: "Alimentação" },
  { re: /\btorrei\b/i, noun: "Gasto", category: "Outros" },
  { re: /\binvesti\b/i, noun: "Investimento", category: "Outros" },
];
function verbNounFrom(text: string): { noun: string; category?: string } | null {
  for (const { re, noun, category } of VERB_NOUN_MAP) if (re.test(text)) return { noun, category };
  return null;
}


function parseMoneyBRL(raw: string): number | null {
  const clean = raw.replace(/r\$/gi, "").replace(/\b(reais?|conto|pila)\b/gi, "").replace(/\s/g, "").trim();
  return parseMoneyToken(clean);
}

export function moneyMatches(text: string): Array<{ amount: number; raw: string; start: number; end: number }> {
  const out: Array<{ amount: number; raw: string; start: number; end: number }> = [];
  let m: RegExpExecArray | null;
  MONEY_RE_GLOBAL.lastIndex = 0;
  while ((m = MONEY_RE_GLOBAL.exec(text))) {
    const amount = parseMoneyBRL(m[0]);
    if (amount != null) out.push({ amount, raw: m[0], start: m.index, end: m.index + m[0].length });
  }
  return out;
}

const COUNT_WORDS: Record<string, number> = {
  um: 1, uma: 1,
  dois: 2, duas: 2,
  tres: 3, três: 3,
  quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
  onze: 11, doze: 12, treze: 13, catorze: 14, quatorze: 14, quinze: 15,
  dezesseis: 16, dezassete: 17, dezessete: 17, dezoito: 18, dezenove: 19, vinte: 20,
};
const COUNT_TOKEN = String.raw`\d+|um|uma|dois|duas|tres|três|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|catorze|quatorze|quinze|dezesseis|dezassete|dezessete|dezoito|dezenove|vinte`;
const REPEAT_UNIT = String.raw`contas?|parcelas?|boletos?|compras?|pagamentos?|vezes|itens?|lançamentos?|lancamentos?|despesas?`;
const REPEATED_UNIT_RE = new RegExp(String.raw`\b(${COUNT_TOKEN})\s+(${REPEAT_UNIT})\b([\s\S]*)`, "i");
const TOTAL_CUE_RE = /\b(total(?:izando)?|soma|ao todo|valor final)\b/i;

function parseCountToken(token: string): number | null {
  const t = token.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (/^\d+$/.test(t)) return Number(t);
  return COUNT_WORDS[token.toLowerCase()] ?? COUNT_WORDS[t] ?? null;
}

function titleCasePT(text: string): string {
  return text
    .toLowerCase()
    .split(/\s+/g)
    .filter(Boolean)
    .map((w) => ["de", "do", "da", "dos", "das", "e"].includes(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
    .replace(/\bFórum\b/i, "Fórum");
}

function singularUnit(unitRaw: string): string {
  const u = unitRaw.toLowerCase();
  if (u.startsWith("parcela") || u === "vezes") return "Parcela";
  if (u.startsWith("conta")) return "Conta";
  if (u.startsWith("boleto")) return "Boleto";
  if (u.startsWith("compra")) return "Compra";
  if (u.startsWith("pagamento")) return "Pagamento";
  return "Item";
}

function cleanSubject(raw: string): string {
  return raw
    .replace(MONEY_RE_GLOBAL, " ")
    .replace(TOTAL_CUE_RE, " ")
    .replace(/\bcada\b|\bunit[áa]rio\b|\bunidade\b/gi, " ")
    .replace(/\b(de|do|da|dos|das|em|no|na|nos|nas|para|pra|por|a|ao|aos)\b/gi, " ")
    .replace(/[.,;:!?()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildRepeatedTitle(unitRaw: string, subjectRaw: string): string {
  const unit = singularUnit(unitRaw);
  const subject = titleCasePT(subjectRaw || unit);
  if (!subjectRaw) return unit;
  if (unit === "Parcela") return subject;
  if (unit === "Conta" && !/^conta\b/i.test(subject)) return `Conta de ${subject}`;
  if (unit === "Boleto" && !/^boleto\b/i.test(subject)) return `Boleto de ${subject}`;
  return subject;
}

function findTotalAmount(text: string): { amount: number; start: number; end: number } | null {
  const cue = text.search(TOTAL_CUE_RE);
  if (cue < 0) return null;
  const after = text.slice(cue);
  const matches = moneyMatches(after);
  if (!matches.length) return null;
  const first = matches[0];
  return { amount: first.amount, start: cue + first.start, end: cue + first.end };
}

function cents(n: number): number {
  return Math.round(n * 100);
}

function buildRepeatedItems(unitRaw: string, subjectRaw: string, amounts: number[]): BulkFinancialItem[] {
  const title = buildRepeatedTitle(unitRaw, subjectRaw);
  const unit = singularUnit(unitRaw);
  const category = inferCategoryFromText(`${title} ${unitRaw}`);
  return amounts.map((amount, index) => ({
    kind: "expense",
    amount,
    category,
    description: `${title} — ${unit === "Parcela" ? "Parcela " : ""}${index + 1}`,
  }));
}

function parseRepeatedUnitSegment(segment: string): SmartFinancialParse | null {
  const text = segment.replace(/\s+/g, " ").trim();
  const m = text.match(REPEATED_UNIT_RE);
  if (!m) return null;
  const qty = parseCountToken(m[1]);
  if (!qty || qty < 2 || qty > 50) return null;
  const unit = m[2];
  const rest = m[3] || "";
  const hasEach = /\bcada\b|\bunit[áa]rio\b|\bunidade\b/i.test(rest);
  const total = findTotalAmount(rest);
  const allAmounts = moneyMatches(rest);
  const itemAmounts = total ? allAmounts.filter((a) => !(a.start === total.start && a.end === total.end)) : allAmounts;

  if (hasEach) {
    const eachIndex = rest.search(/\bcada\b|\bunit[áa]rio\b|\bunidade\b/i);
    const beforeEach = eachIndex >= 0 ? rest.slice(0, eachIndex) : rest;
    const eachMatches = moneyMatches(beforeEach);
    const unitMoney = eachMatches[eachMatches.length - 1];
    if (!unitMoney) {
      return { ok: false, reason: "missing_unit", replyText: `Cada ${singularUnit(unit).toLowerCase()} possui qual valor?` };
    }
    if (total && cents(unitMoney.amount * qty) !== cents(total.amount)) {
      return { ok: false, reason: "divergence", replyText: "Encontrei uma divergência entre quantidade, valor unitário e total. Pode confirmar?" };
    }
    const subject = cleanSubject(beforeEach.slice(0, unitMoney.start));
    return { ok: true, items: buildRepeatedItems(unit, subject, Array.from({ length: qty }, () => unitMoney.amount)) };
  }

  if (total && itemAmounts.length === 0) {
    return { ok: false, reason: "missing_unit", replyText: `Cada ${singularUnit(unit).toLowerCase()} possui qual valor?` };
  }

  if (itemAmounts.length === 1) {
    if (total && cents(itemAmounts[0].amount * qty) === cents(total.amount)) {
      const subject = cleanSubject(rest.slice(0, itemAmounts[0].start));
      return { ok: true, items: buildRepeatedItems(unit, subject, Array.from({ length: qty }, () => itemAmounts[0].amount)) };
    }
    return { ok: false, reason: "ambiguous", replyText: `Cada ${singularUnit(unit).toLowerCase()} possui qual valor?` };
  }

  if (itemAmounts.length >= qty) {
    const values = itemAmounts.slice(0, qty).map((a) => a.amount);
    if (total && cents(values.reduce((s, n) => s + n, 0)) !== cents(total.amount)) {
      return { ok: false, reason: "divergence", replyText: "Encontrei uma divergência entre quantidade, valor unitário e total. Pode confirmar?" };
    }
    const subject = cleanSubject(rest.slice(0, itemAmounts[0].start));
    return { ok: true, items: buildRepeatedItems(unit, subject, values) };
  }

  return null;
}

function normalizeListLine(line: string): string {
  return line.trim().replace(/^[\s•\-*🔹·▪️–—]*(?:\d+[).:-]\s*)?/, "").trim();
}

function parseSimpleFinancialLine(line: string): BulkFinancialItem | null {
  const clean = normalizeListLine(line);
  if (!clean || HEADER_LINE_RE.test(clean)) return null;

  // Rejeita linha com múltiplos valores — vai para o parser inline.
  const monies = moneyMatches(clean);
  if (monies.length !== 1) return null;
  const money = monies[0];

  const isIncome = INCOME_LINE_RE.test(clean);
  // Extrai referência natural de data ANTES de limpar a descrição.
  const dateHint = extractDateHintSP(clean);
  // Se a referência for futura, este item vira compromisso — deixa para a IA.
  if (dateHint?.future) return null;

  // Contexto ao redor do valor (antes + depois), sem o valor em si e sem a referência de data.
  const contextRaw = (clean.slice(0, money.start) + " " + clean.slice(money.end));
  const withoutDate = stripDateHint(contextRaw, dateHint).toLowerCase();
  const desc = withoutDate
    .replace(/r\$/gi, " ")
    .replace(/\b(reais?|conto|pila)\b/gi, " ")
    .replace(/\b(paguei|gastei|comprei|compro|adquiri|recebi|ganhei|entrou|caiu|abasteci|almocei|jantei|torrei|investi|assinei|renovei|contratei|desembolsei|peguei|passei|coloquei|reforcei|refor[çc]ei|fiz|pagando|gastando|comprando|recebendo|assinando|renovando|contratando)\b/gi, " ")
    .replace(/\b(hoje|ontem|agora|depois|ent[ãa]o|a[ií]|de|do|da|dos|das|no|na|nos|nas|em|pra|para|pro|com|um|uma|uns|umas|meu|minha|meus|minhas|no\s+cart[ãa]o|no\s+d[eé]bito|no\s+cr[eé]dito)\b/gi, " ")
    .replace(/[.,;:!?()"'“”\-–—•]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Se o texto só trazia um verbo de ação (ex.: "abasteci R$ 200"), usa o
  // substantivo canônico do verbo como descrição.
  const vn = verbNounFrom(clean);
  const finalDesc = desc && desc.length >= 2
    ? desc
    : (vn?.noun ?? (isIncome ? "Receita" : "Gasto avulso"));

  const short = finalDesc.split(" ").slice(0, 4).join(" ");
  return {
    kind: isIncome ? "income" : "expense",
    amount: money.amount,
    category: isIncome ? "Receita" : (inferCategoryFromText(short) !== "Outros" ? inferCategoryFromText(short) : (vn?.category ?? "Outros")),
    description: titleCasePT(short).slice(0, 40),
    occurred_at: dateHint?.iso,
  };
}


// Detector determinístico de UMA saída/entrada de dinheiro em linguagem natural,
// mesmo sem a palavra "gastei". Basta o texto conter um verbo de compra/pagamento
// (ou receita) + um valor monetário. Usado como REDE DE SEGURANÇA quando a IA
// devolve "unknown" / chat genérico para frases claramente financeiras
// (ex.: "Comprei conta TikTok Shop 200", "Peguei gasolina 250", "Assinei ChatGPT por 97").
const SPONTANEOUS_EXPENSE_VERBS = /\b(gastei|gasto|paguei|comprei|compro|adquiri|abasteci|almocei|jantei|torrei|investi|assinei|renovei|contratei|desembolsei|peguei|passei|coloquei|reforcei|refor[çc]ei|saiu|transferi|mandei\s+um\s+pix|fiz\s+um\s+pix|fiz\s+(?:mercado|feira|compras?|abastecimento|uma\s+compra|um\s+pagamento)|passei\s+no\s+cart[ãa]o|coloquei\s+cr[ée]dito|dei\s+entrada|paguei\s+uma\s+conta)\b/i;
const SPONTANEOUS_INCOME_VERBS = /\b(recebi|ganhei|entrou|caiu|caiu\s+um\s+pix|caiu\s+na\s+conta|pingou|pinguei|recebido|sal[áa]rio|freela|pix\s+recebido|renda|comiss[ãa]o|cliente\s+pagou|fiz\s+uma\s+venda|entrou\s+comiss[ãa]o|entrou\s+pagamento)\b/i;

export function detectSpontaneousExpenseIntent(input: string): BulkFinancialItem | null {
  if (!input) return null;
  const raw = input.trim();
  if (raw.length < 3) return null;
  // Rejeita perguntas ("quanto gastei?") — não é registro.
  if (/\?\s*$/.test(raw)) return null;
  if (/\b(quanto|qual|quais|como|onde|quando)\b/i.test(raw) && !SPONTANEOUS_INCOME_VERBS.test(raw)) return null;

  const isIncome = SPONTANEOUS_INCOME_VERBS.test(raw);
  const bareCategory = inferCategoryFromText(raw);
  const bareAmounts = moneyMatches(raw);
  const isBareExpense = bareCategory !== "Outros" && bareAmounts.length === 1 && /[a-zá-ú]/i.test(raw);
  const isExpense = !isIncome && (SPONTANEOUS_EXPENSE_VERBS.test(raw) || isBareExpense);
  if (!isExpense && !isIncome) return null;

  const monies = moneyMatches(raw);
  if (monies.length !== 1) return null;
  const money = monies[0];

  // Descarta se o número é claramente hora/data ("dia 15", "às 14", "3h").
  const before = raw.slice(Math.max(0, money.start - 12), money.start).toLowerCase();
  const after = raw.slice(money.end, money.end + 6).toLowerCase();
  if (/\bdia\s*$|\b[àa]s?\s*$|\bhora[s]?\s*$/.test(before)) return null;
  if (/^\s*h\b|^h\d/.test(after)) return null;

  const dateHint = extractDateHintSP(raw);
  if (dateHint?.future && isExpense) return null; // referência futura → compromisso, tratado fora

  const contextRaw = (raw.slice(0, money.start) + " " + raw.slice(money.end));
  const withoutDate = stripDateHint(contextRaw, dateHint).toLowerCase();
  const desc = withoutDate
    .replace(/r\$/gi, " ")
    .replace(/\b(reais?|conto|pila)\b/gi, " ")
    .replace(/\b(paguei|gastei|comprei|compro|adquiri|recebi|ganhei|entrou|caiu|abasteci|almocei|jantei|torrei|investi|assinei|renovei|contratei|desembolsei|peguei|passei|coloquei|reforcei|refor[çc]ei|fiz)\b/gi, " ")
    .replace(/\b(hoje|ontem|agora|depois|ent[ãa]o|de|do|da|dos|das|no|na|nos|nas|em|pra|para|pro|por|com|um|uma|uns|umas|meu|minha|meus|minhas)\b/gi, " ")
    .replace(/\b(no\s+cart[ãa]o|no\s+d[eé]bito|no\s+cr[eé]dito|cart[ãa]o|d[eé]bito|cr[eé]dito|dinheiro|pix|boleto)\b/gi, " ")
    .replace(/[.,;:!?()"'“”\-–—•]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const vn = verbNounFrom(raw);
  const finalDesc = desc && desc.length >= 2
    ? desc
    : (vn?.noun ?? (isIncome ? "Receita" : "Gasto avulso"));
  const short = finalDesc.split(" ").slice(0, 5).join(" ");
  const category = isIncome
    ? "Receita"
    : (inferCategoryFromText(raw) !== "Outros" ? inferCategoryFromText(raw) : (vn?.category ?? "Outros"));

  return {
    kind: isIncome ? "income" : "expense",
    amount: money.amount,
    category,
    description: titleCasePT(short).slice(0, 48),
    occurred_at: dateHint?.iso,
  };
}


export function parseSmartFinancialMessage(input: string): SmartFinancialParse | null {
  if (!input || input.trim().length < 6) return null;
  const rawLines = input.split(/\r?\n|;/g).map((l) => l.trim()).filter(Boolean);
  const lineItems: BulkFinancialItem[] = [];
  let skipped = 0;

  if (rawLines.length >= 2) {
    for (const line of rawLines) {
      const normalized = normalizeListLine(line);
      if (!normalized || HEADER_LINE_RE.test(normalized)) continue;
      const repeated = parseRepeatedUnitSegment(normalized);
      if (repeated) {
        if (!repeated.ok) return repeated;
        lineItems.push(...repeated.items);
        continue;
      }
      const simple = parseSimpleFinancialLine(normalized);
      if (simple) lineItems.push(simple);
      else skipped++;
    }
    if (lineItems.length >= 2 && skipped <= Math.max(2, lineItems.length)) return { ok: true, items: lineItems };
  }

  const repeated = parseRepeatedUnitSegment(input);
  if (repeated) return repeated;

  const inline = parseInlineBulkProse(input);
  if (inline && inline.length >= 2) return { ok: true, items: inline };
  return null;
}

// Parser determinístico para listas multi-linhas tipo:
//   "Água - R$ 100,00"
//   "Internet 150"
//   "• Aluguel — 800,00"
// Retorna items prontos para processBulk, ou null se o texto não parece lista.
export function parseBulkLines(input: string): Array<{ kind: "expense" | "income"; amount: number; category: string; description: string; occurred_at?: string }> | null {
  if (!input) return null;
  const rawLines = input.split(/\r?\n|;/g).map((l) => l.trim()).filter(Boolean);
  if (rawLines.length < 2) return null;

  const items: Array<{ kind: "expense" | "income"; amount: number; category: string; description: string; occurred_at?: string }> = [];
  let skipped = 0;

  for (const line of rawLines) {
    const repeated = parseRepeatedUnitSegment(line);
    if (repeated?.ok) { items.push(...repeated.items); continue; }
    const item = parseSimpleFinancialLine(line);
    if (item) items.push(item);
    else if (!HEADER_LINE_RE.test(line)) skipped++;
  }

  if (items.length < 2) return null;
  if (skipped > items.length) return null;
  return items;
}

// Parser determinístico para PROSA INLINE com múltiplos valores:
//   "Hoje abasteci R$ 180, depois passei no mercado e gastei R$ 245,90.
//    Na volta comprei um lanche de R$ 32 e recebi R$ 650 do aplicativo."
//   "Gastei 120 mercado, 60 farmácia, 150 combustível e recebi 900"
// Usado como rede de segurança quando a IA retorna um único item apesar
// de a mensagem conter 2+ valores em reais.
export function parseInlineBulkProse(
  input: string,
): Array<{ kind: "expense" | "income"; amount: number; category: string; description: string; occurred_at?: string }> | null {
  if (!input) return null;
  const text = input.replace(/\s+/g, " ").trim();
  if (text.length < 10) return null;

  const INCOME_VERBS = /\b(recebi|ganhei|entrou|caiu|recebido|sal[áa]rio|freela|pix\s+recebido|renda|comiss[ãa]o)\b/i;
  const EXPENSE_VERBS = /\b(gastei|gasto|paguei|comprei|compro|adquiri|abasteci|almocei|jantei|torrei|investi|assinei|renovei|contratei|desembolsei|peguei|passei|coloquei|reforcei|refor[çc]ei|fiz\s+(?:mercado|feira|compras?|abastecimento)|passei\s+no\s+cart[ãa]o|coloquei\s+cr[ée]dito)\b/i;
  const MONEY_RE = /(?:r\$\s*)?(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)(\s*(reais?|conto|pila))?/gi;

  // Coletar posições de cada valor monetário com cue de moeda OU verbo próximo
  const moneyMatches: Array<{ amount: number; start: number; end: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = MONEY_RE.exec(text))) {
    const raw = m[0];
    const numRaw = m[1];
    const hasCurrency = /r\$/i.test(raw) || !!m[3];
    const before = text.slice(Math.max(0, m.index - 25), m.index).toLowerCase();
    const after = text.slice(m.index + raw.length, m.index + raw.length + 12).toLowerCase();
    // Descartar "dia 10", "às 14h", "10h", horários e datas
    if (/\bdia\s*$|\bàs?\s*$|\bhora[s]?\s*$/.test(before)) continue;
    if (/^\s*h\b|^h\d/.test(after)) continue;
    // Descartar ordinais ("1ª", "2º"), contadores ("2 contas", "3 vezes", "5 parcelas"),
    // multiplicadores ("2x") — não são valores monetários.
    if (/^[ºªo°]/.test(after)) continue;
    if (/^\s*(contas?|vezes|itens?|dias?|semanas?|meses|anos?|parcelas?|lançamentos?|lancamentos?|despesas?|receitas?|gastos?|x\b)/i.test(after)) continue;
    // Sem cue de moeda nem verbo próximo: provavelmente não é dinheiro
    if (!hasCurrency && !INCOME_VERBS.test(before) && !EXPENSE_VERBS.test(before)) continue;
    const clean = numRaw.includes(",")
      ? numRaw.replace(/\./g, "").replace(",", ".")
      : (numRaw.split(".").pop()?.length === 3 ? numRaw.replace(/\./g, "") : numRaw);
    const amount = Number(clean);
    if (!Number.isFinite(amount) || amount < 1) continue;
    moneyMatches.push({ amount, start: m.index, end: m.index + raw.length });
  }
  if (moneyMatches.length < 2) return null;

  const items: Array<{ kind: "expense" | "income"; amount: number; category: string; description: string; occurred_at?: string }> = [];
  let lastVerb: "income" | "expense" = "expense";
  let prevEnd = 0;
  // Assunto comum extraído do prelúdio (texto antes do 1º valor): usado como
  // descrição/categoria padrão quando os itens são enumerados (1ª, 2ª, "primeira, segunda").
  const preludeRaw = text.slice(0, moneyMatches[0].start);
  const SUBJECT_RE = /\b(conta|contas|boleto|boletos|fatura|faturas|parcela|parcelas|débito|debito|pagamento|pagamentos)\s+(?:de\s+)?([a-záàâãéêíóôõúç\s]{2,40}?)(?=[.,;:!?]|$|\s+\d|\s+r\$)/i;
  const preludeSubjectMatch = preludeRaw.match(SUBJECT_RE);
  const sharedSubject = preludeSubjectMatch
    ? `${preludeSubjectMatch[1]} de ${preludeSubjectMatch[2].trim()}`.replace(/\s+/g, " ").trim()
    : "";
  const sharedCategory = sharedSubject ? inferCategoryFromText(sharedSubject) : "";

  for (let i = 0; i < moneyMatches.length; i++) {
    const cur = moneyMatches[i];
    // Janela: apenas o TRECHO que contém este valor, delimitado por
    // separadores de sentença (`.`, `\n`, `;`, `!`, `?`). Evita descrição
    // "vazando" para o próximo lançamento (ex.: "mercado gastei almoço").
    const SEP_RE = /[.\n;!?]/g;
    let segStart = 0;
    SEP_RE.lastIndex = 0;
    let sm: RegExpExecArray | null;
    while ((sm = SEP_RE.exec(text))) {
      if (sm.index >= cur.start) break;
      segStart = sm.index + 1;
    }
    let segEnd = text.length;
    SEP_RE.lastIndex = cur.end;
    const sn = SEP_RE.exec(text);
    if (sn) segEnd = sn.index;
    const segment = text.slice(segStart, segEnd);
    if (INCOME_VERBS.test(segment)) lastVerb = "income";
    else if (EXPENSE_VERBS.test(segment)) lastVerb = "expense";

    // Data por-segmento (ontem/hoje/última sexta/15/07/dia 15/…).
    const dateHint = extractDateHintSP(segment);
    // Data futura no segmento → não é uma despesa passada. Pula este item;
    // o classificador principal cuida como compromisso.
    if (dateHint?.future) { prevEnd = cur.end; continue; }
    const segmentNoDate = stripDateHint(segment, dateHint);

    // Descrição: só o que está no segmento, sem o próprio valor,
    // sem verbos/preposições/ordinais e sem a referência de data.
    const desc = segmentNoDate
      .replace(MONEY_RE, " ")
      .replace(/\b\d+[ºªo°]?\b/gi, " ")
      .replace(/\b(primeira|segunda|terceira|quarta|quinta|sexta|s[eé]tima|oitava|nona|d[eé]cima)\b/gi, " ")
      .replace(/\b(paguei|gastei|comprei|recebi|ganhei|entrou|caiu|abasteci|almocei|jantei|torrei|investi|hoje|ontem|agora|depois|ent[ãa]o|a[ií]|na volta|um|uma|uns|umas|de|do|da|dos|das|no|na|nos|nas|em|pro|pra|para|para o|para a|com|e|reais?|r\$|disso|meu|minha|meus|minhas)\b/gi, " ")
      .replace(/[.,;:!?()"'“”\-–—•]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const vn = verbNounFrom(segment);
    const fallbackDesc = (desc && desc.length >= 2) ? desc : (vn?.noun ?? (sharedSubject || (lastVerb === "income" ? "Receita" : "Gasto")));
    const short = fallbackDesc.split(" ").slice(0, 4).join(" ");
    const description = titleCasePT(short).slice(0, 40);
    const category = lastVerb === "income"
      ? "Receita"
      : (inferCategoryFromText(segment) !== "Outros"
          ? inferCategoryFromText(segment)
          : (vn?.category ?? sharedCategory ?? "Outros"));

    items.push({ kind: lastVerb, amount: cur.amount, category, description, occurred_at: dateHint?.iso });
    prevEnd = cur.end;
  }


  if (items.length < 2) return null;
  return items;
}

// ============================================================================
// REGRA CRÍTICA — NUNCA INVENTAR LANÇAMENTOS
// O número de lançamentos é definido pelas EVIDÊNCIAS (valores monetários),
// nunca por palavras de contexto ("ida e volta", "casal", "família"...).
// Se há apenas UM valor na mensagem:
//   - 1 assunto  → 1 lançamento único
//   - 2+ assuntos claramente distintos ("mercado e farmácia 200") → PERGUNTA
// ============================================================================

// Palavras que apenas descrevem o contexto da despesa — jamais indicam
// múltiplos lançamentos.
const CONTEXT_ONLY_RE =
  /\b(ida|volta|idas|voltas|casal|nos|n[óo]s|familia|fam[íi]lia|equipe|time|turma|galera|pessoal|viagem|cliente|esposa|marido|mulher|namorad[ao]|filh[oa]s?|amig[oa]s?|crian[çc]as?|todo\s+mundo|dois|duas|juntos?)\b/gi;

// Assuntos de despesa reconhecíveis (usados só para detectar AMBIGUIDADE).
const SUBJECT_LEXICON: Array<[string, RegExp]> = [
  ["mercado", /\b(mercado|supermercado|feira|compras\s+do\s+m[êe]s)\b/i],
  ["farmácia", /\b(farmacia|farm[áa]cia|drogaria|rem[ée]dio?s?)\b/i],
  ["hotel", /\b(hotel|pousada|hosped(?:agem|aria)|airbnb)\b/i],
  ["estacionamento", /\b(estacionamento|zona\s+azul|parqu[ií]metro)\b/i],
  ["uber", /\b(uber|99|taxi|t[áa]xi|corrida)\b/i],
  ["combustível", /\b(gasolina|combustivel|combust[íi]vel|etanol|alcool|[áa]lcool|diesel|posto|abasteci\w*)\b/i],
  ["lanche", /\b(lanche|lanches|salgado|salgados|padaria|cafe|caf[ée])\b/i],
  ["almoço", /\b(almo[çc]o|almo[çc]ei)\b/i],
  ["jantar", /\b(jantar|janta|jantei)\b/i],
  ["restaurante", /\b(restaurante|churrascaria|pizzaria|hamburgueria|lanchonete)\b/i],
  ["cinema", /\b(cinema|filme|ingresso)\b/i],
  ["academia", /\b(academia|gym|crossfit)\b/i],
  ["internet", /\b(internet|wifi|wi-fi|banda\s+larga)\b/i],
  ["luz", /\b(luz|energia|el[ée]trica|enel|cemig|light)\b/i],
  ["água", /\b(agua|[áa]gua|saneamento|sabesp)\b/i],
  ["aluguel", /\b(aluguel|condominio|condom[íi]nio)\b/i],
  ["escola", /\b(escola|faculdade|curso|mensalidade|material\s+escolar)\b/i],
  ["pedágio", /\b(pedagio|ped[áa]gio)\b/i],
  ["roupa", /\b(roupa|roupas|cal[çc]ado|t[êe]nis|sapato|camisa)\b/i],
  ["presente", /\b(presente|presentes)\b/i],
  ["pet", /\b(pet|petshop|ra[çc][ãa]o|veterinario|veterin[áa]rio)\b/i],
];

function extractExpenseSubjects(text: string): string[] {
  const cleaned = text.replace(MONEY_RE_GLOBAL, " ").replace(CONTEXT_ONLY_RE, " ");
  const found: string[] = [];
  for (const [name, re] of SUBJECT_LEXICON) {
    if (re.test(cleaned) && !found.includes(name)) found.push(name);
  }
  return found;
}

export type SplitAmbiguity = { subjects: string[]; amount: number; replyText: string };

/**
 * Detecta ambiguidade: UM único valor monetário na mensagem, mas dois ou mais
 * assuntos distintos ligados por "e"/","/"+" — ou um compartilhamento explícito
 * ("almoço meu e da esposa 120"). Nesses casos NUNCA registramos: perguntamos.
 */
export function detectSingleAmountAmbiguity(input: string): SplitAmbiguity | null {
  if (!input) return null;
  const text = input.replace(/\s+/g, " ").trim();
  if (text.length < 6) return null;
  const monies = moneyMatches(text);
  if (monies.length !== 1) return null;

  const hasConjunction = /(\s+e\s+|,|\+|\/)/i.test(text);
  if (!hasConjunction) return null;

  const subjects = extractExpenseSubjects(text);
  const sharedPossessive = /\b(meu|minha|meus|minhas)\s+e\s+d[ao]s?\b/i.test(text);

  if (subjects.length < 2 && !(sharedPossessive && subjects.length >= 1)) return null;

  const amount = monies[0].amount;
  const brl = amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const labels = subjects.map((s) => titleCasePT(s));
  const listed = labels.length >= 2
    ? `${labels.slice(0, -1).join(", ")} e ${labels[labels.length - 1]}`
    : labels[0];

  const replyText = sharedPossessive && subjects.length < 2
    ? `Só pra não errar 🙂\nEsses ${brl} de ${listed} foram um gasto único ou você quer separar em dois lançamentos?\nResponde *único* ou me manda os valores separados (ex.: "${listed} 60 e ${listed} 60").`
    : `Só pra não errar 🙂\nEsses ${brl} foram *um único gasto* de ${listed}, ou são lançamentos separados?\nResponde *único* ou me manda os valores separados (ex.: "${labels[0]} 120 e ${labels[1]} 80").`;

  return { subjects, amount, replyText };
}

function describeWholeMessage(text: string): string {
  const desc = text
    .replace(MONEY_RE_GLOBAL, " ")
    .replace(/\b(reais?|conto|pila|r\$)\b/gi, " ")
    .replace(/\b(paguei|gastei|comprei|adquiri|recebi|ganhei|abasteci|almocei|jantei|torrei|investi|assinei|peguei|passei|fiz|hoje|ontem|agora)\b/gi, " ")
    .replace(/[.,;:!?()"'“”\-–—•]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const short = desc.split(" ").slice(0, 7).join(" ");
  return titleCasePT(short || "Gasto").slice(0, 60);
}

export type SplitGuardResult =
  | { ok: true; items: Array<Record<string, any>> }
  | { ok: false; replyText: string };

/**
 * Garante que o número de lançamentos tenha evidência na mensagem.
 * - Mais de um item, mas apenas um valor monetário → colapsa em 1 lançamento
 *   (ou pergunta, se houver assuntos distintos).
 * - Um item só, mas mensagem ambígua → pergunta antes de registrar.
 */
export function guardSplitByEvidence(
  sourceText: string,
  items: Array<Record<string, any>>,
): SplitGuardResult {
  const text = (sourceText ?? "").replace(/\s+/g, " ").trim();
  if (!text) return { ok: true, items };

  const ambiguity = detectSingleAmountAmbiguity(text);
  if (ambiguity) return { ok: false, replyText: ambiguity.replyText };

  const monies = moneyMatches(text);
  if (monies.length <= 1 && items.length >= 2) {
    const amount = monies.length === 1
      ? monies[0].amount
      : Number(items[0]?.amount) || 0;
    if (!(amount > 0)) return { ok: true, items: [items[0]] };
    const base = items[0] ?? {};
    return {
      ok: true,
      items: [{
        ...base,
        kind: base.kind === "income" ? "income" : "expense",
        amount,
        description: describeWholeMessage(text) || base.description,
      }],
    };
  }

  return { ok: true, items };
}



export async function processBulk(
  userId: string,
  items: Array<Record<string, any>>,
): Promise<{ replyText: string; ok: boolean }> {
  const created: Array<{ kind: string; category?: string; amount?: number; title?: string }> = [];
  let failed = 0;

  for (const it of items) {
    try {
      switch (it.kind) {
        case "expense": {
          const inferred = inferCategoryFromText(`${it.description ?? ""} ${it.title ?? ""}`);
          const category = inferred !== "Outros"
            ? inferred
            : ((CATEGORIES as readonly string[]).includes(it.category ?? "") ? it.category! : "Outros");
          const r = await recordExpense(userId, { amount: it.amount, category, description: it.description ?? it.title, occurred_at: it.occurred_at, credit_card_hint: it.credit_card_hint });
          if (r.duplicate) { /* dup: ignora silenciosamente */ }
          else if (r.ok && r.row) created.push({ kind: "expense", category: r.row.category, amount: Number(r.row.amount), title: r.row.description ?? undefined });
          else failed++;
          break;
        }
        case "income": {
          const r = await recordIncome(userId, { amount: it.amount, description: it.description ?? it.title, occurred_at: it.occurred_at });
          if (r.duplicate) { /* dup: ignora silenciosamente */ }
          else if (r.ok && r.row) created.push({ kind: "income", category: r.row.category, amount: Number(r.row.amount), title: r.row.description ?? undefined });
          else failed++;
          break;
        }
        case "appointment":
          if (it.scheduled_at) {
            await recordAppointment(userId, { title: it.appointment_title ?? it.title ?? it.description ?? "Compromisso", scheduled_at: it.scheduled_at, notes: it.description });
            created.push({ kind: "appointment", title: it.appointment_title ?? it.title ?? it.description });
          } else failed++;
          break;
        case "bill": {
          const r = await recordBill(userId, { title: it.title ?? it.description, amount: it.amount, frequency: it.frequency, next_due_at: it.next_due_at, category: it.category });
          if (r.ok) created.push({ kind: "bill", title: it.title ?? it.description, amount: it.amount }); else failed++;
          break;
        }
        case "installment": {
          const r = await recordInstallment(userId, { title: it.title ?? it.description, amount: it.amount, installments_total: it.installments_total, installments_paid: it.installments_paid, total_amount: it.total_amount });
          if (r.ok) created.push({ kind: "installment", title: it.title ?? it.description, amount: it.amount }); else failed++;
          break;
        }
        case "debt": {
          const r = await recordDebt(userId, { title: it.title ?? it.description, amount: it.amount, creditor: it.creditor, description: it.description });
          if (r.ok) created.push({ kind: "debt", title: it.title ?? it.description, amount: it.amount }); else failed++;
          break;
        }
        case "goal": {
          const r = await recordGoal(userId, { title: it.title ?? it.description, target_amount: it.target_amount, amount: it.amount, target_date: it.target_date });
          if (r.ok) created.push({ kind: "goal", title: it.title ?? it.description, amount: it.amount }); else failed++;
          break;
        }
        default:
          failed++;
      }
    } catch (e) {
      console.error("[actions] processBulk item failed", e);
      failed++;
    }
  }

  if (created.length === 0) {
    return {
      ok: false,
      replyText: failed
        ? `⚠️ Tive um problema ao registrar os ${failed} ite${failed === 1 ? "m" : "ns"} da sua lista. Pode reenviar? Nenhum dado foi salvo.`
        : "Não consegui identificar nenhum item válido na lista 🤔. Pode mandar de novo com valores?",
    };
  }

  const lines = created.map((c) => {
    const emoji = c.category ? (CAT_EMOJI[c.category] ?? "🛒")
      : c.kind === "appointment" ? "📅"
      : c.kind === "bill" ? "📄"
      : c.kind === "installment" ? "💳"
      : c.kind === "debt" ? "🧾"
      : c.kind === "goal" ? "🎯" : "✅";
    const value = c.amount != null ? ` — *${BRL(c.amount)}*` : "";
    const title = (c.title ?? c.category ?? "Item").toString();
    return `${emoji} ${title}${value}`;
  });

  const totalValue = created
    .filter((c) => (c.kind === "expense" || c.kind === "income" || c.kind === "bill" || c.kind === "installment") && c.amount != null)
    .reduce((s, c) => s + (c.amount ?? 0), 0);

  // Sumário por tipo (conforme padrão pedido)
  const tally: Record<string, number> = {};
  for (const c of created) tally[c.kind] = (tally[c.kind] ?? 0) + 1;
  const summaryParts: string[] = [];
  const fmtKind = (kind: string, n: number) => {
    const map: Record<string, [string, string, string]> = {
      income:      ["💰", "receita", "receitas"],
      expense:     ["💸", "despesa", "despesas"],
      appointment: ["📅", "lembrete", "lembretes"],
      bill:        ["🏠", "conta fixa", "contas fixas"],
      installment: ["💳", "parcelamento", "parcelamentos"],
      debt:        ["🧾", "dívida", "dívidas"],
      goal:        ["🎯", "meta", "metas"],
    };
    const [emoji, sg, pl] = map[kind] ?? ["✅", kind, kind];
    return `${emoji} ${n} ${n === 1 ? sg : pl}`;
  };
  for (const k of ["income", "expense", "bill", "installment", "debt", "appointment", "goal"]) {
    if (tally[k]) summaryParts.push(fmtKind(k, tally[k]));
  }

  const count = created.length;
  const header = `✅ *Processamento concluído!*\n\nForam registrados:\n${summaryParts.join("\n")}`;
  const detail = `\n\n━━━━━━━━━━━━━━\n${lines.join("\n")}`;
  const totalLine = totalValue > 0 ? `\n\n💰 *Total registrado:* ${BRL(totalValue)}` : "";
  const warn = failed ? `\n\n⚠️ ${failed} ite${failed === 1 ? "m" : "ns"} não pude registrar — pode reenviar só ess${failed === 1 ? "e" : "es"}.` : "";
  const bal = await getMonthBalance(userId);
  const balanceLine = `\n\n💰 Saldo do mês: *${BRL(bal.balance)}*`;

  return {
    ok: true,
    replyText: `${header}${detail}${totalLine}${balanceLine}${warn}`,
  };
}


// ===============================================================
// Queries de módulos específicos — respostas SEMPRE baseadas no
// banco de dados do usuário, sem misturar módulos.
// ===============================================================

const DAY_MS = 86400000;

function ymd(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function fmtDueDay(next_due_at: string | null | undefined, frequency: string | null | undefined): string {
  if (!next_due_at) return "—";
  const d = new Date(String(next_due_at) + "T12:00:00");
  const dia = String(d.getUTCDate()).padStart(2, "0");
  if (frequency === "monthly") return `Vence dia ${dia}`;
  return `Vence ${dia}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Consulta contas fixas do usuário (recurring_bills). */
export async function queryBills(
  userId: string,
  opts?: { filter?: "all" | "upcoming" | "overdue" | "pending"; hint?: string; dueDay?: number },
): Promise<{ replyText: string }> {
  const { data, error } = await supabaseAdmin
    .from("recurring_bills")
    .select("title, amount, original_amount, paid_amount, frequency, next_due_at, payment_status, active, category")
    .eq("user_id", userId)
    .eq("active", true)
    .order("next_due_at", { ascending: true });
  if (error) {
    console.error("[actions] queryBills", error);
    return { replyText: "Não consegui buscar suas contas fixas agora 🙏." };
  }
  let list = (data ?? []) as any[];
  if (list.length === 0) {
    return { replyText: "📭 Você ainda não possui contas fixas cadastradas.\n\n➕ Deseja cadastrar uma agora? Ex.: _aluguel 900 todo dia 5_" };
  }

  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const in30 = new Date(today.getTime() + 30 * DAY_MS);

  const hint = (opts?.hint || "").toLowerCase().trim();
  if (hint) {
    const h = list.filter((b) => (b.title || "").toLowerCase().includes(hint) || (b.category || "").toLowerCase().includes(hint));
    if (h.length > 0) list = h;
    else return { replyText: `🔍 Não encontrei nenhuma conta fixa com "${opts?.hint}". Envie *minhas contas fixas* para ver todas.` };
  }

  if (opts?.dueDay && Number.isFinite(opts.dueDay)) {
    list = list.filter((b) => {
      if (!b.next_due_at) return false;
      const d = new Date(String(b.next_due_at) + "T12:00:00");
      return d.getUTCDate() === opts.dueDay;
    });
    if (list.length === 0) {
      return { replyText: `📭 Nenhuma conta fixa vencendo no dia ${opts.dueDay}.` };
    }
  }

  if (opts?.filter === "overdue") {
    list = list.filter((b) => b.next_due_at && new Date(String(b.next_due_at) + "T12:00:00") < today);
    if (list.length === 0) return { replyText: "✅ Você não possui contas fixas atrasadas. Tudo em dia!" };
  } else if (opts?.filter === "upcoming") {
    list = list.filter((b) => {
      if (!b.next_due_at) return false;
      const d = new Date(String(b.next_due_at) + "T12:00:00");
      return d >= today && d <= in30;
    });
    if (list.length === 0) return { replyText: "📭 Nenhuma conta fixa vence nos próximos 30 dias." };
  } else if (opts?.filter === "pending") {
    list = list.filter((b) => ["pending", "awaiting", "late", "partial"].includes(String(b.payment_status || "pending")));
    if (list.length === 0) return { replyText: "✅ Nenhuma conta fixa pendente no momento." };
  }

  // Total considera SALDO RESTANTE do ciclo (nunca o valor original quando já houve pagamento parcial).
  let totalOutstanding = 0;
  const lines = list.slice(0, 20).map((b) => {
    const emoji = CAT_EMOJI[b.category as string] || "📄";
    const original = Number(b.original_amount ?? b.amount ?? 0);
    const paid = Number(b.paid_amount ?? 0);
    const remaining = Math.max(0, Math.round((original - paid) * 100) / 100);
    totalOutstanding += remaining > 0 ? remaining : original;
    const st = String(b.payment_status || "pending");
    const statusIcon = st === "paid" ? " ✅"
      : st === "late" ? " 🔴"
      : st === "awaiting" ? " 🟡"
      : st === "partial" ? " 🟠"
      : "";
    if (paid > 0 && remaining > 0) {
      return `${emoji} *${b.title}*\nValor original: ${BRL(original)}\nJá pago: ${BRL(paid)}\nRestante: *${BRL(remaining)}* · ${fmtDueDay(b.next_due_at, b.frequency)}${statusIcon}\nStatus: 🟠 Pagamento parcial`;
    }
    return `${emoji} *${b.title}*\n${BRL(original)} · ${fmtDueDay(b.next_due_at, b.frequency)}${statusIcon}`;
  });

  const header = opts?.filter === "overdue" ? "🔴 *Contas fixas atrasadas*"
    : opts?.filter === "upcoming" ? "⏰ *Contas fixas próximas (30 dias)*"
    : opts?.filter === "pending" ? "🟡 *Contas fixas pendentes*"
    : opts?.dueDay ? `📅 *Contas fixas — vencimento dia ${opts.dueDay}*`
    : hint ? `📄 *Contas fixas — "${opts?.hint}"*`
    : "📅 *Suas contas fixas cadastradas*";

  return {
    replyText: `${header}\n\n${lines.join("\n\n")}\n\n💰 *Total ainda pendente:* ${BRL(totalOutstanding)}${list.length > 20 ? `\n\n_Exibindo 20 de ${list.length}._` : ""}`,
  };
}


/** Consulta parcelamentos ativos (installment_purchases). */
export type InstallmentListItem = { n: number; kind: "installment" | "bill"; id: string; title: string };

/**
 * Numera cada parcelamento/conta-com-prazo (1, 2, 3...) e devolve a lista
 * junto com o texto — quem chama guarda essa lista em last_query_context
 * pra que "muda o vencimento do 2 pra dia 15" resolva o alvo certo sem o
 * usuário precisar repetir o nome.
 */
export async function queryInstallments(userId: string): Promise<{ replyText: string; items: InstallmentListItem[] }> {
  const [{ data, error }, { data: bills }] = await Promise.all([
    supabaseAdmin
      .from("installment_purchases")
      .select("id, title, total_amount, installments_total, installments_paid, first_due_at")
      .eq("user_id", userId)
      .eq("active", true)
      .order("created_at", { ascending: false }),
    supabaseAdmin
      .from("recurring_bills")
      .select("*")
      .eq("user_id", userId)
      .not("total_installments", "is", null)
      .order("created_at", { ascending: false }),
  ]);
  if (error) return { replyText: "Não consegui buscar seus parcelamentos 🙏.", items: [] };
  const list = (data ?? []) as any[];
  const billList = (bills ?? []) as any[];
  if (list.length === 0 && billList.length === 0) {
    return { replyText: "📭 Você não possui parcelamentos cadastrados.\n\n➕ Ex.: _Notebook 12x de R$ 250_", items: [] };
  }
  // installment_purchases só guarda first_due_at (a data da 1ª parcela, fixa)
  // — o vencimento da PRÓXIMA parcela precisa ser derivado somando os meses
  // já pagos, senão volta a mostrar a 1ª parcela pra sempre mesmo depois de
  // pagar várias. Mesma fórmula que o site já usa (installments.functions.ts).
  const { installmentDueDate } = await import("@/lib/installments-dates");
  const items: InstallmentListItem[] = [];
  const lines: string[] = [];
  let n = 0;
  for (const i of list.slice(0, 15)) {
    n++;
    items.push({ n, kind: "installment", id: i.id, title: i.title });
    const total = Number(i.installments_total || 0);
    const paid = Number(i.installments_paid || 0);
    const per = total > 0 ? Number(i.total_amount || 0) / total : 0;
    const rem = Math.max(0, total - paid) * per;
    const nextDue = paid >= total || !i.first_due_at ? null : installmentDueDate(String(i.first_due_at), paid + 1);
    lines.push(`${n} - *${i.title}* — ${paid}/${total} pagas\n${BRL(per)}/parcela · restante ${BRL(rem)}${nextDue ? ` · próx. ${formatYMDBr(nextDue)}` : ""}`);
  }
  // Contas fixas com prazo determinado (consórcio, financiamento) também são parcelamentos.
  for (const b of billList.slice(0, 15)) {
    n++;
    items.push({ n, kind: "bill", id: b.id, title: b.title });
    const info = billInstallmentInfo(b);
    const per = Number(b.amount || 0);
    lines.push(`${n} - *${b.title}* — ${info.paid}/${info.total} pagas\n${BRL(per)}/parcela · restam ${info.remaining} · próx. ${formatYMDBr(b.next_due_at)}`);
  }
  return { replyText: `💳 *Seus parcelamentos*\n\n${lines.join("\n\n")}\n\nPra corrigir algum, é só dizer o número (ex.: _"2 vence dia 15"_ ou _"corrige o 1 pra R$900"_).`, items };
}


/** Consulta dívidas (debts). */
export async function queryDebts(userId: string): Promise<{ replyText: string }> {
  const { data, error } = await supabaseAdmin
    .from("debts")
    .select("title, principal, creditor, due_at, paid")
    .eq("user_id", userId)
    .order("due_at", { ascending: true, nullsFirst: false });
  if (error) return { replyText: "Não consegui buscar suas dívidas 🙏." };
  const list = (data ?? []) as any[];
  const open = list.filter((d) => !d.paid);
  if (open.length === 0) {
    return { replyText: "✅ Você não possui dívidas em aberto no momento." };
  }
  const total = open.reduce((s, d) => s + Number(d.principal || 0), 0);
  const lines = open.slice(0, 15).map((d) => `📌 *${d.title}*${d.creditor ? ` (${d.creditor})` : ""}\n${BRL(Number(d.principal || 0))}${d.due_at ? ` · vence ${String(d.due_at).slice(8, 10)}/${String(d.due_at).slice(5, 7)}` : ""}`);
  return { replyText: `📌 *Suas dívidas em aberto*\n\n${lines.join("\n\n")}\n\n💰 *Total devido:* ${BRL(total)}` };
}

/** Consulta metas financeiras (financial_goals). */
export async function queryGoals(userId: string): Promise<{ replyText: string }> {
  const { data, error } = await supabaseAdmin
    .from("financial_goals")
    .select("title, target_amount, current_amount, target_date")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) return { replyText: "Não consegui buscar suas metas 🙏." };
  const list = (data ?? []) as any[];
  if (list.length === 0) {
    return { replyText: "🎯 Você ainda não possui metas cadastradas.\n\n➕ Ex.: _meta viagem R$ 5000 até dezembro_" };
  }
  const lines = list.slice(0, 15).map((g) => {
    const tgt = Number(g.target_amount || 0);
    const cur = Number(g.current_amount || 0);
    const pct = tgt > 0 ? Math.min(100, Math.round((cur / tgt) * 100)) : 0;
    return `🎯 *${g.title}*\n${BRL(cur)} / ${BRL(tgt)} (${pct}%)${g.target_date ? ` · até ${String(g.target_date).slice(8, 10)}/${String(g.target_date).slice(5, 7)}/${String(g.target_date).slice(0, 4)}` : ""}`;
  });
  return { replyText: `🎯 *Suas metas financeiras*\n\n${lines.join("\n\n")}` };
}

/** Consulta hábitos cadastrados. */
export async function queryHabits(userId: string): Promise<{ replyText: string }> {
  const { data, error } = await supabaseAdmin
    .from("habits")
    .select("id, name, icon, target_daily, target_weekly, category")
    .eq("user_id", userId)
    .eq("archived", false)
    .order("created_at", { ascending: false });
  if (error) return { replyText: "Não consegui buscar seus hábitos 🙏." };
  const list = (data ?? []) as any[];
  if (list.length === 0) {
    return { replyText: "🌱 Você ainda não possui hábitos cadastrados.\n\nAcesse o painel para criar sua rotina." };
  }
  const todayISO = ymd(new Date());
  const { data: logs } = await supabaseAdmin
    .from("habit_logs")
    .select("habit_id, status")
    .eq("user_id", userId)
    .eq("log_date", todayISO);
  const done = new Set(((logs ?? []) as any[]).filter((l) => l.status === "done").map((l) => l.habit_id));
  const lines = list.slice(0, 20).map((h) => `${h.icon || "•"} *${h.name}*${done.has(h.id) ? " ✅" : ""}${h.category ? ` · ${h.category}` : ""}`);
  return { replyText: `🌱 *Seus hábitos ativos*\n\n${lines.join("\n")}\n\n✅ ${done.size}/${list.length} concluídos hoje` };
}

/** Últimas transações (histórico). */
export async function queryTransactions(
  userId: string,
  opts?: { kind?: "expense" | "income"; limit?: number },
): Promise<{ replyText: string }> {
  let q = supabaseAdmin
    .from("transactions")
    .select("kind, amount, category, description, occurred_at")
    .eq("user_id", userId)
    .order("occurred_at", { ascending: false })
    .limit(opts?.limit ?? 10);
  if (opts?.kind) q = q.eq("kind", opts.kind);
  const { data, error } = await q;
  if (error) return { replyText: "Não consegui buscar seu histórico 🙏." };
  const list = (data ?? []) as any[];
  if (list.length === 0) {
    return { replyText: opts?.kind === "income" ? "📭 Nenhuma receita registrada ainda." : opts?.kind === "expense" ? "📭 Nenhuma despesa registrada ainda." : "📭 Nenhuma transação registrada ainda." };
  }
  const lines = list.map((t) => {
    const emoji = t.kind === "income" ? "💰" : (CAT_EMOJI[t.category] || "💸");
    const d = new Date(t.occurred_at);
    const data = `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    return `${emoji} ${data} · *${BRL(Number(t.amount || 0))}* — ${t.description || t.category}`;
  });
  const header = opts?.kind === "income" ? "💰 *Últimas receitas*" : opts?.kind === "expense" ? "💸 *Últimas despesas*" : "📜 *Últimas transações*";
  return { replyText: `${header}\n\n${lines.join("\n")}` };
}




// ===============================================================
// Pagamento PARCIAL de contas fixas
// ===============================================================

// Delega ao parser canônico (money-speech.ts) — cobre extenso/"mil"/"k"
// além de dígitos, ao contrário da versão anterior que só normalizava
// separadores de milhar/decimal.
function parseBrlAmountLoose(s: string): number | null {
  return parseMoneyAmount(s);
}

/** Detecta pagamento parcial / atualização de saldo de uma conta existente.
 *  Retorna null se a frase não indica pagamento parcial. */
export function detectPartialBillIntent(input: string): {
  paidAmount?: number;
  remainingAmount?: number;
  percentPaid?: number;
  percentRemaining?: number;
  isFull?: boolean;
  hint: string;
} | null {
  if (!input) return null;
  const raw = input.trim();
  const lower = raw.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  const hasPaid = /\b(paguei|abati|abatendo|abato|desconta|descontei|descontar|adiantei|adiantar|dei|depositei|transferi)\b/.test(lower);
  const hasRemaining = /\b(rest(a|am|aram)|falt(a|am|aram)|ainda\s+(devo|falta|resta|tem)|saldo\s+(restante|em\s+aberto|devedor)|sobra(m|ram)?)\b/.test(lower);
  const hasHalf = /\b(metade|50\s*%|cinquenta\s+por\s+cento)\b/.test(lower);
  const hasFull = /\b(quitei|quitad[oa]|zerei|liquid(ei|ado|ada)|paguei\s+tudo|paguei\s+total|fechei\s+a\s+conta|paguei\s+integral)\b/.test(lower);
  const percentMatch = lower.match(/(\d{1,2})\s*%/);
  const markAsPaid = /\bmarca(r)?\s+(a\s+\w+\s+)?como\s+pag/.test(lower) || /\b(dar\s+baixa|da\s+baixa|baixa\s+n[ao])\b/.test(lower);

  if (!hasPaid && !hasRemaining && !hasFull && !hasHalf && !percentMatch && !markAsPaid) return null;


  // Extração de valores monetários resistente a números de data/hora.
  // Regra 1: se houver QUALQUER valor com prefixo R$ (ou sufixo "reais/real/conto"),
  //          usamos APENAS esses valores — números soltos são ignorados.
  // Regra 2: descartamos números precedidos por "dia", "no dia", "às", "as",
  //          ou dentro de padrões de data (20/12, 20-12) e hora (20:30, 20h).
  const AMT_STRICT_RE = /(?:r\$\s*(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?))|((?:\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(?:reais?|conto|paus|mangos?|pila))/gi;
  const AMT_LOOSE_RE = /(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)/gi;

  const collectAmounts = (re: RegExp, requirePrefix: boolean): number[] => {
    const out: number[] = [];
    let mm: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((mm = re.exec(lower))) {
      const numRaw = (mm[1] ?? mm[2] ?? mm[0] ?? "").toString();
      const start = mm.index;
      const end = start + mm[0].length;
      const before = lower.slice(Math.max(0, start - 12), start);
      const after = lower.slice(end, end + 3);
      // ignora "20%"
      if (/^\s*%/.test(after)) continue;
      // ignora números em padrões de data: 20/12, 20-12, 20/12/2024
      if (/[\/\-]\s*$/.test(before) || /^\s*[\/\-]\s*\d/.test(after)) continue;
      // ignora hora: 20:30, 20h, 20hs
      if (/^\s*(?::\s*\d|h(?:s|oras?)?\b)/.test(after)) continue;
      // ignora "dia 20", "no dia 20", "às 20", "as 20"
      if (!requirePrefix && /\b(dia|as|às|dia\s+do|desde\s+o?\s*dia)\s+$/.test(before)) continue;
      const v = parseBrlAmountLoose(numRaw);
      if (v && v >= 1) out.push(v);
    }
    return out;
  };

  let amounts = collectAmounts(AMT_STRICT_RE, true);
  if (amounts.length === 0) amounts = collectAmounts(AMT_LOOSE_RE, false);

  let hint = raw
    .replace(/r\$\s*[\d.,]+/gi, " ")
    .replace(/\b\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?\b/g, " ")
    .replace(/\b\d+(?:[.,]\d{1,2})?\s*(reais|real|conto)?\b/gi, " ")
    .replace(/\b(paguei|ja\s+paguei|já\s+paguei|abati|desconta|descontei|resta|restam|falta|faltam|ainda|devo|so|só|apenas|somente|do|da|de|dos|das|no|na|o|a|os|as|meu|minha|conta|fixa|quitei|quitado|quitada|metade|reais?)\b/gi, " ")
    .replace(/\d+\s*%/g, " ")
    .replace(/[.,;:!?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const result: any = { hint };

  if (hasFull) result.isFull = true;

  if (hasHalf) result.percentPaid = 50;
  else if (percentMatch) {
    const p = parseInt(percentMatch[1], 10);
    if (p >= 1 && p <= 100) {
      if (hasRemaining && !hasPaid) result.percentRemaining = p;
      else result.percentPaid = p;
    }
  }

  if (amounts.length >= 2 && hasPaid && hasRemaining) {
    result.paidAmount = amounts[0];
    result.remainingAmount = amounts[1];
  } else if (amounts.length >= 1) {
    if (hasRemaining && !hasPaid) result.remainingAmount = amounts[0];
    else if (hasPaid || hasFull) result.paidAmount = amounts[0];
    else result.paidAmount = amounts[0];
  }

  // "Paguei a parcela do consórcio" / "pode dar baixa na parcela" — sem valor
  // explícito: significa quitar a parcela/ciclo atual daquela conta.
  const cycleWords = /\b(parcela|parcelas|prestacao|prestacoes|mensalidade|dar\s+baixa|baixa|desse\s+mes|deste\s+mes|do\s+mes)\b/.test(lower);


  if (
    !result.paidAmount && !result.remainingAmount && !result.isFull &&
    !result.percentPaid && !result.percentRemaining &&
    (hasPaid || markAsPaid) && cycleWords
  ) {
    result.isFull = true;
  }

  if (!result.paidAmount && !result.remainingAmount && !result.isFull && !result.percentPaid && !result.percentRemaining) return null;
  return result;
}


/**
 * Detecta pedidos de correção / reclamação sobre lançamentos anteriores.
 * Retorna um texto de esclarecimento para pedir confirmação ANTES de
 * qualquer alteração financeira, evitando novos registros duplicados.
 */
export function detectCorrectionRequestIntent(input: string): { replyText: string } | null {
  if (!input) return null;
  const lower = input.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const complaint =
    /\bn(ao|ão)\s+(reconheceu|lancou|lançou|registrou|entendeu|pegou|salvou)\b/.test(lower) ||
    /\b(ficou|ta|est[aá])\s+errad[oa]\b/.test(lower) ||
    /\bregistrou\s+errad[oa]\b/.test(lower) ||
    /\bvoc(e|ê)\s+errou\b/.test(lower) ||
    /\bn(ao|ão)\s+era\s+r?\$?\s*\d/.test(lower) ||
    /\b(corrig(e|ir|ir|ja|indo)|ajust(a|ar|e|ando)|arrum(a|ar|e))\b/.test(lower);
  if (!complaint) return null;

  // Extrai valores em R$ para citar de volta ao usuário.
  const amounts: number[] = [];
  const RE = /(?:r\$\s*(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?))|((?:\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(?:reais?|conto|paus|mangos?|pila))/gi;
  let mm: RegExpExecArray | null;
  while ((mm = RE.exec(lower))) {
    const n = parseBrlAmountLoose((mm[1] ?? mm[2] ?? "").toString());
    if (n && n >= 1) amounts.push(n);
  }
  const dedup = Array.from(new Set(amounts));

  const parts: string[] = [
    "🤔 Quero ter certeza antes de alterar qualquer coisa nos seus registros.",
  ];
  if (dedup.length >= 1) {
    const list = dedup.map((v) => BRL(v)).join(" ou ");
    parts.push(`Você quis dizer *${list}*? Me confirme o valor exato, por favor.`);
  } else {
    parts.push("Pode me confirmar o *valor exato* (em R$) e a *conta* que quer ajustar?");
  }
  parts.push("Também me diga se é: *(1)* corrigir um lançamento antigo, *(2)* registrar um novo pagamento, ou *(3)* apenas consultar.");
  parts.push("Assim eu ajusto com precisão, sem duplicar nada. ✅");

  return { replyText: parts.join("\n\n") };
}

/**
 * Detecta a intenção de EDITAR o lançamento anterior a partir de linguagem
 * natural ("foi ontem", "muda a data", "isso foi dia 22", "coloca em mercado",
 * "era 200"). Só dispara quando NÃO há verbo de compra/pagamento explícito
 * com valor (caso em que é lançamento novo). Retorna o patch a aplicar sobre
 * a última transação do usuário.
 */
export type PreviousEntryEditPatch =
  | { kind: "date"; occurredAt: string; matched: string }
  | { kind: "category"; category: string; matched: string }
  | { kind: "description"; description: string; matched: string }
  | { kind: "delete"; matched: string };

const EDIT_DATE_TRIGGERS = /\b(muda(r)?|troca(r)?|troque|corrig(e|ir|ir a|ir o)|ajust(a|ar|e)|ajeit(a|ar)|atualiz(a|ar)|altera(r)?|coloca(r)?|bota(r)?|joga(r)?|passa(r)?|marca(r)?|registra(r)?|lan[çc]a(r)?|considera(r)?|conta\s+como)\b/i;
const EDIT_REF_TRIGGERS = /\b(esse|essa|esta|este|isso|aquilo|aquele|aquela|o\s+gasto|a\s+compra|o\s+lan[çc]amento|a\s+despesa|o\s+valor)\b/i;
const FOI_PREFIX = /\b(foi|era|era pra ser|deveria ser|na verdade foi|isso foi|isso aconteceu)\b/i;
const HAS_MONEY_VERB = /\b(gastei|paguei|comprei|adquiri|abasteci|assinei|renovei|contratei|desembolsei|torrei|investi|recebi|ganhei|entrou|caiu|pingou)\b/i;

export function detectPreviousEntryEditIntent(input: string): PreviousEntryEditPatch | null {
  if (!input) return null;
  const raw = input.trim();
  if (raw.length < 3) return null;
  const lower = raw.toLowerCase();
  const norm = lower.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  // Se tem verbo de gasto/receita + valor monetário, é lançamento novo, não edição.
  const monies = moneyMatches(raw);
  const hasMoneyVerb = HAS_MONEY_VERB.test(lower);
  if (hasMoneyVerb && monies.length >= 1) return null;

  // ===== DATA =====
  const dateHint = extractDateHintSP(raw);
  const mentionsDateEdit =
    EDIT_DATE_TRIGGERS.test(norm) && /\b(data|dia|ontem|hoje|amanha|semana|mes|m[êe]s|segunda|terca|ter[çc]a|quarta|quinta|sexta|sabado|s[áa]bado|domingo|\d{1,2}[\/\-]\d{1,2})\b/.test(norm);
  const mentionsFoi =
    (FOI_PREFIX.test(norm) || EDIT_REF_TRIGGERS.test(norm)) &&
    /\b(ontem|hoje|antes\s+de\s+ontem|anteontem|amanha|semana\s+passada|semana\s+retrasada|mes\s+passado|m[êe]s\s+passado|no\s+outro\s+dia|naquele\s+dia|dia\s+\d{1,2}|\d{1,2}[\/\-]\d{1,2}|segunda|terca|ter[çc]a|quarta|quinta|sexta|sabado|s[áa]bado|domingo)\b/.test(norm);
  const naoFoiHoje = /\bn(ao|ão)\s+foi\s+(hoje|ontem|dia)\b/.test(norm);

  if ((mentionsDateEdit || mentionsFoi || naoFoiHoje) && dateHint && !dateHint.future) {
    return { kind: "date", occurredAt: dateHint.iso, matched: dateHint.matched };
  }

  // ===== EXCLUIR =====
  const deleteTrigger = /\b(esquec(e|er)|deixa\s+pra\s+la|ignora(r)?|apag(a|ar|ue)|remove(r)?|tira(r)?|cancel(a|ar|e)|desconsidera(r)?|risca(r)?|elimin(a|ar|e)|n[ãa]o\s+conta\s+isso|foi\s+engano|mandei\s+errado)\b/i;
  if (deleteTrigger.test(norm) && (EDIT_REF_TRIGGERS.test(norm) || /\b(isso|esse|essa|esse\s+lan[çc]amento|esse\s+gasto|essa\s+compra|essa\s+despesa)\b/.test(norm))) {
    return { kind: "delete", matched: raw };
  }

  // ===== CATEGORIA =====
  const catTrigger = /\b(muda(r)?\s+(a\s+)?categoria|troca(r)?\s+pra|coloca(r)?\s+em|era\s+(combust[ií]vel|alimenta[çc][ãa]o|mercado|transporte|lazer|farm[áa]cia|sa[úu]de|assinatura|educa[çc][ãa]o|moradia|servi[çc]os|outros)|isso\s+(era|foi)\s+(combust[ií]vel|alimenta[çc][ãa]o|mercado|transporte|lazer|farm[áa]cia|sa[úu]de|assinatura|educa[çc][ãa]o|moradia|servi[çc]os|outros)|n[ãa]o\s+(é|e|foi)\s+(lazer|combust[ií]vel|alimenta[çc][ãa]o|mercado|transporte|farm[áa]cia|sa[úu]de|assinatura|educa[çc][ãa]o|moradia|servi[çc]os|outros))\b/i;
  if (catTrigger.test(norm)) {
    const CAT_MAP: Record<string, string> = {
      "combustivel": "Transporte",
      "combustível": "Transporte",
      "gasolina": "Transporte",
      "alimentacao": "Alimentação",
      "alimentação": "Alimentação",
      "mercado": "Alimentação",
      "restaurante": "Alimentação",
      "transporte": "Transporte",
      "uber": "Transporte",
      "lazer": "Lazer",
      "farmacia": "Saúde",
      "farmácia": "Saúde",
      "saude": "Saúde",
      "saúde": "Saúde",
      "assinatura": "Assinaturas",
      "educacao": "Educação",
      "educação": "Educação",
      "moradia": "Moradia",
      "servicos": "Serviços",
      "serviços": "Serviços",
      "outros": "Outros",
    };
    for (const [k, v] of Object.entries(CAT_MAP)) {
      const kNorm = k.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if (norm.includes(kNorm)) return { kind: "category", category: v, matched: k };
    }
  }

  return null;
}

/**
 * Aplica uma edição de data/categoria/descrição na última transação do usuário
 * (mais recente por created_at). Retorna a transação atualizada e mensagem.
 */
export async function applyEditToLastTransaction(
  userId: string,
  patch: PreviousEntryEditPatch,
): Promise<{ ok: boolean; replyText: string }> {
  // Busca a transação mais recente (última criada) — janela ampla de 7 dias.
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: last } = await supabaseAdmin
    .from("transactions")
    .select("id, amount, kind, category, description, occurred_at, created_at")
    .eq("user_id", userId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!last) {
    return { ok: false, replyText: "🤔 Não achei um lançamento recente pra ajustar. Pode me dizer o valor e a descrição do que quer corrigir?" };
  }

  const tx = last as any;
  const label = tx.description || tx.category || (tx.kind === "income" ? "receita" : "despesa");
  const amountStr = BRL(Number(tx.amount));

  if (patch.kind === "delete") {
    await supabaseAdmin.from("transactions").delete().eq("id", tx.id).eq("user_id", userId);
    return {
      ok: true,
      replyText: `🗑️ Pronto! Removi o lançamento *${label}* de *${amountStr}*.\n\nSe foi engano meu, é só me mandar de novo. 💙`,
    };
  }

  const update: { occurred_at?: string; category?: string; description?: string } = {};
  let confirmLine = "";
  if (patch.kind === "date") {
    update.occurred_at = patch.occurredAt;
    const dLabel = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(patch.occurredAt));
    confirmLine = `📅 Data atualizada para *${dLabel}*.`;
  } else if (patch.kind === "category") {
    update.category = patch.category;
    confirmLine = `🏷️ Categoria atualizada para *${patch.category}*.`;
  } else if (patch.kind === "description") {
    update.description = patch.description;
    confirmLine = `✏️ Descrição atualizada para *${patch.description}*.`;
  }

  if (Object.keys(update).length === 0) {
    return { ok: false, replyText: "Não entendi o que ajustar. Me diga o que quer mudar (data, categoria, descrição ou valor)." };
  }

  const { error } = await supabaseAdmin
    .from("transactions")
    .update(update)
    .eq("id", tx.id)
    .eq("user_id", userId);
  if (error) {
    return { ok: false, replyText: "Ops! Não consegui atualizar agora. Tente novamente em instantes." };
  }

  return {
    ok: true,
    replyText: `✅ Pronto! Ajustei o lançamento *${label}* de *${amountStr}*.\n\n${confirmLine}`,
  };
}

/** Aplica um pagamento parcial (ou total) sobre uma conta fixa existente. */
export async function applyPartialBillPayment(
  userId: string,
  billId: string,
  opts: { paidAmount?: number; remainingAmount?: number; percentPaid?: number; percentRemaining?: number; isFull?: boolean; notes?: string | null; occurredAt?: string; source?: "panel" | "whatsapp" },
): Promise<{ ok: boolean; replyText: string }> {
  const { data: bill } = await supabaseAdmin
    .from("recurring_bills")
    .select("*")
    .eq("id", billId).eq("user_id", userId).maybeSingle();
  if (!bill) return { ok: false, replyText: "Não encontrei essa conta fixa." };

  const original = Number((bill as any).original_amount ?? bill.amount);
  const alreadyPaid = Number((bill as any).paid_amount ?? 0);
  const outstandingBefore = Math.max(0, original - alreadyPaid);

  let paidNow = 0;
  if (opts.isFull) paidNow = outstandingBefore;
  else if (typeof opts.paidAmount === "number") paidNow = opts.paidAmount;
  else if (typeof opts.percentPaid === "number") paidNow = (original * opts.percentPaid) / 100;
  else if (typeof opts.remainingAmount === "number") paidNow = Math.max(0, outstandingBefore - opts.remainingAmount);
  else if (typeof opts.percentRemaining === "number") paidNow = Math.max(0, outstandingBefore - (original * opts.percentRemaining) / 100);

  paidNow = Math.round(paidNow * 100) / 100;
  if (paidNow <= 0) return { ok: false, replyText: "Não consegui identificar o valor pago. Ex.: _paguei 200 do aluguel_" };
  if (paidNow > outstandingBefore + 0.01) paidNow = outstandingBefore;

  const rpcArgs = {
    p_user_id: userId,
    p_bill_id: billId,
    p_amount: paidNow,
    p_occurred_at: opts.occurredAt ?? new Date().toISOString(),
    p_notes: opts.notes ?? undefined,
    p_source: opts.source ?? "whatsapp",
  };
  const { data: result, error: paymentError } = await supabaseAdmin.rpc("register_bill_payment_atomic", rpcArgs);
  if (paymentError || !result || typeof result !== "object" || Array.isArray(result)) {
    console.error("[actions] applyPartialBillPayment atomic FAIL", {
      userId, billId, paidNow, outstandingBefore, original, alreadyPaid,
      source: rpcArgs.p_source, occurredAt: rpcArgs.p_occurred_at,
      step: paymentError ? "rpc_register_bill_payment_atomic" : "rpc_empty_result",
      code: (paymentError as any)?.code ?? null,
      message: paymentError?.message ?? null,
      details: (paymentError as any)?.details ?? null,
      hint: (paymentError as any)?.hint ?? null,
      at: new Date().toISOString(),
    });
    const msg = paymentError?.message || "";
    let friendly = "Não foi possível registrar este pagamento agora. Nenhuma alteração foi realizada. Tente novamente em alguns instantes.";
    if (/Acesso negado/i.test(msg)) friendly = "Sua sessão expirou. Faça login novamente e tente outra vez.";
    else if (/Conta fixa não encontrada/i.test(msg)) friendly = "Não encontrei essa conta fixa. Ela pode ter sido removida.";
    else if (/Valor de pagamento inválido/i.test(msg)) friendly = "O valor informado é inválido ou excede o saldo pendente.";
    return { ok: false, replyText: friendly };
  }
  const atomic = result as Record<string, unknown>;
  const newPaid = Number(atomic.paid_total ?? alreadyPaid + paidNow);
  const newOutstanding = Number(atomic.remaining ?? Math.max(0, original - newPaid));
  const done = atomic.status === "paid";
  const nextDueAt = String(atomic.next_due_at ?? (bill as any).next_due_at);

  const bal = await getMonthBalance(userId);
  const dueLabel = String((bill as any).next_due_at || "").split("-").reverse().join("/");

  if (done) {
    // Contratos com prazo determinado (consórcio/financiamento): dar baixa em
    // UMA parcela, nunca no contrato inteiro. O incremento de
    // paid_installments já aconteceu DENTRO da RPC atômica acima (mesma
    // transação SQL do pagamento) — não fazemos um segundo .update() aqui,
    // que antes rodava separado e sem garantia de atomicidade com o
    // pagamento em si.
    const info = billInstallmentInfo(bill);
    if (info.isInstallment) {
      const paidCount = Number(atomic.paid_installments ?? info.paid);
      const totalCount = Number(atomic.installments_total ?? info.total);
      const remainingCount = Math.max(0, totalCount - paidCount);
      const settled = !!atomic.installment_settled;

      return {
        ok: true,
        replyText: settled
          ? `🎉 *${(bill as any).title}* QUITADO!

💸 Parcela paga: *${totalCount} de ${totalCount}*
💰 Valor: *${BRL(paidNow)}*
✅ Não há mais parcelas nem lembretes.

💰 Saldo do mês: *${BRL(bal.balance)}*`
          : `✅ Parcela do *${(bill as any).title}* registrada!

💸 Parcela paga: *${paidCount} de ${totalCount}*
💰 Valor: *${BRL(paidNow)}*
📊 Restam: *${remainingCount} parcelas*
📅 Próximo vencimento: ${nextDueAt.split("-").reverse().join("/")}

💰 Saldo do mês: *${BRL(bal.balance)}*`,
      };
    }

    return {
      ok: true,
      replyText:
`✅ *${(bill as any).title}* quitada!

💸 Pago agora: *${BRL(paidNow)}*
📅 Próximo vencimento: ${nextDueAt.split("-").reverse().join("/")}

💰 Saldo do mês: *${BRL(bal.balance)}*`,
    };
  }


  return {
    ok: true,
    replyText:
`✅ *Pagamento parcial registrado!*

📌 Conta: *${(bill as any).title}*
💸 Pago agora: *${BRL(paidNow)}*
💳 Total pago: *${BRL(newPaid)}* de ${BRL(original)}
⚠️ Saldo restante: *${BRL(newOutstanding)}*

Status: 🟠 Parcialmente paga · vencimento mantido em ${dueLabel}.

💰 Saldo do mês: *${BRL(bal.balance)}*`,
  };
}

/** Localiza contas fixas ATIVAS por hint textual (independente do status de pagamento). */
export async function findBillsByHint(userId: string, hint: string): Promise<any[]> {
  const { data } = await supabaseAdmin
    .from("recurring_bills")
    .select("id, title, amount, original_amount, paid_amount, frequency, next_due_at, payment_status, category")
    .eq("user_id", userId)
    .eq("active", true);
  const list = (data ?? []) as any[];
  const h = (hint || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  if (!h) return list;
  const tokens = h.split(/\s+/).filter((w) => w.length >= 3);
  if (tokens.length === 0) return [];
  const scored = list.map((b) => {
    const t = String(b.title || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    let score = 0;
    for (const w of tokens) if (t.includes(w)) score += w.length;
    return { b, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  return scored.map((x) => x.b);
}

/** Localiza compras parceladas (installment_purchases) ATIVAS por hint textual. */
export async function findInstallmentPurchasesByHint(userId: string, hint: string): Promise<any[]> {
  const { data } = await supabaseAdmin
    .from("installment_purchases")
    .select("id, title, total_amount, installments_total, installments_paid, first_due_at, category")
    .eq("user_id", userId)
    .eq("active", true);
  const list = (data ?? []) as any[];
  const h = (hint || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  if (!h) return list;
  const tokens = h.split(/\s+/).filter((w) => w.length >= 3);
  if (tokens.length === 0) return [];
  const scored = list.map((p) => {
    const t = String(p.title || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    let score = 0;
    for (const w of tokens) if (t.includes(w)) score += w.length;
    return { p, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  return scored.map((x) => x.p);
}

/**
 * Registra o pagamento de UMA parcela de installment_purchases via RPC
 * at\u00f4mica `pay_installment_atomic` \u2014 a MESMA fun\u00e7\u00e3o j\u00e1 usada pelo site
 * (src/lib/installments.functions.ts:payInstallment), nunca uma segunda
 * implementa\u00e7\u00e3o. Antes, o WhatsApp n\u00e3o tinha NENHUM caminho pra isso:
 * marcar uma parcela como paga (applyInstallmentFollowUp) nunca criava a
 * despesa correspondente nem mexia no saldo \u2014 ao contr\u00e1rio do fluxo
 * equivalente pra conta fixa, que sempre teve register_bill_payment_atomic.
 */
export async function payInstallmentPurchase(
  userId: string,
  purchaseId: string,
  opts: { occurredAt?: string } = {},
): Promise<{ ok: boolean; replyText: string }> {
  const { data: result, error } = await supabaseAdmin.rpc("pay_installment_atomic", {
    p_user_id: userId,
    p_purchase_id: purchaseId,
    p_occurred_at: opts.occurredAt ?? new Date().toISOString(),
    p_channel: "whatsapp",
  });
  if (error || !result || typeof result !== "object" || Array.isArray(result)) {
    console.error("[actions] payInstallmentPurchase atomic FAIL", {
      userId, purchaseId, message: error?.message ?? null, code: (error as any)?.code ?? null,
    });
    return { ok: false, replyText: "N\u00e3o foi poss\u00edvel registrar esse pagamento agora. Nenhuma altera\u00e7\u00e3o foi realizada. Tente novamente em alguns instantes." };
  }
  const atomic = result as Record<string, unknown>;
  if (atomic.already_done) {
    return { ok: true, replyText: "Essa compra parcelada j\u00e1 est\u00e1 totalmente quitada \u2014 n\u00e3o h\u00e1 mais parcelas pendentes. \ud83d\udc4d" };
  }
  const { data: purchase } = await supabaseAdmin
    .from("installment_purchases")
    .select("title, first_due_at")
    .eq("id", purchaseId).eq("user_id", userId).maybeSingle();
  const title = (purchase as any)?.title ?? "Compra parcelada";
  const paidNumber = Number(atomic.paid_number ?? 0);
  const total = Number(atomic.installments_total ?? 0);
  const paidAmount = Number(atomic.paid_amount ?? 0);
  const finished = !!atomic.finished;
  const bal = await getMonthBalance(userId);

  if (finished) {
    return {
      ok: true,
      replyText:
`\ud83c\udf89 *${title}* QUITADA!

\ud83d\udcb8 Parcela paga: *${paidNumber} de ${total}*
\ud83d\udcb0 Valor: *${BRL(paidAmount)}*
\u2705 N\u00e3o h\u00e1 mais parcelas pendentes.

\ud83d\udcb0 Saldo do m\u00eas: *${BRL(bal.balance)}*`,
    };
  }
  const { installmentDueDate } = await import("@/lib/installments-dates");
  const nextDueAt = (purchase as any)?.first_due_at
    ? installmentDueDate(String((purchase as any).first_due_at), paidNumber + 1)
    : null;
  return {
    ok: true,
    replyText:
`\u2705 Parcela do *${title}* registrada!

\ud83d\udcb8 Parcela paga: *${paidNumber} de ${total}*
\ud83d\udcb0 Valor: *${BRL(paidAmount)}*${nextDueAt ? `\n\ud83d\udcc5 Pr\u00f3ximo vencimento: ${formatYMDBr(nextDueAt)}` : ""}

\ud83d\udcb0 Saldo do m\u00eas: *${BRL(bal.balance)}*`,
  };
}

// ================================================================
// Pagar TODAS as contas pendentes de uma vez ("paguei as duas",
// "quitei todas", "zerei tudo", "paguei ambas", "acabei de pagar todas").
// Deve rodar ANTES do detector de pagamento parcial para não deixar a IA
// interpretar "duas" como valor monetário.
// ================================================================

/** Detecta intenção de quitar múltiplas contas de uma vez, sem valor monetário. */
export function detectPayAllBillsIntent(input: string): boolean {
  if (!input) return false;
  const lower = input.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  // Se o usuário citou um valor em R$ ou dígito, NÃO é "pagar tudo" — é parcial.
  const hasMoney = /r\$\s*\d|\b\d+[.,]\d{1,2}\b|\b\d{2,}\b/.test(lower);
  if (hasMoney) return false;

  const hasPayVerb =
    /\b(paguei|pagas?|pago|quitei|quitadas?|zerei|liquid(?:ei|amos)|fechei|acabei\s+de\s+pagar|terminei\s+de\s+pagar|acabo\s+de\s+pagar|completei\s+o\s+pagamento|nao\s+devo\s+mais|ja\s+foram\s+pagas|foram\s+pagas)\b/.test(lower);
  const markAllPaid =
    /\b(pode\s+)?(marca(r)?|dar|da|considera(r)?)\s+(tud[oa]|todas?(\s+as\s+contas)?|elas|as\s+contas)\s+(como\s+)?pag[oa]s?\b/.test(lower) ||
    /\bmarca(r)?\s+como\s+pag[oa]s?\b/.test(lower);
  const allScope =
    /\b(tud[oa]|todas?|todos?|ambas?|ambos?|as\s+(?:duas|tres|quatro|cinco)|os\s+(?:dois|tres|quatro|cinco)|minhas\s+contas|todas\s+as\s+contas|todos\s+os\s+boletos)\b/.test(lower);
  // Escopo por "contas" (fixas / da semana / do mês) também vale como "tudo".
  const billsScope =
    /\b(contas?\s+fixas?|contas?\s+d[ao]\s+(semana|mes|meses)|contas?\s+desta\s+semana|contas?\s+deste\s+mes|as\s+contas|minhas\s+contas|os\s+boletos|as\s+mensalidades)\b/.test(lower);

  if (markAllPaid) return true;
  if (!hasPayVerb) return false;
  return allScope || billsScope;
}


/** Retorna todas as contas fixas ativas com saldo devedor > 0 no ciclo atual. */
export async function findOutstandingBillsForUser(userId: string): Promise<any[]> {
  const { data } = await supabaseAdmin
    .from("recurring_bills")
    .select("id, title, amount, original_amount, paid_amount, frequency, next_due_at, payment_status, category, active")
    .eq("user_id", userId)
    .eq("active", true)
    .order("next_due_at", { ascending: true });
  const list = (data ?? []) as any[];
  return list.filter((b) => {
    const original = Number(b.original_amount ?? b.amount ?? 0);
    const paid = Number(b.paid_amount ?? 0);
    const outstanding = Math.round((original - paid) * 100) / 100;
    if (outstanding <= 0.01) return false;
    const st = String(b.payment_status || "pending");
    return ["pending", "awaiting", "late", "partial"].includes(st);
  });
}

/** Quita todas as contas pendentes usando o SALDO RESTANTE de cada uma (nunca o valor original). */
export async function payAllOutstandingBills(
  userId: string,
  occurredAt = new Date().toISOString(),
): Promise<{ ok: boolean; count: number; replyText: string }> {
  const bills = await findOutstandingBillsForUser(userId);
  if (bills.length === 0) {
    return { ok: false, count: 0, replyText: "✅ Você não tem contas fixas pendentes no momento. Está tudo em dia!" };
  }
  const lines: string[] = [];
  let totalPaid = 0;
  for (const b of bills) {
    const original = Number(b.original_amount ?? b.amount ?? 0);
    const paidBefore = Number(b.paid_amount ?? 0);
    const outstanding = Math.round((original - paidBefore) * 100) / 100;
    if (outstanding <= 0.01) continue;
    const r = await applyPartialBillPayment(userId, b.id, { isFull: true, occurredAt, notes: "pay_all" });
    if (r.ok) {
      totalPaid += outstanding;
      lines.push(`✅ *${b.title}* — ${BRL(outstanding)}${paidBefore > 0 ? ` _(quitação do saldo restante)_` : ""}`);
    } else {
      lines.push(`⚠️ ${b.title} — não foi possível registrar automaticamente.`);
    }
  }
  const bal = await getMonthBalance(userId);
  return {
    ok: true,
    count: bills.length,
    replyText:
`🎉 *Tudo quitado!*

${lines.join("\n")}

💸 Total registrado agora: *${BRL(totalPaid)}*
💰 Saldo do mês: *${BRL(bal.balance)}*

Já atualizei painel, relatórios e calendário automaticamente. 🚀`,
  };
}

/**
 * REGRA 5 — Conta paga obrigatoriamente gera despesa.
 * Reconcilia pagamentos de contas fixas que ficaram sem transação vinculada
 * (falha antiga/parcial). Nunca duplica: só cria o que está faltando.
 */
export async function repairMissingBillExpenses(userId: string): Promise<{ repaired: number }> {
  const { data: payments } = await supabaseAdmin
    .from("bill_payments")
    .select("id, bill_id, amount, paid_at, transaction_id, source")
    .eq("user_id", userId)
    .order("paid_at", { ascending: false })
    .limit(300);
  const rows = (payments ?? []) as any[];
  if (rows.length === 0) return { repaired: 0 };

  const linkedIds = rows.map((p) => p.transaction_id).filter(Boolean) as string[];
  const alive = new Set<string>();
  if (linkedIds.length) {
    const { data: txs } = await supabaseAdmin
      .from("transactions").select("id").eq("user_id", userId).in("id", linkedIds);
    for (const t of (txs ?? []) as any[]) alive.add(t.id);
  }

  const orphans = rows.filter((p) => !p.transaction_id || !alive.has(p.transaction_id));
  if (orphans.length === 0) return { repaired: 0 };

  const billIds = Array.from(new Set(orphans.map((p) => p.bill_id)));
  const { data: bills } = await supabaseAdmin
    .from("recurring_bills").select("id, title, category").eq("user_id", userId).in("id", billIds);
  const billMap = new Map((bills ?? []).map((b: any) => [b.id, b]));

  let repaired = 0;
  for (const p of orphans) {
    const bill = billMap.get(p.bill_id);
    if (!bill) continue;
    const { data: tx, error } = await supabaseAdmin
      .from("transactions")
      .insert({
        user_id: userId,
        kind: "expense",
        amount: Number(p.amount),
        category: bill.category || "Contas Fixas",
        description: bill.title,
        occurred_at: p.paid_at,
        source: p.source === "panel" ? "panel" : "recurring",
      })
      .select("id").single();
    if (error || !tx) continue;
    await supabaseAdmin.from("bill_payments").update({ transaction_id: tx.id }).eq("id", p.id);
    repaired++;
  }
  return { repaired };
}





// ================================================================
// Detecção conversacional de EXCLUSÃO ("esquece essa conta", "apaga isso",
// "tira essa dívida", "remove esse lembrete", "deleta", "cancela essa conta",
// "não considera", "risca essa conta", "joga fora", "elimina", "anula")
// ================================================================

const DELETE_VERBS_RE =
  /\b(esquec(?:e|a|er)|apag(?:a|ar|ue)|apagar|deleta(?:r)?|delete|remov(?:e|er|a)|tir(?:a|ar|e)|cancel(?:a|ar|e)|elimin(?:a|ar|e)|anul(?:a|ar|e)|risc(?:a|ar|e)|desfa(?:z(?:er)?|ça)|descart(?:a|ar|e)|desconsider(?:a|ar|e)|ignor(?:a|ar|e)|joga\s+fora|jogar\s+fora|n[ãa]o\s+(?:considera|considere|considerar|quero\s+(?:mais|isso|essa|esse))|deixa\s+pra\s+l[áa])\b/i;

const DELETE_TARGET_HINTS: Array<{ re: RegExp; target: DeleteTarget }> = [
  { re: /\b(d[íi]vida\s+fixa|conta\s+fixa|conta\s+mensal|assinatura|mensalidade|aluguel|luz|[áa]gua|internet|academia|streaming)\b/i, target: "bill" },
  { re: /\b(lembrete|compromisso|consulta|reuni[ãa]o|agend(a|amento)|evento)\b/i, target: "appointment" },
  { re: /\b(parcelamento|parcela)\b/i, target: "installment" },
  { re: /\b(d[íi]vida|empr[ée]stimo|devo|estou\s+devendo)\b/i, target: "debt" },
  { re: /\b(meta|objetivo)\b/i, target: "goal" },
  { re: /\b(receita|entrada|pix\s+recebido|sal[áa]rio|freela|comiss[ãa]o)\b/i, target: "transaction_income" },
  { re: /\b(despesa|gasto|compra|pagamento|lan[çc]amento|opera[çc][ãa]o|registro)\b/i, target: "transaction" },
];

export type DeleteTarget =
  | "bill"
  | "appointment"
  | "installment"
  | "debt"
  | "goal"
  | "transaction"
  | "transaction_income"
  | "any";

export type DeleteIntent = { target: DeleteTarget; hint: string };

export function detectDeleteIntent(input: string): DeleteIntent | null {
  if (!input) return null;
  const raw = input.trim();
  if (raw.length < 3) return null;
  if (/\?\s*$/.test(raw)) return null; // pergunta, não comando
  const lower = raw.toLowerCase();

  if (!DELETE_VERBS_RE.test(lower)) return null;

  // Evita falso-positivo em small talk ("deixa pra lá, valeu"). Só considera
  // exclusão se sobrar algum objeto/target textual OU pronome ("isso", "esse",
  // "essa", "essa conta", "esse lançamento", "essa dívida"…).
  const hasObject =
    /\b(iss[oa]|esse|essa|esses|essas|aquilo|essa\s+conta|esse\s+lan[çc]amento|essa\s+d[íi]vida|esse\s+lembrete|esse\s+compromisso|isso\s+pra\s+mim|da\s+minha\s+lista|essa\s+despesa|esse\s+gasto|essa\s+receita|essa\s+compra|essa\s+opera[çc][ãa]o|esse\s+item|essa\s+mensagem|essa\s+assinatura|essa\s+mensalidade|o\s+aluguel|a\s+internet|a\s+luz|a\s+[áa]gua)\b/i.test(lower);
  const hasTargetWord = DELETE_TARGET_HINTS.some((t) => t.re.test(lower));

  if (!hasObject && !hasTargetWord) return null;

  let target: DeleteTarget = "any";
  for (const t of DELETE_TARGET_HINTS) {
    if (t.re.test(lower)) { target = t.target; break; }
  }

  // hint textual = frase sem os verbos/pronomes, útil para localizar item
  const hint = lower
    .replace(DELETE_VERBS_RE, " ")
    .replace(/\b(iss[oa]|esse|essa|esses|essas|aquilo|pra\s+mim|da\s+minha\s+lista|por\s+favor|please|pf|obrigad[oa])\b/gi, " ")
    .replace(/[.,;:!?()"'“”\-–—•]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return { target, hint };
}

/**
 * Localiza o alvo mais provável para exclusão e devolve preview + payload de
 * pending_action. Não deleta nada aqui — sempre pede confirmação SIM/NÃO.
 */
export async function previewDeleteEntry(
  userId: string,
  intent: DeleteIntent,
): Promise<{ replyText: string; pending?: any }>{
  const { target, hint } = intent;
  const hintTokens = hint.split(/\s+/).filter((w) => w.length >= 3);

  // ===== AMBIGUIDADE TOTAL =====
  // "apaga isso", "pode apagar", "cancela isso", "esquece" — sem contexto
  // sobre O QUÊ apagar. Nunca assumir: perguntar antes.
  if (target === "any" && hintTokens.length === 0) {
    return {
      replyText:
        "🤔 *O que você deseja apagar?*\n\n" +
        "1️⃣ última despesa\n" +
        "2️⃣ conta fixa\n" +
        "3️⃣ lembrete/compromisso\n" +
        "4️⃣ dívida\n" +
        "5️⃣ meta\n" +
        "6️⃣ parcelamento\n\n" +
        "Responda com o *número* ou o *nome* (ex.: _conta fixa da luz_).",
      pending: {
        kind: "delete_target_menu",
        expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      },
    };
  }


  const matchScore = (text: string): number => {
    if (!text) return 0;
    const t = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    let s = 0;
    for (const w of hintTokens) if (t.includes(w)) s += w.length;
    return s;
  };

  // 1) Conta fixa (recurring_bills)
  if (target === "bill" || target === "any") {
    const { data } = await supabaseAdmin
      .from("recurring_bills")
      .select("id, title, amount, next_due_at, active")
      .eq("user_id", userId).eq("active", true)
      .order("updated_at", { ascending: false }).limit(20);
    const list = (data ?? []) as any[];
    if (list.length > 0) {
      const scored = hintTokens.length
        ? list.map((b) => ({ b, s: matchScore(b.title) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s)
        : list.map((b) => ({ b, s: 0 }));
      if (scored.length > 0 || target === "bill") {
        const bill = (scored[0]?.b ?? list[0]);
        return {
          replyText: `🗑️ *Confirmar exclusão?*\n\nConta fixa: *${bill.title}* — ${BRL(Number(bill.amount || 0))}\n\nResponda *sim* para excluir ou *não* para manter.`,
          pending: { kind: "delete_confirmation", target: "bill", id: bill.id, label: bill.title, expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString() },
        };
      }
    }
  }

  // 2) Compromisso (appointments)
  if (target === "appointment" || target === "any") {
    const { data } = await supabaseAdmin
      .from("appointments")
      .select("id, title, scheduled_at")
      .eq("user_id", userId)
      .gte("scheduled_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .order("scheduled_at", { ascending: true }).limit(20);
    const list = (data ?? []) as any[];
    if (list.length > 0) {
      const scored = hintTokens.length
        ? list.map((a) => ({ a, s: matchScore(a.title) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s)
        : list.map((a) => ({ a, s: 0 }));
      if (scored.length > 0 || target === "appointment") {
        const ap = (scored[0]?.a ?? list[0]);
        return {
          replyText: `🗑️ *Confirmar exclusão?*\n\nCompromisso: *${ap.title}*\n🕒 ${formatDatePT(ap.scheduled_at)}\n\nResponda *sim* para excluir ou *não* para manter.`,
          pending: { kind: "delete_confirmation", target: "appointment", id: ap.id, label: ap.title, expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString() },
        };
      }
    }
  }

  // 3) Dívida
  if (target === "debt" || target === "any") {
    const { data } = await supabaseAdmin
      .from("debts")
      .select("id, title, amount, creditor")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }).limit(20);
    const list = (data ?? []) as any[];
    if (list.length > 0) {
      const scored = hintTokens.length
        ? list.map((d) => ({ d, s: matchScore(`${d.title || ""} ${d.creditor || ""}`) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s)
        : list.map((d) => ({ d, s: 0 }));
      if (scored.length > 0 || target === "debt") {
        const dbt = (scored[0]?.d ?? list[0]);
        return {
          replyText: `🗑️ *Confirmar exclusão?*\n\nDívida: *${dbt.title}* — ${BRL(Number(dbt.amount || 0))}${dbt.creditor ? ` (${dbt.creditor})` : ""}\n\nResponda *sim* para excluir ou *não* para manter.`,
          pending: { kind: "delete_confirmation", target: "debt", id: dbt.id, label: dbt.title, expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString() },
        };
      }
    }
  }

  // 4) Meta
  if (target === "goal" || target === "any") {
    const { data } = await supabaseAdmin
      .from("financial_goals")
      .select("id, title, target_amount")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }).limit(20);
    const list = (data ?? []) as any[];
    if (list.length > 0) {
      const scored = hintTokens.length
        ? list.map((g) => ({ g, s: matchScore(g.title) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s)
        : list.map((g) => ({ g, s: 0 }));
      if (scored.length > 0 || target === "goal") {
        const gl = (scored[0]?.g ?? list[0]);
        return {
          replyText: `🗑️ *Confirmar exclusão?*\n\nMeta: *${gl.title}*\n\nResponda *sim* para excluir ou *não* para manter.`,
          pending: { kind: "delete_confirmation", target: "goal", id: gl.id, label: gl.title, expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString() },
        };
      }
    }
  }

  // 5) Parcelamento
  if (target === "installment" || target === "any") {
    const { data } = await supabaseAdmin
      .from("installment_purchases")
      .select("id, title, amount")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }).limit(20);
    const list = (data ?? []) as any[];
    if (list.length > 0) {
      const scored = hintTokens.length
        ? list.map((it) => ({ it, s: matchScore(it.title) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s)
        : list.map((it) => ({ it, s: 0 }));
      if (scored.length > 0 || target === "installment") {
        const ins = (scored[0]?.it ?? list[0]);
        return {
          replyText: `🗑️ *Confirmar exclusão?*\n\nParcelamento: *${ins.title}* — ${BRL(Number(ins.amount || 0))}\n\nResponda *sim* para excluir ou *não* para manter.`,
          pending: { kind: "delete_confirmation", target: "installment", id: ins.id, label: ins.title, expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString() },
        };
      }
    }
  }

  // 6) Transação (último lançamento)
  if (target === "transaction" || target === "transaction_income" || target === "any") {
    let q = supabaseAdmin
      .from("transactions")
      .select("id, kind, amount, category, description, occurred_at")
      .eq("user_id", userId);
    if (target === "transaction_income") q = q.eq("kind", "income");
    if (target === "transaction") q = q.eq("kind", "expense");
    const { data } = await q.order("occurred_at", { ascending: false }).limit(20);
    const list = (data ?? []) as any[];
    if (list.length > 0) {
      const scored = hintTokens.length
        ? list.map((tx) => ({ tx, s: matchScore(`${tx.description || ""} ${tx.category || ""}`) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s)
        : list.map((tx) => ({ tx, s: 0 }));
      const tx = (scored[0]?.tx ?? list[0]);
      if (tx) {
        const emoji = tx.kind === "income" ? "💰" : "💸";
        const label = `${emoji} ${BRL(Number(tx.amount))} — ${tx.category}${tx.description ? ` (${tx.description})` : ""}`;
        return {
          replyText: `🗑️ *Confirmar exclusão?*\n\n${label}\n\nResponda *sim* para excluir ou *não* para manter.`,
          pending: { kind: "delete_confirmation", target: "transaction", id: tx.id, label: tx.description || tx.category, expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString() },
        };
      }
    }
  }

  return {
    replyText: "Não encontrei o que você quer excluir 🤔. Me diga o nome exato — ex.: *exclui a conta do aluguel*, *apaga o lembrete do dentista*, *remove essa despesa do mercado*.",
  };
}

/**
 * Executa a exclusão previamente confirmada em pending_action.
 */
export async function confirmDeleteEntry(
  userId: string,
  pending: { target: DeleteTarget; id: string; label?: string },
): Promise<{ ok: boolean; replyText: string }> {
  try {
    let table: string;
    switch (pending.target) {
      case "bill": table = "recurring_bills"; break;
      case "appointment": table = "appointments"; break;
      case "debt": table = "debts"; break;
      case "goal": table = "financial_goals"; break;
      case "installment": table = "installment_purchases"; break;
      case "transaction":
      case "transaction_income":
        table = "transactions"; break;
      default:
        return { ok: false, replyText: "Não consegui identificar o que excluir." };
    }
    const { error } = await supabaseAdmin.from(table as any).delete().eq("id", pending.id).eq("user_id", userId);
    if (error) {
      console.error("[actions] confirmDeleteEntry", error);
      return { ok: false, replyText: "Não consegui excluir agora 🙏. Tenta de novo em instantes." };
    }
    const bal = await getMonthBalance(userId);
    return {
      ok: true,
      replyText: `✅ Excluído${pending.label ? `: *${pending.label}*` : ""}.\n\n💰 Saldo do mês: *${BRL(bal.balance)}*`,
    };
  } catch (e) {
    console.error("[actions] confirmDeleteEntry", e);
    return { ok: false, replyText: "Não consegui excluir agora 🙏." };
  }
}


/**
 * Detecta CORREÇÃO DE VALOR em mensagens de continuação (texto ou áudio):
 *   "não foi sete, foi dezessete"  ·  "corrigindo: 17 reais"  ·  "errei, era 17"
 * Retorna o valor final (e o anterior, quando citado). Nunca dispara quando a
 * frase é um lançamento novo ("gastei 50 no mercado").
 */
export function detectAmountCorrectionIntent(
  input: string,
): { newAmount: number; oldAmount?: number } | null {
  if (!input) return null;
  const digits = ptNumberWordsToDigits(input);
  const t = digits.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  const trigger =
    /\bn(a|ã)o\s+(foi|era|e|eram|s(a|ã)o)\b/.test(t) ||
    /\bcorrig(e|ir|indo|i|imos)\b/.test(t) ||
    /\berrei\b/.test(t) ||
    /\bme\s+enganei\b/.test(t) ||
    /\bna\s+verdade\b/.test(t) ||
    /\bquis\s+dizer\b/.test(t) ||
    /\bdigo\b/.test(t) ||
    /\bo\s+certo\s+(e|foi|era)\b/.test(t) ||
    /\bmuda\s+para\b/.test(t) ||
    /\btroca\s+para\b/.test(t);
  if (!trigger) return null;

  // Frase com verbo de lançamento e sem gatilho forte = novo lançamento.
  const hasEntryVerb = /\b(gastei|paguei|comprei|recebi|ganhei)\b/.test(t);
  const strongTrigger =
    /\bn(a|ã)o\s+(foi|era|eram)\b/.test(t) || /\bcorrig/.test(t) ||
    /\berrei\b/.test(t) || /\bquis\s+dizer\b/.test(t) ||
    /\bo\s+certo\s+(e|foi|era)\b/.test(t);
  if (hasEntryVerb && !strongTrigger) return null;

  const amounts: number[] = [];
  const RE = /(?:r\$\s*(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?))|((?:\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(?:reais?|conto|paus|mangos?|pila)?)/gi;
  let m: RegExpExecArray | null;
  while ((m = RE.exec(t))) {
    const n = parseBrlAmountLoose((m[1] ?? m[2] ?? "").toString());
    if (n && n > 0 && n < 1_000_000) amounts.push(n);
  }
  if (amounts.length === 0) return null;

  const newAmount = amounts[amounts.length - 1]!;
  const oldAmount = amounts.length >= 2 ? amounts[0]! : undefined;
  if (oldAmount != null && Math.abs(oldAmount - newAmount) < 0.001) return null;
  return oldAmount != null ? { newAmount, oldAmount } : { newAmount };
}
