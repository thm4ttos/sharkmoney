// AUDITORIA DO LIVRO FINANCEIRO.
// A relação é montada exclusivamente a partir da tabela oficial
// `public.transactions`, e cada linha recebe origem rastreável, vínculos
// (conta fixa / parcela / comprovante) e marcação de possível duplicidade.
// Edição e exclusão acontecem por funções atômicas do banco
// (audit_update_transaction / audit_delete_transaction), sempre no registro
// oficial e sempre com histórico gravado em `audit_corrections`.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AuditRow = {
  id: string;
  description: string;
  amount: number;
  kind: "income" | "expense";
  category: string;
  date: string;      // DD/MM/AAAA (America/Sao_Paulo)
  time: string;      // HH:MM
  createdAt: string;
  occurredAtIso: string;
  hasBillPayment: boolean;

  originLabel: string;
  originKey: string;
  channel: string;
  source: string;
  sourceType: string | null;
  sourceId: string | null;
  linkedBill: string | null;
  linkedInstallment: string | null;
  receipt: string | null;
  status: string;
  duplicateOf: string[];
  duplicateReason: string | null;
};

const SP = "America/Sao_Paulo";
function fmtDate(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: SP, day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(iso));
}
function fmtTime(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: SP, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}
function round(n: number) { return Math.round(n * 100) / 100; }

/** Classificação determinística da origem — nenhuma transação fica sem origem. */
function classifyOrigin(r: any, mediaByMsgId: Map<string, string>): { key: string; label: string } {
  const source = String(r.source ?? "");
  const st = String(r.source_type ?? "");
  const ch = String(r.channel ?? "");

  if (source === "recurring" || st === "fixed_bill") return { key: "fixed_bill", label: "Conta fixa paga" };
  if (source === "installment" || st === "installment_purchase") return { key: "installment", label: "Parcela paga" };
  if (source === "import" || st === "import_batch" || r.import_batch_id) return { key: "import", label: "Importação de histórico" };
  if (source === "reversal" || st === "reversal") return { key: "reversal", label: "Estorno" };
  if (source === "opening_balance" || st === "opening_balance") return { key: "opening", label: "Saldo inicial" };

  if (source === "whatsapp" || ch === "whatsapp") {
    const msgId = String(r.source_message_id ?? r.source_id ?? "");
    const media = mediaByMsgId.get(msgId) ?? "";
    if (media === "audio" || media === "ptt" || media === "voice") return { key: "wa_audio", label: "WhatsApp — áudio" };
    if (media === "image" || media === "photo") return { key: "wa_image", label: "WhatsApp — imagem" };
    if (media === "document" || media === "pdf") return { key: "wa_pdf", label: "WhatsApp — PDF/documento" };
    if (media === "text" || media === "chat" || media === "") return { key: "wa_text", label: "WhatsApp — texto" };
    return { key: "wa_text", label: `WhatsApp — ${media}` };
  }

  if (source === "web" || source === "site" || source === "manual" || ch === "site") {
    return { key: "site", label: "Lançamento rápido no site" };
  }
  return { key: "unknown", label: `Origem não rastreada (${source || "sem source"})` };
}

