import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { formatDayMonthSP } from "@/lib/datetime";

export const BRL = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n ?? 0);

export function ClickableKpi({
  open,
  onToggle,
  onClose,
  panel,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  panel: React.ReactNode;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={onToggle}
        className="text-left w-full rounded-3xl focus:outline-none focus:ring-2 focus:ring-primary/40 transition-smooth cursor-pointer"
      >
        {children}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -6 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="absolute z-40 left-0 right-0 sm:left-auto sm:right-0 sm:w-[320px] mt-2 top-full origin-top-right"
          >
            <div className="rounded-2xl border border-primary/30 bg-[oklch(0.21_0.08_295)] shadow-2xl backdrop-blur-xl overflow-hidden">
              {panel}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function PanelHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
      <h4 className="font-display text-sm">{title}</h4>
      <button
        onClick={onClose}
        className="h-7 w-7 grid place-items-center rounded-lg hover:bg-background/40 text-muted-foreground hover:text-foreground transition-smooth"
        aria-label="Fechar"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export function TxListPanel({
  title,
  kind,
  items,
  onClose,
}: {
  title: string;
  kind: "income" | "expense";
  items: any[];
  onClose: () => void;
}) {
  const sign = kind === "income" ? "+" : "-";
  const color = kind === "income" ? "text-emerald-300" : "text-rose-300";
  return (
    <div>
      <PanelHeader title={title} onClose={onClose} />
      <div className="p-3 max-h-[320px] overflow-y-auto">
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-6">Nenhum lançamento registrado.</p>
        ) : (
          <ul className="space-y-1.5">
            {items.map((t, i) => (
              <li key={i} className="flex items-center justify-between gap-2 text-xs px-2 py-1.5 rounded-lg hover:bg-background/30">
                <span className="text-muted-foreground shrink-0">{formatDayMonthSP(t.occurred_at)}</span>
                <span className="flex-1 truncate">{t.description || t.category}</span>
                <span className={`font-medium ${color}`}>{sign}{BRL(Number(t.amount))}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Link
        to="/app/transacoes"
        search={{ kind }}
        onClick={onClose}
        className="block px-4 py-3 border-t border-border/60 text-xs text-primary hover:bg-primary/10 transition-smooth text-center font-medium"
      >
        Ver todas as {kind === "income" ? "receitas" : "despesas"} →
      </Link>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "emerald" | "rose" }) {
  const color = tone === "emerald" ? "text-emerald-300" : tone === "rose" ? "text-rose-300" : "text-foreground";
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-xs font-medium text-right ${color}`}>{value}</span>
    </div>
  );
}

export function BalancePanel({ d, onClose, onExplain }: { d: any; onClose: () => void; onExplain?: () => void }) {
  const top = d?.topCategories?.[0];
  const big = d?.largestExpense;
  const last = d?.lastTx;
  const balance = Number(d?.balance ?? 0);
  const income = Number(d?.income ?? 0);
  const expense = Number(d?.expense ?? 0);
  return (
    <div>
      <PanelHeader title="📊 Resumo Financeiro" onClose={onClose} />
      <div className="p-4 space-y-3 text-sm">
        <Row label="Saldo atual" value={BRL(balance)} tone={balance >= 0 ? "emerald" : "rose"} />
        <Row label="Receitas acumuladas" value={BRL(income)} tone="emerald" />
        <Row label="Despesas acumuladas" value={BRL(expense)} tone="rose" />
        <Row label="Maior categoria" value={top?.category ?? "—"} />
        <Row label="Maior gasto" value={big ? `${big.description || big.category} • ${BRL(Number(big.amount))}` : "—"} />
        <Row label="Última movimentação" value={last ? `${formatDayMonthSP(last.occurred_at)} • ${last.description || last.category} • ${last.kind === "income" ? "+" : "-"}${BRL(Number(last.amount))}` : "—"} />
      </div>
      {onExplain && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onClose(); onExplain(); }}
          className="w-full px-4 py-3 border-t border-border/60 text-xs text-primary hover:bg-primary/10 transition-smooth text-center font-medium"
        >
          🧾 Como foi calculado? →
        </button>
      )}
    </div>
  );
}

/**
 * Reusable hook: manages which of the three KPI cards is open.
 */
export function useKpiPopover() {
  const [openCard, setOpenCard] = useState<null | "balance" | "income" | "expense">(null);
  const toggle = (k: "balance" | "income" | "expense") =>
    setOpenCard((cur) => (cur === k ? null : k));
  const close = () => setOpenCard(null);
  return { openCard, toggle, close };
}
