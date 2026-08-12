// Modo Casal: vínculo com consentimento mútuo entre duas contas Abio.
// Depois de accepted, os dois enxergam automaticamente as receitas/despesas,
// contas fixas, parcelamentos e metas um do outro — transparência total
// entre o casal (o consentimento é no VÍNCULO, uma vez, mútuo e revogável a
// qualquer momento — não item por item). Nada fica visível antes do aceite,
// garantido pela RLS em couple_mode.sql (is_accepted_partner()).
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
    const { sendReplyWithOptions } = await import("@/lib/uazapi.server");
    await sendReplyWithOptions(
      partnerProfile.phone,
      `💙 *${requesterName}* te convidou pro *Modo Casal* do Abio — depois de aceitar, vocês passam a ver as receitas e despesas um do outro automaticamente, num painel só do casal.`,
      [{ id: "accept", label: "Aceitar" }, { id: "reject", label: "Recusar" }],
    );

    // `profiles.phone` e o `wa_contacts.phone` que o webhook real usa (a
    // partir do número que a Z-API manda) podem estar em formatos diferentes
    // (com/sem o 9º dígito) — gravar o pending_action direto em
    // `partnerProfile.phone` pode criar uma linha que a mensagem real dela
    // nunca vai encontrar (busca por igualdade exata, não por variantes).
    // Por isso: se ela já tem uma linha wa_contacts (variante já usada de
    // verdade pelo WhatsApp), grava NELA; só usa `partnerProfile.phone` como
    // chave quando não existe nenhuma linha ainda.
    const partnerPhoneVariants = phoneLookupVariants(partnerProfile.phone);
    const { data: existingContact } = await supabaseAdmin
      .from("wa_contacts").select("phone").in("phone", partnerPhoneVariants).maybeSingle();
    const contactPhone = existingContact?.phone ?? partnerProfile.phone;

    await supabaseAdmin.from("wa_contacts").upsert(
      {
        phone: contactPhone,
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
          `🎉 *${(myProfile?.name || "Seu parceiro(a)").split(" ")[0]}* aceitou seu convite! Já dá pra ver o painel do casal no site.`,
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

/** Lançamentos/contas/parcelamentos/metas dos DOIS lados do vínculo aceito — a RLS já garante que só existe acesso depois de accepted. */
export const listCoupleItems = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const link = await getActiveAcceptedLink(supabase, userId);
    if (!link) return { link: null, transactions: [], bills: [], installments: [], goals: [] };
    const partnerId = link.requester_id === userId ? link.partner_id : link.requester_id;
    const ids = [userId, partnerId];

    const [{ data: tx }, { data: bills }, { data: inst }, { data: goals }] = await Promise.all([
      supabase.from("transactions" as any).select("*").in("user_id", ids).order("occurred_at", { ascending: false }).limit(200),
      supabase.from("recurring_bills" as any).select("*").in("user_id", ids),
      supabase.from("installment_purchases" as any).select("*").in("user_id", ids),
      supabase.from("financial_goals" as any).select("*").in("user_id", ids),
    ]);
    return { link, partnerId, transactions: tx ?? [], bills: bills ?? [], installments: inst ?? [], goals: goals ?? [] };
  });

/**
 * Núcleo do painel do casal (receitas/despesas de cada um + saldo/divisão)
 * — função simples (não createServerFn) pra poder ser chamada tanto pelo
 * site (client autenticado, RLS) quanto pelo WhatsApp (supabaseAdmin,
 * service role), sem duplicar a lógica em dois lugares. Nunca cria
 * transferência automática, só calcula o desequilíbrio pra exibição.
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
    .select("amount, kind, user_id, paid_by_user_id, category")
    .in("user_id", [requesterId, partnerUserId]).gte("occurred_at", start);

  const stats: Record<string, { income: number; expense: number }> = {
    [requesterId]: { income: 0, expense: 0 },
    [partnerUserId]: { income: 0, expense: 0 },
  };
  const paidBy: Record<string, number> = {};
  const expenseByCategory: Record<string, number> = {};
  let totalExpense = 0;

  for (const r of (rows ?? []) as any[]) {
    const amt = Number(r.amount) || 0;
    const owner = String(r.user_id);
    if (!stats[owner]) stats[owner] = { income: 0, expense: 0 };
    if (r.kind === "income") {
      stats[owner].income += amt;
    } else {
      stats[owner].expense += amt;
      const payer = r.paid_by_user_id ?? r.user_id;
      paidBy[payer] = (paidBy[payer] ?? 0) + amt;
      totalExpense += amt;
      const cat = r.category || "Outros";
      expenseByCategory[cat] = (expenseByCategory[cat] ?? 0) + amt;
    }
  }

  const round2 = (n: number) => Math.round(n * 100) / 100;
  const requesterShare = round2(totalExpense * (Number(link.split_ratio_requester) / 100));
  const partnerShare = round2(totalExpense - requesterShare);
  const requesterPaid = round2(paidBy[requesterId] ?? 0);
  const partnerPaid = round2(paidBy[partnerUserId] ?? 0);
  // positivo = pagou mais que sua parte justa (o outro deve essa diferença)
  const requesterDelta = round2(requesterPaid - requesterShare);

  return {
    link, requesterId, partnerId: partnerUserId,
    totalExpense: round2(totalExpense),
    requesterIncome: round2(stats[requesterId]?.income ?? 0),
    requesterExpense: round2(stats[requesterId]?.expense ?? 0),
    partnerIncome: round2(stats[partnerUserId]?.income ?? 0),
    partnerExpense: round2(stats[partnerUserId]?.expense ?? 0),
    requesterShare, partnerShare, requesterPaid, partnerPaid, requesterDelta,
    topCategories: Object.entries(expenseByCategory).map(([category, total]) => ({ category, total: round2(total) })).sort((a, b) => b.total - a.total),
    periodStart: start,
  };
}

export const computeCoupleBalance = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => computeCoupleBalanceCore(context.supabase, context.userId));