export const auditLedger = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ from: z.string().optional(), to: z.string().optional() }).parse(i ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // 1) Todas as transações do usuário (paginadas — nunca truncadas).
    const rows: any[] = [];
    const PAGE = 1000;
    for (let page = 0; page < 100; page++) {
      let q = supabase
        .from("transactions")
        .select("id, kind, amount, category, description, occurred_at, created_at, source, source_type, source_id, source_message_id, import_batch_id, channel, is_demo")
        .eq("user_id", userId);
      if (data.from) q = q.gte("occurred_at", data.from);
      if (data.to) q = q.lte("occurred_at", data.to);
      const { data: chunk, error } = await q
        .order("occurred_at", { ascending: false })
        .range(page * PAGE, page * PAGE + PAGE - 1);
      if (error) throw new Error(error.message);
      const list = chunk ?? [];
      rows.push(...list);
      if (list.length < PAGE) break;
    }

    // 2) Metadados de origem WhatsApp (tipo de mídia da mensagem que originou).
    const msgIds = Array.from(new Set(rows.map((r) => String(r.source_message_id ?? r.source_id ?? "")).filter((v) => /^[0-9a-f-]{36}$/i.test(v))));
    const mediaByMsgId = new Map<string, string>();
    const receiptByMsgId = new Map<string, string>();
    for (let i = 0; i < msgIds.length; i += 200) {
      const slice = msgIds.slice(i, i + 200);
      const { data: msgs } = await supabase
        .from("whatsapp_messages")
        .select("id, media_type, raw_message_id, transcription")
        .in("id", slice);
      for (const m of msgs ?? []) {
        mediaByMsgId.set(String(m.id), String(m.media_type ?? ""));
        const mt = String(m.media_type ?? "");
        if (mt === "image" || mt === "document") {
          receiptByMsgId.set(String(m.id), `${mt === "image" ? "Imagem" : "Documento"} • msg ${String(m.raw_message_id ?? m.id).slice(0, 12)}`);
        }
      }
    }

    // 3) Vínculos de contas fixas (pagamento registrado) e parcelas.
    const { data: payments } = await supabase
      .from("bill_payments")
      .select("id, bill_id, amount, cycle_due_at, transaction_id, was_full_payment, paid_at")
      .eq("user_id", userId);

    const paymentByTx = new Map<string, any>();
    for (const p of payments ?? []) if (p.transaction_id) paymentByTx.set(String(p.transaction_id), p);

    const { data: bills } = await supabase
      .from("recurring_bills")
      .select("id, title, amount, next_due_at, payment_status, paid_amount")
      .eq("user_id", userId);
    const billById = new Map<string, any>();
    for (const b of bills ?? []) billById.set(String(b.id), b);

    const { data: purchases } = await supabase
      .from("installment_purchases")
      .select("id, title, installments_total, installments_paid")
      .eq("user_id", userId);
    const purchaseById = new Map<string, any>();
    for (const p of purchases ?? []) purchaseById.set(String(p.id), p);

    // 4) Montagem auditável + detecção de duplicidade (sem excluir nada).
    const byDupKey = new Map<string, any[]>();
    const audit: AuditRow[] = rows.map((r) => {
      const origin = classifyOrigin(r, mediaByMsgId);
      const amount = round(Number(r.amount) || 0);
      const payment = paymentByTx.get(String(r.id));
      const bill = payment ? billById.get(String(payment.bill_id)) : null;
      const purchase = origin.key === "installment" ? purchaseById.get(String(r.source_id ?? "")) : null;
      const msgId = String(r.source_message_id ?? r.source_id ?? "");

      let status = "confirmado";
      if (r.is_demo) status = "demonstração";
      else if (origin.key === "fixed_bill" && !payment) status = "conta fixa sem pagamento registrado";
      else if (origin.key === "unknown") status = "origem não rastreada";

      const dateSP = new Intl.DateTimeFormat("en-CA", { timeZone: SP, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(r.occurred_at));
      const key = [
        r.kind,
        amount.toFixed(2),
        String(r.description ?? "").toLowerCase().trim(),
        String(r.category ?? "").toLowerCase().trim(),
        dateSP,
        origin.key,
        msgId || "-",
      ].join("|");
      const bucket = byDupKey.get(key) ?? [];
      bucket.push(r);
      byDupKey.set(key, bucket);

      return {
        id: String(r.id),
        description: String(r.description ?? "").trim() || "(sem descrição)",
        amount,
        kind: r.kind === "income" ? "income" : "expense",
        category: String(r.category ?? "Outros"),
        date: fmtDate(r.occurred_at),
        time: fmtTime(r.occurred_at),
        createdAt: fmtDate(r.created_at) + " " + fmtTime(r.created_at),
        occurredAtIso: new Date(r.occurred_at).toISOString(),
        hasBillPayment: !!payment,

        originLabel: origin.label,
        originKey: origin.key,
        channel: String(r.channel ?? (r.source === "whatsapp" ? "whatsapp" : "site")),
        source: String(r.source ?? ""),
        sourceType: (r.source_type as string | null) ?? null,
        sourceId: (r.source_id as string | null) ?? null,
        linkedBill: bill ? `${bill.title}${payment?.cycle_due_at ? ` • ciclo ${fmtDate(payment.cycle_due_at + "T12:00:00Z")}` : ""}` : null,
        linkedInstallment: purchase ? `${purchase.title} (${purchase.installments_paid}/${purchase.installments_total})` : null,
        receipt: receiptByMsgId.get(msgId) ?? null,
        status,
        duplicateOf: [],
        duplicateReason: null,
      } satisfies AuditRow;
    });

    const byId = new Map(audit.map((a) => [a.id, a]));
    const duplicateGroups: Array<{ ids: string[]; reason: string; amount: number; description: string; kind: string; total: number }> = [];
    for (const [key, group] of byDupKey) {
      if (group.length < 2) continue;
      const ids = group.map((g) => String(g.id));
      const parts = key.split("|");
      const amount = Number(parts[1]);
      const reason = `Mesmo tipo, valor, descrição, categoria e data${parts[6] !== "-" ? " (mesma mensagem de origem)" : ""}`;
      duplicateGroups.push({
        ids,
        reason,
        amount,
        description: group[0].description ?? "",
        kind: group[0].kind,
        total: round(amount * (group.length - 1)),
      });
      for (const id of ids) {
        const row = byId.get(id);
        if (!row) continue;
        row.duplicateOf = ids.filter((x) => x !== id);
        row.duplicateReason = reason;
      }
    }

    // 5) Totais oficiais.
    let income = 0, expense = 0, reversals = 0;
    const byCategory = new Map<string, { income: number; expense: number; count: number }>();
    const byOrigin = new Map<string, { label: string; income: number; expense: number; count: number }>();
    for (const a of audit) {
      if (a.kind === "income") income += a.amount; else expense += a.amount;
      if (a.originKey === "reversal") reversals += a.amount;
      const c = byCategory.get(a.category) ?? { income: 0, expense: 0, count: 0 };
      if (a.kind === "income") c.income = round(c.income + a.amount); else c.expense = round(c.expense + a.amount);
      c.count++; byCategory.set(a.category, c);
      const o = byOrigin.get(a.originKey) ?? { label: a.originLabel, income: 0, expense: 0, count: 0 };
      if (a.kind === "income") o.income = round(o.income + a.amount); else o.expense = round(o.expense + a.amount);
      o.count++; byOrigin.set(a.originKey, o);
    }
    income = round(income); expense = round(expense);
    const openingBalance = round(audit.filter((a) => a.originKey === "opening").reduce((s, a) => s + (a.kind === "income" ? a.amount : -a.amount), 0));
    const computedBalance = round(income - expense);

    // Saldo do ledger oficial (mesma função usada pelo painel e pelo WhatsApp).
    // - snapshotPeriod: mesmo intervalo da auditoria (para conferência linha a linha);
    // - snapshotAll: saldo ATUAL geral (todo o histórico confirmado).
    const { fetchFinanceSnapshot } = await import("@/lib/finance-snapshot.server");
    const snapshotPeriod = await fetchFinanceSnapshot(supabase, userId, {
      from: data.from ?? null,
      to: data.to ?? null,
    });
    const snapshotAll = (data.from || data.to)
      ? await fetchFinanceSnapshot(supabase, userId)
      : snapshotPeriod;

    // Contas fixas pendentes/futuras — NÃO devem compor o saldo.
    const pendingBills = (bills ?? []).map((b) => ({
      id: String(b.id),
      title: String(b.title),
      amount: round(Number(b.amount) || 0),
      nextDue: b.next_due_at ? fmtDate(String(b.next_due_at) + "T12:00:00Z") : null,
      status: String(b.payment_status ?? "pending"),
      paidAmount: round(Number(b.paid_amount) || 0),
      countedAsExpense: false, // pendências nunca entram: só transações compõem o saldo
    }));

    // Pagamentos de contas fixas restritos ao período auditado.
    const fromMs = data.from ? new Date(data.from).getTime() : null;
    const toMs = data.to ? new Date(data.to).getTime() : null;
    const periodPayments = (payments ?? []).filter((p) => {
      if (fromMs === null && toMs === null) return true;
      const t = new Date(String(p.paid_at ?? p.cycle_due_at ?? "")).getTime();
      if (!Number.isFinite(t)) return true;
      if (fromMs !== null && t < fromMs) return false;
      if (toMs !== null && t > toMs) return false;
      return true;
    });
    const unlinkedPayments = periodPayments
      .filter((p) => !p.transaction_id)
      .map((p) => ({
        id: String(p.id),
        billTitle: String(billById.get(String(p.bill_id))?.title ?? "conta fixa"),
        amount: round(Number(p.amount) || 0),
        paidAt: p.paid_at ? fmtDate(String(p.paid_at)) : null,
      }));

    const billFindings = {
      recurringTransactions: audit.filter((a) => a.originKey === "fixed_bill").length,
      recurringTotal: round(audit.filter((a) => a.originKey === "fixed_bill").reduce((s, a) => s + a.amount, 0)),
      registeredPayments: periodPayments.length,
      registeredPaymentsTotal: round(periodPayments.reduce((s, p) => s + (Number(p.amount) || 0), 0)),
      unlinkedPayments,
      orphanRecurring: audit
        .filter((a) => a.originKey === "fixed_bill" && a.status === "conta fixa sem pagamento registrado")
        .map((a) => ({ id: a.id, description: a.description, amount: a.amount, date: a.date, createdAt: a.createdAt })),
    };

    return {
      generatedAt: new Date().toISOString(),
      formula: "saldo do período = receitas do período − despesas do período · saldo atual = saldo inicial + todo o histórico confirmado",
      period: { from: data.from ?? null, to: data.to ?? null },
      totals: {
        count: audit.length,
        income,
        expense,
        reversals: round(reversals),
        openingBalance,
        computedBalance,
        periodBalance: computedBalance,
        currentBalance: snapshotAll.balance,
        currentIncome: snapshotAll.income,
        currentExpense: snapshotAll.expense,
        currentCount: snapshotAll.txCount,
        ledgerBalance: snapshotPeriod.balance,
        ledgerIncome: snapshotPeriod.income,
        ledgerExpense: snapshotPeriod.expense,
        ledgerCount: snapshotPeriod.txCount,
        difference: round(computedBalance - snapshotPeriod.balance),
        duplicateAmount: round(duplicateGroups.reduce((s, g) => s + g.total, 0)),
        duplicateGroups: duplicateGroups.length,
      },
      byCategory: [...byCategory.entries()]
        .map(([category, v]) => ({ category, ...v, net: round(v.income - v.expense) }))
        .sort((a, b) => b.expense + b.income - (a.expense + a.income)),
      byOrigin: [...byOrigin.entries()].map(([key, v]) => ({ key, ...v })).sort((a, b) => b.count - a.count),
      duplicateGroups,
      billFindings,
      pendingBills,
      rows: audit,
    };
  });

