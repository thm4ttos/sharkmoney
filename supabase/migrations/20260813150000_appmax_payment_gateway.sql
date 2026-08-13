-- Gateway de pagamento (Appmax): realinha o catálogo de planos ao que a
-- landing page realmente vende (src/lib/plans.ts), e cria a estrutura pra
-- checkout self-service com assinatura recorrente (cartão e Pix).

-- 1) Realinhar `plans` ao catálogo real de 3 planos (src/lib/plans.ts).
-- Não renomeia a linha 'semiannual' em cima da FK existente (subscriptions.plan_slug
-- referencia plans.slug) — em vez disso cria/atualiza a linha 'six_months' com o
-- mesmo period, migra qualquer assinatura existente pra ela, e só então desativa
-- a linha antiga. Isso nunca quebra por causa da constraint, mesmo se já houver
-- assinaturas atribuídas manualmente hoje.
UPDATE public.plans
  SET price_cents = 2490, duration_days = 30, name = 'Plano Mensal'
  WHERE slug = 'monthly';

INSERT INTO public.plans (slug, name, period, price_cents, duration_days, sort_order, active)
SELECT 'six_months', 'Plano Semestral', 'semiannual', 11952, 180, COALESCE(sort_order, 20), true
FROM public.plans WHERE slug = 'semiannual'
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name, period = EXCLUDED.period,
  price_cents = EXCLUDED.price_cents, duration_days = EXCLUDED.duration_days,
  active = true;

UPDATE public.subscriptions SET plan_slug = 'six_months' WHERE plan_slug = 'semiannual';
UPDATE public.plans SET active = false WHERE slug = 'semiannual';

UPDATE public.plans
  SET price_cents = 17928, duration_days = 365, name = 'Plano Anual'
  WHERE slug = 'annual';

UPDATE public.plans SET active = false WHERE slug IN ('quarterly', 'lifetime');
-- 'trial-7' fica ativo (usado por handle_new_user() no cadastro).

-- 2) Vínculo de cada assinatura com os objetos correspondentes na Appmax.
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS appmax_customer_id integer,
  ADD COLUMN IF NOT EXISTS appmax_order_id integer,
  ADD COLUMN IF NOT EXISTS appmax_subscription_id integer,
  ADD COLUMN IF NOT EXISTS payment_method text CHECK (payment_method IN ('credit_card', 'pix'));

-- 3) checkout_intents — rastreia uma tentativa de compra entre "usuário
-- clicou em assinar" e "pagamento confirmado" (necessário pro Pix, que é
-- assíncrono; cartão resolve na mesma request mas usa a mesma tabela).
CREATE TABLE public.checkout_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  plan_slug text NOT NULL REFERENCES public.plans(slug),
  appmax_customer_id integer,
  appmax_order_id integer,
  payment_method text NOT NULL CHECK (payment_method IN ('credit_card', 'pix')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX checkout_intents_order_idx ON public.checkout_intents (appmax_order_id);
CREATE INDEX checkout_intents_user_idx ON public.checkout_intents (user_id, created_at DESC);
GRANT SELECT, INSERT ON public.checkout_intents TO authenticated;
GRANT ALL ON public.checkout_intents TO service_role;
ALTER TABLE public.checkout_intents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "checkout_intents own read" ON public.checkout_intents
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "checkout_intents own insert" ON public.checkout_intents
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
-- Sem policy de UPDATE pra authenticated: todo avanço de status (completed/
-- failed/expired) é escrito pelo service role (checkout/webhook handlers),
-- que já validou a identidade antes — evita o usuário forjar "completed" sozinho.
CREATE TRIGGER checkout_intents_touch BEFORE UPDATE ON public.checkout_intents
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 4) payment_webhook_events — log + dedupe (a Appmax reenvia até 4x o mesmo
-- evento, e os webhooks dela não têm assinatura HMAC nem token — por isso
-- `verified` só vira true depois de reconfirmar via GET na API deles).
CREATE TABLE public.payment_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'appmax',
  event text NOT NULL,
  event_type text,
  external_key text,
  payload jsonb NOT NULL,
  verified boolean NOT NULL DEFAULT false,
  processed_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX payment_webhook_events_dedupe ON public.payment_webhook_events (provider, external_key) WHERE external_key IS NOT NULL;
GRANT ALL ON public.payment_webhook_events TO service_role;
ALTER TABLE public.payment_webhook_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payment_webhook_events admin read" ON public.payment_webhook_events
  FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

-- 5) appmax_credentials — mesmo padrão de zapi_credentials (singleton
-- editável só por admin, com fallback de env var no código).
CREATE TABLE public.appmax_credentials (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id text NOT NULL,
  client_secret text NOT NULL,
  -- external_id: identificador do "app" instalado no Appstore da Appmax,
  -- exigido pelo Appmax.js (window.AppmaxScripts.init) no checkout — não é
  -- secreto (fica exposto ao navegador), mas mora junto por conveniência.
  external_id text,
  environment text NOT NULL DEFAULT 'sandbox' CHECK (environment IN ('sandbox', 'production')),
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.appmax_credentials TO authenticated;
GRANT ALL ON public.appmax_credentials TO service_role;
ALTER TABLE public.appmax_credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "appmax_credentials admin all" ON public.appmax_credentials
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE TRIGGER appmax_credentials_touch BEFORE UPDATE ON public.appmax_credentials
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
