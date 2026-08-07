import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CalendarDays, ChevronLeft, ChevronRight, Bell, TrendingUp, TrendingDown } from "lucide-react";
import { getCalendarMonth } from "@/lib/user-extras.functions";
import { dayOfMonthSP } from "@/lib/datetime";

export const Route = createFileRoute("/app/calendario")({
  head: () => ({ meta: [{ title: "Calendário · Abio" }] }),
  component: Page,
});

const BRL = (n: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n ?? 0);
const WD = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function Page() {
  const today = new Date();
  const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() + 1 });
  const [selectedDay, setSelectedDay] = useState<number>(today.getDate());

  const run = useServerFn(getCalendarMonth);
  const q = useQuery({
    queryKey: ["calendar", cursor.year, cursor.month],
    queryFn: () => run({ data: cursor }) as any,
  });

  const data: any = q.data;

  const byDay = useMemo(() => {
    const map = new Map<number, { tx: any[]; ap: any[] }>();
    if (data) {
      for (const t of data.transactions) {
        const d = dayOfMonthSP(t.occurred_at);
        const s = map.get(d) ?? { tx: [], ap: [] };
        s.tx.push(t); map.set(d, s);
      }
      for (const a of data.appointments) {
        const d = dayOfMonthSP(a.scheduled_at);
        const s = map.get(d) ?? { tx: [], ap: [] };
        s.ap.push(a); map.set(d, s);
      }
    }
    return map;
  }, [data]);

  const firstWd = new Date(cursor.year, cursor.month - 1, 1).getDay();
  const daysInMonth = new Date(cursor.year, cursor.month, 0).getDate();
  const cells: (number | null)[] = [...Array(firstWd).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);

  const isToday = (d: number) => today.getFullYear() === cursor.year && today.getMonth() + 1 === cursor.month && today.getDate() === d;

  const nav = (delta: number) => {
    const nd = new Date(cursor.year, cursor.month - 1 + delta, 1);
    setCursor({ year: nd.getFullYear(), month: nd.getMonth() + 1 });
    setSelectedDay(1);
  };

  const selected = byDay.get(selectedDay);
  const monthName = data?.monthLabel ?? "...";

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <motion.header initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-4">
        <div className="h-14 w-14 grid place-items-center rounded-2xl border border-border bg-card/60">
          <CalendarDays className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="font-display text-3xl">Calendário Financeiro</h1>
          <p className="text-sm text-muted-foreground">Compromissos, contas e lançamentos em um só lugar.</p>
        </div>
      </motion.header>

      <section className="rounded-3xl border border-border bg-card/60 backdrop-blur-xl p-5 shadow-card">
        <div className="flex items-center justify-between mb-4">
          <button onClick={() => nav(-1)} className="h-10 w-10 grid place-items-center rounded-xl border border-border hover:bg-background/40 transition-smooth">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <h2 className="font-display text-xl capitalize">{monthName} <span className="text-muted-foreground">{cursor.year}</span></h2>
          <button onClick={() => nav(1)} className="h-10 w-10 grid place-items-center rounded-xl border border-border hover:bg-background/40 transition-smooth">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-1 text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
          {WD.map((w) => <div key={w} className="text-center py-1">{w}</div>)}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {cells.map((d, i) => {
            if (d === null) return <div key={i} className="aspect-square" />;
            const slot = byDay.get(d);
            const hasTx = (slot?.tx.length ?? 0) > 0;
            const hasAp = (slot?.ap.length ?? 0) > 0;
            const active = selectedDay === d;
            const tdy = isToday(d);
            return (
              <motion.button
                key={i}
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.96 }}
                onClick={() => setSelectedDay(d)}
                className={[
                  "aspect-square rounded-xl border p-1.5 flex flex-col items-start justify-between text-left transition-smooth",
                  active ? "border-primary bg-gradient-brand-soft" : "border-border bg-background/30 hover:bg-background/50",
                  tdy ? "ring-1 ring-primary" : "",
                ].join(" ")}
              >
                <span className={["text-xs font-display", tdy ? "text-primary" : ""].join(" ")}>{d}</span>
                <div className="flex items-center gap-1 flex-wrap">
                  {hasTx ? <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> : null}
                  {hasAp ? <span className="h-1.5 w-1.5 rounded-full bg-primary" /> : null}
                </div>
              </motion.button>
            );
          })}
        </div>

        <div className="flex items-center gap-4 text-[11px] text-muted-foreground mt-3">
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-400" /> Movimentações</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-primary" /> Compromissos</span>
        </div>
      </section>

      <AnimatePresence mode="wait">
        <motion.section
          key={`${cursor.year}-${cursor.month}-${selectedDay}`}
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
          className="rounded-3xl border border-border bg-card/60 backdrop-blur-xl p-5"
        >
          <h3 className="font-display text-xl mb-4">
            Dia {String(selectedDay).padStart(2, "0")} de <span className="capitalize">{monthName}</span>
          </h3>

          {q.isLoading ? (
            <p className="text-sm text-muted-foreground">Carregando...</p>
          ) : !selected || (selected.tx.length === 0 && selected.ap.length === 0) ? (
            <p className="text-sm text-muted-foreground">Nenhum evento ou movimentação neste dia.</p>
          ) : (
            <div className="space-y-4">
              {selected.ap.length > 0 ? (
                <div>
                  <p className="text-xs uppercase tracking-wider text-primary mb-2 flex items-center gap-2"><Bell className="h-3.5 w-3.5" /> Compromissos</p>
                  <ul className="divide-y divide-border">
                    {selected.ap.map((a: any) => (
                      <li key={a.id} className="py-2.5">
                        <p className="text-sm font-medium">{a.title}</p>
                        <p className="text-[11px] text-muted-foreground">{new Date(a.scheduled_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} {a.notes ? `· ${a.notes}` : ""}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {selected.tx.length > 0 ? (
                <div>
                  <p className="text-xs uppercase tracking-wider text-primary mb-2">Movimentações</p>
                  <ul className="divide-y divide-border">
                    {selected.tx.map((t: any) => {
                      const isIn = t.kind === "income";
                      return (
                        <li key={t.id} className="py-2.5 flex items-center gap-3">
                          <div className={["h-9 w-9 grid place-items-center rounded-xl border", isIn ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-rose-500/30 bg-rose-500/10 text-rose-300"].join(" ")}>
                            {isIn ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm truncate">{t.description ?? t.category}</p>
                            <p className="text-[11px] text-muted-foreground">{t.category}</p>
                          </div>
                          <p className={`font-display text-sm ${isIn ? "text-emerald-300" : "text-rose-300"}`}>{isIn ? "+" : "−"} {BRL(t.amount)}</p>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}
            </div>
          )}
        </motion.section>
      </AnimatePresence>
    </div>
  );
}
