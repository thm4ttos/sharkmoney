
CREATE TABLE IF NOT EXISTS public.wa_duplicate_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  phone text NOT NULL,
  raw_message_id text,
  reason text NOT NULL,
  content text,
  amount numeric(14,2),
  kind text,
  matched_message_id uuid,
  matched_transaction_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.wa_duplicate_log TO authenticated;
GRANT ALL ON public.wa_duplicate_log TO service_role;

ALTER TABLE public.wa_duplicate_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wa_duplicate_log admin read"
ON public.wa_duplicate_log FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS wa_duplicate_log_created_at_idx
ON public.wa_duplicate_log (created_at DESC);

CREATE INDEX IF NOT EXISTS wa_duplicate_log_phone_idx
ON public.wa_duplicate_log (phone);
