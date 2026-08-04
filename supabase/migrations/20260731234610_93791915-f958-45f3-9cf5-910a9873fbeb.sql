ALTER TABLE public.installment_purchases
  ADD COLUMN IF NOT EXISTS notify_whatsapp boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reminder_offsets integer[] NOT NULL DEFAULT '{3,0}';

CREATE TABLE IF NOT EXISTS public.installment_reminder_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  purchase_id uuid NOT NULL REFERENCES public.installment_purchases(id) ON DELETE CASCADE,
  installment_number integer NOT NULL,
  offset_days integer NOT NULL,
  due_at date NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (purchase_id, installment_number, offset_days)
);

GRANT SELECT ON public.installment_reminder_log TO authenticated;
GRANT ALL ON public.installment_reminder_log TO service_role;
ALTER TABLE public.installment_reminder_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own installment reminder log" ON public.installment_reminder_log
  FOR SELECT TO authenticated USING (user_id = auth.uid());