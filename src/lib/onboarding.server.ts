// Onboarding conversacional via WhatsApp.
// Máquina de estados simples: cada etapa tem uma pergunta e um parser.
// Persistência em public.onboarding_progress (answers JSONB).

import { supabaseAdmin } from "@/integrations/supabase/client.server";

type Step =
  | "invite"
  | "name"
  | "profession"
  | "income"
  | "payday"
  | "goal"
  | "has_bills"
  | "bills"
  | "has_installments"
  | "installments"
  | "has_debts"
  | "debts"
  | "goal_amount"
  | "reminders"
  | "notify_time"
  | "summary";

const NEXT: Record<Step, Step | null> = {
  invite: "name",
  name: "profession",
  profession: "income",
  income: "payday",
  payday: "goal",
  goal: "has_bills",
  has_bills: "has_installments",
  bills: "has_installments",
  has_installments: "has_debts",
  installments: "has_debts",
  has_debts: "goal_amount",
  debts: "goal_amount",
  goal_amount: "reminders",
  reminders: "notify_time",
  notify_time: "summary",
  summary: null,
};

const YES = /^(s|sim|claro|isso|com certeza|quero|vamos|bora|👍|✅|configurar|1️⃣|^1$)/i;
const NO = /^(n|nao|não|depois|agora não|2️⃣|^2$|pular|skip|nem)/i;

function parseMoney(input: string): number | null {
  if (!input) return null;
  const t = input.toLowerCase().replace(/\s+/g, " ").trim();
  // Tentativa direta com R$ ou números
  const m = t.match(/(?:r\$?\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)/);
  if (m) {
    let s = m[1];
    if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
    const n = parseFloat(s);
    if (!isNaN(n) && n > 0) return n;
  }
  return null;
}

function questionFor(step: Step, answers: any, name?: string): string {
  switch (step) {
    case "name":
      return "🙋 Como você gostaria de ser chamado?";
    case "profession":
      return `Prazer, ${answers.name ?? name ?? "amigo(a)"}! 😊

💼 Qual é sua principal atividade?

Exemplos rápidos:
• CLT
• Empresário
• MEI
• Autônomo
• Uber / 99
• Freelancer
• Aposentado
• Outro

(Pode digitar a sua mesmo se não estiver na lista.)`;
    case "income":
      return "💰 Quanto você costuma receber por mês?\n\nPode responder como preferir:\n• R$ 4.500\n• 4500\n• 4.500";
    case "payday":
      return "📅 Em qual dia normalmente você recebe?\n\nExemplos:\n• Dia 5\n• Todo dia 30\n• Toda sexta-feira\n• Recebo por semana\n• Recebo diariamente";
    case "goal":
      return "🎯 Qual é seu principal objetivo financeiro hoje?\n\nExemplos:\n• Guardar dinheiro\n• Quitar dívidas\n• Comprar um carro\n• Comprar uma casa\n• Viajar\n• Controlar gastos\n• Organizar minhas finanças\n• Outro";
    case "has_bills":
      return "🏠 Você possui contas fixas mensais?\n\n1️⃣ Sim\n2️⃣ Não";
    case "bills":
      return `Perfeito. 📝

Agora envie todas elas de uma vez. Exemplo:

Aluguel R$ 800
Luz R$ 250
Água R$ 90
Internet R$ 120
Academia R$ 99

Pode mandar tudo em uma única mensagem — eu separo cada item.`;
    case "has_installments":
      return "🧾 Você possui compras parceladas?\n\n1️⃣ Sim\n2️⃣ Não";
    case "installments":
      return `Beleza! Pode enviar todas juntas. Exemplo:

iPhone — 12x de R$ 320, parcela 3
Notebook — 10x de R$ 180, parcela 7`;
    case "has_debts":
      return "⚠️ Você possui alguma dívida atualmente?\n\n1️⃣ Sim (descreva: ex. \"Cartão Nubank R$ 1.200\")\n2️⃣ Não";
    case "debts":
      return "Pode descrever suas dívidas (uma por linha):\n\nEx: Cartão Nubank R$ 1.200\nBoleto loja X R$ 350";
    case "goal_amount":
      return "🚀 Gostaria de criar uma meta financeira agora?\n\nExemplos:\n• Guardar R$ 500 por mês\n• Quitar cartão\n• Comprar moto\n• Viajar para a praia\n\nOu responda *pular* para configurarmos depois.";
    case "reminders":
      return "🔔 Posso enviar lembretes automáticos pelo WhatsApp?\n\n✔ Contas próximas do vencimento\n✔ Resumo semanal\n✔ Resumo mensal\n✔ Alertas inteligentes\n\n1️⃣ Sim\n2️⃣ Não";
    case "notify_time":
      return "⏰ Qual o melhor horário para receber notificações?\n\n• Manhã\n• Tarde\n• Noite\n\nOu me passe um horário específico (ex.: 09:00).";
    default:
      return "";
  }
}

