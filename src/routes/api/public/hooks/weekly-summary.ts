// Fechamento semanal automático via WhatsApp (domingo 19h SP).
//
// Ações:
//  • action=ask (padrão, cron domingo 19h SP): envia AUTOMATICAMENTE o
//    resumo da semana para cada usuário elegível. Duas trilhas:
//      - Teve movimentações: intro aleatória (7) + resumo detalhado
//        + convite para o painel.
//      - Não teve movimentações: mensagem motivacional aleatória (7)
//        + opção de desativar o resumo semanal (responder "2" ou "não").
//        Cria pending_action {kind:"weekly_optout"}.
//  • action=send&type=weekly|monthly: mantém envio manual/admin.
//  • action=fallback: mantido como no-op (compat).
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendWhatsAppText } from "@/lib/uazapi.server";

const ok = (b: unknown = { ok: true }) =>
  new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });
const fail = (s: number, m: string) =>
  new Response(JSON.stringify({ error: m }), { status: s, headers: { "Content-Type": "application/json" } });

const BRL = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });

const PANEL_URL = "https://abio.fun/app/dashboard";

function ymd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fmtDayMonth(d: Date) {
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function weekKey(ref = new Date()) {
  const d = new Date(ref);
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  return `W${ymd(d)}`;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

// 7 intros para quando o usuário TEVE movimentações
const INTROS_WITH_DATA: ((firstName: string) => string)[] = [
  (n) => `🎉 *Mais uma semana concluída${n ? `, ${n}` : ""}!*\n\nPreparei seu fechamento financeiro. Confira abaixo como foi sua semana. 👇`,
  (n) => `🚀 *Fechamos mais uma semana${n ? `, ${n}` : ""}!*\n\nOrganizei todas as suas movimentações para facilitar sua análise.`,
  (n) => `💰 *Seu fechamento semanal está pronto${n ? `, ${n}` : ""}!*\n\nConfira abaixo tudo o que entrou, saiu e como ficou seu saldo.`,
  (n) => `👏 *Hora de conferir sua evolução financeira${n ? `, ${n}` : ""}!*\n\nSeparei um resumo completo da sua semana.`,
  (n) => `📈 *Mais uma semana registrada${n ? `, ${n}` : ""}!*\n\nVeja abaixo como ficaram suas finanças.`,
  (n) => `✨ *Seu relatório semanal acabou de ficar pronto${n ? `, ${n}` : ""}!*\n\nOlha só como foi sua semana financeira.`,
  (n) => `💙 *O Abio organizou toda a sua semana${n ? `, ${n}` : ""}!*\n\nConfira seu resumo abaixo e acompanhe sua evolução.`,
];

const PANEL_INVITE =
  `\n\n━━━━━━━━━━━━━━\n📊 *Quer analisar tudo com mais detalhes?*\nNo painel você vê gráficos, categorias, histórico completo e evolução financeira.\n🔗 ${PANEL_URL}`;

// 7 mensagens motivacionais para quem NÃO teve movimentações.
// Cada mensagem já traz o link do painel e a instrução para desativar
// respondendo "2" ou "não" — por isso não usamos rodapé separado aqui.
const MOTIVATIONALS: ((firstName: string) => string)[] = [
  (n) => `👋 ${n ? `${n}, parece` : "Parece"} que esta semana passou sem nenhuma movimentação registrada.\n\nTudo bem! Uma nova semana está começando e estarei por aqui para organizar suas finanças sempre que precisar. 💙\n\nLembre-se: basta enviar uma mensagem, um áudio, uma foto ou um comprovante que eu organizo tudo automaticamente.\n\n📊 Você também pode acompanhar sua evolução financeira, gráficos e relatórios completos acessando seu painel:\n\n🔗 ${PANEL_URL}\n\nSe não quiser mais receber este resumo semanal automático, basta responder *"2"* ou simplesmente dizer *"não"*.`,
  (n) => `😊 ${n ? `${n}, esta` : "Esta"} semana não encontrei nenhum gasto ou receita registrada.\n\nQue tal aproveitar a próxima semana para manter seu controle financeiro sempre atualizado?\n\nEstou pronto para ajudar quando você precisar.\n\n📈 Se preferir, acompanhe seus gráficos, histórico completo e categorias diretamente pelo painel:\n\n🔗 ${PANEL_URL}\n\nCaso não queira mais receber este resumo semanal, responda *"2"* ou diga *"não"*.`,
  (n) => `🚀 ${n ? `${n}, nenhuma` : "Nenhuma"} movimentação foi registrada nesta semana.\n\nNão tem problema! Ainda dá tempo de começar uma nova rotina financeira mais organizada.\n\nSempre que quiser registrar alguma receita ou despesa, é só me chamar.\n\n📊 Quer visualizar seu painel financeiro?\n\n🔗 ${PANEL_URL}\n\nSe desejar parar de receber este resumo semanal, basta responder *"2"* ou escrever *"não"*.`,
  (n) => `💙 ${n ? `${n}, senti` : "Senti"} sua falta esta semana.\n\nNão encontrei nenhuma movimentação financeira registrada.\n\nNa próxima semana estarei aqui para ajudar você a acompanhar tudo de forma simples e automática.\n\nEnquanto isso, você pode acessar seu painel completo:\n\n🔗 ${PANEL_URL}\n\nSe preferir não receber mais este resumo semanal, responda *"2"* ou diga *"não"*.`,
  (n) => `📅 ${n ? `${n}, mais` : "Mais"} uma semana chegou ao fim.\n\nDesta vez não encontrei registros financeiros, mas uma nova semana está começando e estou pronto para ajudar você a manter tudo organizado.\n\nQuer acompanhar sua evolução financeira?\n\n🔗 ${PANEL_URL}\n\nSe quiser parar de receber este resumo semanal, responda *"2"* ou simplesmente escreva *"não"*.`,
  (n) => `✨ ${n ? `${n}, esta` : "Esta"} semana passou sem movimentações registradas.\n\nQue tal fazer da próxima uma semana ainda mais organizada?\n\nSempre que precisar registrar receitas, despesas ou consultar seus relatórios, estarei aqui.\n\n📊 Você também pode acessar seu painel completo:\n\n🔗 ${PANEL_URL}\n\nCaso não queira mais receber este resumo semanal, responda *"2"* ou diga *"não"*.`,
  (n) => `🤝 ${n ? `${n}, esta` : "Esta"} semana não tivemos nenhuma movimentação registrada.\n\nEspero conversar mais com você na próxima semana e ajudar no seu controle financeiro.\n\nEnquanto isso, seus gráficos e histórico continuam disponíveis no painel:\n\n🔗 ${PANEL_URL}\n\nSe não desejar mais receber este resumo semanal automático, basta responder *"2"* ou escrever *"não"*.`,
];

export const Route = createFileRoute("/api/public/hooks/weekly-summary")({
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

  let action = (url.searchParams.get("action") || "").toLowerCase();
  let type = (url.searchParams.get("type") || "").toLowerCase();
  const onlyUser = url.searchParams.get("user_id") || undefined;
  const dryRun = url.searchParams.get("dry") === "1";
  try {
    const body = await request.clone().json().catch(() => null) as any;
    if (!action && body?.action) action = String(body.action).toLowerCase();
    if (!type && body?.type) type = String(body.type).toLowerCase();
  } catch { /* ignore */ }
  if (!action) action = "ask";

  if (action === "send") {
    if (!onlyUser) return fail(400, "user_id required for send");
    const result = await sendReport(onlyUser, type === "monthly" ? "monthly" : "weekly");
    return result.ok ? ok(result) : fail(result.status, result.error);
  }
  if (action === "fallback") return ok({ action: "fallback", skipped: true, reason: "auto_send_on_ask" });
  return await runAsk(dryRun, onlyUser);
}

async function eligibleProfiles(onlyUser?: string) {
  const { data: subs } = await supabaseAdmin
    .from("subscriptions").select("user_id, status")
    .in("status", ["active", "trial", "trialing"]);
  const { data: admins } = await supabaseAdmin
    .from("user_roles").select("user_id").eq("role", "admin");
  const ids = new Set<string>();
  for (const s of subs ?? []) if ((s as any).user_id) ids.add((s as any).user_id);
  for (const a of admins ?? []) if ((a as any).user_id) ids.add((a as any).user_id);
  if (onlyUser) { ids.clear(); ids.add(onlyUser); }
  if (ids.size === 0) return [] as any[];
  const arr = Array.from(ids);
  const { data: profiles } = await supabaseAdmin
    .from("profiles").select("id, name, phone, weekly_summary_enabled").in("id", arr);
  return (profiles ?? []).filter((p: any) => !!p.phone && p.weekly_summary_enabled !== false);
}

async function runAsk(dryRun: boolean, onlyUser?: string) {
  const profiles = await eligibleProfiles(onlyUser);
  const wk = weekKey();
  let sent = 0;
  const results: any[] = [];

  const ids = profiles.map((p: any) => p.id);
  const { data: already } = ids.length
    ? await supabaseAdmin.from("weekly_summary_log").select("user_id, ok")
        .eq("week_key", wk).in("user_id", ids)
    : { data: [] as any[] };
  const doneUsers = new Set((already ?? []).filter((r: any) => r.ok).map((r: any) => r.user_id));

  for (const p of profiles as any[]) {
    if (doneUsers.has(p.id)) { results.push({ userId: p.id, skipped: "already" }); continue; }
    const firstName = (p.name || "").trim().split(/\s+/)[0] || "";

    const now = new Date();
    const startThis = new Date(now); startThis.setDate(startThis.getDate() - 7);

    const { data: txRows } = await supabaseAdmin
      .from("transactions").select("kind, amount, category, description, occurred_at")
      .eq("user_id", p.id).gte("occurred_at", startThis.toISOString()).lte("occurred_at", now.toISOString());

    const hasData = (txRows ?? []).length > 0;

    let text: string;
    let pending: any = null;

    if (hasData) {
      const intro = pick(INTROS_WITH_DATA)(firstName);
      const body = await buildWeeklySummaryBody(p.id, now, txRows as any[]);
      text = `${intro}\n\n${body}${PANEL_INVITE}`;
    } else {
      text = pick(MOTIVATIONALS)(firstName);
      const expires = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000).toISOString();
      pending = { kind: "weekly_optout", user_id: p.id, week: wk, asked_at: new Date().toISOString(), expires_at: expires };
    }

    if (dryRun) { results.push({ userId: p.id, hasData, preview: text.slice(0, 120) }); continue; }

    const res = await sendWhatsAppText(p.phone, text);
    if (!res.ok) { results.push({ userId: p.id, error: "send_failed" }); continue; }
    sent++;

    if (pending) {
      await supabaseAdmin.from("wa_contacts").upsert(
        { phone: p.phone, pending_action: pending }, { onConflict: "phone" },
      );
    }
    await supabaseAdmin.from("weekly_summary_log").upsert(
      { user_id: p.id, week_key: wk, phone: p.phone, ok: true, details: { auto: true, hasData, sent_at: new Date().toISOString(), len: text.length } as any },
      { onConflict: "user_id,week_key" },
    );
    await supabaseAdmin.from("whatsapp_messages").insert({
      user_id: p.id, phone: p.phone, direction: "out", media_type: "text",
      content: text, status: "sent", raw: { source: "weekly-summary/auto", week: wk, hasData } as any,
    });
    results.push({ userId: p.id, sent: true, hasData });
  }
  return ok({ action: "ask", week: wk, eligible: profiles.length, sent, results });
}

export async function sendReport(userId: string, type: "weekly" | "monthly") {
  const { data: profile } = await supabaseAdmin
    .from("profiles").select("id, name, phone").eq("id", userId).maybeSingle();
  if (!profile?.phone) return { ok: false as const, status: 400, error: "no_phone" };
  const wk = weekKey();

  const now = new Date();
  const text = type === "monthly"
    ? await buildMonthlyMessage(userId, profile.name || "", now)
    : await buildWeeklyMessage(userId, profile.name || "", now);

  const res = await sendWhatsAppText(profile.phone, text);
  if (!res.ok) {
    await supabaseAdmin.from("whatsapp_messages").insert({
      user_id: userId, phone: profile.phone, direction: "out", media_type: "text",
      content: text, status: "send_error",
      raw: { source: `weekly-summary/${type}`, send: res } as any,
    });
    return { ok: false as const, status: 500, error: "send_failed" };
  }

  await supabaseAdmin.from("weekly_summary_log").upsert(
    { user_id: userId, week_key: wk, phone: profile.phone, ok: true, details: { type, len: text.length, sent_at: new Date().toISOString() } as any },
    { onConflict: "user_id,week_key" },
  );
  await supabaseAdmin.from("whatsapp_messages").insert({
    user_id: userId, phone: profile.phone, direction: "out", media_type: "text",
    content: text, status: "sent", raw: { source: `weekly-summary/${type}`, week: wk } as any,
  });
  await supabaseAdmin.from("wa_contacts").update({ pending_action: null }).eq("phone", profile.phone);

  return { ok: true as const, status: 200, type };
}

// ===== Body compacto no formato pedido =====
async function buildWeeklySummaryBody(userId: string, now: Date, txRows: any[]) {
  const startThis = new Date(now); startThis.setDate(startThis.getDate() - 7);
  const startPrev = new Date(startThis); startPrev.setDate(startPrev.getDate() - 7);

  const { data: prevRows } = await supabaseAdmin
    .from("transactions").select("kind, amount")
    .eq("user_id", userId).gte("occurred_at", startPrev.toISOString()).lt("occurred_at", startThis.toISOString());

  const isIncome = (t: any) => (t.kind ?? t.type) === "income";
  let income = 0, expense = 0;
  const byCat = new Map<string, number>();
  for (const t of txRows) {
    const v = Number(t.amount) || 0;
    if (isIncome(t)) income += v;
    else { expense += v; const k = t.category || "Outros"; byCat.set(k, (byCat.get(k) || 0) + v); }
  }
  const balance = income - expense;
  let topCat = { name: "—", v: 0 };
  for (const [k, v] of byCat) if (v > topCat.v) topCat = { name: k, v };

  let prevIncome = 0, prevExpense = 0;
  const hasPrev = (prevRows ?? []).length > 0;
  for (const t of (prevRows ?? []) as any[]) { const v = Number(t.amount) || 0; if (isIncome(t)) prevIncome += v; else prevExpense += v; }
  const prevBalance = prevIncome - prevExpense;
  const deltaBal = balance - prevBalance;

  let tip = "";
  if (balance < 0) tip = `⚠️ Suas despesas superaram as receitas essa semana. Revisar *${topCat.name}* pode ajudar bastante.`;
  else if (topCat.v > expense * 0.4 && expense > 0) tip = `🔥 *${topCat.name}* concentrou boa parte dos gastos — vale ficar de olho.`;
  else if (hasPrev && balance > prevBalance) tip = `🎉 Você fechou melhor que a semana anterior. Continue firme!`;
  else if (balance > 0) tip = `💪 Saldo positivo! Que tal separar uma parte para meta ou reserva?`;
  else tip = `📌 Continue registrando — quanto mais dados, melhores as análises.`;

  const period = `${fmtDayMonth(startThis)} a ${fmtDayMonth(now)}`;

  const lines: string[] = [];
  lines.push(`📅 *Período:* ${period}`);
  lines.push(``);
  lines.push(`💰 *Receitas:* ${BRL(income)}`);
  lines.push(`💸 *Despesas:* ${BRL(expense)}`);
  lines.push(`📈 *Saldo da semana:* ${BRL(balance)}`);
  lines.push(``);
  lines.push(`🏆 *Categoria com maior gasto:* ${topCat.name}${topCat.v > 0 ? ` (${BRL(topCat.v)})` : ""}`);
  lines.push(`📝 *Movimentações:* ${txRows.length}`);
  if (hasPrev) lines.push(`📊 *Vs semana anterior:* ${deltaBal >= 0 ? "+" : ""}${BRL(deltaBal)}`);
  lines.push(``);
  lines.push(`💡 ${tip}`);
  return lines.join("\n");
}

// ============= WEEKLY (mantido p/ sendReport manual) =============
async function buildWeeklyMessage(userId: string, name: string, now: Date) {
  const startThis = new Date(now); startThis.setDate(startThis.getDate() - 7);
  const startPrev = new Date(now); startPrev.setDate(startPrev.getDate() - 14);

  const [txThisR, txPrevR, billsR, goalsR, apptCntR] = await Promise.all([
    supabaseAdmin.from("transactions").select("kind, amount, category, description, occurred_at")
      .eq("user_id", userId).gte("occurred_at", startThis.toISOString()).lte("occurred_at", now.toISOString()),
    supabaseAdmin.from("transactions").select("kind, amount")
      .eq("user_id", userId).gte("occurred_at", startPrev.toISOString()).lt("occurred_at", startThis.toISOString()),
    supabaseAdmin.from("recurring_bills").select("title, amount, next_due_at, last_paid_at, active")
      .eq("user_id", userId).eq("active", true),
    supabaseAdmin.from("financial_goals").select("title, target_amount, current_amount").eq("user_id", userId),
    supabaseAdmin.from("appointments").select("id", { count: "exact", head: true })
      .eq("user_id", userId).gte("when_at", now.toISOString()),
  ]);

  const list = (txThisR.data ?? []) as any[];
  const firstName = (name || "").trim().split(/\s+/)[0] || "";

  if (list.length === 0) {
    const greet = firstName ? `Olá, ${firstName}!\n\n` : "";
    return `📊 *Fechamento Semanal Abio*\n\n${greet}Esta semana você ainda não registrou movimentações. Que tal começar amanhã? 💙`;
  }

  const isIncome = (t: any) => (t.kind ?? t.type) === "income";
  let income = 0, expense = 0, biggestExpense = { v: 0, d: "" }, biggestIncome = { v: 0, d: "" };
  const byCat = new Map<string, number>();
  for (const t of list) {
    const v = Number(t.amount) || 0;
    if (isIncome(t)) { income += v; if (v > biggestIncome.v) biggestIncome = { v, d: t.description || t.category || "Receita" }; }
    else { expense += v; const k = t.category || "Outros"; byCat.set(k, (byCat.get(k) || 0) + v); if (v > biggestExpense.v) biggestExpense = { v, d: t.description || t.category || "Despesa" }; }
  }
  const balance = income - expense;
  let topCat = { name: "—", v: 0 };
  for (const [k, v] of byCat) if (v > topCat.v) topCat = { name: k, v };

  let prevIncome = 0, prevExpense = 0;
  for (const t of (txPrevR.data ?? []) as any[]) { const v = Number(t.amount) || 0; if (isIncome(t)) prevIncome += v; else prevExpense += v; }
  const prevBalance = prevIncome - prevExpense;

  const inOneWeek = new Date(now); inOneWeek.setDate(inOneWeek.getDate() + 7);
  let paidThisWeek = 0, upcoming = 0;
  for (const b of (billsR.data ?? []) as any[]) {
    if (b.last_paid_at) { const dt = new Date(b.last_paid_at); if (dt >= startThis && dt <= now) paidThisWeek++; }
    if (b.next_due_at) { const dt = new Date(b.next_due_at); if (dt >= now && dt <= inOneWeek) upcoming++; }
  }
  const achieved = (goalsR.data ?? []).filter((g: any) => Number(g.current_amount) >= Number(g.target_amount));

  const tips: string[] = [];
  if (balance > prevBalance && prevBalance >= 0) tips.push(`🎉 Você economizou mais que na semana anterior. Continue assim!`);
  else if (balance < 0) tips.push(`⚠️ Suas despesas superaram as receitas. Vale revisar os gastos com *${topCat.name}*.`);
  if (topCat.v > expense * 0.4 && expense > 0) tips.push(`🔥 Atenção: *${topCat.name}* concentrou boa parte dos seus gastos.`);
  if (achieved.length > 0) tips.push(`🏆 Você bateu a meta *${achieved[0].title}*! Parabéns!`);

  const lines: string[] = [];
  lines.push(`📊 *Fechamento Semanal Abio*`);
  if (firstName) lines.push(`\nOlá, ${firstName}! 👋`);
  lines.push(``);
  lines.push(`💰 *Receitas:* ${BRL(income)}`);
  lines.push(`💸 *Despesas:* ${BRL(expense)}`);
  lines.push(`💵 *Saldo:* ${BRL(balance)}`);
  lines.push(``);
  lines.push(`🔥 *Categoria que mais gastou:* ${topCat.name} (${BRL(topCat.v)})`);
  lines.push(`📌 *Lançamentos:* ${list.length}`);
  if (biggestExpense.v > 0) lines.push(`🔻 *Maior despesa:* ${biggestExpense.d} — ${BRL(biggestExpense.v)}`);
  if (biggestIncome.v > 0) lines.push(`🔺 *Maior receita:* ${biggestIncome.d} — ${BRL(biggestIncome.v)}`);
  lines.push(`✅ *Contas pagas na semana:* ${paidThisWeek}`);
  lines.push(`📅 *Vencendo na próxima semana:* ${upcoming}`);
  lines.push(`🔔 *Lembretes pendentes:* ${apptCntR.count ?? 0}`);
  const deltaBal = balance - prevBalance;
  lines.push(``);
  lines.push(`📈 *Comparação com semana anterior:* ${deltaBal >= 0 ? "+" : ""}${BRL(deltaBal)}`);
  if (tips.length) { lines.push(``); lines.push(`━━━━━━━━━━━━━━`); for (const t of tips) lines.push(t); }
  lines.push(``);
  lines.push(`🔗 ${PANEL_URL}`);
  return lines.join("\n");
}

// ============= MONTHLY =============
async function buildMonthlyMessage(userId: string, name: string, now: Date) {
  const startMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startPrev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const endPrev = new Date(now.getFullYear(), now.getMonth(), 1);

  const [txThisR, txPrevR, billsR, goalsR, habitsR, habitLogsR] = await Promise.all([
    supabaseAdmin.from("transactions").select("kind, amount, category, description, occurred_at")
      .eq("user_id", userId).gte("occurred_at", startMonth.toISOString()).lte("occurred_at", now.toISOString()),
    supabaseAdmin.from("transactions").select("kind, amount")
      .eq("user_id", userId).gte("occurred_at", startPrev.toISOString()).lt("occurred_at", endPrev.toISOString()),
    supabaseAdmin.from("recurring_bills").select("title, amount, next_due_at, last_paid_at, payment_status, active")
      .eq("user_id", userId).eq("active", true),
    supabaseAdmin.from("financial_goals").select("title, target_amount, current_amount").eq("user_id", userId),
    supabaseAdmin.from("habits").select("id, name").eq("user_id", userId).eq("archived", false),
    supabaseAdmin.from("habit_logs").select("habit_id, status, log_date")
      .eq("user_id", userId).gte("log_date", startMonth.toISOString().slice(0, 10)),
  ]);

  const list = (txThisR.data ?? []) as any[];
  const firstName = (name || "").trim().split(/\s+/)[0] || "";
  const monthName = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(now);

  if (list.length === 0) {
    const greet = firstName ? `Olá, ${firstName}!\n\n` : "";
    return `📆 *Fechamento de ${monthName} — Abio*\n\n${greet}Este mês você ainda não registrou movimentações. Vamos começar? 💙`;
  }

  const isIncome = (t: any) => (t.kind ?? t.type) === "income";
  let income = 0, expense = 0;
  const byCat = new Map<string, number>();
  for (const t of list) {
    const v = Number(t.amount) || 0;
    if (isIncome(t)) income += v;
    else { expense += v; const k = t.category || "Outros"; byCat.set(k, (byCat.get(k) || 0) + v); }
  }
  const balance = income - expense;

  let prevIncome = 0, prevExpense = 0;
  for (const t of (txPrevR.data ?? []) as any[]) { const v = Number(t.amount) || 0; if (isIncome(t)) prevIncome += v; else prevExpense += v; }
  const prevBalance = prevIncome - prevExpense;

  let paidCount = 0, pendingCount = 0;
  for (const b of (billsR.data ?? []) as any[]) {
    if (b.last_paid_at) { const dt = new Date(b.last_paid_at); if (dt >= startMonth && dt <= now) paidCount++; }
    if (b.payment_status !== "paid" && b.next_due_at && new Date(b.next_due_at) >= now) pendingCount++;
  }

  const achieved = (goalsR.data ?? []).filter((g: any) => Number(g.current_amount) >= Number(g.target_amount));

  const habits = (habitsR.data ?? []) as any[];
  const logs = (habitLogsR.data ?? []) as any[];
  const habitsCompleted = new Set(logs.filter((l) => l.status === "done").map((l) => l.habit_id)).size;

  const sortedCats = Array.from(byCat.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3);

  const lines: string[] = [];
  lines.push(`📆 *Fechamento de ${monthName}*`);
  if (firstName) lines.push(`\nOlá, ${firstName}! 👋`);
  lines.push(``);
  lines.push(`💰 *Receitas:* ${BRL(income)}`);
  lines.push(`💸 *Despesas:* ${BRL(expense)}`);
  lines.push(`💵 *Saldo:* ${BRL(balance)}`);
  lines.push(``);
  lines.push(`📊 *Top categorias:*`);
  for (const [k, v] of sortedCats) lines.push(`• ${k}: ${BRL(v)}`);
  lines.push(``);
  const deltaBal = balance - prevBalance;
  lines.push(`📈 *Vs mês anterior:* ${deltaBal >= 0 ? "+" : ""}${BRL(deltaBal)} (economia)`);
  lines.push(``);
  lines.push(`✅ *Contas pagas:* ${paidCount}`);
  lines.push(`⏳ *Contas pendentes:* ${pendingCount}`);
  if (achieved.length > 0) lines.push(`🏆 *Metas atingidas:* ${achieved.length}`);
  if (habits.length > 0) lines.push(`🔥 *Hábitos ativos com registros:* ${habitsCompleted}/${habits.length}`);
  lines.push(``);
  lines.push(`━━━━━━━━━━━━━━`);
  if (balance > 0) lines.push(`🎉 Mês positivo! Seu saldo foi de *${BRL(balance)}*.`);
  else lines.push(`⚠️ Mês negativo. Foco no próximo — o Abio ajuda.`);
  lines.push(``);
  lines.push(`🔗 ${PANEL_URL}`);
  return lines.join("\n");
}
