// Banco de respostas humanas variadas do Shark Money.
// Cada "kind" tem N variantes; pickReply sorteia sem repetir a última usada
// pelo mesmo contato (persistido em wa_contacts.last_reply_variant).

import { supabaseAdmin } from "@/integrations/supabase/client.server";

// ---- Bancos por evento ----
export const REPLY_BANK = {
  // Confirmações de gasto (20 variantes curtas) — cabeçalho da mensagem final.
  expense_header: [
    "😄 Shoow, anotado!",
    "✅ Certinho, registrei!",
    "👌 Fechou, já entrou!",
    "🚀 Boa, já organizei!",
    "✨ Prontinho, ficou salvo!",
    "👍 Tudo certo por aqui!",
    "💙 Anotado direitinho!",
    "🎯 Feito, já está no controle!",
    "📝 Boa, deixei registrado!",
    "⚡ Rapidinho, já foi!",
    "😎 Fechado, está salvo!",
    "🤝 Pode deixar, anotei!",
    "📌 Certo, já organizei!",
    "🎉 Boa, registro concluído!",
    "💡 Perfeito, ficou anotado!",
    "🙌 Tudo certo, já salvei!",
    "✔️ Pronto, registro feito!",
    "🔥 Aí sim, já entrou!",
    "😊 Beleza, deixei certinho!",
    "🧠 Entendido, já organizei!",
  ],
  // Confirmações de receita (20 variantes curtas).
  income_header: [
    "🚀 Boa, já entrou!",
    "😄 Shoow, anotado!",
    "✅ Certinho, registrei!",
    "👌 Fechou, entrada salva!",
    "✨ Prontinho, ficou salvo!",
    "👍 Tudo certo por aqui!",
    "💙 Anotado direitinho!",
    "🎯 Feito, já está no controle!",
    "📝 Boa, deixei registrado!",
    "⚡ Rapidinho, já foi!",
    "😎 Fechado, está salvo!",
    "🤝 Pode deixar, anotei!",
    "📌 Certo, já organizei!",
    "🎉 Boa, registro concluído!",
    "💡 Perfeito, ficou anotado!",
    "🙌 Tudo certo, já salvei!",
    "✔️ Pronto, registro feito!",
    "🔥 Aí sim, já entrou!",
    "😊 Beleza, deixei certinho!",
    "🧠 Entendido, já organizei!",
  ],

  // Ack imediato ao receber a mensagem de gasto (antes de processar).
  expense_ack: [
    "🧾 Entendi! Já vou registrar isso.",
    "💸 Anotado! Só um instante...",
    "👌 Beleza! Registrando esse gasto.",
    "🚀 Perfeito! Já estou organizando.",
    "🧠 Peguei a informação!",
    "📒 Pode deixar comigo.",
    "💰 Recebido! Atualizando suas finanças.",
    "⚡ Boa! Estou lançando.",
    "👍 Fechado! Registrando.",
    "📌 Informação recebida.",
    "🤝 Pode deixar.",
    "✨ Organizando tudo aqui.",
    "😎 Já estou cuidando disso.",
    "🔥 Recebi! Só um instante.",
    "📊 Já estou organizando.",
    "💵 Entendido! Já entrou na fila.",
    "🧠 Já entendi, deixa comigo.",
    "🎯 Certinho! Um segundo.",
    "🌟 Show! Já vou registrar.",
    "🍕 Peguei aqui, organizando.",
  ],
  // Ack imediato para receitas.
  income_ack: [
    "💰 Boa! Dinheiro entrando, registrando...",
    "🎉 Receita recebida, já anoto!",
    "📈 Excelente! Registrando essa entrada.",
    "💵 Ótima notícia! Um instante...",
    "🚀 Atualizando seus ganhos.",
    "👏 Mais uma receita a caminho do controle.",
    "💚 Dinheiro entrando! Registrando.",
    "✨ Receita identificada, salvando.",
    "📊 Registrando esse valor.",
    "🧾 Já organizando essa entrada.",
    "🤝 Pode deixar, receita anotada.",
    "😎 Show! Vou lançar.",
    "🔥 Boa! Já tô registrando.",
    "⚡ Rapidinho, receita entrando.",
    "🌟 Perfeito! Salvando aqui.",
    "🎯 Entrada confirmada, um segundo.",
    "💙 Pode contar comigo, anotando.",
    "🎊 Uhul! Vou registrar.",
    "👍 Fechado, receita a caminho.",
    "📒 Anotado! Já organizo.",
  ],
  // Confirmação ao receber imagem / comprovante.
  image_ack: [
    "📷 Recebi seu comprovante, deixa comigo.",
    "👀 Boa! Já dei uma olhada aqui.",
    "📄 Peguei o comprovante, só um instante.",
    "✨ Recebido! Já cuido disso.",
    "🧾 Chegou aqui, vou organizar.",
    "💙 Pode deixar comigo.",
    "👌 Show! Já estou vendo.",
    "📸 Recebi a imagem, um instante.",
    "🚀 Boa! Já começo a organizar.",
    "🤝 Chegou certinho, deixa comigo.",
  ],

  // Prefixo para pedir esclarecimento quando a confiança está baixa.
  doubt_prefix: [
    "🤔 Só confirme uma coisa...",
    "💬 Acho que entendi, mas quero confirmar.",
    "👀 Você quis dizer...",
    "❓ Só para garantir...",
    "🤝 Me confirma isso rapidinho...",
    "📌 Estou entre duas interpretações.",
    "🎯 Pode confirmar pra mim?",
    "💭 Você quis alterar ou criar?",
    "📄 Era um gasto ou receita?",
    "💸 Esse valor foi pago ou recebido?",
    "🧠 Só pra ter certeza...",
    "🔍 Quero garantir que entendi.",
    "✋ Antes de registrar, me confirma:",
    "🙋 Deixa eu confirmar contigo:",
    "🧐 Fiquei em dúvida em um detalhe.",
    "📝 Só me esclarece uma coisa:",
    "💙 Antes de salvar, confirma pra mim:",
    "⚠️ Pra não errar, me diz:",
    "🤨 Uma dúvida rápida:",
    "🧩 Ajuda a completar essa parte:",
  ],
  // === Fluxo EXCLUSIVO de compromissos (nunca usar banco financeiro aqui) ===
  // Reconhecimento imediato — enviado antes de salvar/confirmar.
  appointment_ack: [
    "📅 Entendi!",
    "🗓️ Beleza!",
    "✅ Certo!",
    "👀 Anotando...",
    "✨ Show!",
    "🤝 Combinado!",
    "📌 Peguei aqui!",
    "💙 Pode deixar!",
    "🎯 Entendido!",
    "⏰ Tô nessa!",
  ],
  appointment_header: [
    "📅 *Compromisso agendado!*",
    "🗓️ *Anotei aqui pra você.*",
    "✅ *Pronto! Seu compromisso foi salvo com sucesso.*",
    "✨ *Feito! Deixei no seu calendário.*",
    "🎯 *Prontinho! Já tá agendado.*",
    "💙 *Pode confiar, não vou deixar você esquecer.*",
    "🤝 *Fechou! Compromisso salvo.*",
    "📌 *Tudo certo! Compromisso na agenda.*",
    "🚀 *Confirmado! Já registrei.*",
    "🔔 *Salvo! Vou te avisar antes.*",
  ],
  // Cancelamento natural de compromisso.
  appointment_cancelled: [
    "❌ Tudo bem. Não vou salvar.",
    "👍 Sem problema, deixei de lado.",
    "🚫 Ok, cancelei esse compromisso.",
    "💙 Tranquilo! Não vou agendar nada.",
    "🗑️ Pronto, removi da agenda.",
    "✋ Beleza, esquece esse então.",
    "🙅 Certo, não vou registrar.",
    "😉 Sem stress, cancelado.",
    "📭 Ok! Nada foi agendado.",
    "🤝 Combinado, cancelei aqui.",
  ],
  // Início do modo reagendamento.
  appointment_reschedule_start: [
    "📅 Claro! Qual nova data ou horário deseja?",
    "🔄 Sem problema — me diga o novo dia e horário.",
    "🗓️ Beleza! Pra quando devo remarcar?",
    "⏰ Certo! Qual o novo horário?",
    "✨ Pode deixar! Me passa a nova data.",
    "💙 Tranquilo, é só me dizer quando fica melhor.",
    "📌 Ok! Qual dia e hora eu coloco?",
    "🤔 Show — pra qual data e horário mudo?",
    "🚀 Vamos remarcar! Me diga o novo momento.",
    "👀 Certo! Informe a nova data/hora, por favor.",
  ],
  // Reagendamento concluído.
  appointment_rescheduled: [
    "🔄 Pronto! Reagendei pra você.",
    "✅ Atualizei o horário do compromisso.",
    "📅 Feito! Nova data salva.",
    "✨ Remarcado com sucesso.",
    "🎯 Prontinho, horário alterado.",
    "💙 Tudo certo! Já mudei aqui.",
    "🗓️ Agenda atualizada!",
    "🤝 Combinado, remarquei.",
    "⏰ Novo horário confirmado.",
    "📌 Alteração feita na agenda.",
  ],
  // Falta informação — pergunta específica (dúvida real).
  appointment_missing_title: [
    "✨ Perfeito! Qual é o compromisso?",
    "👀 Boa! E o que é esse compromisso?",
    "📝 Anotei o dia e a hora. O que vai ser?",
    "🤔 Certo! Do que se trata o compromisso?",
    "🎯 Show! Me diz o que é para eu salvar.",
    "💙 Já peguei a data. Qual é o compromisso?",
    "📌 Beleza! E o nome do compromisso?",
    "🗓️ Ok! O que devo colocar na agenda?",
  ],
  appointment_missing_time: [
    "🤔 Qual horário será?",
    "⏰ Que horas é esse compromisso?",
    "🕒 Me diz o horário, por favor.",
    "👀 Só falta a hora — qual é?",
    "📌 Em que horário devo agendar?",
    "💙 Qual a hora certinha?",
    "🗓️ Falta o horário. Pode informar?",
    "✨ E que horas vai ser?",
    "🎯 Só me diga o horário e eu salvo.",
    "🤝 Qual hora eu coloco na agenda?",
  ],
  appointment_missing_date: [
    "📅 Qual dia será?",
    "🗓️ Pra que data devo agendar?",
    "🤔 Em que dia é esse compromisso?",
    "👀 Só falta a data — qual é?",
    "📌 Me diz o dia, por favor.",
    "💙 Qual data eu coloco?",
    "✨ E quando vai ser?",
    "🎯 Só me passa o dia e eu salvo.",
    "⏰ Falta a data. Pode informar?",
    "🤝 Qual dia eu marco na agenda?",
  ],

  // === Ações executadas em compromissos JÁ existentes (uma resposta só) ===
  // Mantido/confirmado.
  appointment_kept: [
    "Combinado, continua na sua agenda. 📅",
    "Tudo certo, mantive o compromisso.",
    "Fechado! Continua marcado. 👍",
    "Perfeito, está confirmado.",
    "Pode deixar, não alterei nada.",
    "Certinho, sua agenda continua igual.",
    "Boa! O compromisso segue confirmado.",
    "Está valendo. Depois eu te lembro. 🔔",
    "Tranquilo, mantive como está.",
    "Certo, continua marcado para você.",
  ],
  // Cancelado de verdade (compromisso existente).
  appointment_cancel_done: [
    "Tudo bem, cancelei o compromisso.",
    "Certinho, removi da sua agenda.",
    "Sem problema, já está cancelado.",
    "Pronto, esse compromisso não aparece mais.",
    "Fechado, retirei esse evento da agenda.",
    "Pode deixar, já cancelei por aqui.",
    "Tudo resolvido, compromisso removido.",
    "Beleza, desmarquei para você.",
    "Certo, não vou mais enviar lembretes sobre ele.",
    "Tranquilo, esse compromisso foi encerrado.",
  ],
  // Concluído.
  appointment_completed: [
    "Boa! Marquei como concluído. ✅",
    "Perfeito, compromisso finalizado.",
    "Missão cumprida! Já dei como concluído.",
    "Certinho, não vou enviar mais lembretes.",
    "Tudo resolvido por aí. 👍",
    "Pronto, esse compromisso foi concluído.",
    "Ótimo! Já atualizei sua agenda.",
    "Fechado, tarefa concluída.",
    "Boa demais, está finalizado.",
    "Certo, encerrei esse compromisso.",
  ],
  // Reagendado (com nova data já aplicada).
  appointment_reschedule_done: [
    "Fechado! Atualizei o compromisso. 📅",
    "Certinho, o novo horário já está salvo.",
    "Pronto, já alterei a data.",
    "Boa, reagendei para você.",
    "Tudo atualizado na sua agenda.",
    "Combinado, deixei para o novo horário.",
    "Alteração feita! Depois eu te lembro.",
    "Perfeito, o novo horário está confirmado.",
    "Está remarcado. 🕒",
    "Agenda atualizada com sucesso.",
  ],
  // Pergunta única quando falta a nova data/hora do reagendamento.
  appointment_reschedule_ask: [
    "Claro. Para qual dia e horário você quer mudar?",
    "Beleza! Me diz o novo dia e horário.",
    "Pode deixar — pra quando eu remarco?",
    "Certo! Qual a nova data e hora?",
    "Show, é só me dizer quando fica melhor.",
  ],


  appointment_footer: [
    "Vou te lembrar quando estiver perto ⏰",
    "Pode contar comigo pra avisar 💙",
    "Fica tranquilo(a), eu aviso ⏰",
    "Deixa comigo, te lembro na hora certa ✨",
    "Vou ficar de olho no horário 👀",
  ],
  // Confirmação de edição/correção
  edit_ok: [
    "✏️ Pronto, atualizei aqui!",
    "🔄 Feito! Já corrigi.",
    "✅ Ajustado — obrigado por avisar.",
    "💙 Pode deixar, alterei pra você.",
    "🎯 Correção aplicada com sucesso.",
    "✨ Perfeito, já tá atualizado.",
  ],
  // Confirmação de exclusão
  delete_ok: [
    "🗑️ Pronto, apaguei esse lançamento.",
    "✅ Removido com sucesso.",
    "💙 Feito! Já saiu do seu histórico.",
    "🎯 Exclusão concluída.",
    "✨ Tudo certo, deletei pra você.",
  ],
  // Pagamento parcial de conta fixa
  partial_ok: [
    "💳 Registrei esse abatimento na sua conta fixa.",
    "✅ Pagamento parcial anotado.",
    "💙 Perfeito, atualizei o saldo dessa conta.",
    "📊 Prontinho, seu progresso foi atualizado.",
  ],
  // Erros amigáveis
  error_amount: [
    "Hmm, não captei o valor 🤔\nPode mandar de novo? Exemplo: _gastei 50 no mercado_",
    "Não consegui identificar o valor 😅 Me manda o número junto: _gastei 50 no mercado_",
    "Faltou o valor 💰 Tenta assim: _gastei 50 no mercado_",
  ],
  error_income_amount: [
    "Não captei o valor da receita 🤔\nExemplo: _recebi 2000_",
    "Preciso do valor recebido 💰 Ex.: _recebi 2000_",
    "Faltou o valor 💵 Tenta: _recebi 2000_",
  ],
  duplicate: [
    "Esse lançamento já foi registrado.",
    "Já tenho esse mesmo lançamento aqui — não vou duplicar 👍",
    "Já registrei isso há pouquinho 😊 Se for outro, me diga mais um detalhe.",
  ],
  // Lembretes de compromisso
  reminder_3d: [
    "📅 Faltam 3 dias pra seu compromisso.",
    "🗓️ Só passando pra lembrar: seu compromisso é daqui a 3 dias.",
    "✨ Se preparar com calma agora dá tempo — faltam 3 dias.",
    "💙 3 dias até seu compromisso. Tudo tranquilo?",
  ],
  reminder_1d: [
    "📅 Seu compromisso é amanhã!",
    "🗓️ Amanhã tem compromisso marcado, hein 😊",
    "✨ Um dia pra lá — se organize hoje!",
    "💙 Passando pra avisar: amanhã é o dia.",
  ],
  reminder_day: [
    "☀️ Bom dia! Hoje você tem um compromisso.",
    "📅 Lembrando: seu compromisso é HOJE.",
    "✨ Hoje é o dia! Não deixa escapar.",
    "💙 Passando pra dizer que seu compromisso é hoje.",
  ],
  reminder_3h: [
    "⏰ Faltam 3 horas pro seu compromisso.",
    "🚗 Se precisar sair mais cedo, começa a se organizar.",
    "📅 3 horinhas e seu compromisso começa.",
  ],
  reminder_2h: [
    "⏰ Faltam apenas 2 horas para seu compromisso.",
    "🚀 Seu compromisso está chegando.",
    "📅 Daqui a pouco começa seu compromisso.",
    "👀 Não esqueça, está quase na hora.",
    "✨ Organize-se, falta pouco.",
    "💙 O Shark Money está passando para lembrar você.",
    "🎯 Hora de começar a se preparar.",
  ],
  reminder_1h: [
    "⌛ Falta apenas 1 hora.",
    "📍 Está chegando a hora.",
    "🚗 Se precisar sair, esse é um bom momento.",
    "💙 Só passando para lembrar.",
    "😊 Seu compromisso está próximo.",
    "📅 Está quase na hora.",
    "🚀 Tudo pronto? Falta só uma hora.",
  ],
  reminder_30m: [
    "🚨 Atenção! Faltam apenas 30 minutos.",
    "🏃 Hora de se preparar.",
    "📅 Está quase na hora.",
    "💡 Não deixe passar.",
    "⏰ Seu compromisso começa em instantes.",
    "💙 O Shark Money está lembrando você.",
    "🎯 Agora falta bem pouco.",
  ],
  reminder_15m: [
    "⚠️ Último lembrete.",
    "🚀 Está na hora.",
    "👋 Boa sorte!",
    "💙 O Shark Money está torcendo por você.",
    "🎯 Agora é o momento.",
    "📍 Hora de ir.",
    "😊 Tenha um ótimo compromisso!",
  ],
  reminder_now: [
    "🚀 É agora! Seu compromisso começa.",
    "🎯 Chegou a hora!",
    "✨ Está na hora — boa sorte!",
  ],
  // Encerramento de lembretes
  reminders_stop: [
    "✅ Perfeito! Vou encerrar todos os lembretes deste compromisso.",
    "💙 Anotado — não te aviso mais sobre isso.",
    "🎯 Missão cumprida! Encerrei os lembretes.",
    "✨ Beleza! Silêncio total nesse compromisso.",
  ],
  // Reagendamento aceito
  reschedule_ok: [
    "🔄 Reagendado! Vou lembrar você mais tarde.",
    "⏰ Adiado — te aviso no novo horário.",
    "💙 Combinado, mudei o horário do lembrete.",
    "✨ Feito! Novo alerta programado.",
  ],
} as const;

