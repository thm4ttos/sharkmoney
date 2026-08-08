// SERVER-ONLY. Consulta e edição dos dados de PERFIL financeiro coletados no
// onboarding (renda mensal, dia de recebimento, profissão, objetivo).
//
// Regra crítica: renda mensal CADASTRADA é planejamento, não é dinheiro que
// entrou. Nunca cria transação nem mexe no saldo — só lê/escreve profiles.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type ProfileField = "income" | "payday" | "profession" | "goal";

const BRL = (n: number) => `R$ ${Number(n).toFixed(2).replace(".", ",")}`;

const FIELD_LABEL: Record<ProfileField, string> = {
  income: "renda mensal",
  payday: "dia/frequência de recebimento",
  profession: "profissão/atividade",
  goal: "objetivo financeiro",
};

export async function queryProfileField(userId: string, field: ProfileField): Promise<{ replyText: string }> {
  const { data: p } = await supabaseAdmin
    .from("profiles")
    .select("monthly_income, payday, profession, financial_goal")
    .eq("id", userId)
    .maybeSingle();

  if (field === "income") {
    const v = p?.monthly_income;
    if (v == null) return { replyText: "💰 Você ainda não cadastrou sua renda mensal. Quanto costuma receber por mês?" };
    return { replyText: `💰 Sua renda mensal cadastrada é *${BRL(Number(v))}*.` };
  }
  if (field === "payday") {
    const v = p?.payday;
    if (!v) return { replyText: "📅 Você ainda não me disse em qual dia costuma receber. Qual é?" };
    return { replyText: `📅 Você recebe: *${v}*.` };
  }
  if (field === "profession") {
    const v = p?.profession;
    if (!v) return { replyText: "💼 Você ainda não me disse sua profissão/atividade. Qual é?" };
    return { replyText: `💼 Sua atividade cadastrada é: *${v}*.` };
  }
  const v = p?.financial_goal;
  if (!v) return { replyText: "🎯 Você ainda não cadastrou um objetivo financeiro. Qual é o seu?" };
  return { replyText: `🎯 Seu objetivo financeiro cadastrado é: *${v}*.` };
}

export async function updateProfileField(
  userId: string,
  field: ProfileField,
  value: string | number,
): Promise<{ ok: boolean; replyText: string }> {
  if (field === "income") {
    const v = Number(value);
    if (!Number.isFinite(v) || v <= 0) return { ok: false, replyText: "Não captei o valor da renda. Pode mandar de novo? (ex.: *R$ 4.500* ou *20 mil*)" };
    if (v > 1_000_000) {
      return { ok: false, replyText: `Entendi *${BRL(v)}* — só confirmando porque é um valor bem alto: está certo mesmo? Se sim, me manda de novo.` };
    }
    const { error } = await supabaseAdmin.from("profiles").update({ monthly_income: v }).eq("id", userId);
    if (error) return { ok: false, replyText: "Não consegui atualizar sua renda agora 🙏." };
    return { ok: true, replyText: `✅ Atualizei! Sua renda mensal agora é *${BRL(v)}*.` };
  }
  const text = String(value).trim().slice(0, 120);
  if (!text) return { ok: false, replyText: `Não captei essa informação de ${FIELD_LABEL[field]}. Pode repetir?` };
  const column = field === "payday" ? "payday" : field === "profession" ? "profession" : "financial_goal";
  const { error } = await supabaseAdmin.from("profiles").update({ [column]: text }).eq("id", userId);
  if (error) return { ok: false, replyText: "Não consegui atualizar agora 🙏." };
  const label = field === "payday" ? `📅 Agora você recebe: *${text}*.`
    : field === "profession" ? `💼 Atividade atualizada para: *${text}*.`
    : `🎯 Objetivo atualizado para: *${text}*.`;
  return { ok: true, replyText: `✅ Atualizei!\n\n${label}` };
}
