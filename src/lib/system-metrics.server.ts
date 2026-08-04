// SERVER-ONLY. Helper de observabilidade — grava tempo/erros em `system_metrics`.
// Uso: `await withMetrics("wa.classify", userId, async () => { ... })`
// Nunca lança erro para o chamador: falha em métricas nunca pode quebrar o fluxo.

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type MetricRecord = {
  fn_name: string;
  stage?: string | null;
  user_id?: string | null;
  duration_ms: number;
  ok: boolean;
  error_code?: string | null;
  error_message?: string | null;
  metadata?: Record<string, any>;
};

export async function recordMetric(m: MetricRecord): Promise<void> {
  try {
    await supabaseAdmin.from("system_metrics").insert({
      fn_name: m.fn_name.slice(0, 120),
      stage: m.stage ?? null,
      user_id: m.user_id ?? null,
      duration_ms: Math.max(0, Math.round(m.duration_ms)),
      ok: m.ok,
      error_code: m.error_code ?? null,
      error_message: m.error_message ? String(m.error_message).slice(0, 500) : null,
      metadata: m.metadata ?? {},
    });
  } catch (e) {
    console.warn("[system-metrics] record failed", (e as any)?.message ?? e);
  }
}

export async function withMetrics<T>(
  fnName: string,
  userId: string | null | undefined,
  fn: () => Promise<T>,
  opts?: { stage?: string; metadata?: Record<string, any> },
): Promise<T> {
  const t0 = Date.now();
  try {
    const out = await fn();
    void recordMetric({
      fn_name: fnName,
      stage: opts?.stage ?? null,
      user_id: userId ?? null,
      duration_ms: Date.now() - t0,
      ok: true,
      metadata: opts?.metadata,
    });
    return out;
  } catch (e: any) {
    void recordMetric({
      fn_name: fnName,
      stage: opts?.stage ?? null,
      user_id: userId ?? null,
      duration_ms: Date.now() - t0,
      ok: false,
      error_code: e?.code ?? e?.name ?? null,
      error_message: e?.message ?? String(e),
      metadata: opts?.metadata,
    });
    throw e;
  }
}
