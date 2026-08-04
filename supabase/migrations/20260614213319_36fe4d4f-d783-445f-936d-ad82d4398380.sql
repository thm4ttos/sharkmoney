
CREATE TABLE public.password_recovery_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  method text NOT NULL CHECK (method IN ('email','whatsapp')),
  identifier text NOT NULL,
  phone text,
  email text,
  ok boolean NOT NULL DEFAULT false,
  error text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_recovery_log_user_created_idx ON public.password_recovery_log(user_id, created_at DESC);
CREATE INDEX password_recovery_log_ident_created_idx ON public.password_recovery_log(identifier, created_at DESC);
GRANT SELECT ON public.password_recovery_log TO authenticated;
GRANT ALL ON public.password_recovery_log TO service_role;
ALTER TABLE public.password_recovery_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view all recovery logs" ON public.password_recovery_log
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
