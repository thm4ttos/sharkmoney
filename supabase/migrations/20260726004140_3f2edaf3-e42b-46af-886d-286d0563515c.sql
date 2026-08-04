
-- ================= AFFILIATES CORE =================

CREATE TABLE public.affiliates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','blocked','pending')),
  custom_commission_pct numeric(5,2),
  coupon_code text UNIQUE,
  admin_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_affiliates_status ON public.affiliates(status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.affiliates TO authenticated;
GRANT ALL ON public.affiliates TO service_role;
ALTER TABLE public.affiliates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Affiliate reads own" ON public.affiliates
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "Admin manages affiliates" ON public.affiliates
  FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TRIGGER trg_affiliates_updated BEFORE UPDATE ON public.affiliates
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ================= SETTINGS (singleton row id=1) =================
CREATE TABLE public.affiliate_settings (
  id int PRIMARY KEY DEFAULT 1 CHECK (id=1),
  cookie_days int NOT NULL DEFAULT 60,
  min_payout_cents int NOT NULL DEFAULT 5000,
  commission_pct_monthly numeric(5,2) NOT NULL DEFAULT 30.00,
  commission_pct_quarterly numeric(5,2) NOT NULL DEFAULT 25.00,
  commission_pct_semiannual numeric(5,2) NOT NULL DEFAULT 22.00,
  commission_pct_annual numeric(5,2) NOT NULL DEFAULT 20.00,
  commission_pct_lifetime numeric(5,2) NOT NULL DEFAULT 15.00,
  hold_days int NOT NULL DEFAULT 7,
  payout_methods jsonb NOT NULL DEFAULT '["pix"]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.affiliate_settings TO authenticated;
GRANT ALL ON public.affiliate_settings TO service_role;
ALTER TABLE public.affiliate_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read settings" ON public.affiliate_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin writes settings" ON public.affiliate_settings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
INSERT INTO public.affiliate_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

-- ================= CLICKS =================
CREATE TABLE public.affiliate_clicks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id uuid REFERENCES public.affiliates(id) ON DELETE SET NULL,
  ref_code text NOT NULL,
  campaign_slug text,
  ip_hash text,
  user_agent text,
  device text,
  browser text,
  os text,
  source text,
  landing_path text,
  referer text,
  utm jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_clicks_affiliate ON public.affiliate_clicks(affiliate_id, created_at DESC);
CREATE INDEX idx_clicks_code ON public.affiliate_clicks(ref_code);
GRANT INSERT ON public.affiliate_clicks TO anon, authenticated;
GRANT SELECT ON public.affiliate_clicks TO authenticated;
GRANT ALL ON public.affiliate_clicks TO service_role;
ALTER TABLE public.affiliate_clicks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon insert click" ON public.affiliate_clicks FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "affiliate reads own clicks" ON public.affiliate_clicks FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(),'admin')
    OR affiliate_id IN (SELECT id FROM public.affiliates WHERE user_id = auth.uid())
  );

-- ================= CAMPAIGNS =================
CREATE TABLE public.affiliate_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id uuid NOT NULL REFERENCES public.affiliates(id) ON DELETE CASCADE,
  slug text NOT NULL,
  name text NOT NULL,
  channel text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (affiliate_id, slug)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.affiliate_campaigns TO authenticated;
GRANT ALL ON public.affiliate_campaigns TO service_role;
ALTER TABLE public.affiliate_campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "campaigns own" ON public.affiliate_campaigns FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR affiliate_id IN (SELECT id FROM public.affiliates WHERE user_id=auth.uid()))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR affiliate_id IN (SELECT id FROM public.affiliates WHERE user_id=auth.uid()));

-- ================= REFERRALS =================
CREATE TABLE public.referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  affiliate_id uuid NOT NULL REFERENCES public.affiliates(id) ON DELETE CASCADE,
  click_id uuid REFERENCES public.affiliate_clicks(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'signup' CHECK (status IN ('visited','signup','trial','paid','cancelled')),
  source_campaign text,
  first_paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_referrals_affiliate ON public.referrals(affiliate_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.referrals TO authenticated;
GRANT ALL ON public.referrals TO service_role;
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "referrals view own" ON public.referrals FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(),'admin')
    OR affiliate_id IN (SELECT id FROM public.affiliates WHERE user_id=auth.uid())
    OR user_id = auth.uid()
  );
