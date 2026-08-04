
-- 1) Remove the redundant permissive policy on user_roles that targeted {public}
DROP POLICY IF EXISTS "admins manage roles" ON public.user_roles;

-- 2) Add explicit admin-only policies on ai_settings (service_role bypasses RLS).
DROP POLICY IF EXISTS "ai_settings admin select" ON public.ai_settings;
DROP POLICY IF EXISTS "ai_settings admin insert" ON public.ai_settings;
DROP POLICY IF EXISTS "ai_settings admin update" ON public.ai_settings;
DROP POLICY IF EXISTS "ai_settings admin delete" ON public.ai_settings;

CREATE POLICY "ai_settings admin select"
  ON public.ai_settings
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "ai_settings admin insert"
  ON public.ai_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "ai_settings admin update"
  ON public.ai_settings
  FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "ai_settings admin delete"
  ON public.ai_settings
  FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));
