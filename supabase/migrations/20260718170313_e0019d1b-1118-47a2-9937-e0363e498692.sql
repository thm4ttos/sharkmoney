
-- Intelligent appointment reminders
CREATE TABLE IF NOT EXISTS public.appointment_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('3d_before','day_09','before_4h','before_1h','before_30m')),
  scheduled_for timestamptz NOT NULL,
  sent_at timestamptz,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','skipped','error')),
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (appointment_id, kind)
);

GRANT SELECT ON public.appointment_reminders TO authenticated;
GRANT ALL ON public.appointment_reminders TO service_role;

ALTER TABLE public.appointment_reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own appointment reminders"
  ON public.appointment_reminders FOR SELECT
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_appt_rem_due
  ON public.appointment_reminders(scheduled_for)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_appt_rem_appointment
  ON public.appointment_reminders(appointment_id);

-- updated_at trigger reuses public.touch_updated_at()
DROP TRIGGER IF EXISTS trg_appt_reminders_updated ON public.appointment_reminders;
CREATE TRIGGER trg_appt_reminders_updated
  BEFORE UPDATE ON public.appointment_reminders
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Generator: on appointments insert/update, (re)build reminder slots
CREATE OR REPLACE FUNCTION public.appointments_generate_reminders()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
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

  IF sa IS NULL OR sa <= now_ts THEN
    RETURN NEW;
  END IF;

  sa_date_sp := (sa AT TIME ZONE 'America/Sao_Paulo')::date;
  today_sp   := (now_ts AT TIME ZONE 'America/Sao_Paulo')::date;
  hh_sp := EXTRACT(HOUR   FROM (sa AT TIME ZONE 'America/Sao_Paulo'))::int;
  mm_sp := EXTRACT(MINUTE FROM (sa AT TIME ZONE 'America/Sao_Paulo'))::int;
  days_ahead := sa_date_sp - today_sp;

  -- 3 dias antes às 09:00 (SP) — só quando faltam >= 3 dias
  IF days_ahead >= 3 THEN
    slot := ((sa_date_sp - 3)::text || ' 09:00:00')::timestamp AT TIME ZONE 'America/Sao_Paulo';
    IF slot > now_ts THEN
      INSERT INTO public.appointment_reminders(appointment_id, user_id, kind, scheduled_for)
      VALUES (NEW.id, NEW.user_id, '3d_before', slot)
      ON CONFLICT (appointment_id, kind) DO NOTHING;
    END IF;
  END IF;

  -- No dia às 09:00 (SP) — só se o compromisso for após 09:30 SP
  IF (hh_sp > 9) OR (hh_sp = 9 AND mm_sp >= 30) THEN
    slot := (sa_date_sp::text || ' 09:00:00')::timestamp AT TIME ZONE 'America/Sao_Paulo';
    IF slot > now_ts AND slot < sa THEN
      INSERT INTO public.appointment_reminders(appointment_id, user_id, kind, scheduled_for)
      VALUES (NEW.id, NEW.user_id, 'day_09', slot)
      ON CONFLICT (appointment_id, kind) DO NOTHING;
    END IF;
  END IF;

  -- 4h antes
  slot := sa - interval '4 hours';
  IF slot > now_ts THEN
    INSERT INTO public.appointment_reminders(appointment_id, user_id, kind, scheduled_for)
    VALUES (NEW.id, NEW.user_id, 'before_4h', slot)
    ON CONFLICT (appointment_id, kind) DO NOTHING;
  END IF;

  -- 1h antes
  slot := sa - interval '1 hour';
  IF slot > now_ts THEN
    INSERT INTO public.appointment_reminders(appointment_id, user_id, kind, scheduled_for)
    VALUES (NEW.id, NEW.user_id, 'before_1h', slot)
    ON CONFLICT (appointment_id, kind) DO NOTHING;
  END IF;

  -- 30min antes (confirmação)
  slot := sa - interval '30 minutes';
  IF slot > now_ts THEN
    INSERT INTO public.appointment_reminders(appointment_id, user_id, kind, scheduled_for)
    VALUES (NEW.id, NEW.user_id, 'before_30m', slot)
    ON CONFLICT (appointment_id, kind) DO NOTHING;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_appointments_gen_reminders ON public.appointments;
CREATE TRIGGER trg_appointments_gen_reminders
  AFTER INSERT OR UPDATE OF scheduled_at ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.appointments_generate_reminders();

-- Backfill for existing future appointments
INSERT INTO public.appointment_reminders(appointment_id, user_id, kind, scheduled_for)
SELECT a.id, a.user_id, x.kind, x.slot
FROM public.appointments a
CROSS JOIN LATERAL (
  VALUES
    ('3d_before'::text,
      CASE WHEN ((a.scheduled_at AT TIME ZONE 'America/Sao_Paulo')::date - (now() AT TIME ZONE 'America/Sao_Paulo')::date) >= 3
           THEN (((a.scheduled_at AT TIME ZONE 'America/Sao_Paulo')::date - 3)::text || ' 09:00:00')::timestamp AT TIME ZONE 'America/Sao_Paulo'
           ELSE NULL END),
    ('day_09',
      CASE WHEN EXTRACT(HOUR FROM (a.scheduled_at AT TIME ZONE 'America/Sao_Paulo')) >= 10
             OR (EXTRACT(HOUR FROM (a.scheduled_at AT TIME ZONE 'America/Sao_Paulo')) = 9
                 AND EXTRACT(MINUTE FROM (a.scheduled_at AT TIME ZONE 'America/Sao_Paulo')) >= 30)
           THEN (((a.scheduled_at AT TIME ZONE 'America/Sao_Paulo')::date)::text || ' 09:00:00')::timestamp AT TIME ZONE 'America/Sao_Paulo'
           ELSE NULL END),
    ('before_4h', a.scheduled_at - interval '4 hours'),
    ('before_1h', a.scheduled_at - interval '1 hour'),
    ('before_30m', a.scheduled_at - interval '30 minutes')
) AS x(kind, slot)
WHERE a.scheduled_at > now()
  AND x.slot IS NOT NULL
  AND x.slot > now()
  AND x.slot < a.scheduled_at
ON CONFLICT (appointment_id, kind) DO NOTHING;
