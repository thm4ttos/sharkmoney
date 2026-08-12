import { useMemo, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  FolderTree, TrendingUp, TrendingDown, Hash, Sigma, Search, X, Loader2,
  ArrowUpDown, FileText, FileSpreadsheet, Pencil, Trash2, CalendarIcon, MessageCircle, Monitor,
} from "lucide-react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { categoryGroups } from "@/lib/user-mock";
import {
  getCategoriesOverview,
  listTransactions,
  deleteTransaction,
  updateTransaction,
} from "@/lib/brinzap.functions";
import { toast } from "sonner";

type Kind = "all" | "income" | "expense";
type Preset =
  | "today" | "yesterday" | "3d" | "7d" | "15d" | "30d"
  | "month" | "last_month" | "custom";

const PRESETS: { key: Preset; label: string }[] = [
  { key: "today", label: "Hoje" },
  { key: "yesterday", label: "Ontem" },
  { key: "3d", label: "3 dias" },
  { key: "7d", label: "7 dias" },
  { key: "15d", label: "15 dias" },
  { key: "30d", label: "30 dias" },
  { key: "month", label: "Este mês" },
  { key: "last_month", label: "Mês passado" },
  { key: "custom", label: "Personalizado" },
];

function rangeFor(preset: Preset, custom?: { from?: Date; to?: Date }): { from?: string; to?: string } {
  const now = new Date();
  const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const endOfDay = (d: Date) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };
  const iso = (d: Date) => d.toISOString();
  if (preset === "custom") {
    return {
      from: custom?.from ? iso(startOfDay(custom.from)) : undefined,
      to: custom?.to ? iso(endOfDay(custom.to)) : undefined,
    };
  }
  if (preset === "today") return { from: iso(startOfDay(now)), to: iso(endOfDay(now)) };
  if (preset === "yesterday") {
    const y = new Date(now); y.setDate(y.getDate() - 1);
    return { from: iso(startOfDay(y)), to: iso(endOfDay(y)) };
  }
  if (preset === "month") return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(endOfDay(now)) };
  if (preset === "last_month") {
    const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const last = new Date(now.getFullYear(), now.getMonth(), 0);
    return { from: iso(first), to: iso(endOfDay(last)) };
  }
  const days = preset === "3d" ? 3 : preset === "7d" ? 7 : preset === "15d" ? 15 : 30;
  const from = new Date(now); from.setDate(from.getDate() - days); from.setHours(0, 0, 0, 0);
  return { from: iso(from), to: iso(endOfDay(now)) };
}

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });
const fmtDateTime = (iso: string) => format(new Date(iso), "dd/MM/yyyy HH:mm", { locale: ptBR });
const fmtDate = (iso: string) => format(new Date(iso), "dd/MM/yyyy", { locale: ptBR });

function groupOfCategory(cat: string) {
  const g = categoryGroups.find((g) => g.categories.includes(cat));
  return g ?? categoryGroups[categoryGroups.length - 1];
}

