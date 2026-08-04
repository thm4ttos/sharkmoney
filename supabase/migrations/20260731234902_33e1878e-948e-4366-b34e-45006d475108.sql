CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule('installment-reminders-daily')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'installment-reminders-daily');

SELECT cron.schedule(
  'installment-reminders-daily',
  '0 12 * * *',
  $$
  SELECT net.http_post(
    url := 'https://abio.fun/api/public/hooks/installment-reminders',
    headers := '{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJtZWlidGFrdGZ4ZXVrZGNxY2lwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2NDg1ODMsImV4cCI6MjA5NTIyNDU4M30.2pV6G_FvOlzMkfdUFkSUW2P6AOXH8oUvPZQn4eElRc0"}'::jsonb,
    body := '{"source":"pg_cron"}'::jsonb
  ) as request_id;
  $$
);