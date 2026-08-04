
-- ============ AUTO-COMMISSION ON SUBSCRIPTION ============
CREATE OR REPLACE FUNCTION public.affiliate_generate_commission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ref record;
  v_aff record;
  v_settings record;
  v_pct numeric;
  v_commission_cents int;
  v_should_generate boolean := false;
BEGIN
  -- Only for paid, non-trial subscriptions with real price.
  IF COALESCE(NEW.price_cents, 0) <= 0 THEN RETURN NEW; END IF;
  IF COALESCE(NEW.period, '') = 'trial' OR COALESCE(NEW.status,'') = 'trial' THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status IN ('active','paid') THEN v_should_generate := true; END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF (COALESCE(OLD.status,'') NOT IN ('active','paid')) AND NEW.status IN ('active','paid') THEN
      v_should_generate := true;
    END IF;
  END IF;

  IF NOT v_should_generate THEN RETURN NEW; END IF;

  -- Locate the referral link.
  SELECT * INTO v_ref FROM public.referrals WHERE user_id = NEW.user_id LIMIT 1;
  IF NOT FOUND THEN RETURN NEW; END IF;

  -- Only generate a commission ONCE per subscription id.
  IF EXISTS (SELECT 1 FROM public.affiliate_commissions WHERE subscription_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_aff FROM public.affiliates WHERE id = v_ref.affiliate_id LIMIT 1;
  IF NOT FOUND OR v_aff.status <> 'active' THEN RETURN NEW; END IF;

  SELECT * INTO v_settings FROM public.affiliate_settings WHERE id = 1;

  -- Determine commission percentage
  v_pct := v_aff.custom_commission_pct;
  IF v_pct IS NULL THEN
    v_pct := CASE COALESCE(NEW.period,'monthly')
      WHEN 'monthly'    THEN COALESCE(v_settings.commission_pct_monthly, 20)
      WHEN 'quarterly'  THEN COALESCE(v_settings.commission_pct_quarterly, 25)
      WHEN 'semiannual' THEN COALESCE(v_settings.commission_pct_semiannual, 30)
      WHEN 'annual'     THEN COALESCE(v_settings.commission_pct_annual, 35)
      WHEN 'lifetime'   THEN COALESCE(v_settings.commission_pct_lifetime, 40)
      ELSE COALESCE(v_settings.commission_pct_monthly, 20)
    END;
  END IF;

  v_commission_cents := ROUND((NEW.price_cents::numeric) * (v_pct/100.0))::int;
  IF v_commission_cents <= 0 THEN RETURN NEW; END IF;

  INSERT INTO public.affiliate_commissions(
    affiliate_id, referral_id, user_id, subscription_id, plan_slug,
    gross_cents, commission_pct, commission_cents, status, available_at, note
  ) VALUES (
    v_aff.id, v_ref.id, NEW.user_id, NEW.id, NEW.plan_slug,
    NEW.price_cents, v_pct, v_commission_cents, 'pending',
    now() + make_interval(days => COALESCE(v_settings.hold_days, 14)),
    'auto:subscription'
  );

  -- Mark referral as converted on first paid subscription
  UPDATE public.referrals
     SET status = 'converted',
         first_paid_at = COALESCE(first_paid_at, now()),
         updated_at = now()
   WHERE id = v_ref.id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_subscriptions_generate_commission ON public.subscriptions;
CREATE TRIGGER trg_subscriptions_generate_commission
AFTER INSERT OR UPDATE OF status, price_cents ON public.subscriptions
FOR EACH ROW EXECUTE FUNCTION public.affiliate_generate_commission();

-- ============ MATURATION FUNCTION ============
CREATE OR REPLACE FUNCTION public.affiliate_mature_commissions()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  WITH upd AS (
    UPDATE public.affiliate_commissions
       SET status = 'available', updated_at = now()
     WHERE status = 'pending'
       AND available_at IS NOT NULL
       AND available_at <= now()
     RETURNING id
  )
  SELECT count(*) INTO v_count FROM upd;

  RETURN jsonb_build_object('matured', v_count, 'ran_at', now());
END;
$$;

-- ============ SCHEDULE DAILY MATURATION ============
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Unschedule if it already exists to keep migration idempotent
DO $$
BEGIN
  PERFORM cron.unschedule('affiliate-mature-commissions');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'affiliate-mature-commissions',
  '0 3 * * *',
  $$SELECT public.affiliate_mature_commissions();$$
);
