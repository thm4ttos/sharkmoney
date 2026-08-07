import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Reveal } from "./Reveal";

const faqs = [
  { q: "Preciso baixar algum app?", a: "Não. O Abio funciona dentro do WhatsApp. O painel web é só o complemento visual, e abre direto no navegador." },
  { q: "Como funciona o teste grátis?", a: "Você tem 7 dias com tudo liberado, sem cartão de crédito. Depois é só escolher o plano que fizer sentido pra você." },
  { q: "Posso enviar áudio, foto e PDF?", a: "Sim. A IA transcreve áudios em português, lê fotos de cupons e comprovantes e interpreta PDFs de boletos, faturas e extratos." },
  { q: "E se a IA errar alguma coisa?", a: "É só responder na conversa: “na verdade foi 80” ou “foi ontem”. O Abio corrige o lançamento anterior automaticamente." },
  { q: "Meus dados estão seguros?", a: "Sim. Tudo criptografado em trânsito e em repouso, com acesso restrito à sua conta. Você é o dono dos seus dados e pode exportá-los quando quiser." },
  { q: "Funciona pra casal?", a: "Sim. Nos planos casal, duas pessoas lançam pelo WhatsApp e enxergam a mesma carteira, com metas e relatórios compartilhados." },
  { q: "Posso cancelar quando quiser?", a: "Pode. Sem fidelidade e sem multa. O acesso continua ativo até o fim do período já pago." },
];

export function FAQ() {
  return (
    <section id="faq" className="relative px-5 sm:px-6 py-20 md:py-28">
      <div className="mx-auto max-w-3xl">
        <Reveal className="text-center">
          <span className="text-[11px] uppercase tracking-[0.24em] text-neon">FAQ</span>
          <h2 className="font-display text-3xl sm:text-4xl md:text-5xl mt-3 leading-tight">
            Perguntas <span className="text-gradient-brand">frequentes</span>
          </h2>
        </Reveal>

        <Reveal delay={0.1} className="mt-8 md:mt-12">
          <Accordion type="single" collapsible className="space-y-3">
            {faqs.map((f, i) => (
              <AccordionItem
                key={f.q}
                value={`item-${i}`}
                className="rounded-2xl border border-border bg-card/50 backdrop-blur-xl px-5 data-[state=open]:border-neon/40 transition-colors"
              >
                <AccordionTrigger className="text-left text-sm sm:text-base font-medium hover:no-underline py-5">
                  {f.q}
                </AccordionTrigger>
                <AccordionContent className="text-sm text-muted-foreground leading-relaxed pb-5">
                  {f.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </Reveal>
      </div>
    </section>
  );
}
