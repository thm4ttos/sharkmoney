CREATE OR REPLACE FUNCTION public.register_bill_payment_atomic(p_user_id uuid, p_bill_id uuid, p_amount numeric, p_occurred_at timestamp with time zone, p_notes text DEFAULT NULL::text, p_source text DEFAULT 'panel'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
  v_new_paid := ROUND(v_paid_before+v_paid_now, 2);
  v_done := (v_original-v_new_paid) <= 0.01;

  INSERT INTO public.transactions(user_id,kind,amount,category,description,occurred_at,source)
  VALUES(p_user_id,'expense',v_paid_now,COALESCE(v_bill.category,'Contas Fixas'),v_bill.title||CASE WHEN v_done THEN '' ELSE ' (parcial)' END,COALESCE(p_occurred_at,now()),'recurring')
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
$function$;

CREATE OR REPLACE FUNCTION public.reverse_bill_payment_atomic(p_user_id uuid, p_payment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_payment public.bill_payments%ROWTYPE;
  v_bill public.recurring_bills%ROWTYPE;
  v_original numeric;
  v_paid_total numeric;
  v_status text;
  v_is_privileged boolean := (
    current_user IN ('service_role','postgres','supabase_admin')
    OR COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role'
    OR COALESCE(current_setting('request.jwt.claims', true), '')::text ILIKE '%"role":"service_role"%'
  );
BEGIN
  IF NOT v_is_privileged AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  SELECT * INTO v_payment FROM public.bill_payments WHERE id = p_payment_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pagamento não encontrado'; END IF;

  SELECT * INTO v_bill FROM public.recurring_bills WHERE id = v_payment.bill_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conta fixa não encontrada'; END IF;

  IF v_payment.transaction_id IS NOT NULL THEN
    DELETE FROM public.transactions WHERE id = v_payment.transaction_id AND user_id = p_user_id;
  END IF;

  DELETE FROM public.bill_payments WHERE id = p_payment_id AND user_id = p_user_id;

  SELECT COALESCE(SUM(amount), 0) INTO v_paid_total
  FROM public.bill_payments
  WHERE bill_id = v_payment.bill_id AND user_id = p_user_id AND cycle_due_at = v_payment.cycle_due_at;

  v_original := COALESCE(v_bill.original_amount, v_bill.amount);
  v_status := CASE WHEN v_paid_total > 0.01 THEN 'partial' ELSE 'pending' END;

  UPDATE public.recurring_bills
  SET original_amount = v_original,
      paid_amount = ROUND(v_paid_total, 2),
      payment_status = v_status,
      next_due_at = CASE WHEN v_payment.was_full_payment THEN v_payment.cycle_due_at ELSE next_due_at END,
      last_paid_at = (SELECT MAX(paid_at) FROM public.bill_payments WHERE bill_id = v_payment.bill_id AND user_id = p_user_id AND cycle_due_at = v_payment.cycle_due_at),
      last_paid_due = CASE WHEN v_paid_total > 0.01 THEN v_payment.cycle_due_at ELSE NULL END,
      last_charged_at = CASE WHEN v_paid_total > 0.01 THEN last_charged_at ELSE NULL END,
      updated_at = now()
  WHERE id = v_payment.bill_id AND user_id = p_user_id;

  RETURN jsonb_build_object(
    'bill_id', v_payment.bill_id,
    'reversed_amount', v_payment.amount,
    'paid_total', ROUND(v_paid_total, 2),
    'remaining', GREATEST(0, v_original - v_paid_total),
    'status', v_status,
    'next_due_at', CASE WHEN v_payment.was_full_payment THEN v_payment.cycle_due_at ELSE v_bill.next_due_at END
  );
END;
$function$;