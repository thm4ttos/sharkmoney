
-- ============================================================
-- Bloco 1 (Fail-safe) + Bloco 5 (Observabilidade)
-- ============================================================

-- Fila de processamento de mensagens WhatsApp com retry
CREATE TABLE IF NOT EXISTS public.wa_message_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  message_id UUID NULL REFERENCES public.whatsapp_messages(id) ON DELETE CASCADE,
  user_id UUID NULL,
  stage TEXT NOT NULL DEFAULT 'queued',
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 6,
  next_retry_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error TEXT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ack_sent BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ NULL
);

GRANT SELECT ON public.wa_message_jobs TO authenticated;
GRANT ALL ON public.wa_message_jobs TO service_role;

ALTER TABLE public.wa_message_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wa_message_jobs_admin_select"
  ON public.wa_message_jobs
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_wa_message_jobs_pending
  ON public.wa_message_jobs(status, next_retry_at)
  WHERE status IN ('queued','processing','retry');

CREATE INDEX IF NOT EXISTS idx_wa_message_jobs_message
  ON public.wa_message_jobs(message_id);

CREATE INDEX IF NOT EXISTS idx_wa_message_jobs_user
  ON public.wa_message_jobs(user_id, created_at DESC);

CREATE TRIGGER trg_wa_message_jobs_touch
  BEFORE UPDATE ON public.wa_message_jobs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============================================================
-- Métricas de sistema (observabilidade)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.system_metrics (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  fn_name TEXT NOT NULL,
  stage TEXT NULL,
  user_id UUID NULL,
  duration_ms INT NOT NULL DEFAULT 0,
  ok BOOLEAN NOT NULL DEFAULT true,
  error_code TEXT NULL,
  error_message TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.system_metrics TO authenticated;
GRANT ALL ON public.system_metrics TO service_role;

ALTER TABLE public.system_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "system_metrics_admin_select"
  ON public.system_metrics
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_system_metrics_fn_time
  ON public.system_metrics(fn_name, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_system_metrics_created
  ON public.system_metrics(created_at DESC);

-- ============================================================
-- Função de limpeza (retention 30 dias) — chamada via pg_cron
-- ============================================================
CREATE OR REPLACE FUNCTION public.cleanup_ops_tables()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.system_metrics WHERE created_at < now() - interval '30 days';
  DELETE FROM public.wa_message_jobs WHERE status IN ('done','failed_permanent') AND updated_at < now() - interval '30 days';
END;
$$;

-- Agenda diária às 03:30
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    PERFORM cron.unschedule('cleanup_ops_tables_daily')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='cleanup_ops_tables_daily');
    PERFORM cron.schedule('cleanup_ops_tables_daily','30 3 * * *', $c$SELECT public.cleanup_ops_tables();$c$);
  END IF;
END $$;
