-- Suporte a lembrete customizado de compromisso ("me avisar com 30 minutos
-- de antecedência", "avisar 2 horas antes"). Até aqui só existiam os 5
-- horários fixos (3d/dia/4h/1h/30m antes) — um pedido explícito do usuário
-- por um prazo específico era ignorado (o texto virava ruído ou, pior,
-- lixo dentro do título do compromisso).
ALTER TABLE public.appointment_reminders DROP CONSTRAINT IF EXISTS appointment_reminders_kind_check;
ALTER TABLE public.appointment_reminders ADD CONSTRAINT appointment_reminders_kind_check
  CHECK (kind IN ('3d_before','day_09','before_4h','before_1h','before_30m','custom'));

ALTER TABLE public.appointment_reminders
  ADD COLUMN IF NOT EXISTS custom_lead_minutes integer;
