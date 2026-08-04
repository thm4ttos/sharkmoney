import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { X, AlertTriangle, RefreshCw, Info } from "lucide-react";
import { getBalanceBreakdown } from "@/lib/reconcile.functions";
import { formatDayMonthSP } from "@/lib/datetime";

const BRL = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n ?? 0);

/**
 * "Como meu saldo foi calculado?" — extrato completo do saldo mostrando cada
 * transação agrupada por categoria. Fonte única: tabela transactions.
 * O saldo NUNCA é armazenado — sempre derivado.
 */
export function BalanceBreakdownDialog({
  open,
  onClose,
  from,
  to,
  periodLabel,
}: {
  open: boolean;
  onClose: () => void;
  from?: string;
  to?: string;
  periodLabel?: string;
}) {
  const run = useServerFn(getBalanceBreakdown);
  const { data, isFetching, refetch } = useQuery({
    queryKey: ["balance-breakdown", from ?? null, to ?? null],
    queryFn: () => run({ data: { from, to } }) as any,
    enabled: open,
    staleTime: 15_000,
  });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  const income = Number(data?.income ?? 0);
  const expense = Number(data?.expense ?? 0);
  const balance = Number(data?.balance ?? 0);
  const suspects = (data?.suspects ?? []) as any[];
  const incomeGroups = (data?.incomeGroups ?? []) as any[];
  const expenseGroups = (data?.expenseGroups ?? []) as any[];
  const balanceTone = balance >= 0 ? "text-emerald-300" : "text-rose-300";

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-start md:items-center justify-center p-3 md:p-6 overflow-y-auto"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 16 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-2xl rounded-3xl border border-primary/30 bg-[oklch(0.19_0.08_295)] shadow-2xl overflow-hidden"
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-border/60">
              <div>
                <h3 className="font-display text-lg">🧾 Como meu saldo foi calculado?</h3>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Fórmula: Σ receitas − Σ despesas · fonte única: tabela de transações
                  {periodLabel ? ` · ${periodLabel}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => refetch()}
                  disabled={isFetching}
                  className="h-8 w-8 grid place-items-center rounded-lg hover:bg-background/40 text-muted-foreground hover:text-foreground transition-smooth"
                  aria-label="Recalcular"
                  title="Recalcular do zero"
                >
                  <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
                </button>
                <button
                  onClick={onClose}
                  className="h-8 w-8 grid place-items-center rounded-lg hover:bg-background/40 text-muted-foreground hover:text-foreground transition-smooth"
                  aria-label="Fechar"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="max-h-[75vh] overflow-y-auto">
              {/* Top summary */}
              <div className="p-5 grid grid-cols-3 gap-3">
                <SummaryTile label="Receitas" value={`+ ${BRL(income)}`} tone="emerald" />
                <SummaryTile label="Despesas" value={`− ${BRL(expense)}`} tone="rose" />
                <SummaryTile
                  label="Saldo"
                  value={`${balance < 0 ? "−" : ""}${BRL(Math.abs(balance))}`}
                  tone={balance >= 0 ? "emerald" : "rose"}
                  emphasis
                />
              </div>

              {suspects.length > 0 && (
                <div className="mx-5 mb-4 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold">
                        Diagnóstico automático: {suspects.length} possível{suspects.length > 1 ? "is" : ""} duplicado{suspects.length > 1 ? "s" : ""} detectado{suspects.length > 1 ? "s" : ""}
                      </p>
                      <ul className="mt-1 space-y-0.5 list-disc list-inside opacity-90">
                        {suspects.slice(0, 5).map((s, i) => (
                          <li key={i}>
                            {s.description || s.category} · {BRL(Number(s.amount))} — {s.reason}
                          </li>
                        ))}
                      </ul>
                      <p className="mt-1 opacity-80">Revise em <span className="font-medium">Transações</span> para excluir a duplicidade.</p>
                    </div>
                  </div>
                </div>
              )}

              {isFetching && !data ? (
                <div className="p-8 text-center text-sm text-muted-foreground">Calculando…</div>
              ) : (
                <>
                  <Section title={`Receitas (${incomeGroups.length} categoria${incomeGroups.length === 1 ? "" : "s"})`} tone="emerald">
                    {incomeGroups.length === 0 ? (
                      <p className="text-xs text-muted-foreground px-1 py-3">Nenhuma receita no período.</p>
                    ) : (
                      incomeGroups.map((g: any) => <CategoryBlock key={`i-${g.category}`} group={g} tone="emerald" />)
                    )}
                  </Section>

                  <Section title={`Despesas (${expenseGroups.length} categoria${expenseGroups.length === 1 ? "" : "s"})`} tone="rose">
                    {expenseGroups.length === 0 ? (
                      <p className="text-xs text-muted-foreground px-1 py-3">Nenhuma despesa no período.</p>
                    ) : (
                      expenseGroups.map((g: any) => <CategoryBlock key={`e-${g.category}`} group={g} tone="rose" />)
                    )}
                  </Section>

                  <div className="px-5 py-4 border-t border-border/60 bg-background/30">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Saldo Final</span>
                      <span className={`font-display text-2xl tabular-nums ${balanceTone}`}>
                        {balance < 0 ? "−" : ""}{BRL(Math.abs(balance))}
                      </span>
                    </div>
                    <p className="mt-2 flex items-start gap-1.5 text-[11px] text-muted-foreground">
                      <Info className="h-3 w-3 mt-0.5 shrink-0" />
                      {data?.total_transactions ?? 0} transações consideradas. O saldo é sempre recalculado a partir dessas linhas — nada é armazenado.
                    </p>
                  </div>
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function SummaryTile({ label, value, tone, emphasis }: { label: string; value: string; tone: "emerald" | "rose"; emphasis?: boolean }) {
  const color = tone === "emerald" ? "text-emerald-300" : "text-rose-300";
  return (
    <div className={`rounded-2xl border p-3 ${emphasis ? "border-primary/40 bg-primary/10" : "border-border bg-background/40"}`}>
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className={`font-display mt-1 tabular-nums ${emphasis ? "text-xl" : "text-base"} ${color}`}>{value}</p>
    </div>
  );
}

function Section({ title, tone, children }: { title: string; tone: "emerald" | "rose"; children: React.ReactNode }) {
  const dot = tone === "emerald" ? "bg-emerald-400" : "bg-rose-400";
  return (
    <div className="px-5 py-4 border-t border-border/60">
      <div className="flex items-center gap-2 mb-2">
        <span className={`h-2 w-2 rounded-full ${dot}`} />
        <h4 className="text-xs uppercase tracking-widest text-muted-foreground">{title}</h4>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function CategoryBlock({ group, tone }: { group: any; tone: "emerald" | "rose" }) {
  const [open, setOpen] = useState(false);
  const color = tone === "emerald" ? "text-emerald-300" : "text-rose-300";
  const sign = tone === "emerald" ? "+" : "−";
  const items = group.items ?? [];
  return (
    <div className="rounded-xl border border-border/60 bg-background/30 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-background/50 transition-smooth"
      >
        <div className="text-left">
          <p className="text-sm font-medium">{group.category}</p>
          <p className="text-[10px] text-muted-foreground">{group.count} lançamento{group.count === 1 ? "" : "s"}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`font-medium tabular-nums ${color}`}>{sign} {BRL(Number(group.total))}</span>
          <span className="text-[10px] text-muted-foreground">{open ? "▲" : "▼"}</span>
        </div>
      </button>
      {open && (
        <ul className="divide-y divide-border/40">
          {items.map((it: any) => (
            <li key={it.id} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
              <span className="text-muted-foreground shrink-0">{formatDayMonthSP(it.occurred_at)}</span>
              <span className="flex-1 truncate">{it.description || group.category}</span>
              <span className={`tabular-nums ${color}`}>{sign} {BRL(Number(it.amount))}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
