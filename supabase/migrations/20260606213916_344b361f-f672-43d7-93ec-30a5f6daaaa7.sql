
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE public.whatsapp_messages ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE public.wa_broadcasts ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

-- Mark all currently-existing rows as demo data so admins can wipe them.
UPDATE public.transactions SET is_demo = true;
UPDATE public.appointments SET is_demo = true;
UPDATE public.whatsapp_messages SET is_demo = true;
UPDATE public.wa_broadcasts SET is_demo = true;

CREATE INDEX IF NOT EXISTS idx_transactions_is_demo ON public.transactions(is_demo);
CREATE INDEX IF NOT EXISTS idx_appointments_is_demo ON public.appointments(is_demo);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_is_demo ON public.whatsapp_messages(is_demo);
CREATE INDEX IF NOT EXISTS idx_wa_broadcasts_is_demo ON public.wa_broadcasts(is_demo);
