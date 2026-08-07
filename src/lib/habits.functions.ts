import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ---------- Types ----------
export type HabitInput = {
  id?: string;
  name: string;
  icon?: string;
  color?: string;
  category?: string | null;
  target_daily?: number;
  target_weekly?: number | null;
  target_monthly?: number | null;
  weekdays?: number[];
  time?: string | null;
  reminder_enabled?: boolean;
  notes?: string | null;
};

export type HabitCheckStatus = "done" | "skipped" | "pending";

// ---------- Helpers ----------
function todayISO() {
  const d = new Date();
  const tz = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return tz.toISOString().slice(0, 10);
}

function addDays(iso: string, delta: number) {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

// ---------- CRUD ----------
export const listHabits = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("habits")
      .select("*")
      .eq("user_id", userId)
      .eq("archived", false)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const upsertHabit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: HabitInput) => d)
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    if (!data.name?.trim()) throw new Error("Nome é obrigatório.");
    const payload = {
      user_id: userId,
      name: data.name.trim(),
      icon: data.icon || "Sparkles",
      color: data.color || "#7C3AED",
      category: data.category ?? null,
      target_daily: data.target_daily ?? 1,
      target_weekly: data.target_weekly ?? null,
      target_monthly: data.target_monthly ?? null,
      weekdays: data.weekdays?.length ? data.weekdays : [0, 1, 2, 3, 4, 5, 6],
      time: data.time ?? null,
      reminder_enabled: !!data.reminder_enabled,
      notes: data.notes ?? null,
    };
    if (data.id) {
      const { error } = await supabase.from("habits").update(payload).eq("id", data.id).eq("user_id", userId);
      if (error) throw new Error(error.message);
      return { ok: true, id: data.id };
    }
    const { data: row, error } = await supabase.from("habits").insert(payload).select("id").single();
    if (error) throw new Error(error.message);
    return { ok: true, id: row.id };
  });

export const archiveHabit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase
      .from("habits")
      .update({ archived: true })
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- Today check ----------
export const listTodayChecks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const today = todayISO();
    const dow = new Date(today + "T12:00:00Z").getUTCDay();

    const [habitsRes, logsRes] = await Promise.all([
      supabase.from("habits").select("*").eq("user_id", userId).eq("archived", false),
      supabase.from("habit_logs").select("*").eq("user_id", userId).eq("log_date", today),
    ]);
    if (habitsRes.error) throw new Error(habitsRes.error.message);
    if (logsRes.error) throw new Error(logsRes.error.message);

    const logsByHabit = new Map<string, any>();
    (logsRes.data ?? []).forEach((l: any) => logsByHabit.set(l.habit_id, l));

    const items = (habitsRes.data ?? [])
      .filter((h: any) => (h.weekdays ?? [0, 1, 2, 3, 4, 5, 6]).includes(dow))
      .map((h: any) => ({
        habit: h,
        log: logsByHabit.get(h.id) ?? null,
        status: (logsByHabit.get(h.id)?.status ?? null) as HabitCheckStatus | null,
      }));

    const total = items.length;
    const done = items.filter((i) => i.status === "done").length;

    return { date: today, items, total, done, percent: total ? Math.round((done / total) * 100) : 0 };
  });

