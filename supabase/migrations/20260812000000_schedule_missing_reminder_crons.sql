-- Causa raiz do "não recebo lembrete de conta fixa nem confirmação de
-- pagamento": os hooks já existem e já funcionam
-- (appointment-reminders.ts, bill-reminders.ts, bill-payment-check.ts),
-- mas NENHUM dos três tinha um cron.schedule chamando eles — confirmado
-- consultando cron.job direto no banco (só wa-reprocess/wa-broadcast/
-- installment-reminders/cleanup/affiliate estavam agendados). Não afeta só
-- um usuário: ninguém jamais recebeu lembrete de conta fixa (3d/1d antes),
-- pergunta "já pagou?" (manhã/noite) ou lembrete de compromisso
-- (3d/dia/4h/1h/30min) — os três motores estavam mortos desde sempre.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ===== Compromissos: roda a cada minuto (o hook processa reminders com
-- scheduled_for <= now(), incluindo atrasados — funciona como watchdog). =====
SELECT cron.unschedule('appointment-reminders-1m')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'appointment-reminders-1m');

SELECT cron.schedule(
  'appointment-reminders-1m',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://abio.fun/api/public/hooks/appointment-reminders',
    headers := '{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJtZWlidGFrdGZ4ZXVrZGNxY2lwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2NDg1ODMsImV4cCI6MjA5NTIyNDU4M30.2pV6G_FvOlzMkfdUFkSUW2P6AOXH8oUvPZQn4eElRc0"}'::jsonb,
    body := '{"source":"pg_cron"}'::jsonb
  ) as request_id;
  $$
);

-- ===== Contas fixas: aviso 3 dias / 1 dia antes do vencimento. 1x/dia,
-- 09:00 America/Sao_Paulo (12:00 UTC — sem horário de verão no Brasil desde
-- 2019, mesmo padrão já usado por installment-reminders-daily). =====
SELECT cron.unschedule('bill-reminders-daily')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'bill-reminders-daily');

SELECT cron.schedule(
  'bill-reminders-daily',
  '0 12 * * *',
  $$
  SELECT net.http_post(
    url := 'https://abio.fun/api/public/hooks/bill-reminders',
    headers := '{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJtZWlidGFrdGZ4ZXVrZGNxY2lwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2NDg1ODMsImV4cCI6MjA5NTIyNDU4M30.2pV6G_FvOlzMkfdUFkSUW2P6AOXH8oUvPZQn4eElRc0"}'::jsonb,
    body := '{"source":"pg_cron"}'::jsonb
  ) as request_id;
  $$
);

-- ===== Contas fixas: pergunta "já pagou?" no dia do vencimento — manhã
-- (09:00 SP) e cobrança à noite (19:00 SP = 22:00 UTC) se ainda não
-- confirmou. Corresponde exatamente ao pedido do usuário: "no dia... após
-- o horário do pagamento final da noite às 19h perguntar se pagou". =====
SELECT cron.unschedule('bill-payment-check-morning')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'bill-payment-check-morning');

SELECT cron.schedule(
  'bill-payment-check-morning',
  '0 12 * * *',
  $$
  SELECT net.http_post(
    url := 'https://abio.fun/api/public/hooks/bill-payment-check',
    headers := '{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJtZWlidGFrdGZ4ZXVrZGNxY2lwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2NDg1ODMsImV4cCI6MjA5NTIyNDU4M30.2pV6G_FvOlzMkfdUFkSUW2P6AOXH8oUvPZQn4eElRc0"}'::jsonb,
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
    headers := '{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJtZWlidGFrdGZ4ZXVrZGNxY2lwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2NDg1ODMsImV4cCI6MjA5NTIyNDU4M30.2pV6G_FvOlzMkfdUFkSUW2P6AOXH8oUvPZQn4eElRc0"}'::jsonb,
    body := '{"source":"pg_cron","mode":"evening"}'::jsonb
  ) as request_id;
  $$
);