// ===== Ações da auditoria (sempre no registro OFICIAL, de forma atômica) =====

/** Edição do lançamento oficial. Sincroniza pagamento de conta fixa vinculado e registra histórico. */
export const auditUpdateTransaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      id: z.string().uuid(),
      kind: z.enum(["income", "expense"]),
      amount: z.number().positive().max(10_000_000),
      category: z.string().trim().min(1).max(60),
      description: z.string().trim().max(280).optional(),
      occurred_at: z.string(),
      reason: z.string().trim().max(280).optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: res, error } = await (supabase as any).rpc("audit_update_transaction", {
      p_transaction_id: data.id,
      p_kind: data.kind,
      p_amount: Math.round(data.amount * 100) / 100,
      p_category: data.category,
      p_description: data.description ?? null,
      p_occurred_at: new Date(data.occurred_at).toISOString(),
      p_reason: data.reason ?? null,
    });
    if (error) throw new Error(error.message);
    return res;
  });

/** Exclusão do lançamento oficial, tratando vínculos (conta fixa / parcela). */
export const auditDeleteTransaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      id: z.string().uuid(),
      mode: z.enum(["plain", "reopen_bill", "transaction_only"]).optional(),
      reason: z.string().trim().max(280).optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: res, error } = await (supabase as any).rpc("audit_delete_transaction", {
      p_transaction_id: data.id,
      p_mode: data.mode ?? "plain",
      p_reason: data.reason ?? null,
    });
    if (error) throw new Error(error.message);
    return res;
  });

