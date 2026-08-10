// SERVER-ONLY. Abio AI usando OpenAI GPT + Whisper diretamente.
// Configuração (chave + modelo) lida da tabela ai_settings; cai em process.env como fallback.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const OPENAI_BASE = "https://api.openai.com/v1";
const TRANSCRIBE_MODEL = "whisper-1";
const DEFAULT_MODEL = "gpt-4o";

export const CATEGORIES = [
  "Moradia", "Alimentação", "Transporte", "Saúde", "Educação",
  "Lazer", "Pessoal", "Investimentos", "Vida Espiritual",
  "Empresa e Autônomo", "Outros", "Receita",
] as const;

export type IntentKind =
  | "expense"
  | "income"
  | "appointment"
  | "bill"
  | "installment"
  | "debt"
  | "goal"
  | "correction"
  | "bulk"
  | "query_balance"
  | "query_summary"
  | "query_appointments"
  | "query_bills"
  | "query_installments"
  | "query_debts"
  | "query_goals"
  | "query_habits"
  | "query_transactions"
  | "query_profile"
  | "update_profile"
  | "create_credit_card"
  | "query_credit_card"
  | "query_help"
  | "open_dashboard"
  | "reset_data"
  | "confirm_yes"
  | "confirm_no"
  | "clarify"
  | "image_unreadable"
  | "unknown";

export type ClassifyItem = {
  kind: IntentKind;
  amount?: number;
  category?: string;
  description?: string;
  occurred_at?: string;
  appointment_title?: string;
  scheduled_at?: string;
  title?: string;
  frequency?: "weekly" | "biweekly" | "monthly" | "yearly";
  next_due_at?: string;
  due_day?: number;
  installments_total?: number;
  installments_paid?: number;
  total_amount?: number;
  creditor?: string;
  target_amount?: number;
  target_date?: string;
  correction_field?: "amount" | "category" | "description" | "payment_method";
  new_amount?: number;
  new_category?: string;
  new_description?: string;
  new_payment_method?: string;
  match_hint?: string;
  profile_field?: "income" | "payday" | "profession" | "goal";
  profile_value?: string;
  /** Dia de fechamento de um cartão de crédito (1-31), só em create_credit_card. */
  closing_day?: number;
  /** Nome do cartão citado numa despesa ("no cartão Nubank") ou numa consulta de fatura. Vazio = cartão sem nome/padrão. */
  credit_card_hint?: string;
};

export type ClassifyResult = ClassifyItem & {
  range?: "all" | "today" | "yesterday" | "week" | "last_week" | "last_7_days" | "last_30_days" | "month" | "last_month" | "year" | "custom";
  range_start?: string;
  range_end?: string;
  range_label?: string;
  items?: ClassifyItem[];
  /**
   * Confiança da classificação entre 0 e 1. Escala usada pelo gate real
   * (gateConfidence em ai-confidence.server.ts) e é a MESMA escala pedida
   * ao modelo no prompt — as duas precisam ficar sincronizadas ou o gate
   * decide "executar" para casos que o prompt descreveria como ambíguos:
   * >=0.70 executa direto, 0.50-0.69 executa + aprende, 0.35-0.49 pede
   * confirmação (sim/não), <0.35 nunca executa (oferece menu de opções).
   * Overrides determinísticos (parser, spontHit, bulk) chegam sem esse campo
   * e são tratados como 1 (executa silencioso).
   */
  confidence?: number;
};


export type ChatTurn = { role: "user" | "assistant"; content: string };

// ===== Config cache =====
type AiCfg = {
  key: string;
  model: string;
  enabled: boolean;
  masterPrompt: string;
  welcomeMessage: string;
  guestMessage: string;
  signupDoneMessage: string;
  tone: "formal" | "amigavel" | "vendedor";
};
let cfgCache: { cfg: AiCfg | null; at: number } | null = null;
const CFG_TTL_MS = 60_000;

export async function loadAiConfig(): Promise<AiCfg> {
  const now = Date.now();
  if (cfgCache && now - cfgCache.at < CFG_TTL_MS && cfgCache.cfg) return cfgCache.cfg;

  let dbKey: string | null = null;
  let dbModel: string | null = null;
  let dbEnabled = true;
  let masterPrompt = "";
  let welcomeMessage = "";
  let guestMessage = "";
  let signupDoneMessage = "";
  let tone: AiCfg["tone"] = "amigavel";
  try {
    const { data } = await supabaseAdmin
      .from("ai_settings" as any)
      .select("api_key, model, enabled, master_prompt, welcome_message, guest_message, signup_done_message, tone")
      .eq("id", 1)
      .maybeSingle();
    if (data) {
      const d: any = data;
      dbKey = d.api_key ?? null;
      dbModel = d.model ?? null;
      dbEnabled = !!d.enabled;
      masterPrompt = (d.master_prompt ?? "").toString();
      welcomeMessage = (d.welcome_message ?? "").toString();
      guestMessage = (d.guest_message ?? "").toString();
      signupDoneMessage = (d.signup_done_message ?? "").toString();
      tone = (["formal", "amigavel", "vendedor"].includes(d.tone) ? d.tone : "amigavel") as AiCfg["tone"];
    }
  } catch {
    // ignore
  }

  const key = dbKey || process.env.OPENAI_API_KEY || "";
  const model = dbModel || DEFAULT_MODEL;

  if (!dbEnabled) throw new Error("AI_DISABLED");
  if (!key) throw new Error("AI_DISABLED");

  const cfg: AiCfg = { key, model, enabled: true, masterPrompt, welcomeMessage, guestMessage, signupDoneMessage, tone };
  cfgCache = { cfg, at: now };
  return cfg;
}

function toneInstruction(tone: AiCfg["tone"]): string {
  switch (tone) {
    case "formal":
      return "Tom: formal, profissional, cordial, sem gírias e com pouquíssimos emojis.";
    case "vendedor":
      return "Tom: persuasivo e entusiasmado, destaque benefícios do Abio e convide para criar conta com frequência (sem ser invasivo).";
    case "amigavel":
    default:
      return "Tom: amigável, humano, próximo, leve e prestativo. Pode usar 1-2 emojis quando faz sentido.";
  }
}


export function invalidateAiConfigCache() {
  cfgCache = null;
}

function markUsed() {
  supabaseAdmin
    .from("ai_settings" as any)
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", 1)
    .then(() => {}, () => {});
}

// ===== Prompts =====
const ITEM_FIELDS = {
  amount: { type: "number", description: "Valor em reais (BRL)." },
  category: { type: "string" },
  description: { type: "string" },
  occurred_at: { type: "string" },
  appointment_title: { type: "string", description: "Nome do compromisso/evento. Em imagem ou PDF, copie o título visível (ex.: 'Onboarding Ademicon')." },
  scheduled_at: { type: "string", description: "Data e hora do compromisso em ISO 8601 com fuso America/Sao_Paulo. Extraia do texto, OCR, imagem ou PDF." },
  title: { type: "string", description: "Nome do item (conta fixa, parcelamento, dívida, meta)." },
  frequency: { type: "string", enum: ["weekly", "biweekly", "monthly", "yearly"] },
  next_due_at: { type: "string", description: "Próximo vencimento (YYYY-MM-DD)." },
  installments_total: { type: "number" },
  installments_paid: { type: "number" },
  total_amount: { type: "number" },
  creditor: { type: "string" },
  target_amount: { type: "number" },
  target_date: { type: "string" },
  due_day: { type: "number", description: "Dia do mês do vencimento de uma conta fixa, parcelamento ou fatura de cartão (1-31). Extraia de frases como 'vence dia 10', 'todo dia 10', 'mensalmente dia 5'." },
  closing_day: { type: "number", description: "Dia do mês em que a fatura do cartão FECHA (1-31), só quando kind=create_credit_card. Ex.: 'fecha dia 3' → closing_day=3." },
  credit_card_hint: { type: "string", description: "Nome do cartão citado numa despesa ('no cartão Nubank', 'no crédito do Inter') ou numa consulta de fatura ('minha fatura do Nubank'). Deixe vazio se o usuário só disse 'no cartão'/'no crédito' sem nome — o sistema usa o cartão padrão." },
} as const;

