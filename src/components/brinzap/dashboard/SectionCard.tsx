import { motion } from "framer-motion";
import type { ReactNode } from "react";

export function SectionCard({
  title,
  subtitle,
  children,
  delay = 0,
  className = "",
  action,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  delay?: number;
  className?: string;
  action?: ReactNode;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: [0.4, 0, 0.2, 1] }}
      className={["rounded-xl border border-border bg-card shadow-card p-6", className].join(" ")}
    >
      <header className="mb-5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-base font-semibold tracking-tight">{title}</h2>
          {subtitle ? <p className="text-xs text-muted-foreground mt-1">{subtitle}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </header>
      {children}
    </motion.section>
  );
}