export function CategoriasView() {
  const [kind, setKind] = useState<Kind>("all");
  const [preset, setPreset] = useState<Preset>("30d");
  const [customStart, setCustomStart] = useState<Date | undefined>();
  const [customEnd, setCustomEnd] = useState<Date | undefined>();

  const range = useMemo(
    () => rangeFor(preset, { from: customStart, to: customEnd }),
    [preset, customStart, customEnd],
  );

  const query = useQuery({
    queryKey: ["cat-overview", kind, range.from ?? "", range.to ?? ""],
    queryFn: () =>
      getCategoriesOverview({
        data: {
          from: range.from,
          to: range.to,
          kind: kind === "all" ? undefined : kind,
        },
      }),
    staleTime: 15_000,
  });

  const data = query.data;
  const [openCat, setOpenCat] = useState<string | null>(null);

  const totals = useMemo(() => {
    if (!data) return { total: 0, count: 0, cats: 0, avg: 0 };
    return {
      total: data.grandTotal,
      count: data.count,
      cats: data.categories.length,
      avg: data.count ? data.grandTotal / data.count : 0,
    };
  }, [data]);

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="rounded-3xl border border-border bg-card/60 backdrop-blur-xl p-4 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <KindPill active={kind === "all"} onClick={() => setKind("all")} label="Todas" />
          <KindPill active={kind === "income"} onClick={() => setKind("income")} label="Apenas Receitas" tone="income" />
          <KindPill active={kind === "expense"} onClick={() => setKind("expense")} label="Apenas Despesas" tone="expense" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPreset(p.key)}
              className={cn(
                "text-xs rounded-full px-3 py-1.5 border transition-colors",
                preset === p.key
                  ? "bg-primary text-primary-foreground border-primary shadow-lg shadow-primary/20"
                  : "border-border bg-background/30 text-muted-foreground hover:text-foreground hover:border-primary/40",
              )}
            >
              {p.label}
            </button>
          ))}
          {preset === "custom" && (
            <div className="flex items-center gap-2 ml-2">
              <CalendarPick label="Início" value={customStart} onChange={setCustomStart} />
              <span className="text-muted-foreground text-xs">até</span>
              <CalendarPick label="Fim" value={customEnd} onChange={setCustomEnd} />
            </div>
          )}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Total no período" value={brl(totals.total)} icon={<Sigma className="h-4 w-4" />} highlight />
        <Kpi label="Lançamentos" value={String(totals.count)} icon={<Hash className="h-4 w-4" />} />
        <Kpi label="Categorias ativas" value={String(totals.cats)} icon={<FolderTree className="h-4 w-4" />} />
        <Kpi label="Ticket médio" value={brl(totals.avg)} icon={<TrendingUp className="h-4 w-4" />} />
      </div>

      {/* Grid */}
      {query.isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
          <Loader2 className="h-5 w-5 animate-spin" /> Carregando…
        </div>
      ) : !data || data.categories.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-border bg-card/40 py-16 text-center">
          <p className="font-display text-lg">Nenhum lançamento encontrado</p>
          <p className="text-sm text-muted-foreground mt-1">
            Não existem movimentações para os filtros selecionados.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.categories.map((c) => (
            <CategoryCard
              key={c.category}
              cat={c}
              onOpen={() => setOpenCat(c.category)}
              range={range}
              kind={kind}
            />
          ))}
        </div>
      )}

      {/* Drawer / Sheet with full details */}
      <CategoryDrawer
        category={openCat}
        onClose={() => setOpenCat(null)}
        range={range}
        kind={kind}
      />
    </div>
  );
}

/* ---------------- Filter pill ---------------- */
function KindPill({
  active, onClick, label, tone,
}: { active: boolean; onClick: () => void; label: string; tone?: "income" | "expense" }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "text-sm rounded-full px-4 py-2 border font-medium transition-all",
        active
          ? tone === "income"
            ? "bg-emerald-500/20 border-emerald-500/60 text-emerald-300 shadow-lg shadow-emerald-500/10"
            : tone === "expense"
              ? "bg-rose-500/20 border-rose-500/60 text-rose-300 shadow-lg shadow-rose-500/10"
              : "bg-primary text-primary-foreground border-primary shadow-lg shadow-primary/20"
          : "border-border bg-background/30 text-muted-foreground hover:text-foreground hover:border-primary/40",
      )}
    >
      {label}
    </button>
  );
}

/* ---------------- KPI card ---------------- */
function Kpi({ label, value, icon, highlight }: { label: string; value: string; icon: React.ReactNode; highlight?: boolean }) {
  return (
    <div className={cn(
      "rounded-2xl border p-4 backdrop-blur-xl",
      highlight
        ? "border-primary/40 bg-gradient-to-br from-primary/15 to-primary/5"
        : "border-border bg-card/60",
    )}>
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
        {icon}<span>{label}</span>
      </div>
      <p className={cn("mt-1.5 font-display text-2xl", highlight && "text-primary")}>{value}</p>
    </div>
  );
}

/* ---------------- Custom date picker ---------------- */
function CalendarPick({ label, value, onChange }: { label: string; value?: Date; onChange: (d?: Date) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2 h-8 text-xs">
          <CalendarIcon className="h-3.5 w-3.5" />
          {value ? fmtDate(value.toISOString()) : label}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0 pointer-events-auto" align="start">
        <Calendar
          mode="single"
          selected={value}
          onSelect={(d) => { onChange(d ?? undefined); setOpen(false); }}
          initialFocus
          className={cn("p-3 pointer-events-auto")}
        />
      </PopoverContent>
    </Popover>
  );
}

