// Fonte única de verdade para gravações no livro financeiro.
// Todo chamador recebe a linha efetivamente persistida e validada antes de confirmar sucesso.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type TransactionKind = "income" | "expense";

export type TransactionWriteInput = {
  userId: string;
  kind: TransactionKind;
  amount: number;
  category: string;
  description?: string | null;
  occurredAt: string;
  source: string;
  sourceMessageId?: string | null;
  importBatchId?: string | null;
  /** Origem rastreável do valor: whatsapp_message | fixed_bill | installment_purchase | import_batch | manual */
  sourceType?: string | null;
  /** Id do registro de origem (mensagem, conta fixa, compra parcelada, lote...). */
  sourceId?: string | null;
  /** Canal que originou a operação: whatsapp | site | import | api */
  channel?: "whatsapp" | "site" | "import" | "api" | null;
  /** Cartão de crédito ao qual a despesa foi debitada (opcional). */
  creditCardId?: string | null;
};

export type PersistedTransaction = {
  id: string;
  user_id: string;
  kind: TransactionKind;
  amount: number | string;
  category: string;
  description: string | null;
  occurred_at: string;
  source: string;
  source_message_id: string | null;
  import_batch_id: string | null;
  source_type: string | null;
  source_id: string | null;
  channel: string | null;
  credit_card_id: string | null;
};

type DataClient = SupabaseClient<Database>;

function defaultSourceType(source: string): string {
  switch (source) {
    case "whatsapp": return "whatsapp_message";
    case "recurring": return "fixed_bill";
    case "installment": return "installment_purchase";
    case "import": return "import_batch";
    default: return source || "manual";
  }
}

function defaultChannel(source: string): "whatsapp" | "site" | "import" | "api" {
  if (source === "whatsapp") return "whatsapp";
  if (source === "import") return "import";
  return "site";
}

function validIso(value: string): boolean {
  return Number.isFinite(new Date(value).getTime());
}

function sameInstant(a: string, b: string): boolean {
  return new Date(a).getTime() === new Date(b).getTime();
}

function sameNullable(a?: string | null, b?: string | null): boolean {
  return (a ?? null) === (b ?? null);
}

function assertPersisted(row: PersistedTransaction, input: TransactionWriteInput) {
  const valid =
    row.user_id === input.userId &&
    row.kind === input.kind &&
    Math.abs(Number(row.amount) - input.amount) < 0.001 &&
    row.category === input.category &&
    sameNullable(row.description, input.description) &&
    sameInstant(row.occurred_at, input.occurredAt) &&
    row.source === input.source &&
    sameNullable(row.source_message_id, input.sourceMessageId) &&
    sameNullable(row.import_batch_id, input.importBatchId) &&
    sameNullable(row.source_type, input.sourceType) &&
    sameNullable(row.source_id, input.sourceId) &&
    sameNullable(row.channel, input.channel) &&
    sameNullable(row.credit_card_id, input.creditCardId);

  if (!valid) throw new Error("TRANSACTION_PERSISTENCE_MISMATCH");
}

export async function writeVerifiedTransaction(
  client: DataClient,
  input: TransactionWriteInput,
): Promise<PersistedTransaction> {
  const auditId = `tx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const audit = (step: string, extra?: Record<string, unknown>) => {
    try { console.info(`[ledger:${auditId}] ${step}`, { userId: input.userId, kind: input.kind, amount: input.amount, source: input.source, ...extra }); } catch {}
  };
  audit("1_input_received", { category: input.category, occurredAt: input.occurredAt });

  if (!input.userId || !Number.isFinite(input.amount) || input.amount <= 0) {
    audit("INVALID_INPUT_AMOUNT");
    throw new Error("TRANSACTION_INVALID_INPUT");
  }
  if (!input.category.trim() || !validIso(input.occurredAt)) {
    audit("INVALID_INPUT_CATEGORY_OR_DATE");
    throw new Error("TRANSACTION_INVALID_INPUT");
  }

  const payload = {
    user_id: input.userId,
    kind: input.kind,
    amount: Math.round(input.amount * 100) / 100,
    category: input.category.trim().slice(0, 60),
    description: input.description?.trim().slice(0, 280) || null,
    occurred_at: new Date(input.occurredAt).toISOString(),
    source: input.source,
    source_message_id: input.sourceMessageId ?? null,
    import_batch_id: input.importBatchId ?? null,
    // Rastreabilidade obrigatória: todo valor tem origem e canal identificáveis.
    source_type: input.sourceType ?? defaultSourceType(input.source),
    source_id: input.sourceId ?? input.sourceMessageId ?? input.importBatchId ?? null,
    channel: input.channel ?? defaultChannel(input.source),
    credit_card_id: input.creditCardId ?? null,
  };
  audit("2_payload_ready", { occurred_at: payload.occurred_at, amount: payload.amount });

  const { data, error } = await client
    .from("transactions")
    .insert(payload)
    .select(
      "id, user_id, kind, amount, category, description, occurred_at, source, source_message_id, import_batch_id, source_type, source_id, channel, credit_card_id",
    )
    .single();

  if (error || !data) {
    audit("3_insert_FAILED", { error: error?.message ?? "no data" });
    throw error ?? new Error("TRANSACTION_NOT_PERSISTED");
  }
  const row = data as PersistedTransaction;
  audit("3_insert_ok", { txId: row.id });

  assertPersisted(row, {
    ...input,
    amount: payload.amount,
    category: payload.category,
    description: payload.description,
    occurredAt: payload.occurred_at,
    sourceType: payload.source_type,
    sourceId: payload.source_id,
    channel: payload.channel as TransactionWriteInput["channel"],
  });
  audit("4_persistence_asserted", { txId: row.id });

  // Verificação pós-persistência: relê a linha do banco (com filtro por
  // user_id, o mesmo usado por dashboard/transações/relatórios) para
  // garantir que ela está disponível para leituras subsequentes. Sem
  // essa confirmação NUNCA respondemos como sucesso — o saldo (derivado)
  // nunca muda antes de a linha existir.
  for (let attempt = 1; attempt <= 4; attempt++) {
    const { data: verify, error: verr } = await client
      .from("transactions")
      .select("id, user_id, kind, amount, occurred_at")
      .eq("id", row.id)
      .eq("user_id", input.userId)
      .maybeSingle();
    if (verify?.id) {
      audit("5_verified_visible", { txId: row.id, attempt });
      return row;
    }
    audit("5_verify_miss", { txId: row.id, attempt, error: verr?.message ?? null });
    await new Promise((r) => setTimeout(r, 120 * attempt));
  }
  audit("6_verification_FAILED", { txId: row.id });
  throw new Error("TRANSACTION_VERIFICATION_FAILED");
}

