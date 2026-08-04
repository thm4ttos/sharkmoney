
ALTER TABLE public.ai_settings
  ADD COLUMN IF NOT EXISTS master_prompt text,
  ADD COLUMN IF NOT EXISTS welcome_message text,
  ADD COLUMN IF NOT EXISTS guest_message text,
  ADD COLUMN IF NOT EXISTS signup_done_message text,
  ADD COLUMN IF NOT EXISTS tone text NOT NULL DEFAULT 'amigavel';
