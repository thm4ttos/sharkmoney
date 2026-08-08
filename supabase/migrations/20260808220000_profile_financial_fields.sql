-- Dados de PERFIL financeiro coletados no onboarding (renda mensal, dia de
-- recebimento, profissão, objetivo) — distintos de transações realizadas.
-- Sem isso, essas informações só existiam dentro do JSON de progresso do
-- onboarding e não podiam ser consultadas/editadas depois via conversa.
alter table public.profiles
  add column if not exists monthly_income numeric,
  add column if not exists payday text,
  add column if not exists profession text,
  add column if not exists financial_goal text;
