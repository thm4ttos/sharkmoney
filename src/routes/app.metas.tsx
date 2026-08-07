import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Target, Plus, Trash2, Sparkles, Plane, Car, Home, Wallet, Star, X } from "lucide-react";
import { listGoals, upsertGoal, addToGoal, deleteGoal } from "@/lib/goals.functions";

export const Route = createFileRoute("/app/metas")({
  head: () => ({ meta: [{ title: "Metas · Abio" }] }),
  component: Page,
});

const BRL = (n: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n ?? 0);

const KINDS = [
  { id: "emergency", label: "Reserva de emergência", icon: Wallet },
  { id: "travel", label: "Viagem", icon: Plane },
  { id: "vehicle", label: "Veículo", icon: Car },
  { id: "house", label: "Imóvel", icon: Home },
  { id: "custom", label: "Personalizada", icon: Star },
];

function kindIcon(kind: string) {
  return KINDS.find((k) => k.id === kind)?.icon ?? Target;
}

function Page() {
  const qc = useQueryClient();
  const run = useServerFn(listGoals);
  const save = useServerFn(upsertGoal);
  const add = useServerFn(addToGoal);
  const del = useServerFn(deleteGoal);
  const q = useQuery({ queryKey: ["goals"], queryFn: () => run() as any });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["goals"] });
  const mSave = useMutation({ mutationFn: (d: any) => save({ data: d }) as any, onSuccess: () => { invalidate(); setOpen(false); setEditing(null); } });
  const mAdd = useMutation({ mutationFn: (d: any) => add({ data: d }) as any, onSuccess: invalidate });
  const mDel = useMutation({ mutationFn: (id: string) => del({ data: { id } }) as any, onSuccess: invalidate });

  const goals: any[] = q.data ?? [];

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <motion.header initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 grid place-items-center rounded-2xl border border-border bg-card/60">
            <Target className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="font-display text-3xl">Metas Financeiras</h1>
            <p className="text-sm text-muted-foreground">Defina objetivos e acompanhe seu progresso com sugestões da IA.</p>
          </div>
        </div>
        <button onClick={() => { setEditing(null); setOpen(true); }}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-brand text-primary-foreground px-4 py-2.5 text-sm glow-neon hover:scale-[1.02] transition-smooth">
          <Plus className="h-4 w-4" /> Nova meta
        </button>
      </motion.header>

      {q.isLoading ? (
        <div className="grid sm:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-44 rounded-3xl border border-border bg-card/40 animate-pulse" />)}
        </div>
      ) : goals.length === 0 ? (
        <Empty onCreate={() => { setEditing(null); setOpen(true); }} />
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {goals.map((g, i) => {
            const Icon = kindIcon(g.kind);
            return (
              <motion.div key={g.id}
                initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                className="rounded-3xl border border-border bg-card/60 backdrop-blur-xl p-5 shadow-card">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-10 w-10 grid place-items-center rounded-xl bg-gradient-brand-soft border border-primary/30">
                      <Icon className="h-5 w-5 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-display text-lg truncate">{g.title}</p>
                      <p className="text-[11px] text-muted-foreground">{BRL(g.current_amount)} / {BRL(g.target_amount)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => { setEditing(g); setOpen(true); }} className="text-[11px] text-muted-foreground hover:text-foreground px-2 py-1 rounded-lg border border-border">Editar</button>
                    <button onClick={() => mDel.mutate(g.id)} className="h-7 w-7 grid place-items-center rounded-lg border border-destructive/30 text-destructive hover:bg-destructive/10"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                </div>

                <div className="mt-4">
                  <div className="h-2 rounded-full bg-background/50 overflow-hidden">
                    <motion.div initial={{ width: 0 }} animate={{ width: `${g.progress_pct}%` }} transition={{ duration: 0.6, ease: "easeOut" }}
                      className="h-full bg-gradient-brand" />
                  </div>
                  <div className="flex justify-between text-[11px] text-muted-foreground mt-2">
                    <span>{g.progress_pct}% concluído</span>
                    {g.months_to_target ? <span>{g.months_to_target} meses restantes</span> : null}
                  </div>
                </div>

                <div className="mt-4 rounded-2xl border border-primary/20 bg-primary/5 p-3 text-xs leading-relaxed flex items-start gap-2">
                  <Sparkles className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" /> {g.suggestion}
                </div>

                <div className="mt-3 flex items-center gap-2">
                  <QuickAdd onAdd={(v) => mAdd.mutate({ id: g.id, amount: v })} />
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      <AnimatePresence>
        {open ? (
          <GoalDialog
            initial={editing}
            onClose={() => { setOpen(false); setEditing(null); }}
            onSave={(d) => mSave.mutate({ ...d, id: editing?.id })}
            saving={mSave.isPending}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function Empty({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="rounded-3xl border border-border bg-card/40 backdrop-blur-xl p-12 text-center">
      <Target className="h-10 w-10 text-primary mx-auto mb-3" />
      <p className="font-display text-xl">Nenhuma meta criada ainda</p>
      <p className="text-sm text-muted-foreground mt-1">Defina objetivos e deixe a IA te ajudar a alcançá-los.</p>
      <button onClick={onCreate} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-gradient-brand text-primary-foreground px-4 py-2 text-sm">
        <Plus className="h-4 w-4" /> Criar primeira meta
      </button>
    </div>
  );
}

function QuickAdd({ onAdd }: { onAdd: (v: number) => void }) {
  const [v, setV] = useState("");
  return (
    <div className="flex items-center gap-1.5 w-full">
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        placeholder="+ R$ 100,00"
        className="flex-1 bg-input rounded-lg px-2.5 py-1.5 text-xs"
        inputMode="decimal"
      />
      <button
        onClick={() => { const n = parseFloat(v.replace(",", ".")); if (Number.isFinite(n)) { onAdd(n); setV(""); } }}
        className="rounded-lg bg-primary/20 text-primary border border-primary/30 px-2.5 py-1.5 text-xs hover:bg-primary/30"
      >Adicionar</button>
    </div>
  );
}

function GoalDialog({ initial, onClose, onSave, saving }: { initial: any | null; onClose: () => void; onSave: (d: any) => void; saving: boolean }) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [kind, setKind] = useState(initial?.kind ?? "custom");
  const [target, setTarget] = useState(initial ? String(initial.target_amount) : "");
  const [current, setCurrent] = useState(initial ? String(initial.current_amount) : "0");
  const [date, setDate] = useState(initial?.target_date ?? "");

  const submit = () => {
    onSave({
      title,
      kind,
      target_amount: parseFloat(target.replace(",", ".")),
      current_amount: parseFloat(current.replace(",", ".")) || 0,
      target_date: date || null,
    });
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 grid place-items-center p-4">
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        className="w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display text-xl">{initial ? "Editar meta" : "Nova meta"}</h3>
          <button onClick={onClose} className="h-8 w-8 grid place-items-center rounded-lg border border-border"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground">Título</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 w-full bg-input rounded-xl px-3 py-2.5 text-sm" placeholder="Ex.: Viagem para o Japão" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Tipo</label>
            <div className="mt-1 grid grid-cols-5 gap-1.5">
              {KINDS.map((k) => {
                const I = k.icon;
                const active = kind === k.id;
                return (
                  <button key={k.id} onClick={() => setKind(k.id)} title={k.label}
                    className={["h-12 grid place-items-center rounded-xl border transition-smooth", active ? "border-primary bg-gradient-brand-soft" : "border-border bg-background/30 hover:bg-background/50"].join(" ")}>
                    <I className="h-4 w-4" />
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Valor alvo (R$)</label>
              <input value={target} onChange={(e) => setTarget(e.target.value)} inputMode="decimal" className="mt-1 w-full bg-input rounded-xl px-3 py-2.5 text-sm" placeholder="5000" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Acumulado (R$)</label>
              <input value={current} onChange={(e) => setCurrent(e.target.value)} inputMode="decimal" className="mt-1 w-full bg-input rounded-xl px-3 py-2.5 text-sm" />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Data alvo (opcional)</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 w-full bg-input rounded-xl px-3 py-2.5 text-sm" />
          </div>
          <button onClick={submit} disabled={saving || !title || !target}
            className="w-full rounded-xl bg-gradient-brand text-primary-foreground font-medium py-2.5 glow-neon disabled:opacity-50">
            {saving ? "Salvando..." : "Salvar meta"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
