ALTER TABLE public.recurring_bills
  ADD COLUMN IF NOT EXISTS total_installments integer,
  ADD COLUMN IF NOT EXISTS paid_installments integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_day integer,
  ADD COLUMN IF NOT EXISTS first_due_date date;

ALTER TABLE public.recurring_bills
  ADD COLUMN IF NOT EXISTS remaining_installments integer
  GENERATED ALWAYS AS (
    CASE WHEN total_installments IS NULL THEN NULL
    ELSE GREATEST(0, total_installments - COALESCE(paid_installments, 0)) END
  ) STORED;

CREATE INDEX IF NOT EXISTS recurring_bills_user_created_idx
  ON public.recurring_bills (user_id, created_at DESC);