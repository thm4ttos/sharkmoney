CREATE OR REPLACE FUNCTION public.reset_my_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  removed jsonb := '{}'::jsonb;
  n int;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  DELETE FROM public.whatsapp_messages     WHERE user_id = uid; GET DIAGNOSTICS n = ROW_COUNT; removed := removed || jsonb_build_object('whatsapp_messages', n);
  DELETE FROM public.transactions          WHERE user_id = uid; GET DIAGNOSTICS n = ROW_COUNT; removed := removed || jsonb_build_object('transactions', n);
  DELETE FROM public.appointments          WHERE user_id = uid; GET DIAGNOSTICS n = ROW_COUNT; removed := removed || jsonb_build_object('appointments', n);
  DELETE FROM public.financial_goals       WHERE user_id = uid; GET DIAGNOSTICS n = ROW_COUNT; removed := removed || jsonb_build_object('financial_goals', n);
  DELETE FROM public.recurring_bills       WHERE user_id = uid; GET DIAGNOSTICS n = ROW_COUNT; removed := removed || jsonb_build_object('recurring_bills', n);
  DELETE FROM public.installment_purchases WHERE user_id = uid; GET DIAGNOSTICS n = ROW_COUNT; removed := removed || jsonb_build_object('installment_purchases', n);
  DELETE FROM public.debts                 WHERE user_id = uid; GET DIAGNOSTICS n = ROW_COUNT; removed := removed || jsonb_build_object('debts', n);
  DELETE FROM public.budgets               WHERE user_id = uid; GET DIAGNOSTICS n = ROW_COUNT; removed := removed || jsonb_build_object('budgets', n);
  DELETE FROM public.salary_entries        WHERE user_id = uid; GET DIAGNOSTICS n = ROW_COUNT; removed := removed || jsonb_build_object('salary_entries', n);
  DELETE FROM public.assets                WHERE user_id = uid; GET DIAGNOSTICS n = ROW_COUNT; removed := removed || jsonb_build_object('assets', n);

  BEGIN
    INSERT INTO public.reset_audit_logs(user_id, total_removed, ok, details)
    VALUES (uid, (SELECT COALESCE(SUM(value::int),0) FROM jsonb_each_text(removed)), true, removed);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN removed;
END;
$$;

REVOKE ALL ON FUNCTION public.reset_my_data() FROM public;
GRANT EXECUTE ON FUNCTION public.reset_my_data() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_reset_user_data(target uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  removed jsonb := '{}'::jsonb;
  n int;
BEGIN
  IF caller IS NULL OR NOT public.has_role(caller, 'admin') THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;
  IF target IS NULL THEN
    RAISE EXCEPTION 'target obrigatório';
  END IF;

  DELETE FROM public.whatsapp_messages     WHERE user_id = target; GET DIAGNOSTICS n = ROW_COUNT; removed := removed || jsonb_build_object('whatsapp_messages', n);
  DELETE FROM public.transactions          WHERE user_id = target; GET DIAGNOSTICS n = ROW_COUNT; removed := removed || jsonb_build_object('transactions', n);
  DELETE FROM public.appointments          WHERE user_id = target; GET DIAGNOSTICS n = ROW_COUNT; removed := removed || jsonb_build_object('appointments', n);
  DELETE FROM public.financial_goals       WHERE user_id = target; GET DIAGNOSTICS n = ROW_COUNT; removed := removed || jsonb_build_object('financial_goals', n);
  DELETE FROM public.recurring_bills       WHERE user_id = target; GET DIAGNOSTICS n = ROW_COUNT; removed := removed || jsonb_build_object('recurring_bills', n);
  DELETE FROM public.installment_purchases WHERE user_id = target; GET DIAGNOSTICS n = ROW_COUNT; removed := removed || jsonb_build_object('installment_purchases', n);
  DELETE FROM public.debts                 WHERE user_id = target; GET DIAGNOSTICS n = ROW_COUNT; removed := removed || jsonb_build_object('debts', n);
  DELETE FROM public.budgets               WHERE user_id = target; GET DIAGNOSTICS n = ROW_COUNT; removed := removed || jsonb_build_object('budgets', n);
  DELETE FROM public.salary_entries        WHERE user_id = target; GET DIAGNOSTICS n = ROW_COUNT; removed := removed || jsonb_build_object('salary_entries', n);
  DELETE FROM public.assets                WHERE user_id = target; GET DIAGNOSTICS n = ROW_COUNT; removed := removed || jsonb_build_object('assets', n);

  BEGIN
    INSERT INTO public.reset_audit_logs(user_id, total_removed, ok, details)
    VALUES (target, (SELECT COALESCE(SUM(value::int),0) FROM jsonb_each_text(removed)), true,
            removed || jsonb_build_object('_by_admin', caller));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN removed;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_reset_user_data(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_reset_user_data(uuid) TO authenticated;