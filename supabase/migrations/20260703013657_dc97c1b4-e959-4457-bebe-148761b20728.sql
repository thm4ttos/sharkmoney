
ALTER TABLE public.recurring_bills
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS last_paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_paid_due date,
  ADD COLUMN IF NOT EXISTS awaiting_for date,
  ADD COLUMN IF NOT EXISTS confirmation_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_reminder_sent_at timestamptz;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recurring_bills_payment_status_check') THEN
    ALTER TABLE public.recurring_bills
      ADD CONSTRAINT recurring_bills_payment_status_check
      CHECK (payment_status IN ('pending','awaiting','paid','late'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS recurring_bills_status_idx ON public.recurring_bills(active, payment_status, next_due_at);
