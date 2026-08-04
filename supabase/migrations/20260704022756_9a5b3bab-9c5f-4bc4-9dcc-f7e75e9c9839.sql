
ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS response_ms INTEGER,
  ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error TEXT;

CREATE INDEX IF NOT EXISTS idx_wa_messages_pending
  ON public.whatsapp_messages (direction, status, created_at)
  WHERE direction = 'in';

CREATE OR REPLACE FUNCTION public.wa_messages_status_sla()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  terminal_statuses TEXT[] := ARRAY[
    'processed','sent','blocked','ai_disabled','failed_permanent'
  ];
BEGIN
  IF NEW.direction = 'in' AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'processing' THEN
      NEW.processing_started_at := COALESCE(NEW.processing_started_at, now());
      NEW.attempts := COALESCE(OLD.attempts, 0) + 1;
    END IF;
    IF NEW.status = ANY(terminal_statuses) AND NEW.processed_at IS NULL THEN
      NEW.processed_at := now();
      NEW.response_ms := GREATEST(0, EXTRACT(EPOCH FROM (now() - NEW.created_at))::INT * 1000);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_wa_messages_status_sla ON public.whatsapp_messages;
CREATE TRIGGER trg_wa_messages_status_sla
  BEFORE UPDATE ON public.whatsapp_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.wa_messages_status_sla();
