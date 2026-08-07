import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles, Plus, Check, X, RotateCcw, Flame, Trophy, Target,
  Calendar as CalendarIcon, BarChart3, Trash2, Loader2, Bell,
} from "lucide-react";
import {
  listHabits, upsertHabit, archiveHabit, listTodayChecks,
  toggleHabitCheck, getHabitHeatmap, getHabitStats, getHabitCharts,
  type HabitCheckStatus,
} from "@/lib/habits.functions";
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip, BarChart, Bar } from "recharts";

export const Route = createFileRoute("/app/habitos")({
  head: () => ({ meta: [{ title: "Rotina & Hábitos · Abio" }] }),
  component: Page,
});

const WEEKDAYS = [
  { i: 0, s: "D" }, { i: 1, s: "S" }, { i: 2, s: "T" },
  { i: 3, s: "Q" }, { i: 4, s: "Q" }, { i: 5, s: "S" }, { i: 6, s: "S" },
];

const COLORS = ["#0A5BFF", "#22c55e", "#f59e0b", "#ef4444", "#06b6d4", "#ec4899", "#eab308", "#3b82f6"];

const PRESET_HABITS = [
  "Academia", "Caminhada", "Corrida", "Dormir cedo", "Ler 30 minutos",
  "Estudar inglês", "Beber 2L de água", "Meditação", "Alimentação saudável", "Remédio",
];

const ACHIEVEMENTS = [
  { code: "first_habit", label: "Primeiro hábito", icon: "🌱", check: (s: any) => s.total_habits >= 1 },
  { code: "seven_days", label: "7 dias seguidos", icon: "🥉", check: (s: any) => s.best_current_streak >= 7 },
  { code: "thirty_days", label: "30 dias", icon: "🥈", check: (s: any) => s.best_current_streak >= 30 },
  { code: "hundred_days", label: "100 dias", icon: "🥇", check: (s: any) => s.best_current_streak >= 100 },
  { code: "year", label: "1 ano", icon: "💎", check: (s: any) => s.best_current_streak >= 365 },
];

