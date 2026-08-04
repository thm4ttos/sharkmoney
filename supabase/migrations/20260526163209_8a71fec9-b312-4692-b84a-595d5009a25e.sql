
-- 1) Credenciais Z-API (singleton)
CREATE TABLE public.zapi_credentials (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  instance_id text NOT NULL,
  instance_token text NOT NULL,
  client_token text NOT NULL,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.zapi_credentials TO authenticated;
GRANT ALL ON public.zapi_credentials TO service_role;
ALTER TABLE public.zapi_credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "zapi admin all" ON public.zapi_credentials
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE TRIGGER zapi_credentials_touch BEFORE UPDATE ON public.zapi_credentials
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 2) Contatos
CREATE TABLE public.wa_contacts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL DEFAULT '',
  phone text NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX wa_contacts_phone_unique ON public.wa_contacts (phone);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wa_contacts TO authenticated;
GRANT ALL ON public.wa_contacts TO service_role;
ALTER TABLE public.wa_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wa_contacts admin all" ON public.wa_contacts
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE TRIGGER wa_contacts_touch BEFORE UPDATE ON public.wa_contacts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 3) Histórico de envios
CREATE TABLE public.wa_broadcasts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  contact_id uuid REFERENCES public.wa_contacts(id) ON DELETE SET NULL,
  phone text NOT NULL,
  kind text NOT NULL DEFAULT 'text',
  content text,
  image_url text,
  caption text,
  status text NOT NULL DEFAULT 'pending',
  error text,
  response jsonb,
  sent_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wa_broadcasts_created_at_idx ON public.wa_broadcasts (created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wa_broadcasts TO authenticated;
GRANT ALL ON public.wa_broadcasts TO service_role;
ALTER TABLE public.wa_broadcasts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wa_broadcasts admin all" ON public.wa_broadcasts
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
