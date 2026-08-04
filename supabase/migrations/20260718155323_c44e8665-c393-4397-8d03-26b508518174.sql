-- Idempotency: pin each transaction to the exact source message that created it.
-- With this in place, if the WhatsApp pipeline reprocesses the same message
-- (webhook retry, watchdog, worker crash, reconnect), the second insert hits
-- the unique index and is rejected — guaranteeing "one message = one transaction".
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS source_message_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_transactions_source_message_id
  ON public.transactions (source_message_id)
  WHERE source_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_source_message_id
  ON public.transactions (source_message_id)
  WHERE source_message_id IS NOT NULL;