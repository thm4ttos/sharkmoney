import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type DebtInput = {
  id?: string;
  title: string;
  creditor?: string | null;
  principal: number;
  interest_rate?: number;
  due_at?: string | null;
  notify_whatsapp?: boolean;
  notes?: string | null;
  paid?: boolean;
};

export const listDebts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("debts").select("*").eq("user_id", userId)
      .order("due_at", { ascending: true, nullsFirst: false });
    if (error) throw new Error(error.message);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const rows = (data ?? []).map((d: any) => {
      let daysUntil: number | null = null;
      let overdue = false;
      if (d.due_at) {
        const due = new Date(d.due_at + "T00:00:00");
        daysUntil = Math.round((due.getTime() - today.getTime()) / 86400000);
        overdue = !d.paid && daysUntil < 0;
      }
      return { ...d, principal: Number(d.principal), interest_rate: Number(d.interest_rate), days_until: daysUntil, overdue };
    });
    const totals = rows.reduce((acc: any, d: any) => {
      if (!d.paid) acc.open += d.principal;
      if (d.overdue) acc.overdue += d.principal;
      if (!d.paid && d.days_until !== null && d.days_until >= 0 && d.days_until <= 7) acc.upcoming += d.principal;
      return acc;
    }, { open: 0, overdue: 0, upcoming: 0 });
    return { debts: rows, totals };
  });

export const upsertDebt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: DebtInput) => d)
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    if (!data.title?.trim()) throw new Error("Informe um título.");
    if (!Number.isFinite(data.principal) || data.principal < 0) throw new Error("Valor inválido.");
    const payload: any = {
      user_id: userId,
      title: data.title.trim().slice(0, 120),
      creditor: data.creditor?.toString().slice(0, 120) || null,
      principal: Number(data.principal),
      interest_rate: Number(data.interest_rate ?? 0),
      due_at: data.due_at || null,
      notify_whatsapp: data.notify_whatsapp ?? true,
      notes: data.notes?.toString().slice(0, 500) || null,
      paid: data.paid ?? false,
    };
    if (data.id) {
      const { error } = await supabase.from("debts").update(payload).eq("id", data.id).eq("user_id", userId);
      if (error) throw new Error(error.message);
      return { ok: true };
    }
    const { error } = await supabase.from("debts").insert(payload);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteDebt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("debts").delete().eq("id", data.id).eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const togglePaidDebt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; paid: boolean }) => d)
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("debts").update({ paid: data.paid }).eq("id", data.id).eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
