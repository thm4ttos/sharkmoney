-- 1) Remove overly permissive INSERT policy on affiliate_clicks (writes are service-role only via /api/public/affiliate/track)
DROP POLICY IF EXISTS "anon insert click" ON public.affiliate_clicks;

REVOKE ALL ON public.affiliate_clicks FROM anon;
REVOKE ALL ON public.affiliate_clicks FROM authenticated;
GRANT SELECT ON public.affiliate_clicks TO authenticated;
GRANT ALL ON public.affiliate_clicks TO service_role;

-- 2) appointment_reminders: system-generated only; owner read access, restricted to signed-in users
DROP POLICY IF EXISTS "Users can view own appointment reminders" ON public.appointment_reminders;
CREATE POLICY "Users can view own appointment reminders"
  ON public.appointment_reminders
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

REVOKE ALL ON public.appointment_reminders FROM anon;
REVOKE ALL ON public.appointment_reminders FROM authenticated;
GRANT SELECT ON public.appointment_reminders TO authenticated;
GRANT ALL ON public.appointment_reminders TO service_role;

-- 3) password_recovery_log: service-role writes only, admin-only reads
REVOKE ALL ON public.password_recovery_log FROM anon;
REVOKE ALL ON public.password_recovery_log FROM authenticated;
GRANT SELECT ON public.password_recovery_log TO authenticated;
GRANT ALL ON public.password_recovery_log TO service_role;

-- 4) wa_message_jobs: service-role writes only, admin-only reads
REVOKE ALL ON public.wa_message_jobs FROM anon;
REVOKE ALL ON public.wa_message_jobs FROM authenticated;
GRANT SELECT ON public.wa_message_jobs TO authenticated;
GRANT ALL ON public.wa_message_jobs TO service_role;