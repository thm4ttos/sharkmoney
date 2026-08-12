// SERVER-ONLY. Processador da pipeline de mensagens WhatsApp.
// Extraído do webhook para permitir reprocessamento de mensagens pendentes/erro.
//
// Recebe o id de uma linha já inserida em whatsapp_messages (direction='in')
// e executa todo o fluxo: extrair conteúdo do raw, classificar via IA,
// executar ação e enviar resposta — atualizando o status final.
//
// Garantias:
//  - Idempotência: linhas com status já terminal (processed/sent/...) são puladas.
//  - Anti-perda: status sempre é atualizado mesmo em falhas (error/send_error/...).
//  - Resposta garantida: se a IA falhar, envia uma mensagem temporária ao usuário.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { normalizePhone, phoneLookupVariants } from "@/lib/phone";
import { extractWhatsappMedia } from "@/lib/wa-media";
import { parseMoneyAmount } from "@/lib/money-speech";
import { MONTHS_PT } from "@/lib/temporal-vocab";

/** Formata data/hora de compromisso em pt-BR (fuso de São Paulo). */
function prettyApptDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const day = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo", weekday: "long", day: "2-digit", month: "2-digit", year: "numeric",
  }).format(d);
  const hour = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit",
  }).format(d);
  return `${day} às ${hour}`;
}

function eventTitleFromOcr(text: string): string | null {
  const ignored = /^(data|hor[aá]rio|local|online|zoom|meet|teams|dia)\b/i;
  const line = text.split(/\r?\n/).map((v) => v.trim()).find((v) =>
    v.length >= 4 && v.length <= 100 && !ignored.test(v) && !/^\d/.test(v),
  );
  return line ?? null;
}

function eventLocationFromOcr(text: string): string | null {
  const explicit = text.match(/(?:local\s*:\s*)?([^\n]{0,30}\b(?:zoom|google meet|meet|teams)\b[^\n]{0,30})/i);
  if (explicit?.[1]) {
    const value = explicit[1].trim().replace(/^[-–—:]\s*/, "");
    return /online/i.test(value) ? value : `Online pelo ${value}`;
  }
  return null;
}

// Estados finais — não reprocessar.
const TERMINAL_STATUSES = new Set([
  "processed",
  "sent",
  "blocked",
  "ai_disabled",
  "failed_permanent",
]);

// Estados elegíveis para reprocessamento.
export const REPROCESSABLE_STATUSES = [
  "queued",
  "error",
  "send_error",
  "transcribe_error",
  "ai_error",
  "reprocessing",
];

// SLA: tentativas máximas antes de marcar como falha permanente
// (evita loop infinito no watchdog). Cada tentativa incrementada por trigger DB.
const MAX_ATTEMPTS = 6;

/**
 * Detecta consultas sobre módulos específicos (contas fixas, dívidas, metas,
 * hábitos, parcelamentos, transações). Usa regex determinístico para garantir
 * que perguntas financeiras JAMAIS caiam no módulo Agenda por engano.
 * Retorna null quando não bate nenhum padrão — nesse caso o fluxo cai na IA.
 */

// ===== CRITICAL DELIVERY GUARANTEE =====
// Regra global (spec 2026-07): "Se o lançamento foi salvo, obrigatoriamente
// enviar confirmação ao usuário. É proibido salvar e não responder."
// Este helper garante:
//  1) Retry único de envio quando a primeira tentativa falha (Z-API já retenta
//     internamente 4x; aqui adicionamos mais um ciclo com pausa curta).
//  2) Log de FALHA CRÍTICA em admin_audit_log quando a mensagem foi salva mas
//     não conseguimos entregar — para reconciliação manual pelo admin.
async function sendReplyWithCriticalGuard(
  toPhone: string,
  text: string,
  ctx: {
    inboundMessageId: string;
    userId: string | null;
    intent: string;
    savedTxId?: string | null;
    savedAppointmentId?: string | null;
  },
): Promise<{ ok: boolean; result: any }> {
  const { sendWhatsAppText } = await import("@/lib/uazapi.server");
  let result = await sendWhatsAppText(toPhone, text);
  if (!result.ok) {
    // Segunda chance depois de 800ms — cobre indisponibilidade momentânea da Z-API.
    await new Promise((r) => setTimeout(r, 800));
    result = await sendWhatsAppText(toPhone, text);
  }
  if (!result.ok) {
    const savedSomething = !!(ctx.savedTxId || ctx.savedAppointmentId);
    console.error(
      `[wa-processor] CRITICAL: send failed after retry. intent=${ctx.intent} inbound=${ctx.inboundMessageId} savedTx=${ctx.savedTxId ?? "-"} savedApp=${ctx.savedAppointmentId ?? "-"} error=${(result as any)?.error ?? "?"}`
    );
    if (savedSomething) {
      try {
        await supabaseAdmin.from("admin_audit_log").insert({
          admin_user_id: "00000000-0000-0000-0000-000000000000",
          target_user_id: ctx.userId ?? "00000000-0000-0000-0000-000000000000",
          action: "wa_delivery_failure_after_save",
          description: `Falha crítica: lançamento salvo (${ctx.savedTxId ?? ctx.savedAppointmentId}) mas resposta não entregue para ${toPhone}`,
          metadata: {
            phone: toPhone,
            inbound_message_id: ctx.inboundMessageId,
            intent: ctx.intent,
            transaction_id: ctx.savedTxId ?? null,
            appointment_id: ctx.savedAppointmentId ?? null,
            send_result: result as any,
            reply_preview: text.slice(0, 200),
          } as any,
        });
      } catch (e) {
        console.error("[wa-processor] failed to write critical audit log", e);
      }
    }
  }
  return { ok: result.ok, result };
}


