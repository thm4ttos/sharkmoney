-- Desativa todos os planos comerciais antigos (assinaturas existentes seguem intactas)
UPDATE public.plans SET active = false
WHERE slug NOT IN ('monthly','six_months','annual','trial-7');

-- Atualiza/insere os três planos oficiais
INSERT INTO public.plans (slug, name, period, price_cents, duration_days, active, sort_order)
VALUES
  ('monthly',    'Mensal',   'monthly',    2490,  30, true, 1),
  ('six_months', '6 meses',  'semiannual', 8964, 180, true, 2),
  ('annual',     '12 meses', 'annual',    11952, 365, true, 3)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  period = EXCLUDED.period,
  price_cents = EXCLUDED.price_cents,
  duration_days = EXCLUDED.duration_days,
  active = true,
  sort_order = EXCLUDED.sort_order;

-- O antigo 'semiannual' foi substituído pelo slug 'six_months'
UPDATE public.plans SET active = false WHERE slug = 'semiannual';