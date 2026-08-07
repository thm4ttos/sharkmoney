import { motion } from "framer-motion";
import { ArrowDown, CheckCheck } from "lucide-react";
import { useLandingI18n } from "@/lib/landing-i18n";
import { Reveal } from "./Reveal";

export function ChatExamples() {
  const { t } = useLandingI18n();

  const rows = [
    { msg: t("examples.1.msg"), emoji: "✅", res: t("examples.1.res"), time: "09:12" },
    { msg: t("examples.2.msg"), emoji: "📅", res: t("examples.2.res"), time: "14:03" },
    { msg: t("examples.3.msg"), emoji: "📊", res: t("examples.3.res"), time: "21:40" },
  ];

  return (
    <section className="relative px-5 sm:px-6 py-20 md:py-28">
      <div className="mx-auto max-w-6xl">
        <Reveal className="max-w-3xl">
          <h2 className="font-display text-3xl sm:text-4xl md:text-5xl leading-[1.12] font-semibold">
            {t("examples.title1")}{" "}
            <span className="text-gradient-brand">{t("examples.title2")}</span>
          </h2>
          <p className="text-muted-foreground mt-4 text-base md:text-lg leading-relaxed">
            {t("examples.sub")}
          </p>
        </Reveal>

        <div className="mt-10 md:mt-14 grid gap-4 md:grid-cols-3 md:gap-6">
          {rows.map((r, i) => (
            <motion.div
              key={r.msg}
              initial={{ opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-10% 0px" }}
              transition={{ duration: 0.5, delay: i * 0.1, ease: [0.22, 1, 0.36, 1] }}
              className="rounded-3xl border border-border bg-card p-5 sm:p-6 transition-all duration-300 hover:-translate-y-1 hover:border-primary/40"
            >
              {/* mensagem do usuário */}
              <div className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary/85 px-3.5 py-2.5 text-sm text-primary-foreground">
                  {r.msg}
                  <span className="mt-1 flex items-center justify-end gap-1 text-[10px] opacity-80">
                    {r.time} <CheckCheck className="h-3 w-3" strokeWidth={2} />
                  </span>
                </div>
              </div>

              <div className="my-3 grid place-items-center">
                <motion.span
                  animate={{ y: [0, 4, 0] }}
                  transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
                  className="grid h-7 w-7 place-items-center rounded-full border border-border bg-secondary"
                >
                  <ArrowDown className="h-3.5 w-3.5 text-primary" strokeWidth={2} />
                </motion.span>
              </div>

              {/* resposta do Abio */}
              <div className="flex justify-start">
                <div className="max-w-[90%] rounded-2xl rounded-bl-sm bg-secondary px-3.5 py-2.5 text-sm">
                  <span className="mr-1.5">{r.emoji}</span>
                  {r.res}
                  <span className="mt-1 block text-[10px] text-muted-foreground">{r.time}</span>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
