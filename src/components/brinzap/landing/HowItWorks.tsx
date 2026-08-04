import { motion } from "framer-motion";
import { BarChart3, Brain, MessageCircle, Tags, Wallet } from "lucide-react";
import { Reveal } from "./Reveal";

const steps = [
  { icon: MessageCircle, title: "Você envia a mensagem", desc: "“Gastei 50 no mercado” — texto, áudio, foto ou PDF." },
  { icon: Brain, title: "A IA interpreta", desc: "Valor, data, tipo e intenção extraídos em menos de 1 segundo." },
  { icon: Tags, title: "Categoria encontrada", desc: "Alimentação, transporte, moradia… classificado sozinho." },
  { icon: BarChart3, title: "Dashboard atualizado", desc: "Gráficos, metas e relatórios recalculados na hora." },
  { icon: Wallet, title: "Saldo atualizado", desc: "Seu saldo real, sempre em dia, sem você mexer em nada." },
];

export function HowItWorks() {
  return (
    <section id="automacao" className="relative px-5 sm:px-6 py-20 md:py-28 scroll-mt-20">
      <div className="mx-auto max-w-7xl">
        <Reveal className="max-w-2xl">
          <span className="text-[11px] uppercase tracking-[0.24em] text-neon">Nos bastidores</span>
          <h2 className="font-display text-3xl sm:text-4xl md:text-5xl mt-4 leading-[1.12] font-semibold">

            Uma mensagem. <span className="text-gradient-brand">Tudo automático.</span>
          </h2>
          <p className="text-muted-foreground mt-3 text-base md:text-lg">
            Do WhatsApp ao seu painel, sem nenhum clique no meio do caminho.
          </p>
        </Reveal>

        <div className="relative mt-12 md:mt-16">
          {/* connecting line */}
          <motion.div
            aria-hidden
            initial={{ scaleY: 0 }}
            whileInView={{ scaleY: 1 }}
            viewport={{ once: true, margin: "-15% 0px" }}
            transition={{ duration: 1.2, ease: "easeOut" }}
            className="absolute left-[27px] top-2 bottom-2 w-px origin-top bg-gradient-to-b from-primary via-neon to-transparent md:hidden"
          />
          <motion.div
            aria-hidden
            initial={{ scaleX: 0 }}
            whileInView={{ scaleX: 1 }}
            viewport={{ once: true, margin: "-15% 0px" }}
            transition={{ duration: 1.2, ease: "easeOut" }}
            className="hidden md:block absolute left-0 right-0 top-7 h-px origin-left bg-gradient-to-r from-primary via-neon to-transparent"
          />

          <div className="grid gap-6 md:grid-cols-5 md:gap-4">
            {steps.map(({ icon: Icon, title, desc }, i) => (
              <motion.div
                key={title}
                initial={{ opacity: 0, y: 26 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-10% 0px" }}
                transition={{ duration: 0.6, delay: i * 0.12, ease: [0.22, 1, 0.36, 1] }}
                className="relative grid grid-cols-[auto_minmax(0,1fr)] md:block gap-4"
              >
                <div className="relative z-10 h-14 w-14 shrink-0 rounded-2xl border border-border bg-card grid place-items-center backdrop-blur-xl shadow-card">
                  <Icon className="h-6 w-6 text-neon" />
                  <span className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-primary text-primary-foreground text-[11px] font-bold grid place-items-center">
                    {i + 1}
                  </span>
                </div>
                <div className="min-w-0 md:mt-5">
                  <h3 className="font-display text-lg leading-snug">{title}</h3>
                  <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{desc}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