export type ReplyKind = keyof typeof REPLY_BANK;

function fallbackPick(kind: ReplyKind): string {
  const pool = REPLY_BANK[kind] as readonly string[];
  return pool[Math.floor(Math.random() * pool.length)] ?? pool[0] ?? "";
}

/**
 * Escolhe uma variante que NÃO seja a última usada pelo contato (quando phone
 * é informado). Grava a nova escolha em wa_contacts.last_reply_variant.
 * Nunca lança — em qualquer erro cai no random puro.
 */
export async function pickReply(kind: ReplyKind, phone?: string | null): Promise<string> {
  const pool = REPLY_BANK[kind] as readonly string[];
  if (!pool || pool.length === 0) return "";
  if (pool.length === 1) return pool[0];
  if (!phone) return fallbackPick(kind);

  try {
    const { data } = await supabaseAdmin
      .from("wa_contacts")
      .select("last_reply_variant")
      .eq("phone", phone)
      .maybeSingle();
    const last = ((data?.last_reply_variant as Record<string, number> | null) ?? {})[kind];
    let idx = Math.floor(Math.random() * pool.length);
    if (typeof last === "number" && pool.length > 1) {
      let tries = 0;
      while (idx === last && tries++ < 5) idx = Math.floor(Math.random() * pool.length);
    }
    const nextVariant = { ...((data?.last_reply_variant as any) ?? {}), [kind]: idx };
    // upsert por phone; RLS não bloqueia porque usamos supabaseAdmin
    await supabaseAdmin
      .from("wa_contacts")
      .upsert({ phone, last_reply_variant: nextVariant }, { onConflict: "phone" });
    return pool[idx];
  } catch {
    return fallbackPick(kind);
  }
}

