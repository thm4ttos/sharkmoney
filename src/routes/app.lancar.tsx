import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { categoryGroups, formatBRL } from "@/lib/user-mock";
import { quickAddNlp } from "@/lib/brinzap.functions";
import { Zap, MessageCircle, ArrowRight, Mic } from "lucide-react";

export const Route = createFileRoute("/app/lancar")({
  component: QuickAdd,
});

function QuickAdd() {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState<null | { kind: string; cat?: string; amount?: number; title?: string }>(null);
  const [err, setErr] = useState("");
  const fn = useServerFn(quickAddNlp);

  const submit = async () => {
    if (!text.trim()) return;
    setLoading(true); setErr(""); setDone(null);
    try {
      const r = await fn({ data: { text } });
      const ai = r.ai as any;
      setDone({
        kind: r.type,
        cat: ai?.category,
        amount: ai?.amount,
        title: ai?.appointment_title ?? ai?.description ?? text,
      });
      setText("");
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao processar");
    } finally {
      setLoading(false);
    }
  };


  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <header className="flex items-center gap-4">
        <div className="h-14 w-14 grid place-items-center rounded-2xl border border-primary/30 bg-primary/10 text-primary">
          <Zap className="h-6 w-6" />
        </div>
        <div>
          <h1 className="font-display text-3xl">Lançar Rápido</h1>
          <p className="text-sm text-muted-foreground">Escreva como você fala. A IA entende e classifica.</p>
        </div>
      </header>

      <section className="rounded-3xl border border-border bg-card/60 backdrop-blur-xl p-5">
        <label className="text-xs text-muted-foreground">Conta o que aconteceu</label>
        <div className="mt-2 flex gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder='Ex.: "Gastei 50 no mercado"  ·  "Recebi 2000 de freela"  ·  "Consulta amanhã às 14h"'
            className="flex-1 bg-input rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
          />
          <button onClick={submit} disabled={loading} className="rounded-xl bg-gradient-brand text-primary-foreground px-5 glow-neon hover:scale-[1.02] transition-smooth disabled:opacity-60">
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
        {err && <p className="text-xs text-destructive mt-2">{err}</p>}

        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {["Gastei 50 no mercado", "Recebi 2000", "Uber 28 reais", "Consulta amanhã às 14h"].map(s => (
            <button key={s} onClick={() => setText(s)} className="rounded-full border border-border bg-background/40 px-3 py-1 hover:border-primary/40">{s}</button>
          ))}
        </div>
      </section>

      {done && (
        <section className="rounded-3xl border border-primary/30 bg-primary/10 p-5">
          <div className="flex items-center gap-2 text-primary text-xs font-medium">
            <MessageCircle className="h-4 w-4" /> Registrado pela IA
          </div>
          <p className="mt-2">
            {done.kind === "transaction" && <>Registrado: <b>{done.amount ? formatBRL(done.amount) : "—"}</b> em <b>{done.cat ?? "Outros"}</b> ✅</>}
            {done.kind === "appointment" && <>Compromisso criado: <b>{done.title}</b> 📅</>}
            {done.kind === "unknown" && <>Não consegui entender. Tente reformular 🙂</>}
          </p>
        </section>
      )}

      <section className="rounded-3xl border border-border bg-card/60 backdrop-blur-xl p-5">
        <div className="flex items-center gap-2 text-primary">
          <Mic className="h-4 w-4" /> <h2 className="font-display text-lg">Também aceita áudio</h2>
        </div>
        <p className="text-sm text-muted-foreground mt-1">Mande um áudio no WhatsApp do Shark Money. A IA transcreve e classifica automaticamente.</p>
      </section>

      <section className="rounded-3xl border border-border bg-card/60 backdrop-blur-xl p-5">
        <h2 className="font-display text-lg">Categorias automáticas</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
          {categoryGroups.slice(0, 8).map(g => {
            const Icon = g.icon;
            return (
              <div key={g.key} className="rounded-2xl border border-border bg-background/40 p-3 text-sm">
                <Icon className={`h-4 w-4 ${g.color}`} /> <span className="mt-2 block">{g.name}</span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