function pad2(n: number) { return String(n).padStart(2, "0"); }
function fmtDateLocal(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function addDaysLocal(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

// Deriva do vocabulário compartilhado (1-indexed) para o formato 0-indexed
// que este arquivo já usava (getMonth()) — evita mais uma cópia divergente
// do mapa de meses, e ganha reconhecimento de abreviações ("jan", "fev"...)
// que a versão anterior não tinha.
const MONTHS_LOCAL: Record<string, number> = Object.fromEntries(
  Object.entries(MONTHS_PT).map(([name, oneIndexed]) => [name, oneIndexed - 1]),
);

function nowLocalSP(): Date {
  const s = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(new Date());
  const [dpart, tpart] = s.replace(/,\s*/, "T").split("T");
  const d = new Date(`${dpart}T${(tpart || "00:00:00").replace("24:", "00:")}`);
  return isNaN(d.getTime()) ? new Date() : d;
}

/** Espelho de detectPeriodFromText — texto já normalizado (NFD, sem acentos). */
export function detectPeriodFromTextLocal(t: string): any | null {
  if (!t) return null;
  const now = nowLocalSP();
  if (/\bhoje\b/.test(t)) return { range: "today" };
  if (/\bontem\b/.test(t)) return { range: "yesterday" };
  if (/\banteontem|antes\s+de\s+ontem\b/.test(t)) {
    const iso = fmtDateLocal(addDaysLocal(now, -2));
    return { start: iso, end: iso, label: "Anteontem" };
  }
  const between = t.match(/\b(?:de|do|entre)\s+(?:dia\s+)?(\d{1,2})(?:\/(\d{1,2}))?\s*(?:a|ate|e|ao)\s+(?:o\s+)?(?:dia\s+)?(\d{1,2})(?:\/(\d{1,2}))?/);
  if (between) {
    const monthName = Object.keys(MONTHS_LOCAL).find((m) => new RegExp(`\\b${m}\\b`).test(t));
    const fb = monthName ? MONTHS_LOCAL[monthName] : now.getMonth();
    const start = new Date(now.getFullYear(), between[2] ? Number(between[2]) - 1 : fb, Number(between[1]));
    const end = new Date(now.getFullYear(), between[4] ? Number(between[4]) - 1 : (between[2] ? Number(between[2]) - 1 : fb), Number(between[3]));
    if (!isNaN(start.getTime()) && !isNaN(end.getTime()) && end >= start) {
      return { start: fmtDateLocal(start), end: fmtDateLocal(end), label: "Período personalizado" };
    }
  }
  const sinceDay = t.match(/\bdesde\s+(?:o\s+)?dia\s+(\d{1,2})|\bdo\s+dia\s+(\d{1,2})\s+(?:ate|at(e|é))\s+(?:agora|hoje)/);
  if (sinceDay) {
    const dd = Number(sinceDay[1] ?? sinceDay[2]);
    if (dd >= 1 && dd <= 31) {
      const start = new Date(now.getFullYear(), now.getMonth(), dd);
      if (start > now) start.setMonth(start.getMonth() - 1);
      return { start: fmtDateLocal(start), end: fmtDateLocal(now), label: "Período personalizado" };
    }
  }
  if (/\b(do|desde\s+o)\s+(come(c|ç)o|inicio|in(i|í)cio)\s+do\s+m(e|ê)s\b/.test(t)) return { range: "month" };
  const lastDays = t.match(/ultim[oa]s?\s+(\d{1,3})\s+dias?/);
  if (lastDays) {
    const n = Math.max(1, Math.min(365, parseInt(lastDays[1], 10)));
    return { start: fmtDateLocal(addDaysLocal(now, -(n - 1))), end: fmtDateLocal(now), label: `Últimos ${n} dias` };
  }
  if (/ultim[oa]s?\s+sete\s+dias?/.test(t)) return { range: "last_7_days" };
  if (/ultim[oa]s?\s+trinta\s+dias?/.test(t)) return { range: "last_30_days" };
  if (/\bultimo\s+m(e|ê)s\s+corrido\b|\bm(e|ê)s\s+corrido\b/.test(t)) return { range: "last_30_days" };
  const lastMonths = t.match(/ultim[oa]s?\s+(\d{1,2})\s+(mes|meses|m(ê|e)s)/);
  if (lastMonths) {
    const n = Math.max(1, Math.min(24, parseInt(lastMonths[1], 10)));
    const start = new Date(now.getFullYear(), now.getMonth() - (n - 1), 1);
    return { start: fmtDateLocal(start), end: fmtDateLocal(now), label: `Últimos ${n} meses` };
  }
  if (/\bsemana\s+passada\b|\bsemana\s+anterior\b/.test(t)) return { range: "last_week" };
  if (/\b(essa|esta|nesta|dessa|desta)\s+semana\b|semana\s+atual\b|\bfechamento\s+semanal\b|\bna\s+semana\b/.test(t)) return { range: "week" };
  if (/\bultima\s+semana\b/.test(t)) return { range: "last_7_days" };
  if (/\bm(e|ê)s\s+passado\b|\bultimo\s+m(e|ê)s\b|\bm(e|ê)s\s+anterior\b/.test(t)) return { range: "last_month" };
  if (/\b(esse|este|neste|deste)\s+m(e|ê)s\b|m(e|ê)s\s+atual\b|no\s+m(e|ê)s\b|\bdo\s+m(e|ê)s\b|\bmeu\s+m(e|ê)s\b/.test(t)) return { range: "month" };
  if (/\b(esse|este|neste|deste)\s+ano\b|ano\s+atual\b/.test(t)) return { range: "year" };
  if (/\bano\s+passado\b|ultimo\s+ano\b/.test(t)) {
    const y = now.getFullYear() - 1;
    return { start: `${y}-01-01`, end: `${y}-12-31`, label: `Ano ${y}` };
  }
  for (const [name, idx] of Object.entries(MONTHS_LOCAL)) {
    if (new RegExp(`\\b${name}\\b`).test(t)) {
      const year = now.getMonth() >= idx ? now.getFullYear() : now.getFullYear() - 1;
      const start = new Date(year, idx, 1);
      const end = new Date(year, idx + 1, 0);
      return { start: fmtDateLocal(start), end: fmtDateLocal(end > now ? now : end), label: name[0].toUpperCase() + name.slice(1) };
    }
  }
  if (/desde\s+que\s+(comecei|come(ç|c)ei)|hist(o|ó)rico\s+completo|desde\s+o\s+in(i|í)cio/.test(t)) return { range: "all" };
  return null;
}


/** Pedido explícito de detalhamento por categoria. */
const CATEGORY_REQUEST_LOCAL_RE = /\b(por\s+categoria|categorias?|categorizad|separa(r|do)?\s+(por|os\s+gastos)|separado\s+por|divid(e|ir)\s+por\s+tipo|onde\s+(eu\s+)?(mais\s+)?(estou\s+)?gast(o|ei|ando)|onde\s+gastei)\b/;
/** Pedido de extrato / lista de lançamentos. */
const EXTRACT_REQUEST_LOCAL_RE = /\b(extrato|lan(c|ç)amentos?|listagem|quais\s+(foram|sao)\s+(minhas|meus)\s+(despesas|gastos|receitas)|quais\s+compras|item\s+por\s+item|lista\s+tudo)\b/;

/** Espelho de detectFinanceAsk — texto já normalizado. */
function detectFinanceAskLocal(t: string) {
  const wantExpense = /\bgast(o|os|ei|ando|amos)?\b|\bdespes|\bsaid|\bsa(i|í)da|\bpaguei|\bo\s+que\s+sa[ií]|\bquanto\s+sa[ií]|\btorrei\b|\bqueimei\b|\bfoi\s+embora\b/.test(t);
  const wantIncome = /\breceit|\bganh(o|os|ei)|\bentrad|\bentrou|\brecebi(?!bo)|\brecebid|\bo\s+que\s+entrou|\bquanto\s+entrou|\bquanto\s+recebi|\bquanto\s+caiu\b/.test(t);
  const wantBalance = /\bsaldo\b|\bquanto\s+tenho\b|\bquanto\s+sobra\b|\bquanto\s+sobrou\b|\bresultado\b|\bpositivo\s+ou\s+negativo\b|\bcaixa\b/.test(t);
  const wantCategories = CATEGORY_REQUEST_LOCAL_RE.test(t);
  const wantSummary = /\bresumo\b|\bfechament|\bfecha\s+(as|meu|minha|o)\b|\bbalan(c|ç)o\b|\bmovimenta(ç|c)|\bcomo\s+(foi|est(a|ã)o|estou|esta)\b|\bsitua(c|ç)(a|ã)o\s+financ|\bfinanceiramente\b|\btudo\s+que\s+aconteceu|\bmostra\s+tudo|\brelat(o|ó)rio\b|\bpanorama\b|\braio-?x\b|\bme\s+d(a|á)\s+os\s+numeros\b|\btotal\s+geral\b|\bqual\s+(o\s+)?meu\s+total\b|\bfa(z|ca)\s+as\s+contas\b|\bminhas\s+finan(c|ç)as\b|\bvida\s+financeira\b/.test(t);
  const mode: "summary" | "categories" | "extract" = wantCategories
    ? "categories"
    : (EXTRACT_REQUEST_LOCAL_RE.test(t) ? "extract" : "summary");
  return { wantExpense, wantIncome, wantSummary, wantBalance, wantCategories, mode };
}

/** "Sim/quero/manda/pode" logo após a pergunta de categorias do resumo. */
function isCategoryFollowUpYes(raw: string): boolean {
  const t = (raw || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[!.,?;:]+$/g, "").trim();
  if (!t || t.length > 40) return false;
  return /^(s|sim|sim\s+por\s+favor|claro|quero|quero\s+sim|pode|pode\s+ser|pode\s+mandar|manda|manda\s+ai|mostra|mostra\s+ai|mostrar|mostra\s+sim|isso|isso\s+mesmo|bora|vai|show|beleza\s+manda|por\s+favor|ok\s+manda|quero\s+ver|mostra\s+por\s+categoria|por\s+categoria|categorias?|sim\s+mostra|detalha|detalhar|quero\s+o\s+detalhe)$/.test(t);
}


/**
 * Frases de continuação: o usuário está pedindo mais detalhes da resposta
 * anterior — NÃO deve mudar o período automaticamente. Ex.: "especifica",
 * "detalha", "quais foram", "item por item", "abre o relatório".
 */
const FOLLOW_UP_DETAIL_RE = /\b(especific(a|ar|ou)|detalh(a|e|ar|ou)|discrimin(a|ar|ou)|separa(r)?\s+(pra|para)\s+mim|separa(r)?\s+isso|me\s+(explica|explique)\s+(melhor|mais)|mostra(r)?\s+(item\s+por\s+item|melhor|mais|em\s+detalh|detalhad)|item\s+por\s+item|quais\s+(foram|sao|s(a|ã)o)|abre\s+(esse|este|o)\s+relatori|abra\s+(esse|este|o)\s+relatori|quero\s+ver\s+(os\s+gastos|as\s+receitas|em\s+detalh)|lista(r)?\s+(os|as)\s+(gastos|despes|receitas))\b/;

/**
 * Frases que EXPLICITAMENTE trocam o período (o usuário quer mudar).
 * Só nesses casos alteramos a janela guardada.
 */
const EXPLICIT_PERIOD_OVERRIDE_RE = /\b(agora|em\s+vez\s+disso|no\s+lugar)\b/;

export function detectModuleQueryIntent(raw: string, lastCtx?: { period?: any; ask?: any } | null): any | null {
  const t = (raw || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  if (!t || t.length < 3) return null;

  // Pergunta / consulta explícita
  const isQuery = /(qua(l|is)|quanto|quantos|quantas|meu(s)?|minha(s)?|tenho|liste?|mostre?|exiba|ver|veja|listar|mostrar|exibir|total|resumo|cadastrad[ao]s?|vencem?|vence|pago|pende|atras|status|quais\ssao|como\s+foi|como\s+esta(v|)a|fechament|balan(c|ç)o|movimenta|financeiramente|situa(c|ç)(a|ã)o)/i.test(t);

  // ----- Compromissos / Agenda -----
  // Só roteia para CONSULTA quando é claramente uma pergunta e não há indicadores
  // de criação (horário, "tenho", "marcar", "agendar", dia específico). Caso contrário,
  // deixa a IA classificar para poder criar o compromisso.
  const hasTimeCue = /\b(\d{1,2}\s*(h|hs|hrs|horas?)|\d{1,2}\s*:\s*\d{2}|as\s+\d{1,2}|à(s)?\s+\d{1,2}|meio\s*dia|meia\s*noite)\b/i.test(t);
  const hasDayCue = /\b(hoje|amanh(a|ã)|depois\s+de\s+amanh(a|ã)|(segunda|ter(c|ç)a|quarta|quinta|sexta|s(a|á)bado|domingo)(-feira)?|dia\s+\d{1,2})\b/i.test(t);
  const createVerb = /\b(tenho|tem|marca(r)?|agenda(r)?|agendar|criar?|adiciona(r)?|anota(r)?|coloca(r)?|me\s+lembra|lembr(a|e|ar)|lembra?\s+de|preciso|vou|vamos|ir|vai|passar|buscar|pegar|ver|visitar|encontrar|reuni(a|ã)o\s+com|consulta\s+com|com\s+o\s+m(e|é)dico)\b/i.test(t);
  const looksLikeAppointmentQuery = /\b(compromisso|compromissos|reuni(a|ã)o|reunioes|reuniões|agenda(?!\s+de\s+contas)|evento|eventos|calendari[oa])\b/i.test(t);
  if (looksLikeAppointmentQuery && isQuery && !hasTimeCue && !hasDayCue && !createVerb) {
    return { kind: "query_appointments" };
  }

  // Estes quatro módulos (hábitos, metas, dívidas, parcelamentos) tinham só a
  // palavra-chave como gatilho, sem checar se era pergunta ou criação — ao
  // contrário do bloco de Agenda acima, que já testa isQuery + ausência de
  // pistas de criação. Resultado: "Compra parcelada, 10 parcelas de 1000
  // reais..." (uma CRIAÇÃO) caía direto em query_installments, sem nunca
  // chegar na IA (daí "ms":0 no log — nem chamava o classificador).
  // Criação de parcelamento/dívida/meta SEMPRE tem um valor numérico
  // ("10 parcelas de 1000", "empréstimo de 5000", "meta de 5000"); consulta
  // pura em geral não ("quantas parcelas faltam?", "minhas dívidas").
  // Mesma disciplina do bloco de Agenda: só roteia pra consulta quando for
  // claramente uma pergunta (isQuery) E não houver número na frase.
  const hasDigitCue = /\d/.test(t);

  // ----- Hábitos / Rotina -----
  if (isQuery && !hasDigitCue && /\b(habit(o|os)|rotina|habitos)\b/i.test(t)) {
    return { kind: "query_habits" };
  }

  // ----- Metas -----
  if (isQuery && !hasDigitCue && /\b(meta|metas|objetivo(s)?\sfinanceir)/i.test(t)) {
    return { kind: "query_goals" };
  }

  // ----- Renda mensal cadastrada (PERFIL, não movimentação) -----
  // Bug real: "qual minha renda mensal?" caía em query_summary/buildReport
  // ("nenhuma movimentação registrada") porque renda mensal cadastrada é
  // dado de PERFIL (planejamento), não uma transação — e essa separação
  // existia só dentro do prompt da IA, sem nenhuma guarda determinística
  // (diferente de todo o resto deste roteador). Sem valor na frase = é
  // pergunta; com valor ("minha renda é 20 mil") é atualização — isso
  // continua indo pra IA (update_profile), não entra aqui.
  if (
    isQuery && !hasDigitCue &&
    /\b(renda|sal[áa]rio)\s+mensal\b|\bqual\s+(a\s+)?(minha\s+)?renda\b|\bquanto\s+(eu\s+)?ganho\b/i.test(t)
  ) {
    return { kind: "query_profile", profile_field: "income" };
  }

  // ----- Dívidas -----
  if (isQuery && !hasDigitCue && /\b(divida|dividas|devendo|devo|emprestimo|empréstimo)\b/i.test(t)) {
    return { kind: "query_debts" };
  }

  // ----- Parcelamentos -----
  if (isQuery && !hasDigitCue && /\b(parcela|parcelas|parcelamento|parcelamentos|parcelad[ao]s?)\b/i.test(t)) {
    return { kind: "query_installments" };
  }

  // ----- Contas fixas / recorrentes -----
  const billsRe = /\b(contas?\s+fixas?|contas?\s+mensa(l|is)|contas?\s+recorrentes?|despesas?\s+recorrentes?|contas?\s+cadastradas?|conta\s+fixa|contas?(\s+do|\s+desse|\s+deste|\s+esse|\s+este)?\s+(mes|mês)|vencimento(s)?|fatura(s)?|boleto(s)?|compromissos?\s+financeiro|contas\s+a\s+pagar|conta[s]?)\b/i;
  const billsHintRe = /\b(aluguel|internet|luz|agua|água|energia|gas|gás|condomini|academia|netflix|spotify|streaming|mensalidade|celular|telefone|plano\s+de\s+saude|plano\s+de\s+saúde|mercado(?!\s+pago)|escola|faculdade)\b/i;
  const isFinancialAsk = /(gast|despes|said|sa(i|í)da|receit|ganh|entrad|entrou|recebi|resumo|fechament|balan(c|ç)o|movimenta|financeiramente|quanto\s+(gast|entrou|recebi|sobra))/i.test(t);
  // Mesmo bug de "Parcelamentos" (ver acima), mas aqui um digito sozinho não
  // basta pra distinguir criação de consulta — "quais contas vencem dia 5?"
  // TEM dígito e é consulta legítima. O que separa uma criação real é um
  // VALOR em dinheiro ("...de mil reais", "R$ 120"): pergunta sobre vencimento
  // não afirma quanto custa, só pergunta a data.
  const hasMoneyCue = /r\$|\breais?\b|\d{1,3}(?:\.\d{3})*,\d{2}/i.test(t);
  if ((billsRe.test(t) || (isQuery && billsHintRe.test(t))) && !isFinancialAsk && !hasMoneyCue) {
    let filter: "all" | "upcoming" | "overdue" | "pending" = "all";
    if (/\batrasad|em\s+atraso|vencid/i.test(t)) filter = "overdue";
    else if (/\bpendent/i.test(t)) filter = "pending";
    else if (/\bproxim|próxim|vencem?\s+este\s+mes|vencem?\s+este\s+mês|vencem?\s+amanha|vencem?\s+amanhã|vencem?\s+hoje|vencem?\s+na\s+semana|proximos\s+dias/i.test(t)) filter = "upcoming";

    const dayMatch = t.match(/\bdia\s+(\d{1,2})\b/);
    const dueDay = dayMatch ? Math.min(31, Math.max(1, Number(dayMatch[1]))) : undefined;

    // Extrai um "hint" quando o usuário cita um item específico
    let hint: string | undefined;
    const hintMatch = t.match(billsHintRe);
    if (hintMatch) hint = hintMatch[0];

    return { kind: "query_bills", filter, dueDay, hint };
  }

  // ----- Relatório financeiro inteligente (gastos/receitas/resumo por período) -----
  // Detecta perguntas como "quanto gastei essa semana?", "quanto entrou hoje?",
  // "qual foi meu gasto e receita essa semana?", "resumo dos últimos 7 dias".
  // Se detectar período OU intenção clara de resumo financeiro, roteia para
  // o relatório detalhado (nunca lista solta).
  const ask = detectFinanceAskLocal(t);
  const period = detectPeriodFromTextLocal(t);
  const anyAsk = ask.wantExpense || ask.wantIncome || ask.wantSummary || ask.wantBalance || ask.wantCategories;

  // Continuação: usuário pede detalhes ("especifica", "detalha", "por categoria"…).
  // Sem período novo e sem "agora"/override → reaproveita último período consultado.
  const isFollowUp = FOLLOW_UP_DETAIL_RE.test(t) || ask.wantCategories;
  const hasExplicitOverride = EXPLICIT_PERIOD_OVERRIDE_RE.test(t);
  if (isFollowUp && lastCtx?.period && !period && !hasExplicitOverride) {
    // Mantém o MESMO período da consulta anterior (regra obrigatória).
    const derived = anyAsk ? ask : { ...(lastCtx.ask ?? { wantSummary: true }), mode: "extract" as const };
    return {
      kind: "query_finance_report",
      period: lastCtx.period,
      ask: derived,
      _followUp: true,
    };
  }

  // Evita confundir REGISTRO ("gastei 50 no mercado") com CONSULTA.
  const hasAmountToken = /\br?\$?\s*\d+([.,]\d{1,2})?\b/.test(t.replace(/ultim[oa]s?\s+\d+\s+(dias?|mes|meses)/g, "").replace(/dia\s+\d{1,2}/g, ""));
  const looksLikeQuery = isQuery || ask.wantSummary || !!period;
  if (anyAsk && looksLikeQuery && !hasAmountToken) {
    // Pergunta financeira sem período informado → padrão: mês atual até hoje.
    return {
      kind: "query_finance_report",
      period: period ?? { range: "month" as const },
      ask,
    };
  }




  // ----- Receitas (sem período detectado) -----
  if (/\b(receita(s)?|ganho(s)?|entrada(s)?|recebiment)/i.test(t) && isQuery) {
    return { kind: "query_transactions", txKind: "income" };
  }

  // ----- Despesas (sem período detectado) -----
  if (/\b(despesa(s)?|gasto(s)?|saida(s)?|saída(s)?)\b/i.test(t) && isQuery && !/mes\b|mês\b|relatori|resumo/i.test(t)) {
    return { kind: "query_transactions", txKind: "expense" };
  }

  // ----- Histórico / transações -----
  if (/\b(historico|histórico|transacoes|transações|ultimos\s+lancament|últimos\s+lançament|meus\s+lancament|meus\s+lançament)\b/i.test(t)) {
    return { kind: "query_transactions" };
  }

  // ----- Saldo -----
  if (/\b(saldo|quanto\s+tenho|quanto\s+sobra|quanto\s+eu\s+tenho)\b/i.test(t)) {
    return { kind: "query_balance" };
  }

  return null;
}

/**
 * Detecta mensagens curtas de encerramento/agradecimento — "ok", "valeu",
 * "beleza", "obrigado", 👍, 👌, ❤️, 😄 etc. Quando o usuário só está
 * fechando o assunto, NÃO devemos acionar IA, correções ou buscas.
 */
const SMALL_TALK_CLOSE_WORDS = new Set([
  "ok", "okay", "okey", "k", "kk", "kkk", "kkkk",
  "ta bom", "tá bom", "tabom", "tudo bem", "td bem", "tudo certo", "td certo",
  "beleza", "blz", "bl", "de boa", "deboa",
  "fechou", "fechado", "fexou",
  "valeu", "vlw", "vlww", "valew",
  "obrigado", "obrigada", "obg", "obgd", "obgdo", "brigado", "brigada", "thanks", "thx",
  "show", "showww", "show de bola",
  "perfeito", "perfect",
  "boa", "boaa", "boaaa", "top", "topp", "toppp", "massa", "irado", "legal",
  "entendi", "entendido", "compreendi", "certo", "combinado", "isso",
  "👍", "👌", "❤️", "❤", "😄", "😊", "🙂", "🙏", "👊", "✌️", "😉", "👏",
]);
function stripEmojiVariations(s: string): string {
  return s.replace(/\uFE0F/g, "");
}
function isSmallTalkClose(input: string): boolean {
  if (!input) return false;
  let t = stripEmojiVariations(input).trim().toLowerCase();
  // remove pontuação final repetida
  t = t.replace(/[!.,?¿¡;:~]+$/g, "").trim();
  if (!t) return false;
  if (t.length > 24) return false;
  // Apenas emojis / apenas caracteres emoji-like
  const onlyEmoji = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s]+$/u.test(t);
  if (onlyEmoji) return true;
  if (SMALL_TALK_CLOSE_WORDS.has(t)) return true;
  // Combinações leves: "ok obrigado", "valeu mesmo", "beleza então"
  const words = t.split(/\s+/);
  if (words.length <= 3 && words.every((w) => SMALL_TALK_CLOSE_WORDS.has(w) || /^[\p{Emoji_Presentation}\p{Extended_Pictographic}]+$/u.test(w) || /^(mesmo|então|entao|mano|cara|amigo|amiga|meu|então\!?)$/.test(w))) {
    return words.some((w) => SMALL_TALK_CLOSE_WORDS.has(w));
  }
  return false;
}

const CLOSING_REPLIES = [
  "✅ Perfeito! Qualquer coisa é só me chamar.",
  "Tudo certo! Estarei por aqui quando precisar.",
  "Combinado! Até mais. 👋",
  "Pode contar comigo sempre.",
  "Precisando registrar algo, basta mandar texto, áudio ou imagem. 📩",
  "Fechado! Tenha um ótimo dia. ☀️",
  "Sempre que precisar organizar suas finanças, é só chamar. 💙",
  "Até a próxima! 🚀",
  "Conte comigo para manter suas finanças organizadas.",
  "Estarei aqui quando precisar. 👊",
];
function pickClosingReply(): string {
  return CLOSING_REPLIES[Math.floor(Math.random() * CLOSING_REPLIES.length)];
}

/**
 * Detecta se a mensagem tem marcadores explícitos de RECORRÊNCIA
 * (necessário para tratar como Conta Fixa). Sem esses marcadores,
 * a intenção correta é um lembrete/agenda único.
 */
const RECURRENCE_RE = /\b(todo\s+(mes|mês|dia|m(ê|e)s)|todos\s+os\s+meses|toda\s+semana|mensal(mente)?|semanal(mente)?|di[aá]ri[oa]|conta\s+fixa|contas?\s+fixas|recorrente|assinatura|mensalidade|streaming|todo\s+dia\s+\d{1,2}|dia\s+\d{1,2}\s+de\s+todo\s+m(ê|e)s)\b/i;
const KNOWN_RECURRING_HINT_RE = /\b(aluguel|internet|(luz|energia)\b|(agua|água)\b|condom(i|í)nio|academia|netflix|spotify|prime\s+video|hbo|disney|mensalidade|plano\s+de\s+sa[uú]de|celular\s+p[oó]s|iptv|streaming)\b/i;
function looksRecurring(text: string): boolean {
  if (!text) return false;
  return RECURRENCE_RE.test(text) || KNOWN_RECURRING_HINT_RE.test(text);
}



export type ProcessResult = {
  ok: boolean;
  intent?: string;
  status?: string;
  reason?: string;
};

const FLOW_ADMIN_ID = "00000000-0000-0000-0000-000000000000";

type ProcessingWatchdog = {
  mark: (stage: string, details?: Record<string, unknown>) => Promise<void>;
  stop: () => void;
  finish: (result: ProcessResult) => Promise<void>;
};

function createProcessingWatchdog(row: any, phone: string): ProcessingWatchdog {
  const startedAt = Date.now();
  const stages: Record<string, { ok: boolean; at: string; details?: Record<string, unknown> }> = {
    message_received: { ok: true, at: new Date().toISOString() },
  };
  let stopped = false;

  const persistStages = async () => {
    const { data: current } = await supabaseAdmin.from("whatsapp_messages")
      .select("ai_meta").eq("id", row.id).maybeSingle();
    await supabaseAdmin.from("whatsapp_messages").update({
      ai_meta: {
        ...((current?.ai_meta && typeof current.ai_meta === "object") ? current.ai_meta as Record<string, unknown> : {}),
        flow: stages,
        flow_started_at: new Date(startedAt).toISOString(),
      } as any,
    }).eq("id", row.id);
  };

  const sendProgress = async (text: string, stage: string) => {
    if (stopped) return;
    try {
      const { sendWhatsAppText } = await import("@/lib/uazapi.server");
      const sent = await sendWhatsAppText(phone, text);
      stages[stage] = { ok: sent.ok, at: new Date().toISOString(), details: sent.ok ? undefined : { error: sent.error ?? "send_failed" } };
      await supabaseAdmin.from("whatsapp_messages").insert({
        user_id: row.user_id ?? null, phone, direction: "out", media_type: "text",
        content: text, status: sent.ok ? "sent" : "send_error",
        raw: { send: sent, progress_for: row.id, progress_stage: stage } as any,
      });
      await persistStages();
    } catch (error: any) {
      stages[stage] = { ok: false, at: new Date().toISOString(), details: { error: error?.message ?? "progress_send_failed" } };
    }
  };

  // REGRA: nenhuma mensagem antes da resposta final. Sem ACK, sem "processando".
  // O usuário recebe exatamente UMA mensagem, já com o resultado da ação.

  void sendProgress;
  const analyzingTimer = setTimeout(() => {}, 0);
  const finalizingTimer = setTimeout(() => {}, 0);

  return {
    mark: async (stage, details) => {
      stages[stage] = { ok: true, at: new Date().toISOString(), details };
      await persistStages();
    },
    stop: () => {
      stopped = true;
      clearTimeout(analyzingTimer);
      clearTimeout(finalizingTimer);
    },
    finish: async (result) => {
      stopped = true;
      clearTimeout(analyzingTimer);
      clearTimeout(finalizingTimer);
      const { data: current } = await supabaseAdmin.from("whatsapp_messages")
        .select("user_id, ai_intent, status, last_error").eq("id", row.id).maybeSingle();
      const { data: outboundRows } = await supabaseAdmin.from("whatsapp_messages")
        .select("id, status, raw").eq("direction", "out").eq("phone", phone)
        .gte("created_at", row.created_at).order("created_at", { ascending: false }).limit(12);
      const outbound = (outboundRows ?? []).find((item: any) => !item.raw?.progress_stage);
      const { data: persistedRows } = await supabaseAdmin.from("transactions")
        .select("id").eq("source_message_id", row.id).limit(10);
      const persistedIds = (persistedRows ?? []).map((item: any) => item.id);
      stages.flow_finalized = { ok: result.ok, at: new Date().toISOString(), details: { status: result.status ?? current?.status ?? "unknown" } };
      stages.ai_interpreted = { ok: !!(result.intent || current?.ai_intent), at: new Date().toISOString(), details: { intent: result.intent ?? current?.ai_intent ?? "pre_ai_flow" } };
      stages.action_executed = { ok: result.ok, at: new Date().toISOString(), details: { intent: result.intent ?? current?.ai_intent ?? null } };
      stages.database_updated = {
        ok: result.ok,
        at: new Date().toISOString(),
        details: persistedIds.length ? { verified_transaction_ids: persistedIds } : { status_persisted: current?.status ?? result.status ?? null },
      };
      stages.response_sent = { ok: outbound?.status === "sent", at: new Date().toISOString(), details: { outbound_id: outbound?.id ?? null } };
      await persistStages();
      try {
        await supabaseAdmin.from("admin_audit_log").insert({
          admin_user_id: FLOW_ADMIN_ID,
          target_user_id: current?.user_id ?? row.user_id ?? FLOW_ADMIN_ID,
          action: result.ok && outbound?.status === "sent" ? "wa_flow_completed" : "wa_flow_failed",
          description: result.ok && outbound?.status === "sent"
            ? `Fluxo WhatsApp finalizado com resposta para a mensagem ${row.id}`
            : `Fluxo WhatsApp falhou na etapa ${outbound?.status === "sent" ? "processamento" : "resposta_enviada"}`,
          metadata: {
            inbound_message_id: row.id, phone, intent: result.intent ?? current?.ai_intent ?? null,
            status: result.status ?? current?.status ?? null, last_error: current?.last_error ?? result.reason ?? null,
            duration_ms: Date.now() - startedAt, stages,
          } as any,
        });
      } catch (error) {
        console.error("[wa-processor] failed to persist flow audit", error);
      }
    },
  };
}

function formatBRL(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

async function buildRecoveredTransactionReply(userId: string, tx: any) {
  const { pickReply, maybeDashboardLink } = await import("./wa-replies");
  const { data: profile } = await supabaseAdmin
    .from("profiles").select("phone").eq("id", userId).maybeSingle();
  const phone = (profile?.phone as string | null) ?? null;
  const headerKind = tx.kind === "income" ? "income_header" : "expense_header";
  const header = await pickReply(headerKind, phone);
  const link = await maybeDashboardLink(phone);
  const icon = tx.kind === "income" ? "💼" : "📝";
  const valueIcon = tx.kind === "income" ? "💰" : "💸";
  // Confirmação curta: descrição, valor e categoria (sem data/saldo).
  return `${header}\n\n${icon} ${tx.description || tx.category}\n${valueIcon} ${formatBRL(Number(tx.amount))}\n🏷️ ${tx.category}${link}`;
}


/**
 * Tenta reivindicar a mensagem para processamento via CAS.
 * Retorna true se conseguiu o lock (status virou 'processing').
 */
async function claimMessage(id: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("whatsapp_messages")
    .update({ status: "processing" })
    .eq("id", id)
    .in("status", REPROCESSABLE_STATUSES)
    .select("id");
  return !!(data && data.length === 1);
}

/**
 * Processa uma mensagem inbound já registrada em whatsapp_messages.
 * Não verifica fila por telefone — para uso em reprocessamento sequencial.
 */
export async function processInboundMessage(messageId: string): Promise<ProcessResult> {
  const { data: row, error: loadErr } = await supabaseAdmin
    .from("whatsapp_messages")
    .select("id, user_id, phone, direction, status, media_type, content, transcription, raw, raw_message_id, created_at")
    .eq("id", messageId)
    .maybeSingle();

  if (loadErr || !row) return { ok: false, reason: "not_found" };
  if (row.direction !== "in") return { ok: false, reason: "not_inbound" };
  if (TERMINAL_STATUSES.has(row.status)) {
    // Status terminal sozinho não prova que o usuário recebeu a resposta.
    // Só encerra quando existe um outbound enviado depois desta mensagem;
    // caso contrário, reabre o fluxo e deixa a idempotência recuperar a
    // confirmação sem duplicar uma transação já persistida.
    const { data: terminalOutboundRows } = await supabaseAdmin
      .from("whatsapp_messages")
      .select("id, status, raw")
      .eq("direction", "out")
      .eq("phone", normalizePhone(row.phone))
      .eq("status", "sent")
      .gte("created_at", row.created_at)
      .order("created_at", { ascending: true })
      .limit(12);
    const terminalReply = (terminalOutboundRows ?? []).find((item: any) => !item.raw?.progress_stage);
    if (terminalReply) return { ok: true, status: row.status };

    console.warn("[wa-processor] terminal message has no delivered reply; reopening", {
      messageId: row.id,
      status: row.status,
    });
    await supabaseAdmin.from("whatsapp_messages").update({
      status: "reprocessing",
      last_error: "terminal_without_delivered_reply",
    }).eq("id", row.id);
    row.status = "reprocessing";
  }

  // Se o status já é 'processing', o caller (webhook) reservou — não precisa reivindicar.
  // Para qualquer outro status reprocessável, faz CAS para evitar dupla execução.
  if (row.status !== "processing") {
    const claimed = await claimMessage(row.id);
    if (!claimed) {
      return { ok: false, reason: "already_claimed", status: row.status };
    }
  }

  const replyPhone = normalizePhone(row.phone);
  const watchdog = createProcessingWatchdog(row as any, replyPhone);
  await watchdog.mark("processing_started");

  // Idempotência forte: se qualquer transação já foi gravada com este
  // source_message_id (por uma execução anterior que crashou/timeoutou antes
  // de marcar terminal), NÃO grava novamente. Recupera a confirmação faltante.
  {
    const { data: alreadyBooked } = await supabaseAdmin
      .from("transactions")
      .select("id, user_id, kind, amount, category, description, occurred_at")
      .eq("source_message_id", row.id)
      .limit(1);
    if (alreadyBooked && alreadyBooked.length > 0) {
      console.log("[wa-processor] message already produced transactions; recovering reply", {
        messageId: row.id, txCount: alreadyBooked.length,
      });
      try {
        await supabaseAdmin.from("wa_duplicate_log").insert({
          user_id: row.user_id ?? null,
          phone: row.phone,
          raw_message_id: row.raw_message_id ?? null,
          reason: "reprocess_after_transaction_exists",
          content: row.content ?? null,
          matched_transaction_id: alreadyBooked[0].id,
        });
      } catch {}
      const tx = alreadyBooked[0] as any;
      const replyText = await buildRecoveredTransactionReply(tx.user_id, tx);
      const { ok: sendOk, result: sendResult } = await sendReplyWithCriticalGuard(replyPhone, replyText, {
        inboundMessageId: row.id,
        userId: tx.user_id,
        intent: "recovered_transaction_confirmation",
        savedTxId: tx.id,
      });
      await supabaseAdmin.from("whatsapp_messages").insert({
        user_id: tx.user_id, phone: replyPhone, direction: "out", media_type: "text",
        content: replyText, status: sendOk ? "sent" : "send_error",
        raw: { send: sendResult, recovered_for: row.id } as any,
      });
      await supabaseAdmin.from("whatsapp_messages")
        .update({
          ai_intent: "recovered_transaction_confirmation",
          status: sendOk ? "processed" : "send_error",
          last_error: sendOk ? null : "recovered_confirmation_send_failed",
        })
        .eq("id", row.id);
      const result: ProcessResult = { ok: sendOk, status: sendOk ? "processed" : "send_error", intent: "recovered_transaction_confirmation", reason: "already_booked" };
      await watchdog.finish(result);
      return result;
    }
  }

  // Estabelece o contexto de idempotência para este message id — todas as
  // inserções em `transactions` neste fluxo vão carimbar source_message_id.
  // Usa runWithSourceMessage (AsyncLocalStorage.run) porque enterWith() NÃO é
  // suportado pelo runtime do Cloudflare Workers e provoca crash imediato.
  const { runWithSourceMessage } = await import("@/lib/brinzap-actions.server");
  try {
    const result = await runWithSourceMessage({ messageId: row.id, origin: "whatsapp" }, () =>
      processInboundMessageCore(row as any),
    );
    await watchdog.finish(result);
    return result;
  } catch (error: any) {
    watchdog.stop();
    const result: ProcessResult = { ok: false, status: "error", reason: error?.message ?? "unhandled_processing_error" };
    await watchdog.finish(result);
    throw error;
  }
}

// Valor citado pelo usuário na legenda/mensagem (para checar divergência com o PDF).
// Delega ao parser monetário canônico — mesma normalização de fala usada em
// todo o resto do app (ver src/lib/money-speech.ts).
function extractCaptionAmount(text: string): number | null {
  return parseMoneyAmount(text ?? "");
}

function formatMoneyBR(n: number): string {
  return `R$ ${n.toFixed(2).replace(".", ",")}`;
}

async function processInboundMessageCore(row: any): Promise<ProcessResult> {



  const phone = normalizePhone(row.phone);
  const replyPhone = phone;
  const raw = (row.raw ?? {}) as any;
  const extracted = extractWhatsappMedia(raw);
  let text = extracted.text ?? row.content ?? undefined;
  const { audioUrl, imageCaption, documentUrl, documentName, documentMime } = extracted;
  // Documento (PDF/comprovante) é uma MÍDIA VÁLIDA e segue o mesmo fluxo da imagem.
  // A linha persistida também é fonte de detecção. Isso recupera mensagens
  // recebidas por versões antigas do webhook ou payloads cujo URL expirou.
  const isDocument = extracted.hasDocument || row.media_type === "document";
  const imageUrl = extracted.imageUrl || documentUrl;


  // Lookup profile by phone variants.
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("id, name, phone, status")
    .in("phone", phoneLookupVariants(phone))
    .maybeSingle();

  // Bloqueio
  if (profile?.status === "blocked") {
    try {
      const { sendWhatsAppText } = await import("@/lib/uazapi.server");
      await sendWhatsAppText(replyPhone, "Seu acesso está temporariamente bloqueado. Entre em contato com o suporte.");
    } catch {}
    await supabaseAdmin.from("whatsapp_messages").update({ status: "blocked" }).eq("id", row.id);
    return { ok: true, status: "blocked" };
  }

  // Vincula user_id se profile encontrado e a linha ainda não está vinculada
  if (profile && !row.user_id) {
    await supabaseAdmin.from("whatsapp_messages").update({ user_id: profile.id }).eq("id", row.id);
  }

  try {
    const { classifyMessage, classifyImage, chatReply, guestReply, transcribeAudio } = await import("@/lib/ai-classify.server");
    const actions = await import("@/lib/brinzap-actions.server");
    const { sendWhatsAppText } = await import("@/lib/uazapi.server");

    let inputText = text ?? "";

    if (audioUrl && !row.transcription) {
      try {
        console.log("[wa-processor][audio] stage=download_started", { messageId: row.id });
        inputText = await transcribeAudio(audioUrl);
        if (!inputText.trim()) throw new Error("AUDIO_TRANSCRIPTION_EMPTY");
        await supabaseAdmin.from("whatsapp_messages").update({ transcription: inputText }).eq("id", row.id);
        console.log("[wa-processor][audio] stage=transcription_completed", { messageId: row.id, chars: inputText.length });
      } catch {
        await sendWhatsAppText(replyPhone, "Não consegui ouvir esse áudio, pode mandar de novo? 🙏");
        await supabaseAdmin.from("whatsapp_messages").update({ status: "transcribe_error" }).eq("id", row.id);
        return { ok: false, reason: "transcribe_error", status: "transcribe_error" };
      }
    } else if (row.transcription) {
      inputText = row.transcription;
    }

    // ===== NORMALIZAÇÃO MONETÁRIA (fala/transcrição) =====
    // "trinta e sete reais e vinte e cinco centavos" → "37,25".
    // Roda ANTES de qualquer parser ou IA para nunca dividir reais/centavos.
    const { normalizeSpokenMoney, hasExplicitCentsConstruction } = await import("@/lib/money-speech");
    const explicitCents = hasExplicitCentsConstruction(inputText) || hasExplicitCentsConstruction(imageCaption ?? "");
    if (inputText.trim()) {
      const normalizedInput = normalizeSpokenMoney(inputText);
      if (normalizedInput !== inputText) {
        console.log("[wa-processor][money] stage=amount_normalized", {
          messageId: row.id, before: inputText.slice(0, 120), after: normalizedInput.slice(0, 120),
        });
        inputText = normalizedInput;
      }
    }
    const normalizedCaption = imageCaption ? normalizeSpokenMoney(imageCaption) : imageCaption;



    if (!isDocument && !imageUrl && !inputText.trim()) {
      await sendWhatsAppText(replyPhone, "Oi! Pode me mandar sua mensagem em texto, áudio, imagem, PDF, Excel/CSV ou Word? 🙂");
      await supabaseAdmin.from("whatsapp_messages").update({ status: "processed" }).eq("id", row.id);
      return { ok: true, status: "processed" };
    }

    // ===== GUEST FLOW =====
    if (!profile) {
      if (isDocument) {
        console.warn("[wa-processor][doc] stage=unlinked_phone", {
          messageId: row.id,
          phone,
          documentUrl: Boolean(documentUrl),
        });
        const replyText = "📄 Recebi e reconheci seu PDF, mas este WhatsApp ainda não está vinculado à sua conta do Abio. Entre no painel, confirme seu número e reenvie o documento para eu registrar com segurança.";
        const sendResult = await sendWhatsAppText(replyPhone, replyText);
        await supabaseAdmin.from("whatsapp_messages").update({
          ai_intent: "document_unlinked_phone",
          ai_meta: { mode: "document", document_detected: true, document_url: Boolean(documentUrl) } as any,
          status: sendResult.ok ? "processed" : "send_error",
        }).eq("id", row.id);
        await supabaseAdmin.from("whatsapp_messages").insert({
          user_id: null, phone: replyPhone, direction: "out", media_type: "text",
          content: replyText, status: sendResult.ok ? "sent" : "send_error", raw: { send: sendResult } as any,
        });
        return { ok: sendResult.ok, status: sendResult.ok ? "processed" : "send_error", intent: "document_unlinked_phone" };
      }
      const { data: recentGuest } = await supabaseAdmin
        .from("whatsapp_messages")
        .select("direction, content, transcription")
        .eq("phone", phone)
        .is("user_id", null)
        .order("created_at", { ascending: false })
        .limit(10);
      const guestHistory: { role: "user" | "assistant"; content: string }[] = [];
      for (const m of (recentGuest ?? []).reverse()) {
        const txt = ((m as any).transcription || (m as any).content || "").toString();
        if (txt) guestHistory.push({ role: m.direction === "in" ? "user" : "assistant", content: txt });
      }
      const t0g = Date.now();
      const guestText = inputText || (imageUrl ? "(o usuário enviou uma imagem)" : "");
      const replyText = await guestReply(guestText, guestHistory);
      const aiMsG = Date.now() - t0g;
      const sendResult = await sendWhatsAppText(replyPhone, replyText);
      await supabaseAdmin.from("whatsapp_messages").update({
        transcription: audioUrl ? inputText : null,
        ai_intent: "guest_chat",
        ai_meta: { model: "openai", ms: aiMsG, mode: imageUrl ? "image" : audioUrl ? "audio" : "text", guest: true } as any,
        status: sendResult.ok ? "processed" : "send_error",
      }).eq("id", row.id);
      await supabaseAdmin.from("whatsapp_messages").insert({
        user_id: null, phone: replyPhone, direction: "out", media_type: "text",
        content: replyText, status: sendResult.ok ? "sent" : "send_error", raw: { send: sendResult } as any,
      });
      return { ok: sendResult.ok, status: sendResult.ok ? "processed" : "send_error", intent: "guest_chat" };
    }

    // Pendência + memória de última consulta (precisa vir antes do onboarding:
    // confirmações como "Sim" devem executar a ação pendente, não reiniciar fluxo).
    let pending: any = null;
    let lastCtx: { period?: any; ask?: any; at?: string; installments_list?: any[] } | null = null;
    {
      const { data: contact } = await supabaseAdmin
        .from("wa_contacts").select("id, pending_action, last_query_context").eq("phone", phone).maybeSingle();
      // REGRA: enquanto dentro do prazo, a pendência é válida até ser concluída
      // ou cancelada pelo usuário — o tempo sozinho não a encerra. Mas toda
      // pendência com `expires_at` VENCIDO é lixo de um fluxo abandonado, e
      // nunca pode continuar bloqueando outros assuntos indefinidamente
      // (ex.: um "receipt_conflict" de dias atrás impedindo criar um compromisso
      // novo). Pendências sem `expires_at` continuam sem prazo, como sempre.
      const rawPending = (contact as any)?.pending_action ?? null;
      const isExpired = !!rawPending?.expires_at && new Date(rawPending.expires_at).getTime() < Date.now();
      if (isExpired) {
        await supabaseAdmin.from("wa_contacts").update({ pending_action: null }).eq("phone", phone);
        pending = null;
      } else {
        pending = rawPending;
      }
      const rawCtx = (contact as any)?.last_query_context ?? null;
      if (rawCtx?.period || rawCtx?.installments_list) lastCtx = rawCtx;
    }

    // ID (da Z-API) da mensagem que o usuário está RESPONDENDO, quando ele
    // usa o "responder" nativo do WhatsApp — vem como `referenceMessageId`
    // no payload bruto, no nível raiz (confirmado na doc da Z-API), igual
    // pra texto ou áudio. Guardado como `row.raw` desde o webhook. Usado
    // pra resolver com certeza (não só "criado há pouco") a que entidade
    // uma correção se refere.
    const replyToRawMessageId: string | null =
      (row as any)?.raw?.referenceMessageId
      || (row as any)?.raw?.data?.referenceMessageId
      || (row as any)?.raw?.message?.referenceMessageId
      || null;

    // ⚠️ Bug real (afeta TODO usuário que corrige um parcelamento/conta e
    // depois manda qualquer outra coisa): "installment_followup"/
    // "bill_followup" são pendências OPCIONAIS — só existem pra aceitar uma
    // correção adicional ("na verdade são 220 parcelas") se o usuário quiser
    // mandar mais uma, nunca uma pergunta que precisa de resposta direta. Mas
    // como praticamente todo detector espontâneo deste arquivo exige
    // `!pending`, essa pendência (que se renovava por 24h a cada correção,
    // agora reduzida pra 30min) bloqueava qualquer mensagem nova e sem
    // relação — inclusive "Paguei o consórcio" — jogando tudo pra IA em vez
    // do fluxo determinístico certo. `isSoftFollowupPending` marca esses
    // casos pra quem precisar tratá-los como "sem pendência bloqueante".
    const isSoftFollowupPending = pending?.kind === "installment_followup" || pending?.kind === "bill_followup";

    const normalized = (inputText || "").trim().toLowerCase().replace(/[!.,?¿¡;:]+$/g, "");
    const YES_RE = /^(s|sim|claro|isso|isso mesmo|com certeza|tenho certeza|confirmar|confirmo|confirma|pode|pode apagar|pode ser|pode sim|ok|okay|👍|✅|sim,?\s*(apagar|apaga|excluir|deletar|zerar|pode)( tudo)?|apagar tudo|apaga tudo|excluir tudo|zerar tudo|manda ver|vai|bora)$/i;
    const NO_RE = /^(n|nao|não|cancelar|cancela|deixa|deixa assim|desconsidera|desconsiderar|esquece|nada|para|pare|negativo|❌)$/i;

    // ⚠️ Guarda compartilhada contra "roubo de assunto" (generalizada —
    // antes só cobria parcelamento/conta fixa). Vários fluxos determinísticos
    // (agenda, edição da última transação, etc.) tentam resolver um alvo
    // "mais recente"/"ativo" quando a frase não especifica um claramente —
    // e bugs reais em produção mostraram isso roubando mensagens que na
    // verdade eram sobre OUTRO módulo ("Compra parcelada mudar pro dia 5"
    // mexeu numa transação de gás sem relação; "trocar data da compra
    // parcelada pro dia 02/01" remarcou um compromisso de corte de cabelo
    // sem relação nenhuma). A mesma classe de bug pode acontecer com
    // compromisso/dívida/meta mencionados de forma explícita — por isso o
    // reconhecimento cobre todos os módulos, não só parcelamento/conta.
    // Regra de ouro: se a frase claramente fala de um módulo específico,
    // SÓ quem entende daquele módulo decide o que fazer com ela — nunca
    // "a última transação"/"o único compromisso ativo" por padrão.
    type ExplicitModuleRef = "installment_or_bill" | "appointment" | "debt" | "goal";
    const explicitModuleRef: ExplicitModuleRef | null = (() => {
      if (/\b(parcela|parcelas|parcelamento|parcelamentos|parcelad[ao]s?|cons[óo]rcio|conta\s+fixa)\b/i.test(inputText)) {
        return "installment_or_bill";
      }
      if (/\b(compromisso|compromissos|lembrete|lembretes|agenda|evento|eventos|reuni[ãa]o|reuni[õo]es|consulta|consultas|encontro|encontros)\b/i.test(inputText)) {
        return "appointment";
      }
      if (/\b(d[íi]vida|d[íi]vidas|empr[ée]stimo|empr[ée]stimos)\b/i.test(inputText)) {
        return "debt";
      }
      if (/\b(meta|metas)\b/i.test(inputText)) {
        return "goal";
      }
      if (
        lastCtx?.installments_list?.length &&
        (/^\s*\d{1,2}\b/.test(normalized) || /\b(?:o|a|item|numero|n[úu]mero)\s+\d{1,2}\b/i.test(normalized))
      ) {
        return "installment_or_bill";
      }
      return null;
    })();
    // Usado pelos detectores de EDIÇÃO DE TRANSAÇÃO (transactions não é
    // nenhum desses 4 módulos, então qualquer referência explícita exclui).
    const looksLikeModuleReference = explicitModuleRef !== null;
    // Usado pelo FLUXO DE AGENDA (que é, ele mesmo, o módulo "appointment" —
    // só se exclui quando a frase fala claramente de outro módulo).
    const looksLikeOtherModuleThanAppointment = explicitModuleRef !== null && explicitModuleRef !== "appointment";

    // ===== ONBOARDING =====
    if (!imageUrl) {
      try {
        const appointmentPendingKinds = new Set([
          "appointment_confirm", "appointment_reschedule", "appointment_draft", "appointment",
          "appointment_need_title",
        ]);
        const isAppointmentFollowUp = !!pending && appointmentPendingKinds.has(pending.kind);
        const clearAppointmentMessage = (() => {
          try {
            const text = inputText || "";
            if (!text.trim()) return false;
            if (/\b(compromisso|lembrete|agenda|evento|reuni[ãa]o|consulta|encontro)\b/i.test(text)) return true;
            if (/\b(amanh[ãa]|depois de amanh[ãa]|hoje|segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|domingo)\b/i.test(text) && /\b\d{1,2}\s*(:|h|horas?)?\b/i.test(text)) return true;
          } catch { return false; }
          return false;
        })();
        if (isAppointmentFollowUp || clearAppointmentMessage) throw new Error("skip_onboarding_for_appointment");
        const { handleOnboardingMessage } = await import("@/lib/onboarding.server");
        const ob = await handleOnboardingMessage(profile.id, profile.name ?? null, inputText);
        if (ob.handled && ob.reply) {
          const sendResult = await sendWhatsAppText(replyPhone, ob.reply);
          await supabaseAdmin.from("whatsapp_messages").update({
            transcription: audioUrl ? inputText : null,
            ai_intent: "onboarding",
            status: sendResult.ok ? "processed" : "send_error",
          }).eq("id", row.id);
          await supabaseAdmin.from("whatsapp_messages").insert({
            user_id: profile.id, phone: replyPhone, direction: "out", media_type: "text",
            content: ob.reply, status: sendResult.ok ? "sent" : "send_error", raw: { send: sendResult } as any,
          });
          return { ok: sendResult.ok, status: sendResult.ok ? "processed" : "send_error", intent: "onboarding" };
        }
      } catch (e: any) {
        if (e?.message !== "skip_onboarding_for_appointment") console.error("[wa-processor] onboarding error", e);
      }
    }

    // Memória curta
    const history: { role: "user" | "assistant"; content: string }[] = [];
    {
      const { data: recent } = await supabaseAdmin
        .from("whatsapp_messages")
        .select("direction, content, transcription, ai_intent, ai_payload")
        .eq("user_id", profile.id)
        .order("created_at", { ascending: false })
        .limit(6);
      const ordered = (recent ?? []).reverse();
      for (const m of ordered) {
        const txt = (m.transcription || m.content || "").toString();
        if (txt) history.push({ role: (m.direction === "in" ? "user" : "assistant") as "user" | "assistant", content: txt });
      }
      const lastAction = ordered.reverse().find((m: any) => m.ai_intent && m.ai_payload);
      if (lastAction) {
        const p = (lastAction as any).ai_payload || {};
        history.push({
          role: "assistant",
          content: `[última ação: ${(lastAction as any).ai_intent}${p.amount ? ` R$${p.amount}` : ""}${p.category ? ` ${p.category}` : ""}${p.description ? ` "${p.description}"` : ""}${p.scheduled_at ? ` em ${p.scheduled_at}` : ""}]`,
        });
      }
    }

    // Reconhecimento de confirmação de pagamento de conta fixa (linguagem natural)
    const BILL_PAID_RE = /(^|\s)(1|paguei|ja paguei|já paguei|pago|pagos|paga|quitado|quitei|quitada|foi pago|pode lançar|pode lancar|pode registrar|efetuado|pagamento (feito|realizado)|sim,? paguei|sim)($|\s)/i;
    const BILL_DEFER_RE = /(^|\s)(2|ainda nao|ainda não|nao paguei|não paguei|continua pendente|nao ainda|não ainda|nao|não)($|\s)/i;
    const BILL_POSTPONE_RE = /(^|\s)(3|adiar|adiei|adia|reagendar|posterga|depois eu pago|depois pago|amanha|amanhã)($|\s)/i;

    // ===== weekly_choice pending (fechamento semanal/mensal) =====
    if (pending && pending.kind === "weekly_choice" && !imageUrl) {
      const wantMonthly = /^(2|mês|mes|mensal|mês atual|mes atual|do mês|do mes|mensal)$/i.test(normalized) || /mens/i.test(normalized);
      const wantWeekly = /^(1|semana|semanal|da semana)$/i.test(normalized) || /^1\b/.test(normalized);
      if (wantMonthly || wantWeekly) {
        const { sendReport } = await import("@/routes/api/public/hooks/weekly-summary");
        await supabaseAdmin.from("wa_contacts").update({ pending_action: null }).eq("phone", phone);
        const reportResult = await sendReport(profile.id, wantMonthly ? "monthly" : "weekly");
        await supabaseAdmin.from("whatsapp_messages").update({
          ai_intent: "weekly_choice_reply",
          status: reportResult.ok ? "processed" : "send_error",
          last_error: reportResult.ok ? null : reportResult.error,
        }).eq("id", row.id);
        return {
          ok: reportResult.ok,
          status: reportResult.ok ? "processed" : "send_error",
          intent: "weekly_choice_reply",
          reason: reportResult.ok ? undefined : reportResult.error,
        };
      }
    }

    // ===== weekly_optout pending (desativar apenas o resumo semanal) =====
    if (pending && pending.kind === "weekly_optout" && !imageUrl) {
      const { sendWhatsAppText } = await import("@/lib/uazapi.server");
      // Detecta intenção de desativar o resumo semanal em várias formas
      // ("não", "não quero", "pode parar", "cancela", "chega", "remove", "desativa"...)
      const normLower = normalized.toLowerCase().trim();
      const wantsOptOut =
        /^(2|n)$/i.test(normLower) ||
        /\b(nao|não)\b/.test(normLower) ||
        /\b(parar|pare|para|chega|cancela(r)?|remove(r)?|desativa(r)?|encerra(r)?|desinscrever|desinscreve|sair)\b/.test(normLower) ||
        /\b(nao|não)\s+(quero|precis[ao]|manda|envie|envia|receber|receb[oa]|preciso)\b/.test(normLower) ||
        /\b(pode|prefiro|acho que)\s+(parar|remover|desativar|cancelar|nao|não)\b/.test(normLower) ||
        /\b(nao|não)\s+manda(r)?\s+mais\b/.test(normLower) ||
        /\bnao\s+quero\s+esse\s+resumo\b/.test(normLower);
      const wantsKeep = /^(1|sim|s|continuar|manter|ok|✅|quero|pode\s+continuar|pode\s+manter)$/i.test(normLower);
      if (wantsOptOut) {
        await supabaseAdmin.from("profiles").update({ weekly_summary_enabled: false }).eq("id", profile.id);
        await supabaseAdmin.from("wa_contacts").update({ pending_action: null }).eq("phone", phone);
        const replyText = "✅ Prontinho! Você não receberá mais o *resumo semanal* aos domingos.\n\nOs outros lembretes (contas, compromissos, metas) continuam normalmente. Para reativar depois, é só me pedir. 💙";
        const sendResult = await sendWhatsAppText(replyPhone, replyText);
        await supabaseAdmin.from("whatsapp_messages").update({
          ai_intent: "weekly_optout_disable", status: sendResult.ok ? "processed" : "send_error",
        }).eq("id", row.id);
        await supabaseAdmin.from("whatsapp_messages").insert({
          user_id: profile.id, phone: replyPhone, direction: "out", media_type: "text",
          content: replyText, status: sendResult.ok ? "sent" : "send_error", raw: { send: sendResult } as any,
        });
        return { ok: true, status: "processed", intent: "weekly_optout_disable" };
      }
      if (wantsKeep) {
        await supabaseAdmin.from("wa_contacts").update({ pending_action: null }).eq("phone", phone);
        const replyText = "💙 Perfeito! Vou continuar te enviando o resumo semanal aos domingos.";
        const sendResult = await sendWhatsAppText(replyPhone, replyText);
        await supabaseAdmin.from("whatsapp_messages").update({
          ai_intent: "weekly_optout_keep", status: sendResult.ok ? "processed" : "send_error",
        }).eq("id", row.id);
        await supabaseAdmin.from("whatsapp_messages").insert({
          user_id: profile.id, phone: replyPhone, direction: "out", media_type: "text",
          content: replyText, status: sendResult.ok ? "sent" : "send_error", raw: { send: sendResult } as any,
        });
        return { ok: true, status: "processed", intent: "weekly_optout_keep" };
      }
      // Qualquer outra resposta: limpa o pending e segue fluxo normal (a mensagem é interpretada como novo comando).
      await supabaseAdmin.from("wa_contacts").update({ pending_action: null }).eq("phone", phone);
    }

    // ===== bill_payment pending (confirmação de conta fixa) =====
    if (pending && pending.kind === "bill_payment" && !imageUrl) {
      const actionsMod = await import("@/lib/brinzap-actions.server");
      const { sendWhatsAppText } = await import("@/lib/uazapi.server");
      let replyText = "";
      let handled = true;
      if (BILL_PAID_RE.test(normalized) || /^1$/.test(normalized) || YES_RE.test(normalized)) {
        const r = await actionsMod.confirmBillPayments(profile.id, pending.bill_ids || [], row.created_at);
        replyText = r.replyText;
        await supabaseAdmin.from("wa_contacts").update({ pending_action: null }).eq("phone", phone);
      } else if (BILL_POSTPONE_RE.test(normalized) || /^3$/.test(normalized)) {
        // Adiar: mantém pendente, apenas reconhece e reagenda o próximo lembrete para amanhã
        replyText = "⏭️ Ok! Vou adiar e te lembro novamente amanhã. Se pagar antes, me avisa. 👍";
        await supabaseAdmin.from("wa_contacts").update({ pending_action: null }).eq("phone", phone);
      } else if (/^2$/.test(normalized) || BILL_DEFER_RE.test(normalized) || NO_RE.test(normalized)) {
        const r = await actionsMod.deferBillPayments(profile.id, pending.bill_ids || []);
        replyText = r.replyText;
        await supabaseAdmin.from("wa_contacts").update({ pending_action: null }).eq("phone", phone);
      } else {
        handled = false;
      }
      if (handled) {
        const sendResult = await sendWhatsAppText(replyPhone, replyText);
        await supabaseAdmin.from("whatsapp_messages").update({
          ai_intent: "bill_payment_reply", status: sendResult.ok ? "processed" : "send_error",
        }).eq("id", row.id);
        await supabaseAdmin.from("whatsapp_messages").insert({
          user_id: profile.id, phone: replyPhone, direction: "out", media_type: "text",
          content: replyText, status: sendResult.ok ? "sent" : "send_error", raw: { send: sendResult } as any,
        });
        return { ok: sendResult.ok, status: sendResult.ok ? "processed" : "send_error", intent: "bill_payment_reply" };
      }
    }

    // ===== FLUXO EXCLUSIVO DE AGENDA =====
    // Regra: intenção clara → executa direto e responde UMA vez.
    // Nunca usar vocabulário financeiro aqui.
    const apptPendingKinds = new Set([
      "appointment_confirm", "appointment_reschedule", "appointment_draft", "appointment",
      "appointment_need_title",
    ]);
    // IMPORTANTE: uma pendência de OUTRO fluxo (financeiro, onboarding...) NUNCA
    // pode bloquear permanentemente um compromisso novo e completo. Pendências
    // não expiram sozinhas ("o tempo nunca encerra uma pendência" — ver acima),
    // então uma pendência antiga esquecida deixava a agenda inteira inoperante.
    // Por isso o bloco roda sempre; só os passos que DEPENDEM do rascunho de
    // agenda (0-3 abaixo) exigem que a pendência seja, de fato, de agenda.
    if (!imageUrl && inputText && inputText.trim()) {

      const { sendWhatsAppText } = await import("@/lib/uazapi.server");
      const { pickReply: pickApptReply } = await import("./wa-replies");
      const { parseFutureDateTimeSP, readAppointmentChoice } = await import("@/lib/appointment-datetime.server");
      const { detectAppointmentCommand } = await import("@/lib/appointment-nlp.server");
      const appts = await import("@/lib/appointment-actions.server");

      const cmd = detectAppointmentCommand(inputText);
      const nat = parseFutureDateTimeSP(inputText);
      const isApptPending = !!pending && apptPendingKinds.has(pending.kind);

      let replyText = "";
      let handled = false;
      const clearPending = async () =>
        supabaseAdmin.from("wa_contacts").update({ pending_action: null }).eq("phone", phone);

      const { isVagueApptTitle } = await import("@/lib/appointment-nlp.server");
      const askTitle = async (iso: string, notes: string | null) => {
        await supabaseAdmin.from("wa_contacts").upsert(
          {
            phone, name: profile.name ?? null,
            pending_action: {
              kind: "appointment_need_title", scheduled_at: iso, notes,
              expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
            } as any,
          },
          { onConflict: "phone" },
        );
        return await pickApptReply("appointment_missing_title", phone);
      };

      const { isConfirmationPhrase } = await import("@/lib/appointment-nlp.server");
      // Limpa data/hora do texto para extrair só a descrição (memória de contexto).
      const titleFromText = (s: string) =>
        s
          .trim()
          .replace(/[.!]+$/, "")
          .replace(/^(e|eh|é|sera|será|vai ser|bora|bora marcar|marca isso|marca|marcar|agenda pra mim|agenda ai|agenda aí|agenda|agendar|anota ai|anota aí|anota|anotar|coloca na agenda|manda pra agenda|mete na agenda|joga no sistema|guarda isso|salva isso|deixa salvo|registra isso|registra|registrar|pode lan[çc]ar|cria|criar|reserva)\s+/i, "")
          // "segunda feira" (com espaço) é tão comum quanto "segunda-feira" —
          // o "[- ]" aceita hífen OU espaço antes de "feira".
          .replace(/(^|\s)(hoje|amanh[ãa]|depois de amanh[ãa]|segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|domingo)([- ]feira)?(?=\s|$)/gi, " ")
          // Verbos/substantivos de agenda que não são parte do título em si.
          .replace(/\b(tenho|tem|marcado|marcada|compromisso|lembrete|evento|preciso|vou|quero|me lembra|lembrar)\b/gi, " ")
          .replace(/(^|\s)[àa]s?\s*\d{1,2}([:h]\d{0,2})?(?=\s|$)/gi, " ")
          .replace(/\b\d{1,2}[:h]\d{0,2}\b/gi, " ")
          .replace(/\b\d{1,2}\s*(horas?|h)\b/gi, " ")
          .replace(/\b(uma|duas|tr[êe]s|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|meio[- ]dia|meia[- ]noite)(\s+e\s+meia)?\b/gi, " ")
          .replace(/\b(dia\s*)?\d{1,2}(\/\d{1,2}(\/\d{2,4})?)\b/gi, " ")
          .replace(/\b(da|de|a)?\s*(manh[ãa]|tarde|noite)\b/gi, " ")
          .replace(/\s{2,}/g, " ")
          .trim()
          .slice(0, 80);

      // Mensagem completa não depende da IA: título + data + hora = salvar agora.
      // Regra: só NÃO cria direto quando o usuário está no meio de um rascunho
      // de agenda (aí quem decide são os passos 0-3, que sabem mesclar/perguntar
      // só o que falta). Uma pendência de OUTRO assunto nunca deve impedir isso.
      if (!isApptPending && nat.iso && nat.hasDate && nat.hasTime && !isConfirmationPhrase(inputText)) {
        const directTitle = titleFromText(inputText);
        const { scoreAppointmentIntent } = await import("@/lib/appointment-confidence.server");
        const directScore = scoreAppointmentIntent({ text: inputText, hasScheduledAt: true });
        const missingFields: string[] = [];
        if (isVagueApptTitle(directTitle)) missingFields.push("title");
        if (!directScore.autoCreate) missingFields.push("confidence");
        console.log("[commitment-parser]", {
          rawText: inputText, weekday: nat.hasDate ? "resolved" : null, time: nat.hasTime ? "resolved" : null,
          resolvedDate: nat.iso, directTitle, score: directScore.score, reasons: directScore.reasons,
          pendingKindBefore: pending?.kind ?? null, missingFields,
          action: missingFields.length === 0 ? "CREATE" : "SKIP_TO_STEPS",
        });
        if (missingFields.length === 0) {
          const actionsMod = await import("@/lib/brinzap-actions.server");
          replyText = (await actionsMod.recordAppointment(profile.id, {
            title: directTitle,
            scheduled_at: nat.iso,
            notes: inputText,
            confidence: directScore.score,
            source_text: inputText,
          })).replyText;
          handled = true;
          // Uma pendência de OUTRO fluxo fica obsoleta assim que um novo
          // compromisso completo é criado — não deixa lixo bloqueando o próximo.
          if (pending) await clearPending();
        }
      }

      // --- 0) Rascunho com data/hora aguardando SÓ a descrição ---
      if (!handled && pending && pending.kind === "appointment_need_title") {
        handled = true;
        if (cmd?.action === "cancel") {
          replyText = await pickApptReply("appointment_cancelled", phone);
          await clearPending();
        } else {
          // Se o usuário mandou nova data/hora junto, atualiza sem reiniciar o fluxo.
          const isoBase = pending.scheduled_at;
          const iso = nat.iso && (nat.hasDate || nat.hasTime)
            ? (appts.mergeReschedule(isoBase, nat) ?? isoBase)
            : isoBase;
          const title = isConfirmationPhrase(inputText) ? "" : titleFromText(inputText);
          if (!title || isVagueApptTitle(title)) {
            replyText = await pickApptReply("appointment_missing_title", phone);
          } else {
            const actionsMod = await import("@/lib/brinzap-actions.server");
            replyText = (await actionsMod.recordAppointment(profile.id, {
              title, scheduled_at: iso, notes: pending.notes ?? null, source_text: inputText,
            })).replyText;
            await clearPending();
          }
        }
      }
      // --- 1) Rascunho aguardando data/hora (única pergunta legítima) ---
      else if (!handled && pending && pending.kind === "appointment_draft") {
        handled = true;
        const choice = cmd?.action ?? readAppointmentChoice(inputText);
        if (choice === "cancel") {
          replyText = await pickApptReply("appointment_cancelled", phone);
          await clearPending();
        } else {
          const prev = pending.partial_iso ? new Date(pending.partial_iso) : null;
          let finalIso: string | null = null;
          if (nat.hasDate && nat.hasTime) finalIso = nat.iso;
          else if (nat.iso && prev && !isNaN(prev.getTime())) {
            finalIso = appts.mergeReschedule(prev.toISOString(), nat);
          } else if (nat.iso) finalIso = nat.iso;
          else if (choice === "confirm" && pending.partial_iso && pending.has_date && pending.has_time) {
            finalIso = pending.partial_iso;
          }
          // Bug real: quando só falta a HORA e o usuário diz explicitamente
          // que não sabe/não tem hora definida ("não sei a hora, marca pro
          // dia"), o Abio insistia perguntando de novo em vez de agendar —
          // o usuário já respondeu, só que a resposta era "sem horário
          // específico", não uma hora. Usa 09:00 como padrão (mesma hora
          // default já usada em appointment-datetime.server.ts quando
          // hasTime é falso) e cria mesmo assim.
          const declinesTime = /\bn[ãa]o\s+(sei|tenho|sabe)\s+(a\s+)?hor[ae]|sem\s+hor[ae]\s+(definida|certa|marcada|espec[íi]fica)?\b|hor[áa]rio\s+indefinid|qualquer\s+hor[áa]rio|marca(r)?\s+(assim\s+mesmo|sem\s+hora)|(o\s+)?dia\s+(todo|inteiro)\b/i;
          if (!finalIso && pending.has_date && !pending.has_time && pending.partial_iso && declinesTime.test(inputText)) {
            const base = new Date(pending.partial_iso);
            if (!isNaN(base.getTime())) {
              base.setUTCHours(12, 0, 0, 0); // 09:00 em America/Sao_Paulo (UTC-3)
              finalIso = base.toISOString();
            }
          }

          // Memória: mantém o título já informado, mas aproveita uma
          // descrição nova se a resposta trouxer uma (ex.: "Buscar aluna,
          // hoje" depois de "11:30 buscar escola" deve virar "Buscar
          // aluna", não ficar preso no título da primeira mensagem). Antes
          // só reaproveitava a resposta quando o título antigo era vago —
          // um título já razoável nunca podia ser corrigido nesta etapa.
          // isConfirmationPhrase/titleFromText já filtram respostas que são
          // só a data/hora ("hoje", "14h", "sim") — titleFromText some com
          // esses tokens e sobra "" (extra vazio), então o título antigo
          // continua intacto nesses casos.
          // declinesTime também precisa excluir a extração de título — bug
          // real: "Não sei a hora ainda, marca o compromisso pro dia"
          // virou o TÍTULO do compromisso (sobrescrevendo "prova Policia
          // em Alegre"), porque titleFromText não sabia que essa frase era
          // uma resposta sobre horário, não uma descrição nova.
          let draftTitle: string = pending.title ?? "";
          if (!isConfirmationPhrase(inputText) && !declinesTime.test(inputText)) {
            const extra = titleFromText(inputText);
            if (extra && !isVagueApptTitle(extra)) draftTitle = extra;
          }

          if (finalIso) {
            if (isVagueApptTitle(draftTitle)) {
              replyText = await askTitle(finalIso, pending.notes ?? null);
            } else {
              const actionsMod = await import("@/lib/brinzap-actions.server");
              replyText = (await actionsMod.recordAppointment(profile.id, {
                title: draftTitle,
                scheduled_at: finalIso,
                notes: pending.notes ?? null,
                source_text: inputText,
              })).replyText;
              await clearPending();
            }
          } else {
            if (draftTitle !== (pending.title ?? "")) {
              await supabaseAdmin.from("wa_contacts").update({
                pending_action: { ...pending, title: draftTitle } as any,
              }).eq("phone", phone);
            }
            replyText = pending.has_date
              ? await pickApptReply("appointment_missing_time", phone)
              : await pickApptReply("appointment_missing_date", phone);
          }
        }
      }

      // --- 2) Confirmação de um compromisso ainda NÃO salvo (rascunho pronto) ---
      else if (!handled && pending && pending.kind === "appointment") {
        const choice = cmd?.action ?? readAppointmentChoice(inputText);
        handled = true;
        if (choice === "confirm" || choice === "complete") {
          const actionsMod = await import("@/lib/brinzap-actions.server");
          replyText = (await actionsMod.recordAppointment(profile.id, {
            title: pending.title, scheduled_at: pending.scheduled_at, notes: pending.notes ?? null,
            source_text: inputText,
          })).replyText;
          await clearPending();
        } else if (choice === "cancel") {
          replyText = await pickApptReply("appointment_cancelled", phone);
          await clearPending();
        } else if (nat.iso && (nat.hasDate || nat.hasTime)) {
          const iso = appts.mergeReschedule(pending.scheduled_at, nat) ?? nat.iso;
          const actionsMod = await import("@/lib/brinzap-actions.server");
          replyText = (await actionsMod.recordAppointment(profile.id, {
            title: pending.title, scheduled_at: iso, notes: pending.notes ?? null, source_text: inputText,
          })).replyText;
          await clearPending();
        } else if (choice === "reschedule") {
          replyText = await pickApptReply("appointment_reschedule_ask", phone);
        } else {
          // Nunca perder o contexto: mensagem livre vira a descrição do compromisso.
          const raw = inputText.trim().replace(/[.!]+$/, "");
          if (raw.length <= 60 && !raw.includes("?") && !isVagueApptTitle(raw)) {
            const actionsMod = await import("@/lib/brinzap-actions.server");
            replyText = (await actionsMod.recordAppointment(profile.id, {
              title: raw.slice(0, 80), scheduled_at: pending.scheduled_at, notes: pending.notes ?? null,
              source_text: inputText,
            })).replyText;
            await clearPending();
          } else {
            replyText = `Posso salvar este compromisso?\n\n📝 ${pending.title}\n🕒 ${appts.prettyAppointmentDate(pending.scheduled_at)}`;
          }
        }
      }
      // --- 3) Comando sobre um compromisso EXISTENTE ---
      // ⚠️ Bug real: "trocar data da compra parcelada pro dia 02/01/2027"
      // batia com "trocar...data" (comando de reagendar) e, sem alvo
      // explícito, caía no único compromisso ativo do usuário — remarcando
      // algo completamente sem relação. looksLikeOtherModuleThanAppointment
      // bloqueia esse ramo inteiro quando a frase é claramente sobre
      // parcelamento/conta/dívida/meta: quem resolve isso é o módulo
      // correspondente, não a agenda (mas uma frase sobre "compromisso" em
      // si não bloqueia — é exatamente o que este ramo trata).
      else if (!handled && !looksLikeOtherModuleThanAppointment && (cmd || (pending && pending.kind === "appointment_reschedule"))) {
        // Resolve o alvo pelo contexto: pending > último lembrete > único ativo.
        let target: any = null;
        if (pending && (pending.kind === "appointment_confirm" || pending.kind === "appointment_reschedule")) {
          target = await appts.getAppointment(profile.id, pending.appointment_id);
        }
        if (!target) target = await appts.lastRemindedAppointment(profile.id, phone);

        let ambiguous: any[] = [];
        // Respostas numéricas ("3") só valem com contexto de agenda explícito.
        const contextual = !!target || isApptPending;
        if (cmd?.numeric && !contextual) {
          target = null;
        } else if (!target) {
          const active = await appts.listActiveAppointments(profile.id);
          if (active.length === 1) target = active[0];
          else if (active.length > 1) ambiguous = active;
        }


        // Reagendamento em andamento: nova data chegou nesta mensagem.
        if (pending && pending.kind === "appointment_reschedule" && target) {
          handled = true;
          if (cmd?.action === "cancel") {
            replyText = await appts.cancelAppointment(profile.id, target, phone);
            await clearPending();
          } else if (nat.iso && (nat.hasDate || nat.hasTime)) {
            const iso = appts.mergeReschedule(target.scheduled_at, nat) ?? nat.iso;
            replyText = await appts.rescheduleAppointment(profile.id, target, iso, phone);
            await clearPending();
          } else {
            replyText = await pickApptReply("appointment_reschedule_ask", phone);
          }
        } else if (cmd && target) {
          handled = true;
          if (cmd.action === "cancel") {
            replyText = await appts.cancelAppointment(profile.id, target, phone);
            await clearPending();
          } else if (cmd.action === "complete") {
            replyText = await appts.completeAppointment(profile.id, target, phone);
            await clearPending();
          } else if (cmd.action === "reschedule") {
            const iso = nat.iso && (nat.hasDate || nat.hasTime)
              ? appts.mergeReschedule(target.scheduled_at, nat)
              : null;
            if (iso) {
              replyText = await appts.rescheduleAppointment(profile.id, target, iso, phone);
              await clearPending();
            } else {
              // Única dúvida real: falta a nova data/hora.
              replyText = await pickApptReply("appointment_reschedule_ask", phone);
              await supabaseAdmin.from("wa_contacts").update({
                pending_action: {
                  kind: "appointment_reschedule", appointment_id: target.id,
                  expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
                } as any,
              }).eq("phone", phone);
            }
          } else if (cmd.action === "confirm" && isApptPending) {
            replyText = await appts.keepAppointment(target, phone);
            await clearPending();
          }
        } else if (cmd && ambiguous.length > 1 && (cmd.mentionsAgenda || cmd.numeric || isApptPending)) {
          // Pergunta UMA vez só qual compromisso.
          handled = true;
          const verb = cmd.action === "complete" ? "concluir" : cmd.action === "reschedule" ? "reagendar" : "cancelar";
          const list = ambiguous.slice(0, 5)
            .map((a, i) => `${i + 1}. ${a.title} — ${appts.prettyAppointmentDate(a.scheduled_at)}`)
            .join("\n");
          replyText = `Qual deles você quer ${verb}?\n\n${list}`;
        }
      }

      if (handled && replyText) {
        const sendResult = await sendWhatsAppText(replyPhone, replyText);
        await supabaseAdmin.from("whatsapp_messages").update({
          ai_intent: "appointment_flow", status: sendResult.ok ? "processed" : "send_error",
        }).eq("id", row.id);
        await supabaseAdmin.from("whatsapp_messages").insert({
          user_id: profile.id, phone: replyPhone, direction: "out", media_type: "text",
          content: replyText, status: sendResult.ok ? "sent" : "send_error", raw: { send: sendResult } as any,
        });
        return { ok: sendResult.ok, status: sendResult.ok ? "processed" : "send_error", intent: "appointment_flow" };
      }
    }





    // ===== reengagement_prompt pending (resposta ao lembrete de 3 dias) =====
    if (pending && pending.kind === "reengagement_prompt" && !imageUrl) {
      const { sendWhatsAppText } = await import("@/lib/uazapi.server");
      if (/^2$/.test(normalized) || /^(nao|não|parar|para de|chega|desativar|não quero|nao quero)/i.test(normalized)) {
        await supabaseAdmin.from("profiles").update({ reengagement_enabled: false }).eq("id", profile.id);
        await supabaseAdmin.from("wa_contacts").update({ pending_action: null }).eq("phone", phone);
        const msg = "✅ Feito! Não vou mais enviar lembretes de inatividade.\n\nOs demais avisos importantes (contas fixas, compromissos e alertas financeiros) continuam ativos normalmente. 👍";
        const sendResult = await sendWhatsAppText(replyPhone, msg);
        await supabaseAdmin.from("whatsapp_messages").update({
          ai_intent: "reengagement_opt_out", status: sendResult.ok ? "processed" : "send_error",
        }).eq("id", row.id);
        await supabaseAdmin.from("whatsapp_messages").insert({
          user_id: profile.id, phone: replyPhone, direction: "out", media_type: "text",
          content: msg, status: sendResult.ok ? "sent" : "send_error", raw: { send: sendResult } as any,
        });
        return { ok: sendResult.ok, status: sendResult.ok ? "processed" : "send_error", intent: "reengagement_opt_out" };
      }
      if (/^1$/.test(normalized) || /^(sim|continuar|continua|ok|manter)/i.test(normalized)) {
        await supabaseAdmin.from("wa_contacts").update({ pending_action: null }).eq("phone", phone);
        const msg = "👍 Combinado! Vou continuar te lembrando quando ficar alguns dias sem movimentação.";
        const sendResult = await sendWhatsAppText(replyPhone, msg);
        await supabaseAdmin.from("whatsapp_messages").update({
          ai_intent: "reengagement_opt_in", status: sendResult.ok ? "processed" : "send_error",
        }).eq("id", row.id);
        await supabaseAdmin.from("whatsapp_messages").insert({
          user_id: profile.id, phone: replyPhone, direction: "out", media_type: "text",
          content: msg, status: sendResult.ok ? "sent" : "send_error", raw: { send: sendResult } as any,
        });
        return { ok: sendResult.ok, status: sendResult.ok ? "processed" : "send_error", intent: "reengagement_opt_in" };
      }
      // Qualquer outra resposta = usuário voltou a interagir. Limpa o pending
      // e deixa o fluxo normal (lançamento, consulta etc.) tratar a mensagem.
      await supabaseAdmin.from("wa_contacts").update({ pending_action: null }).eq("phone", phone);
      pending = null;
    }


    // ===== expense/income pending (imagem aguardando confirmação) =====
    // O usuário mandou um comprovante e ficou uma pendência. Se ele responde
    // com uma descrição livre ("foi sorvete", "era gasolina", "isso foi ontem"),
    // mesclamos com os dados extraídos da nota e registramos direto — sem
    // exigir "sim"/"não" literal e sem perder o contexto da imagem.
    if (
      pending &&
      !imageUrl &&
      (pending.kind === "expense" || pending.kind === "income") &&
      inputText &&
      !YES_RE.test(normalized) &&
      !NO_RE.test(normalized)
    ) {
      const { sendWhatsAppText } = await import("@/lib/uazapi.server");
      const actionsMod = await import("@/lib/brinzap-actions.server");
      const { extractDateHintSP } = await import("./datetime");

      // Cancelamento explícito ("esquece esse pagamento", "deixa pra lá",
      // "não registra isso"): não gravamos nada e limpamos a pendência.
      if (/\b(esquec(e|a)|deixa\s+pra\s+la|deixa\s+pra\s+lá|deixa\s+quieto|nao\s+registra|não\s+registra|nao\s+lan[cç]a|não\s+lan[cç]a|descarta|desconsider(a|e)|ignora)\b/i.test(normalized)) {
        await supabaseAdmin.from("wa_contacts").update({ pending_action: null }).eq("phone", phone);
        const msg = "👍 Ok, descartei essa imagem. Nenhum lançamento foi salvo.";
        const sendResult = await sendWhatsAppText(replyPhone, msg);
        await supabaseAdmin.from("whatsapp_messages").update({
          ai_intent: "image_pending_discard", status: sendResult.ok ? "processed" : "send_error",
        }).eq("id", row.id);
        await supabaseAdmin.from("whatsapp_messages").insert({
          user_id: profile.id, phone: replyPhone, direction: "out", media_type: "text",
          content: msg, status: sendResult.ok ? "sent" : "send_error", raw: { send: sendResult } as any,
        });
        return { ok: sendResult.ok, status: sendResult.ok ? "processed" : "send_error", intent: "image_pending_discard" };
      }

      // Data: se o usuário mencionou data no texto ("foi ontem", "dia 15"),
      // ela sobrescreve a data do comprovante. Referência futura vira compromisso
      // no fluxo normal — aqui só tratamos passado/hoje.
      let occurredAt = pending.occurred_at as string | undefined;
      const dateHint = extractDateHintSP(inputText);
      if (dateHint && !dateHint.future) occurredAt = dateHint.iso;

      const merged = `${inputText.trim()}${pending.description ? ` · ${pending.description}` : ""}`.slice(0, 240);
      const inferred = pending.kind === "expense"
        ? actionsMod.inferTransactionCategory(`${inputText} ${pending.description ?? ""}`)
        : "Receita";
      const category =
        pending.kind === "expense"
          ? (inferred && inferred !== "Outros" ? inferred : (pending.category ?? "Outros"))
          : "Receita";

      const rec = pending.kind === "expense"
        ? await actionsMod.recordExpense(profile.id, {
            amount: pending.amount, category, description: inputText.trim(), occurred_at: occurredAt,
          })
        : await actionsMod.recordIncome(profile.id, {
            amount: pending.amount, description: inputText.trim(), occurred_at: occurredAt,
          });

      await supabaseAdmin.from("wa_contacts").update({ pending_action: null }).eq("phone", phone);
      const intentTag = pending.kind === "expense" ? "expense_image_followup" : "income_image_followup";
      const { ok: sendOk, result: sendResult } = await sendReplyWithCriticalGuard(replyPhone, rec.replyText, {
        inboundMessageId: row.id,
        userId: profile.id,
        intent: intentTag,
        savedTxId: rec.row?.id ?? null,
      });
      await supabaseAdmin.from("whatsapp_messages").update({
        ai_intent: intentTag,
        ai_meta: { from_image_pending: true, category, occurred_at: occurredAt, merged } as any,
        status: sendOk ? "processed" : "send_error",
      }).eq("id", row.id);
      await supabaseAdmin.from("whatsapp_messages").insert({
        user_id: profile.id, phone: replyPhone, direction: "out", media_type: "text",
        content: rec.replyText, status: sendOk ? "sent" : "send_error", raw: { send: sendResult } as any,
      });
      return { ok: sendOk, status: sendOk ? "processed" : "send_error", intent: intentTag };
    }





    // ===== "Sim / quero / manda" logo após um resumo financeiro =====
    // Abre TODAS as categorias mantendo exatamente o mesmo período consultado.
    if (!imageUrl && !pending && inputText && (lastCtx as any)?.awaiting === "categories"
        && isCategoryFollowUpYes(inputText)) {
      const actionsMod = await import("@/lib/brinzap-actions.server");
      const { sendWhatsAppText } = await import("@/lib/uazapi.server");
      const rep = await actionsMod.buildDetailedFinanceReport(profile.id, (lastCtx as any).period, {
        wantExpense: true, wantIncome: true, wantSummary: false,
        wantBalance: false, wantCategories: true, mode: "categories",
      });
      const sendResult = await sendWhatsAppText(replyPhone, rep.replyText);
      await supabaseAdmin.from("wa_contacts").upsert(
        { phone, name: profile.name ?? null, last_query_context: { period: (lastCtx as any).period, ask: { mode: "categories" }, awaiting: null, at: new Date().toISOString() } },
        { onConflict: "phone" },
      );
      await supabaseAdmin.from("whatsapp_messages").update({
        ai_intent: "query_finance_report",
        ai_meta: { mode: "categories", follow_up: true } as any,
        status: sendResult.ok ? "processed" : "send_error",
      }).eq("id", row.id);
      await supabaseAdmin.from("whatsapp_messages").insert({
        user_id: profile.id, phone: replyPhone, direction: "out", media_type: "text",
        content: rep.replyText, status: sendResult.ok ? "sent" : "send_error", raw: { send: sendResult } as any,
      });
      return { ok: sendResult.ok, status: sendResult.ok ? "processed" : "send_error", intent: "query_finance_report" };
    }

    // ===== Encerramento / small-talk: "ok", "valeu", "beleza", 👍… =====

    // Quando o usuário só está fechando o assunto (sem pendências abertas),
    // respondemos com uma frase de fechamento aleatória e NÃO acionamos
    // classificação, correções nem consultas.
    if (!imageUrl && !pending && inputText && isSmallTalkClose(inputText)) {
      const { sendWhatsAppText } = await import("@/lib/uazapi.server");
      const bye = pickClosingReply();
      const sendResult = await sendWhatsAppText(replyPhone, bye);
      await supabaseAdmin.from("whatsapp_messages").update({
        ai_intent: "small_talk_close",
        ai_meta: { mode: "text", small_talk: true } as any,
        status: sendResult.ok ? "processed" : "send_error",
      }).eq("id", row.id);
      await supabaseAdmin.from("whatsapp_messages").insert({
        user_id: profile.id, phone: replyPhone, direction: "out", media_type: "text",
        content: bye, status: sendResult.ok ? "sent" : "send_error", raw: { send: sendResult } as any,
      });
      return { ok: sendResult.ok, status: sendResult.ok ? "processed" : "send_error", intent: "small_talk_close" };
    }

    // ===== Detecção espontânea: pagamento PARCIAL ou total de conta fixa =====
    // Antes de qualquer criação de despesa, verificamos se o usuário está
    // atualizando uma conta fixa existente ("paguei 200 do aluguel, resta 400",
    // "quitei o aluguel", "abati 300 da internet", "paguei metade da fatura").
    // isSoftFollowupPending: uma pendência de "quer corrigir mais alguma coisa
    // do parcelamento/conta que você acabou de criar" NÃO pode bloquear uma
    // mensagem completamente diferente e clara como "paguei X" — bug real:
    // "Paguei o consórcio" caiu na IA genérica (intent="clarify") porque
    // havia um installment_followup pendente de uma correção anterior.
    if (!imageUrl && (!pending || isSoftFollowupPending) && inputText) {
      const actionsMod = await import("@/lib/brinzap-actions.server");

      // ⚠️ Bug real e grave já observado em produção: "Compra parcelada mudar
      // pro dia 5" foi capturado por detectPreviousEntryEditIntent (que só
      // conhece "a última TRANSAÇÃO") e alterou a data de um comprovante de
      // gás completamente sem relação, só porque a frase também batia com
      // "mudar" + "dia N". Essas três detecções abaixo (0a/0a-2/0b) falam
      // apenas de TRANSAÇÕES — nunca podem roubar uma frase que claramente é
      // sobre QUALQUER outro módulo (parcelamento/conta fixa/consórcio,
      // compromisso/agenda, dívida, meta), ou uma referência numérica à
      // lista de parcelamentos que acabou de ser mostrada ("2 vence dia 15",
      // "corrige o 1 pra R$900"). Nesses casos quem decide é o módulo
      // correspondente — nunca "a última transação".
      // (looksLikeModuleReference já foi calculado mais acima, junto com
      // explicitModuleRef/looksLikeOtherModuleThanAppointment — antes até
      // do fluxo de agenda — mesma trava vale pros dois.)

      // 0a) Edição do lançamento anterior por linguagem natural ("foi ontem",
      //     "muda a data", "isso foi dia 22", "coloca em mercado", "apaga isso").
      //     Tem prioridade ABSOLUTA sobre consulta/relatório — se o usuário
      //     está corrigindo um registro, jamais devolver um relatório.
      const prevEdit = looksLikeModuleReference ? null : actionsMod.detectPreviousEntryEditIntent(inputText);
      if (prevEdit) {
        const { sendWhatsAppText } = await import("@/lib/uazapi.server");
        const r = await actionsMod.applyEditToLastTransaction(profile.id, prevEdit);
        const sendResult = await sendWhatsAppText(replyPhone, r.replyText);
        await supabaseAdmin.from("whatsapp_messages").update({
          ai_intent: "previous_entry_edit",
          ai_meta: { patch: prevEdit } as any,
          status: sendResult.ok ? "processed" : "send_error",
        }).eq("id", row.id);
        await supabaseAdmin.from("whatsapp_messages").insert({
          user_id: profile.id, phone: replyPhone, direction: "out", media_type: "text",
          content: r.replyText, status: sendResult.ok ? "sent" : "send_error", raw: { send: sendResult } as any,
        });
        return { ok: sendResult.ok, status: sendResult.ok ? "processed" : "send_error", intent: "previous_entry_edit" };
      }

      // 0a-2) CORREÇÃO DE VALOR explícita ("não foi sete, foi dezessete",
      //       "corrigindo: 17 reais", "errei, era 17"). Atualiza o último
      //       lançamento — NUNCA cria um novo. Uma ação = uma confirmação.
      const amountFix = looksLikeModuleReference ? null : actionsMod.detectAmountCorrectionIntent(inputText);
      if (amountFix) {
        const { sendWhatsAppText } = await import("@/lib/uazapi.server");
        const r = await actionsMod.correctLastTransaction(profile.id, {
          correction_field: "amount", new_amount: amountFix.newAmount,
        });
        const sendResult = await sendWhatsAppText(replyPhone, r.replyText);
        await supabaseAdmin.from("whatsapp_messages").update({
          ai_intent: "amount_correction",
          ai_meta: { fix: amountFix } as any,
          status: sendResult.ok ? "processed" : "send_error",
        }).eq("id", row.id);
        await supabaseAdmin.from("whatsapp_messages").insert({
          user_id: profile.id, phone: replyPhone, direction: "out", media_type: "text",
          content: r.replyText, status: sendResult.ok ? "sent" : "send_error", raw: { send: sendResult } as any,
        });
        return { ok: sendResult.ok, status: sendResult.ok ? "processed" : "send_error", intent: "amount_correction" };
      }

      // 0b) Pedido de CORREÇÃO / reclamação ("não reconheceu", "ficou errado",
      //    "era R$ 200", "corrigir"): NUNCA executar mudança financeira aqui.
      //    Pedimos esclarecimento antes para evitar duplicidade e erro de valor.
      const correction = looksLikeModuleReference ? null : actionsMod.detectCorrectionRequestIntent(inputText);
      if (correction) {
        const { sendWhatsAppText } = await import("@/lib/uazapi.server");
        const sendResult = await sendWhatsAppText(replyPhone, correction.replyText);
        await supabaseAdmin.from("whatsapp_messages").update({
          ai_intent: "correction_request",
          status: sendResult.ok ? "processed" : "send_error",
        }).eq("id", row.id);
        await supabaseAdmin.from("whatsapp_messages").insert({
          user_id: profile.id, phone: replyPhone, direction: "out", media_type: "text",
          content: correction.replyText, status: sendResult.ok ? "sent" : "send_error", raw: { send: sendResult } as any,
        });
        return { ok: sendResult.ok, status: sendResult.ok ? "processed" : "send_error", intent: "correction_request" };
      }


      // 1) "Paguei as duas", "quitei todas", "zerei tudo", "paguei ambas" —
      // sem valor monetário: quitar TODAS as contas pendentes usando o
      // SALDO RESTANTE de cada uma (nunca o valor original).
      if (actionsMod.detectPayAllBillsIntent(inputText)) {
        const { sendWhatsAppText } = await import("@/lib/uazapi.server");
        const r = await actionsMod.payAllOutstandingBills(profile.id, row.created_at);
        // Mesmo sem contas pendentes respondemos (nunca duplicar despesa já lançada).
        const sendResult = await sendWhatsAppText(replyPhone, r.replyText);
        await supabaseAdmin.from("whatsapp_messages").update({
          ai_intent: "bill_pay_all",
          status: sendResult.ok ? "processed" : "send_error",
        }).eq("id", row.id);
        await supabaseAdmin.from("whatsapp_messages").insert({
          user_id: profile.id, phone: replyPhone, direction: "out", media_type: "text",
          content: r.replyText, status: sendResult.ok ? "sent" : "send_error", raw: { send: sendResult } as any,
        });
        return { ok: sendResult.ok, status: sendResult.ok ? "processed" : "send_error", intent: "bill_pay_all" };
      }

      const partial = actionsMod.detectPartialBillIntent(inputText);

      if (partial) {
        const candidates = await actionsMod.findBillsByHint(profile.id, partial.hint);
        if (candidates.length >= 1) {
          const { sendWhatsAppText } = await import("@/lib/uazapi.server");
          const bill = candidates[0];
          const r = await actionsMod.applyPartialBillPayment(profile.id, bill.id, {
            paidAmount: partial.paidAmount,
            remainingAmount: partial.remainingAmount,
            percentPaid: partial.percentPaid,
            percentRemaining: partial.percentRemaining,
            isFull: partial.isFull,
            notes: inputText,
            occurredAt: row.created_at,
          });
          const sendResult = await sendWhatsAppText(replyPhone, r.replyText);
          await supabaseAdmin.from("whatsapp_messages").update({
            ai_intent: "bill_partial_payment",
            status: sendResult.ok ? "processed" : "send_error",
          }).eq("id", row.id);
          await supabaseAdmin.from("whatsapp_messages").insert({
            user_id: profile.id, phone: replyPhone, direction: "out", media_type: "text",
            content: r.replyText, status: sendResult.ok ? "sent" : "send_error", raw: { send: sendResult } as any,
          });
          return { ok: sendResult.ok, status: sendResult.ok ? "processed" : "send_error", intent: "bill_partial_payment" };
        }
        // Nenhuma conta fixa com esse nome — tenta uma compra parcelada
        // (installment_purchases) antes de desistir. "Paguei o consórcio",
        // "paguei a parcela do Fórum" etc. precisam virar UMA transação real
        // (via RPC atômica), não só marcar um contador — ver
        // payInstallmentPurchase acima (bug real: isso nunca acontecia).
        if (partial.isFull || typeof partial.paidAmount === "number") {
          const purchases = await actionsMod.findInstallmentPurchasesByHint(profile.id, partial.hint);
          if (purchases.length >= 1) {
            const { sendWhatsAppText } = await import("@/lib/uazapi.server");
            const r = await actionsMod.payInstallmentPurchase(profile.id, purchases[0].id, {
              occurredAt: row.created_at,
            });
            const sendResult = await sendWhatsAppText(replyPhone, r.replyText);
            await supabaseAdmin.from("whatsapp_messages").update({
              ai_intent: "installment_payment",
              status: sendResult.ok ? "processed" : "send_error",
            }).eq("id", row.id);
            await supabaseAdmin.from("whatsapp_messages").insert({
              user_id: profile.id, phone: replyPhone, direction: "out", media_type: "text",
              content: r.replyText, status: sendResult.ok ? "sent" : "send_error", raw: { send: sendResult } as any,
            });
            return { ok: sendResult.ok, status: sendResult.ok ? "processed" : "send_error", intent: "installment_payment" };
          }
        }
        // Sem conta nem parcelamento correspondente: NÃO criamos despesa nova
        // aqui. Caímos para o fluxo normal, mas se for claramente pagamento
        // parcial ("resta X"), avisamos o usuário para evitar duplicidade.
        if ((partial.remainingAmount || partial.percentRemaining) && !partial.paidAmount) {
          const { sendWhatsAppText } = await import("@/lib/uazapi.server");
          const msg = "Não encontrei essa conta fixa cadastrada para atualizar o saldo. Se quiser, me diga o *nome exato* da conta (ex.: _paguei 200 do aluguel do carro_) ou cadastre a conta antes.";
          const sendResult = await sendWhatsAppText(replyPhone, msg);
          await supabaseAdmin.from("whatsapp_messages").update({
            ai_intent: "bill_partial_no_match",
            status: sendResult.ok ? "processed" : "send_error",
          }).eq("id", row.id);
          await supabaseAdmin.from("whatsapp_messages").insert({
            user_id: profile.id, phone: replyPhone, direction: "out", media_type: "text",
            content: msg, status: sendResult.ok ? "sent" : "send_error", raw: { send: sendResult } as any,
          });
          return { ok: sendResult.ok, status: sendResult.ok ? "processed" : "send_error", intent: "bill_partial_no_match" };
        }
      }
    }

    // ===== Detecção espontânea: pagamento TOTAL de conta fixa =====
    if (!imageUrl && (!pending || isSoftFollowupPending) && /pag(uei|o|ou|amos)|quit(ei|ado|amos)|efetuado|pagamento (feito|realizado)/i.test(inputText)) {
      const actionsMod = await import("@/lib/brinzap-actions.server");
      const bills = await actionsMod.findPendingBillsForUser(profile.id, inputText);
      if (bills.length > 0) {
        const { sendWhatsAppText } = await import("@/lib/uazapi.server");
        const r = await actionsMod.confirmBillPayments(profile.id, bills.map((b: any) => b.id), row.created_at);
        const sendResult = await sendWhatsAppText(replyPhone, r.replyText);
        await supabaseAdmin.from("whatsapp_messages").update({
          ai_intent: "bill_paid_auto", status: sendResult.ok ? "processed" : "send_error",
        }).eq("id", row.id);
        await supabaseAdmin.from("whatsapp_messages").insert({
          user_id: profile.id, phone: replyPhone, direction: "out", media_type: "text",
          content: r.replyText, status: sendResult.ok ? "sent" : "send_error", raw: { send: sendResult } as any,
        });
        return { ok: sendResult.ok, status: sendResult.ok ? "processed" : "send_error", intent: "bill_paid_auto" };
      }
      // Nenhuma conta fixa "aguardando pagamento" com esse nome — tenta uma
      // compra parcelada (installment_purchases) antes de desistir. Bug real:
      // "Paguei o consórcio" (sem valor) só era reconhecido por ESTE detector
      // (o de pagamento total), não pelo de pagamento parcial — a Fase 7
      // original só tinha corrigido o segundo, deixando esta frase exata cair
      // até o chat genérico sem registrar nada.
      const purchases = await actionsMod.findInstallmentPurchasesByHint(profile.id, inputText);
      if (purchases.length >= 1) {
        const { sendWhatsAppText } = await import("@/lib/uazapi.server");
        const r = await actionsMod.payInstallmentPurchase(profile.id, purchases[0].id, {
          occurredAt: row.created_at,
        });
        const sendResult = await sendWhatsAppText(replyPhone, r.replyText);
        await supabaseAdmin.from("whatsapp_messages").update({
          ai_intent: "installment_payment", status: sendResult.ok ? "processed" : "send_error",
        }).eq("id", row.id);
        await supabaseAdmin.from("whatsapp_messages").insert({
          user_id: profile.id, phone: replyPhone, direction: "out", media_type: "text",
          content: r.replyText, status: sendResult.ok ? "sent" : "send_error", raw: { send: sendResult } as any,
        });
        return { ok: sendResult.ok, status: sendResult.ok ? "processed" : "send_error", intent: "installment_payment" };
      }
    }


    // ===== delete_target_menu pending =====
    // Usuário pediu "apaga isso" sem contexto. Enviamos um menu ("1) despesa,
    // 2) conta fixa..."). Aqui interpretamos a resposta e roteamos para
    // previewDeleteEntry com o target correto — sem executar nada ainda.
    if (pending && pending.kind === "delete_target_menu" && !imageUrl && inputText) {
      const { sendWhatsAppText } = await import("@/lib/uazapi.server");
      const actionsMod = await import("@/lib/brinzap-actions.server");
      const t = normalized;
      let chosen: import("@/lib/brinzap-actions.server").DeleteTarget | null = null;
      if (/^1\b|\b(despesa|gasto|[uú]ltim[oa]\s+(despesa|gasto|lan[çc]amento))\b/.test(t)) chosen = "transaction";
      else if (/^2\b|\b(conta\s+fixa|conta\s+mensal|assinatura|mensalidade|aluguel)\b/.test(t)) chosen = "bill";
      else if (/^3\b|\b(lembrete|compromisso|consulta|reuni[ãa]o|evento|agenda)\b/.test(t)) chosen = "appointment";
      else if (/^4\b|\b(d[íi]vida|empr[ée]stimo|devo)\b/.test(t)) chosen = "debt";
      else if (/^5\b|\b(meta|objetivo)\b/.test(t)) chosen = "goal";
      else if (/^6\b|\b(parcelamento|parcela)\b/.test(t)) chosen = "installment";
      else if (/^(cancelar|cancela|deixa|nada|esquece|nao|não|voltar)$/i.test(t)) {
        await supabaseAdmin.from("wa_contacts").update({ pending_action: null }).eq("phone", phone);
        const cancelReply = "👍 Ok, não vou apagar nada.";
        const sendResult = await sendWhatsAppText(replyPhone, cancelReply);
        await supabaseAdmin.from("whatsapp_messages").update({
          ai_intent: "delete_target_cancel", status: sendResult.ok ? "processed" : "send_error",
        }).eq("id", row.id);
        await supabaseAdmin.from("whatsapp_messages").insert({
          user_id: profile.id, phone: replyPhone, direction: "out", media_type: "text",
          content: cancelReply, status: sendResult.ok ? "sent" : "send_error", raw: { send: sendResult } as any,
        });
        return { ok: sendResult.ok, status: sendResult.ok ? "processed" : "send_error", intent: "delete_target_cancel" };
      }

      if (chosen) {
        // Reaproveita hint textual do próprio input (permite "conta fixa da luz")
        const hint = t
          .replace(/^\s*[1-6]\s*\)?\s*/, "")
          .replace(/\b(despesa|gasto|conta\s+fixa|assinatura|mensalidade|lembrete|compromisso|consulta|reuni[ãa]o|evento|d[íi]vida|empr[ée]stimo|meta|objetivo|parcelamento|parcela)\b/gi, " ")
          .replace(/\s+/g, " ").trim();
        const preview = await actionsMod.previewDeleteEntry(profile.id, { target: chosen, hint });
        if (preview.pending) {
          await supabaseAdmin.from("wa_contacts").upsert(
            { phone, name: profile.name ?? null, pending_action: preview.pending },
            { onConflict: "phone" },
          );
        } else {
          await supabaseAdmin.from("wa_contacts").update({ pending_action: null }).eq("phone", phone);
        }
        const sendResult = await sendWhatsAppText(replyPhone, preview.replyText);
        await supabaseAdmin.from("whatsapp_messages").update({
          ai_intent: "delete_target_menu_reply", status: sendResult.ok ? "processed" : "send_error",
        }).eq("id", row.id);
        await supabaseAdmin.from("whatsapp_messages").insert({
          user_id: profile.id, phone: replyPhone, direction: "out", media_type: "text",
          content: preview.replyText, status: sendResult.ok ? "sent" : "send_error", raw: { send: sendResult } as any,
        });
        return { ok: sendResult.ok, status: sendResult.ok ? "processed" : "send_error", intent: "delete_target_menu_reply" };
      }
      // Resposta não reconhecida — reforça o menu sem executar nada.
      const retryText =
        "🤔 Não entendi. Responde só com o *número* (1 a 6) ou o *tipo* (ex.: _conta fixa_, _despesa_, _lembrete_)…\n\n" +
        "Ou envie *cancelar* para deixar assim.";
      const sendResult = await sendWhatsAppText(replyPhone, retryText);
      await supabaseAdmin.from("whatsapp_messages").update({
        ai_intent: "delete_target_menu_retry", status: sendResult.ok ? "processed" : "send_error",
      }).eq("id", row.id);
      await supabaseAdmin.from("whatsapp_messages").insert({
        user_id: profile.id, phone: replyPhone, direction: "out", media_type: "text",
        content: retryText, status: sendResult.ok ? "sent" : "send_error", raw: { send: sendResult } as any,
      });
      return { ok: sendResult.ok, status: sendResult.ok ? "processed" : "send_error", intent: "delete_target_menu_retry" };
    }

    // ===== delete_confirmation pending (exclusão de lançamento/conta/lembrete) =====
    if (pending && pending.kind === "delete_confirmation" && !imageUrl) {

      const { sendWhatsAppText } = await import("@/lib/uazapi.server");
      const actionsMod = await import("@/lib/brinzap-actions.server");
      let replyText = "";
      let handled = true;
      if (YES_RE.test(normalized) || /^(pode\s+(apagar|excluir|deletar|remover)|confirmo|isso\s+mesmo|manda\s+ver|apaga|deleta|exclui)$/i.test(normalized)) {
        const r = await actionsMod.confirmDeleteEntry(profile.id, { target: pending.target, id: pending.id, label: pending.label });
        replyText = r.replyText;
        await supabaseAdmin.from("wa_contacts").update({ pending_action: null }).eq("phone", phone);
      } else if (NO_RE.test(normalized) || /^(deixa|deixa\s+assim|mant[eé]m|manter|continua|continuar|nada)$/i.test(normalized)) {
        replyText = "👍 Tudo bem, não excluí nada. Seus dados foram mantidos.";
        await supabaseAdmin.from("wa_contacts").update({ pending_action: null }).eq("phone", phone);
      } else {
        handled = false;
      }
      if (handled) {
        const sendResult = await sendWhatsAppText(replyPhone, replyText);
        await supabaseAdmin.from("whatsapp_messages").update({
          ai_intent: "delete_confirmation_reply", status: sendResult.ok ? "processed" : "send_error",
        }).eq("id", row.id);
        await supabaseAdmin.from("whatsapp_messages").insert({
          user_id: profile.id, phone: replyPhone, direction: "out", media_type: "text",
          content: replyText, status: sendResult.ok ? "sent" : "send_error", raw: { send: sendResult } as any,
        });
        return { ok: sendResult.ok, status: sendResult.ok ? "processed" : "send_error", intent: "delete_confirmation_reply" };
      }
    }

    // ===== Detecção espontânea: EXCLUSÃO em linguagem natural =====
    // "esquece essa conta", "tira isso pra mim", "apaga esse gasto", "remove
    // essa dívida", "cancela essa conta", "não considera isso", "joga fora
    // essa conta", "risca essa conta", "deleta esse lembrete", "elimina isso"…
    if (!imageUrl && !pending && inputText) {
      const actionsMod = await import("@/lib/brinzap-actions.server");
      const del = actionsMod.detectDeleteIntent(inputText);
      if (del) {
        const { sendWhatsAppText } = await import("@/lib/uazapi.server");
        const preview = await actionsMod.previewDeleteEntry(profile.id, del);
        if (preview.pending) {
          await supabaseAdmin.from("wa_contacts").upsert(
            { phone, name: profile.name ?? null, pending_action: preview.pending },
            { onConflict: "phone" },
          );
        }
        const sendResult = await sendWhatsAppText(replyPhone, preview.replyText);
        await supabaseAdmin.from("whatsapp_messages").update({
          ai_intent: "delete_request", status: sendResult.ok ? "processed" : "send_error",
        }).eq("id", row.id);
        await supabaseAdmin.from("whatsapp_messages").insert({
          user_id: profile.id, phone: replyPhone, direction: "out", media_type: "text",
          content: preview.replyText, status: sendResult.ok ? "sent" : "send_error", raw: { send: sendResult } as any,
        });
        return { ok: sendResult.ok, status: sendResult.ok ? "processed" : "send_error", intent: "delete_request" };
      }
    }

    // ===== REFERÊNCIA NUMÉRICA A "Seus parcelamentos" =====
    // Depois de "quero ver meus parcelamentos" (lista numerada 1, 2, 3...),
    // "2 vence dia 15" ou "corrige o 1 pra 900" tem que resolver sozinho pro
    // item certo — sem o usuário repetir o nome. Vale por texto ou áudio
    // (chega aqui como texto normal, já transcrito) e não expira por
    // pending_action (é memória leve, não trava nenhum outro fluxo).
    if (!imageUrl && inputText && inputText.trim() && lastCtx?.installments_list?.length) {
      const listAgeMin = lastCtx.at ? (Date.now() - new Date(lastCtx.at).getTime()) / 60000 : Infinity;
      if (listAgeMin <= 30) {
        const leadingMatch = normalized.match(/^(\d{1,2})\b/);
        const connectorMatch = normalized.match(/\b(?:o|a|item|numero|número|parcelamento)\s+(\d{1,2})\b/);
        const refMatch = leadingMatch ?? connectorMatch;
        const n = refMatch ? parseInt(refMatch[1], 10) : NaN;
        const target = lastCtx.installments_list.find((it: any) => it.n === n);
        if (target) {
          const { parseBillFollowUp } = await import("@/lib/bill-installments");
          const patch = parseBillFollowUp(inputText);
          if (patch) {
            const res = target.kind === "installment"
              ? await actions.applyInstallmentFollowUp(profile.id, target.id, patch)
              : await actions.applyBillInstallmentFollowUp(profile.id, target.id, patch);
            if (res.ok) {
              const sendResult = await sendWhatsAppText(replyPhone, res.replyText);
              await supabaseAdmin.from("whatsapp_messages").update({
                ai_intent: "installment_list_ref", status: sendResult.ok ? "processed" : "send_error",
              }).eq("id", row.id);
              await supabaseAdmin.from("whatsapp_messages").insert({
                user_id: profile.id, phone: replyPhone, direction: "out", media_type: "text",
                content: res.replyText, status: sendResult.ok ? "sent" : "send_error", raw: { send: sendResult } as any,
              });
              return { ok: sendResult.ok, status: sendResult.ok ? "processed" : "send_error", intent: "installment_list_ref" };
            }
          }
        }
      }
    }

    // ===== COMPLEMENTO DE CONTA/PARCELAMENTO RECÉM-CRIADO =====
    // "220 parcelas", "todo dia 15", "já paguei 10", "corrige pra 850",
    // "na verdade são 12 parcelas" → atualizam o registro do contexto em vez
    // de virar consulta ou um lançamento novo. Mesmo parser serve para conta
    // fixa com prazo (recurring_bills) e compra parcelada (installment_purchases)
    // — só muda qual tabela recebe o patch.
    if (!imageUrl && inputText && inputText.trim()) {
      const { parseBillFollowUp } = await import("@/lib/bill-installments");
      const isBillPending = pending?.kind === "bill_followup" && !!pending.bill_id;
      const isInstallmentPending = pending?.kind === "installment_followup" && !!pending.installment_id;
      const patch = parseBillFollowUp(inputText, isBillPending ? pending.total ?? null : null);
      // Um valor monetário solto (sem verbo de correção) fica ambíguo com um
      // lançamento novo — só passa se vier de um verbo explícito de correção
      // (é isso que preenche patch.amount) ou já houver uma pendência ativa.
      const hasMoneyMarker = /r\$|reais|\b\d{1,3}(?:\.\d{3})*,\d{2}\b/i.test(inputText);
      const moneyOk = !hasMoneyMarker || patch?.amount != null || isBillPending || isInstallmentPending;
      // "corrige pra 850" sem NENHUMA pendência ativa fica ambíguo com corrigir
      // o último lançamento (fluxo já existente via kind="correction" na IA) —
      // só tratamos um valor corrigido como complemento de conta/parcelamento
      // quando já existe uma pendência explícita apontando pra ela; total de
      // parcelas e dia de vencimento seguem podendo disparar "a frio" (não são
      // ambíguos com um lançamento novo).
      const meaningful = !!patch && (isBillPending || isInstallmentPending
        || patch.total_installments != null || patch.payment_day != null);
      if (meaningful && moneyOk) {
        const actions = await import("@/lib/brinzap-actions.server");

        if (isInstallmentPending) {
          const { data } = await supabaseAdmin
            .from("installment_purchases").select("*")
            .eq("id", pending.installment_id).eq("user_id", profile.id).maybeSingle();
          if (data) {
            console.info("[wa-processor] stage=installment_followup", { installmentId: data.id, patch });
            const res = await actions.applyInstallmentFollowUp(profile.id, data.id, patch!);
            if (res.ok) {
              await supabaseAdmin.from("wa_contacts").upsert(
                {
                  phone, name: profile.name ?? null,
                  pending_action: {
                    kind: "installment_followup", installment_id: data.id, title: data.title,
                    expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
                  } as any,
                },
                { onConflict: "phone" },
              );
              const sendResult = await sendWhatsAppText(replyPhone, res.replyText);
              await supabaseAdmin.from("whatsapp_messages").update({
                ai_intent: "installment_followup", status: sendResult.ok ? "processed" : "send_error",
              }).eq("id", row.id);
              await supabaseAdmin.from("whatsapp_messages").insert({
                user_id: profile.id, phone: replyPhone, direction: "out", media_type: "text",
                content: res.replyText, status: sendResult.ok ? "sent" : "send_error", raw: { send: sendResult } as any,
              });
              return { ok: sendResult.ok, status: sendResult.ok ? "processed" : "send_error", intent: "installment_followup" };
            }
          }
        } else {
          let bill: any = null;
          if (isBillPending) {
            const { data } = await supabaseAdmin
              .from("recurring_bills").select("*")
              .eq("id", pending.bill_id).eq("user_id", profile.id).maybeSingle();
            bill = data ?? null;
          }
          if (!bill) bill = await actions.findRecentBillForFollowUp(profile.id, normalized);
          // Nenhuma conta fixa recente combina: tenta um parcelamento recente
          // antes de desistir (só quando não há pendência de conta explícita).
          let inst: any = null;
          if (!bill && !isBillPending) inst = await actions.findRecentInstallmentForFollowUp(profile.id, normalized);

          if (bill) {
            console.info("[wa-processor] stage=bill_followup", { billId: bill.id, patch });
            const res = await actions.applyBillInstallmentFollowUp(profile.id, bill.id, patch!);
            if (res.ok) {
              await supabaseAdmin.from("wa_contacts").upsert(
                {
                  phone,
                  name: profile.name ?? null,
                  pending_action: {
                    kind: "bill_followup",
                    bill_id: bill.id,
                    title: bill.title,
                    total: patch!.total_installments ?? bill.total_installments ?? null,
                    expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
                  } as any,
                },
                { onConflict: "phone" },
              );
              const sendResult = await sendWhatsAppText(replyPhone, res.replyText);
              await supabaseAdmin.from("whatsapp_messages").update({
                ai_intent: "bill_followup", status: sendResult.ok ? "processed" : "send_error",
              }).eq("id", row.id);
              await supabaseAdmin.from("whatsapp_messages").insert({
                user_id: profile.id, phone: replyPhone, direction: "out", media_type: "text",
                content: res.replyText, status: sendResult.ok ? "sent" : "send_error", raw: { send: sendResult } as any,
              });
              return { ok: sendResult.ok, status: sendResult.ok ? "processed" : "send_error", intent: "bill_followup" };
            }
          } else if (inst) {
            console.info("[wa-processor] stage=installment_followup", { installmentId: inst.id, patch });
            const res = await actions.applyInstallmentFollowUp(profile.id, inst.id, patch!);
            if (res.ok) {
              await supabaseAdmin.from("wa_contacts").upsert(
                {
                  phone, name: profile.name ?? null,
                  pending_action: {
                    kind: "installment_followup", installment_id: inst.id, title: inst.title,
                    expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
                  } as any,
                },
                { onConflict: "phone" },
              );
              const sendResult = await sendWhatsAppText(replyPhone, res.replyText);
              await supabaseAdmin.from("whatsapp_messages").update({
                ai_intent: "installment_followup", status: sendResult.ok ? "processed" : "send_error",
              }).eq("id", row.id);
              await supabaseAdmin.from("whatsapp_messages").insert({
                user_id: profile.id, phone: replyPhone, direction: "out", media_type: "text",
                content: res.replyText, status: sendResult.ok ? "sent" : "send_error", raw: { send: sendResult } as any,
              });
              return { ok: sendResult.ok, status: sendResult.ok ? "processed" : "send_error", intent: "installment_followup" };
            }
          }
        }
      }
    }


    // bill_day pending
    if (pending && pending.kind === "bill_day" && !imageUrl) {
      const m = normalized.match(/\b([0-3]?\d)\b/);
      const day = m ? parseInt(m[1], 10) : NaN;
      let billReply = "";
      if (day >= 1 && day <= 31) {
        const r = await (await import("@/lib/brinzap-actions.server")).recordBill(profile.id, { ...pending.draft, due_day: day });
        billReply = r.replyText;
        if (r.ok && r.billId) {
          await supabaseAdmin.from("wa_contacts").upsert(
            {
              phone, name: profile.name ?? null,
              pending_action: { kind: "bill_followup", bill_id: r.billId, title: pending.draft?.title ?? null, total: pending.draft?.total_installments ?? null, expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString() } as any,
            },
            { onConflict: "phone" });
        } else {
          await supabaseAdmin.from("wa_contacts").update({ pending_action: null }).eq("phone", phone);
        }
      } else {

        billReply = "Hmm, não captei o dia. Me responde apenas o número do dia do vencimento (ex.: *10*, *15*, *30*).";
      }
      const sendResult = await sendWhatsAppText(replyPhone, billReply);
      await supabaseAdmin.from("whatsapp_messages").update({
        ai_intent: "bill_day_reply", status: sendResult.ok ? "processed" : "send_error",
      }).eq("id", row.id);
      await supabaseAdmin.from("whatsapp_messages").insert({
        user_id: profile.id, phone: replyPhone, direction: "out", media_type: "text",
        content: billReply, status: sendResult.ok ? "sent" : "send_error", raw: { send: sendResult } as any,
      });
      return { ok: sendResult.ok, status: sendResult.ok ? "processed" : "send_error", intent: "bill_day_reply" };
    }

    // installment_draft pending — parcelamento com valor/quantidade/total
    // ambíguo: a próxima mensagem responde SÓ o campo perguntado, o resto do
    // rascunho é preservado (mesmo mecanismo pro áudio já transcrito: chega
    // aqui como texto normal, sem tratamento especial por origem).
    if (pending && pending.kind === "installment_draft" && !imageUrl) {
      const actionsMod = await import("@/lib/brinzap-actions.server");
      const draft = { ...(pending.draft ?? {}) };
      let instReply = "";
      let resolved = false;

      if (pending.missing === "confirm") {
        if (YES_RE.test(normalized)) resolved = true;
        else if (NO_RE.test(normalized)) {
          instReply = "👍 Ok, não salvei esse parcelamento.";
          await supabaseAdmin.from("wa_contacts").update({ pending_action: null }).eq("phone", phone);
        } else {
          instReply = `Só preciso confirmar: posso salvar ${draft.installments_total} parcelas de ${formatMoneyBR(Number(draft.amount))} (total ${formatMoneyBR(Number(draft.amount) * Number(draft.installments_total))})? Responda *sim* ou *não*.`;
        }
      } else if (pending.missing === "amount" || pending.missing === "reconcile") {
        const found = actionsMod.moneyMatches(inputText)[0];
        if (found) {
          draft.amount = found.amount;
          draft.total_amount = undefined;
          resolved = true;
        } else {
          instReply = "Não captei o valor. Pode mandar só o número (ex.: *1000*)?";
        }
      } else if (pending.missing === "installments_total") {
        const m = normalized.match(/\b(\d{1,4})\b/);
        const n = m ? parseInt(m[1], 10) : NaN;
        if (n >= 1 && n <= 2000) { draft.installments_total = n; resolved = true; }
        else instReply = "Não captei a quantidade. Pode mandar só o número de parcelas (ex.: *10*)?";
      } else if (pending.missing === "title") {
        const t = (inputText || "").trim().replace(/[.!]+$/, "").slice(0, 80);
        if (t && t.length >= 2) { draft.title = t; resolved = true; }
        else instReply = "Não captei o nome. Do que é essa compra parcelada?";
      }

      if (resolved) {
        const res = await actionsMod.recordInstallment(profile.id, draft);
        instReply = res.replyText;
        if (res.ok && res.row) {
          await supabaseAdmin.from("wa_contacts").upsert(
            {
              phone, name: profile.name ?? null,
              pending_action: {
                kind: "installment_followup", installment_id: res.row.id, title: draft.title,
                expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
              } as any,
            },
            { onConflict: "phone" });
        } else {
          await supabaseAdmin.from("wa_contacts").update({ pending_action: null }).eq("phone", phone);
        }
      } else if (instReply && pending.missing !== "confirm") {
        // Mantém o rascunho vivo pra próxima tentativa.
        await supabaseAdmin.from("wa_contacts").upsert(
          { phone, name: profile.name ?? null, pending_action: { ...pending, draft } as any },
          { onConflict: "phone" },
        );
      }

      const sendResult = await sendWhatsAppText(replyPhone, instReply);
      await supabaseAdmin.from("whatsapp_messages").update({
        ai_intent: "installment_draft_reply", status: sendResult.ok ? "processed" : "send_error",
      }).eq("id", row.id);
      await supabaseAdmin.from("whatsapp_messages").insert({
        user_id: profile.id, phone: replyPhone, direction: "out", media_type: "text",
        content: instReply, status: sendResult.ok ? "sent" : "send_error", raw: { send: sendResult } as any,
      });
      return { ok: sendResult.ok, status: sendResult.ok ? "processed" : "send_error", intent: "installment_draft_reply" };
    }

    // ===== MODO CONSULTOR FINANCEIRO ("Conversa com meu financeiro") =====
    // Ativa por frase-gatilho OU se já existe pending_action.kind === "advisor_chat".
    // Enquanto ativo NÃO registra nada: apenas conversa usando o histórico financeiro completo.
    {
      const { ADVISOR_TRIGGER_RE, ADVISOR_EXIT_RE, buildFinancialSnapshot } = await import("@/lib/advisor.server");
      const inAdvisor = pending && pending.kind === "advisor_chat";
      const wantsAdvisor = !imageUrl && !!inputText && ADVISOR_TRIGGER_RE.test(inputText);

      if (inAdvisor && ADVISOR_EXIT_RE.test((inputText || "").trim())) {
        await supabaseAdmin.from("wa_contacts").update({ pending_action: null }).eq("phone", phone);
        const bye = "Fechado! Saímos do modo consultor. Já pode me mandar seus lançamentos normalmente. 👍";
        const sendResult = await sendWhatsAppText(replyPhone, bye);
        await supabaseAdmin.from("whatsapp_messages").update({
          ai_intent: "advisor_exit", status: sendResult.ok ? "processed" : "send_error",
        }).eq("id", row.id);
        await supabaseAdmin.from("whatsapp_messages").insert({
          user_id: profile.id, phone: replyPhone, direction: "out", media_type: "text",
          content: bye, status: sendResult.ok ? "sent" : "send_error", raw: { send: sendResult } as any,
        });
        return { ok: sendResult.ok, status: sendResult.ok ? "processed" : "send_error", intent: "advisor_exit" };
      }

      // PDF/imagem tem PRIORIDADE: mesmo no modo consultor, um documento anexado
      // precisa ser lido e lançado. A sessão de consultor permanece ativa.
      if ((inAdvisor && !imageUrl) || wantsAdvisor) {
        const { advisorReply } = await import("@/lib/ai-classify.server");
        const snap = await buildFinancialSnapshot(profile.id);

        // Renova a "sessão" de consultor por 30 minutos.
        const expiresIn30min = new Date(Date.now() + 30 * 60 * 1000).toISOString();
        await supabaseAdmin.from("wa_contacts").upsert(
          { phone, name: profile.name ?? null, pending_action: { kind: "advisor_chat", expires_at: expiresIn30min } },
          { onConflict: "phone" },
        );

        let replyText: string;
        if (wantsAdvisor && !inAdvisor) {
          const intro = snap.hasData
            ? `Modo *consultor financeiro* ativado 💬\nVou analisar seu histórico completo e conversar com você. Pergunte qualquer coisa: onde gasta mais, como economizar, comparar meses, criar metas...\nPara sair, diga *sair*.\n\n`
            : `Modo *consultor financeiro* ativado 💬\nAinda não tenho histórico suficiente pra fazer análises profundas. Continue registrando suas movimentações — assim posso te dar conselhos precisos.\nPara sair, diga *sair*.\n\n`;
          const first = await advisorReply(inputText, profile.name, snap.summary, history);
          replyText = intro + first;
        } else {
          replyText = await advisorReply(inputText || "(sem texto)", profile.name, snap.summary, history);
        }

        const sendResult = await sendWhatsAppText(replyPhone, replyText);
        await supabaseAdmin.from("whatsapp_messages").update({
          transcription: audioUrl ? inputText : null,
          ai_intent: "advisor_chat",
          ai_meta: { model: "openai", mode: imageUrl ? "image" : audioUrl ? "audio" : "text", advisor: true } as any,
          status: sendResult.ok ? "processed" : "send_error",
        }).eq("id", row.id);
        await supabaseAdmin.from("whatsapp_messages").insert({
          user_id: profile.id, phone: replyPhone, direction: "out", media_type: "text",
          content: replyText, status: sendResult.ok ? "sent" : "send_error", raw: { send: sendResult } as any,
        });
        return { ok: sendResult.ok, status: sendResult.ok ? "processed" : "send_error", intent: "advisor_chat" };
      }
    }


    let intent: any;
    let aiMs = 0;
    // (!pending || isSoftFollowupPending): mesma tolerância de acima — uma
    // pendência opcional de "corrigir mais alguma coisa do parcelamento/
    // conta recém-criado" nunca pode bloquear o reconhecimento de uma
    // mensagem nova e sem relação (ex.: "Gastei 50 no mercado" logo depois
    // de corrigir um parcelamento).
    const smartParsed = ((!pending || isSoftFollowupPending) && !imageUrl)
      ? actions.parseSmartFinancialMessage(inputText) : null;

    // REGRA CRÍTICA — Registro tem prioridade absoluta sobre consulta.
    // Se o texto contém verbo claro de lançamento (gastei/paguei/comprei/recebi/…)
    // com valor monetário, NÃO roteia para relatório mesmo que exista referência
    // temporal ("ontem", "semana passada"). "Gastei 79 ontem" precisa registrar,
    // não gerar relatório do período.
    const spontHit = ((!pending || isSoftFollowupPending) && !imageUrl)
      ? actions.detectSpontaneousExpenseIntent(inputText || "")
      : null;
    const bulkFinancialHit = !!(smartParsed?.ok && smartParsed.items.length >= 1);

    // Detecção determinística de consultas por módulo — SEMPRE antes da IA,
    // para garantir que perguntas sobre contas fixas, dívidas, metas, hábitos etc.
    // consultem o módulo correto no banco (nunca respondem via Agenda).
    const moduleQuery = ((!pending || isSoftFollowupPending) && !imageUrl && !spontHit && !bulkFinancialHit)
      ? detectModuleQueryIntent(inputText, lastCtx) : null;

    // Metadados do anexo lido nesta mensagem (hash, texto, OCR, operação).
    let docMeta: Record<string, any> | null = null;

    // Todo anexo novo inicia contexto próprio. Nunca reaproveita valor, categoria
    // ou descrição de uma pendência financeira anterior.
    if ((isDocument || extracted.imageUrl) && pending) {
      await supabaseAdmin.from("wa_contacts").update({ pending_action: null }).eq("phone", phone);
      pending = null;
    }

    // ===== DOCUMENTO PENDENTE =====
    // PDF lido mas sem descrição/valor claro fica pendente; a próxima mensagem
    // de texto do usuário completa o lançamento ("foi crédito no BibCar").
    const pendingDoc: any = (!isDocument && !extracted.imageUrl &&
      (pending?.kind === "document_pending" || pending?.kind === "attachment_pending")) ? pending : null;
    const isBareQuestionMark = /^\?+$/.test((inputText || "").trim());

    if (pendingDoc && isBareQuestionMark) {
      docMeta = pendingDoc.doc ?? null;
      intent = { kind: "document_pending_reminder", doc: pendingDoc.doc, entry: pendingDoc.entry };
    } else if (pendingDoc && !NO_RE.test(normalized) && (inputText || "").trim().length >= 2) {
      const base = pendingDoc.entry ?? {};
      docMeta = pendingDoc.doc ?? null;
      const captionAmount = extractCaptionAmount(inputText || "");
      // Anexo pendente com OCR: a próxima mensagem é interpretada JUNTO com o
      // texto lido na imagem/documento ("agenda pra mim" após um convite).
      const ocrText = String(pendingDoc.ocr_text ?? "").trim();
      let combined: any = null;
      if (ocrText) {
        try {
          combined = await classifyMessage(
            `Texto extraído do anexo enviado antes:\n${ocrText.slice(0, 3000)}\n\nMensagem do usuário agora: ${inputText}`,
            history,
          );
        } catch (e) {
          console.error("[wa-processor][pending] combined classify failed", e);
        }
      }
      if (combined && ["appointment", "expense", "income", "bill", "installment", "bulk"].includes(String(combined.kind))) {
        intent = { ...combined, __from_pending_doc: true } as any;
        if ((intent.kind === "expense" || intent.kind === "income") && !(Number(intent.amount) > 0) && Number(base.amount) > 0) {
          intent.amount = Number(base.amount);
        }
      } else {
        intent = {
          kind: base.kind === "income" ? "income" : "expense",
          amount: Number(base.amount) > 0 ? Number(base.amount) : (captionAmount ?? 0),
          category: base.category,
          description: (inputText || "").trim().slice(0, 80),
          occurred_at: base.occurred_at,
          __from_pending_doc: true,
        } as any;
      }
      await supabaseAdmin.from("wa_contacts").update({ pending_action: null }).eq("phone", phone);

    } else if (pending && !imageUrl && YES_RE.test(normalized)) {
      intent = { kind: "confirm_yes" };
    } else if (pending && !imageUrl && NO_RE.test(normalized)) {

      intent = { kind: "confirm_no" };
    } else if (moduleQuery) {
      intent = moduleQuery;
    } else if (smartParsed && !smartParsed.ok) {
      intent = { kind: "financial_validation_error", replyText: smartParsed.replyText };
    } else if (smartParsed?.ok && smartParsed.items.length >= 2) {
      // Evidência obrigatória: só mantém múltiplos lançamentos se a mensagem
      // realmente trouxer múltiplos valores. Caso contrário colapsa ou pergunta.
      const guarded = actions.guardSplitByEvidence(inputText || "", smartParsed.items as any);
      intent = guarded.ok
        ? (guarded.items.length >= 2
            ? { kind: "bulk", items: guarded.items }
            : { ...guarded.items[0], kind: guarded.items[0].kind })
        : { kind: "financial_validation_error", replyText: guarded.replyText };

    } else if (smartParsed?.ok && smartParsed.items.length === 1) {
      // Frases telegráficas com descrição + valor ("Mercado 180", "Uber 32",
      // "Luz 300") já estão completas. Executa o parser determinístico e não
      // deixa a IA transformar categoria/descrição opcionais em nova pergunta.
      const item = smartParsed.items[0];
      intent = { ...item, kind: item.kind };


    } else {
      const t0 = Date.now();
      try {
        if (isDocument && !documentUrl) {
          console.error("[wa-processor][doc] stage=media_url_missing", { msg: row.id, rawMessageId: row.raw_message_id });
          intent = { kind: "document_fetch_failed", reason: "DOC_URL_MISSING" };
        } else if (isDocument && documentUrl) {
          // ===== PIPELINE DE DOCUMENTO =====
          // baixar -> validar -> extrair texto -> OCR (fallback visual) -> IA
          const {
            fetchDocument, extractPdfText, extractScannedPdfText, extractImageText, hasUsefulText, extractOperationId,
            extractReceiptAmount, extractReceiptDate, extractInstitution,
            resolveDocKind, extractXlsxText, extractDocxText, extractPlainText,
          } = await import("@/lib/pdf-doc.server");
          console.log("[wa-processor][doc] stage=received", {
            msg: row.id, filename: documentName ?? null, mime: documentMime ?? null,
          });
          const fetched = await fetchDocument(documentUrl, documentMime);
          if ((documentMime?.toLowerCase().includes("pdf") || documentName?.toLowerCase().endsWith(".pdf")) && !fetched.isPdf) {
            throw new Error("DOC_CORRUPTED");
          }
          const docKind = await resolveDocKind(fetched, documentName, documentMime);
          console.log("[wa-processor][doc] stage=kind_resolved", { msg: row.id, docKind });
          let docText = "";
          let pages = 0;
          let usedOcr = false;
          let docMimeResolved = fetched.mime;
          if (docKind === "pdf") {
            const ex = await extractPdfText(fetched.bytes);
            docText = ex.text; pages = ex.pages;
            if (!hasUsefulText(docText)) {
              console.log("[wa-processor][doc] stage=ocr_required", { msg: row.id, pages });
              docText = await extractScannedPdfText(fetched.bytes, documentName ?? "documento.pdf");
              usedOcr = true;
              console.log("[wa-processor][doc] stage=ocr_completed", { msg: row.id, chars: docText.length });
            }
          } else if (docKind === "image") {
            // Comprovante/nota enviado como "documento" mas que é imagem:
            // segue exatamente o mesmo caminho de OCR das imagens.
            try {
              docText = await extractImageText(fetched.bytes, fetched.mime);
              usedOcr = true;
              console.log("[wa-processor][doc] stage=image_ocr_completed", { msg: row.id, chars: docText.length });
            } catch (e: any) {
              console.warn("[wa-processor][doc] image ocr failed", e?.message ?? e);
            }
          } else if (docKind === "xlsx") {
            try {
              docText = await extractXlsxText(fetched.bytes);
              docMimeResolved = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
              console.log("[wa-processor][doc] stage=xlsx_extracted", { msg: row.id, chars: docText.length });
            } catch (e: any) {
              console.warn("[wa-processor][doc] xlsx extraction failed", e?.message ?? e);
            }
          } else if (docKind === "docx") {
            try {
              docText = await extractDocxText(fetched.bytes);
              docMimeResolved = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
              console.log("[wa-processor][doc] stage=docx_extracted", { msg: row.id, chars: docText.length });
            } catch (e: any) {
              console.warn("[wa-processor][doc] docx extraction failed", e?.message ?? e);
            }
          } else if (docKind === "csv" || docKind === "txt") {
            docText = extractPlainText(fetched.bytes);
            docMimeResolved = docKind === "csv" ? "text/csv" : "text/plain";
            console.log("[wa-processor][doc] stage=text_extracted", { msg: row.id, docKind, chars: docText.length });
          }
          const opId = docText ? extractOperationId(docText) : null;
          // Fatos oficiais do comprovante (determinísticos, antes da IA).
          const receiptAmount = docText ? extractReceiptAmount(docText) : null;
          const receiptDate = docText ? extractReceiptDate(docText) : null;
          const institution = docText ? extractInstitution(docText) : null;
          docMeta = {
            hash: fetched.hash, size: fetched.size, mime: docMimeResolved,
            filename: documentName ?? null, text_chars: docText.length,
            pages, ocr: usedOcr, operation_id: opId,
            receipt_amount: receiptAmount, receipt_date: receiptDate, institution,
          };
          console.log("[wa-processor][doc] stage=extracted", docMeta);

          // Planilha/Word/CSV/TXT não têm um fallback de leitura visual (ao contrário de
          // imagem/PDF escaneado): se a extração de texto falhou, não adianta mandar os
          // bytes crus pra IA — melhor avisar o usuário direto.
          const extractionFailed = (docKind === "xlsx" || docKind === "docx" || docKind === "csv" || docKind === "txt") && !docText;
          if ((docKind === "unknown" && !docText) || extractionFailed) {
            console.warn("[wa-processor][doc] stage=format_unsupported", { msg: row.id, docKind, extractionFailed, filename: documentName ?? null, mime: documentMime ?? null });
            intent = { kind: extractionFailed ? "document_corrupted" : "document_format_unsupported" };
          } else {
            // Duplicidade: mesmo arquivo (hash) ou mesma operação já registrada.
            const { data: dupRows } = await supabaseAdmin
              .from("whatsapp_messages")
              .select("id, ai_intent, ai_meta, created_at")
              .eq("user_id", profile.id)
              .eq("direction", "in")
              .neq("id", row.id)
              .order("created_at", { ascending: false })
              .limit(80);
            const alreadyRegistered = (dupRows ?? []).some((m: any) => {
              const att = m?.ai_meta?.attachment;
              if (!att) return false;
              const sameFile = att.hash && att.hash === fetched.hash;
              const sameOp = opId && att.operation_id && att.operation_id === opId;
              const sameFacts = receiptAmount && att.receipt_amount &&
                Math.abs(Number(att.receipt_amount) - receiptAmount) < 0.01 &&
                (!receiptDate || !att.receipt_date || att.receipt_date === receiptDate) &&
                (!institution || !att.institution || String(att.institution).toLowerCase() === institution.toLowerCase());
              const persisted = ["expense", "income", "bulk", "bill"].includes(String(m.ai_intent ?? ""));
              return (sameFile || sameOp || sameFacts) && persisted;
            });
            if (alreadyRegistered) {
              console.log("[wa-processor][doc] stage=duplicate", { hash: fetched.hash.slice(0, 12) });
              intent = { kind: "document_duplicate" };
            } else {
              const { classifyDocument } = await import("@/lib/ai-classify.server");
              const factsType = docKind === "pdf" ? "pdf_receipt"
                : docKind === "xlsx" ? "spreadsheet_receipt"
                : docKind === "docx" ? "docx_receipt"
                : (docKind === "csv" || docKind === "txt") ? "text_receipt"
                : "image_receipt";
              intent = await classifyDocument(documentUrl, imageCaption || inputText, history, {
                filename: documentName, mimeType: docMimeResolved,
                extractedText: docText, bytes: fetched.bytes,
                facts: {
                  type: factsType,
                  amount: receiptAmount, date: receiptDate, institution,
                },
              });
              // Valor do comprovante é a fonte oficial (prioridade 1).
              if (receiptAmount && (intent?.kind === "expense" || intent?.kind === "income")
                  && Math.abs(Number(intent.amount ?? 0) - receiptAmount) > 0.01) {
                intent.amount = receiptAmount;
              }
              console.log("[wa-processor][doc] stage=classified", { kind: intent?.kind, amount: intent?.amount });
            }
          }
        } else if (extracted.imageUrl) {
          // Imagem também é baixada e validada antes da IA. Isso evita URLs
          // temporárias expirarem durante o processamento e permite dedupe por hash.
          const { fetchDocument, mediaBytesToDataUrl } = await import("@/lib/pdf-doc.server");
          console.log("[wa-processor][image] stage=download_started", { messageId: row.id });
          const fetched = await fetchDocument(extracted.imageUrl, undefined);
          if (!fetched.mime.startsWith("image/")) throw new Error("IMAGE_INVALID_FORMAT");
          docMeta = {
            hash: fetched.hash, size: fetched.size, mime: fetched.mime,
            filename: null, text_chars: 0, pages: 0, ocr: true, operation_id: null,
          };
          const { data: imageDupRows } = await supabaseAdmin
            .from("whatsapp_messages")
            .select("id, ai_intent, ai_meta")
            .eq("user_id", profile.id).eq("direction", "in").neq("id", row.id)
            .order("created_at", { ascending: false }).limit(80);
          const duplicateImage = (imageDupRows ?? []).some((m: any) =>
            m?.ai_meta?.attachment?.hash === fetched.hash &&
            ["expense", "income", "bulk", "bill"].includes(String(m.ai_intent ?? "")),
          );
          if (duplicateImage) {
            intent = { kind: "document_duplicate" };
          } else {
            intent = await classifyImage(mediaBytesToDataUrl(fetched.bytes, fetched.mime), imageCaption || inputText, history);
            // Fatos oficiais também para imagens: VALOR TOTAL e data impressa
            // extraídos do OCR devolvido pela IA (determinístico, pós-IA).
            const ocrText = String((intent as any)?.extracted_text ?? "");
            if (ocrText) {
              const { extractReceiptAmount, extractReceiptDate, extractInstitution } =
                await import("@/lib/pdf-doc.server");
              const rAmount = extractReceiptAmount(ocrText);
              const rDate = extractReceiptDate(ocrText);
              docMeta = {
                ...(docMeta as any),
                text_chars: ocrText.length,
                receipt_amount: rAmount, receipt_date: rDate,
                institution: extractInstitution(ocrText),
              } as any;
              if (rAmount && (intent.kind === "expense" || intent.kind === "income")
                  && Math.abs(Number(intent.amount ?? 0) - rAmount) > 0.01) {
                console.log("[wa-processor][image] total_override", { ai: intent.amount, receipt: rAmount });
                intent.amount = rAmount;
              }
            }
            console.log("[wa-processor][image] stage=analysis_completed", { messageId: row.id, kind: intent?.kind, amount: intent?.amount });
          }
        } else {
          intent = await classifyMessage(inputText, history);
        }
      } catch (e: any) {
        console.error("[wa-processor] classify failed", e);
        const code = String(e?.message ?? "");
        if (isDocument && (code.startsWith("DOC_FETCH_FAILED") || code === "DOC_EMPTY")) {
          intent = { kind: "document_fetch_failed", reason: code };
        } else if (isDocument && code === "DOC_CORRUPTED") {
          intent = { kind: "document_corrupted", reason: code };
        } else if (isDocument && code === "DOC_TOO_LARGE") {
          intent = { kind: "document_too_large", reason: code };
        } else {
          intent = imageUrl ? { kind: isDocument ? "document_unreadable" : "image_unreadable" } : { kind: "unknown" };
        }
      }
      aiMs = Date.now() - t0;

      // Rede de segurança multimodal: se o OCR de um convite/evento já contém
      // título, data e hora, esses dados são suficientes. Não voltamos a pedir
      // informações que estavam visíveis na imagem.
      if (!isDocument && extracted.imageUrl && intent) {
        const ocr = String((intent as any).extracted_text ?? "").trim();
        const eventEvidence = /\b(convite|evento|reuni[aã]o|onboarding|workshop|webinar|consulta|zoom|google meet|teams)\b/i.test(ocr);
        if (ocr && eventEvidence && ["appointment", "clarify", "unknown", "image_unreadable"].includes(String(intent.kind))) {
          const { parseFutureDateTimeSP } = await import("@/lib/appointment-datetime.server");
          const parsedOcr = parseFutureDateTimeSP(ocr);
          const title = (intent as any).appointment_title ?? (intent as any).title ?? eventTitleFromOcr(ocr);
          const scheduledAt = (intent as any).scheduled_at ?? (parsedOcr.hasDate && parsedOcr.hasTime ? parsedOcr.iso : null);
          if (title && scheduledAt) {
            intent = {
              ...intent,
              kind: "appointment",
              appointment_title: title,
              scheduled_at: scheduledAt,
              description: (intent as any).description ?? eventLocationFromOcr(ocr) ?? undefined,
              confidence: Math.max(Number((intent as any).confidence ?? 0), 0.95),
            };
          }
        }
      }

      // Dúvida legítima da IA: transforma clarify_question em pergunta enviada.
      if (intent?.kind === "clarify" && !(intent as any).replyText) {
        const q = String((intent as any).clarify_question ?? "").trim();
        (intent as any).replyText = q || "Pode me dar mais um detalhe? Não quero registrar errado 🙂";
      }



      // Rede de segurança: mídia sem intenção clara → pede esclarecimento
      // ao invés de travar ou responder algo genérico.
      if (imageUrl && intent && intent.kind !== "document_fetch_failed" && (
        intent.kind === "unknown" || intent.kind === "chat" ||
        ((intent.kind === "expense" || intent.kind === "income") &&
          (!intent.amount || !(intent.amount > 0)))
      )) {
        intent = { kind: isDocument ? "document_unreadable" : "image_unreadable" } as any;
      }

      // CONFLITO DE VALORES: só pergunta quando o usuário informou um valor
      // explícito diferente do comprovante. Sem valor na mensagem (ex.: "Gás"),
      // usa automaticamente o valor do comprovante.
      if (isDocument && intent && (intent.kind === "expense" || intent.kind === "income") && intent.amount > 0) {
        const captionText = (normalizedCaption || inputText || "");
        const captionAmount = extractCaptionAmount(captionText);
        if (captionAmount !== null && Math.abs(captionAmount - Number(intent.amount)) > 0.01) {
          const nome = (profile.name ?? "").trim().split(/\s+/)[0] || "";
          intent = {
            kind: "clarify",
            replyText:
              `${nome ? `${nome}, o` : "O"} comprovante mostra *${formatMoneyBR(Number(intent.amount))}*, ` +
              `mas sua mensagem informa *${formatMoneyBR(captionAmount)}*. Qual valor devo registrar? 🙂`,
          };
        }
      }

      // Documento lido com valor, mas sem descrição → usa a legenda do usuário.
      if (isDocument && intent && (intent.kind === "expense" || intent.kind === "income")) {
        const caption = (normalizedCaption || inputText || "").trim();
        if (caption && (!intent.description || intent.description.length < 2)) {
          (intent as any).description = caption.slice(0, 80);
        }
      }

      // Nota fiscal / comprovante COM valor total + estabelecimento (ou categoria)
      // reconhecidos já tem informação suficiente: registra sem perguntar nada.
      // Sem isso a nota era lida, mas nunca chegava a Transações.
      if ((isDocument || extracted.imageUrl) && intent
          && (intent.kind === "expense" || intent.kind === "income")
          && Number(intent.amount) > 0
          && !(intent.description || "").trim()) {
        const merchant = String(
          (intent as any).merchant ?? (intent as any).establishment ?? (intent as any).title ?? "",
        ).trim();
        const category = String(intent.category ?? "").trim();
        const auto = merchant || (category && category !== "Outros" ? category : "");
        if (auto) {
          (intent as any).description = auto.slice(0, 80);
          console.log("[wa-processor][receipt] stage=description_inferred", {
            messageId: row.id, description: auto, amount: intent.amount,
          });
        }
      }



      // PDF sem legenda só fica pendente se nem o documento/IA forneceu uma
      // descrição útil. Um comprovante completo sozinho deve ser executado.
      if (isDocument && intent && (intent.kind === "expense" || intent.kind === "income")
          && Number(intent.amount) > 0
          && !(normalizedCaption || inputText || "").trim()
          && !(intent.description || "").trim()) {
        const entry = {
          kind: intent.kind, amount: Number(intent.amount),
          category: intent.category ?? null, occurred_at: intent.occurred_at ?? null,
        };
        await supabaseAdmin.from("wa_contacts").upsert(
          {
            phone, name: profile.name ?? null,
            pending_action: { kind: "document_pending", doc: docMeta, entry, status: "WAITING_FOR_CONTEXT", expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString() } as any,
          },
          { onConflict: "phone" },
        );
        intent = { kind: "document_need_description", amount: entry.amount, occurred_at: entry.occurred_at } as any;
      }

      // Imagem legível, porém sem dado essencial: mantém o anexo pendente sem
      // validade automática. A próxima mensagem completa o mesmo lançamento.
      if (!isDocument && extracted.imageUrl && intent &&
          (intent.kind === "image_unreadable" || intent.kind === "clarify" ||
            ((intent.kind === "expense" || intent.kind === "income") && !(Number(intent.amount) > 0)))) {
        await supabaseAdmin.from("wa_contacts").upsert({
          phone, name: profile.name ?? null,
          pending_action: {
            kind: "attachment_pending", attachment_type: "image", doc: docMeta,
            entry: intent, ocr_text: String((intent as any).extracted_text ?? "").slice(0, 4000),
            status: "WAITING_FOR_CONTEXT",
            expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          } as any,
        }, { onConflict: "phone" });
      }


      if (!isDocument && extracted.imageUrl && intent &&
          (intent.kind === "expense" || intent.kind === "income") &&
          Number(intent.amount) > 0 &&
          !(normalizedCaption || inputText || "").trim() &&
          !(intent.description || "").trim()) {
        const entry = {
          kind: intent.kind, amount: Number(intent.amount), category: intent.category ?? null,
          occurred_at: intent.occurred_at ?? null,
        };
        await supabaseAdmin.from("wa_contacts").upsert({
          phone, name: profile.name ?? null,
          pending_action: {
            kind: "attachment_pending", attachment_type: "image", doc: docMeta,
            entry, ocr_text: String((intent as any).extracted_text ?? "").slice(0, 4000),
            status: "WAITING_FOR_CONTEXT",
            expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          } as any,
        }, { onConflict: "phone" });
        intent = { kind: "image_need_description", amount: entry.amount, occurred_at: entry.occurred_at } as any;
      }



      if (pending && intent && intent.kind === pending.kind && pending.kind === "reset_data") {
        intent = { kind: "confirm_yes" };
      }
      // Se o texto do usuário é claramente um LANÇAMENTO (verbo + valor), sobrepõe
      // qualquer classificação de consulta/chat feita pela IA. Registro > relatório.
      if (spontHit && intent && (
        intent.kind === "query_finance_report" ||
        intent.kind === "query_balance" ||
        intent.kind === "query_summary" ||
        intent.kind === "query_transactions" ||
        intent.kind === "chat" ||
         intent.kind === "unknown" ||
         intent.kind === "clarify"
      )) {
        intent = {
          kind: spontHit.kind,
          amount: spontHit.amount,
          category: spontHit.category,
          description: spontHit.description,
          occurred_at: spontHit.occurred_at,
        };
      }

      // Rede de segurança: IA devolveu 1 item, mas a mensagem tem múltiplos lançamentos
      // ou quantidade + valor unitário + total. Valida antes de salvar para não perder dados.
      //
      // IMPORTANTE: em nota fiscal / comprovante (imagem ou PDF) o texto do OCR
      // contém dezenas de números (itens, subtotais, códigos). Ele NUNCA pode
      // ser usado como evidência de múltiplos lançamentos, senão a nota deixa de
      // ser salva. Nesses casos só o texto escrito/falado pelo usuário conta.
      const isReceiptMedia = Boolean(isDocument || extracted.imageUrl);
      const splitSource = isReceiptMedia
        ? (inputText || normalizedCaption || "")
        : (inputText || intent?.extracted_text || normalizedCaption || "");
      // "X reais e Y centavos" já foi normalizado para um único decimal:
      // não dividir nem perguntar.
      const skipSplitChecks = explicitCents || !splitSource.trim();

      // Ambiguidade real: "paguei 37 e 25 no sorvete" — pode ser R$ 37,25 ou
      // dois gastos. Não registramos nada: perguntamos antes.
      if (!explicitCents && !isReceiptMedia && intent
          && ["expense", "income", "bulk"].includes(intent.kind)) {
        const { detectCentsAmbiguity } = await import("@/lib/money-speech");
        const amb = detectCentsAmbiguity(splitSource);
        if (amb) {
          const nome = (profile.name ?? "").trim().split(/\s+/)[0];
          intent = {
            kind: "financial_validation_error",
            replyText:
              `${nome ? `${nome}, s` : "S"}ó para confirmar: foi *${formatMoneyBR(Number(`${amb.whole}.${String(amb.cents).padStart(2, "0")}`))}* ` +
              `ou foram dois gastos, um de *${formatMoneyBR(amb.whole)}* e outro de *${formatMoneyBR(amb.cents)}*? 🙂`,
          };
        }
      }



      if (!skipSplitChecks && intent && ["expense", "income", "bill", "installment", "bulk"].includes(intent.kind)) {
        const sourceText = splitSource;
        const smart = actions.parseSmartFinancialMessage(sourceText);
        if (smart && !smart.ok) {
          intent = { kind: "financial_validation_error", replyText: smart.replyText };
        } else if (smart?.ok && smart.items.length >= 2) {
          intent = { kind: "bulk", items: smart.items, extracted_text: intent.extracted_text };
        } else if (["expense", "income", "bill"].includes(intent.kind)) {
          const inline = actions.parseInlineBulkProse(sourceText);
          if (inline && inline.length >= 2) {
            intent = { kind: "bulk", items: inline, extracted_text: intent.extracted_text };
          }
        }

        // Guarda final: o número de lançamentos precisa ter evidência (valores)
        // na mensagem. "Lanche nas paradas ida e volta 150" = 1 lançamento.
        if (intent && ["expense", "income", "bulk"].includes(intent.kind)) {
          const candidateItems = intent.kind === "bulk"
            ? (Array.isArray(intent.items) ? intent.items : [])
            : [{ kind: intent.kind, amount: intent.amount, category: intent.category, description: intent.description, occurred_at: intent.occurred_at }];
          const guarded = actions.guardSplitByEvidence(sourceText, candidateItems as any);
          if (!guarded.ok) {
            intent = { kind: "financial_validation_error", replyText: guarded.replyText };
          } else if (intent.kind === "bulk" && guarded.items.length < 2) {
            intent = { ...guarded.items[0], extracted_text: intent.extracted_text };
          } else if (intent.kind === "bulk") {
            intent = { ...intent, items: guarded.items };
          }
        }
      }



      // Bill vs Lembrete único: se a IA classificou como "bill" mas o texto NÃO
      // traz nenhum marcador de recorrência ("todo mês", "mensal", "conta fixa",
      // aluguel/internet/luz/etc.), tratamos como um compromisso/lembrete único.
      if (intent && intent.kind === "bill") {
        const sourceText = inputText || intent.extracted_text || imageCaption || "";
        if (!looksRecurring(sourceText)) {
          const title = intent.title || intent.description || sourceText.slice(0, 80);
          let scheduledAt = intent.next_due_at || intent.scheduled_at || null;
          if (!scheduledAt) {
            const dm = sourceText.match(/\bdia\s+(\d{1,2})\b/i);
            const day = dm ? Math.min(31, Math.max(1, parseInt(dm[1], 10))) : null;
            if (day) {
              const now = new Date();
              let target = new Date(now.getFullYear(), now.getMonth(), day, 9, 0, 0);
              if (target.getTime() < now.getTime() - 6 * 60 * 60 * 1000) {
                target = new Date(now.getFullYear(), now.getMonth() + 1, day, 9, 0, 0);
              }
              scheduledAt = target.toISOString();
            }
          }
          if (scheduledAt) {
            intent = {
              kind: "appointment",
              appointment_title: title,
              scheduled_at: scheduledAt,
              description: intent.description ?? sourceText,
            };
          } else if (typeof intent.amount === "number" && intent.amount > 0) {
            // Sem recorrência e sem data → é despesa avulsa (ex.: "Comprei conta TikTok Shop 200").
            intent = {
              kind: "expense",
              amount: intent.amount,
              category: intent.category ?? "Outros",
              description: title,
            };
          }
        }
      }

      // REDE DE SEGURANÇA — Nunca ignorar um gasto óbvio.
      // Se a IA não reconheceu a intenção como financeira registrável mas o texto
      // contém um verbo claro de compra/pagamento (comprei, paguei, assinei,
      // renovei, peguei, passei no cartão, abasteci, fiz mercado…) + valor,
      // grava a despesa deterministicamente. Mesma regra para receita.
      const REGISTRABLE = new Set([
        "expense","income","bill","installment","bulk","appointment","debt","goal",
        "correction","reset_data",
        "query_balance","query_summary","query_finance_report","query_appointments",
        "query_bills","query_installments","query_debts","query_goals","query_habits",
        "query_transactions","query_profile","update_profile","query_help","open_dashboard",
        "create_credit_card","query_credit_card",
        "confirm_yes","confirm_no","financial_validation_error",
      ]);
      if (intent && !imageUrl && !REGISTRABLE.has(intent.kind)) {
        const spont = actions.detectSpontaneousExpenseIntent(inputText || "");
        if (spont) {
          intent = {
            kind: spont.kind,
            amount: spont.amount,
            category: spont.category,
            description: spont.description,
            occurred_at: spont.occurred_at,
          };
        }
      }

    }


    // Data natural para expense/income. Ordem de prioridade:
    // 1) Data impressa no comprovante/nota fiscal (OCR determinístico)
    // 2) Data explícita na mensagem/legenda do usuário (ontem, dia 15, 15/07…)
    // 3) Data devolvida pela IA (occurred_at)
    // 4) Fallback = data de envio da mensagem
    // Referência FUTURA em texto (amanhã) vira compromisso.
    if (intent && (intent.kind === "expense" || intent.kind === "income")) {
      const { extractDateHintSP, isoNoonSPFromPrintedDate } = await import("./datetime");
      const userSrc = inputText || imageCaption || "";
      const userHint = extractDateHintSP(userSrc);
      const receiptIso = isoNoonSPFromPrintedDate((docMeta as any)?.receipt_date ?? null);
      if (receiptIso) {
        // Nota fiscal / comprovante: a data impressa é a fonte oficial.
        intent.occurred_at = receiptIso;
        console.log("[wa-processor][date] receipt_date_applied", { messageId: row.id, occurred_at: receiptIso });
      } else if (userHint) {
        if (userHint.future && intent.kind === "expense") {
          const t = new Date(userHint.iso);
          intent = {
            kind: "appointment",
            appointment_title: (intent.description || userSrc).slice(0, 80),
            scheduled_at: t.toISOString(),
            description: intent.description ?? userSrc,
          };
        } else if (!userHint.future) {
          intent.occurred_at = userHint.iso;
        }
      } else if (intent.occurred_at) {
        // Valida a data devolvida pela IA (imagem). Se for impossível/absurda,
        // descarta em vez de gravar lixo.
        const d = new Date(intent.occurred_at);
        const okDate = !isNaN(d.getTime()) && d.getUTCFullYear() >= 2000 && d.getUTCFullYear() <= 2100;
        if (!okDate) intent.occurred_at = undefined;
      } else if (!intent.occurred_at) {
        // Sem data do usuário nem da nota: tenta extrair do OCR bruto.
        const hint = extractDateHintSP(intent.extracted_text || "");
        if (hint && !hint.future) intent.occurred_at = hint.iso;
      }
      // Sem referência temporal, preserve o instante em que a mensagem chegou.
      // Nunca use o relógio do worker, que pode processar/reprocessar depois.
      if (!intent.occurred_at) intent.occurred_at = row.created_at;
    }

    // Bulk items: mesma cortesia — se um item veio sem occurred_at mas a
    // frase do usuário / OCR como um todo tem uma referência, usa como fallback.
    if (intent && intent.kind === "bulk" && Array.isArray(intent.items)) {
      const { extractDateHintSP } = await import("./datetime");
      const globalHint = extractDateHintSP(inputText || imageCaption || "") ||
        extractDateHintSP(intent.extracted_text || "");
      if (globalHint && !globalHint.future) {
        for (const it of intent.items) {
          if (!it.occurred_at) it.occurred_at = globalHint.iso;
        }
      }
      for (const it of intent.items) {
        if ((it.kind === "expense" || it.kind === "income") && !it.occurred_at) {
          it.occurred_at = row.created_at;
        }
      }
    }

    let replyText = "";
    let savedTxId: string | null = null;
    let savedAppointmentId: string | null = null;
    const expiresIn5min = () => new Date(Date.now() + 5 * 60 * 1000).toISOString();


    if (pending && intent.kind === "confirm_yes") {
      const p = pending;
      if (p.kind === "receipt_conflict") {
        // Documento é a fonte oficial: ATUALIZA o lançamento existente (nunca duplica).
        const r = await actions.correctLastTransaction(profile.id, {
          correction_field: "amount", new_amount: Number(p.doc_amount),
        });
        replyText = r.replyText;
      }
      else if (p.kind === "expense") replyText = (await actions.recordExpense(profile.id, p)).replyText;
      else if (p.kind === "income") replyText = (await actions.recordIncome(profile.id, p)).replyText;
      else if (p.kind === "appointment") replyText = (await actions.recordAppointment(profile.id, { title: p.title, scheduled_at: p.scheduled_at, notes: p.notes })).replyText;
      else if (p.kind === "reset_data") replyText = (await actions.resetUserData(profile.id)).replyText;
      else replyText = "Pronto! ✅";
      await supabaseAdmin.from("wa_contacts").update({ pending_action: null }).eq("phone", phone);
    } else if (pending && intent.kind === "confirm_no") {
      await supabaseAdmin.from("wa_contacts").update({ pending_action: null }).eq("phone", phone);
      replyText = pending.kind === "appointment"
        ? await (await import("./wa-replies")).pickReply("appointment_cancelled", phone)
        : pending.kind === "receipt_conflict"
        ? `👍 Beleza! Mantive o valor de *R$ ${Number(pending.prev_amount).toFixed(2).replace(".", ",")}* e não criei nenhum lançamento novo.`
        : "👍 Tudo bem! Seus dados foram mantidos.";



    } else if (
      !pending && !imageUrl && intent && intent.kind === "expense"
      && typeof intent.amount === "number" && intent.amount > 0
    ) {
      // === BLINDAGEM V1 — Confiança + Anomalia (Pilares 1 e 3) ===
      // Determina se essa despesa exige confirmação antes de gravar.
      // Regras:
      //  - confidence < 0.80  → pergunta antes (baixa certeza)
      //  - amount > 5x média  → pergunta antes (anomalia)
      //  - 0.80 <= confidence < 0.95 → grava, mas registra no motor de aprendizado
      //  - resto → executa direto pelo switch abaixo
      const { gateConfidence, detectExpenseAnomaly, logMediumConfidence } =
        await import("./ai-confidence.server");
      const conf = typeof intent.confidence === "number" ? intent.confidence : undefined;
      const gate = gateConfidence(conf);
      const cat = intent.category ?? undefined;
      const anomaly = await detectExpenseAnomaly(profile.id, cat, intent.amount);
      if (gate === "ask" || anomaly.isAnomaly) {
        const reason = anomaly.isAnomaly ? "anomaly" : "low_confidence";
        await supabaseAdmin.from("wa_contacts").upsert(
          {
            phone,
            name: profile.name ?? null,
            pending_action: {
              kind: "expense",
              amount: intent.amount,
              category: cat,
              description: intent.description ?? inputText,
              occurred_at: intent.occurred_at,
              reason,
              expires_at: expiresIn5min(),
            },
          },
          { onConflict: "phone" },
        );
        const valor = intent.amount.toFixed(2).replace(".", ",");
        if (anomaly.isAnomaly) {
          const avg = (anomaly.average ?? 0).toFixed(2).replace(".", ",");
          replyText =
`🚨 *Confirmação necessária*

Detectei um valor *bem acima* do seu padrão em *${cat ?? "essa categoria"}*:

💸 Este lançamento: *R$ ${valor}*
📊 Sua média (${anomaly.samples ?? 0} lanç., 60 dias): *R$ ${avg}*

Registrar mesmo assim? Responda *sim* ou *não*.`;
        } else {
          replyText =
`🤔 Quero confirmar antes de registrar.

💸 Valor: *R$ ${valor}*${cat ? `\n📂 Categoria: *${cat}*` : ""}${intent.description ? `\n📝 ${intent.description}` : ""}

Está correto? Responda *sim* ou *não*.`;
        }
        // marca a mensagem como aguardando confirmação — não cai no switch
        intent = { kind: "_awaiting_confirmation" };
      } else {
        if (gate === "execute_and_learn") {
          void logMediumConfidence({
            userId: profile.id,
            originalText: inputText || "",
            intent: { kind: intent.kind, confidence: conf, category: cat, amount: intent.amount },
          });
        }
        // segue para o switch abaixo com o intent inalterado
      }
    } else if (
      !pending && !imageUrl && intent && intent.kind === "income"
      && typeof intent.amount === "number" && intent.amount > 0
    ) {
      // Mesmo gate de confiança do expense (sem checagem de anomalia — não
      // há linha de base por categoria pra receita). Antes, receita era a
      // única entre as movimentações reais que nunca olhava pra confidence.
      const { gateConfidence, logMediumConfidence } = await import("./ai-confidence.server");
      const conf = typeof intent.confidence === "number" ? intent.confidence : undefined;
      const gate = gateConfidence(conf);
      if (gate === "ask" || gate === "menu") {
        await supabaseAdmin.from("wa_contacts").upsert(
          {
            phone,
            name: profile.name ?? null,
            pending_action: {
              kind: "income",
              amount: intent.amount,
              description: intent.description ?? inputText,
              occurred_at: intent.occurred_at,
              expires_at: expiresIn5min(),
            },
          },
          { onConflict: "phone" },
        );
        const valor = intent.amount.toFixed(2).replace(".", ",");
        replyText =
`🤔 Quero confirmar antes de registrar.

💰 Valor: *R$ ${valor}*${intent.description ? `\n📝 ${intent.description}` : ""}

Está correto? Responda *sim* ou *não*.`;
        intent = { kind: "_awaiting_confirmation" };
      } else if (gate === "execute_and_learn") {
        void logMediumConfidence({
          userId: profile.id,
          originalText: inputText || "",
          intent: { kind: intent.kind, confidence: conf, amount: intent.amount },
        });
      }
    } else if (
      !pending && !imageUrl && intent &&
      (intent.kind === "bill" || intent.kind === "debt" || intent.kind === "goal" || intent.kind === "create_credit_card")
    ) {
      // Piso de segurança: confiança abaixo do floor nunca deve criar dado
      // financeiro sozinha — antes, essas 4 intents ignoravam `confidence`
      // por completo e sempre executavam. Não monta um pending_action (não
      // há fluxo de confirmação dedicado pra essas 4 entidades ainda) — só
      // pergunta, sem tocar em nada, e a próxima mensagem do usuário passa
      // pela classificação de novo.
      const { gateConfidence } = await import("./ai-confidence.server");
      const conf = typeof intent.confidence === "number" ? intent.confidence : undefined;
      if (gateConfidence(conf) === "menu") {
        const label = intent.kind === "bill" ? "essa conta fixa"
          : intent.kind === "debt" ? "essa dívida"
          : intent.kind === "goal" ? "essa meta"
          : "esse cartão";
        replyText = `🤔 Não captei os detalhes de ${label} com certeza suficiente pra registrar sozinho. Pode mandar de novo com mais detalhes (nome, valor, vencimento)?`;
        intent = { kind: "_awaiting_confirmation" };
      }
    }
    if (intent && intent.kind !== "_awaiting_confirmation" && !(pending && (intent.kind === "confirm_yes" || intent.kind === "confirm_no"))) {
      switch (intent.kind) {
        case "expense":
          // Execução automática: intenção clara + valor → registra na hora.
          // (imagem/documento com valor reconhecido também é informação suficiente)
          {
          // CONFLITO ÁUDIO/TEXTO × DOCUMENTO: se o usuário acabou de lançar um
          // valor diferente por áudio/texto e agora manda o comprovante, NÃO
          // registramos nada — o documento tem prioridade, mas perguntamos antes.
          if ((isDocument || extracted.imageUrl) && typeof intent.amount === "number" && intent.amount > 0) {
            const since = new Date(Date.now() - 20 * 60 * 1000).toISOString();
            const { data: recentTx } = await supabaseAdmin
              .from("transactions")
              .select("id, amount, description, category, created_at")
              .eq("user_id", profile.id)
              .eq("kind", "expense")
              .eq("channel", "whatsapp")
              .gte("created_at", since)
              .order("created_at", { ascending: false })
              .limit(1);
            const prev = recentTx?.[0];
            const prevAmount = prev ? Number(prev.amount) : null;
            if (prev && prevAmount != null && Math.abs(prevAmount - intent.amount) >= 0.01) {
              await supabaseAdmin.from("wa_contacts").upsert(
                {
                  phone, name: profile.name ?? null,
                  pending_action: {
                    kind: "receipt_conflict",
                    transaction_id: prev.id,
                    doc_amount: intent.amount,
                    prev_amount: prevAmount,
                    expires_at: expiresIn5min(),
                  } as any,
                },
                { onConflict: "phone" },
              );
              const fmt = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;
              replyText =
`🤔 *Encontrei valores diferentes*

📄 No comprovante: *${fmt(intent.amount)}*
🗣️ No que você me enviou antes: *${fmt(prevAmount)}*

Não registrei nada de novo. Devo usar o valor do comprovante?
Responda *sim* para ${fmt(intent.amount)} ou *não* para manter ${fmt(prevAmount)}.`;
              break;
            }
          }

          const saved = await actions.recordExpense(profile.id, {
            amount: intent.amount, category: intent.category,
             description: intent.description ?? normalizedCaption ?? (inputText || "Gasto avulso"),
             occurred_at: intent.occurred_at ?? row.created_at,
             credit_card_hint: intent.credit_card_hint,
          });
          savedTxId = saved.row?.id ?? null;
          // REGRA DE OURO: nunca confirmar sem persistência confirmada no banco.
          replyText = (!saved.ok && (isDocument || extracted.imageUrl))
            ? "Consegui ler a nota, mas não consegui salvar o lançamento agora. Vou precisar que você tente novamente. 🙏"
            : saved.replyText;
          console.log("[wa-processor] stage=database_updated", {
            messageId: row.id, kind: "expense", document: isDocument,
            image: Boolean(extracted.imageUrl), ok: saved.ok, txId: savedTxId, amount: intent.amount,
          });
          }
          break;
        case "income":
          {
          const saved = await actions.recordIncome(profile.id, {
             amount: intent.amount, description: intent.description ?? normalizedCaption ?? (inputText || "Receita"),
             occurred_at: intent.occurred_at ?? row.created_at,
          });
          savedTxId = saved.row?.id ?? null;
          replyText = (!saved.ok && (isDocument || extracted.imageUrl))
            ? "Consegui ler o comprovante, mas não consegui salvar o lançamento agora. Vou precisar que você tente novamente. 🙏"
            : saved.replyText;
          console.log("[wa-processor] stage=database_updated", {
            messageId: row.id, kind: "income", document: isDocument,
            image: Boolean(extracted.imageUrl), ok: saved.ok, txId: savedTxId, amount: intent.amount,
          });
          }
          break;


        case "appointment": {
          const ocrText = String((intent as any).extracted_text ?? "").trim();
          const title = intent.appointment_title ?? intent.title ?? eventTitleFromOcr(ocrText) ?? intent.description ?? inputText.slice(0, 80);
          const notes = eventLocationFromOcr(ocrText) ?? intent.description ?? null;
          const srcText = [inputText, imageCaption, ocrText].filter(Boolean).join("\n");
          const { scoreAppointmentIntent } = await import("@/lib/appointment-confidence.server");
          const { parseFutureDateTimeSP } = await import("@/lib/appointment-datetime.server");
          const { pickReply: pickApptReply } = await import("./wa-replies");

          // Data/hora futura vinda do texto tem prioridade sobre a da IA.
          const nat = parseFutureDateTimeSP(srcText);
          // ⚠️ Bug real (2 rodadas): nat.iso SEMPRE tem um valor (o parser
          // assume "hoje"/"amanhã" quando só a hora foi dita), então checar
          // apenas "scheduledAt existe?" nunca detectava "só falta o dia".
          // Uma primeira correção passou a confiar em intent.scheduled_at
          // (da IA) como sinal de "data realmente informada" quando fosse
          // parseável — mas a IA TAMBÉM chuta uma data padrão quando não sabe
          // (confirmado ao vivo: "11:30 buscar escola" virou
          // scheduled_at=amanhã 11:30 sem NUNCA perguntar o dia). Não há como
          // distinguir "a IA entendeu uma data real" de "a IA também
          // assumiu hoje/amanhã" só olhando o valor final — por segurança
          // (Regra de Ouro: ambíguo nunca executa sozinho), hasDate/hasTime
          // dependem SÓ do parser determinístico (nat), que é o único que
          // sabe de verdade se a data veio do texto ou foi assumida.
          const hasDate = nat.hasDate;
          const hasTime = nat.hasTime;
          const scheduledAt = (hasDate && hasTime) ? nat.iso : undefined;
          const scored = scoreAppointmentIntent({
            text: srcText,
            hasScheduledAt: Boolean(scheduledAt),
            aiConfidence: typeof intent.confidence === "number" ? intent.confidence : null,
          });

          const { isVagueApptTitle: vagueTitle } = await import("@/lib/appointment-nlp.server");

          // Falta informação → pergunta ESPECÍFICA (nunca mensagem financeira).
          if (!hasDate || !hasTime) {
            await supabaseAdmin.from("wa_contacts").upsert(
              {
                phone, name: profile.name ?? null,
                pending_action: {
                  kind: "appointment_draft", title, notes,
                  partial_iso: nat.iso ?? null, has_date: hasDate, has_time: hasTime,
                  expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
                } as any,
              },
              { onConflict: "phone" },
            );
            replyText = hasDate && !hasTime
              ? await pickApptReply("appointment_missing_time", phone)
              : !hasDate && hasTime
              ? await pickApptReply("appointment_missing_date", phone)
              // Exemplo só quando NÃO existe contexto algum (nem descrição, nem data/hora).
              : vagueTitle(title) && !hasDate && !hasTime
              ? `${await pickApptReply("appointment_missing_date", phone)}\n\nEx.: _amanhã às 14h_`
              : await pickApptReply("appointment_missing_date", phone);
            break;
          }

          // Data e hora prontas, mas sem descrição → pergunta SÓ o que falta.
          if (vagueTitle(title)) {
            await supabaseAdmin.from("wa_contacts").upsert(
              {
                phone, name: profile.name ?? null,
                pending_action: {
                  kind: "appointment_need_title", scheduled_at: scheduledAt, notes,
                  expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
                } as any,
              },
              { onConflict: "phone" },
            );
            replyText = await pickApptReply("appointment_missing_title", phone);
            break;
          }

          // Execução automática: título + data/hora completos = informação suficiente.
          // Não pedimos confirmação extra — o compromisso é criado e confirmado depois.
          const saved = await actions.recordAppointment(profile.id, {
            title, scheduled_at: scheduledAt, notes,
            confidence: scored.score, source_text: srcText,
          });
          replyText = saved.replyText;
          savedAppointmentId = saved.row?.id ?? null;
          break;

        }


        // Saldo padrão = MÊS ATUAL. Histórico/total apenas se pedido explicitamente.
        case "query_balance": replyText = (await actions.queryBalance(profile.id, inputText || imageCaption || "")).replyText; break;
        case "query_summary": replyText = (await actions.buildReport(profile.id, { range: intent.range ?? "all", start: (intent as any).range_start, end: (intent as any).range_end, label: (intent as any).range_label })).replyText; break;
        case "query_finance_report": {
          const per = (intent as any).period;
          const askUsed = (intent as any).ask;
          replyText = (await actions.buildDetailedFinanceReport(profile.id, per, askUsed)).replyText;
          // Memoriza contexto para perguntas de continuação ("especifica", "por categoria"…).
          try {
            await supabaseAdmin.from("wa_contacts").upsert(
              {
                phone, name: profile.name ?? null,
                last_query_context: {
                  period: per, ask: askUsed,
                  awaiting: (askUsed?.mode ?? "summary") === "summary" ? "categories" : null,
                  at: new Date().toISOString(),
                },
              },
              { onConflict: "phone" },
            );
          } catch {}
          break;
        }

        case "query_appointments": replyText = (await actions.queryAppointments(profile.id)).replyText; break;
        case "query_bills": replyText = (await actions.queryBills(profile.id, { filter: intent.filter, hint: intent.hint, dueDay: intent.dueDay })).replyText; break;
        case "query_installments": {
          const listRes = await actions.queryInstallments(profile.id);
          replyText = listRes.replyText;
          // Memoriza a lista numerada pra "2 vence dia 15" resolver sozinho.
          if (listRes.items.length > 0) {
            try {
              await supabaseAdmin.from("wa_contacts").upsert(
                { phone, name: profile.name ?? null, last_query_context: { installments_list: listRes.items, at: new Date().toISOString() } },
                { onConflict: "phone" },
              );
            } catch {}
          }
          break;
        }
        case "query_debts": replyText = (await actions.queryDebts(profile.id)).replyText; break;
        case "query_goals": replyText = (await actions.queryGoals(profile.id)).replyText; break;
        case "query_habits": replyText = (await actions.queryHabits(profile.id)).replyText; break;
        case "query_transactions": replyText = (await actions.queryTransactions(profile.id, { kind: intent.txKind, limit: 15 })).replyText; break;
        case "query_profile": {
          const { queryProfileField } = await import("@/lib/profile-info.server");
          replyText = (await queryProfileField(profile.id, intent.profile_field ?? "income")).replyText;
          break;
        }
        case "update_profile": {
          const { updateProfileField } = await import("@/lib/profile-info.server");
          const field = intent.profile_field ?? "income";
          const value = field === "income" ? Number(intent.profile_value) : (intent.profile_value ?? "");
          replyText = (await updateProfileField(profile.id, field, value)).replyText;
          break;
        }
        case "create_credit_card": {
          const r = await actions.createCreditCard(profile.id, {
            name: intent.title ?? intent.description, closing_day: intent.closing_day, due_day: intent.due_day,
          });
          replyText = r.replyText;
          break;
        }
        case "query_credit_card": {
          const r = await actions.queryCreditCardInvoice(profile.id, intent.credit_card_hint);
          replyText = r.replyText;
          break;
        }
        case "query_help": replyText = actions.helpMessage(profile.name ?? undefined); break;
        case "open_dashboard": replyText = actions.openDashboardReply().replyText; break;
        case "reset_data":
          await supabaseAdmin.from("wa_contacts").upsert(
            { phone, name: profile.name ?? null, pending_action: { kind: "reset_data", expires_at: expiresIn5min() } },
            { onConflict: "phone" });
          replyText = `⚠️ *Tem certeza?*\n\nIsso vai apagar TODOS os seus lançamentos, lembretes e histórico financeiro. Essa ação não pode ser desfeita.\n\nResponda *sim, apagar tudo* para confirmar ou *cancelar* para manter seus dados. (válido por 5 min)`;
          break;
        case "correction": {
          // "Aluguel aumentou pra 1.300", "internet agora custa 130" — uma
          // correção de VALOR com uma pista que bate com o título de uma
          // conta fixa ou parcelamento é sobre ESSE registro, não sobre um
          // lançamento avulso das últimas 24h (correctLastTransaction só olha
          // transactions). Só intercepta com pista forte (>=4 letras batendo
          // no título) — sem isso, segue pro fluxo de sempre sem risco de
          // corrigir a coisa errada.
          const hint = (intent.correction_field === "amount" && intent.new_amount != null
            ? (intent.match_hint || "").toLowerCase().trim() : "");
          let handledAsBillOrInstallment = false;
          if (hint.length >= 4) {
            const stripA = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{Mn}/gu, "");
            const h = stripA(hint);
            const { data: billMatch } = await supabaseAdmin
              .from("recurring_bills").select("id, title").eq("user_id", profile.id)
              .order("created_at", { ascending: false }).limit(30);
            const bill = (billMatch ?? []).find((b: any) => h.includes(stripA(String(b.title || ""))) && String(b.title || "").length >= 4);
            if (bill) {
              const r = await actions.applyBillInstallmentFollowUp(profile.id, bill.id, { amount: intent.new_amount });
              if (r.ok) { replyText = r.replyText; handledAsBillOrInstallment = true; }
            }
            if (!handledAsBillOrInstallment) {
              const { data: instMatch } = await supabaseAdmin
                .from("installment_purchases").select("id, title").eq("user_id", profile.id)
                .order("created_at", { ascending: false }).limit(30);
              const inst = (instMatch ?? []).find((b: any) => h.includes(stripA(String(b.title || ""))) && String(b.title || "").length >= 4);
              if (inst) {
                const r = await actions.applyInstallmentFollowUp(profile.id, inst.id, { amount: intent.new_amount });
                if (r.ok) { replyText = r.replyText; handledAsBillOrInstallment = true; }
              }
            }
          }
          // "Vai ser quinta-feira, errei" / "Mudar o nome para: X" sobre um
          // compromisso — nunca uma transação avulsa. Bug real: caía direto
          // em correctLastTransaction (só conhece `transactions`),
          // respondendo "não achei um lançamento recente pra corrigir".
          //
          // Resolve o alvo em duas camadas:
          // 1) Se o usuário usou "responder" (reply) do WhatsApp na própria
          //    mensagem de confirmação, `replyToRawMessageId` aponta com
          //    CERTEZA pro compromisso — funciona não importa há quanto
          //    tempo foi criado, e é sempre tentado primeiro.
          // 2) Sem reply explícito, cai no heurístico de "criado há pouco"
          //    (últimos 30min) já existente — mais fraco, só cobre o caso
          //    "acabei de criar, é sobre isso".
          let handledAsAppointment = false;
          let apptTarget: { id: string; title: string; scheduled_at: string; status?: string | null } | null = null;
          if (!handledAsBillOrInstallment && replyToRawMessageId) {
            const { data: repliedTo } = await supabaseAdmin
              .from("whatsapp_messages")
              .select("raw")
              .eq("direction", "out").eq("user_id", profile.id)
              .eq("raw_message_id", replyToRawMessageId)
              .maybeSingle();
            const apptId = (repliedTo as any)?.raw?.appointment_id ?? null;
            if (apptId) {
              const apptActions = await import("@/lib/appointment-actions.server");
              apptTarget = await apptActions.getAppointment(profile.id, apptId);
            }
          }
          if (!handledAsBillOrInstallment) {
            const { parseFutureDateTimeSP } = await import("@/lib/appointment-datetime.server");
            const natCorrection = parseFutureDateTimeSP(inputText);
            if (natCorrection.hasDate || natCorrection.hasTime) {
              const apptActions = await import("@/lib/appointment-actions.server");
              const target = apptTarget ?? await apptActions.findRecentlyCreatedAppointment(profile.id);
              if (target) {
                const merged = apptActions.mergeReschedule(target.scheduled_at, natCorrection) ?? natCorrection.iso;
                if (merged) {
                  replyText = await apptActions.rescheduleAppointment(profile.id, target as any, merged, phone);
                  handledAsAppointment = true;
                  // Bug real: sem isso, a confirmação desta correção saía
                  // sem raw.appointment_id — uma SEGUNDA correção respondendo
                  // a ESTA mensagem (em vez da de criação original) perdia a
                  // ligação e caía de volta no heurístico de 30min.
                  savedAppointmentId = target.id;
                }
              }
            }
          }
          // "Mudar o nome para: Prova Policia em Alegre" — sem sinal de
          // data/hora, mas com vocabulário explícito de renomear (nome/
          // título/chamar) pra não colidir com uma correção de descrição de
          // uma transação qualquer que só por coincidência caiba no mesmo
          // alvo/janela.
          if (!handledAsBillOrInstallment && !handledAsAppointment && /\b(nome|t[íi]tulo|chama(r)?|renome(ar)?)\b/i.test(inputText)) {
            const newTitle = (intent.new_description || "").trim()
              || (inputText.match(/(?:nome|t[íi]tulo)\s*(?:pra|para)?\s*[:\-]?\s*(.+)$/i)?.[1] ?? "").trim();
            if (newTitle.length >= 2) {
              const apptActions = await import("@/lib/appointment-actions.server");
              const target = apptTarget ?? await apptActions.findRecentlyCreatedAppointment(profile.id);
              if (target) {
                await supabaseAdmin.from("appointments")
                  .update({ title: newTitle.slice(0, 140), updated_at: new Date().toISOString() })
                  .eq("id", target.id).eq("user_id", profile.id);
                replyText = `✅ Nome atualizado!\n\n📝 ${newTitle}\n🕒 ${apptActions.prettyAppointmentDate(target.scheduled_at)}`;
                handledAsAppointment = true;
                savedAppointmentId = target.id;
              }
            }
          }
          if (!handledAsBillOrInstallment && !handledAsAppointment) {
            const r = await actions.correctLastTransaction(profile.id, {
              correction_field: intent.correction_field, new_amount: intent.new_amount,
              new_category: intent.new_category, new_description: intent.new_description,
              new_payment_method: intent.new_payment_method, match_hint: intent.match_hint,
            });
            replyText = r.replyText;
          }
          break;
        }
        case "bulk": {
          const bulkSource = inputText || intent.extracted_text || imageCaption || "";
          let items = Array.isArray(intent.items) ? intent.items : [];
          if (items.length < 2) {
            const smart = actions.parseSmartFinancialMessage(bulkSource);
            if (smart && !smart.ok) {
              replyText = smart.replyText; break;
            }
            if (smart?.ok && smart.items.length >= 2) {
              items = smart.items as any;
            } else {
              const inline = actions.parseInlineBulkProse(bulkSource);
              if (inline && inline.length >= 2) items = inline as any;
            }
          }
          const guarded = actions.guardSplitByEvidence(bulkSource, items as any);
          if (!guarded.ok) { replyText = guarded.replyText; break; }
          replyText = (await actions.processBulk(profile.id, guarded.items as any)).replyText; break;
        }

        case "financial_validation_error":
          replyText = intent.replyText || "Encontrei uma dúvida nos valores. Pode confirmar?"; break;
        case "bill": {
          const { parseTotalInstallments, parsePaidInstallments } = await import("@/lib/bill-installments");
          const billSource = `${inputText ?? ""} ${intent.description ?? ""}`;
          const totalInst = (intent as any).installments_total ?? parseTotalInstallments(billSource) ?? undefined;
          const paidInst = (intent as any).installments_paid
            ?? (totalInst ? parsePaidInstallments(billSource, totalInst) ?? undefined : undefined);
          const billRes = await actions.recordBill(profile.id, {
            title: intent.title ?? intent.description, amount: intent.amount,
            frequency: intent.frequency, next_due_at: intent.next_due_at,
            due_day: intent.due_day, category: intent.category,
            total_installments: totalInst, paid_installments: paidInst,
          });
          if (billRes.needsDay && billRes.draft) {
            await supabaseAdmin.from("wa_contacts").upsert(
              { phone, name: profile.name ?? null, pending_action: { kind: "bill_day", draft: billRes.draft, expires_at: expiresIn5min() } },
              { onConflict: "phone" });
          } else if (billRes.ok && billRes.billId) {
            // Mantém o contexto da conta criada para mensagens complementares
            // ("220 parcelas", "todo dia 15", "já paguei 10").
            await supabaseAdmin.from("wa_contacts").upsert(
              {
                phone, name: profile.name ?? null,
                pending_action: { kind: "bill_followup", bill_id: billRes.billId, title: intent.title ?? null, total: totalInst ?? null, expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString() } as any,
              },
              { onConflict: "phone" });
          }
          replyText = billRes.replyText; break;
        }

        case "installment": {
          // Nunca adivinhar parcela/valor/total: reconcilia os três números
          // (valor da parcela × quantidade deve bater com o total, quando a
          // IA extraiu um total) e só executa com confiança suficiente. Em
          // dúvida, pergunta SÓ o campo duvidoso e preserva o resto — não
          // depende do canal (texto ou áudio transcrito): mesma checagem
          // para os dois, porque a ambiguidade nasce da mensagem, não da
          // origem.
          // Nome do produto/serviço não é campo essencial — mesma regra já
          // usada em despesa avulsa ("gastei 90" → description="Gasto
          // avulso" sem perguntar): se a frase não disser o que foi
          // comprado, cria com um título genérico em vez de travar a
          // criação perguntando. Valor, quantidade e reconciliação SIM são
          // essenciais (é neles que mora o risco de dado errado).
          const title = (intent.title ?? intent.description ?? "").trim() || "Compra parcelada";
          const amount = typeof intent.amount === "number" && intent.amount > 0 ? intent.amount : undefined;
          const total = typeof intent.installments_total === "number" && intent.installments_total > 0 ? intent.installments_total : undefined;
          const totalAmount = typeof intent.total_amount === "number" && intent.total_amount > 0 ? intent.total_amount : undefined;

          const { gateConfidence } = await import("@/lib/ai-confidence.server");
          const gate = gateConfidence(intent.confidence);
          const reconciles = amount && total && totalAmount
            ? Math.abs(totalAmount - amount * total) <= Math.max(1, totalAmount * 0.02)
            : true;

          const missing: "reconcile" | "amount" | "installments_total" | "confirm" | null =
            !reconciles ? "reconcile"
            : !amount ? "amount"
            : !total ? "installments_total"
            : (gate === "ask" || gate === "menu") ? "confirm"
            : null;

          if (missing) {
            await supabaseAdmin.from("wa_contacts").upsert(
              {
                phone, name: profile.name ?? null,
                pending_action: {
                  kind: "installment_draft",
                  draft: { title, amount, installments_total: total, installments_paid: intent.installments_paid, total_amount: totalAmount, due_day: intent.due_day, next_due_at: intent.next_due_at },
                  missing,
                  expires_at: expiresIn5min(),
                } as any,
              },
              { onConflict: "phone" },
            );
            replyText = missing === "reconcile"
              ? `Encontrei uma inconsistência nesse parcelamento${title ? ` (*${title}*)` : ""}: ${total} parcelas de ${formatMoneyBR(amount!)} dá ${formatMoneyBR(amount! * total!)}, mas também apareceu um total de ${formatMoneyBR(totalAmount!)}. Qual é o valor certo de cada parcela?`
              : missing === "amount"
              ? `Não consegui confirmar com segurança o valor de cada parcela${title ? ` de *${title}*` : ""}. Qual é?`
              : missing === "installments_total"
              ? `Quantas parcelas são${title ? ` de *${title}*` : ""}?`
              : `Posso confirmar esse parcelamento?\n\n📝 ${title}\n🔢 ${total} parcelas de ${formatMoneyBR(amount!)} (total ${formatMoneyBR(amount! * total!)})\n\nResponda *sim* pra salvar.`;
            break;
          }

          const instRes = await actions.recordInstallment(profile.id, {
            title, amount, installments_total: total, installments_paid: intent.installments_paid, total_amount: totalAmount,
            due_day: intent.due_day, next_due_at: intent.next_due_at,
          });
          replyText = instRes.replyText;
          if (instRes.ok && instRes.row) {
            // Mantém o contexto pra correções imediatas ("na verdade são 12
            // parcelas", "corrige pra 850") sem precisar repetir tudo.
            await supabaseAdmin.from("wa_contacts").upsert(
              {
                phone, name: profile.name ?? null,
                pending_action: {
                  kind: "installment_followup", installment_id: instRes.row.id, title,
                  expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
                } as any,
              },
              { onConflict: "phone" },
            );
          }
          break;
        }
        case "debt":
          replyText = (await actions.recordDebt(profile.id, {
            title: intent.title ?? intent.description, amount: intent.amount,
            creditor: intent.creditor, description: intent.description,
          })).replyText; break;
        case "goal":
          replyText = (await actions.recordGoal(profile.id, {
            title: intent.title ?? intent.description, target_amount: intent.target_amount,
            amount: intent.amount, target_date: intent.target_date,
          })).replyText; break;
        case "confirm_yes":
        case "confirm_no":
          replyText = "Sem pendências por aqui 👍. Pode mandar o que precisa registrar!"; break;
        case "document_fetch_failed":
          replyText = "📄 Recebi seu documento, mas *não consegui abrir o arquivo* pra ler o conteúdo.\n\nPode reenviar o PDF (ou uma foto/print dele)? Se preferir, me diga só o valor e do que se trata que eu registro na hora.";
          break;
        case "document_too_large":
          replyText = "📄 Recebi seu documento, mas ele é *muito grande* pra eu conseguir ler por aqui.\n\nMe manda um print da página do comprovante — ou me diga o valor e do que se trata que eu registro na hora 🙂";
          break;
        case "document_corrupted":
          replyText = "Esse documento parece estar corrompido. Pode enviar novamente?";
          break;
        case "document_duplicate":
          replyText = "📄 Esse comprovante *já foi registrado* aqui antes — não vou lançar de novo pra não duplicar 👍\n\nSe for um pagamento novo, me diga o valor e do que se trata que eu registro.";
          break;
        case "document_need_description": {
          const v = Number((intent as any).amount);
          replyText = `📄 Comprovante lido! Identifiquei *${formatMoneyBR(v)}*.\n\n📝 *Esse pagamento foi referente a quê?*\n\nMe responde em poucas palavras (ex.: _mercado_, _combustível_, _aluguel_) que eu registro na hora 🙂`;
          break;
        }
        case "document_pending_reminder": {
          const v = Number((intent as any)?.entry?.amount ?? 0);
          replyText = v > 0
            ? `📄 Ainda estou com aquele comprovante de *${formatMoneyBR(v)}* aqui, esperando você me dizer *do que se trata* pra eu registrar 🙂`
            : "📄 Estou com um comprovante seu aqui aguardando a descrição. Me diz do que se trata que eu registro 🙂";
          break;
        }
        case "document_unreadable":
          replyText = "📄 Li seu comprovante, mas não consegui identificar todos os dados com clareza.\n\nMe conta rapidinho:\n💸 *Qual o valor?*\n📝 *Esse pagamento foi referente a qual gasto?*\n\nSugestões: 🍔 Alimentação · ⛽ Combustível · 🚗 Transporte · 🏠 Casa · 🛒 Mercado · 📦 Outro";
          break;
        case "document_format_unsupported":
          replyText = "📎 Recebi seu arquivo, mas esse formato ainda não é um dos que eu leio diretamente.\n\nEu reconheço: 📄 PDF · 📸 foto/print · 📊 Excel/CSV · 📝 Word (.docx).\n\nPode reenviar em um desses formatos? Ou me diga o valor e do que se trata que eu registro na hora 🙂";
          break;

        case "image_unreadable":
          replyText = "📸 Recebi sua imagem, mas não consegui ler os dados com clareza.\n\nMe conta rapidinho:\n💸 *Qual o valor?*\n📝 *Do que se trata?*\n\nEx.: _foi 45 reais de mercado_ · _paguei 120 no posto ontem_";
          break;
        case "image_need_description": {
          const v = Number((intent as any).amount);
          replyText = `👀 Imagem analisada! Identifiquei *${formatMoneyBR(v)}*.\n\nMe diga do que se trata e eu registro na hora.`;
          break;
        }
        default:
          replyText = await chatReply(inputText || "(imagem)", profile.name, history);

      }
    }

    // Personaliza perguntas/confirmações com o primeiro nome do usuário.
    // (não usar em toda mensagem — só quando é pergunta ou aviso importante)
    const NAMED_INTENTS = new Set([
      "financial_validation_error", "clarify", "confirm_delete", "confirm_reset",
      "delete", "reset_data", "password_reset",
    ]);
    if (profile?.name && replyText) {
      const isQuestion = /\?\s*$/.test(replyText.trim()) || /\bpode confirmar\b|\btem certeza\b|\bdeseja\b/i.test(replyText);
      if (NAMED_INTENTS.has(intent.kind) || isQuestion) {
        const { withName } = await import("./wa-replies");
        replyText = withName(replyText, profile.name);
      }
    }

    // Intents que persistem algo no banco — retry+audit crítico se o envio falhar.
    const persistedIntents = new Set([
      "expense", "income", "bill", "installment", "debt", "goal",
      "appointment", "bulk", "correction",
    ]);

    const { ok: sendOk, result: sendResult } = await sendReplyWithCriticalGuard(replyPhone, replyText, {
      inboundMessageId: row.id,
      userId: profile?.id ?? null,
      intent: intent.kind,
      savedTxId: savedTxId ?? (persistedIntents.has(intent.kind) ? undefined : null),
      savedAppointmentId,
    });
    console.log("[wa-processor][doc] stage=final_reply", { messageId: row.id, intent: intent.kind, ok: sendOk, document: isDocument });
    await supabaseAdmin.from("whatsapp_messages").update({
      transcription: audioUrl ? inputText : null,
      ai_intent: intent.kind, ai_payload: intent as any,
      ai_meta: {
        model: "openai", ms: aiMs,
        mode: isDocument ? "document" : imageUrl ? "image" : audioUrl ? "audio" : "text",
        ...(isDocument || docMeta ? {
          attachment: {
            url: documentUrl ?? null,
            filename: docMeta?.filename ?? documentName ?? null,
            mime: docMeta?.mime ?? documentMime ?? null,
            hash: docMeta?.hash ?? null,
            operation_id: docMeta?.operation_id ?? null,
             receipt_amount: docMeta?.receipt_amount ?? null,
             receipt_date: docMeta?.receipt_date ?? null,
             institution: docMeta?.institution ?? null,
            text_chars: docMeta?.text_chars ?? 0,
            pages: docMeta?.pages ?? 0,
            ocr: docMeta?.ocr ?? null,
          },
          document_analyzed: true,
        } : {}),

      } as any,
      status: sendOk ? "processed" : "send_error",
    }).eq("id", row.id);
    await supabaseAdmin.from("whatsapp_messages").insert({
      user_id: profile?.id ?? null, phone: replyPhone, direction: "out", media_type: "text",
      content: replyText, status: sendOk ? "sent" : "send_error",
      // raw_message_id (mesma coluna usada pra idempotência de entrada,
      // aqui reaproveitada pra saída) guarda o ID que a Z-API atribuiu a
      // ESTA mensagem enviada — é contra esse valor que um
      // `referenceMessageId` de uma resposta futura do usuário casa.
      // appointment_id/transaction_id no `raw` deixam claro a que entidade
      // esta confirmação se refere, pra resolver a correção com certeza.
      raw_message_id: (sendResult as any)?.response?.messageId ?? (sendResult as any)?.response?.zaapId ?? null,
      raw: {
        send: sendResult, inbound_message_id: row.id, final_confirmation: true,
        appointment_id: savedAppointmentId ?? null,
        transaction_id: savedTxId ?? null,
      } as any,
    });

    return { ok: sendOk, status: sendOk ? "processed" : "send_error", intent: intent.kind };
  } catch (e: any) {
    console.error("[wa-processor] error", e);
    const code = e?.message;
    let userMsg =
      "⚠️ Ocorreu um erro interno enquanto eu processava sua solicitação.\n\nNenhuma informação será perdida.\n\nVou tentar novamente automaticamente.";
    if (code === "AI_UNAUTHORIZED") userMsg = "Chave da OpenAI inválida. Avise o admin.";
    if (code === "AI_DISABLED") userMsg = "⚠️ As automações inteligentes estão temporariamente desativadas pelo admin.";
    try {
      const { ok: sendOk, result: sendResult } = await sendReplyWithCriticalGuard(replyPhone, userMsg, {
        inboundMessageId: row.id,
        userId: profile?.id ?? null,
        intent: "processing_error",
      });
      await supabaseAdmin.from("whatsapp_messages").insert({
        user_id: profile?.id ?? null, phone: replyPhone, direction: "out", media_type: "text",
        content: userMsg, status: sendOk ? "sent" : "send_error",
        raw: { send: sendResult, inbound_message_id: row.id, error_notice: true } as any,
      });
    } catch (sendErr) {
      console.error("[wa-processor] failed to notify user of error", sendErr);
    }
    const status = code === "AI_DISABLED" ? "ai_disabled" : code === "AI_UNAUTHORIZED" ? "ai_error" : "error";
    await supabaseAdmin.from("whatsapp_messages")
      .update({ status, last_error: String(code ?? "unknown").slice(0, 500) })
      .eq("id", row.id);
    return { ok: false, reason: code ?? "unknown", status };
  }
}


/**
 * Estatísticas de mensagens inbound + SLA para o painel admin.
 */
export async function getPendingMessagesStats() {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: rows } = await supabaseAdmin
    .from("whatsapp_messages")
    .select("id, status, created_at, response_ms, attempts")
    .eq("direction", "in")
    .gte("created_at", since24h);
  const items = (rows ?? []) as any[];
  const counts: Record<string, number> = {};
  for (const r of items) counts[r.status] = (counts[r.status] ?? 0) + 1;

  const responded = items.filter((r) => typeof r.response_ms === "number" && r.response_ms > 0);
  const respMs = responded.map((r) => r.response_ms as number);
  const avgResponseMs = respMs.length ? Math.round(respMs.reduce((a, b) => a + b, 0) / respMs.length) : 0;
  const maxResponseMs = respMs.length ? Math.max(...respMs) : 0;
  const overSlaCount = respMs.filter((v) => v > 3000).length;

  const { data: last } = await supabaseAdmin
    .from("whatsapp_messages")
    .select("created_at, status, phone")
    .eq("direction", "in")
    .order("created_at", { ascending: false })
    .limit(1).maybeSingle();

  const pending = (counts.queued ?? 0) + (counts.error ?? 0) + (counts.send_error ?? 0)
    + (counts.transcribe_error ?? 0) + (counts.ai_error ?? 0) + (counts.reprocessing ?? 0);

  return {
    last24h: items.length,
    counts,
    pending,
    processed: counts.processed ?? 0,
    errors: (counts.error ?? 0) + (counts.send_error ?? 0) + (counts.transcribe_error ?? 0) + (counts.ai_error ?? 0),
    failedPermanent: counts.failed_permanent ?? 0,
    respondedCount: responded.length,
    avgResponseMs,
    maxResponseMs,
    overSlaCount,
    slaTargetMs: 3000,
    lastMessageAt: last?.created_at ?? null,
    lastMessageStatus: last?.status ?? null,
  };
}

