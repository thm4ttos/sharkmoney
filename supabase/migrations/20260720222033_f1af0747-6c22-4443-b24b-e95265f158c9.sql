
ALTER TABLE public.recurring_bills
  ADD COLUMN IF NOT EXISTS original_amount NUMERIC,
  ADD COLUMN IF NOT EXISTS paid_amount NUMERIC NOT NULL DEFAULT 0;

UPDATE public.recurring_bills SET original_amount = amount WHERE original_amount IS NULL;

CREATE TABLE IF NOT EXISTS public.bill_payments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  bill_id UUID NOT NULL REFERENCES public.recurring_bills(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL CHECK (amount > 0),
  paid_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT,
  source TEXT NOT NULL DEFAULT 'whatsapp',
  transaction_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bill_payments_bill ON public.bill_payments(bill_id);
CREATE INDEX IF NOT EXISTS idx_bill_payments_user ON public.bill_payments(user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bill_payments TO authenticated;
GRANT ALL ON public.bill_payments TO service_role;

ALTER TABLE public.bill_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own bill payments" ON public.bill_payments
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
