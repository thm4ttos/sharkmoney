import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type BillInput = {
  id?: string;
  title: string;
  category?: string;
  amount: number;
  frequency: "weekly" | "biweekly" | "monthly" | "yearly";
  next_due_at: string;
  active?: boolean;
  notify_whatsapp?: boolean;
  notes?: string | null;
  total_installments?: number | null;
  paid_installments?: number | null;
};


const FREQ = new Set(["weekly", "biweekly", "monthly", "yearly"]);

function advance(date: string, freq: string): string {
  const d = new Date(date + "T00:00:00Z");
  if (freq === "weekly") d.setUTCDate(d.getUTCDate() + 7);
  else if (freq === "biweekly") d.setUTCDate(d.getUTCDate() + 14);
  else if (freq === "monthly") d.setUTCMonth(d.getUTCMonth() + 1);
  else if (freq === "yearly") d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

export const listBills = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    // Garante que toda conta paga possua a despesa correspondente no livro.
    try {
      const { repairMissingBillExpenses } = await import("@/lib/brinzap-actions.server");
      await repairMissingBillExpenses(userId);
    } catch (e) {
      console.warn("[bills] repairMissingBillExpenses failed", e);
    }
    const { data, error } = await supabase
      .from("recurring_bills")
      .select("*")
      .eq("user_id", userId)
      .order("next_due_at", { ascending: true });
    if (error) throw new Error(error.message);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const { billInstallmentInfo } = await import("@/lib/bill-installments");
    return (data ?? []).map((b: any) => {
      const due = new Date(b.next_due_at + "T00:00:00");
      const daysUntil = Math.round((due.getTime() - today.getTime()) / 86400000);
      const inst = billInstallmentInfo(b);
      return {
        ...b,
        amount: Number(b.amount),
        days_until: daysUntil,
        total_installments: inst.isInstallment ? inst.total : null,
        paid_installments: inst.isInstallment ? inst.paid : 0,
        remaining_installments: inst.isInstallment ? inst.remaining : null,
        current_installment: inst.isInstallment ? inst.current : null,
        installment_percent: inst.percent,
        installment_settled: inst.settled,
      };
    });
  });


export const upsertBill = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: BillInput) => data)
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    if (!data.title?.trim()) throw new Error("Informe um título.");
    if (!FREQ.has(data.frequency)) throw new Error("Frequência inválida.");
    if (!Number.isFinite(data.amount) || data.amount < 0) throw new Error("Valor inválido.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.next_due_at)) throw new Error("Data inválida.");
    const payload: any = {
      user_id: userId,
      title: data.title.trim().slice(0, 120),
      category: (data.category ?? "Contas Fixas").slice(0, 60),
      amount: Number(data.amount),
      frequency: data.frequency,
      next_due_at: data.next_due_at,
      active: data.active ?? true,
      notify_whatsapp: data.notify_whatsapp ?? true,
      notes: data.notes?.toString().slice(0, 500) || null,
    };
    const totalInst = Number(data.total_installments);
    if (Number.isFinite(totalInst) && totalInst >= 2) {
      const paidInst = Math.max(0, Math.min(totalInst, Number(data.paid_installments ?? 0) || 0));
      payload.total_installments = Math.round(totalInst);
      payload.paid_installments = Math.round(paidInst);
      payload.payment_day = Number(data.next_due_at.slice(8, 10));
      payload.first_due_date = data.next_due_at;
    } else if (data.total_installments === null) {
      payload.total_installments = null;
      payload.paid_installments = 0;
    }

    if (data.id) {
      const { error } = await supabase.from("recurring_bills").update(payload).eq("id", data.id).eq("user_id", userId);
      if (error) throw new Error(error.message);
      return { ok: true, id: data.id };
    }
    const { data: row, error } = await supabase.from("recurring_bills").insert(payload).select("id").single();
    if (error) throw new Error(error.message);
    return { ok: true, id: row.id };
  });

export const toggleBill = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string; active: boolean }) => data)
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("recurring_bills").update({ active: data.active }).eq("id", data.id).eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteBill = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("recurring_bills").delete().eq("id", data.id).eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Lança uma despesa correspondente à conta fixa e avança o próximo vencimento.
export const chargeBillNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ context, data }) => {
    const { userId } = context;
    const { applyPartialBillPayment } = await import("@/lib/brinzap-actions.server");
    const result = await applyPartialBillPayment(userId, data.id, { isFull: true, source: "panel" });
    if (!result.ok) throw new Error(result.replyText);
    return { ok: true, message: result.replyText };
  });

// Registra um pagamento parcial (ou total) via painel, reutilizando o mesmo
// motor usado pelo WhatsApp — garante sincronização total de estado.
export const registerBillPartialPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string; paidAmount: number; occurredAt?: string; notes?: string | null; isFull?: boolean }) => data)
  .handler(async ({ context, data }) => {
    const { userId } = context;
    if (!data.id) throw new Error("Conta fixa inválida.");
    const paid = Number(data.paidAmount);
    if (!data.isFull && (!Number.isFinite(paid) || paid <= 0)) {
      throw new Error("Informe um valor válido.");
    }
    let occurredAtIso: string | undefined;
    if (data.occurredAt) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(data.occurredAt)) {
        // interpret as local date at current time
        const [y, m, d] = data.occurredAt.split("-").map(Number);
        const now = new Date();
        const dt = new Date(y, m - 1, d, now.getHours(), now.getMinutes(), now.getSeconds());
        occurredAtIso = dt.toISOString();
      } else {
        const dt = new Date(data.occurredAt);
        if (!Number.isNaN(dt.getTime())) occurredAtIso = dt.toISOString();
      }
    }
    const { applyPartialBillPayment } = await import("@/lib/brinzap-actions.server");
    const res = await applyPartialBillPayment(userId, data.id, {
      paidAmount: data.isFull ? undefined : paid,
      isFull: data.isFull,
      notes: data.notes ?? null,
      occurredAt: occurredAtIso,
      source: "panel",
    });
    if (!res.ok) throw new Error(res.replyText || "Não foi possível registrar o pagamento.");
    return { ok: true, message: res.replyText };
  });

export const listBillPayments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { billId: string }) => data)
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { data: rows, error } = await supabase
      .from("bill_payments" as any)
      .select("id, amount, notes, paid_at, created_at, transaction_id, source")
      .eq("user_id", userId)
      .eq("bill_id", data.billId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r: any) => ({ ...r, amount: Number(r.amount) }));
  });

export const reverseBillPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { paymentId: string }) => data)
  .handler(async ({ context, data }) => {
    if (!data.paymentId) throw new Error("Pagamento inválido.");
    const { data: result, error } = await context.supabase.rpc("reverse_bill_payment_atomic", {
      p_user_id: context.userId,
      p_payment_id: data.paymentId,
    });
    if (error) throw new Error("Não foi possível desfazer o pagamento com segurança.");
    return { ok: true, result };
  });
