import { Quote, Star } from "lucide-react";
import { Counter, Reveal, StaggerGroup, StaggerItem } from "./Reveal";

const testimonials = [
  {
    name: "Marina Alves",
    role: "Designer · São Paulo",
    initials: "MA",
    text: "Eu odiava planilha e nunca durava mais de duas semanas. Com o Shark Money eu só mando uma mensagem e acabou. Faz 5 meses que não perco um gasto.",
  },
  {
    name: "Rafael Nunes",
    role: "Autônomo · Curitiba",
    initials: "RN",
    text: "Mando foto do comprovante e ele já registra tudo certinho. O relatório de domingo virou meu momento favorito da semana.",
  },
  {
    name: "Camila e Pedro",
    role: "Plano casal · Recife",
    initials: "CP",
    text: "A gente brigava por causa de dinheiro. Hoje os dois lançam pelo WhatsApp e vemos o mesmo painel. Mudou nossa organização.",
  },
  {
    name: "Thiago Prado",
    role: "Dev · Belo Horizonte",
    initials: "TP",
    text: "Testei uns seis apps. Nenhum tinha a leitura de PDF e áudio que o Shark Money tem. A IA acerta a categoria quase sempre.",
  },
  {
    name: "Juliana Rocha",
    role: "Enfermeira · Salvador",
    initials: "JR",
    text: "Os lembretes das contas fixas me salvaram de duas multas só no primeiro mês. Vale cada centavo.",
  },
  {
    name: "Eduardo Lima",
    role: "Empreendedor · Porto Alegre",
    initials: "EL",
    text: "Em 30 segundos eu estava usando. Sem cadastro chato, sem configurar categoria. É o financeiro mais rápido que já usei.",
  },
];

export function SocialProof() {
  return (
    <section id="depoimentos" className="relative px-5 sm:px-6 py-20 md:py-28">
      <div className="mx-auto max-w-7xl">
        <Reveal className="text-center max-w-2xl mx-auto">
          <span className="text-[11px] uppercase tracking-[0.24em] text-neon">Prova social</span>
          <h2 className="font-display text-3xl sm:text-4xl md:text-5xl mt-3 leading-tight">
            Gente que parou de <span className="text-gradient-brand">se perder no dinheiro.</span>
          </h2>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-8 gap-y-4">
            <div>
              <p className="font-display text-2xl tabular-nums">
                <Counter to={4.9} decimals={1} />
              </p>
              <div className="flex gap-0.5 mt-1 justify-center">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} className="h-3.5 w-3.5 fill-neon text-neon" />
                ))}
              </div>
            </div>
            <div className="text-left">
              <p className="font-display text-2xl tabular-nums">
                <Counter to={12000} suffix="+" />
              </p>
              <p className="text-xs text-muted-foreground mt-1">mensagens processadas por dia</p>
            </div>
            <div className="text-left">
              <p className="font-display text-2xl tabular-nums">
                <Counter to={92} suffix="%" />
              </p>
              <p className="text-xs text-muted-foreground mt-1">seguem ativos após 3 meses</p>
            </div>
          </div>
        </Reveal>

        <StaggerGroup className="mt-10 md:mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {testimonials.map((t) => (
            <StaggerItem key={t.name}>
              <figure className="relative h-full rounded-3xl border border-border bg-card/50 backdrop-blur-xl p-6 transition-colors hover:-translate-y-1 hover:border-primary/50">
                <Quote className="h-6 w-6 text-primary/60" />
                <blockquote className="text-sm leading-relaxed text-foreground/90 mt-3">“{t.text}”</blockquote>
                <figcaption className="mt-5 flex items-center gap-3">
                  <span className="h-10 w-10 shrink-0 rounded-full bg-primary grid place-items-center text-primary-foreground text-xs font-bold">
                    {t.initials}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium truncate">{t.name}</span>
                    <span className="block text-xs text-muted-foreground truncate">{t.role}</span>
                  </span>
                </figcaption>
              </figure>
            </StaggerItem>
          ))}
        </StaggerGroup>
      </div>
    </section>
  );
}
