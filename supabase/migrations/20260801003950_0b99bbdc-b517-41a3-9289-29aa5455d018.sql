-- =========================================================
-- 1) RASTREABILIDADE NAS TRANSAÇÕES (fonte única de verdade)
-- =========================================================
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS source_type text,
  ADD COLUMN IF NOT EXISTS source_id   text,
  ADD COLUMN IF NOT EXISTS channel     text,
  ADD COLUMN IF NOT EXISTS updated_at  timestamptz NOT NULL DEFAULT now();

UPDATE public.transactions
   SET source_type = COALESCE(source_type,
         CASE
           WHEN source = 'whatsapp'   THEN 'whatsapp_message'
           WHEN source = 'recurring'  THEN 'fixed_bill'
           WHEN source = 'installment' THEN 'installment_purchase'
           WHEN source = 'import'     THEN 'import_batch'
           ELSE COALESCE(source, 'manual')
         END),
       source_id = COALESCE(source_id, source_message_id::text, import_batch_id::text),
       channel = COALESCE(channel,
         CASE
           WHEN source = 'whatsapp' THEN 'whatsapp'
           WHEN source = 'import'   THEN 'import'
           ELSE 'site'
         END)
 WHERE source_type IS NULL OR channel IS NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_source_ref
  ON public.transactions (user_id, source_type, source_id);

DROP TRIGGER IF EXISTS trg_transactions_touch_updated_at ON public.transactions;
CREATE TRIGGER trg_transactions_touch_updated_at
  BEFORE UPDATE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- =========================================================
