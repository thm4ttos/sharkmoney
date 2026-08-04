
-- ============================================================
-- FASE 1: FUNDAÇÃO DA IA INTELIGENTE DO ABIO
-- ============================================================

-- ----- user_ai_profile -----
CREATE TABLE IF NOT EXISTS public.user_ai_profile (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  category_stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  avg_daily_expense numeric(12,2),
  avg_weekly_expense numeric(12,2),
  avg_monthly_expense numeric(12,2),
  salary_typical_day int,
  fuel_typical_dow int,
  typical_entry_hour int,
  preferred_channel text,
  channel_counts jsonb NOT NULL DEFAULT '{"text":0,"audio":0,"image":0}'::jsonb,
  frequent_places jsonb NOT NULL DEFAULT '[]'::jsonb,
  recurring_patterns jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_computed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_ai_profile TO authenticated;
GRANT ALL ON public.user_ai_profile TO service_role;

ALTER TABLE public.user_ai_profile ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_ai_profile_owner_select" ON public.user_ai_profile
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "user_ai_profile_owner_upsert" ON public.user_ai_profile
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "user_ai_profile_owner_update" ON public.user_ai_profile
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "user_ai_profile_owner_delete" ON public.user_ai_profile
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER trg_user_ai_profile_touch
  BEFORE UPDATE ON public.user_ai_profile
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ----- user_ai_learning -----
CREATE TABLE IF NOT EXISTS public.user_ai_learning (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  original_text text,
  corrected_field text NOT NULL,
  original_value text,
  corrected_value text,
  transaction_id uuid,
  source text NOT NULL DEFAULT 'whatsapp',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_ai_learning_user_created
  ON public.user_ai_learning(user_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_ai_learning TO authenticated;
GRANT ALL ON public.user_ai_learning TO service_role;

ALTER TABLE public.user_ai_learning ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_ai_learning_owner_all" ON public.user_ai_learning
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ----- transaction_history -----
CREATE TABLE IF NOT EXISTS public.transaction_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  transaction_id uuid NOT NULL,
  operation text NOT NULL,
  snapshot jsonb NOT NULL,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now(),
  source text
);

CREATE INDEX IF NOT EXISTS idx_transaction_history_tx
  ON public.transaction_history(transaction_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_transaction_history_user
  ON public.transaction_history(user_id, changed_at DESC);

GRANT SELECT ON public.transaction_history TO authenticated;
GRANT ALL ON public.transaction_history TO service_role;

ALTER TABLE public.transaction_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "transaction_history_owner_select" ON public.transaction_history
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- Trigger: snapshot antes de UPDATE ou DELETE
CREATE OR REPLACE FUNCTION public.transactions_history_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF row_to_json(OLD)::jsonb IS DISTINCT FROM row_to_json(NEW)::jsonb THEN
      INSERT INTO public.transaction_history(user_id, transaction_id, operation, snapshot, source)
      VALUES (OLD.user_id, OLD.id, 'update', row_to_json(OLD)::jsonb, OLD.source);
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.transaction_history(user_id, transaction_id, operation, snapshot, source)
    VALUES (OLD.user_id, OLD.id, 'delete', row_to_json(OLD)::jsonb, OLD.source);
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_transactions_history_snapshot ON public.transactions;
CREATE TRIGGER trg_transactions_history_snapshot
  BEFORE UPDATE OR DELETE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.transactions_history_snapshot();

-- ----- wa_conversation_context -----
CREATE TABLE IF NOT EXISTS public.wa_conversation_context (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  last_transaction_id uuid,
  last_intent text,
  last_amount numeric(12,2),
  last_category text,
  last_message_at timestamptz,
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.wa_conversation_context TO authenticated;
GRANT ALL ON public.wa_conversation_context TO service_role;

ALTER TABLE public.wa_conversation_context ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wa_conversation_context_owner_all" ON public.wa_conversation_context
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER trg_wa_conversation_context_touch
  BEFORE UPDATE ON public.wa_conversation_context
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ----- ai_proactive_log -----
CREATE TABLE IF NOT EXISTS public.ai_proactive_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  insight_type text NOT NULL,
  message text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  sent_at timestamptz NOT NULL DEFAULT now(),
  responded boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_ai_proactive_log_user_sent
  ON public.ai_proactive_log(user_id, sent_at DESC);

GRANT SELECT ON public.ai_proactive_log TO authenticated;
GRANT ALL ON public.ai_proactive_log TO service_role;

ALTER TABLE public.ai_proactive_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_proactive_log_owner_select" ON public.ai_proactive_log
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