export const toggleHabitCheck = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { habitId: string; date?: string; status: HabitCheckStatus | null; note?: string }) => d)
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const date = data.date ?? todayISO();

    // verify ownership
    const { data: h, error: he } = await supabase.from("habits").select("id").eq("id", data.habitId).eq("user_id", userId).maybeSingle();
    if (he) throw new Error(he.message);
    if (!h) throw new Error("Hábito não encontrado.");

    if (data.status === null) {
      const { error } = await supabase
        .from("habit_logs")
        .delete()
        .eq("user_id", userId)
        .eq("habit_id", data.habitId)
        .eq("log_date", date);
      if (error) throw new Error(error.message);
      return { ok: true, cleared: true };
    }

    const { error } = await supabase
      .from("habit_logs")
      .upsert(
        {
          user_id: userId,
          habit_id: data.habitId,
          log_date: date,
          status: data.status,
          note: data.note ?? null,
          source: "app",
          logged_at: new Date().toISOString(),
        },
        { onConflict: "habit_id,log_date" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- Calendar heatmap ----------
export const getHabitHeatmap = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { days?: number }) => d ?? { days: 120 })
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const days = Math.min(Math.max(data?.days ?? 120, 30), 400);
    const to = todayISO();
    const from = addDays(to, -(days - 1));

    const [habitsRes, logsRes] = await Promise.all([
      supabase.from("habits").select("id, weekdays").eq("user_id", userId).eq("archived", false),
      supabase
        .from("habit_logs")
        .select("log_date, status, habit_id")
        .eq("user_id", userId)
        .gte("log_date", from)
        .lte("log_date", to),
    ]);
    if (habitsRes.error) throw new Error(habitsRes.error.message);
    if (logsRes.error) throw new Error(logsRes.error.message);

    const habits = habitsRes.data ?? [];
    const logs = logsRes.data ?? [];

    const doneByDate = new Map<string, number>();
    for (const l of logs) {
      if ((l as any).status === "done") {
        doneByDate.set(l.log_date as string, (doneByDate.get(l.log_date as string) ?? 0) + 1);
      }
    }

    const out: { date: string; done: number; total: number; percent: number }[] = [];
    for (let i = 0; i < days; i++) {
      const iso = addDays(from, i);
      const dow = new Date(iso + "T12:00:00Z").getUTCDay();
      const total = habits.filter((h: any) => (h.weekdays ?? [0, 1, 2, 3, 4, 5, 6]).includes(dow)).length;
      const done = doneByDate.get(iso) ?? 0;
      out.push({ date: iso, done, total, percent: total ? Math.round((done / total) * 100) : 0 });
    }
    return { from, to, days: out };
  });

// ---------- Stats & streaks ----------
export const getHabitStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const to = todayISO();
    const from = addDays(to, -364);

    const [habitsRes, logsRes] = await Promise.all([
      supabase.from("habits").select("*").eq("user_id", userId).eq("archived", false),
      supabase
        .from("habit_logs")
        .select("habit_id, log_date, status")
        .eq("user_id", userId)
        .gte("log_date", from)
        .order("log_date", { ascending: false }),
    ]);
    if (habitsRes.error) throw new Error(habitsRes.error.message);
    if (logsRes.error) throw new Error(logsRes.error.message);

    const habits = habitsRes.data ?? [];
    const logs = logsRes.data ?? [];

    // Per-habit streaks
    const perHabit = habits.map((h: any) => {
      const hLogs = logs
        .filter((l: any) => l.habit_id === h.id && l.status === "done")
        .map((l: any) => l.log_date as string)
        .sort((a: string, b: string) => (a < b ? 1 : -1));
      const doneSet = new Set(hLogs);

      // current streak — walk back from today over active weekdays only
      let current = 0;
      let cursor = to;
      for (let guard = 0; guard < 400; guard++) {
        const dow = new Date(cursor + "T12:00:00Z").getUTCDay();
        const isActive = (h.weekdays ?? [0, 1, 2, 3, 4, 5, 6]).includes(dow);
        if (!isActive) {
          cursor = addDays(cursor, -1);
          continue;
        }
        if (doneSet.has(cursor)) {
          current += 1;
          cursor = addDays(cursor, -1);
        } else {
          // allow "today not yet done" to not break streak
          if (cursor === to) {
            cursor = addDays(cursor, -1);
            continue;
          }
          break;
        }
      }

      // best streak (consecutive done dates, ignoring inactive days)
      let best = 0;
      let run = 0;
      let prev: string | null = null;
      const asc = [...hLogs].sort();
      for (const d of asc) {
        if (prev === null) {
          run = 1;
        } else {
          // walk from prev+1 forward; count only active days between
          let cur = addDays(prev, 1);
          let gap = false;
          while (cur < d) {
            const dow = new Date(cur + "T12:00:00Z").getUTCDay();
            if ((h.weekdays ?? [0, 1, 2, 3, 4, 5, 6]).includes(dow)) {
              gap = true;
              break;
            }
            cur = addDays(cur, 1);
          }
          run = gap ? 1 : run + 1;
        }
        if (run > best) best = run;
        prev = d;
      }

      // success rate over last 30 days on active days
      let activeDays = 0;
      let doneDays = 0;
      for (let i = 0; i < 30; i++) {
        const iso = addDays(to, -i);
        const dow = new Date(iso + "T12:00:00Z").getUTCDay();
        if (!(h.weekdays ?? [0, 1, 2, 3, 4, 5, 6]).includes(dow)) continue;
        activeDays += 1;
        if (doneSet.has(iso)) doneDays += 1;
      }
      const successRate = activeDays ? Math.round((doneDays / activeDays) * 100) : 0;

      return {
        habit: h,
        current_streak: current,
        best_streak: best,
        success_rate: successRate,
        total_done: hLogs.length,
      };
    });

    // Global level from best current streak
    const bestCurrent = perHabit.reduce((m, r) => Math.max(m, r.current_streak), 0);
    const level = levelFor(bestCurrent);

    return {
      per_habit: perHabit,
      total_habits: habits.length,
      total_done_all_time: logs.filter((l: any) => l.status === "done").length,
      best_current_streak: bestCurrent,
      level,
    };
  });

