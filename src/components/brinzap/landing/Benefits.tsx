import { Clock, ShieldCheck, Sparkles, Wallet } from "lucide-react";
import { Counter, StaggerGroup, StaggerItem, Reveal } from "./Reveal";

const items = [
  {
    icon: Clock,
    stat: <Counter to={5} suffix="s" />,
    title: "Registro em segundos",
    desc: "Mande uma frase no WhatsApp e pronto. Nada de formulário, planilha ou app pra abrir.",
  },
  {
    icon: Sparkles,
    stat: <Counter to={98} suffix="%" />,
    title: "Precisão da IA",
    desc: "Categoria, valor e data reconhecidos automaticamente — em português, do jeito que você fala.",
  },
  {
    icon: Wallet,
    stat: <Counter to={420} prefix="R$ " />,
    title: "Economia média/mês",
    desc: "Quem enxerga para onde o dinheiro vai gasta menos. O Abio mostra isso todo dia.",
  },
  {
    icon: ShieldCheck,
    stat: <Counter to={100} suffix="%" />,
    title: "Dados protegidos",
    desc: "Criptografia em trânsito e em repouso. Seus dados são seus — sempre.",
  },
];

export function Benefits() {
  return (
    <section id="beneficios" className="relative px-5 sm:px-6 py-20 md:py-28">
      <div className="mx-auto max-w-7xl">
        <Reveal className="max-w-2xl">
          <span className="text-[11px] uppercase tracking-[0.24em] text-neon">Benefícios</span>
          <h2 className="font-display text-3xl sm:text-4xl md:text-5xl mt-3 leading-tight">
            Menos esforço. <span className="text-gradient-brand">Muito mais controle.</span>
          </h2>
          <p className="text-muted-foreground mt-3 text-base md:text-lg">
            O Abio tira o trabalho chato do seu caminho e devolve clareza sobre o seu dinheiro.
          </p>
        </Reveal>

        <StaggerGroup className="mt-10 md:mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {items.map(({ icon: Icon, stat, title, desc }) => (
            <StaggerItem key={title}>
              <div className="h-full rounded-3xl border border-border bg-card/50 backdrop-blur-xl p-6 transition-colors hover:-translate-y-1 hover:border-neon/40 hover:shadow-[0_20px_60px_-30px_oklch(0.79_0.24_145_/_0.7)]">
                <div className="h-11 w-11 rounded-2xl bg-secondary border border-border grid place-items-center">
                  <Icon className="h-5 w-5 text-neon" />
                </div>
                <p className="font-display text-3xl mt-5 tabular-nums">{stat}</p>
                <h3 className="font-display text-lg mt-1">{title}</h3>
                <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{desc}</p>
              </div>
            </StaggerItem>
          ))}
        </StaggerGroup>
      </div>
    </section>
  );
}
