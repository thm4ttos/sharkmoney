
-- Financial goals
CREATE TABLE public.financial_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  kind text NOT NULL DEFAULT 'custom',
  target_amount numeric(12,2) NOT NULL CHECK (target_amount > 0),
  current_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (current_amount >= 0),
  target_date date,
  notes text,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX financial_goals_user_idx ON public.financial_goals(user_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.financial_goals TO authenticated;
GRANT ALL ON public.financial_goals TO service_role;
ALTER TABLE public.financial_goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "goals own all" ON public.financial_goals
  FOR ALL TO authenticated
  USING (auth.uid() = user_id OR has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (auth.uid() = user_id OR has_role(auth.uid(), 'admin'::app_role));
CREATE TRIGGER financial_goals_touch BEFORE UPDATE ON public.financial_goals
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Recurring bills
CREATE TABLE public.recurring_bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  category text NOT NULL DEFAULT 'Contas Fixas',
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  frequency text NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('weekly','biweekly','monthly','yearly')),
  next_due_at date NOT NULL,
  active boolean NOT NULL DEFAULT true,
  notify_whatsapp boolean NOT NULL DEFAULT true,
  last_notified_at timestamptz,
  last_charged_at timestamptz,
  notes text,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX recurring_bills_user_idx ON public.recurring_bills(user_id, next_due_at);
CREATE INDEX recurring_bills_due_idx ON public.recurring_bills(active, next_due_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recurring_bills TO authenticated;
GRANT ALL ON public.recurring_bills TO service_role;
ALTER TABLE public.recurring_bills ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bills own all" ON public.recurring_bills
  FOR ALL TO authenticated
  USING (auth.uid() = user_id OR has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (auth.uid() = user_id OR has_role(auth.uid(), 'admin'::app_role));
CREATE TRIGGER recurring_bills_touch BEFORE UPDATE ON public.recurring_bills
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
