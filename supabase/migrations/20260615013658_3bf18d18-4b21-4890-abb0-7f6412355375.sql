
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

ALTER TABLE public.recurring_bills
  ADD COLUMN IF NOT EXISTS notified_3d_for date,
  ADD COLUMN IF NOT EXISTS notified_1d_for date;