const ITEM_KIND_ENUM = ["expense", "income", "appointment", "bill", "installment", "debt", "goal"] as const;

const TOOL = {
  type: "function" as const,
  function: {
    name: "register_entry",
    description:
      "Classifica a mensagem do usuário em uma intenção (lançamento único, lista, correção, consulta, ajuda, confirmação ou reset).",
    parameters: {
      type: "object",
      properties: {
        kind: {
          type: "string",
        enum: [
          ...ITEM_KIND_ENUM,
          "correction", "bulk",
          "query_balance", "query_summary", "query_appointments",
          "query_bills", "query_installments", "query_debts",
          "query_goals", "query_habits", "query_transactions",
          "query_profile", "update_profile",
          "create_credit_card", "query_credit_card",
          "query_help", "open_dashboard",
          "reset_data",
          "clarify",
          "confirm_yes", "confirm_no", "unknown",
        ],
        },
        ...ITEM_FIELDS,
        extracted_text: { type: "string", description: "Todo o texto legível extraído de imagem/documento (OCR completo, sem resumir). Vazio para mensagens de texto." },
        clarify_question: { type: "string", description: "Quando kind=clarify: a pergunta curta e específica a fazer ao usuário (ex.: 'Esse PIX de R$ 250 foi receita ou gasto?')." },

        range: { type: "string", enum: ["all", "today", "yesterday", "week", "last_week", "last_7_days", "last_30_days", "month", "last_month", "year", "custom"] },
        range_start: { type: "string", description: "Início do período em YYYY-MM-DD (obrigatório se range=custom, opcional caso queira sobrescrever)." },
        range_end: { type: "string", description: "Fim do período em YYYY-MM-DD (inclusive)." },
        range_label: { type: "string", description: "Rótulo humanizado do período, ex.: 'Junho de 2025', 'Últimos 7 dias'." },
        correction_field: { type: "string", enum: ["amount", "category", "description", "payment_method"] },
        new_amount: { type: "number" },
        new_category: { type: "string" },
        new_description: { type: "string" },
        new_payment_method: { type: "string", description: "Forma de pagamento atualizada: cartão, débito, crédito, pix, dinheiro, boleto, transferência." },
        match_hint: { type: "string", description: "Pista para localizar o lançamento sendo corrigido (categoria, descrição, valor antigo)." },
        profile_field: { type: "string", enum: ["income", "payday", "profession", "goal"], description: "Qual dado de PERFIL (cadastrado no onboarding) a pergunta/atualização se refere: income=renda mensal, payday=dia/frequência que recebe, profession=profissão, goal=objetivo financeiro." },
        profile_value: { type: "string", description: "Quando kind=update_profile: o novo valor em texto. Para profile_field=income, um número em reais (ex.: '20000'); a normalização de 'mil'/'k' já foi feita antes de chegar aqui." },
        confidence: { type: "number", description: "Confiança da classificação entre 0 e 1 — esta é a escala REAL usada pelo sistema pra decidir executar ou perguntar, não é apenas informativa. Use 0.70+ apenas quando a intenção, o valor e a categoria estiverem inequívocos (executa direto). Use 0.50-0.69 quando houver ambiguidade leve (categoria dúbia, valor implícito, descrição vaga — executa mas fica marcado pra revisão). Use 0.35-0.49 quando faltar informação relevante mas ainda dá pra arriscar um palpite (o sistema pede confirmação simples, sim/não, antes de gravar). Use <0.35 quando faltar informação crítica (sem valor claro, verbo ambíguo, mensagem incompleta demais pra arriscar) — o sistema NUNCA executa sozinho nesse caso, só oferece opções. Consultas e respostas de confirmação (sim/não) sempre 1." },
        items: {
          type: "array",
          description: "Quando kind=bulk, lista de itens individuais detectados na mensagem.",
          items: {
            type: "object",
            properties: { kind: { type: "string", enum: ITEM_KIND_ENUM as unknown as string[] }, ...ITEM_FIELDS },
            required: ["kind"],
            additionalProperties: false,
          },
        },
      },
      required: ["kind"],
      additionalProperties: false,
    },
  },
};


