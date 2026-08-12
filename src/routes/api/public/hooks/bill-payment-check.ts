// Verifica contas fixas e envia mensagens de confirmação de pagamento.
//
// Fluxo (spec Abio):
//  • mode=morning (09:00 SP): para contas ativas com next_due_at = hoje,
//    envia UMA mensagem por usuário perguntando se já pagou. Agrupa todas
//    as contas do dia. Marca payment_status='awaiting', awaiting_for=hoje
//    e grava pending_action {kind:"bill_payment"} no wa_contacts.
//  • mode=evening (19:00 SP): para contas que ainda estão 'awaiting' com
//    awaiting_for=hoje (ou dias anteriores, sem confirmação), reenvia
//    cobrança "ainda não confirmamos o pagamento". Marca 'late'.
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendReplyWithOptions } from "@/lib/uazapi.server";

const ok = (b: unknown = { ok: true }) =>
  new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });
const fail = (s: number, m: string) =>
  new Response(JSON.stringify({ error: m }), { status: s, headers: { "Content-Type": "application/json" } });

const BRL = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });

function todaySP(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function emojiFor(title: string): string {
  const t = title.toLowerCase();
  if (/aluguel|casa|moradia|condom/.test(t)) return "🏠";
  if (/luz|energia|elétr|light/.test(t)) return "💡";
  if (/água|agua|saneamento/.test(t)) return "💧";
  if (/internet|net|wifi|vivo|claro|tim|oi/.test(t)) return "🌐";
  if (/carro|auto|combustível|gasolina|uber|aplicativo|transporte/.test(t)) return "🚗";
  if (/academia|gym|fitness/.test(t)) return "🏋️";
  if (/netflix|spotify|prime|disney|streaming|assin/.test(t)) return "🎬";
  if (/cartão|cartao|fatura/.test(t)) return "💳";
  return "📦";
}

export const Route = createFileRoute("/api/public/hooks/bill-payment-check")({
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

  let mode = (url.searchParams.get("mode") || "").toLowerCase();
  try {
    const body = await request.clone().json().catch(() => null) as any;
    if (!mode && body?.mode) mode = String(body.mode).toLowerCase();
  } catch { /* ignore */ }
  if (mode !== "evening" && mode !== "morning") {
    const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", hour12: false }).format(new Date()));
    mode = hour >= 15 ? "evening" : "morning";
  }

  const today = todaySP();
  if (mode === "morning") return await runMorning(today);
  return await runEvening(today);
}

// 09:00 SP — Pergunta "hoje vence sua conta X, já pagou?"
async function runMorning(today: string) {
  const { data: bills, error } = await supabaseAdmin
    .from("recurring_bills")
    .select("id, user_id, title, amount, original_amount, paid_amount, next_due_at, payment_status, awaiting_for, notify_whatsapp, active")
    .eq("active", true)
    .eq("notify_whatsapp", true)
    .eq("next_due_at", today);
  if (error) return fail(500, error.message);

  const targets = (bills ?? []).filter((b: any) => b.awaiting_for !== today && b.payment_status !== "paid");
  if (targets.length === 0) return ok({ mode: "morning", eligible: 0 });

  return await sendBatch(targets, today, "morning");
}

// 19:00 SP — Cobra "ainda não confirmamos o pagamento"
async function runEvening(today: string) {
  const { data: bills, error } = await supabaseAdmin
    .from("recurring_bills")
    .select("id, user_id, title, amount, original_amount, paid_amount, next_due_at, payment_status, awaiting_for, notify_whatsapp, active, last_reminder_sent_at")
    .eq("active", true)
    .eq("notify_whatsapp", true)
    .in("payment_status", ["awaiting", "late", "partial"]);
  if (error) return fail(500, error.message);

  const targets = (bills ?? []).filter((b: any) => {
    if (!b.awaiting_for) return false;
    // Cobra bills perguntadas hoje de manhã que ainda não foram confirmadas,
    // e também débitos de dias anteriores que ficaram pendentes.
    if (b.awaiting_for > today) return false;
    // Evita duplicar reforço no mesmo dia
    if (b.last_reminder_sent_at) {
      const dt = new Date(b.last_reminder_sent_at);
      const sameDay = today === new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(dt);
      // Se a última cobrança foi hoje E não foi a mensagem de manhã (confirmation_sent_at), pula
      if (sameDay && b.payment_status === "late") return false;
    }
    return true;
  });

  if (targets.length === 0) return ok({ mode: "evening", eligible: 0 });
  return await sendBatch(targets, today, "evening");
}

async function sendBatch(targets: any[], today: string, mode: "morning" | "evening") {
  const byUser = new Map<string, any[]>();
  for (const b of targets) {
    if (!byUser.has(b.user_id)) byUser.set(b.user_id, []);
    byUser.get(b.user_id)!.push(b);
  }

  const userIds = Array.from(byUser.keys());
  const { data: profiles } = await supabaseAdmin
    .from("profiles").select("id, phone").in("id", userIds);
  const phoneByUser = new Map<string, string>();
  for (const p of profiles ?? []) if ((p as any).phone) phoneByUser.set((p as any).id, (p as any).phone);

  let sent = 0;
  for (const [userId, list] of byUser) {
    const phone = phoneByUser.get(userId);
    if (!phone) continue;

    // Fonte única de verdade: valor cobrado = original - já pago.
    const remainingOf = (b: any) => {
      const original = Number(b.original_amount ?? b.amount ?? 0);
      const paid = Number(b.paid_amount ?? 0);
      return Math.max(0, Math.round((original - paid) * 100) / 100);
    };
    const pending = list.filter((b) => remainingOf(b) > 0.01);
    if (pending.length === 0) continue;
    const lines = pending.map((b) => {
      const paid = Number(b.paid_amount ?? 0);
      const suffix = paid > 0.01
        ? ` _(já pago ${BRL(paid)} de ${BRL(Number(b.original_amount ?? b.amount ?? 0))})_`
        : "";
      return `${emojiFor(b.title)} ${b.title} — *${BRL(remainingOf(b))}*${suffix}`;
    }).join("\n");
    const total = pending.reduce((s, b) => s + remainingOf(b), 0);
    const header = mode === "morning"
      ? `🔔 *Hoje vence sua${pending.length > 1 ? "s contas fixas" : " conta fixa"}:*`
      : `⚠️ *Ainda não identificamos o pagamento desta${pending.length > 1 ? "s contas fixas" : " conta fixa"}:*`;
    const question = mode === "morning" ? "Ela já foi paga?" : "Ela foi paga?";
    const footer = `\n\nTotal: *${BRL(total)}*\n\n${question}`;
    const text = `${header}\n\n${lines}${footer}`;

    const res = await sendReplyWithOptions(phone, text, [
      { id: "paid", label: "Já paguei" },
      { id: "not_yet", label: "Ainda não" },
      { id: "postpone", label: "Adiar" },
    ]);
    if (!res.ok) {
      console.error("[bill-payment-check] send failed", res);
      continue;
    }
    sent++;

    const ids = pending.map((b) => b.id);
    const nowIso = new Date().toISOString();
    // Contas com pagamento parcial mantêm o status 'partial' (não viram awaiting/late),
    // para o painel e o WhatsApp continuarem mostrando o abatimento já feito.
    const partialIds = pending.filter((b) => Number(b.paid_amount ?? 0) > 0.01).map((b) => b.id);
    const plainIds = ids.filter((id) => !partialIds.includes(id));
    const patch: any = mode === "morning"
      ? { payment_status: "awaiting", awaiting_for: today, confirmation_sent_at: nowIso, last_reminder_sent_at: nowIso }
      : { payment_status: "late", last_reminder_sent_at: nowIso };
    if (plainIds.length) await supabaseAdmin.from("recurring_bills").update(patch).in("id", plainIds);
    if (partialIds.length) {
      const partialPatch: any = mode === "morning"
        ? { awaiting_for: today, confirmation_sent_at: nowIso, last_reminder_sent_at: nowIso }
        : { last_reminder_sent_at: nowIso };
      await supabaseAdmin.from("recurring_bills").update(partialPatch).in("id", partialIds);
    }


    const expires = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    await supabaseAdmin.from("wa_contacts").upsert(
      { phone, pending_action: { kind: "bill_payment", bill_ids: ids, due: today, expires_at: expires } as any },
      { onConflict: "phone" },
    );

    await supabaseAdmin.from("whatsapp_messages").insert({
      user_id: userId, phone, direction: "out", media_type: "text",
      content: text, status: "sent",
      raw: { send: res, source: "bill-payment-check", mode, bill_ids: ids } as any,
    });
  }

  return ok({ mode, users: byUser.size, sent, bills: targets.length });
}
