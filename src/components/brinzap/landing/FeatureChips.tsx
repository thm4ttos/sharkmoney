import { motion } from "framer-motion";
import { useLandingI18n } from "@/lib/landing-i18n";
import { Reveal } from "./Reveal";

const chips = [
  { emoji: "💸", pt: "Gastos", en: "Expenses" },
  { emoji: "📅", pt: "Agenda", en: "Calendar" },
  { emoji: "🎯", pt: "Metas", en: "Goals" },
  { emoji: "📊", pt: "Relatórios", en: "Reports" },
  { emoji: "⏰", pt: "Lembretes", en: "Reminders" },
  { emoji: "📷", pt: "Fotos", en: "Photos" },
  { emoji: "🎤", pt: "Áudios", en: "Voice notes" },
  { emoji: "📄", pt: "PDFs", en: "PDFs" },
];

export function FeatureChips() {
  const { t, lang } = useLandingI18n();

  return (
    <section id="recursos" className="relative px-5 sm:px-6 py-20 md:py-28 scroll-mt-20">
      <div className="mx-auto max-w-6xl">
        <Reveal className="max-w-2xl">
          <span className="text-[11px] uppercase tracking-[0.24em] text-primary">{t("chips.eyebrow")}</span>
          <h2 className="font-display text-3xl sm:text-4xl md:text-5xl mt-4 leading-[1.12] font-semibold">
            {t("chips.title")}
          </h2>
        </Reveal>

        <div className="mt-10 md:mt-14 grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
          {chips.map((c, i) => (
            <motion.div
              key={c.pt}
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-8% 0px" }}
              transition={{ duration: 0.4, delay: (i % 4) * 0.06, ease: [0.22, 1, 0.36, 1] }}
              className="rounded-2xl border border-border bg-card px-4 py-5 text-center transition-all duration-300 hover:-translate-y-1 hover:border-primary/40 hover:shadow-card"
            >
              <span className="text-2xl leading-none" aria-hidden>
                {c.emoji}
              </span>
              <p className="mt-3 text-sm font-medium">{lang === "en" ? c.en : c.pt}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