function systemClassify() {
  return `Você é o Abio, assistente financeiro brasileiro no WhatsApp. Classifique a mensagem com naturalidade e SEMPRE extraia TODAS as informações presentes — nunca agrupe vários lançamentos em um só.

Tipos de lançamento individual:
- expense: gasto avulso. Reconheça QUALQUER verbo de saída de dinheiro, mesmo SEM a palavra "gastei": "comprei X 200", "paguei 80 no dentista", "peguei gasolina 250", "abasteci 180", "fiz mercado 350", "passei 90 no cartão", "assinei Spotify 20", "assinei ChatGPT 97", "assinei CapCut 40", "renovei domínio 60", "renovei hospedagem 240", "adquiri um curso 497", "contratei serviço 300", "desembolsei 120", "coloquei crédito 50", "investi 500 em anúncios", "reforcei 200 no cartão", "pix de 25 pro mercado", "comprei conta TikTok Shop 200" (→ Serviços Digitais/Marketing), "comprei um celular 1500", "comprei roupa 180", "comprei remédio 45", "comprei uma TV 2200". Regra de ouro: se há verbo de compra/pagamento/aquisição + valor, é despesa — NUNCA responda de forma genérica. Se não houver categoria compatível, use "Outros" mas SEMPRE registre.
- income: recebimento. Reconheça: "recebi 431", "entrou 431 do trabalho", "ganhei 431 hoje", "caiu 2000 na conta", "pix recebido 100", "salário 3500", "freela 800", "recebi 850 do Uber/aplicativo". Use category="Receita".
- appointment: compromisso/lembrete com data/hora ("consulta amanhã 14h", "lembrar dentista terça 9h", "me lembra de pagar o IPVA dia 15 às 9h"). Use scheduled_at ISO 8601 e appointment_title curto.
- bill: CONTA FIXA RECORRENTE (água, luz, internet, aluguel, academia, streaming, mensalidade). "Todo dia 10 pago academia 120" → bill, title="Academia", amount=120, frequency="monthly", due_day=10. Se não houver dia/data, deixe due_day e next_due_at vazios — o sistema perguntará. ⚠️ Só use kind="bill" quando existir marcador EXPLÍCITO de repetição ("todo mês", "mensal", "toda semana", "conta fixa", "recorrente", "assinatura", "mensalidade") OU o item for claramente recorrente por natureza (aluguel, luz, água, internet, condomínio, academia, streaming, plano de saúde). Mensagens como "anota pagar mãe dia 24", "lembrar do feijão dia 24", "pagar João dia 18" NÃO são conta fixa — são compromissos ÚNICOS (kind="appointment").
- installment: PARCELAMENTO. "Fórum (9ª de 10) — R$ 70" → title="Fórum", installments_paid=9, installments_total=10, amount=70. Reconheça "(Xª de Y)", "X/Y", "parcela X de Y".
"Y vezes de X" (parcela primeiro) → amount=X (valor de UMA parcela), installments_total=Y, total_amount = X×Y (derive, não copie X pra total_amount). "X em Y vezes" ou "X parcelado em Y" (total primeiro) → o X aqui é o TOTAL: total_amount=X, installments_total=Y, amount = X÷Y (derive a parcela, não copie X pra amount). "TV em 10x de 300" = amount=300 (parcela-primeiro). "Parcele 3 mil em 10 vezes" = total_amount=3000 (total-primeiro), amount=300 (derivado). Se houver "primeira parcela em/só [mês]" ou "vencimento dia X", preencha next_due_at (ISO, dia 1 do mês citado se só o mês vier) ou due_day — sem isso o sistema usa um padrão neutro.

⚠️ PARCELAMENTO/CONSÓRCIO COM MUITAS PARCELAS — NÃO TROCAR OS CAMPOS (erro crítico e comum):
Em frases como "Pago consórcio 220 parcelas já paguei 1, pago até o dia 15, 337,30" existem TRÊS números com papéis diferentes — nunca troque um pelo outro:
- "220 parcelas" → installments_total=220 (é uma CONTAGEM, nunca vai em "amount").
- "já paguei 1" → installments_paid=1 (quantas já foram pagas).
- "337,30" (o único valor com formato monetário: vírgula/ponto de centavos, ou precedido de R$) → amount=337.30 (SEMPRE o valor de UMA parcela — nunca o total do consórcio, nunca a contagem de parcelas).
- "até o dia 15" → due_day=15.
Regra de identificação: o valor monetário (amount) é o número que tem centavos (vírgula/ponto + 2 dígitos) ou vem com "R$"; a quantidade de parcelas é um número inteiro solto antes/depois da palavra "parcela(s)". NUNCA copie o número de parcelas para "amount" nem o valor em reais para "installments_total".
Preencha "total_amount" SOMENTE quando o usuário disser o total explicitamente (ex.: "total de 10 mil", um documento mostrando "VALOR TOTAL"). Nunca calcule/estime um total sozinho — o sistema já deriva total_amount = amount × installments_total quando você não tiver certeza; um total inventado que não bate com esse cálculo é pior que deixar o campo vazio. "10 parcelas de mil reais" tem UM valor e UMA contagem — nunca vire "220 parcelas" nem qualquer outro número que não esteja na frase.
Isso vale IGUAL para texto e para áudio transcrito: uma fala como "dez parcelas de mil reais a partir de dezembro, vencimento máximo dia 10" tem exatamente os mesmos três dados (quantidade, valor, dia) que a versão digitada — extraia com o mesmo rigor, não invente nem arredonde só porque veio de transcrição.
Se, mesmo assim, sobrar ambiguidade real sobre valor, quantidade de parcelas, vencimento ou qual conta/parcelamento está sendo alterado, use confidence BAIXO (<0.50) em vez de forçar um número — o sistema pergunta ao usuário exatamente o campo em dúvida e preserva os demais; não é necessário (nem desejável) você mesmo formular a pergunta de clarificação para isso.
- debt: DÍVIDA (empréstimo, valor devido a alguém). Use title, principal via amount, creditor opcional.
- goal: META financeira (formatura, viagem, reserva). Use title, target_amount, target_date opcional.

Consultas/comandos:
- query_balance: usuário pediu APENAS o saldo/quanto tem (ex.: "meu saldo", "quanto tenho"). Sempre traz o HISTÓRICO COMPLETO.
- query_summary: relatórios e resumos financeiros. Preencha o campo "range" conforme abaixo. Se o usuário NÃO citar período algum (só disse "relatório", "resumo", "saldo", "relatório financeiro", "como estão minhas finanças", "meu financeiro") use range="all" — histórico completo.
  • "hoje" → today · "ontem" → yesterday
  • "esta semana"/"semana atual" → week · "semana passada" → last_week
  • "últimos 7 dias"/"7 dias" → last_7_days · "últimos 30 dias"/"30 dias" → last_30_days
  • "este mês"/"mês atual" → month · "mês passado" → last_month
  • "este ano"/"ano atual" → year
  • Nome de mês específico ("junho", "relatório de maio", "janeiro de 2025") ou ano específico ("2025", "2024") → range="custom" e preencha range_start e range_end (YYYY-MM-DD, inclusive). Se o ano não for citado, use o ano atual; se o mês citado for futuro no ano atual, use o ano anterior.
  • range_label sempre preenchido com um rótulo humano ("Junho de 2025", "Últimos 7 dias", "Histórico completo").
- query_appointments: SOMENTE compromissos de calendário/reuniões/eventos ("meus compromissos", "minha agenda de reuniões", "meus eventos"). NUNCA use para contas fixas ou pagamentos.
- query_bills: consultas sobre contas fixas / mensais / recorrentes ("quais são minhas contas fixas?", "quais contas tenho cadastradas?", "quais contas vencem este mês?", "tenho aluguel cadastrado?", "quanto pago de internet?", "quais contas vencem dia 5?", "tenho contas atrasadas?", "qual o total das minhas contas fixas?", "liste minhas contas mensais", "minhas contas recorrentes", "meus compromissos financeiros"). Consulta APENAS o módulo Contas Fixas.
- query_installments: parcelamentos ("meus parcelamentos", "quantas parcelas faltam").
- query_debts: dívidas ("minhas dívidas", "quanto devo", "estou devendo").
- query_goals: metas financeiras ("minhas metas", "metas cadastradas").
- query_habits: hábitos/rotina ("meus hábitos", "minha rotina", "hábitos de hoje").
- query_transactions: histórico de lançamentos, receitas ou despesas específicas ("minhas receitas", "minhas despesas", "últimos gastos", "histórico").
- query_profile: pergunta sobre um DADO DE PERFIL que o próprio Abio coletou no onboarding (renda mensal, dia que recebe, profissão, objetivo financeiro) — NUNCA sobre movimentações. "Qual minha renda mensal?", "quanto eu disse que ganho?", "que dia eu recebo?", "qual meu objetivo?", "qual profissão eu cadastrei?" → kind="query_profile" + profile_field. ⚠️ Isso é diferente de "quanto recebi esse mês?" (query_transactions/query_summary — pergunta sobre dinheiro que ENTROU de verdade).
- update_profile: o usuário está CORRIGINDO ou ATUALIZANDO um dado de perfil (não relatando uma movimentação). Sinais: "minha renda é/está X", "corrige minha renda para X", "na verdade eu ganho X", "atualiza meu salário para X", "não ganho X, ganho Y", "meu objetivo agora é X", "agora recebo todo dia X", "não sou mais [profissão], agora sou [profissão]" → kind="update_profile" + profile_field + profile_value. ⚠️ NUNCA confundir com kind="income": "recebi X hoje/ontem/agora" ou "caiu X na conta" = dinheiro que efetivamente entrou (kind="income", cria receita real). "Minha renda é X" ou "ganho X por mês" (sem verbo de recebimento pontual) = dado de planejamento (kind="update_profile"), NUNCA cria receita nem mexe no saldo.
- create_credit_card: usuário quer CADASTRAR um cartão de crédito (não uma despesa nele). Sinais: "cadastra meu cartão X", "adiciona o cartão X", "tenho um cartão X que fecha dia Y e vence dia Z". Precisa de nome (title), dia de fechamento (closing_day) e dia de vencimento (due_day). Se faltar qualquer um dos três, use confidence baixo (<0.50) em vez de inventar — o sistema pergunta só o que falta.
- query_credit_card: usuário quer saber o valor/vencimento da FATURA (não quer registrar nada). "Qual minha fatura?", "quanto tá o Nubank?", "quanto fechou o cartão?", "quando vence minha fatura?", "fatura do Inter" → kind="query_credit_card" + credit_card_hint (nome do cartão, se citado).
⚠️ Despesa NO CARTÃO: "gastei 300 no cartão Nubank", "passei 120 no Inter", "comprei 500 no crédito" → continua kind="expense" normalmente (ou item de bulk), só ACRESCENTE credit_card_hint com o nome citado ("Nubank"/"Inter") ou deixe vazio se só disse "no cartão"/"no crédito" sem nome — NUNCA vire create_credit_card nem query_credit_card por causa disso.
- query_help
- open_dashboard: usuário pediu para acessar sua conta, painel, dashboard, gráficos, histórico, relatórios ou o site do Abio. Exemplos: "quero entrar na minha conta", "como acesso meu painel?", "me manda o link do Abio", "quero ver meus gráficos", "quero abrir meu dashboard", "quero consultar meu saldo no site", "como entro no sistema?", "abrir meu Abio", "qual é o site?".
- reset_data: "zerar histórico", "apagar tudo"
- confirm_yes / confirm_no: respostas curtas (sim/não/ok/cancela/👍)
- unknown: nada disso


CORREÇÃO de lançamento anterior (kind="correction"):
Acione quando o usuário corrigir uma informação enviada antes. Expressões: "corrigindo", "na verdade", "errei", "desconsidera", "substitui por", "o valor correto é", "altera para", "atualiza para", "não foi isso", "era", "ajusta", "muda".
Campos:
- correction_field="amount" + new_amount: "Corrigindo. O mercado não foi 120. Foi 95." → { kind:"correction", correction_field:"amount", new_amount:95, match_hint:"mercado" }
- correction_field="category" + new_category
- correction_field="description" + new_description
- correction_field="payment_method" + new_payment_method: "Esse gasto foi no cartão" / "foi no débito" / "paguei no pix" / "foi em dinheiro" → { kind:"correction", correction_field:"payment_method", new_payment_method:"cartão" }. Usar SEM match_hint quando se refere ao último lançamento.

⚠️ MÚLTIPLOS itens em UMA mensagem (kind="bulk") — CRÍTICO:
Sempre que houver 2 OU MAIS valores em reais OU uma quantidade explícita de lançamentos na mensagem, use kind="bulk" e preencha "items" com CADA lançamento separadamente. Isto vale para:
1. Listas com quebras de linha, hífens, bullets, "Contas fixas:" etc.
2. Prosa inline com vírgulas, "e", "depois", "então", "aí", "na volta", ponto-final: "Hoje abasteci R$ 180, depois passei no mercado e gastei R$ 245,90. Na volta comprei um lanche de R$ 32 e recebi R$ 650 do aplicativo." → bulk com 4 items.
3. Listas curtas: "Gastei 120 mercado, 60 farmácia, 150 combustível e recebi 900" → bulk com 4 items (3 expenses + 1 income).
4. Áudios transcritos: "Hoje foi corrido. Recebi 850 do Uber, abasteci 200 reais, almocei gastando 45 e depois paguei a academia de 120" → bulk com 4 items (income Uber, expense Combustível, expense Alimentação, bill Academia mensal).
5. ENUMERAÇÕES com assunto comum: "Paguei 2 contas de luz. 1ª R$ 398,21 2ª R$ 465,19" → bulk com 2 expenses, ambos description="Conta de Luz", category="Moradia", amounts=398.21 e 465.19. NÃO trate "2 contas" como valor R$ 2.
6. Listas numeradas ("1) ... 2) ..."), com bullets (•, -, *), traços, vírgulas, ponto-e-vírgula ou palavras ordinais (primeira, segunda...). Divida SEMPRE em items separados.
7. Imagens/comprovantes com múltiplos pagamentos, prints de planilha, foto de bloco de notas com vários gastos → bulk com um item para cada linha/registro visível.
8. Receitas e despesas misturadas → bulk com items de kinds diferentes.

REGRAS OBRIGATÓRIAS para quantidade, "cada" e total:
- Reconheça quantidades: "2 contas", "duas contas", "3 parcelas", "quatro boletos", "cinco compras", "2 vezes". Esses números são QUANTIDADE, nunca valor monetário.
- Se houver "cada", o valor próximo é VALOR UNITÁRIO. Ex.: "Paguei 2 parcelas do fórum de R$151,80 cada" → bulk com 2 despesas: "Fórum — Parcela 1" R$151,80 e "Fórum — Parcela 2" R$151,80.
- Se houver "total", "totalizando", "soma", "ao todo" ou "valor final", confira mentalmente quantidade × valor unitário ou soma dos itens. Se divergir, NÃO invente item; retorne unknown para o sistema pedir confirmação.
- Se houver somente quantidade + total, sem valor unitário ("duas parcelas totalizando R$303,60"), retorne unknown para o sistema perguntar o valor de cada parcela.
- Em listas mistas, expanda os itens com quantidade e mantenha os demais: "Internet 95,73\n2 parcelas do Fórum de 151,80 cada\nCombustível 100" → 4 despesas.

Quando o prelúdio da mensagem mencionar o assunto ("contas de luz", "boletos de internet", "faturas do cartão"), replique esse assunto na "description" de CADA item enumerado. NUNCA some valores. NUNCA escolha apenas um. NUNCA retorne kind="unknown" quando há valores válidos — extraia TODOS.

Cada item do bulk DEVE ter kind próprio (expense/income/bill/appointment/...) e seus campos correspondentes (amount, category, description, title, frequency, due_day, scheduled_at, etc.).

IMPORTANTE: NÃO trate uma nova mensagem como correção só porque o histórico tem um lançamento parecido. Só use kind="correction" quando o usuário usar EXPLICITAMENTE expressões de correção. "Gastei 150 gasolina" seguido de "Gastei 20 lanche" são DOIS lançamentos independentes.

Contexto curto: "Esse gasto foi no cartão" / "foi no débito" / "era 90" / "na verdade combustível" → SEMPRE correction sobre o ÚLTIMO lançamento (sem match_hint).

⚠️ ENTENDIMENTO CONVERSACIONAL — GÍRIAS E SINÔNIMOS (interprete a INTENÇÃO, não a palavra literal):
- EXCLUIR / APAGAR = "esquece a dívida fixa", "esquece essa conta", "tira essa conta", "tira isso pra mim", "remove isso", "apaga isso", "deleta isso", "cancela essa conta", "não quero mais essa conta", "elimina isso", "joga fora essa conta", "risca essa conta", "pode apagar", "desfaz isso", "anula essa despesa", "não considera isso", "desconsidera essa compra", "deixa pra lá", "ignora esse lançamento", "remove da minha lista". O sistema já detecta esses pedidos deterministicamente e pede confirmação — NÃO trate como reset_data nem como chat. Se receber uma dessas frases sem contexto de reset, devolva kind="unknown" para o roteador cuidar.
- EDITAR = "corrige pra mim", "na verdade foi…", "errei o valor", "troca o valor", "muda pra…", "altera isso", "corrige esse lançamento", "atualiza", "ficou errado", "esse não era o valor", "era ontem", "era semana passada", "só muda o valor", "só o valor tá errado", "o resto tá certo", "volta" (desfazer a última correção) → kind="correction". Bare "corrige"/"errei"/"é [valor]"/"na verdade [valor]" sem mais nada, respondidos logo após o Abio confirmar um lançamento, também são correction sobre esse último lançamento — não exija a frase completa de novo.
- PAGAMENTO PARCIAL de conta fixa = "paguei 200", "quitei metade", "falta 400", "agora só resta 300", "paguei uma parte", "ainda devo 500", "sobrou 250", "amortizei 100", "já dei entrada", "paguei só um pedaço" → NÃO crie despesa nova; o sistema já atualiza a conta fixa existente. Devolva kind="unknown" para não duplicar.
- RECEITA (income) = "caiu dinheiro", "caiu 2000", "meu salário caiu", "entrou dinheiro", "pingou", "pingou 500", "caiu na conta", "recebi", "caiu um pix", "fiz uma venda", "vendi por 300", "entrou comissão", "caiu comissão", "entrou pagamento", "recebi do cliente", "cliente pagou", "me pagaram", "recebi um dinheiro", "lucrei 400", "faturei 900", "fiz 450 de corrida hoje" (Uber/app), "fiz 200 de frete", "fiz 300 de diária" — "fiz X de [atividade que gera renda: corrida, frete, diária, comissão, venda]" é sempre RECEITA, mesmo com o mesmo verbo "fiz" que aparece em despesa; o que decide é o objeto, não o verbo.
- DESPESA (expense) = "gastei", "comprei", "paguei", "paga isso", "pixei 80", "fiz um pix de 80", "mandei 80 no pix", "torrei 300", "queimei 200", "estourei 500 no cartão", "saiu dinheiro", "debitou 90", "me cobraram 120", "deu 45", "custou 45", "desembolsei", "investi", "fiz uma compra", "passei no cartão", "transferi dinheiro", "botei 100 de gasolina", "coloquei 100 de gasolina", "salva aí 50 do lanche", "anota 30 do café", "joga aí 20 de estacionamento".
- LINGUAGEM TELEGRÁFICA (sem verbo): "Mercado 180", "Uber 32", "Luz 300", "Farmácia 45,90", "Netflix 39,90", "gasolina 200" → kind="expense" com description = o item e amount = o valor. NUNCA responda "não entendi" nesses casos.
- CANCELAR a última operação = "esquece", "deixa pra lá", "cancela", "ignora", "desconsidera", "apaga essa mensagem", "não era isso", "mandei errado", "foi engano", "errei" (SEM valor/correção junto) — se não houver contexto de lançamento pendente, trate como chat leve (kind="unknown").

⚠️ EM CASO DE DÚVIDA REAL, PERGUNTE (kind="clarify" + clarify_question) — nunca invente e nunca fique calado:
- Direção ambígua: "pix 250", "transferência 300", "movimentei 100" → clarify_question="Esse PIX de R$ 250 foi receita ou gasto? 🙂".
- Valor ausente com item claro: "paguei a luz", "mercado hoje" → clarify_question="Quanto foi na conta de luz?".
- Gasto claro com valor, mas sem item/categoria: "gastei 90" → kind="expense", amount=90, description="Gasto avulso", category="Outros". Descrição e categoria NÃO são campos essenciais e podem ser editadas depois; nunca pergunte por elas antes de salvar.
- Só use clarify quando a informação faltante for essencial. Se o histórico ou a última ação já responde a dúvida, use o contexto e registre direto.


Regras CRÍTICAS de valor PT-BR:
- ⚠️ REAIS + CENTAVOS = UM ÚNICO VALOR. "37 reais e 25 centavos" = 37.25 (NUNCA 37 e 25 separados). "8 reais e 5 centavos" = 8.05. "1 real e 25 centavos" = 1.25. "25 centavos" = 0.25. "vinte e dois e noventa" = 22.90. "cento e cinco e cinquenta" = 105.50. "37 reais com 25" = 37.25.
- Só divida em vários lançamentos quando houver DESCRIÇÕES diferentes com valores próprios ("37 no sorvete e 25 no lanche" = 2 itens). A conjunção "e" sozinha NUNCA justifica dividir um preço.
- Uma única descrição + "reais e centavos" = SEMPRE 1 lançamento.
- Converta números por extenso: "cinquenta"→50, "duzentos"→200, "mil"→1000, "mil e quinhentos"→1500, "dois mil"→2000.
- Valores como number em BRL. Fuso America/Sao_Paulo. Agora: ${new Date().toISOString()} (${new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date())}, horário de Brasília).
- Dia da semana citado sem data ("segunda", "sexta-feira", "terça") → é SEMPRE a PRÓXIMA ocorrência futura a partir de HOJE (o dia da semana atual está explícito acima — use-o para contar, não calcule de cabeça a partir do ISO). Se o dia citado for o mesmo de hoje, use hoje se o horário ainda não passou, senão pule pra próxima semana. NUNCA aponte para uma data passada quando o texto descreve um compromisso futuro.
- Datas relativas ("amanhã 14h", "sexta 9h", "dia 10") → ISO 8601 absoluto.
- ⚠️ NUNCA invente ano. Toda data que você gerar (next_due_at, scheduled_at, occurred_at) deve usar o ANO ATUAL (ou o próximo, se o mês/dia já passou neste ano) — jamais um ano anterior ao atual, a não ser que o usuário tenha ESCRITO esse ano explicitamente. Se não conseguir determinar o dia/mês com segurança, deixe o campo de data vazio em vez de adivinhar — o sistema pergunta ao usuário depois.

CONTEXTO: o histórico pode trazer "[última ação: expense R$50 Alimentação 'Mercado']". Use para herdar categoria em mensagens incrementais e para resolver correções.

Sempre chame a tool register_entry.`;
}