/**
 * Encontra mensagens elegíveis para reprocessamento e processa em série por telefone.
 * Marca como falha permanente após MAX_ATTEMPTS tentativas para evitar loop infinito.
 */
export async function reprocessPending(opts: { limit?: number; staleProcessingMs?: number } = {}) {
  const limit = opts.limit ?? 25;
  const staleMs = opts.staleProcessingMs ?? 60 * 1000; // 60s p/ liberar lock travado
  const staleCutoff = new Date(Date.now() - staleMs).toISOString();

  // 1) Libera 'processing' travado há mais de N segundos
  await supabaseAdmin
    .from("whatsapp_messages")
    .update({ status: "reprocessing" })
    .eq("direction", "in")
    .eq("status", "processing")
    .lt("processing_started_at", staleCutoff);

  // 2) Marca como failed_permanent quem já estourou MAX_ATTEMPTS
  await supabaseAdmin
    .from("whatsapp_messages")
    .update({ status: "failed_permanent", last_error: "max_attempts_exceeded" })
    .eq("direction", "in")
    .in("status", REPROCESSABLE_STATUSES)
    .gte("attempts", MAX_ATTEMPTS);

  // 3) Busca pendentes ordenadas
  const { data: pending } = await supabaseAdmin
    .from("whatsapp_messages")
    .select("id, phone, status, created_at, attempts")
    .eq("direction", "in")
    .in("status", REPROCESSABLE_STATUSES)
    .lt("attempts", MAX_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(limit);

  const results: { id: string; phone: string; ok: boolean; status?: string; reason?: string }[] = [];
  const seenPhones = new Set<string>();

  for (const row of (pending ?? []) as any[]) {
    // 1 por telefone por rodada para preservar ordem FIFO
    if (seenPhones.has(row.phone)) continue;
    seenPhones.add(row.phone);
    try {
      const r = await processInboundMessage(row.id);
      results.push({ id: row.id, phone: row.phone, ok: r.ok, status: (r as any).status, reason: (r as any).reason });
    } catch (e: any) {
      results.push({ id: row.id, phone: row.phone, ok: false, reason: e?.message ?? "unknown" });
      await supabaseAdmin.from("whatsapp_messages")
        .update({ status: "error", last_error: (e?.message ?? "unknown").slice(0, 500) })
        .eq("id", row.id);
    }
  }

  return { scanned: pending?.length ?? 0, processed: results.length, results };
}
