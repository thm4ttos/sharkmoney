// SERVER-ONLY. Blindagem V1 do Shark Money — Pilares 1/3/4:
// - Índice de confiança da IA + gate de execução (Goal B)
// - Detecção de anomalia (valor >5x a média da categoria em 60 dias) (Goal C)
// - Contexto conversacional persistente com TTL de 30 min (Goal D)
//
// Este módulo NÃO decide a resposta ao usuário — apenas devolve sinais.
// O roteamento fica em `wa-processor.server.ts` e as gravações continuam em
// `brinzap-actions.server.ts`. Assim mantemos as regras de blindagem em um
// só lugar, fáceis de auditar e ajustar sem tocar no pipeline principal.

import { supabaseAdmin } from "@/integrations/supabase/client.server";

// ===== Confiança (Shark Money V2 — "resolva, não pergunte") =====
// Regra nº 5 do prompt mestre: acima de ~50% de certeza sobre a intenção,
// o Shark Money EXECUTA. Confirmação só em ambiguidade real ou anomalia.
// >= HIGH → executa silencioso
// LOW <= x < HIGH → executa mas registra p/ aprendizado
// FLOOR <= x < LOW → confirmação simples (SIM/NÃO)
// < FLOOR → nunca executa; oferece menu de opções (1/2/3)
export const CONFIDENCE_HIGH = 0.70;
export const CONFIDENCE_LOW = 0.50;
export const CONFIDENCE_FLOOR = 0.35;

export type ConfidenceGate = "execute" | "execute_and_learn" | "ask" | "menu";

export function gateConfidence(confidence: number | undefined | null): ConfidenceGate {
  // Regras determinísticas (overrides, spontHit, bulk parser, etc.) chegam
  // sem `confidence`. Nesses casos o valor é 1 por definição — pulamos o gate.
  if (confidence === undefined || confidence === null || !Number.isFinite(confidence)) return "execute";
  if (confidence >= CONFIDENCE_HIGH) return "execute";
  if (confidence >= CONFIDENCE_LOW) return "execute_and_learn";
  if (confidence >= CONFIDENCE_FLOOR) return "ask";
  return "menu";
}


/** Registra uma classificação de confiança intermediária para reforço futuro. */
export async function logMediumConfidence(params: {
  userId: string;
  originalText: string;
  intent: { kind?: string; confidence?: number; category?: string; amount?: number };
}) {
  try {
    await supabaseAdmin.from("user_ai_learning").insert({
      user_id: params.userId,
      original_text: (params.originalText ?? "").slice(0, 500),
      corrected_field: "confidence_medium",
      original_value: JSON.stringify({
        kind: params.intent.kind,
        confidence: params.intent.confidence,
        category: params.intent.category,
        amount: params.intent.amount,
      }).slice(0, 500),
      corrected_value: null,
      transaction_id: null,
      source: "auto_medium_confidence",
    });
  } catch (e) {
    console.warn("[ai-confidence] logMediumConfidence failed", (e as any)?.message ?? e);
  }
}

// ===== Anomalia (Goal C) =====
// "Muito acima do normal" = > 5× a média da MESMA categoria nos últimos 60 dias
// com pelo menos 3 lançamentos amostrais. Sem histórico suficiente não bloqueia
// (evita atrito no início da jornada do usuário).
const ANOMALY_MULTIPLIER = 5;
const ANOMALY_MIN_SAMPLES = 3;
const ANOMALY_WINDOW_DAYS = 60;

export type AnomalyResult = {
  isAnomaly: boolean;
  average?: number;
  samples?: number;
  multiplier?: number;
};

export async function detectExpenseAnomaly(
  userId: string,
  category: string | undefined | null,
  amount: number | undefined | null,
): Promise<AnomalyResult> {
  if (!category || !amount || !(amount > 0)) return { isAnomaly: false };
  const since = new Date(Date.now() - ANOMALY_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabaseAdmin
    .from("transactions")
    .select("amount")
    .eq("user_id", userId)
    .eq("kind", "expense")
    .eq("category", category)
    .gte("occurred_at", since)
    .limit(500);
  if (error) {
    console.warn("[ai-confidence] anomaly query failed", error.message);
    return { isAnomaly: false };
  }
  const rows = (data ?? [])
    .map((r: any) => Number(r.amount))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (rows.length < ANOMALY_MIN_SAMPLES) {
    return { isAnomaly: false, samples: rows.length };
  }
  const avg = rows.reduce((a, b) => a + b, 0) / rows.length;
  if (!(avg > 0)) return { isAnomaly: false, samples: rows.length };
  const ratio = amount / avg;
  return {
    isAnomaly: ratio >= ANOMALY_MULTIPLIER,
    average: Math.round(avg * 100) / 100,
    samples: rows.length,
    multiplier: Math.round(ratio * 10) / 10,
  };
}

// ===== Contexto conversacional persistente (Goal D) =====
// A tabela `wa_conversation_context` já existe (PK: user_id). Guardamos aqui a
// última transação/intenção/categoria/valor. Consumidores devem respeitar TTL.
export const CONTEXT_TTL_MS = 30 * 60 * 1000;

export type ConversationContext = {
  user_id: string;
  last_transaction_id: string | null;
  last_intent: string | null;
  last_amount: number | null;
  last_category: string | null;
  last_message_at: string | null;
  extra: any;
};

export async function writeConversationContext(userId: string, patch: {
  last_transaction_id?: string | null;
  last_intent?: string | null;
  last_amount?: number | null;
  last_category?: string | null;
  extra?: Record<string, any>;
}): Promise<void> {
  try {
    const now = new Date().toISOString();
    await supabaseAdmin.from("wa_conversation_context").upsert(
      {
        user_id: userId,
        last_transaction_id: patch.last_transaction_id ?? null,
        last_intent: patch.last_intent ?? null,
        last_amount: patch.last_amount ?? null,
        last_category: patch.last_category ?? null,
        extra: patch.extra ?? {},
        last_message_at: now,
        updated_at: now,
      },
      { onConflict: "user_id" },
    );
  } catch (e) {
    console.warn("[ai-confidence] writeConversationContext failed", (e as any)?.message ?? e);
  }
}

export async function readConversationContext(userId: string): Promise<ConversationContext | null> {
  try {
    const { data } = await supabaseAdmin
      .from("wa_conversation_context")
      .select("user_id, last_transaction_id, last_intent, last_amount, last_category, last_message_at, extra")
      .eq("user_id", userId)
      .maybeSingle();
    if (!data) return null;
    const t = data.last_message_at ? new Date(data.last_message_at).getTime() : 0;
    if (!t || Date.now() - t > CONTEXT_TTL_MS) return null;
    return data as ConversationContext;
  } catch (e) {
    console.warn("[ai-confidence] readConversationContext failed", (e as any)?.message ?? e);
    return null;
  }
}