/** Versão síncrona (sem persistência) — útil onde phone não está disponível. */
export function pickReplySync(kind: ReplyKind): string {
  return fallbackPick(kind);
}

/** Primeiro nome do usuário (limpo) — usado em perguntas e confirmações. */
export function firstName(name?: string | null): string {
  const raw = (name ?? "").trim().split(/\s+/)[0] ?? "";
  const clean = raw.replace(/[^\p{L}\p{M}'-]/gu, "");
  if (clean.length < 2 || clean.length > 20) return "";
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

/**
 * Prefixa uma pergunta/confirmação com o primeiro nome do usuário.
 * Usar apenas em perguntas, confirmações e avisos importantes.
 */
export function withName(text: string, name?: string | null): string {
  const fn = firstName(name);
  if (!fn || !text) return text;
  if (new RegExp(`\\b${fn}\\b`, "i").test(text.slice(0, 60))) return text;
  const trimmed = text.replace(/^\s+/, "");
  const emoji = trimmed.match(/^(\p{Extended_Pictographic}[\uFE0F]?\s*)/u)?.[1] ?? "";
  const rest = trimmed.slice(emoji.length);
  const lowered = rest.charAt(0).toLowerCase() + rest.slice(1);
  return `${emoji}${fn}, ${lowered}`;
}

/**
 * Link do painel — enviado apenas a cada N interações relevantes
 * para não poluir a conversa. Contador persistido em wa_contacts.last_reply_variant
 * sob a chave "_link_counter" (compartilhado com pickReply).
 *
 * Retorna um trecho pronto (com quebras) para concatenar ou string vazia.
 */
export const DASHBOARD_URL = "https://sharkmoney.site";
const LINK_EVERY = 4;

const DASHBOARD_LINES = [
  `📊 Quer acompanhar tudo de forma mais visual? Acesse:\n${DASHBOARD_URL}`,
  `📈 Seus lançamentos e relatórios também estão no painel:\n${DASHBOARD_URL}`,
  `💙 Sempre que quiser ver gráficos e sua evolução, é só acessar:\n${DASHBOARD_URL}`,
  `🚀 Seu painel está sempre atualizado. Pra conferir em detalhes:\n${DASHBOARD_URL}`,
  `👌 Além do WhatsApp, você também acompanha tudo pelo painel:\n${DASHBOARD_URL}`,
];

function pickDashboardLine(lastIdx?: number): { text: string; idx: number } {
  let idx = Math.floor(Math.random() * DASHBOARD_LINES.length);
  let tries = 0;
  while (idx === lastIdx && tries++ < 5) idx = Math.floor(Math.random() * DASHBOARD_LINES.length);
  return { text: `\n\n${DASHBOARD_LINES[idx]}`, idx };
}

export async function maybeDashboardLink(phone?: string | null): Promise<string> {
  if (!phone) {
    // Sem phone não persistimos: envia ~1 em 4 aleatoriamente.
    return Math.floor(Math.random() * LINK_EVERY) === 0 ? pickDashboardLine().text : "";
  }
  try {
    const { data } = await supabaseAdmin
      .from("wa_contacts")
      .select("last_reply_variant")
      .eq("phone", phone)
      .maybeSingle();
    const state = (data?.last_reply_variant as Record<string, any> | null) ?? {};
    const prev = typeof state._link_counter === "number" ? state._link_counter : 0;
    const next = prev + 1;
    const shouldSend = next >= LINK_EVERY;
    const chosen = shouldSend ? pickDashboardLine(state._link_line) : null;
    const nextState = {
      ...state,
      _link_counter: shouldSend ? 0 : next,
      ...(chosen ? { _link_line: chosen.idx } : {}),
    };
    await supabaseAdmin
      .from("wa_contacts")
      .upsert({ phone, last_reply_variant: nextState }, { onConflict: "phone" });
    return chosen?.text ?? "";
  } catch {
    return "";
  }

}