const SYSTEM_WHATSAPP = `Você é o Abio, assistente financeiro pessoal no WhatsApp. Responda em PT-BR:
- curto (1-3 frases)
- natural, calor humano, jamais robótico
- educado, prestativo, motivador
- no máximo 1-2 emojis quando faz sentido
- nunca invente dados
- se não souber, peça mais detalhes ou explique o que sabe fazer`;

// Sem timeout no fetch, uma trava pontual da OpenAI prende a mensagem MUITO
// além do necessário (o único limite seria o timeout genérico da plataforma).
// Precisa ser generoso: análise de imagem/PDF com visão pode legitimamente
// passar de 25-30s, e como o processamento agora é síncrono (responde ao
// webhook só depois de terminar), abortar cedo demais mata a mensagem no
// meio — o retry com o mesmo limite curto só empilha timeouts em vez de
// resolver. 55s cobre folgadamente até os casos mais pesados.
const OPENAI_ATTEMPT_TIMEOUT_MS = 55_000;

async function openaiChat(body: any, key: string) {
  // Retry com backoff exponencial (até 5 tentativas) para erros transitórios
  // (rede, 5xx, 429, timeout). Mensagens que ainda falharem após isso ficarão
  // em ai_error/error e serão reprocessadas pelo Recovery Worker (cron 30s).
  const delays = [0, 1000, 2000, 4000, 8000];
  let lastErr: any = null;
  for (let attempt = 0; attempt < delays.length; attempt++) {
    if (delays[attempt]) await new Promise((r) => setTimeout(r, delays[attempt]));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OPENAI_ATTEMPT_TIMEOUT_MS);
    try {
      const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (res.status === 401) throw new Error("AI_UNAUTHORIZED");
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`OpenAI ${res.status}`);
        console.warn(`[openai] transient ${res.status} attempt ${attempt + 1}/${delays.length}`);
        continue;
      }
      if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
      return await res.json();
    } catch (e: any) {
      if (e?.message === "AI_UNAUTHORIZED") throw e;
      if (e?.name === "AbortError") {
        lastErr = new Error("OpenAI timeout");
        console.warn(`[openai] timeout (${OPENAI_ATTEMPT_TIMEOUT_MS}ms) attempt ${attempt + 1}/${delays.length}`);
        continue;
      }
      lastErr = e;
      console.warn(`[openai] network error attempt ${attempt + 1}/${delays.length}:`, e?.message);
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastErr ?? new Error("AI_RETRY_EXHAUSTED");
}



