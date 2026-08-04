import { type LucideIcon, Sparkles, MessageCircle } from "lucide-react";

export function StubPage({ title, description, Icon }: { title: string; description: string; Icon: LucideIcon }) {
  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <header className="flex items-center gap-4">
        <div className="h-14 w-14 grid place-items-center rounded-2xl border border-border bg-card/60">
          <Icon className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="font-display text-3xl">{title}</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </header>

      <section className="rounded-3xl border border-border bg-card/60 backdrop-blur-xl p-8 text-center">
        <div className="mx-auto h-14 w-14 rounded-2xl bg-gradient-brand-soft border border-primary/30 grid place-items-center">
          <Sparkles className="h-6 w-6 text-primary" />
        </div>
        <h2 className="font-display text-xl mt-4">Em breve neste dashboard</h2>
        <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
          Esta seção será ativada ao conectar a Lovable Cloud. Por enquanto, você pode lançar tudo direto pelo WhatsApp e visualizar nas demais telas.
        </p>
        <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 text-primary text-xs px-3 py-1.5">
          <MessageCircle className="h-3.5 w-3.5" /> Tudo controlado pelo WhatsApp
        </div>
      </section>
    </div>
  );
}
