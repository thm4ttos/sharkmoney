// Modo Casal: vínculo com consentimento mútuo entre duas contas Abio, com
// compartilhamento seletivo (só o que for marcado visibility='shared' —
// tudo o mais continua privado, garantido pela RLS em couple_mode.sql).
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const SHAREABLE_TABLES = ["transactions", "recurring_bills", "installment_purchases", "financial_goals"] as const;
type ShareableTable = (typeof SHAREABLE_TABLES)[number];

async function getActiveAcceptedLink(supabase: any, userId: string) {
  const { data } = await supabase
    .from("couple_links" as any)
    .select("*")
    .or(`requester_id.eq.${userId},partner_id.eq.${userId}`)
    .eq("status", "accepted")
    .maybeSingle();
  return data as any;
}

export const getCoupleStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: link } = await supabase
      .from("couple_links" as any)
      .select("*")
      .or(`requester_id.eq.${userId},partner_id.eq.${userId}`)
      .in("status", ["pending", "accepted"])
      .order("created_at", { ascending: false })
      .maybeSingle();
    if (!link) return { link: null, role: null, partner: null };

    const l = link as any;
    const role: "requester" | "partner" = l.requester_id === userId ? "requester" : "partner";
    const partnerId = role === "requester" ? l.partner_id : l.requester_id;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: partner } = await supabaseAdmin.from("profiles").select("id, name, phone").eq("id", partnerId).maybeSingle();
    return { link: l, role, partner: partner ?? null };
  });

export const createCoupleInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { phone: string }) => data)
  .handler(async ({ context, data }) => {
    const { userId } = context;
    const { phoneLookupVariants } = await import("@/lib/phone");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const variants = phoneLookupVariants(data.phone);
    if (!variants.length) throw new Error("Telefone inválido.");

    const { data: partnerProfile } = await supabaseAdmin
      .from("profiles").select("id, name, phone").in("phone", variants).maybeSingle();
    if (!partnerProfile) throw new Error("Não encontramos nenhuma conta Abio com esse número.");
    if (partnerProfile.id === userId) throw new Error("Você não pode se vincular com sua própria conta.");

    const { data: existingMine } = await supabaseAdmin
      .from("couple_links" as any).select("id")
      .or(`requester_id.eq.${userId},partner_id.eq.${userId}`)
      .in("status", ["pending", "accepted"]).maybeSingle();
    if (existingMine) throw new Error("Você já tem um vínculo pendente ou ativo. Desvincule antes de convidar outra pessoa.");

    const { data: existingTheirs } = await supabaseAdmin
      .from("couple_links" as any).select("id")
      .or(`requester_id.eq.${partnerProfile.id},partner_id.eq.${partnerProfile.id}`)
      .in("status", ["pending", "accepted"]).maybeSingle();
    if (existingTheirs) throw new Error("Essa pessoa já tem um vínculo pendente ou ativo com outra conta.");

    const { data: myProfile } = await supabaseAdmin.from("profiles").select("name").eq("id", userId).maybeSingle();

    const { data: link, error } = await supabaseAdmin
      .from("couple_links" as any)
      .insert({ requester_id: userId, partner_id: partnerProfile.id, status: "pending" })
      .select().single();
    if (error) {
      if ((error as any).code === "23505") throw new Error("Já existe um convite pendente entre vocês.");
      throw new Error(error.message);
    }

    const requesterName = (myProfile?.name || "Alguém").split(" ")[0];
    const { sendWhatsAppText } = await import("@/lib/uazapi.server");
    await sendWhatsAppText(
      partnerProfile.phone,
      `💙 *${requesterName}* te convidou pro *Modo Casal* do Abio — vocês podem compartilhar gastos/contas/metas escolhidos a dedo, mantendo o resto privado.\n\nResponda *sim* para aceitar ou *não* para recusar.`,
    );
    await supabaseAdmin.from("wa_contacts").upsert(
      {
        phone: partnerProfile.phone,
        name: partnerProfile.name ?? null,
        pending_action: {
          kind: "couple_invite_pending",
          link_id: (link as any).id,
          requester_id: userId,
          requester_name: requesterName,
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        } as any,
      },
      { onConflict: "phone" },
    );
    return { ok: true, linkId: (link as any).id };
  });

export const respondCoupleInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { linkId: string; accept: boolean }) => data)
  .handler(async ({ context, data }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: link } = await supabaseAdmin.from("couple_links" as any).select("*").eq("id", data.linkId).maybeSingle();
    if (!link) throw new Error("Convite não encontrado.");
    const l = link as any;
    if (l.partner_id !== userId) throw new Error("Esse convite não é seu.");
    if (l.status !== "pending") throw new Error("Esse convite já foi respondido.");

    const nextStatus = data.accept ? "accepted" : "rejected";
    const { error } = await supabaseAdmin
      .from("couple_links" as any)
      .update({ status: nextStatus, responded_at: new Date().toISOString() })
      .eq("id", data.linkId).eq("status", "pending");
    if (error) throw new Error(error.message);

    if (data.accept) {
      const [{ data: requesterProfile }, { data: myProfile }] = await Promise.all([
        supabaseAdmin.from("profiles").select("phone").eq("id", l.requester_id).maybeSingle(),
        supabaseAdmin.from("profiles").select("name").eq("id", userId).maybeSingle(),
      ]);
      if (requesterProfile?.phone) {
        const { sendWhatsAppText } = await import("@/lib/uazapi.server");
        await sendWhatsAppText(
          requesterProfile.phone,
          `🎉 *${(myProfile?.name || "Seu parceiro(a)").split(" ")[0]}* aceitou seu convite! Agora vocês já podem compartilhar gastos no Modo Casal.`,
        );
      }
    }
    return { ok: true, status: nextStatus };
  });

