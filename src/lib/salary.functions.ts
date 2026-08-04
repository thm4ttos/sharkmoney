import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dateInputSPToIso } from "@/lib/datetime";

type Input = {
  id?: string;
  kind: "salary" | "extra" | "commission" | "bonus";
  amount: number;
  received_at: string;
  notes?: string | null;
};

export const listSalary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase.from("salary_entries")
      .select("*").eq("user_id", userId)
      .order("received_at", { ascending: false }).limit(200);
    if (error) throw new Error(error.message);
    const rows = (data ?? []).map((r: any) => ({ ...r, amount: Number(r.amount) }));
    const now = new Date();
    let totalReceived = 0;
    const byMonth = new Map<string, number>();
    for (const r of rows) {
      const m = (r.received_at as string).slice(0, 7);
      byMonth.set(m, (byMonth.get(m) ?? 0) + r.amount);
      totalReceived += r.amount;
    }
    const series = [...byMonth.entries()].sort().slice(-6).map(([month, total]) => ({ month, total: Math.round(total * 100) / 100 }));
    const nextSalary = rows.filter((r: any) => r.kind === "salary").find((r: any) => new Date(r.received_at) > now);
    return {
      entries: rows,
      month_total: Math.round(totalReceived * 100) / 100,
      next: nextSalary ?? null,
      series,
    };
  });

export const upsertSalary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: Input) => d)
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    if (!["salary", "extra", "commission", "bonus"].includes(data.kind)) throw new Error("Tipo inválido.");
    if (!Number.isFinite(data.amount) || data.amount < 0) throw new Error("Valor inválido.");
    const payload: any = {
      user_id: userId, kind: data.kind, amount: Number(data.amount),
      received_at: data.received_at, notes: data.notes || null,
    };
    if (data.id) {
      const { error } = await supabase.from("salary_entries").update(payload).eq("id", data.id).eq("user_id", userId);
      if (error) throw new Error(error.message);
      return { ok: true };
    }
    const { error } = await supabase.from("salary_entries").insert(payload);
    if (error) throw new Error(error.message);
    // mirror em transactions como receita para entrar no fluxo financeiro
    const { writeVerifiedTransaction } = await import("@/lib/transaction-ledger.server");
    await writeVerifiedTransaction(supabase, {
      userId,
      kind: "income",
      amount: payload.amount,
      category: "Receita",
      description: `Salário/${data.kind}`,
      source: "salary",
      occurredAt: dateInputSPToIso(data.received_at),
    });
    return { ok: true };
  });

export const deleteSalary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("salary_entries").delete().eq("id", data.id).eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