/* ---------------- Category card ---------------- */
type CatRow = {
  category: string;
  total: number;
  count: number;
  income: number;
  expense: number;
  lastAt: string | null;
  lastDescription: string | null;
  spark: number[];
  avg: number;
  percent: number;
};

function CategoryCard({
  cat, onOpen, range, kind,
}: {
  cat: CatRow;
  onOpen: () => void;
  range: { from?: string; to?: string };
  kind: Kind;
}) {
  const isMobile = useIsMobile();
  const g = groupOfCategory(cat.category);
  const Icon = g.icon;
  const dominant = cat.income > cat.expense ? "income" : "expense";

  const card = (
    <button
      type="button"
      onClick={onOpen}
      className="group text-left w-full rounded-3xl border border-border bg-card/60 backdrop-blur-xl p-5 transition-all hover:border-primary/50 hover:bg-card/80 hover:shadow-xl hover:shadow-primary/10 hover:-translate-y-0.5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className={cn(
            "h-12 w-12 rounded-2xl grid place-items-center bg-background/50 border border-border shrink-0",
            g.color,
          )}>
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="font-display text-lg leading-tight truncate">{cat.category}</p>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{g.name}</p>
          </div>
        </div>
        <span className={cn(
          "text-[10px] font-medium rounded-full px-2 py-0.5 border",
          dominant === "income"
            ? "border-emerald-500/40 text-emerald-300 bg-emerald-500/10"
            : "border-rose-500/40 text-rose-300 bg-rose-500/10",
        )}>
          {dominant === "income" ? "Receita" : "Despesa"}
        </span>
      </div>

      <div className="mt-4 flex items-end justify-between gap-3">
        <div>
          <p className="font-display text-2xl">{brl(cat.total)}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {cat.count} lançamento{cat.count !== 1 ? "s" : ""} · média {brl(cat.avg)}
          </p>
        </div>
        <Sparkline points={cat.spark} tone={dominant} />
      </div>

      {/* progress */}
      <div className="mt-4">
        <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
          <span>Participação {kind === "income" ? "das receitas" : kind === "expense" ? "das despesas" : "do total"}</span>
          <span className="text-foreground font-medium">{cat.percent.toFixed(1)}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-background/50 overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              dominant === "income" ? "bg-gradient-to-r from-emerald-500 to-emerald-400" : "bg-gradient-to-r from-primary to-primary/60",
            )}
            style={{ width: `${Math.min(100, cat.percent)}%` }}
          />
        </div>
      </div>

      {cat.lastAt && (
        <p className="mt-3 text-xs text-muted-foreground truncate">
          Última: <span className="text-foreground/80">{cat.lastDescription || "Sem descrição"}</span>
          {" · "}
          <span>{fmtDate(cat.lastAt)}</span>
        </p>
      )}
    </button>
  );

  if (isMobile) return card;

  return (
    <HoverCard openDelay={200} closeDelay={80}>
      <HoverCardTrigger asChild>{card}</HoverCardTrigger>
      <HoverCardContent
        side="right"
        align="start"
        sideOffset={12}
        className="w-96 p-0 border-border bg-[oklch(0.16_0.08_295)]/95 backdrop-blur-2xl shadow-2xl z-[100]"
      >
        <HoverContent category={cat.category} range={range} kind={kind} />
      </HoverCardContent>
    </HoverCard>
  );
}

