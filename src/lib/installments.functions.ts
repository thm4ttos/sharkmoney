import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { installmentDueDate, todaySP, diffDaysYMD } from "@/lib/installments-dates";

type InstInput = {
  id?: string;
  title: string;
  category?: string;
  total_amount: number;
  installments_total: number;
  installments_paid?: number;
  first_due_at: string;
  purchased_at?: string;
  notes?: string | null;
  active?: boolean;
  notify_whatsapp?: boolean;
  reminder_offsets?: number[];
};

export const listInstallments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("installment_purchases").select("*").eq("user_id", userId)
      .order("first_due_at", { ascending: true });
    if (error) throw new Error(error.message);
    const today = todaySP();
    return (data ?? []).map((p: any) => {
      const total = Number(p.total_amount);
      const installmentValue = total / p.installments_total;
      const paid = p.installments_paid;
      const remaining = p.installments_total - paid;
      const paidAmount = installmentValue * paid;
      const remainingAmount = installmentValue * remaining;
      const done = remaining <= 0;
      const nextNumber = done ? null : paid + 1;
      const nextDueAt = done ? null : installmentDueDate(p.first_due_at, paid + 1);
      const daysUntil = nextDueAt ? diffDaysYMD(today, nextDueAt) : null;
      return {
        ...p,
        total_amount: total,
        installment_value: Math.round(installmentValue * 100) / 100,
        paid_amount: Math.round(paidAmount * 100) / 100,
        remaining_amount: Math.round(remainingAmount * 100) / 100,
        installments_remaining: remaining,
        reminder_offsets: (p.reminder_offsets ?? []) as number[],
        next_installment_number: nextNumber,
        next_due_at: nextDueAt,
        days_until_due: daysUntil,
        is_overdue: daysUntil !== null && daysUntil < 0,
        is_due_today: daysUntil === 0,
        progress_pct: p.installments_total > 0 ? Math.round((paid / p.installments_total) * 100) : 0,
      };
    });
  });

export const upsertInstallment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: InstInput) => d)
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    if (!data.title?.trim()) throw new Error("Informe um título.");
    if (!Number.isFinite(data.total_amount) || data.total_amount <= 0) throw new Error("Valor total inválido.");
    if (!Number.isFinite(data.installments_total) || data.installments_total <= 0) throw new Error("Número de parcelas inválido.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data.first_due_at ?? ""))) throw new Error("Informe a data da próxima parcela.");
    const offsets = Array.from(new Set((data.reminder_offsets ?? []).map((n) => Number(n))))
      .filter((n) => [0, 1, 3, 5, 7].includes(n));
    const notify = !!data.notify_whatsapp && offsets.length > 0;
    const payload: any = {
      user_id: userId,
      title: data.title.trim().slice(0, 120),
      category: (data.category ?? "Compras").slice(0, 60),
      total_amount: Number(data.total_amount),
      installments_total: Number(data.installments_total),
      installments_paid: Math.max(0, Number(data.installments_paid ?? 0)),
      first_due_at: data.first_due_at,
      purchased_at: data.purchased_at || new Date().toISOString().slice(0, 10),
      notes: data.notes || null,
      active: data.active ?? true,
      notify_whatsapp: notify,
      reminder_offsets: notify ? offsets : [],
    };
    if (data.id) {
      const { error } = await supabase.from("installment_purchases").update(payload).eq("id", data.id).eq("user_id", userId);
      if (error) throw new Error(error.message);
      return { ok: true };
    }
    const { error } = await supabase.from("installment_purchases").insert(payload);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const payInstallment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;

    // Operação atômica no banco: cria a despesa em Transações, avança a parcela
    // e limpa lembretes numa única transação SQL. Se qualquer etapa falhar,
    // nada é gravado — nunca existe parcela paga sem despesa (nem o contrário).
    const { data: res, error } = await supabase.rpc("pay_installment_atomic", {
      p_user_id: userId,
      p_purchase_id: data.id,
      p_occurred_at: new Date().toISOString(),
      p_channel: "site",
    });
    if (error) throw new Error(error.message);
    const out = (res ?? {}) as Record<string, any>;
    if (out["already_done"]) return { ok: true, done: true };

    // Confirmação de persistência: só respondemos sucesso depois de reler a
    // despesa criada com o mesmo filtro usado pelo painel/relatórios.
    const txId = String(out["transaction_id"] ?? "");
    const { data: tx } = await supabase
      .from("transactions").select("id").eq("id", txId).eq("user_id", userId).maybeSingle();
    if (!tx?.id) throw new Error("Não foi possível confirmar o lançamento. Nada foi alterado.");

    const { data: row } = await supabase
      .from("installment_purchases").select("first_due_at, installments_paid, installments_total")
      .eq("id", data.id).eq("user_id", userId).maybeSingle();

    const paidNumber = Number(out["paid_number"] ?? 0);
    const finished = !!out["finished"];
    return {
      ok: true,
      transaction_id: txId,
      paid_number: paidNumber,
      paid_amount: Number(out["paid_amount"] ?? 0),
      paid_due_at: row?.first_due_at ? installmentDueDate(row.first_due_at, paidNumber) : null,
      finished,
      next_due_at: finished || !row?.first_due_at ? null : installmentDueDate(row.first_due_at, paidNumber + 1),
    };
  });


export const deleteInstallment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("installment_purchases").delete().eq("id", data.id).eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
