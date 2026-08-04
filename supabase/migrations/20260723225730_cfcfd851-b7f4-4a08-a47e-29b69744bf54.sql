ALTER FUNCTION public.register_bill_payment_atomic(uuid, uuid, numeric, timestamptz, text, text) SECURITY INVOKER;
ALTER FUNCTION public.reverse_bill_payment_atomic(uuid, uuid) SECURITY INVOKER;