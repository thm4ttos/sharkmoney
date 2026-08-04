
-- ============================================================
-- 1) Trigger anti-duplicidade em transactions (WhatsApp / 60s)
-- ============================================================
CREATE OR REPLACE FUNCTION public.transactions_prevent_duplicates()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  dup_id uuid;
BEGIN
  -- Só aplica proteção quando a origem é WhatsApp (é onde ocorre o retry duplicado).
  IF COALESCE(NEW.source, '') <> 'whatsapp' THEN
    RETURN NEW;
  END IF;

  SELECT id INTO dup_id
  FROM public.transactions
  WHERE user_id = NEW.user_id
    AND kind = NEW.kind
    AND amount = NEW.amount
    AND COALESCE(lower(btrim(description)), '') = COALESCE(lower(btrim(NEW.description)), '')
    AND COALESCE(category, '') = COALESCE(NEW.category, '')
    AND source = 'whatsapp'
    AND created_at >= (now() - interval '60 seconds')
  LIMIT 1;

  IF dup_id IS NOT NULL THEN
    -- Erro específico capturado pela camada de aplicação e transformado
    -- na mensagem "Esse lançamento já foi registrado."
    RAISE EXCEPTION 'BRINZAP_DUPLICATE_TX:%', dup_id
      USING ERRCODE = 'unique_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_transactions_prevent_duplicates ON public.transactions;
CREATE TRIGGER trg_transactions_prevent_duplicates
BEFORE INSERT ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.transactions_prevent_duplicates();

-- Índice para acelerar a busca de duplicidade nos últimos 60s
CREATE INDEX IF NOT EXISTS idx_transactions_dedup
  ON public.transactions (user_id, kind, amount, created_at DESC)
  WHERE source = 'whatsapp';

-- ============================================================
-- 2) Cron watchdog: chama o reprocessador a cada 30 segundos
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove agendamentos antigos com o mesmo nome (idempotência).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT jobid FROM cron.job WHERE jobname IN ('wa-reprocess-30s','wa-reprocess-60s') LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;
END $$;

-- pg_cron mínimo é 1 minuto — agendamos dois disparos defasados em 30s para
-- garantir latência ~30s. Cada disparo aciona o watchdog assincronamente.
SELECT cron.schedule(
  'wa-reprocess-30s-a',
  '* * * * *',
  $cmd$
  SELECT net.http_post(
    url := 'https://project--aac711e9-4a90-40c4-8d46-cc953ada334b.lovable.app/api/public/hooks/wa-reprocess',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{"limit":50}'::jsonb
  );
  $cmd$
);

SELECT cron.schedule(
  'wa-reprocess-30s-b',
  '* * * * *',
  $cmd$
  SELECT pg_sleep(30);
  SELECT net.http_post(
    url := 'https://project--aac711e9-4a90-40c4-8d46-cc953ada334b.lovable.app/api/public/hooks/wa-reprocess',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{"limit":50}'::jsonb
  );
  $cmd$
);
