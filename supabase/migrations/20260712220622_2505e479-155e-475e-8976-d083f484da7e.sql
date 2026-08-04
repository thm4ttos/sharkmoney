
-- HABITS
CREATE TABLE public.habits (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT 'Sparkles',
  color TEXT NOT NULL DEFAULT '#8b5cf6',
  category TEXT,
  target_daily INTEGER NOT NULL DEFAULT 1,
  target_weekly INTEGER,
  target_monthly INTEGER,
  weekdays INTEGER[] NOT NULL DEFAULT ARRAY[0,1,2,3,4,5,6],
  time TEXT,
  reminder_enabled BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.habits TO authenticated;
GRANT ALL ON public.habits TO service_role;
ALTER TABLE public.habits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "habits_owner_all" ON public.habits FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_habits_user ON public.habits(user_id) WHERE archived = false;
CREATE TRIGGER trg_habits_updated BEFORE UPDATE ON public.habits
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- HABIT LOGS
CREATE TABLE public.habit_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  habit_id UUID NOT NULL REFERENCES public.habits(id) ON DELETE CASCADE,
  log_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'done' CHECK (status IN ('done','skipped','pending')),
  note TEXT,
  source TEXT NOT NULL DEFAULT 'app' CHECK (source IN ('app','whatsapp','system')),
  logged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (habit_id, log_date)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.habit_logs TO authenticated;
GRANT ALL ON public.habit_logs TO service_role;
ALTER TABLE public.habit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "habit_logs_owner_all" ON public.habit_logs FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_habit_logs_user_date ON public.habit_logs(user_id, log_date DESC);
CREATE INDEX idx_habit_logs_habit_date ON public.habit_logs(habit_id, log_date DESC);

-- HABIT GOALS
CREATE TABLE public.habit_goals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  habit_id UUID NOT NULL REFERENCES public.habits(id) ON DELETE CASCADE,
  period TEXT NOT NULL CHECK (period IN ('week','month','year')),
  target_count INTEGER NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  achieved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.habit_goals TO authenticated;
GRANT ALL ON public.habit_goals TO service_role;
ALTER TABLE public.habit_goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "habit_goals_owner_all" ON public.habit_goals FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_habit_goals_user ON public.habit_goals(user_id, habit_id);

-- HABIT ACHIEVEMENTS
CREATE TABLE public.habit_achievements (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  habit_id UUID REFERENCES public.habits(id) ON DELETE SET NULL,
  unlocked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, code, habit_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.habit_achievements TO authenticated;
GRANT ALL ON public.habit_achievements TO service_role;
ALTER TABLE public.habit_achievements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "habit_achievements_owner_all" ON public.habit_achievements FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
