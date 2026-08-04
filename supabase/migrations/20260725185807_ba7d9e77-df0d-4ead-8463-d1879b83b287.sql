
ALTER TABLE public.wa_contacts
  ADD COLUMN IF NOT EXISTS last_reply_variant jsonb NOT NULL DEFAULT '{}'::jsonb;