// Parser leve para listas de contas/parcelados
function parseLinesMoney(input: string): Array<{ title: string; amount: number | null; raw: string }> {
  const lines = input.split(/\r?\n|;|·|•/).map((l) => l.trim()).filter(Boolean);
  return lines.map((raw) => {
    const m = raw.match(/(.+?)[\s\-–:]+(?:r\$?\s*)?(\d+(?:[.,]\d{1,2})?(?:\.\d{3})*)/i);
    if (m) {
      let s = m[2];
      if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
      const amount = parseFloat(s);
      return { title: m[1].trim(), amount: isNaN(amount) ? null : amount, raw };
    }
    const amount = parseMoney(raw);
    return { title: raw.replace(/r\$?\s*\d.*/i, "").trim() || raw, amount, raw };
  });
}

async function persistFinancialAnswers(userId: string, answers: any) {
  // Cria recurring_bills
  if (Array.isArray(answers.bills)) {
    for (const b of answers.bills) {
      if (!b?.title || !b?.amount) continue;
      try {
        // próxima data de vencimento = hoje + 30d (placeholder; usuário ajusta no app)
        const next = new Date(Date.now() + 30 * 86400000).toISOString();
        await supabaseAdmin.from("recurring_bills").insert({
          user_id: userId,
          title: b.title,
          amount: b.amount,
          frequency: "monthly",
          next_due_at: next,
        } as any);
      } catch { /* ignora */ }
    }
  }
  // installment_purchases
  if (Array.isArray(answers.installments)) {
    for (const it of answers.installments) {
      if (!it?.title) continue;
      try {
        await supabaseAdmin.from("installment_purchases").insert({
          user_id: userId,
          title: it.title,
          installment_amount: it.amount ?? null,
          installments_total: it.total ?? null,
          installments_paid: it.paid ?? null,
        } as any);
      } catch { /* ignora */ }
    }
  }
  // debts
  if (Array.isArray(answers.debts)) {
    for (const d of answers.debts) {
      if (!d?.title) continue;
      try {
        await supabaseAdmin.from("debts").insert({
          user_id: userId,
          title: d.title,
          amount: d.amount ?? null,
        } as any);
      } catch { /* ignora */ }
    }
  }
  // meta financeira
  if (answers.goal_specific) {
    try {
      await supabaseAdmin.from("financial_goals").insert({
        user_id: userId,
        title: answers.goal_specific.title,
        target_amount: answers.goal_specific.amount ?? null,
      } as any);
    } catch { /* ignora */ }
  }
  // Atualiza perfil com nome (se mudou) e preferências
  const update: any = {};
  if (answers.name) update.name = answers.name;
  if (Object.keys(update).length) {
    try { await supabaseAdmin.from("profiles").update(update).eq("id", userId); } catch { /* */ }
  }
}

function summary(answers: any): string {
  const income = Number(answers.income ?? 0);
  const billsTotal = Array.isArray(answers.bills)
    ? answers.bills.reduce((s: number, b: any) => s + (Number(b.amount) || 0), 0)
    : 0;
  const pct = income > 0 ? Math.round((billsTotal / income) * 100) : 0;
  const fmt = (n: number) => `R$ ${n.toFixed(2).replace(".", ",")}`;
  return `📊 *Configuração concluída!*

Aqui está um resumo do seu perfil:

💰 Renda mensal: *${fmt(income)}*
🏠 Contas fixas: *${fmt(billsTotal)}*
📈 Comprometimento da renda: *${pct}%*
🎯 Objetivo: *${answers.goal ?? "—"}*

A partir de agora vou acompanhar sua vida financeira diariamente.

Sempre que você enviar mensagens, áudios ou imagens, organizarei tudo automaticamente. Também enviarei lembretes antes dos vencimentos, resumos semanais e análises inteligentes para ajudá-lo a economizar mais.

Obrigado por confiar no Abio! 🚀`;
}

