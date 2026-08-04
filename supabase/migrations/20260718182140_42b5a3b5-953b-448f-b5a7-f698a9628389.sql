
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS reengagement_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS reengagement_last_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS reengagement_last_template int;
