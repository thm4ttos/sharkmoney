import { useEffect, useState } from "react";
import { Check, CheckCheck, Mic } from "lucide-react";

type Msg = {
  from: "user" | "bot";
  text: string;
  time: string;
  audio?: boolean;
};

const SCRIPT: Msg[] = [
  { from: "user", text: "Gastei 50 no mercado", time: "09:12" },
  { from: "bot", text: "Registrado: R$ 50,00 em Alimentação ✅", time: "09:12" },
  { from: "user", text: "Recebi 2000 de freela", time: "10:03" },
  { from: "bot", text: "Receita de R$ 2.000,00 registrada em Freelance 💸", time: "10:03" },
  { from: "user", text: "🎙️ Áudio (00:06)", time: "14:48", audio: true },
  { from: "bot", text: "Compromisso criado: Consulta amanhã às 14h 📅", time: "14:48" },
];

export function WhatsAppChat() {
  const [shown, setShown] = useState(1);
  useEffect(() => {
    if (shown >= SCRIPT.length) return;
    const t = setTimeout(() => setShown((s) => s + 1), 1100);
    return () => clearTimeout(t);
  }, [shown]);

  return (
    <div className="relative mx-auto w-full max-w-sm">
      {/* phone frame */}
      <div className="rounded-[2.2rem] border border-border bg-card/80 backdrop-blur-xl shadow-card overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 bg-[oklch(0.22_0.08_295)] border-b border-border">
          <div className="h-9 w-9 rounded-full bg-gradient-brand grid place-items-center text-primary-foreground font-bold">B</div>
          <div className="flex-1">
            <p className="text-sm font-medium">Shark Money</p>
            <p className="text-[11px] text-primary">online · respondendo</p>
          </div>
          <span className="h-2 w-2 rounded-full bg-primary animate-pulse-glow" />
        </div>

        <div className="px-3 py-4 space-y-2 min-h-[420px] bg-[radial-gradient(circle_at_top,_oklch(0.24_0.1_295)_0%,_oklch(0.18_0.08_295)_100%)]">
          {SCRIPT.slice(0, shown).map((m, i) => (
            <div
              key={i}
              className={`flex animate-fade-up ${m.from === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={[
                  "max-w-[78%] rounded-2xl px-3 py-2 text-sm shadow-sm",
                  m.from === "user"
                    ? "bg-[oklch(0.32_0.18_138_/_0.85)] text-foreground rounded-br-sm"
                    : "bg-[oklch(0.28_0.14_305_/_0.7)] text-foreground rounded-bl-sm",
                ].join(" ")}
              >
                {m.audio ? (
                  <span className="flex items-center gap-2">
                    <Mic className="h-4 w-4 text-primary" />
                    <span className="h-1.5 w-32 rounded-full bg-foreground/20 relative overflow-hidden">
                      <span className="absolute inset-y-0 left-0 w-2/3 bg-primary rounded-full" />
                    </span>
                    <span className="text-xs text-muted-foreground">0:06</span>
                  </span>
                ) : (
                  m.text
                )}
                <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-muted-foreground">
                  {m.time}
                  {m.from === "user" && <CheckCheck className="h-3 w-3 text-primary" />}
                  {m.from === "bot" && <Check className="h-3 w-3" />}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="px-3 py-2 border-t border-border bg-[oklch(0.22_0.08_295)] flex items-center gap-2">
          <div className="flex-1 h-9 rounded-full bg-input px-3 text-xs text-muted-foreground grid items-center">
            Digite ou envie um áudio…
          </div>
          <button className="h-9 w-9 rounded-full bg-gradient-brand grid place-items-center text-primary-foreground glow-neon">
            <Mic className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* floating tag */}
      <div className="absolute -left-6 top-10 hidden md:flex items-center gap-2 rounded-full border border-border bg-card/80 backdrop-blur px-3 py-1.5 text-xs animate-float">
        <span className="h-1.5 w-1.5 rounded-full bg-primary" /> IA classificou em 0.4s
      </div>
      <div className="absolute -right-4 bottom-16 hidden md:flex items-center gap-2 rounded-full border border-border bg-card/80 backdrop-blur px-3 py-1.5 text-xs animate-float" style={{ animationDelay: "1.2s" }}>
        💙 Categoria: Alimentação
      </div>
    </div>
  );
}
