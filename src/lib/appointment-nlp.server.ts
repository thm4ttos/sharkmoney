// SERVER-ONLY — Interpretação natural de comandos de AGENDA (compromissos).
//
// Regra de ouro (spec 2026-07): quando a intenção estiver clara, executar
// direto e responder UMA única vez. Nada de "é isso mesmo?", "deseja
// realmente cancelar?" ou repetição de opções.
//
// Nunca usar vocabulário financeiro aqui: compromisso, lembrete, agenda,
// horário, evento, tarefa, notificação.

const strip = (s: string) =>
  (s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

export type ApptAction = "confirm" | "cancel" | "complete" | "reschedule";

export type ApptCommand = {
  action: ApptAction;
  /** true quando o texto cita explicitamente agenda/compromisso/lembrete. */
  mentionsAgenda: boolean;
  /** true quando é apenas um número de opção (1/2/3). */
  numeric: boolean;
};

const AGENDA_WORDS =
  /\b(compromisso|compromissos|lembrete|lembretes|agenda|evento|reuniao|consulta|encontro|horario|tarefa|notificacao)\b/;

// --- Cancelamento ---
const CANCEL_EXACT =
  /^(3|03|3\ufe0f\u20e3|nao|nao vou|nao vou mais|cancela|cancelar|cancelado|desmarca|desmarcar|desisti|desistir|apaga|apagar|remove|remover|exclui|excluir|deleta|deletar|esquece|esquece isso|deixa pra la|ja era|nao precisa|nao precisa mais|pode encerrar|\u274c)$/;
const CANCEL_LOOSE =
  /\b(cancel\w*|desmarc\w*|desisti\w*|nao vou mais|nao vai acontecer|nao precisa mais|pode apagar|pode cancelar|apaga (esse|este|o) (compromisso|lembrete|evento)|apagar (esse|este|o) (compromisso|lembrete|evento)|remove(r)? (esse|este|o) (compromisso|lembrete|evento)|tira da agenda|tirar da agenda|exclui(r)? (esse|este|o) (compromisso|lembrete|evento)|deixa pra la|esquece isso|ja era)\b/;

// --- Conclusão ---
const COMPLETE_EXACT =
  /^(ja fiz|ja foi|ja foi feito|ja aconteceu|ja fui|ja voltei|feito|esta feito|ta feito|concluido|concluida|finalizado|finalizada|resolvido|resolvida|terminei|missao cumprida|deu certo|fiz)$/;
const COMPLETE_LOOSE =
  /\b(ja (fiz|foi|aconteceu|fui|voltei|terminei|resolvi)|foi (feito|concluido|realizado)|esta (feito|concluido)|missao cumprida|pode dar como concluido|da como concluido|marca como (feito|concluido)|marcar como (feito|concluido)|terminei|finalizei|resolvido)\b/;

// --- Reagendamento ---
const RESCHEDULE_EXACT =
  /^(2|02|2\ufe0f\u20e3|reagenda|reagendar|remarca|remarcar|adia|adiar|muda|mudar|troca|trocar|altera|alterar|outra data|outro dia|outro horario|\ud83d\udd04)$/;
const RESCHEDULE_LOOSE =
  /\b(reagend\w*|remarc\w*|adia\w*|muda(r)? (o )?(dia|horario|data|para|pra)|troca(r)? (o )?(dia|horario|data|para|pra)|altera(r)? (o )?(dia|horario|data|para|pra)|passa (para|pra)|coloca (as|para|pra)|deixa para (mais tarde|amanha|depois)|deixa pra (mais tarde|amanha|depois)|quero outra data|quero outro horario|semana que vem)\b/;

// --- Confirmação / manutenção ---
const CONFIRM_EXACT =
  /^(1|01|1\ufe0f\u20e3|sim|s|isso|isso mesmo|e isso|eh isso|exatamente|exato|confirmo|confirmado|confirmado sim|confirmar|confirma|ok|okay|okey|blz|beleza|certo|certinho|correto|ta certo|esta certo|tudo certo|pode manter|mantem|manter|pode deixar|pode salvar|salva|salva ai|salvar|salva isso|guarda isso|deixa salvo|pode registrar|registra|registra isso|registrar|joga no sistema|pode lancar|lanca|pode fazer|pode criar|pode marcar|marca|marca isso|anota|anota ai|pode anotar|pode agendar|agenda ai|agenda pra mim|coloca na agenda|manda pra agenda|mete na agenda|bora|bora marcar|bora la|pode concluir|pode ir|pode tocar|executa|executar|vai|manda|show|show de bola|valeu|vlw|top|fechado|fechou|manda ver|manda bala|vou sim|positivo|claro|com certeza|perfeito|\ud83d\udc4d|\u2705)$/;
const CONFIRM_LOOSE =
  /\b(confirmar|confirma|confirmo|confirmado|pode confirmar|pode salvar|salva ai|salva isso|guarda isso|deixa salvo|pode registrar|registra isso|joga no sistema|pode lancar|pode agendar|pode marcar|pode anotar|anota ai|coloca na agenda|manda pra agenda|mete na agenda|agenda pra mim|pode criar|pode fazer|pode concluir|pode ir|pode tocar|manda bala|manda ver|bora marcar|isso mesmo|e isso|e isso mesmo|exatamente|esta correto|ta correto|esta certo|ta certo|continua (confirmado|valendo|de pe)|ta de pe|esta de pe|pode manter|mantem (o|esse) (compromisso|lembrete)|vou sim|tudo certo|esta confirmado|fechado)\b/;


/** Título vago/ausente: só sobrou data, hora ou verbos de agendamento. */
export function isVagueApptTitle(title: string | null | undefined): boolean {
  let t = strip(title ?? "");
  if (!t) return true;
  t = t
    .replace(/\b(segunda|terca|quarta|quinta|sexta|sabado|domingo)([- ]feira)?\b/g, " ")
    .replace(/\b(hoje|amanha|depois de amanha|hj|proxima|proximo|que vem|semana|mes|dia|as|a|de|do|da|no|na|em|pra|para|e|meu|minha|um|uma|o|de manha|de tarde|a noite|tenho|tem|marcado|marcada|marcar|agendar|agenda|agendado|compromisso|lembrete|evento|horario|hora|horas|h|min|preciso|vou|quero|me lembra|lembrar)\b/g, " ")
    .replace(/\d+[:h]?\d*/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t.length < 3;
}


/**
 * Detecta um comando de agenda em linguagem natural.
 * Retorna null quando o texto não é claramente um comando.
 */
export function detectAppointmentCommand(text: string): ApptCommand | null {
  const t = strip(text).replace(/[.!,;]+$/, "");
  if (!t) return null;
  const mentionsAgenda = AGENDA_WORDS.test(t);
  const numeric = /^(1|2|3|01|02|03)$/.test(t);

  const mk = (action: ApptAction): ApptCommand => ({ action, mentionsAgenda, numeric });

  // Ordem: cancelar > concluir > reagendar > confirmar.
  if (CANCEL_EXACT.test(t) || CANCEL_LOOSE.test(t)) return mk("cancel");
  if (COMPLETE_EXACT.test(t) || COMPLETE_LOOSE.test(t)) return mk("complete");
  if (RESCHEDULE_EXACT.test(t) || RESCHEDULE_LOOSE.test(t)) return mk("reschedule");
  if (CONFIRM_EXACT.test(t) || CONFIRM_LOOSE.test(t)) return mk("confirm");
  return null;
}

/**
 * Comandos curtos (opções numéricas, "cancela", "já fiz"...) não devem
 * receber o ack automático — a resposta final já é imediata e uma só.
 */
export function isBareAgendaCommand(text: string): boolean {
  const t = strip(text).replace(/[.!,;]+$/, "");
  if (!t || t.length > 40) return false;
  const cmd = detectAppointmentCommand(t);
  return !!cmd;
}

/**
 * "pode salvar", "confirmo", "bora", "fechado"... — respostas que apenas
 * confirmam a ação pendente e NUNCA devem virar título/descrição.
 */
export function isConfirmationPhrase(text: string): boolean {
  const t = strip(text).replace(/[.!,;]+$/, "");
  if (!t || t.length > 30) return false;
  return CONFIRM_EXACT.test(t) || CONFIRM_LOOSE.test(t);
}