function Page() {
  const qc = useQueryClient();
  const fnHabits = useServerFn(listHabits);
  const fnToday = useServerFn(listTodayChecks);
  const fnUpsert = useServerFn(upsertHabit);
  const fnArchive = useServerFn(archiveHabit);
  const fnToggle = useServerFn(toggleHabitCheck);
  const fnHeatmap = useServerFn(getHabitHeatmap);
  const fnStats = useServerFn(getHabitStats);
  const fnCharts = useServerFn(getHabitCharts);

  const [range, setRange] = useState<"7d" | "30d" | "12m">("30d");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [dayPopover, setDayPopover] = useState<string | null>(null);

  const habits = useQuery({ queryKey: ["habits", "list"], queryFn: () => fnHabits() as any });
  const today = useQuery({ queryKey: ["habits", "today"], queryFn: () => fnToday() as any });
  const stats = useQuery({ queryKey: ["habits", "stats"], queryFn: () => fnStats() as any });
  const heatmap = useQuery({ queryKey: ["habits", "heatmap"], queryFn: () => fnHeatmap({ data: { days: 120 } } as any) as any });
  const charts = useQuery({ queryKey: ["habits", "charts", range], queryFn: () => fnCharts({ data: { range } } as any) as any });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["habits"] });
  };

  const toggleMut = useMutation({
    mutationFn: (v: { habitId: string; status: HabitCheckStatus | null }) =>
      fnToggle({ data: v } as any),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ["habits", "today"] });
      const prev = qc.getQueryData<any>(["habits", "today"]);
      if (prev) {
        const items = prev.items.map((it: any) =>
          it.habit.id === v.habitId ? { ...it, status: v.status, log: v.status ? { status: v.status } : null } : it,
        );
        const done = items.filter((i: any) => i.status === "done").length;
        qc.setQueryData(["habits", "today"], {
          ...prev, items, done, percent: prev.total ? Math.round((done / prev.total) * 100) : 0,
        });
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(["habits", "today"], ctx.prev); },
    onSettled: invalidateAll,
  });

  const saveMut = useMutation({
    mutationFn: (v: any) => fnUpsert({ data: v } as any),
    onSuccess: () => { setModalOpen(false); setEditing(null); invalidateAll(); },
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => fnArchive({ data: { id } } as any),
    onSuccess: invalidateAll,
  });

  const heatDay = useMemo(() => {
    if (!heatmap.data || !dayPopover) return null;
    return heatmap.data.days.find((d: any) => d.date === dayPopover) ?? null;
  }, [heatmap.data, dayPopover]);

  const unlockedAchievements = useMemo(() => {
    if (!stats.data) return [];
    return ACHIEVEMENTS.filter((a) => a.check(stats.data));
  }, [stats.data]);

  return (
    <div className="space-y-6 max-w-6xl mx-auto animate-fade-in">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 grid place-items-center rounded-2xl border border-primary/30 bg-gradient-brand-soft glow-neon">
            <Sparkles className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="font-display text-3xl">Rotina & Hábitos</h1>
            <p className="text-sm text-muted-foreground">Sua disciplina diária, semanal, mensal e anual.</p>
          </div>
        </div>
        <button
          onClick={() => { setEditing(null); setModalOpen(true); }}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-brand px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-lg glow-neon hover:opacity-90 transition-smooth"
        >
          <Plus className="h-4 w-4" /> Novo hábito
        </button>
      </header>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Hábitos ativos" value={stats.data?.total_habits ?? "—"} Icon={Target} tint="primary" />
        <KpiCard label="% do dia" value={`${today.data?.percent ?? 0}%`} Icon={Check} tint="emerald" />
        <KpiCard label="Melhor sequência atual" value={`${stats.data?.best_current_streak ?? 0}d`} Icon={Flame} tint="orange" />
        <KpiCard
          label="Seu nível"
          value={stats.data ? `${stats.data.level.icon} ${stats.data.level.label}` : "—"}
          Icon={Trophy}
          tint="amber"
        />
      </div>

      {/* Today check */}
      <section className="rounded-3xl border border-border bg-card/60 backdrop-blur-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-lg flex items-center gap-2">
            <Check className="h-5 w-5 text-primary" /> Check de hoje
          </h2>
          <p className="text-xs text-muted-foreground">
            {today.data ? `${today.data.done}/${today.data.total} concluídos` : ""}
          </p>
        </div>

        {today.isLoading ? (
          <div className="py-10 text-center text-sm text-muted-foreground inline-flex items-center gap-2 w-full justify-center">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
          </div>
        ) : (today.data?.items?.length ?? 0) === 0 ? (
          <EmptyState onCreate={() => { setEditing(null); setModalOpen(true); }} />
        ) : (
          <div className="space-y-2">
            {today.data.items.map((it: any) => (
              <HabitRow
                key={it.habit.id}
                habit={it.habit}
                status={it.status}
                onToggle={(status) => toggleMut.mutate({ habitId: it.habit.id, status })}
                onEdit={() => { setEditing(it.habit); setModalOpen(true); }}
                onDelete={() => { if (confirm("Arquivar este hábito?")) deleteMut.mutate(it.habit.id); }}
              />
            ))}
          </div>
        )}
      </section>

      {/* Heatmap calendar */}
      <section className="rounded-3xl border border-border bg-card/60 backdrop-blur-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-lg flex items-center gap-2">
            <CalendarIcon className="h-5 w-5 text-primary" /> Calendário
          </h2>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded-sm bg-emerald-500" /> Tudo</span>
            <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded-sm bg-yellow-500" /> Parcial</span>
            <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded-sm bg-red-500/60" /> Nenhum</span>
          </div>
        </div>
        {heatmap.isLoading ? (
          <div className="py-6 text-sm text-muted-foreground">Carregando…</div>
        ) : (
          <Heatmap days={heatmap.data?.days ?? []} onClick={setDayPopover} activeDate={dayPopover} />
        )}
        <AnimatePresence>
          {heatDay && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              className="mt-4 rounded-2xl border border-primary/30 bg-primary/10 p-4"
            >
              <div className="flex items-center justify-between">
                <p className="font-medium">
                  {new Date(heatDay.date + "T12:00:00Z").toLocaleDateString("pt-BR", {
                    weekday: "long", day: "2-digit", month: "long", year: "numeric",
                  })}
                </p>
                <button onClick={() => setDayPopover(null)} className="text-muted-foreground hover:text-foreground">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                {heatDay.done} de {heatDay.total} hábitos concluídos ({heatDay.percent}%)
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      {/* Streaks */}
      <section className="rounded-3xl border border-border bg-card/60 backdrop-blur-xl p-5">
        <h2 className="font-display text-lg flex items-center gap-2 mb-4">
          <Flame className="h-5 w-5 text-orange-400" /> Sequências
        </h2>
        {stats.data && stats.data.per_habit.length > 0 ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {stats.data.per_habit.map((p: any) => (
              <div key={p.habit.id} className="rounded-2xl border border-border bg-background/40 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="h-8 w-8 rounded-lg grid place-items-center text-sm" style={{ background: `${p.habit.color}25`, color: p.habit.color }}>
                    <Sparkles className="h-4 w-4" />
                  </span>
                  <p className="font-medium truncate">{p.habit.name}</p>
                </div>
                <div className="grid grid-cols-3 text-center gap-2">
                  <Metric label="Atual" value={`${p.current_streak}d`} />
                  <Metric label="Melhor" value={`${p.best_streak}d`} />
                  <Metric label="Taxa" value={`${p.success_rate}%`} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Crie hábitos para começar a construir sequências.</p>
        )}
      </section>

      {/* Charts */}
      <section className="rounded-3xl border border-border bg-card/60 backdrop-blur-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-lg flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" /> Gráficos
          </h2>
          <div className="flex gap-1">
            {(["7d", "30d", "12m"] as const).map((r) => (
              <button key={r} onClick={() => setRange(r)}
                className={`px-3 py-1.5 rounded-lg text-xs transition-smooth ${
                  range === r ? "bg-gradient-brand-soft border border-primary/30 text-foreground"
                    : "border border-border text-muted-foreground hover:text-foreground"
                }`}>{r}</button>
            ))}
          </div>
        </div>
        <div className="grid lg:grid-cols-2 gap-4">
          <div className="rounded-2xl border border-border bg-background/40 p-4">
            <p className="text-xs text-muted-foreground mb-2">% concluído por dia</p>
            <div className="h-48">
              <ResponsiveContainer>
                <LineChart data={charts.data?.series ?? []}>
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v) => v.slice(5)} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12 }} />
                  <Line type="monotone" dataKey="percent" stroke="#0A5BFF" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="rounded-2xl border border-border bg-background/40 p-4">
            <p className="text-xs text-muted-foreground mb-2">Hábitos mais realizados</p>
            <div className="h-48">
              <ResponsiveContainer>
                <BarChart data={charts.data?.top ?? []}>
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12 }} />
                  <Bar dataKey="count" fill="#22c55e" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </section>

      {/* Achievements */}
      <section className="rounded-3xl border border-border bg-card/60 backdrop-blur-xl p-5">
        <h2 className="font-display text-lg flex items-center gap-2 mb-4">
          <Trophy className="h-5 w-5 text-amber-400" /> Conquistas
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {ACHIEVEMENTS.map((a) => {
            const unlocked = unlockedAchievements.some((u) => u.code === a.code);
            return (
              <div key={a.code} className={`rounded-2xl border p-3 text-center transition-smooth ${
                unlocked ? "border-primary/40 bg-primary/10" : "border-border bg-background/40 opacity-50"
              }`}>
                <div className="text-3xl">{a.icon}</div>
                <p className="text-xs mt-1 font-medium">{a.label}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{unlocked ? "Desbloqueado" : "Bloqueado"}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Modal */}
      <AnimatePresence>
        {modalOpen && (
          <HabitModal
            initial={editing}
            saving={saveMut.isPending}
            onClose={() => { setModalOpen(false); setEditing(null); }}
            onSave={(v) => saveMut.mutate(v)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------- Sub-components ----------

function KpiCard({ label, value, Icon, tint }: { label: string; value: any; Icon: any; tint: string }) {
  const tintMap: Record<string, string> = {
    primary: "text-primary bg-primary/10 border-primary/30",
    emerald: "text-emerald-300 bg-emerald-500/10 border-emerald-500/30",
    orange: "text-orange-300 bg-orange-500/10 border-orange-500/30",
    amber: "text-amber-300 bg-amber-500/10 border-amber-500/30",
  };
  return (
    <div className="rounded-2xl border border-border bg-card/60 backdrop-blur-xl p-4">
      <div className={`h-9 w-9 grid place-items-center rounded-xl border ${tintMap[tint]}`}>
        <Icon className="h-4 w-4" />
      </div>
      <p className="text-xs text-muted-foreground mt-3">{label}</p>
      <p className="font-display text-xl mt-0.5">{value}</p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-background/40 py-1.5">
      <p className="text-[10px] uppercase text-muted-foreground">{label}</p>
      <p className="font-display text-sm">{value}</p>
    </div>
  );
}

function HabitRow({
  habit, status, onToggle, onEdit, onDelete,
}: { habit: any; status: HabitCheckStatus | null; onToggle: (s: HabitCheckStatus | null) => void; onEdit: () => void; onDelete: () => void }) {
  const done = status === "done";
  return (
    <motion.div
      layout
      className={`flex items-center gap-3 rounded-2xl border p-3 transition-smooth ${
        done ? "border-emerald-500/40 bg-emerald-500/5" : "border-border bg-background/40"
      }`}
    >
      <span
        className="h-10 w-10 rounded-xl grid place-items-center shrink-0"
        style={{ background: `${habit.color}25`, color: habit.color }}
      >
        <Sparkles className="h-5 w-5" />
      </span>
      <div className="flex-1 min-w-0">
        <p className={`font-medium truncate ${done ? "line-through text-muted-foreground" : ""}`}>{habit.name}</p>
        <p className="text-xs text-muted-foreground truncate">
          {habit.category ? habit.category + " · " : ""}{habit.time ?? "sem horário"}
        </p>
      </div>
      <div className="flex items-center gap-1">
        <IconBtn active={status === "done"} tone="emerald" onClick={() => onToggle(status === "done" ? null : "done")} title="Concluído">
          <Check className="h-4 w-4" />
        </IconBtn>
        <IconBtn active={status === "pending"} tone="amber" onClick={() => onToggle(status === "pending" ? null : "pending")} title="Pendente">
          <RotateCcw className="h-4 w-4" />
        </IconBtn>
        <IconBtn active={status === "skipped"} tone="red" onClick={() => onToggle(status === "skipped" ? null : "skipped")} title="Ignorado">
          <X className="h-4 w-4" />
        </IconBtn>
        <button onClick={onEdit} className="ml-1 text-xs text-muted-foreground hover:text-foreground px-2 py-1">Editar</button>
        <button onClick={onDelete} className="text-muted-foreground hover:text-destructive p-1"><Trash2 className="h-4 w-4" /></button>
      </div>
    </motion.div>
  );
}

function IconBtn({ children, active, tone, onClick, title }: any) {
  const toneMap: Record<string, string> = {
    emerald: active ? "bg-emerald-500 text-white border-emerald-500" : "border-border text-muted-foreground hover:border-emerald-500/40 hover:text-emerald-400",
    amber: active ? "bg-amber-500 text-white border-amber-500" : "border-border text-muted-foreground hover:border-amber-500/40 hover:text-amber-400",
    red: active ? "bg-red-500 text-white border-red-500" : "border-border text-muted-foreground hover:border-red-500/40 hover:text-red-400",
  };
  return (
    <button title={title} onClick={onClick} className={`h-8 w-8 rounded-lg border grid place-items-center transition-smooth ${toneMap[tone]}`}>
      {children}
    </button>
  );
}

function Heatmap({ days, onClick, activeDate }: { days: any[]; onClick: (d: string) => void; activeDate: string | null }) {
  // organize into weeks (columns of 7 days)
  const weeks: any[][] = [];
  if (days.length === 0) return null;
  // pad start so first column starts on Sunday
  const firstDow = new Date(days[0].date + "T12:00:00Z").getUTCDay();
  const padded = [...Array(firstDow).fill(null), ...days];
  for (let i = 0; i < padded.length; i += 7) weeks.push(padded.slice(i, i + 7));

  const colorFor = (d: any) => {
    if (!d) return "bg-transparent";
    if (d.total === 0) return "bg-background/40";
    if (d.percent === 100) return "bg-emerald-500";
    if (d.percent >= 50) return "bg-emerald-500/60";
    if (d.percent > 0) return "bg-yellow-500/70";
    return "bg-red-500/40";
  };

  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex gap-1 min-w-max">
        {weeks.map((w, wi) => (
          <div key={wi} className="flex flex-col gap-1">
            {w.map((d: any, di: number) => (
              <button
                key={di}
                onClick={() => d && onClick(d.date)}
                title={d ? `${d.date} — ${d.done}/${d.total}` : ""}
                className={`h-3.5 w-3.5 rounded-sm ${colorFor(d)} ${
                  d && activeDate === d.date ? "ring-2 ring-primary" : ""
                } ${d ? "hover:ring-1 hover:ring-primary/50" : ""}`}
                disabled={!d}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="py-8 text-center">
      <p className="text-sm text-muted-foreground mb-3">Você ainda não tem hábitos ativos para hoje.</p>
      <div className="flex flex-wrap gap-2 justify-center max-w-lg mx-auto">
        {PRESET_HABITS.slice(0, 6).map((p) => (
          <span key={p} className="text-xs px-2 py-1 rounded-full border border-border bg-background/40 text-muted-foreground">{p}</span>
        ))}
      </div>
      <button onClick={onCreate} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-gradient-brand px-4 py-2 text-sm text-primary-foreground">
        <Plus className="h-4 w-4" /> Criar primeiro hábito
      </button>
    </div>
  );
}

function HabitModal({ initial, onClose, onSave, saving }: { initial: any; onClose: () => void; onSave: (v: any) => void; saving: boolean }) {
  const [form, setForm] = useState({
    id: initial?.id,
    name: initial?.name ?? "",
    color: initial?.color ?? COLORS[0],
    category: initial?.category ?? "",
    target_daily: initial?.target_daily ?? 1,
    target_weekly: initial?.target_weekly ?? "",
    target_monthly: initial?.target_monthly ?? "",
    weekdays: initial?.weekdays ?? [0, 1, 2, 3, 4, 5, 6],
    time: initial?.time ?? "",
    reminder_enabled: initial?.reminder_enabled ?? false,
    notes: initial?.notes ?? "",
  });

  const toggleDay = (d: number) => {
    setForm((f) => ({
      ...f,
      weekdays: f.weekdays.includes(d) ? f.weekdays.filter((x: number) => x !== d) : [...f.weekdays, d].sort(),
    }));
  };

  const submit = () => {
    if (!form.name.trim()) return;
    onSave({
      ...form,
      target_weekly: form.target_weekly === "" ? null : Number(form.target_weekly),
      target_monthly: form.target_monthly === "" ? null : Number(form.target_monthly),
      time: form.time || null,
      category: form.category || null,
      notes: form.notes || null,
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm grid place-items-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 10 }}
        className="w-full max-w-lg rounded-3xl border border-border bg-card p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display text-xl">{initial ? "Editar hábito" : "Novo hábito"}</h3>
          <button onClick={onClose}><X className="h-5 w-5 text-muted-foreground" /></button>
        </div>

        <div className="space-y-4">
          <Field label="Nome">
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Ex: Academia" className={inputCls} />
          </Field>

          <div className="flex flex-wrap gap-2">
            {PRESET_HABITS.map((p) => (
              <button key={p} onClick={() => setForm({ ...form, name: p })}
                className="text-xs px-2.5 py-1 rounded-full border border-border bg-background/40 hover:border-primary/40 transition-smooth">
                {p}
              </button>
            ))}
          </div>

          <Field label="Categoria (opcional)">
            <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
              placeholder="Saúde, Estudo, Financeiro…" className={inputCls} />
          </Field>

          <Field label="Cor">
            <div className="flex flex-wrap gap-2">
              {COLORS.map((c) => (
                <button key={c} onClick={() => setForm({ ...form, color: c })}
                  className={`h-8 w-8 rounded-lg border-2 transition-smooth ${form.color === c ? "border-foreground scale-110" : "border-transparent"}`}
                  style={{ background: c }} />
              ))}
            </div>
          </Field>

          <Field label="Dias da semana">
            <div className="flex gap-1.5">
              {WEEKDAYS.map((d) => (
                <button key={d.i} onClick={() => toggleDay(d.i)}
                  className={`h-9 w-9 rounded-lg border text-xs font-medium transition-smooth ${
                    form.weekdays.includes(d.i)
                      ? "bg-gradient-brand text-primary-foreground border-transparent"
                      : "border-border text-muted-foreground hover:border-primary/40"
                  }`}>{d.s}</button>
              ))}
            </div>
          </Field>

          <div className="grid grid-cols-3 gap-3">
            <Field label="Meta diária">
              <input type="number" min={1} value={form.target_daily}
                onChange={(e) => setForm({ ...form, target_daily: Number(e.target.value) })}
                className={inputCls} />
            </Field>
            <Field label="Semanal">
              <input type="number" min={0} value={form.target_weekly as any}
                onChange={(e) => setForm({ ...form, target_weekly: e.target.value as any })}
                className={inputCls} />
            </Field>
            <Field label="Mensal">
              <input type="number" min={0} value={form.target_monthly as any}
                onChange={(e) => setForm({ ...form, target_monthly: e.target.value as any })}
                className={inputCls} />
            </Field>
          </div>

          <Field label="Horário (opcional)">
            <input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })}
              className={inputCls} />
          </Field>

          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={form.reminder_enabled}
              onChange={(e) => setForm({ ...form, reminder_enabled: e.target.checked })} />
            <Bell className="h-4 w-4 text-primary" /> Lembretes automáticos
          </label>

          <Field label="Observações">
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={2} className={inputCls} />
          </Field>

          <div className="flex gap-2 pt-2">
            <button onClick={onClose} className="flex-1 rounded-xl border border-border py-2.5 text-sm hover:bg-background/40 transition-smooth">
              Cancelar
            </button>
            <button onClick={submit} disabled={saving || !form.name.trim()}
              className="flex-1 rounded-xl bg-gradient-brand text-primary-foreground py-2.5 text-sm font-medium disabled:opacity-50 inline-flex items-center justify-center gap-2">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {initial ? "Salvar" : "Criar hábito"}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

const inputCls = "w-full bg-input rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40";

function Field({ label, children }: { label: string; children: any }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs uppercase tracking-wider text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}
