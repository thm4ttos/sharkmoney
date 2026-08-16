-- Substitui a Appmax pelo Mercado Pago como gateway de pagamento. A
-- integração com a Appmax nunca chegou a processar uma cobrança real (travou
-- no login do ambiente sandbox deles) — por isso as colunas/tabela específicas
-- dela são removidas de vez em vez de mantidas mortas ao lado das novas.

-- 1) Credenciais Appmax → Mercado Pago. Mesmo padrão de zapi_credentials:
-- singleton editável só por admin, com fallback de env var no código. O
-- Mercado Pago não exige nenhum fluxo de instalação/autorização — só
-- Access Token (privado, backend) + Public Key (público, tokenização de
-- cartão no navegador) tirados direto do painel do próprio usuário.
DROP TABLE IF EXISTS public.appmax_credentials;

CREATE TABLE public.mercadopago_credentials (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  access_token text NOT NULL,
  public_key text NOT NULL,
  -- Segredo gerado à parte no painel "Suas integrações" ao configurar a URL
  -- de webhook — NÃO é o access_token. Usado só pra verificar o HMAC-SHA256
  -- do header x-signature (o Mercado Pago, diferente da Appmax, assina os
  -- webhooks de verdade).
  webhook_secret text,
  environment text NOT NULL DEFAULT 'sandbox' CHECK (environment IN ('sandbox', 'production')),
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mercadopago_credentials TO authenticated;
GRANT ALL ON public.mercadopago_credentials TO service_role;
ALTER TABLE public.mercadopago_credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mercadopago_credentials admin all" ON public.mercadopago_credentials
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE TRIGGER mercadopago_credentials_touch BEFORE UPDATE ON public.mercadopago_credentials
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 2) subscriptions: troca o vínculo com objetos da Appmax (customer/order/
-- subscription) pelo único id que o Mercado Pago usa pra assinatura
-- recorrente — o preapproval.
ALTER TABLE public.subscriptions
  DROP COLUMN IF EXISTS appmax_customer_id,
  DROP COLUMN IF EXISTS appmax_order_id,
  DROP COLUMN IF EXISTS appmax_subscription_id,
  ADD COLUMN IF NOT EXISTS mp_preapproval_id text;

-- 3) checkout_intents: mesma troca.
ALTER TABLE public.checkout_intents
  DROP COLUMN IF EXISTS appmax_customer_id,
  DROP COLUMN IF EXISTS appmax_order_id,
  ADD COLUMN IF NOT EXISTS mp_preapproval_id text;

-- 4) plans: cada plano do Abio (mensal/semestral/anual) vira um
-- "preapproval_plan" no Mercado Pago — criado uma vez (sob demanda, no
-- primeiro checkout de cada plano) e reaproveitado depois. Guarda o id aqui.
ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS mp_plan_id text;

-- 5) payment_webhook_events já é genérica (coluna `provider`) — só ajusta o
-- default pro provedor atual; eventos antigos gravados como 'appmax'
-- continuam existindo no histórico normalmente.
ALTER TABLE public.payment_webhook_events
  ALTER COLUMN provider SET DEFAULT 'mercadopago';