export const unlinkCouple = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { linkId: string }) => data)
  .handler(async ({ context, data }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: link } = await supabaseAdmin.from("couple_links" as any).select("*").eq("id", data.linkId).maybeSingle();
    if (!link) throw new Error("Vínculo não encontrado.");
    const l = link as any;
    if (l.requester_id !== userId && l.partner_id !== userId) throw new Error("Esse vínculo não é seu.");
    if (!["pending", "accepted"].includes(l.status)) throw new Error("Esse vínculo já foi encerrado.");

    const { error } = await supabaseAdmin
      .from("couple_links" as any)
      .update({ status: "cancelled", unlinked_at: new Date().toISOString() })
      .eq("id", data.linkId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateSplitRatio = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { linkId: string; splitRatioRequester: number }) => data)
  .handler(async ({ context, data }) => {
    const { userId } = context;
    if (!Number.isFinite(data.splitRatioRequester) || data.splitRatioRequester < 0 || data.splitRatioRequester > 100) {
      throw new Error("Percentual inválido.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: link } = await supabaseAdmin.from("couple_links" as any).select("id, requester_id, partner_id, status").eq("id", data.linkId).maybeSingle();
    const l = link as any;
    if (!l || l.status !== "accepted") throw new Error("Vínculo não encontrado ou não aceito.");
    if (l.requester_id !== userId && l.partner_id !== userId) throw new Error("Esse vínculo não é seu.");

    const { error } = await supabaseAdmin.from("couple_links" as any).update({ split_ratio_requester: data.splitRatioRequester }).eq("id", data.linkId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setItemVisibility = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { table: ShareableTable; id: string; visibility: "personal" | "shared" }) => data)
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    if (!SHAREABLE_TABLES.includes(data.table)) throw new Error("Tabela inválida.");

    if (data.visibility === "shared") {
      const link = await getActiveAcceptedLink(supabase, userId);
      if (!link) throw new Error("Você precisa ter um parceiro(a) vinculado(a) pra compartilhar.");
    }

    const { error } = await (supabase.from(data.table as any) as any)
      .update({ visibility: data.visibility })
      .eq("id", data.id).eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listSharedItems = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const link = await getActiveAcceptedLink(supabase, userId);
    if (!link) return { link: null, transactions: [], bills: [], installments: [], goals: [] };
    const partnerId = link.requester_id === userId ? link.partner_id : link.requester_id;
    const ids = [userId, partnerId];

    const [{ data: tx }, { data: bills }, { data: inst }, { data: goals }] = await Promise.all([
      supabase.from("transactions" as any).select("*").eq("visibility", "shared").in("user_id", ids).order("occurred_at", { ascending: false }).limit(100),
      supabase.from("recurring_bills" as any).select("*").eq("visibility", "shared").in("user_id", ids),
      supabase.from("installment_purchases" as any).select("*").eq("visibility", "shared").in("user_id", ids),
      supabase.from("financial_goals" as any).select("*").eq("visibility", "shared").in("user_id", ids),
    ]);
    return { link, partnerId, transactions: tx ?? [], bills: bills ?? [], installments: inst ?? [], goals: goals ?? [] };
  });

/**
 * Núcleo do cálculo de saldo/divisão do casal — função simples (não
 * createServerFn) pra poder ser chamada tanto pelo site (client autenticado,
 * RLS) quanto pelo WhatsApp (supabaseAdmin, service role), sem duplicar a
 * lógica em dois lugares. Nunca cria transferência automática, só calcula
 * o desequilíbrio pra exibição.
 */
export async function computeCoupleBalanceCore(client: any, userId: string) {
  const link = await getActiveAcceptedLink(client, userId);
  if (!link) return { link: null };

  const requesterId = link.requester_id as string;
  const partnerUserId = link.partner_id as string;
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const { data: rows } = await client
    .from("transactions" as any)
    .select("amount, user_id, paid_by_user_id")
    .eq("visibility", "shared").eq("kind", "expense")
    .in("user_id", [requesterId, partnerUserId]).gte("occurred_at", start);

  const paidBy: Record<string, number> = {};
  let total = 0;
  for (const r of (rows ?? []) as any[]) {
    const payer = r.paid_by_user_id ?? r.user_id;
    const amt = Number(r.amount) || 0;
    paidBy[payer] = (paidBy[payer] ?? 0) + amt;
    total += amt;
  }

  const requesterShare = Math.round(total * (Number(link.split_ratio_requester) / 100) * 100) / 100;
  const partnerShare = Math.round((total - requesterShare) * 100) / 100;
  const requesterPaid = Math.round((paidBy[requesterId] ?? 0) * 100) / 100;
  const partnerPaid = Math.round((paidBy[partnerUserId] ?? 0) * 100) / 100;
  // positivo = pagou mais que sua parte justa (o outro deve essa diferença)
  const requesterDelta = Math.round((requesterPaid - requesterShare) * 100) / 100;

  return {
    link, total, requesterId, partnerId: partnerUserId,
    requesterShare, partnerShare, requesterPaid, partnerPaid, requesterDelta,
    periodStart: start,
  };
}

export const computeCoupleBalance = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => computeCoupleBalanceCore(context.supabase, context.userId));
