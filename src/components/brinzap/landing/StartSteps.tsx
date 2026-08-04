import { motion } from "framer-motion";
import { MessageCircle, Sparkles, UserPlus } from "lucide-react";
import { useLandingI18n } from "@/lib/landing-i18n";
import { Reveal } from "./Reveal";

const icons = [UserPlus, MessageCircle, Sparkles];

export function StartSteps() {
  const { t } = useLandingI18n();

  const steps = [
    { n: "01", title: t("steps.1.title"), desc: t("steps.1.desc") },
    { n: "02", title: t("steps.2.title"), desc: t("steps.2.desc") },
    { n: "03", title: t("steps.3.title"), desc: t("steps.3.desc") },
  ];

  return (
    <section id="como-funciona" className="relative px-5 sm:px-6 py-20 md:py-28 scroll-mt-20">
      <div className="mx-auto max-w-6xl">
        <Reveal className="max-w-2xl">
          <span className="text-[11px] uppercase tracking-[0.24em] text-primary">{t("steps.eyebrow")}</span>
          <h2 className="font-display text-3xl sm:text-4xl md:text-5xl mt-4 leading-[1.12] font-semibold">
            {t("steps.title")}
          </h2>
        </Reveal>

        <div className="mt-10 md:mt-14 grid gap-4 md:grid-cols-3 md:gap-6">
          {steps.map((s, i) => {
            const Icon = icons[i];
            return (
              <motion.div
                key={s.n}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-10% 0px" }}
                transition={{ duration: 0.5, delay: i * 0.1, ease: [0.22, 1, 0.36, 1] }}
                className="h-full rounded-3xl border border-border bg-card p-7 sm:p-8 transition-all duration-300 hover:-translate-y-1 hover:border-primary/40 hover:shadow-card"
              >
                <div className="flex items-center gap-3">
                  <span className="font-display text-sm font-semibold text-primary tabular-nums">{s.n}</span>
                  <span className="h-px flex-1 bg-border" />
                  <span className="h-9 w-9 shrink-0 rounded-xl border border-border bg-secondary grid place-items-center">
                    <Icon className="h-4 w-4 text-primary" strokeWidth={1.75} />
                  </span>
                </div>
                <h3 className="font-display text-xl mt-6 font-semibold leading-snug">{s.title}</h3>
                <p className="text-sm text-muted-foreground mt-3 leading-relaxed">{s.desc}</p>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
