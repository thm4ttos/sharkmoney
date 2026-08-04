// Lembretes de parcelas (compras parceladas) via WhatsApp.
//
// Roda 1x por dia (09:00 America/Sao_Paulo). Para cada compra parcelada ativa
// com lembretes ligados, calcula o vencimento da próxima parcela e envia aviso
// nas antecedências escolhidas pelo usuário (7/5/3/1 dias antes e no dia).
// Também avisa uma única vez quando a parcela vence e não foi marcada como paga.
// Deduplicação em installment_reminder_log (purchase + parcela + antecedência).
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendWhatsAppText } from "@/lib/uazapi.server";
import { installmentDueDate, todaySP, diffDaysYMD, formatYMD } from "@/lib/installments-dates";
import { firstName } from "@/lib/wa-replies";

const ok = (b: unknown = { ok: true }) =>
  new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });
const fail = (s: number, m: string) =>
  new Response(JSON.stringify({ error: m }), { status: s, headers: { "Content-Type": "application/json" } });

const BRL = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });

export const Route = createFileRoute("/api/public/hooks/installment-reminders")({
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

  const today = todaySP();

  const { data: rows, error } = await supabaseAdmin
    .from("installment_purchases")
    .select("id, user_id, title, total_amount, installments_total, installments_paid, first_due_at, reminder_offsets")
    .eq("active", true)
    .eq("notify_whatsapp", true);
  if (error) return fail(500, error.message);

  const pending = (rows ?? []).filter((p: any) => p.installments_paid < p.installments_total);
  if (pending.length === 0) return ok({ checked: 0, sent: 0 });

  const userIds = Array.from(new Set(pending.map((p: any) => p.user_id)));
  const { data: profiles } = await supabaseAdmin
    .from("profiles").select("id, phone, name").in("id", userIds);
  const byUser = new Map<string, { phone: string; name: string }>();
  for (const p of profiles ?? []) {
    if ((p as any).phone) byUser.set((p as any).id, { phone: (p as any).phone, name: (p as any).name ?? "" });
  }

  let sent = 0;
  for (const p of pending as any[]) {
    const prof = byUser.get(p.user_id);
    if (!prof) continue;

    const number = p.installments_paid + 1;
    const dueAt = installmentDueDate(p.first_due_at, number);
    const daysUntil = diffDaysYMD(today, dueAt);
    const offsets: number[] = (p.reminder_offsets ?? []).map(Number);

    // offset_days: 7/5/3/1/0 = antecedência escolhida; -1 = aviso de atraso.
    let offsetKey: number | null = null;
    if (daysUntil < 0) offsetKey = -1;
    else if (offsets.includes(daysUntil)) offsetKey = daysUntil;
    if (offsetKey === null) continue;

    const { data: already } = await supabaseAdmin
      .from("installment_reminder_log")
      .select("id")
      .eq("purchase_id", p.id).eq("installment_number", number).eq("offset_days", offsetKey)
      .maybeSingle();
    if (already) continue;

    const value = Math.round((Number(p.total_amount) / p.installments_total) * 100) / 100;
    const who = firstName(prof.name) || "Olá";
    const detail = `\n\nCompra: *${p.title}*\nParcela: *${number} de ${p.installments_total}*\nValor: *${BRL(value)}*\nVencimento: *${formatYMD(dueAt)}*`;

    let text: string;
    if (offsetKey === -1) {
      const late = Math.abs(daysUntil);
      const when = late === 1 ? "venceu ontem" : `venceu há ${late} dias`;
      text = `⚠️ ${who}, sua parcela ${when} e ainda não foi marcada como paga.${detail}`;
    } else if (offsetKey === 0) {
      text = `🔔 ${who}, a parcela ${number} de ${p.installments_total} da compra *${p.title}* vence *hoje*.${detail}`;
    } else {
      const d = offsetKey === 1 ? "1 dia" : `${offsetKey} dias`;
      text = `🔔 ${who}, sua parcela de *${BRL(value)}* vence em *${d}*.${detail}`;
    }

    const res = await sendWhatsAppText(prof.phone, text);
    if (!res.ok) continue;
    sent++;
    await supabaseAdmin.from("installment_reminder_log").insert({
      user_id: p.user_id, purchase_id: p.id, installment_number: number,
      offset_days: offsetKey, due_at: dueAt,
    });
    await supabaseAdmin.from("whatsapp_messages").insert({
      user_id: p.user_id, phone: prof.phone, direction: "out", media_type: "text",
      content: text, status: "sent",
      raw: { send: res, source: "installment-reminder", purchase_id: p.id, installment_number: number, offset_days: offsetKey } as any,
    });
  }

  return ok({ checked: pending.length, sent });
}
