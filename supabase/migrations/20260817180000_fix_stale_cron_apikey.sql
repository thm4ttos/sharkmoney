-- Causa raiz de "nenhum lembrete chega mais": o projeto migrou pro novo
-- formato de chaves da Supabase (sb_publishable_.../sb_secret_...), mas os
-- 6 crons abaixo ainda mandavam a chave antiga (JWT legado) no header
-- apikey. net.http_post nunca reporta esse tipo de falha como erro pro
-- pg_cron (ele só confirma que a requisição foi ENVIADA, não que foi
-- aceita) — por isso cron.job_run_details mostrava "succeeded" pra sempre,
-- enquanto net._http_response mostrava 401 {"error":"unauthorized"} e
-- nenhum lembrete era realmente processado. Confirmado direto no banco.

SELECT cron.unschedule('appointment-reminders-1m')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'appointment-reminders-1m');

SELECT cron.schedule(
  'appointment-reminders-1m',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://abio.fun/api/public/hooks/appointment-reminders',
    headers := '{"Content-Type": "application/json", "apikey": "sb_publishable_hayiv_NQRhH-EiYFBl79Xw_mnPnZFTZ"}'::jsonb,
    body := '{"source":"pg_cron"}'::jsonb
  ) as request_id;
  $$
);

SELECT cron.unschedule('bill-reminders-daily')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'bill-reminders-daily');

SELECT cron.schedule(
  'bill-reminders-daily',
  '0 12 * * *',
  $$
  SELECT net.http_post(
    url := 'https://abio.fun/api/public/hooks/bill-reminders',
    headers := '{"Content-Type": "application/json", "apikey": "sb_publishable_hayiv_NQRhH-EiYFBl79Xw_mnPnZFTZ"}'::jsonb,
    body := '{"source":"pg_cron"}'::jsonb
  ) as request_id;
  $$
);

SELECT cron.unschedule('bill-payment-check-morning')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'bill-payment-check-morning');

SELECT cron.schedule(
  'bill-payment-check-morning',
  '0 12 * * *',
  $$
  SELECT net.http_post(
    url := 'https://abio.fun/api/public/hooks/bill-payment-check',
    headers := '{"Content-Type": "application/json", "apikey": "sb_publishable_hayiv_NQRhH-EiYFBl79Xw_mnPnZFTZ"}'::jsonb,
    body := '{"source":"pg_cron","mode":"morning"}'::jsonb
  ) as request_id;
  $$
);

SELECT cron.unschedule('bill-payment-check-evening')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'bill-payment-check-evening');

SELECT cron.schedule(
  'bill-payment-check-evening',
  '0 22 * * *',
  $$
  SELECT net.http_post(
    url := 'https://abio.fun/api/public/hooks/bill-payment-check',
    headers := '{"Content-Type": "application/json", "apikey": "sb_publishable_hayiv_NQRhH-EiYFBl79Xw_mnPnZFTZ"}'::jsonb,
    body := '{"source":"pg_cron","mode":"evening"}'::jsonb
  ) as request_id;
  $$
);

SELECT cron.unschedule('installment-reminders-daily')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'installment-reminders-daily');

SELECT cron.schedule(
  'installment-reminders-daily',
  '0 12 * * *',
  $$
  SELECT net.http_post(
    url := 'https://abio.fun/api/public/hooks/installment-reminders',
    headers := '{"Content-Type": "application/json", "apikey": "sb_publishable_hayiv_NQRhH-EiYFBl79Xw_mnPnZFTZ"}'::jsonb,
    body := '{"source":"pg_cron"}'::jsonb
  ) as request_id;
  $$
);

SELECT cron.unschedule('weekly-summary-sunday')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'weekly-summary-sunday');

SELECT cron.schedule(
  'weekly-summary-sunday',
  '0 0 * * 1',
  $$
  SELECT net.http_post(
    url := 'https://abio.fun/api/public/hooks/weekly-summary',
    headers := '{"Content-Type": "application/json", "apikey": "sb_publishable_hayiv_NQRhH-EiYFBl79Xw_mnPnZFTZ"}'::jsonb,
    body := '{"source":"pg_cron"}'::jsonb
  ) as request_id;
  $$
);
