// Envia lembretes inteligentes de compromissos (agenda).
// Executado por pg_cron a cada minuto. Também funciona como watchdog:
// reprocessa qualquer reminder pendente com scheduled_for <= now().
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendWhatsAppText } from "@/lib/uazapi.server";

const ok = (b: unknown = { ok: true }) =>
  new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });
const fail = (s: number, m: string) =>
  new Response(JSON.stringify({ error: m }), { status: s, headers: { "Content-Type": "application/json" } });

export const Route = createFileRoute("/api/public/hooks/appointment-reminders")({
  server: {
    handlers: {
      GET: async ({ request }) => handle(request),
      POST: async ({ request }) => handle(request),
    },
  },
});

function fmtTimeSP(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(iso));
}
function fmtDateSP(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric",
  }).format(new Date(iso));
}

function buildMessage(kind: string, appt: { title: string; scheduled_at: string }): string {
  const t = fmtTimeSP(appt.scheduled_at);
  const d = fmtDateSP(appt.scheduled_at);
  switch (kind) {
    case "3d_before":
      return `🔔 *Lembrete Shark Money*\n\nFaltam apenas *3 dias* para o seu compromisso:\n\n📌 *${appt.title}*\n📅 ${d} às ${t}`;
    case "day_09":
      return `📅 *Bom dia!*\n\nHoje você tem um compromisso:\n\n📌 *${appt.title}*\n⏰ ${t}`;
    case "before_4h":
      return `⏰ *Faltam 4 horas* para o seu compromisso:\n\n📌 *${appt.title}*\n🕒 ${t}`;
    case "before_1h":
      return `⏰ *Faltam 1 hora* para o seu compromisso:\n\n📌 *${appt.title}*\n🕒 ${t}`;
    case "before_30m":
      return `⏰ *Faltam 30 minutos* para o seu compromisso:\n\n📌 *${appt.title}*\n🕒 ${t}\n\nCaso tenha mudado algo, é só me avisar.`;

    default:
      return `🔔 Lembrete: ${appt.title} — ${d} ${t}`;
  }
}

async function handle(request: Request) {
  const url = new URL(request.url);
  const apikey = request.headers.get("apikey") || url.searchParams.get("apikey");
  const tok = request.headers.get("x-webhook-token") || url.searchParams.get("token");
  const validApi = !!apikey && apikey === (process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY);
  const validTok = !!tok && tok === process.env.UAZAPI_WEBHOOK_TOKEN;
  if (!validApi && !validTok) return fail(401, "unauthorized");

  // Puxa reminders pendentes já vencidos (inclui atrasados = watchdog).
  const { data: reminders, error } = await supabaseAdmin
    .from("appointment_reminders")
    .select("id, appointment_id, user_id, kind, scheduled_for, attempts")
    .eq("status", "pending")
    .lte("scheduled_for", new Date().toISOString())
    .order("scheduled_for", { ascending: true })
    .limit(200);

  if (error) return fail(500, error.message);
  if (!reminders || reminders.length === 0) return ok({ checked: 0, sent: 0 });

  const apptIds = Array.from(new Set(reminders.map(r => r.appointment_id)));
  const userIds = Array.from(new Set(reminders.map(r => r.user_id)));

  const [apptRes, profRes] = await Promise.all([
    supabaseAdmin.from("appointments").select("id, title, scheduled_at, user_id").in("id", apptIds),
    supabaseAdmin.from("profiles").select("id, phone").in("id", userIds),
  ]);
  const apptById = new Map<string, any>();
  for (const a of apptRes.data ?? []) apptById.set(a.id, a);
  const phoneByUser = new Map<string, string>();
  for (const p of profRes.data ?? []) if ((p as any).phone) phoneByUser.set((p as any).id, (p as any).phone);

  let sent = 0, skipped = 0, failed = 0;
  const nowMs = Date.now();

  for (const r of reminders) {
    const appt = apptById.get(r.appointment_id);
    if (!appt) {
      await supabaseAdmin.from("appointment_reminders")
        .update({ status: "skipped", last_error: "appointment_missing" }).eq("id", r.id);
      skipped++; continue;
    }
    // Se o compromisso já passou, não envia mais.
    if (new Date(appt.scheduled_at).getTime() <= nowMs) {
      await supabaseAdmin.from("appointment_reminders")
        .update({ status: "skipped", last_error: "past_appointment" }).eq("id", r.id);
      skipped++; continue;
    }
    const phone = phoneByUser.get(r.user_id);
    if (!phone) {
      await supabaseAdmin.from("appointment_reminders")
        .update({ status: "skipped", last_error: "no_phone" }).eq("id", r.id);
      skipped++; continue;
    }

    const text = buildMessage(r.kind, appt);
    const res = await sendWhatsAppText(phone, text);

    if (res.ok) {
      await supabaseAdmin.from("appointment_reminders")
        .update({ status: "sent", sent_at: new Date().toISOString(), attempts: (r.attempts ?? 0) + 1 })
        .eq("id", r.id);
      await supabaseAdmin.from("whatsapp_messages").insert({
        user_id: r.user_id, phone, direction: "out", media_type: "text",
        content: text, status: "sent",
        raw: { send: res, source: "appointment-reminder", appointment_id: r.appointment_id, kind: r.kind } as any,
      });
      // Se for -30m, arma pending_action de confirmação.
      if (r.kind === "before_30m") {
        const expires_at = new Date(new Date(appt.scheduled_at).getTime() + 60 * 60 * 1000).toISOString();
        // Upsert wa_contacts (mantém name se existir).
        const { data: existing } = await supabaseAdmin
          .from("wa_contacts").select("id, name").eq("phone", phone).maybeSingle();
        if (existing) {
          await supabaseAdmin.from("wa_contacts")
            .update({ pending_action: { kind: "appointment_confirm", appointment_id: appt.id, expires_at } as any })
            .eq("phone", phone);
        } else {
          await supabaseAdmin.from("wa_contacts").insert({
            phone,
            pending_action: { kind: "appointment_confirm", appointment_id: appt.id, expires_at } as any,
          });
        }
      }
      sent++;
    } else {
      const attempts = (r.attempts ?? 0) + 1;
      const terminal = attempts >= 5;
      await supabaseAdmin.from("appointment_reminders")
        .update({
          status: terminal ? "error" : "pending",
          attempts,
          last_error: res.error ?? `status_${res.status}`,
        })
        .eq("id", r.id);
      failed++;
    }
  }

  return ok({ checked: reminders.length, sent, skipped, failed });
}
