import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Input = {
  type: "chamado" | "suggestion" | "bug";
  subject: string;
  message: string;
};

export const listMyTickets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.from("support_tickets")
      .select("*").eq("user_id", context.userId).order("created_at", { ascending: false }).limit(50);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const createTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: Input) => d)
  .handler(async ({ context, data }) => {
    if (!["chamado", "suggestion", "bug"].includes(data.type)) throw new Error("Tipo inválido.");
    if (!data.subject?.trim()) throw new Error("Informe um assunto.");
    if (!data.message?.trim()) throw new Error("Descreva sua mensagem.");
    const { error } = await context.supabase.from("support_tickets").insert({
      user_id: context.userId, type: data.type,
      subject: data.subject.trim().slice(0, 140),
      message: data.message.trim().slice(0, 2000),
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
