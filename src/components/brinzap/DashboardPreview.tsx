import { ArrowDownRight, ArrowUpRight, TrendingUp, Utensils, Car, Home, Heart, Sparkles, Calendar } from "lucide-react";

const cats = [
  { name: "Alimentação", value: 38, color: "oklch(0.723 0.192 149.6)", icon: Utensils },
  { name: "Transporte", value: 22, color: "oklch(0.544 0.252 262.5)", icon: Car },
  { name: "Moradia", value: 18, color: "oklch(0.75 0.18 200)", icon: Home },
  { name: "Saúde", value: 12, color: "oklch(0.78 0.18 25)", icon: Heart },
  { name: "Lazer", value: 10, color: "oklch(0.82 0.18 80)", icon: Sparkles },
];

const bars = [40, 65, 48, 72, 58, 84, 70, 92, 76, 88, 64, 95];

export function DashboardPreview() {
  return (
    <div className="relative rounded-3xl border border-border bg-card/70 backdrop-blur-xl shadow-card overflow-hidden">
      {/* top bar */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-background/40">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="h-2.5 w-2.5 rounded-full bg-destructive/80" />
          <span className="h-2.5 w-2.5 rounded-full bg-[oklch(0.82_0.18_80)]" />
          <span className="h-2.5 w-2.5 rounded-full bg-primary" />
          <span className="ml-3">app.sharkmoney.com / dashboard</span>
        </div>
        <span className="text-xs text-muted-foreground">Novembro · 2026</span>
      </div>

      <div className="grid lg:grid-cols-3 gap-5 p-6">
        {/* Saldo */}
        <div className="lg:col-span-2 rounded-2xl p-5 bg-gradient-brand-soft border border-border relative overflow-hidden">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Saldo total</p>
          <p className="font-display text-4xl mt-1 text-gradient-brand">R$ 8.742,30</p>
          <p className="text-sm text-muted-foreground mt-2">Você economizou <span className="text-primary font-medium">R$ 420</span> esta semana ✨</p>
          <div className="absolute -right-10 -bottom-10 h-40 w-40 rounded-full bg-primary/20 blur-3xl" />
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl p-4 border border-border bg-background/40">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <ArrowUpRight className="h-4 w-4 text-primary" /> Receitas
            </div>
            <p className="font-display text-2xl mt-1">R$ 12.400</p>
          </div>
          <div className="rounded-2xl p-4 border border-border bg-background/40">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <ArrowDownRight className="h-4 w-4 text-accent" /> Despesas
            </div>
            <p className="font-display text-2xl mt-1">R$ 3.657</p>
          </div>
        </div>

        {/* Chart */}
        <div className="lg:col-span-2 rounded-2xl p-5 border border-border bg-background/40">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-sm font-medium">Evolução mensal</p>
              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                <TrendingUp className="h-3 w-3 text-primary" /> Histórico completo
              </p>
            </div>
            <div className="flex gap-1 text-[11px]">
              <span className="px-2 py-1 rounded-full bg-primary/15 text-primary">Receita</span>
              <span className="px-2 py-1 rounded-full bg-accent/20 text-accent-foreground">Despesa</span>
            </div>
          </div>
          <div className="flex items-end gap-2 h-36">
            {bars.map((h, i) => (
              <div key={i} className="flex-1 flex flex-col gap-1 justify-end">
                <div className="rounded-md bg-gradient-to-t from-accent/40 to-accent/70" style={{ height: `${h * 0.45}%` }} />
                <div className="rounded-md bg-gradient-to-t from-primary/40 to-primary" style={{ height: `${h * 0.55}%` }} />
              </div>
            ))}
          </div>
        </div>

        {/* Categorias */}
        <div className="rounded-2xl p-5 border border-border bg-background/40">
          <p className="text-sm font-medium mb-4">Por categoria</p>
          <div className="space-y-3">
            {cats.map((c) => {
              const Icon = c.icon;
              return (
                <div key={c.name}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="flex items-center gap-2">
                      <span className="h-6 w-6 rounded-md grid place-items-center" style={{ background: `${c.color}` + "33" }}>
                        <Icon className="h-3.5 w-3.5" style={{ color: c.color }} />
                      </span>
                      {c.name}
                    </span>
                    <span className="text-muted-foreground">{c.value}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${c.value}%`, background: c.color }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Compromissos */}
        <div className="lg:col-span-3 rounded-2xl p-5 border border-border bg-background/40">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-medium flex items-center gap-2"><Calendar className="h-4 w-4 text-primary" /> Próximos compromissos</p>
            <span className="text-xs text-muted-foreground">criados via WhatsApp</span>
          </div>
          <div className="grid sm:grid-cols-3 gap-3">
            {[
              { d: "Amanhã · 14:00", t: "Consulta médica", c: "Saúde" },
              { d: "Sex · 19:30", t: "Jantar com Marina", c: "Lazer" },
              { d: "Seg · 09:00", t: "Pagar aluguel", c: "Moradia" },
            ].map((e) => (
              <div key={e.t} className="rounded-xl p-3 border border-border bg-card/60 hover:border-primary/40 transition-smooth">
                <p className="text-[11px] text-primary">{e.d}</p>
                <p className="text-sm font-medium mt-1">{e.t}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{e.c}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
