// SERVER-ONLY. Server-fn wrappers: admin diagnostics dashboard.
// Toda função exige admin (has_role). Consome tabelas de operação: wa_message_jobs,
// system_metrics, whatsapp_messages, admin_audit_log, wa_duplicate_log.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(ctx: any) {
  const { data, error } = await ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" });
  if (error || !data) throw new Error("Acesso negado");
}

function sinceIso(hours: number) {
  return new Date(Date.now() - hours * 3600 * 1000).toISOString();
}

export const getAdminDiagnostics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { windowHours?: number }) => ({ windowHours: d?.windowHours ?? 24 }))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const since = sinceIso(data.windowHours);

    // 1) mensagens
    const [msgAll, msgErr, msgProcessing] = await Promise.all([
      supabaseAdmin.from("whatsapp_messages").select("id, response_ms, status, created_at", { count: "exact", head: true }).gte("created_at", since),
      supabaseAdmin.from("whatsapp_messages").select("id", { count: "exact", head: true }).gte("created_at", since).in("status", ["failed", "failed_permanent", "blocked"]),
      supabaseAdmin.from("whatsapp_messages").select("id", { count: "exact", head: true }).gte("created_at", since).in("status", ["queued", "processing"]),
    ]);

    // 2) jobs
    const [jobsAll, jobsFailed, jobsPending] = await Promise.all([
      supabaseAdmin.from("wa_message_jobs").select("id", { count: "exact", head: true }).gte("created_at", since),
      supabaseAdmin.from("wa_message_jobs").select("id", { count: "exact", head: true }).gte("created_at", since).in("status", ["failed_permanent"]),
      supabaseAdmin.from("wa_message_jobs").select("id", { count: "exact", head: true }).in("status", ["queued", "processing", "retry"]),
    ]);

    // 3) tempo de resposta (amostra)
    const respSample = await supabaseAdmin
      .from("whatsapp_messages")
      .select("response_ms")
      .gte("created_at", since)
      .eq("direction", "in")
      .not("response_ms", "is", null)
      .order("created_at", { ascending: false })
      .limit(500);
    const rs = (respSample.data ?? []).map((r: any) => Number(r.response_ms)).filter((n) => Number.isFinite(n));
    rs.sort((a, b) => a - b);
    const p = (q: number) => (rs.length ? rs[Math.min(rs.length - 1, Math.floor(rs.length * q))] : 0);
    const latency = { p50: p(0.5), p95: p(0.95), avg: rs.length ? Math.round(rs.reduce((a, b) => a + b, 0) / rs.length) : 0, samples: rs.length };

    // 4) duplicatas evitadas
    const dup = await supabaseAdmin.from("wa_duplicate_log").select("id", { count: "exact", head: true }).gte("created_at", since);

    // 5) usuários ativos (mensagens únicas)
    const activeUsersRes = await supabaseAdmin
      .from("whatsapp_messages")
      .select("user_id")
      .gte("created_at", since)
      .not("user_id", "is", null)
      .limit(5000);
    const activeUsers = new Set((activeUsersRes.data ?? []).map((r: any) => r.user_id)).size;

    // 6) métricas de sistema (média por fn)
    const metrics = await supabaseAdmin
      .from("system_metrics")
      .select("fn_name, duration_ms, ok")
      .gte("created_at", since)
      .limit(5000);
    const byFn = new Map<string, { total: number; ok: number; fail: number; sum: number }>();
    for (const m of metrics.data ?? []) {
      const k = (m as any).fn_name as string;
      const cur = byFn.get(k) ?? { total: 0, ok: 0, fail: 0, sum: 0 };
      cur.total++;
      cur.sum += Number((m as any).duration_ms) || 0;
      if ((m as any).ok) cur.ok++;
      else cur.fail++;
      byFn.set(k, cur);
    }
    const fnStats = Array.from(byFn.entries())
      .map(([fn, s]) => ({ fn, total: s.total, ok: s.ok, fail: s.fail, avg_ms: Math.round(s.sum / s.total) }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 20);

    // 7) últimos erros
    const errors = await supabaseAdmin
      .from("system_metrics")
      .select("id, fn_name, stage, user_id, duration_ms, error_code, error_message, created_at")
      .eq("ok", false)
      .order("created_at", { ascending: false })
      .limit(30);

    // 8) últimos jobs com falha
    const failedJobs = await supabaseAdmin
      .from("wa_message_jobs")
      .select("id, message_id, user_id, stage, status, attempts, last_error, created_at, updated_at")
      .in("status", ["failed_permanent", "retry"])
      .order("updated_at", { ascending: false })
      .limit(30);

    return {
      windowHours: data.windowHours,
      messages: {
        total: msgAll.count ?? 0,
        failed: msgErr.count ?? 0,
        processing: msgProcessing.count ?? 0,
      },
      jobs: {
        total: jobsAll.count ?? 0,
        failed: jobsFailed.count ?? 0,
        pending: jobsPending.count ?? 0,
      },
      latency,
      duplicatesAvoided: dup.count ?? 0,
      activeUsers,
      fnStats,
      recentErrors: errors.data ?? [],
      failedJobs: failedJobs.data ?? [],
    };
  });