/* ---------------- Sparkline ---------------- */
function Sparkline({ points, tone }: { points: number[]; tone: "income" | "expense" }) {
  const max = Math.max(...points, 1);
  const w = 90, h = 32;
  const step = points.length > 1 ? w / (points.length - 1) : w;
  const path = points
    .map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={w} height={h} className="shrink-0 opacity-80">
      <path
        d={path}
        fill="none"
        stroke={tone === "income" ? "oklch(0.75 0.18 155)" : "oklch(0.72 0.18 295)"}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ---------------- Hover content ---------------- */
function HoverContent({
  category, range, kind,
}: { category: string; range: { from?: string; to?: string }; kind: Kind }) {
  const q = useQuery({
    queryKey: ["cat-hover", category, range.from ?? "", range.to ?? "", kind],
    queryFn: () =>
      listTransactions({
        data: {
          category,
          from: range.from,
          to: range.to,
          kind: kind === "all" ? undefined : kind,
          limit: 8,
          withCount: false,
        },
      }),
    staleTime: 15_000,
  });
  const rows = q.data?.rows ?? [];
  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="font-display text-base">{category}</p>
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Últimos lançamentos</span>
      </div>
      {q.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground py-3 text-center">Sem lançamentos.</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((t: any) => (
            <li key={t.id} className="flex items-start justify-between gap-3 text-sm rounded-lg px-2 py-1.5 hover:bg-white/5">
              <div className="min-w-0">
                <p className="truncate">{t.description || "Sem descrição"}</p>
                <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                  {fmtDateTime(t.occurred_at)}
                  <SourceBadge source={t.source} />
                </p>
              </div>
              <span className={cn(
                "text-sm font-medium shrink-0",
                t.kind === "income" ? "text-emerald-300" : "text-rose-300",
              )}>
                {t.kind === "income" ? "+" : "−"} {brl(Number(t.amount))}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] text-center text-muted-foreground pt-1">
        Clique no card para ver todos os lançamentos
      </p>
    </div>
  );
}

function SourceBadge({ source }: { source?: string | null }) {
  if (!source) return null;
  if (source === "whatsapp") {
    return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 text-emerald-300 px-1.5 py-px text-[10px]"><MessageCircle className="h-2.5 w-2.5" />WhatsApp</span>;
  }
  return <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 text-primary px-1.5 py-px text-[10px]"><Monitor className="h-2.5 w-2.5" />Dashboard</span>;
}

