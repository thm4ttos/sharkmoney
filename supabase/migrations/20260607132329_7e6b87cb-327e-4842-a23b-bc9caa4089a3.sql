
-- =========================================================
-- PLANS catalog
-- =========================================================
CREATE TABLE public.plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  period text NOT NULL CHECK (period IN ('trial','monthly','quarterly','semiannual','annual','lifetime')),
  price_cents integer NOT NULL DEFAULT 0,
  duration_days integer,  -- null = lifetime
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.plans TO authenticated;
GRANT ALL ON public.plans TO service_role;

ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "plans readable by authenticated"
  ON public.plans FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "plans admin manage"
  ON public.plans FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TRIGGER plans_touch BEFORE UPDATE ON public.plans
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

INSERT INTO public.plans (slug, name, period, price_cents, duration_days, sort_order) VALUES
  ('trial-7',     'Trial 7 dias', 'trial',      0,       7,    0),
  ('monthly',     'Mensal',       'monthly',    2990,    30,   1),
  ('quarterly',   'Trimestral',   'quarterly',  7990,    90,   2),
  ('semiannual',  'Semestral',    'semiannual', 14990,   180,  3),
  ('annual',      'Anual',        'annual',     24990,   365,  4),
  ('lifetime',    'Vitalício',    'lifetime',   99990,   NULL, 5);

-- =========================================================
-- SUBSCRIPTIONS per user
-- =========================================================
CREATE TABLE public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  plan_slug text NOT NULL REFERENCES public.plans(slug),
  plan_name text NOT NULL,
  period text NOT NULL CHECK (period IN ('trial','monthly','quarterly','semiannual','annual','lifetime')),
  status text NOT NULL DEFAULT 'trial' CHECK (status IN ('trial','active','expired','cancelled')),
  price_cents integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,  -- null = lifetime
  cancelled_at timestamptz,
  admin_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX subscriptions_user_idx ON public.subscriptions(user_id);
CREATE INDEX subscriptions_status_idx ON public.subscriptions(status);
CREATE INDEX subscriptions_ends_at_idx ON public.subscriptions(ends_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.subscriptions TO authenticated;
GRANT ALL ON public.subscriptions TO service_role;

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "subscriptions own select"
  ON public.subscriptions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));

CREATE POLICY "subscriptions admin manage"
  ON public.subscriptions FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TRIGGER subscriptions_touch BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- =========================================================
-- Backfill: create Trial for every existing user without subscription
-- =========================================================
INSERT INTO public.subscriptions (user_id, plan_slug, plan_name, period, status, price_cents, started_at, ends_at)
SELECT p.id, 'trial-7', 'Trial 7 dias', 'trial', 'trial', 0, p.created_at, p.trial_ends_at
FROM public.profiles p
LEFT JOIN public.subscriptions s ON s.user_id = p.id
WHERE s.id IS NULL;

-- =========================================================
-- Auto-create trial on signup (extend handle_new_user)
-- =========================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  RETURN new;
END
$$;
