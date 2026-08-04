
ALTER TABLE public.wa_contacts ADD COLUMN IF NOT EXISTS pending_action jsonb;
ALTER TABLE public.whatsapp_messages ADD COLUMN IF NOT EXISTS ai_meta jsonb;
