import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendWhatsAppText } from "@/lib/uazapi.server";

const ok = (body: unknown = { ok: true }) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

const fail = (status: number, msg: string) =>
  new Response(JSON.stringify({ error: msg }), { status, headers: { "Content-Type": "application/json" } });

const BRL = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });

function todayYMD(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDaysYMD(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setDate(dt.getDate() + days);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export const Route = createFileRoute("/api/public/hooks/bill-reminders")({
  server: {
    handlers: {
      GET: async ({ request }) => handle(request),
      POST: async ({ request }) => handle(request),
    },
  },
});

async function handle(request: Request) {
  // Authorize: require either the public anon key (apikey header) or the WhatsApp webhook token.
  const apikey = request.headers.get("apikey") || new URL(request.url).searchParams.get("apikey");
  const tok = request.headers.get("x-webhook-token") || new URL(request.url).searchParams.get("token");
  const validApi = !!apikey && apikey === (process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY);
  const validTok = !!tok && tok === process.env.UAZAPI_WEBHOOK_TOKEN;
  if (!validApi && !validTok) return fail(401, "unauthorized");

  const today = todayYMD();
  const in3 = addDaysYMD(today, 3);
  const in1 = addDaysYMD(today, 1);

  const { data: bills, error } = await supabaseAdmin
    .from("recurring_bills")
    .select("id, user_id, title, amount, original_amount, paid_amount, next_due_at, notified_3d_for, notified_1d_for, total_installments, paid_installments")
    .eq("active", true)
    .eq("notify_whatsapp", true)
    .in("next_due_at", [in3, in1]);

  if (error) return fail(500, error.message);

  const targets = (bills ?? []).filter((b) => {
    if (b.next_due_at === in3 && b.notified_3d_for !== in3) return true;
    if (b.next_due_at === in1 && b.notified_1d_for !== in1) return true;
    return false;
  });

  if (targets.length === 0) return ok({ checked: bills?.length ?? 0, sent: 0 });

  const userIds = Array.from(new Set(targets.map((b) => b.user_id)));
  const { data: profiles } = await supabaseAdmin
    .from("profiles")
    .select("id, phone")
    .in("id", userIds);
  const phoneByUser = new Map<string, string>();
  for (const p of profiles ?? []) if ((p as any).phone) phoneByUser.set((p as any).id, (p as any).phone);

  let sent = 0;
  for (const b of targets) {
    const phone = phoneByUser.get(b.user_id);
    if (!phone) continue;
    const isThree = b.next_due_at === in3;
    // Fonte única de verdade: original - já pago = falta pagar.
    const original = Number((b as any).original_amount ?? b.amount ?? 0);
    const paid = Number((b as any).paid_amount ?? 0);
    const remaining = Math.max(0, Math.round((original - paid) * 100) / 100);
    if (remaining <= 0.01) continue; // ciclo já quitado — não cobra de novo
    const partialLine = paid > 0.01
      ? `\n\nValor original: *${BRL(original)}*\nJá pago: *${BRL(paid)}*\nFalta pagar: *${BRL(remaining)}*`
      : "";
    // Contratos com prazo determinado: mostrar número da parcela.
    const totalInst = Number((b as any).total_installments ?? 0);
    const instLine = totalInst > 0
      ? `\n\nParcela: *${Math.min(totalInst, Number((b as any).paid_installments ?? 0) + 1)} de ${totalInst}*\nVencimento: *${String(b.next_due_at).split("-").reverse().join("/")}*`
      : "";
    const text = isThree
      ? `🔔 *Lembrete Shark Money*\n\nSua conta fixa *${b.title}* no valor de *${BRL(remaining)}* vence em *3 dias*.${instLine}${partialLine}\n\nNão esqueça de se programar.`
      : `⚠️ *Atenção!*\n\nA conta fixa *${b.title}* de *${BRL(remaining)}* vence *amanhã*.${instLine}${partialLine}`;

    const res = await sendWhatsAppText(phone, text);
    if (res.ok) {
      sent++;
      const patch: any = isThree
        ? { notified_3d_for: in3, last_notified_at: new Date().toISOString() }
        : { notified_1d_for: in1, last_notified_at: new Date().toISOString() };
      await supabaseAdmin.from("recurring_bills").update(patch).eq("id", b.id);
      await supabaseAdmin.from("whatsapp_messages").insert({
        user_id: b.user_id, phone, direction: "out", media_type: "text",
        content: text, status: "sent", raw: { send: res, source: "bill-reminder", bill_id: b.id } as any,
      });
    }
  }

  return ok({ checked: bills?.length ?? 0, sent, eligible: targets.length });
}
