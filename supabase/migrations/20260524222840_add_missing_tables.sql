-- ===== TABELAS AUSENTES DO HISTÓRICO DE MIGRATIONS =====
-- Reconstruídas a partir de src/integrations/supabase/types.ts (schema real
-- de produção) + uso no código, seguindo o mesmo padrão das demais migrations
-- (RLS "own all", índice por user_id, trigger touch_updated_at).

-- assets (patrimônio / bens)
CREATE TABLE public.assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  label text NOT NULL,
  kind text NOT NULL DEFAULT 'outros',
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  as_of date NOT NULL DEFAULT CURRENT_DATE,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assets_user_idx ON public.assets(user_id, as_of DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.assets TO authenticated;
GRANT ALL ON public.assets TO service_role;
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "assets own all" ON public.assets
  FOR ALL TO authenticated
  USING (auth.uid() = user_id OR has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (auth.uid() = user_id OR has_role(auth.uid(), 'admin'::app_role));
CREATE TRIGGER assets_touch BEFORE UPDATE ON public.assets
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- budgets (orçamento por categoria/período)
CREATE TABLE public.budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  category text,
  period text NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  notified_80 boolean NOT NULL DEFAULT false,
  notified_90 boolean NOT NULL DEFAULT false,
  notified_100 boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX budgets_user_idx ON public.budgets(user_id, period);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.budgets TO authenticated;
GRANT ALL ON public.budgets TO service_role;
ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "budgets own all" ON public.budgets
  FOR ALL TO authenticated
  USING (auth.uid() = user_id OR has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (auth.uid() = user_id OR has_role(auth.uid(), 'admin'::app_role));
CREATE TRIGGER budgets_touch BEFORE UPDATE ON public.budgets
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- debts (dívidas)
CREATE TABLE public.debts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  creditor text,
  principal numeric(12,2) NOT NULL CHECK (principal >= 0),
  interest_rate numeric(6,3) NOT NULL DEFAULT 0,
  due_at timestamptz,
  paid boolean NOT NULL DEFAULT false,
  notify_whatsapp boolean NOT NULL DEFAULT true,
  last_notified_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX debts_user_idx ON public.debts(user_id, due_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.debts TO authenticated;
GRANT ALL ON public.debts TO service_role;
ALTER TABLE public.debts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "debts own all" ON public.debts
  FOR ALL TO authenticated
  USING (auth.uid() = user_id OR has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (auth.uid() = user_id OR has_role(auth.uid(), 'admin'::app_role));
CREATE TRIGGER debts_touch BEFORE UPDATE ON public.debts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- installment_purchases (compras parceladas)
CREATE TABLE public.installment_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  category text NOT NULL DEFAULT 'Outros',
  total_amount numeric(12,2) NOT NULL CHECK (total_amount >= 0),
  installments_total integer NOT NULL CHECK (installments_total > 0),
  installments_paid integer NOT NULL DEFAULT 0 CHECK (installments_paid >= 0),
  purchased_at timestamptz NOT NULL DEFAULT now(),
  first_due_at timestamptz NOT NULL,
  active boolean NOT NULL DEFAULT true,
  notify_whatsapp boolean NOT NULL DEFAULT true,
  reminder_offsets integer[] NOT NULL DEFAULT '{}',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX installment_purchases_user_idx ON public.installment_purchases(user_id, first_due_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.installment_purchases TO authenticated;
GRANT ALL ON public.installment_purchases TO service_role;
ALTER TABLE public.installment_purchases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "installments own all" ON public.installment_purchases
  FOR ALL TO authenticated
  USING (auth.uid() = user_id OR has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (auth.uid() = user_id OR has_role(auth.uid(), 'admin'::app_role));
CREATE TRIGGER installment_purchases_touch BEFORE UPDATE ON public.installment_purchases
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- reset_audit_logs (log de reset de dados do usuário)
CREATE TABLE public.reset_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  ok boolean NOT NULL DEFAULT true,
  total_removed integer NOT NULL DEFAULT 0,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  reset_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reset_audit_logs_user_idx ON public.reset_audit_logs(user_id, created_at DESC);
GRANT SELECT, INSERT ON public.reset_audit_logs TO authenticated;
GRANT ALL ON public.reset_audit_logs TO service_role;
ALTER TABLE public.reset_audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reset logs own read" ON public.reset_audit_logs
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "reset logs own insert" ON public.reset_audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id OR has_role(auth.uid(), 'admin'::app_role));

-- salary_entries (lançamentos de salário/renda)
CREATE TABLE public.salary_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'salary' CHECK (kind IN ('salary','extra','commission','bonus')),
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  received_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX salary_entries_user_idx ON public.salary_entries(user_id, received_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.salary_entries TO authenticated;
GRANT ALL ON public.salary_entries TO service_role;
ALTER TABLE public.salary_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "salary own all" ON public.salary_entries
  FOR ALL TO authenticated
  USING (auth.uid() = user_id OR has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (auth.uid() = user_id OR has_role(auth.uid(), 'admin'::app_role));
CREATE TRIGGER salary_entries_touch BEFORE UPDATE ON public.salary_entries
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- support_tickets (chamados de suporte)
CREATE TABLE public.support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type text NOT NULL DEFAULT 'chamado' CHECK (type IN ('chamado','suggestion','bug')),
  subject text NOT NULL,
  message text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  admin_reply text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX support_tickets_user_idx ON public.support_tickets(user_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.support_tickets TO authenticated;
GRANT ALL ON public.support_tickets TO service_role;
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "support own all" ON public.support_tickets
  FOR ALL TO authenticated
  USING (auth.uid() = user_id OR has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (auth.uid() = user_id OR has_role(auth.uid(), 'admin'::app_role));
CREATE TRIGGER support_tickets_touch BEFORE UPDATE ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
