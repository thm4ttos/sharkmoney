
CREATE TABLE IF NOT EXISTS public.weekly_summary_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  week_key text NOT NULL,
  phone text,
  sent_at timestamptz NOT NULL DEFAULT now(),
  ok boolean NOT NULL DEFAULT true,
  details jsonb,
  UNIQUE (user_id, week_key)
);

GRANT SELECT ON public.weekly_summary_log TO authenticated;
GRANT ALL ON public.weekly_summary_log TO service_role;

ALTER TABLE public.weekly_summary_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "weekly_summary_log read own or admin"
ON public.weekly_summary_log FOR SELECT
TO authenticated
USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
