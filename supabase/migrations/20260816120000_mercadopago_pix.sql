-- Pix não tem API pública confirmada de cobrança automática recorrente na
-- Mercado Pago (só cartão, via Preapproval) — por isso um pagamento Pix usa
-- um id de PAGAMENTO avulso (/v1/payments), não de assinatura (/preapproval).
-- Coluna separada em vez de reaproveitar mp_preapproval_id, pra não misturar
-- os dois conceitos (uma é uma assinatura de verdade, a outra é um pagamento
-- único que precisa ser refeito a cada período).
ALTER TABLE public.checkout_intents ADD COLUMN IF NOT EXISTS mp_payment_id text;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS mp_payment_id text;
