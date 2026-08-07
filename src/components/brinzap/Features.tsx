import { Brain, MessageSquareText, BellRing, Mic2, Calendar, ShieldCheck } from "lucide-react";

const items = [
  { icon: MessageSquareText, title: "Tudo pelo WhatsApp", desc: "Sem app extra. Mande texto ou áudio e pronto — está registrado." },
  { icon: Brain, title: "IA que entende você", desc: "Classifica categoria, valor e data automaticamente. Aprende seus padrões." },
  { icon: Mic2, title: "Áudio com transcrição", desc: "Mandou áudio? A gente transcreve, interpreta e responde em segundos." },
  { icon: Calendar, title: "Compromissos no jeito", desc: "“Consulta amanhã às 14h” vira evento na sua agenda automaticamente." },
  { icon: BellRing, title: "Alertas inteligentes", desc: "“Você está gastando 15% a mais que semana passada.” Avisamos antes." },
  { icon: ShieldCheck, title: "Criptografado", desc: "Seus dados ficam protegidos. Você manda, a gente cuida." },
];

export function Features() {
  return (
    <section id="como-funciona" className="relative py-24 px-6">
      <div className="mx-auto max-w-7xl">
        <div className="max-w-2xl mb-14">
          <span className="text-xs uppercase tracking-[0.2em] text-primary">Inteligência</span>
          <h2 className="font-display text-4xl md:text-5xl mt-3">
            Você fala. O Abio <span className="text-gradient-brand">organiza.</span>
          </h2>
          <p className="text-muted-foreground mt-3">
            Esqueça planilhas e formulários. Aqui o controle financeiro acontece na sua conversa do dia a dia.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map(({ icon: Icon, title, desc }) => (
            <div
              key={title}
              className="group rounded-2xl p-6 border border-border bg-card/50 backdrop-blur-md hover:border-primary/40 hover:-translate-y-0.5 transition-smooth"
            >
              <div className="h-11 w-11 rounded-xl bg-gradient-brand-soft border border-border grid place-items-center group-hover:glow-neon transition-smooth">
                <Icon className="h-5 w-5 text-primary" />
              </div>
              <h3 className="font-display text-xl mt-4">{title}</h3>
              <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
