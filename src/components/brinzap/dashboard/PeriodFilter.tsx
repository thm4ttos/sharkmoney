import { useState } from "react";
import { CalendarIcon, ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import type { DashboardRange } from "@/lib/dashboard.functions";
import { RANGE_LABELS } from "@/lib/dashboard.functions";

export type PeriodValue = {
  range: DashboardRange;
  start?: string;
  end?: string;
};

const ALL_OPTIONS: DashboardRange[] = [
  "today", "yesterday",
  "last_3_days", "last_7_days", "last_15_days", "last_30_days",
  "this_month", "last_month",
  "last_3_months", "last_6_months",
  "this_year", "last_year",
  "all", "custom",
];

const DEFAULT_CHART_OPTIONS: DashboardRange[] = [
  "today", "last_7_days", "last_15_days", "last_30_days",
  "last_3_months", "last_6_months", "all",
];

type Props = {
  value: PeriodValue;
  onChange: (v: PeriodValue) => void;
  compact?: boolean;
  className?: string;
  options?: DashboardRange[];
  align?: "start" | "center" | "end";
};

export function PeriodFilter({ value, onChange, compact, className, options, align = "end" }: Props) {
  const [open, setOpen] = useState(false);
  const [customStart, setCustomStart] = useState<Date | undefined>(value.start ? new Date(value.start) : undefined);
  const [customEnd, setCustomEnd] = useState<Date | undefined>(value.end ? new Date(value.end) : undefined);

  const list = options ?? (compact ? DEFAULT_CHART_OPTIONS : ALL_OPTIONS);
  const label = value.range === "custom" && value.start && value.end
    ? `${new Date(value.start).toLocaleDateString("pt-BR")} – ${new Date(value.end).toLocaleDateString("pt-BR")}`
    : RANGE_LABELS[value.range] ?? "Período";

  function pick(r: DashboardRange) {
    if (r === "custom") return; // handled by calendar
    onChange({ range: r });
    setOpen(false);
  }

  function applyCustom() {
    if (customStart && customEnd) {
      onChange({
        range: "custom",
        start: customStart.toISOString(),
        end: customEnd.toISOString(),
      });
      setOpen(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size={compact ? "sm" : "default"}
          className={cn(
            "gap-2 border-primary/30 bg-background/40 hover:bg-primary/10 hover:text-primary",
            compact && "h-8 px-2.5 text-[11px]",
            className,
          )}
        >
          <CalendarIcon className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
          <span className="truncate max-w-[180px]">📅 {label}</span>
          <ChevronDown className={compact ? "h-3 w-3 opacity-70" : "h-4 w-4 opacity-70"} />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align={align}
        className="w-[320px] p-2 bg-[oklch(0.18_0.08_295)] border-[oklch(0.32_0.09_295_/_60%)] text-white pointer-events-auto"
      >
        <div className="grid grid-cols-2 gap-1">
          {list.filter((o) => o !== "custom").map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => pick(r)}
              className={cn(
                "text-left text-xs px-2.5 py-2 rounded-lg border border-transparent transition-colors hover:bg-primary/15",
                value.range === r && "border-primary/40 bg-primary/15 text-primary",
              )}
            >
              {RANGE_LABELS[r]}
            </button>
          ))}
        </div>
        {list.includes("custom") && (
          <div className="mt-2 pt-2 border-t border-white/10">
            <p className="text-[11px] uppercase tracking-wider text-white/60 mb-2 px-1">Personalizado</p>
            <div className="grid grid-cols-2 gap-2">
              <CalendarField label="Início" value={customStart} onChange={setCustomStart} />
              <CalendarField label="Fim" value={customEnd} onChange={setCustomEnd} />
            </div>
            <Button
              size="sm"
              className="w-full mt-2 bg-primary hover:bg-primary/90"
              disabled={!customStart || !customEnd}
              onClick={applyCustom}
            >
              Atualizar Dashboard
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function CalendarField({ label, value, onChange }: { label: string; value?: Date; onChange: (d?: Date) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="text-left text-xs px-2 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10"
        >
          <div className="text-[10px] uppercase tracking-wider text-white/50">{label}</div>
          <div className="mt-0.5">{value ? value.toLocaleDateString("pt-BR") : "—"}</div>
        </button>
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

// Hook: persist selected period across navigation via localStorage
const STORAGE_KEY = "brinzap:dashboard:period";

export function usePeriodFilter(defaultRange: DashboardRange = "all"): [PeriodValue, (v: PeriodValue) => void] {
  const [value, setValue] = useState<PeriodValue>(() => {
    if (typeof window === "undefined") return { range: defaultRange };
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as PeriodValue;
        if (parsed && parsed.range) return parsed;
      }
    } catch { /* noop */ }
    return { range: defaultRange };
  });

  function update(v: PeriodValue) {
    setValue(v);
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(v)); } catch { /* noop */ }
  }

  return [value, update];
}
