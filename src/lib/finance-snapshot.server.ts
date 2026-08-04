// FONTE ÚNICA DE VERDADE do resumo financeiro.
//
// Saldo, receitas, despesas e totais por categoria NUNCA são armazenados nem
// calculados em paralelo: são sempre derivados da tabela `transactions` pela
// função SQL `public.finance_snapshot`. Site (cliente autenticado) e WhatsApp
// (service role) chamam exatamente a mesma função, sobre exatamente as mesmas
// linhas — por isso os números não podem divergir entre os canais.
//
// Regra: se um valor não existe em `transactions`, ele não entra no snapshot;
// se entrou no snapshot, existe uma transação rastreável (source_type/source_id).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type SnapshotCategory = {
  category: string;
  kind: "income" | "expense";
  total: number;
  count: number;
};

export type FinanceSnapshot = {
  userId: string;
  from: string | null;
  to: string | null;
  income: number;
  expense: number;
  balance: number;
  txCount: number;
  byCategory: SnapshotCategory[];
  generatedAt: string;
};

type AnyClient = SupabaseClient<Database> | SupabaseClient<any, any, any>;

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

/**
 * Resumo oficial do período (ou do histórico completo quando from/to são nulos).
 * Lança erro em qualquer falha: um resumo indisponível NUNCA vira zero, para
 * que nenhum canal exiba/afirme um saldo inventado.
 */
export async function fetchFinanceSnapshot(
  client: AnyClient,
  userId: string,
  opts?: { from?: string | null; to?: string | null },
): Promise<FinanceSnapshot> {
  const { data, error } = await (client as any).rpc("finance_snapshot", {
    _user_id: userId,
    _from: opts?.from ?? null,
    _to: opts?.to ?? null,
  });
  if (error) throw new Error(`FINANCE_SNAPSHOT_FAILED: ${error.message}`);
  const s = (data ?? {}) as Record<string, unknown>;

  return {
    userId,
    from: (s["from"] as string | null) ?? null,
    to: (s["to"] as string | null) ?? null,
    income: num(s["income"]),
    expense: num(s["expense"]),
    balance: num(s["balance"]),
    txCount: Number(s["tx_count"] ?? 0),
    byCategory: Array.isArray(s["by_category"])
      ? (s["by_category"] as any[]).map((c) => ({
          category: String(c?.category ?? "Outros"),
          kind: c?.kind === "income" ? "income" : "expense",
          total: num(c?.total),
          count: Number(c?.count ?? 0),
        }))
      : [],
    generatedAt: String(s["generated_at"] ?? new Date().toISOString()),
  };
}
