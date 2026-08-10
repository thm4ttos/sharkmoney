-- Fase 7/11 — fecha a lacuna de atomicidade em applyPartialBillPayment
-- (src/lib/brinzap-actions.server.ts): para contas fixas com PRAZO
-- DETERMINADO (consórcio/financiamento, recurring_bills.total_installments
-- preenchido), o código JS chamava esta RPC atômica (que já grava a
-- transação + zera/atualiza o saldo da conta) e DEPOIS, num segundo
-- .update() separado e NÃO atômico, incrementava paid_installments. Se essa
-- segunda chamada falhasse (rede, timeout), o dinheiro já tinha sido
-- registrado como pago mas o contador de parcelas nunca avançava —
-- divergência silenciosa entre "quanto foi pago" e "quantas parcelas
-- faltam". Dobra esse incremento pra dentro da mesma transação SQL da RPC.
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
  v_new_paid_installments int;
  v_installment_settled boolean := false;
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
      'paid_installments', v_bill.paid_installments,
      'installments_total', v_bill.total_installments,
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

  v_new_paid_installments := v_bill.paid_installments;

  IF v_done THEN
    v_next_due := CASE v_bill.frequency WHEN 'weekly' THEN v_bill.next_due_at+7 WHEN 'biweekly' THEN v_bill.next_due_at+14 WHEN 'yearly' THEN (v_bill.next_due_at+interval '1 year')::date ELSE (v_bill.next_due_at+interval '1 month')::date END;

    -- Contrato com prazo determinado (consórcio/financiamento): dar baixa em
    -- UMA parcela na MESMA transação SQL do pagamento — antes isso era um
    -- segundo .update() feito pelo JS depois do commit desta função, sem
    -- garantia nenhuma de que os dois juntos aconteciam ou nenhum acontecia.
    IF COALESCE(v_bill.total_installments, 0) > 0 THEN
      v_new_paid_installments := LEAST(v_bill.total_installments, COALESCE(v_bill.paid_installments, 0) + 1);
      v_installment_settled := v_new_paid_installments >= v_bill.total_installments;
    END IF;

    UPDATE public.recurring_bills
       SET original_amount=v_original, paid_amount=0, payment_status='pending',
           last_paid_at=COALESCE(p_occurred_at,now()), last_paid_due=v_bill.next_due_at,
           last_charged_at=COALESCE(p_occurred_at,now()), awaiting_for=NULL,
           next_due_at=v_next_due, updated_at=now(),
           paid_installments = v_new_paid_installments,
           active = CASE WHEN v_installment_settled THEN false ELSE active END
     WHERE id=p_bill_id AND user_id=p_user_id;
  ELSE
    UPDATE public.recurring_bills SET original_amount=v_original,paid_amount=v_new_paid,payment_status='partial',last_paid_at=COALESCE(p_occurred_at,now()),last_paid_due=v_bill.next_due_at,updated_at=now() WHERE id=p_bill_id AND user_id=p_user_id;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'Falha ao atualizar conta fixa'; END IF;

  RETURN jsonb_build_object(
    'payment_id',v_payment_id,'transaction_id',v_tx_id,'paid_now',v_paid_now,'paid_total',v_new_paid,
    'remaining',GREATEST(0,v_original-v_new_paid),'status',CASE WHEN v_done THEN 'paid' ELSE 'partial' END,
    'next_due_at',CASE WHEN v_done THEN v_next_due ELSE v_bill.next_due_at END,
    'paid_installments', v_new_paid_installments,
    'installments_total', v_bill.total_installments,
    'installment_settled', v_installment_settled
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_bill_payment_atomic(uuid, uuid, numeric, timestamp with time zone, text, text) TO authenticated, service_role;