CREATE POLICY "referrals admin write" ON public.referrals FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_referrals_updated BEFORE UPDATE ON public.referrals
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ================= COMMISSIONS =================
CREATE TABLE public.affiliate_commissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id uuid NOT NULL REFERENCES public.affiliates(id) ON DELETE CASCADE,
  referral_id uuid REFERENCES public.referrals(id) ON DELETE SET NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  subscription_id uuid REFERENCES public.subscriptions(id) ON DELETE SET NULL,
  plan_slug text,
  gross_cents int NOT NULL DEFAULT 0,
  commission_pct numeric(5,2) NOT NULL DEFAULT 0,
  commission_cents int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','available','paid','reversed')),
  available_at timestamptz,
  paid_at timestamptz,
  payout_id uuid,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_commissions_affiliate ON public.affiliate_commissions(affiliate_id, status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.affiliate_commissions TO authenticated;
GRANT ALL ON public.affiliate_commissions TO service_role;
ALTER TABLE public.affiliate_commissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "commissions view own" ON public.affiliate_commissions FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR affiliate_id IN (SELECT id FROM public.affiliates WHERE user_id=auth.uid()));
CREATE POLICY "commissions admin write" ON public.affiliate_commissions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_commissions_updated BEFORE UPDATE ON public.affiliate_commissions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ================= PAYOUTS =================
CREATE TABLE public.affiliate_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id uuid NOT NULL REFERENCES public.affiliates(id) ON DELETE CASCADE,
  amount_cents int NOT NULL,
  method text NOT NULL DEFAULT 'pix',
  payload jsonb,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','approved','paid','rejected')),
  admin_note text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_payouts_affiliate ON public.affiliate_payouts(affiliate_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.affiliate_payouts TO authenticated;
GRANT ALL ON public.affiliate_payouts TO service_role;
ALTER TABLE public.affiliate_payouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payout view own" ON public.affiliate_payouts FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR affiliate_id IN (SELECT id FROM public.affiliates WHERE user_id=auth.uid()));
CREATE POLICY "payout insert own" ON public.affiliate_payouts FOR INSERT TO authenticated
  WITH CHECK (affiliate_id IN (SELECT id FROM public.affiliates WHERE user_id=auth.uid() AND status='active'));
CREATE POLICY "payout admin write" ON public.affiliate_payouts FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_payouts_updated BEFORE UPDATE ON public.affiliate_payouts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ================= GOALS =================
CREATE TABLE public.affiliate_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_count int NOT NULL,
  reward_type text NOT NULL,
  reward_value_cents int NOT NULL DEFAULT 0,
  description text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.affiliate_goals TO authenticated;
GRANT ALL ON public.affiliate_goals TO service_role;
ALTER TABLE public.affiliate_goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "goals read all" ON public.affiliate_goals FOR SELECT TO authenticated USING (active OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "goals admin write" ON public.affiliate_goals FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- ================= NOTIFICATIONS =================
CREATE TABLE public.affiliate_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id uuid NOT NULL REFERENCES public.affiliates(id) ON DELETE CASCADE,
  kind text NOT NULL,
  title text NOT NULL,
  body text,
  payload jsonb,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_affnotif_affiliate ON public.affiliate_notifications(affiliate_id, created_at DESC);
GRANT SELECT, UPDATE ON public.affiliate_notifications TO authenticated;
GRANT ALL ON public.affiliate_notifications TO service_role;
ALTER TABLE public.affiliate_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notif view own" ON public.affiliate_notifications FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR affiliate_id IN (SELECT id FROM public.affiliates WHERE user_id=auth.uid()));
CREATE POLICY "notif mark read" ON public.affiliate_notifications FOR UPDATE TO authenticated
  USING (affiliate_id IN (SELECT id FROM public.affiliates WHERE user_id=auth.uid()))
  WITH CHECK (affiliate_id IN (SELECT id FROM public.affiliates WHERE user_id=auth.uid()));

-- ================= COUPONS =================
CREATE TABLE public.coupons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  affiliate_id uuid REFERENCES public.affiliates(id) ON DELETE SET NULL,
  discount_type text NOT NULL DEFAULT 'percent' CHECK (discount_type IN ('percent','fixed')),
  discount_value numeric(10,2) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  valid_until timestamptz,
  max_uses int,
  uses int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.coupons TO anon, authenticated;
GRANT ALL ON public.coupons TO service_role;
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "coupons read active" ON public.coupons FOR SELECT TO anon, authenticated USING (active);
CREATE POLICY "coupons admin write" ON public.coupons FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- ================= handle_new_user extension =================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  ref_code text;
  aff_id uuid;
BEGIN
  INSERT INTO public.profiles (id, name, phone, email)
  VALUES (
    new.id,
    coalesce(new.raw_user_meta_data->>'name',''),
    coalesce(new.raw_user_meta_data->>'phone', regexp_replace(coalesce(new.phone,''),'\D','','g')),
    new.email
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_roles(user_id, role)
  VALUES (new.id, 'user')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.subscriptions (user_id, plan_slug, plan_name, period, status, price_cents, started_at, ends_at)
  VALUES (new.id, 'trial-7', 'Trial 7 dias', 'trial', 'trial', 0, now(), now() + interval '7 days')
  ON CONFLICT DO NOTHING;

  -- Vincular ao afiliado se veio via ?ref=CODIGO
  ref_code := NULLIF(btrim(new.raw_user_meta_data->>'ref'), '');
  IF ref_code IS NOT NULL THEN
    SELECT id INTO aff_id FROM public.affiliates
      WHERE lower(code) = lower(ref_code) AND status = 'active' LIMIT 1;
    IF aff_id IS NOT NULL AND aff_id <> (SELECT id FROM public.affiliates WHERE user_id = new.id LIMIT 1) IS NOT FALSE THEN
      -- Bloqueia auto-indicação
      IF NOT EXISTS (SELECT 1 FROM public.affiliates WHERE id = aff_id AND user_id = new.id) THEN
        INSERT INTO public.referrals (user_id, affiliate_id, status, source_campaign)
        VALUES (new.id, aff_id, 'signup', NULLIF(btrim(new.raw_user_meta_data->>'ref_campaign'),''))
        ON CONFLICT (user_id) DO NOTHING;
      END IF;
    END IF;
  END IF;

  RETURN new;
END
$function$;