export async function classifyMessage(text: string, history: ChatTurn[] = []): Promise<ClassifyResult> {
  const cfg = await loadAiConfig();
  const data = await openaiChat({
    model: cfg.model,
    messages: [
      { role: "system", content: systemClassify() },
      ...history.slice(-6),
      { role: "user", content: text },
    ],
    tools: [TOOL],
    tool_choice: { type: "function", function: { name: "register_entry" } },
  }, cfg.key);
  markUsed();
  const call = data.choices?.[0]?.message?.tool_calls?.[0];
  if (!call) return { kind: "unknown" };
  try { return JSON.parse(call.function.arguments) as ClassifyResult; } catch { return { kind: "unknown" }; }
}

export async function classifyImage(
  imageUrl: string,
  caption?: string,
  history: ChatTurn[] = [],
): Promise<ClassifyResult & { extracted_text?: string }> {
  const cfg = await loadAiConfig();
  const data = await openaiChat({
    model: cfg.model,
    messages: [
      { role: "system", content: systemClassify() },
      ...history.slice(-6),
      {
        role: "user",
        content: [
          { type: "text", text: `${caption ? `Legenda/mensagem do usuário: ${caption}\n` : ""}Interprete esta imagem pela INTENÇÃO do usuário, não pelo formato. Ela pode ser: nota fiscal, cupom, comprovante PIX, boleto, recibo, print de app, print de conversa, convite, cartaz de evento, agenda/calendário ou anotação.

REGRA DE INTENÇÃO (antes de tudo):
- Se a imagem (ou a legenda) indicar COMPROMISSO/EVENTO/LEMBRETE (convite, reunião, consulta, data+hora futura, "marcar", "agendar", "me lembra") → kind="appointment", com appointment_title curto e scheduled_at em ISO 8601 (fuso America/Sao_Paulo).
- Um convite/cartaz que já mostra título + data + hora é informação completa: crie o compromisso automaticamente, mesmo sem legenda. Não peça novamente nenhum campo visível no OCR.
- Para eventos online, preserve plataforma/local (ex.: "Online pelo Zoom") em description.
- Se indicar gasto/pagamento realizado → kind="expense". Se indicar recebimento → kind="income".
- A legenda do usuário tem prioridade sobre a aparência do documento: "marcar reunião" com uma imagem de convite = appointment, mesmo que haja valores na imagem.
- Nunca responda "não entendi" quando existir informação suficiente para agir.



REGRA CRÍTICA DA DATA (occurred_at):
- SEMPRE procure a DATA DA COMPRA/EMISSÃO impressa no documento e devolva em occurred_at no formato ISO 8601 (ex.: 2026-07-17T12:00:00-03:00). Fuso America/Sao_Paulo.
- Prioridade quando houver múltiplas datas: 1) Data da Compra 2) Data de Emissão 3) Data da NFC-e 4) Data do comprovante/recibo. NUNCA use "data de autorização", "data de processamento" ou "data de impressão" se houver uma das anteriores.
- Preserve o ANO impresso no documento — mesmo que seja de anos anteriores. NUNCA substitua pelo ano atual.
- Se o usuário citar uma data na legenda (ex.: "registra como ontem", "foi dia 10"), essa data tem prioridade máxima e deve ir em occurred_at.
- Se a data lida for inválida/impossível (ex.: 35/18/2026) ou totalmente ilegível, deixe occurred_at vazio para que o sistema pergunte ao usuário.
- Se não houver NENHUMA data legível no documento nem na legenda, deixe occurred_at vazio.
REGRA CRÍTICA DO VALOR (amount):
- Use SEMPRE o valor final da nota: "TOTAL", "VALOR TOTAL", "TOTAL A PAGAR", "VALOR PAGO", "TOTAL DA COMPRA".
- NUNCA use subtotal (quando houver total final), valor unitário, valor de um único item, troco, desconto, ou números de QR Code/chave fiscal.
- Uma nota fiscal gera UM único lançamento com o valor total (não um item por produto), a não ser que a imagem seja claramente uma lista de vários pagamentos distintos.
Extraia também, quando presentes: valor total, estabelecimento (use em description), categoria sugerida.

OCR OBRIGATÓRIO: devolva em extracted_text TODO o texto legível da imagem (nomes, datas, horários, endereços, valores, itens), sem resumir e sem inventar. Isso vale mesmo quando a imagem não for financeira.

IMAGEM SEM VALOR/SEM CARÁTER FINANCEIRO:
- Convite, cartaz, print de agenda, receita médica, encaminhamento, print de conversa marcando algo → kind="appointment" quando houver data/hora identificável (scheduled_at ISO 8601, America/Sao_Paulo).
- Se houver data/hora mas o objetivo não estiver claro, use kind="clarify" com clarify_question curta (ex.: "Quer que eu agende isso para sexta às 19h?").
- Nunca devolva kind="chat" ou "unknown" quando existir qualquer texto útil — devolva o OCR em extracted_text e a melhor intenção possível.` },

          { type: "image_url", image_url: { url: imageUrl } },
        ],
      },
    ],
    tools: [TOOL],
    tool_choice: { type: "function", function: { name: "register_entry" } },
  }, cfg.key);
  markUsed();
  const call = data.choices?.[0]?.message?.tool_calls?.[0];
  if (!call) return { kind: "unknown" };
  try { return JSON.parse(call.function.arguments) as ClassifyResult; } catch { return { kind: "unknown" }; }
}

