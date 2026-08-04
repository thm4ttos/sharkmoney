// SERVER-ONLY — Score de confiança para criação automática de lembretes.
//
// Regra de produto (Shark Money V2 — "resolva, não pergunte"):
//   >= 0.50 → cria automaticamente (só confirma DEPOIS, sem perguntar antes)
//   <  0.50 → pergunta / oferece opções (ambiguidade real)
//
// O score é determinístico e auditável: soma sinais fortes do texto
// (verbo de agenda, data explícita, horário explícito) e penaliza
// sinais de ambiguidade (dia da semana solto, ausência de horário).

const STRONG_VERBS =
  /\b(tenho|vou ter|vou|preciso|lembrar|lembra|lembre|n[ãa]o esquecer|nao esquecer|n[ãa]o esquece|anota|anota a[íi]|anote|marca|marque|marcar|marca isso|agenda|agende|agendar|agenda pra mim|coloca na agenda|manda pra agenda|mete na agenda|reserva|reservar|guarda isso|salva isso|deixa salvo|registra|registrar|registra isso|joga no sistema|pode lan[çc]ar|criar lembrete|cria lembrete|registrar compromisso|buscar|pegar|levar|trocar|renovar)\b/i;

const EVENT_NOUNS =
  /\b(churrasco|consulta|reuni[ãa]o|m[ée]dico|dentista|exame|anivers[áa]rio|jogo|academia|viagem|entrevista|cinema|encomenda|prova|aula|culto|festa|almo[çc]o|jantar|apresenta[çc][ãa]o|check[- ]?up|vacina|carro|[óo]leo|documento)\b/i;

const EXPLICIT_DAY =
  /(^|\s)(hoje|amanh[ãa]|depois de amanh[ãa]|hj|agora|[àa]s\s*noite|de manh[ãa]|[àa] tarde|\d{1,2}\/\d{1,2}(\/\d{2,4})?|dia\s+\d{1,2}|dia\s+(um|dois|tr[êe]s|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|quatorze|catorze|quinze|dezesseis|dezessete|dezoito|dezenove|vinte|trinta))(?=\s|$)/i;

const WEEKDAY =
  /\b(segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|domingo)\b/i;

const EXPLICIT_TIME =
  /(\b\d{1,2}\s*[:h]\s*\d{0,2}\b|(^|\s)[àa]s?\s*\d{1,2}(?=\s|$)|\b(meio[- ]dia|meia[- ]noite)\b|(^|\s)[àa]s?\s+(uma|duas|tr[êe]s|quatro|cinco|seis|sete|oito|nove|dez|onze|doze)(?=\s|$))/i;

const AMBIGUOUS_HINTS =
  /\b(talvez|acho que|ser[áa] que|pode ser|qualquer dia|algum dia|semana que vem|pr[óo]ximo m[êe]s)\b/i;

export type ApptConfidence = {
  score: number;
  reasons: string[];
  autoCreate: boolean;
};

export function scoreAppointmentIntent(input: {
  text: string;
  hasScheduledAt: boolean;
  aiConfidence?: number | null;
  hasHistory?: boolean;
}): ApptConfidence {
  const text = (input.text ?? "").trim();
  const reasons: string[] = [];
  let score = 0.35;

  if (STRONG_VERBS.test(text)) { score += 0.28; reasons.push("verbo_forte"); }
  if (EVENT_NOUNS.test(text)) { score += 0.10; reasons.push("substantivo_evento"); }

  const hasDay = EXPLICIT_DAY.test(text);
  const hasWeekday = WEEKDAY.test(text);
  const hasTime = EXPLICIT_TIME.test(text);

  if (hasDay) { score += 0.20; reasons.push("data_explicita"); }
  else if (hasWeekday) { score += 0.06; reasons.push("dia_semana_solto"); }

  if (hasTime) { score += 0.15; reasons.push("hora_explicita"); }

  // Sem dia da semana explícito e sem horário → ambiguidade real.
  if (!hasDay && !hasTime) { score -= 0.22; reasons.push("sem_data_e_sem_hora"); }
  // "sábado" sozinho (qual sábado?) sem horário → pergunta.
  if (!hasDay && hasWeekday && !hasTime) { score -= 0.12; reasons.push("qual_dia_semana"); }

  if (AMBIGUOUS_HINTS.test(text)) { score -= 0.20; reasons.push("linguagem_incerta"); }
  if (!input.hasScheduledAt) { score -= 0.35; reasons.push("sem_scheduled_at"); }
  if (input.hasHistory) { score += 0.03; reasons.push("historico_usuario"); }

  if (typeof input.aiConfidence === "number" && Number.isFinite(input.aiConfidence)) {
    // média ponderada com a confiança do classificador
    score = score * 0.7 + input.aiConfidence * 0.3;
    reasons.push(`ia_${input.aiConfidence.toFixed(2)}`);
  }

  score = Math.max(0, Math.min(1, Math.round(score * 100) / 100));
  return { score, reasons, autoCreate: input.hasScheduledAt && score >= 0.5 };
}
