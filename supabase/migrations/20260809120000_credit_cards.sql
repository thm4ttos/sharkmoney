-- Cartões de crédito: o cartão em si (nome, dia de fechamento, dia de
-- vencimento da fatura) + a ligação opcional de cada transação a um cartão.
-- A fatura NÃO é armazenada à parte — é sempre computada ao vivo (soma das
-- despesas do cartão dentro do ciclo de fechamento atual), o mesmo padrão já
-- usado pro saldo do mês (getMonthBalance).

CREATE TABLE public.credit_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  closing_day integer NOT NULL CHECK (closing_day BETWEEN 1 AND 31),
  due_day integer NOT NULL CHECK (due_day BETWEEN 1 AND 31),
  is_default boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX credit_cards_user_idx ON public.credit_cards(user_id) WHERE active;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.credit_cards TO authenticated;
GRANT ALL ON public.credit_cards TO service_role;
ALTER TABLE public.credit_cards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "credit_cards own all" ON public.credit_cards
  FOR ALL TO authenticated
  USING (auth.uid() = user_id OR has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (auth.uid() = user_id OR has_role(auth.uid(), 'admin'::app_role));
CREATE TRIGGER credit_cards_touch BEFORE UPDATE ON public.credit_cards
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Só um cartão padrão por usuário (usado quando "no cartão" não especifica qual).
CREATE UNIQUE INDEX credit_cards_one_default_per_user
  ON public.credit_cards(user_id) WHERE is_default AND active;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS credit_card_id uuid REFERENCES public.credit_cards(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_credit_card
  ON public.transactions(credit_card_id) WHERE credit_card_id IS NOT NULL;
