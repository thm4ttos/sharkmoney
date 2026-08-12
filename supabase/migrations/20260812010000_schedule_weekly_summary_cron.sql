-- Resumo semanal: o handler (src/routes/api/public/hooks/weekly-summary.ts)
-- já está completo — intro variada, comparação com a semana anterior,
-- mensagem motivacional quando não há movimentação, opt-out conversacional,
-- idempotência via weekly_summary_log — mas, igual aos 3 motores de
-- lembrete corrigidos antes nesta sessão, nunca foi agendado em nenhuma
-- migration. Domingo 21:00 America/Sao_Paulo (UTC-3, sem horário de verão
-- desde 2019) = segunda 00:00 UTC — por isso o cron roda '0 0 * * 1', não
-- '0 0 * * 0'.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule('weekly-summary-sunday')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'weekly-summary-sunday');

SELECT cron.schedule(
  'weekly-summary-sunday',
  '0 0 * * 1',
  $$
  SELECT net.http_post(
    url := 'https://abio.fun/api/public/hooks/weekly-summary',
    headers := '{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJtZWlidGFrdGZ4ZXVrZGNxY2lwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2NDg1ODMsImV4cCI6MjA5NTIyNDU4M30.2pV6G_FvOlzMkfdUFkSUW2P6AOXH8oUvPZQn4eElRc0"}'::jsonb,
    body := '{"source":"pg_cron"}'::jsonb
  ) as request_id;
  $$
);
