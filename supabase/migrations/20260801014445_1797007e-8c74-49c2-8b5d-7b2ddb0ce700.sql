CREATE TABLE public.audit_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  transaction_id uuid NOT NULL,
  action text NOT NULL,
  origin text NOT NULL DEFAULT 'Auditoria Financeira',
  reason text,
  before_data jsonb,
  after_data jsonb,
  amount_before numeric,
  amount_after numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.audit_corrections TO authenticated;
GRANT ALL ON public.audit_corrections TO service_role;

ALTER TABLE public.audit_corrections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own audit corrections"
ON public.audit_corrections FOR SELECT TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Users insert own audit corrections"
ON public.audit_corrections FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE INDEX idx_audit_corrections_user_created ON public.audit_corrections(user_id, created_at DESC);

-- ===== Edição atômica pela auditoria =====
CREATE OR REPLACE FUNCTION public.audit_update_transaction(
  p_transaction_id uuid,
  p_kind text,
  p_amount numeric,
  p_category text,
  p_description text,
  p_occurred_at timestamptz,
  p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  uid uuid := auth.uid();
  v_old public.transactions%ROWTYPE;
  v_new public.transactions%ROWTYPE;
  v_payment public.bill_payments%ROWTYPE;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Valor inválido'; END IF;
  IF p_kind NOT IN ('income','expense') THEN RAISE EXCEPTION 'Tipo inválido'; END IF;

  SELECT * INTO v_old FROM public.transactions
   WHERE id = p_transaction_id AND user_id = uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lançamento não encontrado'; END IF;

  UPDATE public.transactions
     SET kind = p_kind::tx_kind,
         amount = ROUND(p_amount, 2),
         category = COALESCE(NULLIF(btrim(p_category), ''), v_old.category),
         description = NULLIF(btrim(p_description), ''),
         occurred_at = COALESCE(p_occurred_at, v_old.occurred_at),
         updated_at = now()
   WHERE id = p_transaction_id AND user_id = uid
  RETURNING * INTO v_new;

  -- Mantém o pagamento de conta fixa vinculado consistente com o novo valor.
  SELECT * INTO v_payment FROM public.bill_payments
   WHERE user_id = uid AND transaction_id = p_transaction_id FOR UPDATE;
  IF FOUND THEN
    UPDATE public.bill_payments
       SET amount = ROUND(p_amount, 2), paid_at = COALESCE(p_occurred_at, paid_at)
     WHERE id = v_payment.id;

    UPDATE public.recurring_bills b
       SET paid_amount = ROUND(COALESCE((
             SELECT SUM(amount) FROM public.bill_payments
              WHERE bill_id = v_payment.bill_id AND user_id = uid
                AND cycle_due_at = v_payment.cycle_due_at
           ), 0), 2),
           updated_at = now()
     WHERE b.id = v_payment.bill_id AND b.user_id = uid;
  END IF;

  INSERT INTO public.audit_corrections(user_id, transaction_id, action, reason, before_data, after_data, amount_before, amount_after)
  VALUES (uid, p_transaction_id, 'edit', NULLIF(btrim(p_reason),''),
          row_to_json(v_old)::jsonb, row_to_json(v_new)::jsonb, v_old.amount, v_new.amount);

  RETURN jsonb_build_object('ok', true, 'transaction', row_to_json(v_new)::jsonb, 'bill_payment_synced', v_payment.id IS NOT NULL);
END;
$$;

GRANT EXECUTE ON FUNCTION public.audit_update_transaction(uuid, text, numeric, text, text, timestamptz, text) TO authenticated;

-- ===== Exclusão atômica pela auditoria =====
-- p_mode: 'reopen_bill'  -> exclui a transação e o pagamento, reabrindo a conta fixa
--         'transaction_only' -> exclui só a transação, desvinculando o pagamento
--         'plain' -> exclui a transação (sem vínculos)
CREATE OR REPLACE FUNCTION public.audit_delete_transaction(
  p_transaction_id uuid,
  p_mode text DEFAULT 'plain',
  p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  uid uuid := auth.uid();
  v_old public.transactions%ROWTYPE;
  v_payment public.bill_payments%ROWTYPE;
  v_purchase public.installment_purchases%ROWTYPE;
  v_handled text := 'plain';
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;

  SELECT * INTO v_old FROM public.transactions
   WHERE id = p_transaction_id AND user_id = uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lançamento não encontrado'; END IF;

  SELECT * INTO v_payment FROM public.bill_payments
   WHERE user_id = uid AND transaction_id = p_transaction_id FOR UPDATE;

  IF FOUND THEN
    IF COALESCE(p_mode,'plain') = 'transaction_only' THEN
      UPDATE public.bill_payments SET transaction_id = NULL WHERE id = v_payment.id;
      DELETE FROM public.transactions WHERE id = p_transaction_id AND user_id = uid;
      v_handled := 'transaction_only';
    ELSE
      -- reverse_bill_payment_atomic já apaga a transação, o pagamento e reabre a conta
      PERFORM public.reverse_bill_payment_atomic(uid, v_payment.id);
      v_handled := 'reopen_bill';
    END IF;
  ELSE
    -- Vínculo com compra parcelada: devolve a parcela para pendente
    IF v_old.source_type = 'installment_purchase' AND v_old.source_id IS NOT NULL THEN
      SELECT * INTO v_purchase FROM public.installment_purchases
       WHERE id = v_old.source_id::uuid AND user_id = uid FOR UPDATE;
      IF FOUND THEN
        UPDATE public.installment_purchases
           SET installments_paid = GREATEST(0, installments_paid - 1),
               active = true,
               updated_at = now()
         WHERE id = v_purchase.id AND user_id = uid;
        v_handled := 'installment_reopened';
      END IF;
    END IF;
    DELETE FROM public.transactions WHERE id = p_transaction_id AND user_id = uid;
  END IF;

  INSERT INTO public.audit_corrections(user_id, transaction_id, action, reason, before_data, after_data, amount_before, amount_after)
  VALUES (uid, p_transaction_id, 'delete:' || v_handled, NULLIF(btrim(p_reason),''),
          row_to_json(v_old)::jsonb, NULL, v_old.amount, NULL);

  RETURN jsonb_build_object('ok', true, 'handled', v_handled, 'amount', v_old.amount);
END;
$$;

GRANT EXECUTE ON FUNCTION public.audit_delete_transaction(uuid, text, text) TO authenticated;