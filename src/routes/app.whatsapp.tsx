import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { MessageCircle, Mic, Image as ImageIcon, Search, Bot } from "lucide-react";
import { listMyWhatsappMessages } from "@/lib/brinzap.functions";

export const Route = createFileRoute("/app/whatsapp")({
  head: () => ({ meta: [{ title: "WhatsApp · Abio" }] }),
  component: Page,
});

type Filter = "today" | "7d" | "30d" | "all";

function fmtDate(d: Date) {
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}
function fmtTime(d: Date) {
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
function typeLabel(media: string) {
  if (media === "audio") return "Áudio";
  if (media === "image") return "Imagem";
  return "Texto";
}

function Page() {
  const fetchMsgs = useServerFn(listMyWhatsappMessages);
  const { data: messages = [], isLoading } = useQuery({
    queryKey: ["wa-msgs"],
    queryFn: () => fetchMsgs() as any,
    refetchInterval: 8000,
  });
  const [filter, setFilter] = useState<Filter>("7d");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const now = Date.now();
    const cutoff = filter === "today" ? now - 86400000 : filter === "7d" ? now - 7 * 86400000 : filter === "30d" ? now - 30 * 86400000 : 0;
    const s = search.trim().toLowerCase();
    return (messages as any[])
      .filter((m) => {
        if (cutoff && new Date(m.created_at).getTime() < cutoff) return false;
        if (s) {
          const txt = ((m.transcription ?? m.content ?? "") + " " + (m.ai_intent ?? "")).toLowerCase();
          if (!txt.includes(s)) return false;
        }
        return true;
      })
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }, [messages, filter, search]);

  // Group by day
  const groups = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const m of filtered) {
      const d = new Date(m.created_at);
      const key = d.toDateString();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(m);
    }
    return Array.from(map.entries()).map(([k, items]) => ({ key: k, date: new Date(k), items }));
  }, [filtered]);

  return (
    <div className="space-y-6 max-w-3xl mx-auto animate-fade-in">
      <header className="flex items-center gap-4">
        <div className="h-14 w-14 grid place-items-center rounded-2xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 glow-neon">
          <MessageCircle className="h-6 w-6" />
        </div>
        <div>
          <h1 className="font-display text-3xl">Histórico de Conversas</h1>
          <p className="text-sm text-muted-foreground">Suas mensagens trocadas com o Abio pelo WhatsApp.</p>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        {([["today", "Hoje"], ["7d", "7 dias"], ["30d", "30 dias"], ["all", "Todos"]] as const).map(([k, l]) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={[
              "px-3 py-2 rounded-xl text-sm border transition-smooth",
              filter === k
                ? "border-primary/40 bg-gradient-brand-soft text-foreground"
                : "border-border bg-background/40 text-muted-foreground hover:text-foreground hover:border-primary/30",
            ].join(" ")}
          >
            {l}
          </button>
        ))}
        <div className="flex-1 min-w-[180px] relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Pesquisar mensagens..."
            className="w-full bg-input rounded-xl pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
      </div>

      <div className="rounded-3xl border border-border bg-card/60 backdrop-blur-xl p-5 min-h-[400px]">
        {isLoading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-16 rounded-2xl border border-border bg-background/30 animate-pulse" />
            ))}
          </div>
        ) : groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center py-16">
            <div className="h-16 w-16 rounded-2xl bg-emerald-500/10 text-emerald-300 grid place-items-center mb-4">
              <MessageCircle className="h-7 w-7" />
            </div>
            <p className="font-display text-lg">Nenhuma conversa ainda</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-xs">
              Envie uma mensagem para o Abio pelo WhatsApp para começar.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {groups.map((g) => (
              <div key={g.key}>
                <div className="flex items-center justify-center mb-3">
                  <span className="text-[11px] uppercase tracking-wider text-muted-foreground bg-background/60 border border-border px-3 py-1 rounded-full">
                    {fmtDate(g.date)}
                  </span>
                </div>
                <div className="space-y-2">
                  {g.items.map((m: any) => {
                    const isIn = m.direction === "in";
                    const isAI = m.ai_intent && m.direction === "out";
                    const Icon = m.media_type === "audio" ? Mic : m.media_type === "image" ? ImageIcon : isAI ? Bot : MessageCircle;
                    const time = new Date(m.created_at);
                    return (
                      <motion.div
                        key={m.id}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={["flex", isIn ? "justify-start" : "justify-end"].join(" ")}
                      >
                        <div
                          className={[
                            "max-w-[78%] rounded-2xl border px-4 py-2.5 text-sm shadow-sm transition-smooth",
                            isIn
                              ? "border-border bg-background/60 rounded-bl-sm"
                              : "border-emerald-500/30 bg-emerald-500/10 text-foreground rounded-br-sm",
                          ].join(" ")}
                        >
                          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-1">
                            <Icon className="h-3 w-3" />
                            <span>{typeLabel(m.media_type ?? "text")}</span>
                          </div>
                          <p className="whitespace-pre-wrap leading-relaxed">
                            {m.transcription ?? m.content ?? <i className="text-muted-foreground">(sem conteúdo)</i>}
                          </p>
                          <p className="text-[10px] text-muted-foreground text-right mt-1">{fmtTime(time)}</p>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
