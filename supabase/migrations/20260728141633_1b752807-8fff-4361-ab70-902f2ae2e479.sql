UPDATE public.plans SET name='Plano Mensal', price_cents=2490, duration_days=30, active=true, sort_order=1 WHERE slug='monthly';
UPDATE public.plans SET name='Plano Semestral', price_cents=11952, duration_days=180, active=true, sort_order=2 WHERE slug='six_months';
UPDATE public.plans SET name='Plano Anual', price_cents=17928, duration_days=365, active=true, sort_order=3 WHERE slug='annual';