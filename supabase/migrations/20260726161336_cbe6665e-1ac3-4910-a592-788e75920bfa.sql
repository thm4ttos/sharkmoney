ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS priority text,
  ADD COLUMN IF NOT EXISTS ai_confidence numeric,
  ADD COLUMN IF NOT EXISTS source_text text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION public.appointments_generate_reminders()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  sa timestamptz := NEW.scheduled_at;
  now_ts timestamptz := now();
  sa_date_sp date;
  today_sp date;
  hh_sp int;
  mm_sp int;
  slot timestamptz;
  days_ahead int;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.scheduled_at IS DISTINCT FROM NEW.scheduled_at THEN
    DELETE FROM public.appointment_reminders WHERE appointment_id = NEW.id;
  END IF;

  IF COALESCE(NEW.status,'pending') <> 'pending' THEN
    DELETE FROM public.appointment_reminders WHERE appointment_id = NEW.id;
    RETURN NEW;
  END IF;

  IF sa IS NULL OR sa <= now_ts THEN
    RETURN NEW;
  END IF;

  sa_date_sp := (sa AT TIME ZONE 'America/Sao_Paulo')::date;
  today_sp   := (now_ts AT TIME ZONE 'America/Sao_Paulo')::date;
  hh_sp := EXTRACT(HOUR   FROM (sa AT TIME ZONE 'America/Sao_Paulo'))::int;
  mm_sp := EXTRACT(MINUTE FROM (sa AT TIME ZONE 'America/Sao_Paulo'))::int;
  days_ahead := sa_date_sp - today_sp;

  IF days_ahead >= 3 THEN
    slot := ((sa_date_sp - 3)::text || ' 09:00:00')::timestamp AT TIME ZONE 'America/Sao_Paulo';
    IF slot > now_ts THEN
      INSERT INTO public.appointment_reminders(appointment_id, user_id, kind, scheduled_for)
      VALUES (NEW.id, NEW.user_id, '3d_before', slot)
      ON CONFLICT (appointment_id, kind) DO NOTHING;
    END IF;
  END IF;

  IF (hh_sp > 9) OR (hh_sp = 9 AND mm_sp >= 30) THEN
    slot := (sa_date_sp::text || ' 09:00:00')::timestamp AT TIME ZONE 'America/Sao_Paulo';
    IF slot > now_ts AND slot < sa THEN
      INSERT INTO public.appointment_reminders(appointment_id, user_id, kind, scheduled_for)
      VALUES (NEW.id, NEW.user_id, 'day_09', slot)
      ON CONFLICT (appointment_id, kind) DO NOTHING;
    END IF;
  END IF;

  slot := sa - interval '4 hours';
  IF slot > now_ts THEN
    INSERT INTO public.appointment_reminders(appointment_id, user_id, kind, scheduled_for)
    VALUES (NEW.id, NEW.user_id, 'before_4h', slot)
    ON CONFLICT (appointment_id, kind) DO NOTHING;
  END IF;

  slot := sa - interval '1 hour';
  IF slot > now_ts THEN
    INSERT INTO public.appointment_reminders(appointment_id, user_id, kind, scheduled_for)
    VALUES (NEW.id, NEW.user_id, 'before_1h', slot)
    ON CONFLICT (appointment_id, kind) DO NOTHING;
  END IF;

  slot := sa - interval '30 minutes';
  IF slot > now_ts THEN
    INSERT INTO public.appointment_reminders(appointment_id, user_id, kind, scheduled_for)
    VALUES (NEW.id, NEW.user_id, 'before_30m', slot)
    ON CONFLICT (appointment_id, kind) DO NOTHING;
  END IF;

  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_appointments_generate_reminders ON public.appointments;
CREATE TRIGGER trg_appointments_generate_reminders
AFTER INSERT OR UPDATE OF scheduled_at, status ON public.appointments
FOR EACH ROW EXECUTE FUNCTION public.appointments_generate_reminders();

DROP TRIGGER IF EXISTS trg_appointments_touch_updated_at ON public.appointments;
CREATE TRIGGER trg_appointments_touch_updated_at
BEFORE UPDATE ON public.appointments
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.appointments REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'appointments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.appointments;
  END IF;
END $$;