/* ---------------- Drawer (full details) ---------------- */
function CategoryDrawer({
  category, onClose, range, kind,
}: {
  category: string | null;
  onClose: () => void;
  range: { from?: string; to?: string };
  kind: Kind;
}) {
  const open = !!category;
  const isMobile = useIsMobile();
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"date_desc" | "date_asc" | "amount_desc" | "amount_asc">("date_desc");
  const [editing, setEditing] = useState<any | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["cat-detail", category, range.from ?? "", range.to ?? "", kind],
    enabled: open && !!category,
    queryFn: () =>
      listTransactions({
        data: {
          category: category!,
          from: range.from,
          to: range.to,
          kind: kind === "all" ? undefined : kind,
          limit: 500,
          withCount: true,
        },
      }),
    staleTime: 10_000,
  });

  const rows: any[] = q.data?.rows ?? [];

  const filtered = useMemo(() => {
    const t = search.trim().toLowerCase();
    let list = rows;
    if (t) list = list.filter((r) => (r.description ?? "").toLowerCase().includes(t));
    const sorted = [...list].sort((a, b) => {
      if (sort === "date_desc") return b.occurred_at.localeCompare(a.occurred_at);
      if (sort === "date_asc") return a.occurred_at.localeCompare(b.occurred_at);
      if (sort === "amount_desc") return Number(b.amount) - Number(a.amount);
      return Number(a.amount) - Number(b.amount);
    });
    return sorted;
  }, [rows, search, sort]);

  const total = useMemo(() => filtered.reduce((s, r) => s + Number(r.amount), 0), [filtered]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["cat-overview"] });
    qc.invalidateQueries({ queryKey: ["cat-detail"] });
    qc.invalidateQueries({ queryKey: ["cat-hover"] });
  };

  const del = useMutation({
    mutationFn: (id: string) => deleteTransaction({ data: { id } }),
    onSuccess: () => { invalidate(); toast.success("Lançamento excluído"); setDeletingId(null); },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao excluir"),
  });

  const upd = useMutation({
    mutationFn: (p: any) => updateTransaction({ data: p }),
    onSuccess: () => { invalidate(); toast.success("Lançamento atualizado"); setEditing(null); },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao atualizar"),
  });

  function exportCSV() {
    const header = ["Data", "Descrição", "Categoria", "Tipo", "Valor", "Origem"];
    const lines = [header.join(";")];
    for (const r of filtered) {
      lines.push([
        fmtDateTime(r.occurred_at),
        `"${(r.description ?? "").replace(/"/g, '""')}"`,
        r.category,
        r.kind === "income" ? "Receita" : "Despesa",
        Number(r.amount).toFixed(2).replace(".", ","),
        r.source ?? "",
      ].join(";"));
    }
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${category}-lancamentos.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  function exportPDF() {
    const w = window.open("", "_blank");
    if (!w) return;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${category}</title>
      <style>body{font-family:sans-serif;padding:24px;color:#111}h1{margin:0 0 8px}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border-bottom:1px solid #eee;padding:8px;text-align:left;font-size:13px}th{background:#f5f5f5}.tot{margin-top:12px;font-weight:600}</style>
      </head><body>
      <h1>${category}</h1>
      <div>Período: ${range.from ? fmtDate(range.from) : "—"} → ${range.to ? fmtDate(range.to) : "—"}</div>
      <div class="tot">Total: ${brl(total)} · ${filtered.length} lançamentos</div>
      <table><thead><tr><th>Data</th><th>Descrição</th><th>Tipo</th><th>Origem</th><th style="text-align:right">Valor</th></tr></thead>
      <tbody>
        ${filtered.map((r) => `<tr>
          <td>${fmtDateTime(r.occurred_at)}</td>
          <td>${(r.description ?? "").replace(/</g, "&lt;")}</td>
          <td>${r.kind === "income" ? "Receita" : "Despesa"}</td>
          <td>${r.source ?? ""}</td>
          <td style="text-align:right">${brl(Number(r.amount))}</td>
        </tr>`).join("")}
      </tbody></table>
      <script>window.onload=()=>window.print()</script>
      </body></html>`;
    w.document.write(html); w.document.close();
  }

  return (
    <>
      <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
        <SheetContent
          side={isMobile ? "bottom" : "right"}
          className={cn(
            "border-border bg-[oklch(0.14_0.08_295)]/95 backdrop-blur-2xl text-foreground overflow-y-auto",
            isMobile ? "rounded-t-3xl h-[90vh]" : "w-full sm:max-w-2xl",
          )}
        >
          <SheetHeader className="text-left">
            <SheetTitle className="font-display text-2xl flex items-center gap-2">
              {category}
            </SheetTitle>
          </SheetHeader>

          {category && (
            <div className="mt-4 space-y-4">
              {/* summary */}
              <div className="grid grid-cols-3 gap-2">
                <MiniStat label="Total" value={brl(total)} highlight />
                <MiniStat label="Lançamentos" value={String(filtered.length)} />
                <MiniStat label="Média" value={brl(filtered.length ? total / filtered.length : 0)} />
              </div>

              {/* controls */}
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Buscar descrição…"
                    className="pl-9 bg-background/40 border-border"
                  />
                  {search && (
                    <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="gap-2">
                      <ArrowUpDown className="h-4 w-4" />
                      {sort === "date_desc" ? "Mais recente" : sort === "date_asc" ? "Mais antigo" : sort === "amount_desc" ? "Maior valor" : "Menor valor"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-48 p-1" align="end">
                    {[
                      { k: "date_desc", l: "Mais recente" },
                      { k: "date_asc", l: "Mais antigo" },
                      { k: "amount_desc", l: "Maior valor" },
                      { k: "amount_asc", l: "Menor valor" },
                    ].map((o) => (
                      <button
                        key={o.k}
                        onClick={() => setSort(o.k as any)}
                        className={cn(
                          "block w-full text-left text-sm rounded-md px-2 py-1.5 hover:bg-primary/10",
                          sort === o.k && "bg-primary/15 text-primary",
                        )}
                      >
                        {o.l}
                      </button>
                    ))}
                  </PopoverContent>
                </Popover>
              </div>

              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={exportPDF} className="gap-2">
                  <FileText className="h-4 w-4" /> Exportar PDF
                </Button>
                <Button size="sm" variant="outline" onClick={exportCSV} className="gap-2">
                  <FileSpreadsheet className="h-4 w-4" /> Exportar Excel
                </Button>
              </div>

              {/* list */}
              <div className="rounded-2xl border border-border bg-card/40 divide-y divide-border overflow-hidden">
                {q.isLoading ? (
                  <div className="flex items-center gap-2 text-muted-foreground p-6 text-sm">
                    <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="p-6 text-center text-sm text-muted-foreground">
                    Não existem movimentações nesta categoria para o período selecionado.
                  </div>
                ) : (
                  filtered.map((t) => (
                    <div key={t.id} className="flex items-start gap-3 p-3 hover:bg-white/5">
                      <div className={cn(
                        "h-8 w-8 grid place-items-center rounded-lg shrink-0",
                        t.kind === "income" ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300",
                      )}>
                        {t.kind === "income" ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate">{t.description || "Sem descrição"}</p>
                        <p className="text-[11px] text-muted-foreground flex items-center gap-1.5 mt-0.5">
                          {fmtDateTime(t.occurred_at)}
                          <SourceBadge source={t.source} />
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className={cn(
                          "text-sm font-medium",
                          t.kind === "income" ? "text-emerald-300" : "text-rose-300",
                        )}>
                          {t.kind === "income" ? "+" : "−"} {brl(Number(t.amount))}
                        </p>
                        <div className="flex justify-end gap-1 mt-1">
                          <button
                            onClick={() => setEditing(t)}
                            className="p-1 rounded hover:bg-white/10 text-muted-foreground hover:text-foreground"
                            title="Editar"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => setDeletingId(t.id)}
                            className="p-1 rounded hover:bg-rose-500/20 text-muted-foreground hover:text-rose-300"
                            title="Excluir"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Edit dialog */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="bg-[oklch(0.16_0.08_295)]/95 backdrop-blur-2xl border-border">
          <DialogHeader><DialogTitle>Editar lançamento</DialogTitle></DialogHeader>
          {editing && (
            <EditForm
              tx={editing}
              onCancel={() => setEditing(null)}
              onSave={(p) => upd.mutate(p)}
              saving={upd.isPending}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deletingId} onOpenChange={(o) => !o && setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir lançamento?</AlertDialogTitle>
            <AlertDialogDescription>Esta ação não pode ser desfeita.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletingId && del.mutate(deletingId)}
              className="bg-rose-500 hover:bg-rose-600"
            >
              {del.isPending ? "Excluindo…" : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function MiniStat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={cn(
      "rounded-xl border p-3",
      highlight ? "border-primary/40 bg-primary/10" : "border-border bg-background/30",
    )}>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn("font-display text-lg mt-0.5", highlight && "text-primary")}>{value}</p>
    </div>
  );
}

function EditForm({
  tx, onCancel, onSave, saving,
}: {
  tx: any;
  onCancel: () => void;
  onSave: (p: { id: string; kind: "income" | "expense"; amount: number; category: string; description?: string; occurred_at?: string }) => void;
  saving: boolean;
}) {
  const [amount, setAmount] = useState(String(tx.amount));
  const [description, setDescription] = useState(tx.description ?? "");
  const [kind, setKind] = useState<"income" | "expense">(tx.kind);
  const [category, setCategory] = useState(tx.category);
  const [occurredAt, setOccurredAt] = useState(tx.occurred_at.slice(0, 16));
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Button variant={kind === "expense" ? "default" : "outline"} size="sm" onClick={() => setKind("expense")}>Despesa</Button>
        <Button variant={kind === "income" ? "default" : "outline"} size="sm" onClick={() => setKind("income")}>Receita</Button>
      </div>
      <div>
        <label className="text-xs text-muted-foreground">Valor</label>
        <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
      <div>
        <label className="text-xs text-muted-foreground">Descrição</label>
        <Input value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div>
        <label className="text-xs text-muted-foreground">Categoria</label>
        <Input value={category} onChange={(e) => setCategory(e.target.value)} />
      </div>
      <div>
        <label className="text-xs text-muted-foreground">Data / hora</label>
        <Input type="datetime-local" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>Cancelar</Button>
        <Button
          disabled={saving}
          onClick={() =>
            onSave({
              id: tx.id,
              kind,
              amount: Number(amount) || 0,
              category,
              description: description || undefined,
              occurred_at: occurredAt ? new Date(occurredAt).toISOString() : undefined,
            })
          }
        >
          {saving ? "Salvando…" : "Salvar"}
        </Button>
      </DialogFooter>
    </div>
  );
}