function levelFor(days: number) {
  if (days >= 1000) return { code: "unstoppable", label: "Imparável", icon: "🏆", min: 1000 };
  if (days >= 365) return { code: "legend", label: "Lenda", icon: "💎", min: 365 };
  if (days >= 100) return { code: "master", label: "Mestre", icon: "🥇", min: 100 };
  if (days >= 30) return { code: "disciplined", label: "Disciplinado", icon: "🥈", min: 30 };
  if (days >= 7) return { code: "consistent", label: "Consistente", icon: "🥉", min: 7 };
  return { code: "starter", label: "Começando", icon: "✨", min: 0 };
}

// ---------- Charts ----------
export const getHabitCharts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { range?: "7d" | "30d" | "12m" }) => d ?? { range: "30d" })
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const range = data?.range ?? "30d";
    const days = range === "7d" ? 7 : range === "30d" ? 30 : 365;
    const to = todayISO();
    const from = addDays(to, -(days - 1));

    const [habitsRes, logsRes] = await Promise.all([
      supabase.from("habits").select("id, name, weekdays").eq("user_id", userId).eq("archived", false),
      supabase
        .from("habit_logs")
        .select("habit_id, log_date, status")
        .eq("user_id", userId)
        .gte("log_date", from)
        .lte("log_date", to),
    ]);
    if (habitsRes.error) throw new Error(habitsRes.error.message);
    if (logsRes.error) throw new Error(logsRes.error.message);

    const habits = habitsRes.data ?? [];
    const logs = logsRes.data ?? [];

    // Daily percent series
    const doneByDate = new Map<string, number>();
    for (const l of logs) {
      if ((l as any).status === "done") {
        doneByDate.set(l.log_date as string, (doneByDate.get(l.log_date as string) ?? 0) + 1);
      }
    }
    const series: { date: string; percent: number }[] = [];
    for (let i = 0; i < days; i++) {
      const iso = addDays(from, i);
      const dow = new Date(iso + "T12:00:00Z").getUTCDay();
      const total = habits.filter((h: any) => (h.weekdays ?? [0, 1, 2, 3, 4, 5, 6]).includes(dow)).length;
      const done = doneByDate.get(iso) ?? 0;
      series.push({ date: iso, percent: total ? Math.round((done / total) * 100) : 0 });
    }

    // Top habits
    const countByHabit = new Map<string, number>();
    for (const l of logs) {
      if ((l as any).status === "done") {
        countByHabit.set(l.habit_id, (countByHabit.get(l.habit_id) ?? 0) + 1);
      }
    }
    const ranking = habits
      .map((h: any) => ({ id: h.id, name: h.name, count: countByHabit.get(h.id) ?? 0 }))
      .sort((a, b) => b.count - a.count);

    return { range, series, top: ranking.slice(0, 5), bottom: ranking.slice(-5).reverse() };
  });
