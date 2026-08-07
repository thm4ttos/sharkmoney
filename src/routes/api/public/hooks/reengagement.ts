// Reengajamento inteligente: detecta usuários com 3 dias sem enviar mensagem
// e envia uma única mensagem aleatória por dia (10 modelos), com opção de
// desativar apenas esse tipo de lembrete.
//
// Regras:
// - Só envia se o usuário está ativo, tem telefone e reengagement_enabled = true.
// - Última mensagem inbound (whatsapp_messages, direction=in) >= 3 dias atrás
//   (ou nunca enviou nada). Onboarding concluído (welcome_sent_at not null).
// - Nunca mais de 1 mensagem por dia (reengagement_last_sent_at).
// - Escolhe template aleatório, diferente do último.
// - Deixa pending_action { kind: "reengagement_prompt" } por 7 dias para
//   capturar a resposta "1" ou "2".
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendWhatsAppText } from "@/lib/uazapi.server";

const ok = (b: unknown = { ok: true }) =>
  new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });
const fail = (s: number, m: string) =>
  new Response(JSON.stringify({ error: m }), { status: s, headers: { "Content-Type": "application/json" } });

const PANEL_URL = "https://abio.fun/";
const FOOTER = `\n\n1️⃣ Continuar recebendo lembretes\n2️⃣ Não receber mais esses lembretes`;

const TEMPLATES: string[] = [
  `👋 Faz alguns dias que você não registra nenhuma movimentação.\n\nQue tal atualizar suas finanças hoje?\n\nVocê também pode acessar seu painel completo para acompanhar gráficos, categorias e relatórios.\n\n📊 Acesse seu painel:\n${PANEL_URL}`,
  `💰 Pequenos registros fazem uma grande diferença.\n\nJá faz 3 dias desde sua última movimentação.\n\nEnvie um gasto, uma receita ou acesse seu painel para acompanhar sua evolução financeira.\n\n📈 Painel:\n${PANEL_URL}`,
  `🚀 Seu controle financeiro fica mais preciso quando você registra tudo.\n\nQue tal lançar as movimentações dos últimos dias?\n\nOu acompanhar tudo pelo painel.\n\n📊 ${PANEL_URL}`,
  `📅 Já faz alguns dias que você não conversa comigo.\n\nTem algum gasto ou receita para registrar?\n\nSe preferir, veja seus gráficos e relatórios completos.\n\n📊 ${PANEL_URL}`,
  `📉 Quanto mais tempo sem registrar, menos precisos ficam seus relatórios.\n\nVamos atualizar suas movimentações?\n\nOu acesse o painel para acompanhar sua situação financeira.\n\n📊 ${PANEL_URL}`,
  `🤖 Estou aqui para ajudar no seu controle financeiro.\n\nPode me enviar um texto, áudio, imagem ou comprovante que eu faço o restante.\n\nOu consulte seu painel completo.\n\n📊 ${PANEL_URL}`,
  `📊 Como andam suas finanças?\n\nFaz alguns dias sem novos registros.\n\nAtualize suas movimentações ou veja seus relatórios completos no painel.\n\n📈 ${PANEL_URL}`,
  `💡 Registrar seus gastos leva poucos segundos e ajuda a manter tudo organizado.\n\nQue tal registrar o que aconteceu nos últimos dias?\n\nOu acessar seu painel.\n\n📊 ${PANEL_URL}`,
  `🎯 Seu objetivo financeiro continua em andamento.\n\nVolte a registrar suas movimentações para manter seus gráficos sempre atualizados.\n\n📊 ${PANEL_URL}`,
  `😊 Faz alguns dias que não nos falamos.\n\nQuando quiser, é só enviar uma mensagem como:\n\n• Gastei R$ 50 no mercado\n• Recebi R$ 300\n• Me mostra meu relatório\n\nOu acesse seu painel completo.\n\n📊 ${PANEL_URL}`,
];

function pickTemplate(lastIdx: number | null): { idx: number; text: string } {
  const pool = TEMPLATES.map((_, i) => i).filter((i) => i !== lastIdx);
  const idx = pool[Math.floor(Math.random() * pool.length)];
  return { idx, text: TEMPLATES[idx] + FOOTER };
}