/** Histórico de correções feitas pela Auditoria Financeira. */
export const listAuditCorrections = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ limit: z.number().int().optional() }).parse(i ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: rows, error } = await (supabase as any)
      .from("audit_corrections")
      .select("id, transaction_id, action, origin, reason, amount_before, amount_after, before_data, after_data, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(Math.min(data.limit ?? 100, 300));
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r: any) => {
      const before = r.before_data ?? {};
      const after = r.after_data ?? {};
      return {
        id: String(r.id),
        transactionId: String(r.transaction_id),
        action: String(r.action),
        actionLabel: String(r.action).startsWith("delete")
          ? String(r.action) === "delete:reopen_bill"
            ? "Exclusão (pagamento da conta fixa reaberto)"
            : String(r.action) === "delete:installment_reopened"
              ? "Exclusão (parcela devolvida para pendente)"
              : String(r.action) === "delete:transaction_only"
                ? "Exclusão apenas da transação"
                : "Exclusão do lançamento"
          : "Edição do lançamento",
        origin: String(r.origin ?? "Auditoria Financeira"),
        reason: (r.reason as string | null) ?? null,
        amountBefore: r.amount_before === null ? null : round(Number(r.amount_before)),
        amountAfter: r.amount_after === null ? null : round(Number(r.amount_after)),
        descriptionBefore: (before.description as string | null) ?? null,
        descriptionAfter: (after.description as string | null) ?? null,
        categoryBefore: (before.category as string | null) ?? null,
        categoryAfter: (after.category as string | null) ?? null,
        at: fmtDate(r.created_at) + " " + fmtTime(r.created_at),
      };
    });
  });