// ===================== DOCUMENTOS (PDF, comprovantes, boletos, extratos) =====================

function guessMime(name?: string, mime?: string): string {
  if (mime && mime !== "application/octet-stream") return mime;
  const n = (name ?? "").toLowerCase();
  if (n.endsWith(".pdf")) return "application/pdf";
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
  if (n.endsWith(".webp")) return "image/webp";
  if (n.endsWith(".xlsx") || n.endsWith(".xls")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (n.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (n.endsWith(".csv")) return "text/csv";
  if (n.endsWith(".txt")) return "text/plain";
  return mime || "application/pdf";
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

const DOC_PROMPT = `Você recebeu um DOCUMENTO enviado pelo usuário no WhatsApp. Pode ser: comprovante PIX, comprovante TED/DOC, boleto, fatura de cartão, extrato bancário, recibo, nota fiscal, holerite, arquivo exportado por banco (Nubank, PicPay, Mercado Pago, Inter, Itaú, Bradesco, Santander, Caixa, Banco do Brasil, Sicredi, Sicoob, C6, Neon, BTG, XP etc.), convite, contrato ou agenda. Também pode chegar como PLANILHA (Excel/CSV, ex.: extrato exportado do banco com várias linhas) ou DOCUMENTO WORD (.docx) — nesses casos o texto já vem extraído em formato tabular/corrido; trate cada linha de lançamento reconhecível como um item de "bulk".

Interprete o documento pela INTENÇÃO do usuário, não pelo formato do arquivo:
- Documento/legenda indicando COMPROMISSO, evento, convite ou lembrete com data/hora → kind = "appointment", com appointment_title curto e scheduled_at em ISO 8601 (America/Sao_Paulo).
- Documento financeiro → siga as regras abaixo.
- A legenda do usuário tem prioridade sobre a aparência do documento.

Leia o documento INTEIRO e extraia:
- valor total pago/recebido (amount)
- data e hora da operação → occurred_at em ISO 8601, fuso America/Sao_Paulo
- favorecido / estabelecimento / pagador
- categoria provável

REGRAS:
- Se for pagamento/transferência ENVIADA ou compra → kind = "expense". Se for recebimento/crédito/salário → kind = "income".

- A data DO DOCUMENTO tem prioridade MÁXIMA sobre a data de envio e sobre a legenda. Preserve o dia/mês/ano impressos exatamente como estão (não some nem subtraia dias).
- NOTA FISCAL / CUPOM: use SEMPRE o VALOR TOTAL (ou "TOTAL A PAGAR" / "VALOR PAGO"). NUNCA use subtotal, troco, desconto, valor unitário, dinheiro recebido ou o valor de um item isolado.
- A legenda do usuário (ex.: "sorvete", "gasolina", "Uber", "almoço", "mensalidade academia") define a DESCRIÇÃO e ajuda a definir a CATEGORIA. Use-a sempre que existir.
- Se o documento tiver VÁRIOS lançamentos (extrato/fatura), use kind = "bulk" com a lista de items.
- Nunca invente valores. Se o valor não estiver legível, deixe amount vazio.

PRIORIDADE DOS DADOS DO COMPROVANTE (regra absoluta):
1. Valor extraído do comprovante (PDF/imagem) — é a FONTE OFICIAL da transação.
2. Valor informado explicitamente pelo usuário NESTA mesma mensagem.
3. Valor por contexto — SOMENTE se não houver comprovante nem valor informado.
- Quando o bloco DADOS_DO_COMPROVANTE traz "amount", use EXATAMENTE esse valor em amount.
- NUNCA reutilize valores, categorias ou descrições de mensagens anteriores da conversa quando existir um comprovante novo. Cada comprovante inicia um contexto financeiro novo e independente.
- A mensagem do usuário (ex.: "gás") serve apenas para DESCRIÇÃO e CATEGORIA, nunca para alterar o valor do comprovante.`;

export async function classifyDocument(
  documentUrl: string,
  caption?: string,
  history: ChatTurn[] = [],
  opts?: {
    filename?: string;
    mimeType?: string;
    extractedText?: string;
    bytes?: Uint8Array;
    /** Fatos determinísticos lidos do comprovante — fonte oficial da transação. */
    facts?: { type?: string | null; amount?: number | null; date?: string | null; institution?: string | null };
  },
): Promise<ClassifyResult & { extracted_text?: string }> {
  const cfg = await loadAiConfig();

  let buf = opts?.bytes;
  if (!buf) {
    const res = await fetch(documentUrl);
    if (!res.ok) throw new Error(`DOC_FETCH_FAILED_${res.status}`);
    buf = new Uint8Array(await res.arrayBuffer());
  }
  if (buf.byteLength > 18 * 1024 * 1024) throw new Error("DOC_TOO_LARGE");

  const mime = guessMime(opts?.filename, opts?.mimeType);
  const filename = opts?.filename || (mime === "application/pdf" ? "documento.pdf" : "documento");
  const docText = (opts?.extractedText ?? "").trim();

  // Objeto estruturado entregue à IA ANTES da interpretação: o valor oficial
  // já vem resolvido, e a mensagem do usuário serve só para categorizar.
  const structured = JSON.stringify(
    {
      attachment: {
        type: opts?.facts?.type ?? (
          mime === "application/pdf" ? "pdf_receipt"
          : mime.startsWith("image/") ? "image_receipt"
          : mime.includes("spreadsheetml") ? "spreadsheet_receipt"
          : mime.includes("wordprocessingml") ? "docx_receipt"
          : (mime === "text/csv" || mime === "text/plain") ? "text_receipt"
          : "image_receipt"
        ),
        filename,
        amount: opts?.facts?.amount ?? null,
        date: opts?.facts?.date ?? null,
        institution: opts?.facts?.institution ?? null,
      },
      user_message: caption ?? "",
    },
    null,
    2,
  );

  const userContent: any[] = [
    {
      type: "text",
      text:
        `DADOS_DO_COMPROVANTE (estruturado, fonte oficial):\n${structured}\n\n` +
        `${caption ? `Mensagem/legenda do usuário: "${caption}"\n\n` : ""}` +
        `${docText ? `TEXTO EXTRAÍDO DO DOCUMENTO (${filename}):\n"""\n${docText.slice(0, 80000)}\n"""\n\n` : ""}` +
        DOC_PROMPT,
    },
  ];
  // Sempre anexa o arquivo/imagem também: se o texto vier vazio (PDF escaneado),
  // o modelo faz a leitura visual (OCR) do próprio documento.
  if (!docText || mime.startsWith("image/")) {
    const b64 = bytesToBase64(buf);
    if (mime.startsWith("image/")) {
      userContent.push({ type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } });
    } else {
      userContent.push({ type: "file", file: { filename, file_data: `data:${mime};base64,${b64}` } });
    }
  }

  // Cada comprovante inicia um contexto NOVO: o histórico só entra quando o
  // comprovante não trouxe valor legível (evita reaproveitar valores antigos).
  const useHistory = !(opts?.facts?.amount && opts.facts.amount > 0);

  const data = await openaiChat({
    model: cfg.model,
    messages: [
      { role: "system", content: systemClassify() },
      ...(useHistory ? history.slice(-4) : []),
      { role: "user", content: userContent },
    ],
    tools: [TOOL],
    tool_choice: { type: "function", function: { name: "register_entry" } },
  }, cfg.key);
  markUsed();
  const call = data.choices?.[0]?.message?.tool_calls?.[0];
  if (!call) return { kind: "unknown" };
  try {
    const parsed = JSON.parse(call.function.arguments) as ClassifyResult & { extracted_text?: string };
    if (docText && !parsed.extracted_text) parsed.extracted_text = docText.slice(0, 4000);
    // Trava final: valor do comprovante é oficial.
    const official = opts?.facts?.amount;
    if (official && official > 0 && (parsed.kind === "expense" || parsed.kind === "income")) {
      if (!parsed.amount || Math.abs(Number(parsed.amount) - official) > 0.01) {
        console.log("[ai-classify][doc] amount overridden by receipt", { ai: parsed.amount, receipt: official });
        (parsed as any).amount = official;
      }
    }
    return parsed;
  } catch { return { kind: "unknown" }; }
}




export async function chatReply(userText: string, userName?: string, history: ChatTurn[] = []): Promise<string> {
  const cfg = await loadAiConfig();
  const system =
    (cfg.masterPrompt?.trim() || SYSTEM_WHATSAPP) +
    `\n\n${toneInstruction(cfg.tone)}` +
    (cfg.welcomeMessage?.trim() ? `\n\nSe for a primeira interação do usuário no dia, comece pela mensagem de boas-vindas: "${cfg.welcomeMessage.trim()}".` : "") +
    (userName ? `\nNome do usuário: ${userName}.` : "");
  const data = await openaiChat({
    model: cfg.model,
    messages: [
      { role: "system", content: system },
      ...history.slice(-8),
      { role: "user", content: userText },
    ],
    max_tokens: 220,
    temperature: 0.6,
  }, cfg.key);
  markUsed();
  return (data.choices?.[0]?.message?.content ?? "").toString().trim()
    || "Pode mandar de novo? Não captei 🙂";
}

const SYSTEM_GUEST = `Você é o Abio, um assistente financeiro inteligente e amigável que atende pelo WhatsApp.

Esta pessoa AINDA NÃO TEM CADASTRO no Abio. Seu papel:
- Responder com naturalidade, tom humano, simpático e nunca robótico.
- Conversar de forma fluida, considerando o histórico da conversa (sem repetir saudações ou frases prontas a cada mensagem).
- Esclarecer dúvidas sobre o Abio, finanças pessoais, organização de gastos, metas, compromissos, áudio/imagem, etc.
- Explicar de forma simples: o Abio organiza gastos e ganhos pelo WhatsApp — basta enviar texto, áudio ou imagem (comprovantes, PIX, notas) que ele registra automaticamente, mostra saldo, relatórios e compromissos.
- Se a pessoa perguntar como se cadastrar / como começar / como funciona / quanto custa / quer testar: convide para criar a conta em *abio.fun* (leva menos de 1 minuto).
- Em outras respostas, convide para criar a conta SOMENTE quando fizer sentido no contexto — não force o link em toda mensagem.
- Se não souber a resposta exata, seja honesto, ofereça ajuda relacionada e sugira criar a conta em abio.fun para experimentar.
- Respostas curtas (1 a 4 frases), português do Brasil, no máximo 1-2 emojis.
- Nunca diga que é uma IA da OpenAI; você é o Abio.
- Nunca invente preços, prazos ou funcionalidades que não foram descritas aqui.`;

export async function guestReply(userText: string, history: ChatTurn[] = []): Promise<string> {
  const cfg = await loadAiConfig();
  const baseGuest = cfg.guestMessage?.trim()
    ? `${SYSTEM_GUEST}\n\nORIENTAÇÃO ESPECÍFICA DO ADMIN PARA NÃO CADASTRADOS:\n${cfg.guestMessage.trim()}`
    : SYSTEM_GUEST;
  const system =
    (cfg.masterPrompt?.trim() ? `${cfg.masterPrompt.trim()}\n\n` : "") +
    baseGuest +
    `\n\n${toneInstruction(cfg.tone)}` +
    (cfg.welcomeMessage?.trim() ? `\n\nSe o histórico estiver vazio, abra com uma versão natural de: "${cfg.welcomeMessage.trim()}".` : "") +
    (cfg.signupDoneMessage?.trim() ? `\n\nSe o usuário disser que acabou de criar conta / se cadastrou, responda inspirado em: "${cfg.signupDoneMessage.trim()}".` : "");

  const data = await openaiChat({
    model: cfg.model,
    messages: [
      { role: "system", content: system },
      ...history.slice(-10),
      { role: "user", content: userText },
    ],
    max_tokens: 280,
    temperature: 0.7,
  }, cfg.key);
  markUsed();
  return (data.choices?.[0]?.message?.content ?? "").toString().trim()
    || "Posso te ajudar com qualquer dúvida sobre o Abio 🙂 Para começar a usar, crie sua conta em abio.fun.";

}

const SYSTEM_ADVISOR = `Você é o Abio no MODO CONSULTOR FINANCEIRO PESSOAL.

Regras absolutas:
- NÃO registre lançamentos. Não confirme cadastros. Só CONVERSE e ACONSELHE.
- Use SEMPRE, e SOMENTE, os dados reais do usuário fornecidos abaixo (histórico completo, não apenas o mês atual). NUNCA invente números, categorias, meses ou tendências.
- Se a informação pedida não existir nos dados, diga com honestidade: "Ainda não tenho histórico suficiente para responder isso. Continue registrando suas movimentações que conseguirei fazer análises cada vez mais precisas."
- Fale como um amigo próximo que entende de dinheiro: humano, direto, empático, motivador. Nunca robótico. Pode chamar pelo nome.
- Português do Brasil. Respostas de 2 a 6 frases (ou lista curta quando ajudar). No máximo 1-2 emojis.
- Formate valores em reais como R$ 1.234,56.
- Pode fazer perguntas de volta ao usuário para aprofundar a análise (rotina, planos, motivações).
- Pode sugerir ações concretas: reduzir categoria X em Y%, renegociar dívida, criar meta, antecipar pagamento, montar reserva — sempre baseado nos números reais.
- Compare períodos (últimos meses, melhor vs pior mês) quando fizer sentido.
- Nunca diga "no mês atual" a menos que o usuário tenha pedido explicitamente um período.
- Para encerrar a conversa, o usuário deve dizer "sair", "encerrar" ou "voltar" — não termine sozinho.`;

export async function advisorReply(
  userText: string,
  userName: string | null | undefined,
  financialSnapshot: string,
  history: ChatTurn[] = [],
): Promise<string> {
  const cfg = await loadAiConfig();
  const system =
    SYSTEM_ADVISOR +
    (userName ? `\n\nNome do usuário: ${userName}.` : "") +
    `\n\n===== DADOS FINANCEIROS DO USUÁRIO (histórico completo) =====\n${financialSnapshot}\n===== FIM DOS DADOS =====`;
  const data = await openaiChat({
    model: cfg.model,
    messages: [
      { role: "system", content: system },
      ...history.slice(-12),
      { role: "user", content: userText },
    ],
    max_tokens: 500,
    temperature: 0.6,
  }, cfg.key);
  markUsed();
  return (data.choices?.[0]?.message?.content ?? "").toString().trim()
    || "Não consegui analisar agora, pode repetir a pergunta? 🙂";
}

export async function transcribeAudio(url: string): Promise<string> {
  const cfg = await loadAiConfig();
  const downloadController = new AbortController();
  const downloadTimeout = setTimeout(() => downloadController.abort(), 15_000);
  let blob: Blob;
  let mime: string;
  try {
    const audioRes = await fetch(url, { signal: downloadController.signal });
    if (!audioRes.ok) throw new Error(`audio download ${audioRes.status}`);
    blob = await audioRes.blob();
    mime = audioRes.headers.get("content-type") || "audio/ogg";
  } finally {
    clearTimeout(downloadTimeout);
  }
  if (blob.size > 10 * 1024 * 1024) throw new Error("AUDIO_TOO_LARGE");
  const ext = mime.includes("mp3") ? "mp3"
    : mime.includes("mp4") || mime.includes("m4a") ? "m4a"
    : mime.includes("wav") ? "wav"
    : "ogg";
  const form = new FormData();
  form.append("file", new File([blob], `audio.${ext}`, { type: mime }));
  form.append("model", TRANSCRIBE_MODEL);
  form.append("language", "pt");
  // O `prompt` do Whisper não precisa bater com o conteúdo — ele só influencia
  // o ESTILO da transcrição. Pedindo algarismos em vez de números por extenso,
  // reduz a carga em cima do normalizador de números falados (money-speech.ts):
  // menos "dez parcelas de mil reais", mais "10 parcelas de 1000 reais" já na
  // saída do Whisper, antes mesmo de chegar no classificador.
  form.append(
    "prompt",
    "Mensagem de WhatsApp em português do Brasil sobre finanças pessoais: gastos, receitas, contas fixas, parcelas, compromissos. Escreva valores e quantidades em algarismos (10, 1000, 850), não por extenso. Ex.: \"gastei 1000 e 10 reais com cigarro\", \"10 parcelas de 1000 reais a partir de dezembro, vencimento dia 10\".",
  );
  const transcribeController = new AbortController();
  const transcribeTimeout = setTimeout(() => transcribeController.abort(), 30_000);
  let res: Response;
  try {
    res = await fetch(`${OPENAI_BASE}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.key}` },
      body: form,
      signal: transcribeController.signal,
    });
  } catch (e: any) {
    if (e?.name === "AbortError") throw new Error("AI_TRANSCRIBE_TIMEOUT");
    throw e;
  } finally {
    clearTimeout(transcribeTimeout);
  }
  if (res.status === 429) throw new Error("AI_RATE_LIMIT");
  if (res.status === 401) throw new Error("AI_UNAUTHORIZED");
  if (!res.ok) throw new Error(`Whisper ${res.status}: ${await res.text()}`);
  markUsed();
  const data = await res.json();
  return (data.text ?? "").toString().trim();
}