export const Route = createFileRoute("/api/public/hooks/reengagement")({
  server: {
    handlers: {
      GET: async ({ request }) => handle(request),
      POST: async ({ request }) => handle(request),
    },
  },
});

async function handle(request: Request) {
  const url = new URL(request.url);
  const apikey = request.headers.get("apikey") || url.searchParams.get("apikey");
  const tok = request.headers.get("x-webhook-token") || url.searchParams.get("token");
  const validApi = !!apikey && apikey === (process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY);
  const validTok = !!tok && tok === process.env.UAZAPI_WEBHOOK_TOKEN;
  if (!validApi && !validTok) return fail(401, "unauthorized");

  const now = Date.now();
  const threeDaysAgo = new Date(now - 3 * 86400_000).toISOString();
  const oneDayAgo = new Date(now - 86400_000).toISOString();

  // Candidatos: usuários ativos com reengagement habilitado, com telefone,
  // que ainda não receberam lembrete nas últimas 24h, e que já concluíram
  // o onboarding (welcome_sent_at not null → evita colidir com fluxo inicial).
  const { data: candidates, error } = await supabaseAdmin
    .from("profiles")
    .select("id, phone, name, reengagement_last_template, reengagement_last_sent_at, welcome_sent_at")
    .eq("status", "active")
    .eq("reengagement_enabled", true)
    .not("phone", "is", null)
    .not("welcome_sent_at", "is", null)
    .or(`reengagement_last_sent_at.is.null,reengagement_last_sent_at.lt.${oneDayAgo}`)
    .limit(500);

  if (error) return fail(500, error.message);
  if (!candidates || candidates.length === 0) return ok({ checked: 0, sent: 0 });

  let sent = 0, skipped = 0, failed = 0;

  for (const p of candidates as any[]) {
    if (!p.phone) { skipped++; continue; }

    // Última mensagem inbound do usuário
    const { data: lastIn } = await supabaseAdmin
      .from("whatsapp_messages")
      .select("created_at")
      .eq("user_id", p.id)
      .eq("direction", "in")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Se existe alguma inbound recente (< 3 dias), pula.
    if (lastIn && new Date(lastIn.created_at as string).toISOString() > threeDaysAgo) {
      skipped++; continue;
    }
    // Se nunca enviou nada e onboarding é recente (<3 dias), pula.
    if (!lastIn) {
      const w = p.welcome_sent_at ? new Date(p.welcome_sent_at).toISOString() : null;
      if (!w || w > threeDaysAgo) { skipped++; continue; }
    }

    const { idx, text } = pickTemplate(typeof p.reengagement_last_template === "number" ? p.reengagement_last_template : null);
    const res = await sendWhatsAppText(p.phone, text);

    if (res.ok) {
      await supabaseAdmin.from("profiles").update({
        reengagement_last_sent_at: new Date().toISOString(),
        reengagement_last_template: idx,
      }).eq("id", p.id);

      // pending_action para capturar "1" ou "2"
      const expires_at = new Date(now + 7 * 86400_000).toISOString();
      const { data: existing } = await supabaseAdmin
        .from("wa_contacts").select("id").eq("phone", p.phone).maybeSingle();
      if (existing) {
        await supabaseAdmin.from("wa_contacts")
          .update({ pending_action: { kind: "reengagement_prompt", expires_at } as any })
          .eq("phone", p.phone);
      } else {
        await supabaseAdmin.from("wa_contacts").insert({
          phone: p.phone, name: p.name ?? null,
          pending_action: { kind: "reengagement_prompt", expires_at } as any,
        });
      }

      await supabaseAdmin.from("whatsapp_messages").insert({
        user_id: p.id, phone: p.phone, direction: "out", media_type: "text",
        content: text, status: "sent",
        raw: { send: res, source: "reengagement", template: idx } as any,
      });
      sent++;
    } else {
      failed++;
    }
  }

  return ok({ checked: candidates.length, sent, skipped, failed });
}