-- 2) RESUMO FINANCEIRO OFICIAL — usado por site E WhatsApp
--    Nada é armazenado: sempre derivado de public.transactions.
-- =========================================================
CREATE OR REPLACE FUNCTION public.finance_snapshot(
  _user_id uuid,
  _from timestamptz DEFAULT NULL,
  _to   timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $$
DECLARE
  caller uuid := auth.uid();
  v_income  numeric := 0;
  v_expense numeric := 0;
  v_count   int := 0;
  v_cats    jsonb := '[]'::jsonb;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'user_id obrigatório';
  END IF;
  -- Chamadas autenticadas só podem ler o próprio resumo.
  IF caller IS NOT NULL AND caller <> _user_id THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  SELECT
    COALESCE(SUM(CASE WHEN t.kind = 'income'  THEN t.amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN t.kind = 'expense' THEN t.amount ELSE 0 END), 0),
    COUNT(*)
    INTO v_income, v_expense, v_count
  FROM public.transactions t
  WHERE t.user_id = _user_id
    AND (_from IS NULL OR t.occurred_at >= _from)
    AND (_to   IS NULL OR t.occurred_at <= _to);

  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'total')::numeric DESC), '[]'::jsonb)
    INTO v_cats
  FROM (
    SELECT jsonb_build_object(
             'category', COALESCE(NULLIF(btrim(t.category), ''), 'Outros'),
             'kind', t.kind::text,
             'total', ROUND(SUM(t.amount), 2),
             'count', COUNT(*)
           ) AS x
    FROM public.transactions t
    WHERE t.user_id = _user_id
      AND (_from IS NULL OR t.occurred_at >= _from)
      AND (_to   IS NULL OR t.occurred_at <= _to)
    GROUP BY COALESCE(NULLIF(btrim(t.category), ''), 'Outros'), t.kind
  ) s;

  RETURN jsonb_build_object(
    'user_id', _user_id,
    'from', _from,
    'to', _to,
    'income',  ROUND(v_income, 2),
    'expense', ROUND(v_expense, 2),
    'balance', ROUND(v_income - v_expense, 2),
    'tx_count', v_count,
    'by_category', v_cats,
    'generated_at', now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.finance_snapshot(uuid, timestamptz, timestamptz) TO authenticated, service_role;

-- =========================================================
-- 3) PAGAMENTO DE PARCELA ATÔMICO (site + WhatsApp)
-- =========================================================
CREATE OR REPLACE FUNCTION public.pay_installment_atomic(
  p_user_id uuid,
  p_purchase_id uuid,
  p_occurred_at timestamptz DEFAULT now(),
  p_channel text DEFAULT 'site'
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_row public.installment_purchases%ROWTYPE;
  v_number int;
  v_value numeric;
  v_tx_id uuid;
  v_finished boolean;
  v_is_privileged boolean := (
    current_user IN ('service_role','postgres','supabase_admin')
    OR COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role'
    OR COALESCE(current_setting('request.jwt.claims', true), '')::text ILIKE '%"role":"service_role"%'
  );
BEGIN
  IF NOT v_is_privileged AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  SELECT * INTO v_row FROM public.installment_purchases
   WHERE id = p_purchase_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Compra parcelada não encontrada'; END IF;

  IF v_row.installments_paid >= v_row.installments_total THEN
    RETURN jsonb_build_object('already_done', true, 'paid_number', v_row.installments_paid);
  END IF;

  v_number := v_row.installments_paid + 1;
  v_value := ROUND(v_row.total_amount / GREATEST(v_row.installments_total, 1), 2);
  v_finished := v_number >= v_row.installments_total;

  INSERT INTO public.transactions(
    user_id, kind, amount, category, description, occurred_at,
    source, source_type, source_id, channel
  ) VALUES (
    p_user_id, 'expense', v_value, COALESCE(NULLIF(v_row.category,''), 'Compras'),
    v_row.title || ' (' || v_number || '/' || v_row.installments_total || ')',
    COALESCE(p_occurred_at, now()), 'installment', 'installment_purchase',
    p_purchase_id::text, COALESCE(NULLIF(p_channel,''), 'site')
  ) RETURNING id INTO v_tx_id;

  UPDATE public.installment_purchases
     SET installments_paid = v_number,
         active = CASE WHEN v_finished THEN false ELSE active END,
         updated_at = now()
   WHERE id = p_purchase_id AND user_id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Falha ao atualizar a compra parcelada'; END IF;

  DELETE FROM public.installment_reminder_log
   WHERE purchase_id = p_purchase_id AND installment_number = v_number;

  RETURN jsonb_build_object(
    'transaction_id', v_tx_id,
    'paid_number', v_number,
    'paid_amount', v_value,
    'installments_total', v_row.installments_total,
    'finished', v_finished
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.pay_installment_atomic(uuid, uuid, timestamptz, text) TO authenticated, service_role;

-- =========================================================
-- 4) CONTAS FIXAS: gravar origem/canal na despesa criada
-- =========================================================
CREATE OR REPLACE FUNCTION public.register_bill_payment_atomic(
  p_user_id uuid, p_bill_id uuid, p_amount numeric,
  p_occurred_at timestamp with time zone, p_notes text DEFAULT NULL::text,
  p_source text DEFAULT 'panel'::text
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_bill public.recurring_bills%ROWTYPE;
  v_original numeric;
  v_paid_before numeric;
  v_outstanding numeric;
  v_paid_now numeric;
  v_new_paid numeric;
  v_done boolean;
  v_tx_id uuid;
  v_payment_id uuid;
  v_next_due date;
  v_dup public.bill_payments%ROWTYPE;
  v_channel text := CASE WHEN COALESCE(p_source,'') = 'whatsapp' THEN 'whatsapp' ELSE 'site' END;
  v_is_privileged boolean := (
    current_user IN ('service_role','postgres','supabase_admin')
    OR COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role'
    OR COALESCE(current_setting('request.jwt.claims', true), '')::text ILIKE '%"role":"service_role"%'
  );
BEGIN
  IF NOT v_is_privileged AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  SELECT * INTO v_bill FROM public.recurring_bills WHERE id=p_bill_id AND user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conta fixa não encontrada'; END IF;

  v_original := COALESCE(v_bill.original_amount, v_bill.amount);
  v_paid_before := COALESCE(v_bill.paid_amount, 0);
  v_outstanding := GREATEST(0, v_original-v_paid_before);
  v_paid_now := ROUND(LEAST(p_amount, v_outstanding), 2);
  IF v_paid_now <= 0 THEN RAISE EXCEPTION 'Valor de pagamento inválido'; END IF;

  SELECT * INTO v_dup FROM public.bill_payments
   WHERE user_id=p_user_id AND bill_id=p_bill_id
     AND amount = v_paid_now
     AND created_at >= now() - interval '30 seconds'
   ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'payment_id', v_dup.id, 'transaction_id', v_dup.transaction_id,
      'paid_now', v_dup.amount, 'paid_total', ROUND(v_paid_before,2),
      'remaining', GREATEST(0, v_original - v_paid_before),
      'status', v_bill.payment_status, 'next_due_at', v_bill.next_due_at,
      'duplicate', true
    );
  END IF;

  v_new_paid := ROUND(v_paid_before+v_paid_now, 2);
  v_done := (v_original-v_new_paid) <= 0.01;

  INSERT INTO public.transactions(
    user_id, kind, amount, category, description, occurred_at,
    source, source_type, source_id, channel
  )
  VALUES(p_user_id,'expense',v_paid_now,COALESCE(v_bill.category,'Contas Fixas'),
         v_bill.title||CASE WHEN v_done THEN '' ELSE ' — pagamento parcial' END,
         COALESCE(p_occurred_at,now()),'recurring','fixed_bill',p_bill_id::text,v_channel)
  RETURNING id INTO v_tx_id;

  INSERT INTO public.bill_payments(user_id,bill_id,amount,paid_at,notes,source,transaction_id,cycle_due_at,was_full_payment)
  VALUES(p_user_id,p_bill_id,v_paid_now,COALESCE(p_occurred_at,now()),NULLIF(btrim(p_notes),''),COALESCE(NULLIF(p_source,''),'panel'),v_tx_id,v_bill.next_due_at,v_done)
  RETURNING id INTO v_payment_id;

  IF v_done THEN
    v_next_due := CASE v_bill.frequency WHEN 'weekly' THEN v_bill.next_due_at+7 WHEN 'biweekly' THEN v_bill.next_due_at+14 WHEN 'yearly' THEN (v_bill.next_due_at+interval '1 year')::date ELSE (v_bill.next_due_at+interval '1 month')::date END;
    UPDATE public.recurring_bills SET original_amount=v_original,paid_amount=0,payment_status='pending',last_paid_at=COALESCE(p_occurred_at,now()),last_paid_due=v_bill.next_due_at,last_charged_at=COALESCE(p_occurred_at,now()),awaiting_for=NULL,next_due_at=v_next_due,updated_at=now() WHERE id=p_bill_id AND user_id=p_user_id;
  ELSE
    UPDATE public.recurring_bills SET original_amount=v_original,paid_amount=v_new_paid,payment_status='partial',last_paid_at=COALESCE(p_occurred_at,now()),last_paid_due=v_bill.next_due_at,updated_at=now() WHERE id=p_bill_id AND user_id=p_user_id;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'Falha ao atualizar conta fixa'; END IF;

  RETURN jsonb_build_object('payment_id',v_payment_id,'transaction_id',v_tx_id,'paid_now',v_paid_now,'paid_total',v_new_paid,'remaining',GREATEST(0,v_original-v_new_paid),'status',CASE WHEN v_done THEN 'paid' ELSE 'partial' END,'next_due_at',CASE WHEN v_done THEN v_next_due ELSE v_bill.next_due_at END);
END;
$$;

-- =========================================================
-- 5) LOG DE DIVERGÊNCIAS DE RECONCILIAÇÃO
-- =========================================================
CREATE TABLE IF NOT EXISTS public.finance_reconciliation_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel text NOT NULL,
  ledger_balance numeric NOT NULL,
  reported_balance numeric NOT NULL,
  diff numeric NOT NULL,
  consistent boolean NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.finance_reconciliation_log TO authenticated;
GRANT ALL ON public.finance_reconciliation_log TO service_role;

ALTER TABLE public.finance_reconciliation_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own reconciliation logs" ON public.finance_reconciliation_log;
CREATE POLICY "own reconciliation logs"
  ON public.finance_reconciliation_log FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_reconciliation_log_user
  ON public.finance_reconciliation_log (user_id, created_at DESC);