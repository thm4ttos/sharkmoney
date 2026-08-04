const faqs = [
  { q: "Preciso baixar algum app?", a: "Não. O Shark Money funciona dentro do WhatsApp. O dashboard web é só o complemento visual." },
  { q: "Como funciona o teste grátis?", a: "Você tem 7 dias com tudo liberado, sem cartão. Depois escolhe o plano que quiser." },
  { q: "Posso enviar áudio?", a: "Sim. A IA transcreve e interpreta áudios em português automaticamente." },
  { q: "Meus dados estão seguros?", a: "Sim. Tudo criptografado em trânsito e em repouso. Você é o dono dos seus dados." },
  { q: "Funciona pra casal?", a: "Sim, temos planos para 2 pessoas com carteira e metas compartilhadas." },
];

export function FAQ() {
  return (
    <section id="faq" className="py-24 px-6">
      <div className="mx-auto max-w-3xl">
        <h2 className="font-display text-4xl md:text-5xl text-center">Perguntas <span className="text-gradient-brand">frequentes</span></h2>
        <div className="mt-10 space-y-3">
          {faqs.map((f) => (
            <details
              key={f.q}
              className="group rounded-2xl border border-border bg-card/60 backdrop-blur p-5 open:bg-card/80 transition-smooth"
            >
              <summary className="cursor-pointer list-none flex items-center justify-between font-medium">
                {f.q}
                <span className="text-primary group-open:rotate-45 transition-smooth text-xl leading-none">+</span>
              </summary>
              <p className="mt-3 text-sm text-muted-foreground leading-relaxed">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
