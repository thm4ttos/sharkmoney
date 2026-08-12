// SERVER-ONLY — Execução de ações em compromissos existentes (agenda).
//
// Uma ação do usuário = UMA resposta final. Nada de reconfirmação.
// A sincronização com o painel é imediata: alteramos a própria linha de
// `appointments`; o trigger `appointments_generate_reminders` remove as
// notificações futuras em cancelamento/conclusão e recria no reagendamento.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { pickReply } from "@/lib/wa-replies";

const SP_TZ = "America/Sao_Paulo";

/** Data/hora amigável de um compromisso — sempre no fuso do usuário (SP). */
export function prettyAppointmentDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const dayKey = (x: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: SP_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(x);
  const hour = new Intl.DateTimeFormat("pt-BR", {
    timeZone: SP_TZ, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d);

  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  if (dayKey(d) === dayKey(now)) return `Hoje às ${hour}`;
  if (dayKey(d) === dayKey(tomorrow)) return `Amanhã às ${hour}`;

  const full = new Intl.DateTimeFormat("pt-BR", {
    timeZone: SP_TZ, weekday: "long", day: "2-digit", month: "2-digit", year: "numeric",
  }).format(d);
  return `${full} às ${hour}`;
}

export type AppointmentRow = {
  id: string;
  title: string;
  scheduled_at: string;
  status?: string | null;
};

export async function getAppointment(userId: string, id: string): Promise<AppointmentRow | null> {
  const { data } = await supabaseAdmin
    .from("appointments")
    .select("id, title, scheduled_at, status")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  return (data as AppointmentRow) ?? null;
}

/** Compromissos ainda ativos (pendentes) e futuros. */
export async function listActiveAppointments(userId: string, limit = 5): Promise<AppointmentRow[]> {
  const { data } = await supabaseAdmin
    .from("appointments")
    .select("id, title, scheduled_at, status")
    .eq("user_id", userId)
    .eq("status", "pending")
    .gte("scheduled_at", new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(limit);
  return (data as AppointmentRow[]) ?? [];
}

/**
 * Compromisso criado há poucos minutos — usado quando uma mensagem logo
 * depois da criação corrige a data/hora ("vai ser quinta-feira, errei")
 * sem citar o nome do compromisso. Janela curta de propósito: só cobre o
 * caso "acabei de criar, é sobre isso mesmo", nunca resolve uma correção
 * ambígua contra um compromisso de dias atrás. Bug real: essa mensagem
 * caía direto em correctLastTransaction (só conhece `transactions`),
 * nunca considerava o compromisso recém-criado.
 */
export async function findRecentlyCreatedAppointment(
  userId: string, windowMs = 30 * 60 * 1000,
): Promise<AppointmentRow | null> {
  const since = new Date(Date.now() - windowMs).toISOString();
  const { data } = await supabaseAdmin
    .from("appointments")
    .select("id, title, scheduled_at, status")
    .eq("user_id", userId)
    .eq("status", "pending")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as AppointmentRow) ?? null;
}

/**
 * Último compromisso mencionado em um lembrete enviado nas últimas horas.
 * Usado para manter o contexto: "Faltam 30 minutos para o churrasco" → "3".
 */
export async function lastRemindedAppointment(userId: string, phone: string): Promise<AppointmentRow | null> {
  const since = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
  const { data } = await supabaseAdmin
    .from("whatsapp_messages")
    .select("raw, created_at")
    .eq("user_id", userId)
    .eq("direction", "out")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(20);
  for (const m of data ?? []) {
    const apptId = (m as any)?.raw?.appointment_id;
    if (apptId) {
      const appt = await getAppointment(userId, apptId);
      if (appt) return appt;
    }
  }
  return null;
}

export async function cancelAppointment(userId: string, appt: AppointmentRow, phone: string): Promise<string> {
  await supabaseAdmin.from("appointments")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", appt.id).eq("user_id", userId);
  await supabaseAdmin.from("appointment_reminders")
    .update({ status: "skipped", last_error: "appointment_cancelled" })
    .eq("appointment_id", appt.id).eq("status", "pending");
  const base = await pickReply("appointment_cancel_done", phone);
  return `${base}\n\n📌 ${appt.title}`;
}

export async function completeAppointment(userId: string, appt: AppointmentRow, phone: string): Promise<string> {
  await supabaseAdmin.from("appointments")
    .update({ status: "done", updated_at: new Date().toISOString() })
    .eq("id", appt.id).eq("user_id", userId);
  await supabaseAdmin.from("appointment_reminders")
    .update({ status: "skipped", last_error: "appointment_done" })
    .eq("appointment_id", appt.id).eq("status", "pending");
  const base = await pickReply("appointment_completed", phone);
  return `${base}\n\n📌 ${appt.title}`;
}

export async function rescheduleAppointment(
  userId: string, appt: AppointmentRow, newIso: string, phone: string,
): Promise<string> {
  await supabaseAdmin.from("appointments")
    .update({ scheduled_at: newIso, status: "pending", updated_at: new Date().toISOString() })
    .eq("id", appt.id).eq("user_id", userId);
  const base = await pickReply("appointment_reschedule_done", phone);
  return `${base}\n\n📌 ${appt.title}\n🕒 ${prettyAppointmentDate(newIso)}`;
}

export async function keepAppointment(appt: AppointmentRow, phone: string): Promise<string> {
  const base = await pickReply("appointment_kept", phone);
  return `${base}\n\n📌 ${appt.title}\n🕒 ${prettyAppointmentDate(appt.scheduled_at)}`;
}

/**
 * Mescla uma nova data/hora parcial com o horário atual do compromisso
 * (ex.: "passa para sexta" mantém a hora; "coloca às 20h" mantém o dia).
 */
export function mergeReschedule(
  currentIso: string, nat: { iso: string | null; hasDate: boolean; hasTime: boolean },
): string | null {
  if (!nat.iso) return null;
  const cur = new Date(currentIso);
  const next = new Date(nat.iso);
  if (isNaN(next.getTime())) return null;
  if (isNaN(cur.getTime()) || (nat.hasDate && nat.hasTime)) return next.toISOString();
  if (nat.hasTime && !nat.hasDate) {
    const merged = new Date(cur);
    merged.setUTCHours(next.getUTCHours(), next.getUTCMinutes(), 0, 0);
    // Se o horário resultante já passou, joga para o próximo dia.
    if (merged.getTime() <= Date.now()) merged.setUTCDate(merged.getUTCDate() + 1);
    return merged.toISOString();
  }
  if (nat.hasDate && !nat.hasTime) {
    next.setUTCHours(cur.getUTCHours(), cur.getUTCMinutes(), 0, 0);
    return next.toISOString();
  }
  return next.toISOString();
}
