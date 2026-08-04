import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";

type Tone = "brand" | "income" | "expense" | "neutral";

const TONES: Record<Tone, string> = {
  brand: "border-border bg-card",
  income: "border-border bg-card",
  expense: "border-border bg-card",
  neutral: "border-border bg-card",
};

const VALUE_TONES: Record<Tone, string> = {
  brand: "text-foreground",
  income: "text-emerald-400",
  expense: "text-rose-400",
  neutral: "text-foreground",
};

const ICON_TONES: Record<Tone, string> = {
  brand: "text-primary",
  income: "text-emerald-400",
  expense: "text-rose-400",
  neutral: "text-muted-foreground",
};

export function KpiCard({
  label,
  value,
  hint,
  tone = "neutral",
  icon: Icon,
  delay = 0,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: Tone;
  icon?: LucideIcon;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay, ease: [0.4, 0, 0.2, 1] }}
      className={[
        "relative isolate w-full max-w-full overflow-hidden rounded-xl border p-6 max-[380px]:p-5 shadow-card transition-colors hover:border-border/80",
        TONES[tone],
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">{label}</p>
        {Icon ? <Icon className={`h-4 w-4 shrink-0 ${ICON_TONES[tone]}`} strokeWidth={1.75} /> : null}
      </div>
      <p
        key={value}
        className={`font-display mt-4 font-semibold tabular-nums whitespace-nowrap truncate ${VALUE_TONES[tone]}`}
        style={{ willChange: "auto", backfaceVisibility: "hidden", fontSize: "clamp(1.5rem, 6.5vw, 1.75rem)", letterSpacing: "-0.03em" }}
      >
        {value}
      </p>
      {hint ? <p className="text-xs text-muted-foreground mt-2">{hint}</p> : null}

    </motion.div>
  );
}

