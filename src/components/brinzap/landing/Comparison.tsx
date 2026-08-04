import { Check, Minus, X } from "lucide-react";
import { Reveal } from "./Reveal";

type Row = { label: string; abio: boolean | "partial"; planilha: boolean | "partial"; apps: boolean | "partial" };

const rows: Row[] = [
  { label: "Registrar em 5 segundos", abio: true, planilha: false, apps: "partial" },
  { label: "Funciona no WhatsApp", abio: true, planilha: false, apps: false },
  { label: "Entende áudio e imagem", abio: true, planilha: false, apps: false },
  { label: "Lê PDF e comprovantes", abio: true, planilha: false, apps: "partial" },
  { label: "Categoriza sozinho com IA", abio: true, planilha: false, apps: "partial" },
  { label: "Lembretes automáticos", abio: true, planilha: false, apps: true },
  { label: "Zero configuração inicial", abio: true, planilha: false, apps: false },
  { label: "Relatório semanal pronto", abio: true, planilha: false, apps: "partial" },
];

function Cell({ v, strong }: { v: boolean | "partial"; strong?: boolean }) {
  if (v === "partial")
    return <Minus className="h-4 w-4 mx-auto text-muted-foreground" aria-label="Parcial" />;
  return v ? (
    <Check className={`h-4.5 w-4.5 mx-auto ${strong ? "text-neon" : "text-foreground/70"}`} aria-label="Sim" />
  ) : (
    <X className="h-4 w-4 mx-auto text-muted-foreground/60" aria-label="Não" />
  );
}

export function Comparison() {
  return (
    <section id="comparacao" className="relative px-5 sm:px-6 py-20 md:py-28">
      <div className="mx-auto max-w-5xl">
        <Reveal className="text-center max-w-2xl mx-auto">
          <span className="text-[11px] uppercase tracking-[0.24em] text-neon">Comparação</span>
          <h2 className="font-display text-3xl sm:text-4xl md:text-5xl mt-3 leading-tight">
            Shark Money <span className="text-muted-foreground text-2xl md:text-3xl align-middle">vs</span>{" "}
            <span className="text-gradient-brand">o resto.</span>
          </h2>
          <p className="text-muted-foreground mt-3 text-base md:text-lg">
            Planilhas dão trabalho. Apps tradicionais exigem disciplina. O Shark Money só pede uma mensagem.
          </p>
        </Reveal>

        <Reveal dir="zoom" delay={0.1} className="mt-10 md:mt-14">
          <div className="overflow-hidden rounded-3xl border border-border bg-card/50 backdrop-blur-xl shadow-card">
            <div className="grid grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))] items-center gap-2 px-3 sm:px-5 py-4 border-b border-border bg-background/40 text-[11px] sm:text-xs">
              <span className="text-muted-foreground">Recurso</span>
              <span className="text-center font-display text-sm sm:text-base text-neon">Shark Money</span>
              <span className="text-center text-muted-foreground">Planilhas</span>
              <span className="text-center text-muted-foreground">Apps</span>
            </div>

            {rows.map((r, i) => (
              <div
                key={r.label}
                className={`grid grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))] items-center gap-2 px-3 sm:px-5 py-3.5 text-xs sm:text-sm ${
                  i % 2 ? "bg-background/20" : ""
                }`}
              >
                <span className="min-w-0 pr-2">{r.label}</span>
                <span className="rounded-lg bg-neon/5 py-1">
                  <Cell v={r.abio} strong />
                </span>
                <Cell v={r.planilha} />
                <Cell v={r.apps} />
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
