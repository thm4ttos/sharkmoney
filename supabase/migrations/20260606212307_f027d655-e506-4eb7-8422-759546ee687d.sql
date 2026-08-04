CREATE TABLE public.wa_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.wa_templates TO authenticated;
GRANT ALL ON public.wa_templates TO service_role;

ALTER TABLE public.wa_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wa_templates admin all" ON public.wa_templates
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER wa_templates_touch
  BEFORE UPDATE ON public.wa_templates
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

INSERT INTO public.wa_templates (key, title, body) VALUES
  ('welcome', 'Boas-vindas', '🎉 Bem-vindo(a) ao *BrinZap*!

Seu assistente financeiro inteligente está pronto para te ajudar.

📲 Envie mensagens, áudios ou fotos de comprovantes que eu organizo tudo automaticamente.

Digite *ajuda* para ver o que posso fazer. 🚀'),
  ('renewal', 'Renovação', '🔄 Seu plano *BrinZap* foi renovado com sucesso!

💎 Continue aproveitando todos os recursos premium.

Bons negócios! 💰'),
  ('cancel', 'Cancelamento', '😢 Que pena ver você partir...

Seu acesso ao *BrinZap* foi cancelado conforme solicitado.

Quando quiser voltar, é só nos chamar — você sempre será bem-vindo(a). 💜'),
  ('upgrade', 'Upgrade de plano', '🚀 Upgrade confirmado!

Você agora tem acesso aos recursos *premium* do BrinZap.

Aproveite tudo o que preparamos para acelerar sua vida financeira. 💎')
ON CONFLICT (key) DO NOTHING;