/** Detalhe de origem de uma única transação (menu de três pontos). */
export const getTransactionOrigin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: r, error } = await supabase
      .from("transactions")
      .select("id, kind, amount, category, description, occurred_at, created_at, source, source_type, source_id, source_message_id, import_batch_id, channel")
      .eq("id", data.id)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!r) throw new Error("Transação não encontrada");

    const msgId = String(r.source_message_id ?? r.source_id ?? "");
    let mediaType = "";
    let rawMessageId: string | null = null;
    if (/^[0-9a-f-]{36}$/i.test(msgId)) {
      const { data: m } = await supabase
        .from("whatsapp_messages")
        .select("media_type, raw_message_id")
        .eq("id", msgId)
        .maybeSingle();
      mediaType = String(m?.media_type ?? "");
      rawMessageId = (m?.raw_message_id as string | null) ?? null;
    }
    const origin = classifyOrigin(r, new Map([[msgId, mediaType]]));

    const { data: payment } = await supabase
      .from("bill_payments")
      .select("id, bill_id, amount, cycle_due_at, was_full_payment")
      .eq("user_id", userId)
      .eq("transaction_id", r.id)
      .maybeSingle();
    let billTitle: string | null = null;
    if (payment?.bill_id) {
      const { data: b } = await supabase.from("recurring_bills").select("title").eq("id", payment.bill_id).maybeSingle();
      billTitle = (b?.title as string | null) ?? null;
    }
    let installment: string | null = null;
    if (origin.key === "installment" && r.source_id) {
      const { data: p } = await supabase
        .from("installment_purchases")
        .select("title, installments_paid, installments_total")
        .eq("id", r.source_id)
        .maybeSingle();
      if (p) installment = `${p.title} (${p.installments_paid}/${p.installments_total})`;
    }

    return {
      id: String(r.id),
      origin: origin.label,
      originKey: origin.key,
      channel: String(r.channel ?? (r.source === "whatsapp" ? "WhatsApp" : "Site")),
      createdAt: fmtDate(r.created_at) + " " + fmtTime(r.created_at),
      occurredAt: fmtDate(r.occurred_at) + " " + fmtTime(r.occurred_at),
      amount: round(Number(r.amount) || 0),
      kind: r.kind,
      category: String(r.category ?? ""),
      description: String(r.description ?? ""),
      source: String(r.source ?? ""),
      sourceType: (r.source_type as string | null) ?? null,
      operationId: String(r.source_id ?? r.source_message_id ?? r.id),
      rawMessageId,
      linkedBill: billTitle,
      billPayment: payment
        ? { amount: round(Number(payment.amount) || 0), cycle: payment.cycle_due_at ? fmtDate(String(payment.cycle_due_at) + "T12:00:00Z") : null, full: !!payment.was_full_payment }
        : null,
      linkedInstallment: installment,
      importBatchId: (r.import_batch_id as string | null) ?? null,
    };
  });
