import { motion } from "framer-motion";
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarClock,
  CreditCard,
  FileBarChart,
  Layers,
  TrendingUp,
} from "lucide-react";
import { Counter, Reveal, StaggerGroup, StaggerItem } from "./Reveal";

const cats = [
  { name: "Alimentação", value: 38, color: "oklch(0.79 0.24 145)" },
  { name: "Transporte", value: 22, color: "oklch(0.541 0.246 293)" },
  { name: "Moradia", value: 18, color: "oklch(0.75 0.18 200)" },
  { name: "Saúde", value: 12, color: "oklch(0.78 0.18 25)" },
  { name: "Lazer", value: 10, color: "oklch(0.82 0.18 80)" },
];

const bars = [40, 65, 48, 72, 58, 84, 70, 92, 76, 88, 64, 95];

export function DashboardShowcase() {
  return (
    <section id="dashboard" className="relative px-5 sm:px-6 py-20 md:py-28 scroll-mt-20">
      <div className="mx-auto max-w-7xl">
        <Reveal className="max-w-2xl">
          <span className="text-[11px] uppercase tracking-[0.24em] text-neon">Dashboard</span>
          <h2 className="font-display text-3xl sm:text-4xl md:text-5xl mt-3 leading-tight">
            Bonito. Direto. <span className="text-gradient-brand">Seu.</span>
          </h2>
          <p className="text-muted-foreground mt-3 text-base md:text-lg">
            Receitas, gastos, parcelamentos, cartões, relatórios e indicadores — tudo alimentado pelas
            suas mensagens no WhatsApp.
          </p>
        </Reveal>

        <Reveal dir="zoom" delay={0.1} className="mt-10 md:mt-14">
          <div className="relative rounded-2xl border border-border bg-card shadow-card overflow-hidden">

            <div className="flex items-center gap-2 px-4 sm:px-6 py-3 border-b border-border bg-background/40">
              <span className="h-2.5 w-2.5 rounded-full bg-destructive/80" />
              <span className="h-2.5 w-2.5 rounded-full bg-[oklch(0.82_0.18_80)]" />
              <span className="h-2.5 w-2.5 rounded-full bg-neon" />
              <span className="ml-2 text-xs text-muted-foreground truncate">app.Abio · central financeira</span>
            </div>

            <div className="relative p-4 sm:p-6 grid gap-4 lg:grid-cols-3">
              {/* Saldo */}
              <div className="lg:col-span-2 rounded-2xl p-5 bg-secondary border border-border relative overflow-hidden">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Saldo total</p>
                <p className="font-display text-3xl sm:text-4xl mt-1 text-neon tabular-nums">
                  <Counter to={8742.3} prefix="R$ " decimals={2} />
                </p>
                <p className="text-sm text-muted-foreground mt-2">
                  Você economizou <span className="text-neon font-medium">R$ 420</span> esta semana ✨
                </p>
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-1 gap-4">
                <div className="rounded-2xl p-4 border border-border bg-background/40">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <ArrowUpRight className="h-4 w-4 text-neon shrink-0" /> Receitas
                  </div>
                  <p className="font-display text-xl sm:text-2xl mt-1 tabular-nums">
                    <Counter to={12400} prefix="R$ " />
                  </p>
                </div>
                <div className="rounded-2xl p-4 border border-border bg-background/40">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <ArrowDownRight className="h-4 w-4 text-primary shrink-0" /> Despesas
                  </div>
                  <p className="font-display text-xl sm:text-2xl mt-1 tabular-nums">
                    <Counter to={3657} prefix="R$ " />
                  </p>
                </div>
              </div>

              {/* Chart */}
              <div className="lg:col-span-2 rounded-2xl p-5 border border-border bg-background/40">
                <div className="flex items-center justify-between gap-3 mb-5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">Evolução mensal</p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                      <TrendingUp className="h-3 w-3 text-neon shrink-0" /> Histórico completo
                    </p>
                  </div>
                  <span className="shrink-0 text-[11px] rounded-full border border-border px-2.5 py-1 text-muted-foreground">
                    12 meses
                  </span>
                </div>
                <div className="flex items-end gap-1.5 sm:gap-2 h-28 sm:h-36">
                  {bars.map((b, i) => (
                    <motion.span
                      key={i}
                      initial={{ height: 0 }}
                      whileInView={{ height: `${b}%` }}
                      viewport={{ once: true, margin: "-10% 0px" }}
                      transition={{ duration: 0.8, delay: i * 0.05, ease: [0.22, 1, 0.36, 1] }}
                      className="flex-1 rounded-t-md bg-gradient-to-t from-primary/40 to-neon/80"
                    />
                  ))}
                </div>
              </div>

              {/* Categorias */}
              <div className="rounded-2xl p-5 border border-border bg-background/40">
                <p className="text-sm font-medium">Por categoria</p>
                <div className="mt-4 space-y-3">
                  {cats.map((c, i) => (
                    <div key={c.name}>
                      <div className="flex items-center justify-between text-xs mb-1.5">
                        <span className="truncate">{c.name}</span>
                        <span className="text-muted-foreground shrink-0 ml-2 tabular-nums">{c.value}%</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          whileInView={{ width: `${c.value}%` }}
                          viewport={{ once: true }}
                          transition={{ duration: 0.9, delay: 0.1 + i * 0.08, ease: [0.22, 1, 0.36, 1] }}
                          className="h-full rounded-full"
                          style={{ background: c.color }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </Reveal>

        <StaggerGroup className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: CreditCard, title: "Cartões", desc: "Faturas e limites acompanhados de perto." },
            { icon: Layers, title: "Parcelamentos", desc: "Cada parcela mapeada mês a mês." },
            { icon: FileBarChart, title: "Relatórios", desc: "Fechamentos semanais e mensais prontos." },
            { icon: CalendarClock, title: "Lembretes", desc: "Contas fixas avisadas antes de vencer." },
          ].map(({ icon: Icon, title, desc }) => (
            <StaggerItem key={title}>
              <div className="h-full rounded-2xl border border-border bg-card/50 backdrop-blur-xl p-5 transition-colors hover:-translate-y-1 hover:border-primary/50">
                <Icon className="h-5 w-5 text-neon" />
                <h3 className="font-display text-base mt-3">{title}</h3>
                <p className="text-sm text-muted-foreground mt-1">{desc}</p>
              </div>
            </StaggerItem>
          ))}
        </StaggerGroup>
      </div>
    </section>
  );
}
