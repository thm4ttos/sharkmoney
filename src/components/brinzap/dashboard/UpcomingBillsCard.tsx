import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CalendarClock, Check, Clock, Pencil, Trash2, X, AlertTriangle } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listBills, chargeBillNow, deleteBill, upsertBill } from "@/lib/bills.functions";
import { toast } from "sonner";

const BRL = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n ?? 0);

type Bill = {
  id: string;
  title: string;
  category: string;
  amount: number;
  frequency: "weekly" | "biweekly" | "monthly" | "yearly";
  next_due_at: string;
  active: boolean;
  notify_whatsapp: boolean;
  notes: string | null;
  days_until: number;
  payment_status?: string | null;
};

function formatDue(dateISO: string) {
  const [y, m, d] = dateISO.split("-");
  return `${d}/${m}/${y.slice(2)}`;
}

function bucketOf(b: Bill): "overdue" | "today" | "soon" | "later" {
  if (b.days_until < 0) return "overdue";
  if (b.days_until === 0) return "today";
  if (b.days_until <= 7) return "soon";
  return "later";
}

export function UpcomingBillsCard() {
  const qc = useQueryClient();
  const fetchBills = useServerFn(listBills);
  const chargeFn = useServerFn(chargeBillNow);
  const deleteFn = useServerFn(deleteBill);
  const upsertFn = useServerFn(upsertBill);

  const { data: bills = [], isLoading } = useQuery({
    queryKey: ["home-upcoming-bills"],
    queryFn: () => fetchBills() as unknown as Promise<Bill[]>,
    staleTime: 30_000,
  });

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const active = useMemo(() => bills.filter((b) => b.active), [bills]);
  const pending = useMemo(
    () => active.filter((b) => b.days_until <= 7 || b.payment_status !== "paid"),
    [active],
  );
  const overdue = active.filter((b) => b.days_until < 0);
  const today = active.filter((b) => b.days_until === 0);
  const soon = active.filter((b) => b.days_until > 0 && b.days_until <= 15);

  const highlight = overdue[0] ?? today[0] ?? soon[0] ?? null;
  const pendingCount = overdue.length + today.length + soon.length;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["home-upcoming-bills"] });
    qc.invalidateQueries({ queryKey: ["home-stats"] });
    qc.invalidateQueries({ queryKey: ["dashboard-stats-v2"] });
    qc.invalidateQueries({ queryKey: ["bills"] });
  };

  const chargeM = useMutation({
    mutationFn: (id: string) => chargeFn({ data: { id } }) as any,
    onSuccess: () => { toast.success("Conta marcada como paga."); invalidate(); },
    onError: (e: any) => toast.error(e?.message || "Não foi possível marcar como paga."),
  });
  const deleteM = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }) as any,
    onSuccess: () => { toast.success("Conta excluída."); invalidate(); },
    onError: (e: any) => toast.error(e?.message || "Não foi possível excluir."),
  });
  const snoozeM = useMutation({
    mutationFn: (b: Bill) => {
      const d = new Date(b.next_due_at + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + 1);
      const next = d.toISOString().slice(0, 10);
      return upsertFn({
        data: {
          id: b.id,
          title: b.title,
          category: b.category,
          amount: b.amount,
          frequency: b.frequency,
          next_due_at: next,
          active: b.active,
          notify_whatsapp: b.notify_whatsapp,
          notes: b.notes,
        },
      }) as any;
    },
    onSuccess: () => { toast.success("Lembrete adiado para amanhã."); invalidate(); },
    onError: (e: any) => toast.error(e?.message || "Não foi possível adiar."),
  });

  const summary = (() => {
    if (isLoading) return "Carregando…";
    if (pendingCount === 0) return "Nenhuma conta pendente no momento.";
    if (highlight) {
      const label =
        highlight.days_until < 0
          ? `Vencida há ${Math.abs(highlight.days_until)} dia(s)`
          : highlight.days_until === 0
            ? "Vence hoje"
            : `Vence em ${highlight.days_until} dia(s)`;
      return `${highlight.title} · ${label}`;
    }
    return `${pendingCount} conta(s) pendente(s)`;
  })();

  const accent =
    overdue.length > 0
      ? "border-rose-500/40 bg-rose-500/10"
      : today.length > 0
        ? "border-amber-500/40 bg-amber-500/10"
        : "border-primary/30 bg-primary/5";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left rounded-3xl focus:outline-none focus:ring-2 focus:ring-primary/40 transition-smooth cursor-pointer"
      >
        <section className={`rounded-3xl border p-5 backdrop-blur-xl hover:border-primary/40 transition-smooth ${accent}`}>
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl">Próximas contas</h2>
            <div className="h-9 w-9 grid place-items-center rounded-xl bg-background/40 text-primary">
              <CalendarClock className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-4">
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Carregando contas…</p>
            ) : pendingCount === 0 ? (
              <div>
                <p className="text-sm">✅ Nenhuma conta pendente no momento.</p>
                <p className="text-xs text-muted-foreground mt-1">Tudo em dia. Bom trabalho!</p>
              </div>
            ) : (
              <div>
                <p className="text-sm">
                  {overdue.length > 0 && <span className="text-rose-300 font-medium">⚠️ {overdue.length} vencida(s) · </span>}
                  {today.length > 0 && <span className="text-amber-300 font-medium">📅 {today.length} hoje · </span>}
                  <span className="text-muted-foreground">{pendingCount} pendente(s)</span>
                </p>
                {highlight && (
                  <p className="text-sm mt-2">
                    <span className="text-foreground font-medium">{highlight.title}</span>
                    <span className="text-muted-foreground"> · {formatDue(highlight.next_due_at)} · </span>
                    <span className="text-foreground font-semibold">{BRL(highlight.amount)}</span>
                  </p>
                )}
                <p className="text-xs text-primary mt-2">Toque para ver detalhes →</p>
              </div>
            )}
          </div>
        </section>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -6 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="absolute z-40 left-0 right-0 sm:left-auto sm:right-0 sm:w-[380px] mt-2 top-full origin-top-right"
          >
            <div className="rounded-2xl border border-primary/30 bg-[oklch(0.21_0.08_295)] shadow-2xl backdrop-blur-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
                <h4 className="font-display text-sm">📆 Contas fixas · {summary}</h4>
                <button
                  onClick={() => setOpen(false)}
                  className="h-7 w-7 grid place-items-center rounded-lg hover:bg-background/40 text-muted-foreground hover:text-foreground transition-smooth"
                  aria-label="Fechar"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="max-h-[420px] overflow-y-auto p-3 space-y-4">
                <Group title="Vencidas" tone="rose" items={overdue} onPay={(b) => chargeM.mutate(b.id)} onSnooze={(b) => snoozeM.mutate(b)} onDelete={(b) => deleteM.mutate(b.id)} />
                <Group title="Vencem hoje" tone="amber" items={today} onPay={(b) => chargeM.mutate(b.id)} onSnooze={(b) => snoozeM.mutate(b)} onDelete={(b) => deleteM.mutate(b.id)} />
                <Group title="Em breve" tone="primary" items={soon} onPay={(b) => chargeM.mutate(b.id)} onSnooze={(b) => snoozeM.mutate(b)} onDelete={(b) => deleteM.mutate(b.id)} />
                {overdue.length + today.length + soon.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-6">Nenhuma conta próxima do vencimento.</p>
                )}
              </div>
              <Link
                to="/app/contas-fixas"
                onClick={() => setOpen(false)}
                className="block px-4 py-3 border-t border-border/60 text-xs text-primary hover:bg-primary/10 transition-smooth text-center font-medium"
              >
                Gerenciar contas fixas →
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Group({
  title, tone, items, onPay, onSnooze, onDelete,
}: {
  title: string;
  tone: "rose" | "amber" | "primary";
  items: Bill[];
  onPay: (b: Bill) => void;
  onSnooze: (b: Bill) => void;
  onDelete: (b: Bill) => void;
}) {
  if (items.length === 0) return null;
  const toneMap = {
    rose: "text-rose-300",
    amber: "text-amber-300",
    primary: "text-primary",
  } as const;
  return (
    <div>
      <div className={`flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] mb-2 ${toneMap[tone]}`}>
        {tone === "rose" ? <AlertTriangle className="h-3 w-3" /> : <CalendarClock className="h-3 w-3" />}
        {title} · {items.length}
      </div>
      <ul className="space-y-2">
        {items.map((b) => (
          <li key={b.id} className="rounded-xl border border-border/60 bg-background/30 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{b.title}</p>
                <p className="text-[11px] text-muted-foreground">
                  {formatDue(b.next_due_at)} · {b.category} · {BRL(b.amount)}
                </p>
                <p className="text-[11px] mt-0.5">
                  <span className={b.payment_status === "paid" ? "text-emerald-300" : "text-muted-foreground"}>
                    Status: {b.payment_status === "paid" ? "Paga" : "Pendente"}
                  </span>
                </p>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <ActionBtn onClick={() => onPay(b)} label="Paga" icon={Check} tone="emerald" />
              <ActionBtn onClick={() => onSnooze(b)} label="Lembrar depois" icon={Clock} />
              <Link
                to="/app/contas-fixas"
                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] border border-border/60 bg-background/40 hover:border-primary/40 text-muted-foreground hover:text-foreground transition-smooth"
              >
                <Pencil className="h-3 w-3" /> Editar
              </Link>
              <ActionBtn onClick={() => onDelete(b)} label="Excluir" icon={Trash2} tone="rose" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ActionBtn({
  onClick, label, icon: Icon, tone,
}: {
  onClick: () => void;
  label: string;
  icon: typeof Check;
  tone?: "emerald" | "rose";
}) {
  const cls =
    tone === "emerald"
      ? "border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10"
      : tone === "rose"
        ? "border-rose-500/40 text-rose-300 hover:bg-rose-500/10"
        : "border-border/60 text-muted-foreground hover:text-foreground hover:border-primary/40";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] border bg-background/40 transition-smooth ${cls}`}
    >
      <Icon className="h-3 w-3" /> {label}
    </button>
  );
}