export async function getOnboarding(userId: string) {
  const { data } = await supabaseAdmin
    .from("onboarding_progress")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  return data as any;
}

export async function ensureOnboardingRow(userId: string) {
  const existing = await getOnboarding(userId);
  if (existing) return existing;
  const { data } = await supabaseAdmin
    .from("onboarding_progress")
    .insert({ user_id: userId, status: "invited", current_step: "invite" })
    .select("*")
    .single();
  return data as any;
}

export function inviteMessage(): string {
  return `🎉 *Seja muito bem-vindo ao Abio!*

Agora você tem um assistente financeiro inteligente disponível diretamente no seu WhatsApp.

Antes de começarmos, posso fazer algumas perguntas rápidas para deixar sua experiência muito mais personalizada?

Leva menos de 3 minutos e vai me ajudar a entender sua realidade financeira para oferecer lembretes, análises e relatórios muito mais úteis.

Digite:
1️⃣ *SIM* — quero configurar agora.
2️⃣ *NÃO* — quero começar a usar e configurar depois.`;
}

// Quem chama este handler decide se quer começar a sessão.
// Retorna { handled, reply } — quando handled=false, a mensagem segue o fluxo normal.
export async function handleOnboardingMessage(
  userId: string,
  profileName: string | null,
  text: string,
): Promise<{ handled: boolean; reply?: string }> {
  const ob = await getOnboarding(userId);
  // Comando explícito de reabrir
  if (/^configurar( minha)? conta$/i.test(text.trim())) {
    if (!ob) {
      await supabaseAdmin.from("onboarding_progress").insert({
        user_id: userId, status: "in_progress", current_step: "name",
        started_at: new Date().toISOString(),
      });
    } else {
      await supabaseAdmin.from("onboarding_progress")
        .update({ status: "in_progress", current_step: "name", started_at: new Date().toISOString() })
        .eq("user_id", userId);
    }
    return { handled: true, reply: questionFor("name", {}, profileName ?? undefined) };
  }

  if (!ob) return { handled: false };
  if (ob.status === "completed" || ob.status === "declined") return { handled: false };

  const step: Step = ob.current_step as Step;
  const answers = (ob.answers ?? {}) as any;
  const norm = text.trim();

  // Etapa 1: convite
  if (step === "invite") {
    if (YES.test(norm)) {
      const next: Step = "name";
      await supabaseAdmin.from("onboarding_progress").update({
        status: "in_progress", current_step: next, started_at: new Date().toISOString(),
        last_prompt_at: new Date().toISOString(),
      }).eq("user_id", userId);
      return { handled: true, reply: questionFor(next, answers, profileName ?? undefined) };
    }
    if (NO.test(norm)) {
      await supabaseAdmin.from("onboarding_progress").update({
        status: "declined", last_prompt_at: new Date().toISOString(),
      }).eq("user_id", userId);
      return {
        handled: true,
        reply: `Perfeito! 😊

Você já pode utilizar o Abio normalmente. Sempre que quiser concluir sua configuração basta enviar:

*Configurar minha conta*

Enquanto isso já posso registrar:
💰 Receitas
💸 Despesas
📅 Lembretes
🏠 Contas Fixas
🧾 Parcelamentos
📷 Imagens
🎤 Áudios

🚀 Vamos começar!`,
      };
    }
    return { handled: true, reply: inviteMessage() };
  }

  // Capturar resposta da etapa atual em `answers`
  let advance = true;
  let reply: string | undefined;

  switch (step) {
    case "name":
      answers.name = norm.slice(0, 80);
      break;
    case "profession":
      answers.profession = norm.slice(0, 80);
      break;
    case "income": {
      const v = parseMoney(norm);
      if (!v) { advance = false; reply = "Hmm, não captei o valor. Pode mandar como *R$ 4.500* ou *4500*?"; break; }
      answers.income = v;
      break;
    }
    case "payday":
      answers.payday = norm.slice(0, 80);
      break;
    case "goal":
      answers.goal = norm.slice(0, 120);
      break;
    case "has_bills":
      if (YES.test(norm)) { answers.has_bills = true; }
      else if (NO.test(norm)) { answers.has_bills = false; answers.bills = []; }
      else { advance = false; reply = "Responda *1* para Sim ou *2* para Não."; break; }
      // Se sim, próximo é "bills"; se não, pulamos
      if (answers.has_bills) {
        await supabaseAdmin.from("onboarding_progress").update({
          current_step: "bills", answers, last_prompt_at: new Date().toISOString(),
        }).eq("user_id", userId);
        return { handled: true, reply: questionFor("bills", answers) };
      }
      break;
    case "bills":
      answers.bills = parseLinesMoney(norm).filter((b) => b.amount);
      if (!answers.bills.length) { advance = false; reply = "Não consegui identificar valores. Tente: *Aluguel R$ 800*"; break; }
      break;
    case "has_installments":
      if (YES.test(norm)) { answers.has_installments = true; }
      else if (NO.test(norm)) { answers.has_installments = false; answers.installments = []; }
      else { advance = false; reply = "Responda *1* para Sim ou *2* para Não."; break; }
      if (answers.has_installments) {
        await supabaseAdmin.from("onboarding_progress").update({
          current_step: "installments", answers, last_prompt_at: new Date().toISOString(),
        }).eq("user_id", userId);
        return { handled: true, reply: questionFor("installments", answers) };
      }
      break;
    case "installments": {
      const items = norm.split(/\r?\n\r?\n|\r?\n/).map((l) => l.trim()).filter(Boolean).map((line) => {
        const tot = line.match(/(\d+)\s*x/i);
        const paid = line.match(/parcela\s*(\d+)/i);
        const amount = parseMoney(line);
        const title = line.replace(/\d+\s*x.*$/i, "").replace(/parcela\s*\d+/i, "").replace(/r\$?\s*\d[\d.,]*/i, "").trim();
        return { title: title || line, amount, total: tot ? parseInt(tot[1], 10) : null, paid: paid ? parseInt(paid[1], 10) : null };
      });
      answers.installments = items;
      break;
    }
    case "has_debts":
      if (YES.test(norm) && norm.length > 3) {
        // já veio descrição na mesma msg
        answers.has_debts = true;
        answers.debts = parseLinesMoney(norm.replace(/^(s|sim)[\s,.:-]*/i, ""));
        break;
      }
      if (YES.test(norm)) {
        answers.has_debts = true;
        await supabaseAdmin.from("onboarding_progress").update({
          current_step: "debts", answers, last_prompt_at: new Date().toISOString(),
        }).eq("user_id", userId);
        return { handled: true, reply: questionFor("debts", answers) };
      }
      if (NO.test(norm)) { answers.has_debts = false; answers.debts = []; break; }
      advance = false; reply = "Responda *1* para Sim ou *2* para Não.";
      break;
    case "debts":
      answers.debts = parseLinesMoney(norm);
      break;
    case "goal_amount":
      if (/^pular|skip$/i.test(norm)) { answers.goal_specific = null; }
      else {
        answers.goal_specific = { title: norm.slice(0, 120), amount: parseMoney(norm) };
      }
      break;
    case "reminders":
      if (YES.test(norm)) answers.reminders = true;
      else if (NO.test(norm)) answers.reminders = false;
      else { advance = false; reply = "Responda *1* para Sim ou *2* para Não."; break; }
      break;
    case "notify_time":
      answers.notify_time = norm.slice(0, 30);
      break;
  }

  if (!advance) {
    return { handled: true, reply };
  }

  const next = NEXT[step];
  if (next === "summary" || !next) {
    // Finaliza
    await persistFinancialAnswers(userId, answers);
    await supabaseAdmin.from("onboarding_progress").update({
      status: "completed",
      current_step: "summary",
      answers,
      completed_at: new Date().toISOString(),
      last_prompt_at: new Date().toISOString(),
    }).eq("user_id", userId);
    return { handled: true, reply: summary(answers) };
  }

  await supabaseAdmin.from("onboarding_progress").update({
    current_step: next,
    answers,
    last_prompt_at: new Date().toISOString(),
  }).eq("user_id", userId);

  return { handled: true, reply: questionFor(next, answers, profileName ?? undefined) };
}
