
CREATE TABLE IF NOT EXISTS public.transaction_edits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  transaction_id uuid NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
  field text NOT NULL,
  old_value jsonb,
  new_value jsonb,
  source text NOT NULL DEFAULT 'whatsapp',
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.transaction_edits TO authenticated;
GRANT ALL ON public.transaction_edits TO service_role;

ALTER TABLE public.transaction_edits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tx_edits own read" ON public.transaction_edits
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "tx_edits own insert" ON public.transaction_edits
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS transaction_edits_user_idx
  ON public.transaction_edits(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS transaction_edits_tx_idx
  ON public.transaction_edits(transaction_id, created_at DESC);
