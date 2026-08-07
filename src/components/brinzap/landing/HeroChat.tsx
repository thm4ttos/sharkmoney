import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCheck, FileText, Image as ImageIcon, Mic, Sparkles, Wallet } from "lucide-react";
// Antes apontava pra um asset hospedado no Lovable (/__l5e/assets-v1/...),
// que só existe na infraestrutura deles — 404 em qualquer outro deploy.
const abioLogo = { url: "/favicon.png" };

type UserMsg =
  | { media: "text"; text: string }
  | { media: "audio"; seconds: string; caption?: string }
  | { media: "image"; caption: string }
  | { media: "pdf"; fileName: string };

type Scenario = {
  id: string;
  user: UserMsg;
  thinking: string;
  reply: string[];
  /** delta aplicado ao saldo (negativo = gasto) */
  delta?: number;
};

const SCENARIOS: Scenario[] = [
  {
    id: "text-expense",
    user: { media: "text", text: "Gastei 50 no mercado" },
    thinking: "Abio está analisando...",
    reply: ["✅ Gasto registrado!", "🛒 Mercado", "💰 R$ 50,00", "🏷️ Alimentação"],
    delta: -50,
  },
  {
    id: "image-expense",
    user: { media: "image", caption: "Nota fiscal" },
    thinking: "Lendo a nota fiscal...",
    reply: ["📷 Nota reconhecida!", "🛒 Supermercado", "💰 R$ 186,42", "🏷️ Alimentação"],
    delta: -186.42,
  },
  {
    id: "audio-expense",
    user: { media: "audio", seconds: "0:06" },
    thinking: "Transcrevendo áudio...",
    reply: ["🎙️ Áudio processado!", "⛽ Combustível", "💰 R$ 80,00"],
    delta: -80,
  },
  {
    id: "pdf-expense",
    user: { media: "pdf", fileName: "comprovante-pix.pdf" },
    thinking: "Lendo o comprovante...",
    reply: ["📄 Comprovante reconhecido!", "💡 Energia", "💰 R$ 125,76"],
    delta: -125.76,
  },
  {
    id: "text-income",
    user: { media: "text", text: "Recebi 2.000 do freela" },
    thinking: "Classificando receita...",
    reply: ["💰 Receita registrada!", "Freelancer", "R$ 2.000,00"],
    delta: 2000,
  },
  {
    id: "audio-income",
    user: { media: "audio", seconds: "0:04", caption: "Entrou 800 da comissão" },
    thinking: "Transcrevendo áudio...",
    reply: ["💵 Receita registrada!", "Comissão", "R$ 800,00"],
    delta: 800,
  },
  {
    id: "image-income",
    user: { media: "image", caption: "PIX recebido" },
    thinking: "Analisando o print...",
    reply: ["💰 PIX recebido!", "R$ 320,00"],
    delta: 320,
  },
  {
    id: "text-event",
    user: { media: "text", text: "Reunião amanhã às 19h" },
    thinking: "Criando compromisso...",
    reply: ["📅 Compromisso criado!", "Amanhã", "19:00"],
  },
  {
    id: "image-event",
    user: { media: "image", caption: "Print do evento" },
    thinking: "Identificando o evento...",
    reply: ["📅 Evento identificado!", "Onboarding Abio", "04/08", "19:00"],
  },
  {
    id: "query-month",
    user: { media: "text", text: "Quanto gastei esse mês?" },
    thinking: "Consultando seu mês...",
    reply: ["📊 Julho", "Entradas · R$ 8.920", "Saídas · R$ 5.431", "Saldo · R$ 3.489"],
  },
  {
    id: "query-balance",
    user: { media: "text", text: "Quanto tenho de saldo?" },
    thinking: "Calculando saldo real...",
    reply: ["💰 Saldo atual", "R$ 10.452,30"],
  },
  {
    id: "query-last",
    user: { media: "text", text: "Quais meus últimos gastos?" },
    thinking: "Buscando movimentações...",
    reply: ["🧾 Últimas movimentações", "Mercado", "Gasolina", "Farmácia"],
  },
];

type Bubble =
  | { key: string; kind: "user"; msg: UserMsg; time: string }
  | { key: string; kind: "thinking"; label: string }
  | { key: string; kind: "bot"; lines: string[]; time: string; speed: string };

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const SPEEDS = ["0,2s", "0,3s", "0,4s", "0,5s"];

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const clock = (step: number) => {
  const start = 9 * 60 + 12;
  const m = (start + step * 47) % (24 * 60);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const rand = (min: number, max: number) => min + Math.random() * (max - min);

export function HeroChat() {
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [typing, setTyping] = useState(false);
  const [balance, setBalance] = useState(10692.3);
  const [speed, setSpeed] = useState("0,4s");
  const scroller = useRef<HTMLDivElement>(null);
  const reduce = useMemo(
    () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  useEffect(() => {
    let alive = true;
    let seq = 0;

    const run = async () => {
      while (alive) {
        const queue = shuffle(SCENARIOS);
        let step = 0;

        for (const s of queue) {
          if (!alive) return;
          const id = `${s.id}-${seq++}`;
          const time = clock(step++);

          setBubbles((b) => [...b.slice(-8), { key: `u-${id}`, kind: "user", msg: s.user, time }]);
          await wait(rand(650, 800));
          if (!alive) return;

          setTyping(true);
          setBubbles((b) => [...b, { key: `t-${id}`, kind: "thinking", label: s.thinking }]);
          await wait(rand(800, 1200));
          if (!alive) return;

          setTyping(false);
          setSpeed(SPEEDS[Math.floor(Math.random() * SPEEDS.length)]);
          setBubbles((b) => [
            ...b.filter((x) => x.key !== `t-${id}`),
            { key: `b-${id}`, kind: "bot", lines: s.reply, time, speed: SPEEDS[0] },
          ]);
          if (s.delta) setBalance((v) => Math.max(0, Math.round((v + s.delta!) * 100) / 100));

          await wait(rand(2200, 3000));
        }

        if (!alive) return;
        await wait(5000);
        if (!alive) return;
        setBubbles([]);
        await wait(900);
      }
    };

    void run();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    scroller.current?.scrollTo({
      top: scroller.current.scrollHeight,
      behavior: reduce ? "auto" : "smooth",
    });
  }, [bubbles, reduce]);

  return (
    <div className="relative mx-auto w-full max-w-[22rem] sm:max-w-sm">
      <motion.div
        animate={reduce ? undefined : { y: [0, -8, 0] }}
        transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
        className="rounded-2xl border border-border bg-card shadow-card overflow-hidden"
      >
        <div className="flex items-center gap-3 px-4 py-3 bg-secondary border-b border-border">
          <div className="h-9 w-9 shrink-0 overflow-hidden rounded-full bg-[#0D1117] grid place-items-center ring-1 ring-border">
            <img
              src={abioLogo.url}
              alt="Abio"
              width={36}
              height={36}
              className="h-full w-full object-contain p-0.5"
              loading="eager"
              decoding="async"
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate">Abio</p>
            <p className="text-[11px] text-neon">{typing ? "digitando…" : "online"}</p>
          </div>
          <span className="h-2 w-2 rounded-full bg-neon animate-pulse-glow" />
        </div>

        {/* saldo ao vivo */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-background/50 border-b border-border">
          <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <Wallet className="h-3.5 w-3.5 text-neon" /> Saldo atualizado
          </span>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={balance}
              initial={{ y: 10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -10, opacity: 0 }}
              transition={{ duration: 0.35 }}
              className="font-display text-sm text-neon tabular-nums"
            >
              {brl(balance)}
            </motion.span>
          </AnimatePresence>
        </div>

        <div
          ref={scroller}
          className="px-3 py-4 space-y-2 h-[360px] sm:h-[400px] overflow-hidden bg-background"
        >
          <AnimatePresence initial={false} mode="popLayout">
            {bubbles.map((m) => {
              if (m.kind === "thinking") {
                return (
                  <motion.div
                    key={m.key}
                    layout
                    initial={{ opacity: 0, y: 12, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.2 } }}
                    className="flex justify-start"
                  >
                    <div className="rounded-2xl rounded-bl-sm bg-secondary px-3 py-2.5 flex items-center gap-2">
                      <span className="flex gap-1">
                        {[0, 1, 2].map((d) => (
                          <motion.span
                            key={d}
                            className="h-1.5 w-1.5 rounded-full bg-neon"
                            animate={{ opacity: [0.25, 1, 0.25], y: [0, -2, 0] }}
                            transition={{ duration: 0.9, repeat: Infinity, delay: d * 0.15 }}
                          />
                        ))}
                      </span>
                      <span className="text-[11px] text-muted-foreground">{m.label}</span>
                    </div>
                  </motion.div>
                );
              }

              const mine = m.kind === "user";
              return (
                <motion.div
                  key={m.key}
                  layout
                  initial={{ opacity: 0, y: 16, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -8, scale: 0.96, transition: { duration: 0.25 } }}
                  transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
                  className={`flex ${mine ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={[
                      "max-w-[82%] rounded-2xl px-3 py-2 text-sm shadow-sm",
                      mine
                        ? "bg-primary/85 text-primary-foreground rounded-br-sm"
                        : "bg-secondary text-foreground rounded-bl-sm",
                    ].join(" ")}
                  >
                    {m.kind === "user" ? <UserContent msg={m.msg} /> : <BotContent lines={m.lines} />}

                    <div
                      className={`mt-1 flex items-center justify-end gap-1 text-[10px] ${
                        mine ? "text-primary-foreground/70" : "text-muted-foreground"
                      }`}
                    >
                      {m.time}
                      {mine && <CheckCheck className="h-3 w-3 text-neon" />}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>

        <div className="px-3 py-2 border-t border-border bg-secondary flex items-center gap-2">
          <div className="flex-1 h-9 rounded-full bg-input px-3 text-xs text-muted-foreground grid items-center truncate">
            Digite ou envie um áudio…
          </div>
          <button
            aria-label="Enviar áudio"
            className="h-9 w-9 shrink-0 rounded-full bg-primary grid place-items-center text-primary-foreground"
          >
            <Mic className="h-4 w-4" />
          </button>
        </div>
      </motion.div>

      <motion.div
        animate={reduce ? undefined : { y: [0, -10, 0] }}
        transition={{ duration: 5.5, repeat: Infinity, ease: "easeInOut" }}
        className="absolute -left-8 top-24 hidden lg:flex items-center gap-2 rounded-full border border-border bg-card/80 backdrop-blur px-3 py-1.5 text-xs"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-neon" />
        <span>
          IA classificou em <span className="tabular-nums text-neon">{speed}</span>
        </span>
      </motion.div>
      <motion.div
        animate={reduce ? undefined : { y: [0, 10, 0] }}
        transition={{ duration: 6.5, repeat: Infinity, ease: "easeInOut" }}
        className="absolute -right-6 bottom-24 hidden lg:flex items-center gap-2 rounded-full border border-border bg-card/80 backdrop-blur px-3 py-1.5 text-xs"
      >
        🦈 Sem planilha, sem app
      </motion.div>
    </div>
  );
}

function UserContent({ msg }: { msg: UserMsg }) {
  if (msg.media === "text") return <span>{msg.text}</span>;

  if (msg.media === "audio") {
    return (
      <span className="block">
        <span className="flex items-center gap-2">
          <Mic className="h-4 w-4 text-neon" />
          <span className="h-1.5 w-24 rounded-full bg-primary-foreground/25 relative overflow-hidden">
            <motion.span
              className="absolute inset-y-0 left-0 bg-neon rounded-full"
              initial={{ width: "0%" }}
              animate={{ width: "100%" }}
              transition={{ duration: 1.8, ease: "linear" }}
            />
          </span>
          <span className="text-xs opacity-80">{msg.seconds}</span>
        </span>
        {msg.caption && <span className="mt-1 block text-xs opacity-80">“{msg.caption}”</span>}
      </span>
    );
  }

  if (msg.media === "image") {
    return (
      <span className="block">
        <span className="grid h-24 w-40 place-items-center rounded-lg bg-primary-foreground/10 border border-primary-foreground/15">
          <ImageIcon className="h-6 w-6 opacity-70" />
        </span>
        <span className="mt-1.5 block text-xs opacity-80">{msg.caption}</span>
      </span>
    );
  }

  return (
    <span className="flex items-center gap-2">
      <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary-foreground/10 border border-primary-foreground/15">
        <FileText className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium">{msg.fileName}</span>
        <span className="block text-[10px] opacity-70">PDF · 84 KB</span>
      </span>
    </span>
  );
}

function BotContent({ lines }: { lines: string[] }) {
  return (
    <span className="block space-y-0.5">
      {lines.map((line, i) => (
        <motion.span
          key={line + i}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.12 + i * 0.11, duration: 0.28 }}
          className={i === 0 ? "block font-medium" : "block text-[13px]"}
        >
          {line}
        </motion.span>
      ))}
      <motion.span
        initial={{ opacity: 0, scale: 0.85 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.2 + lines.length * 0.11 }}
        className="mt-1.5 inline-flex items-center gap-1 rounded-full border border-neon/40 bg-neon/10 px-2 py-0.5 text-[10px] text-neon"
      >
        <Sparkles className="h-3 w-3" /> organizado automaticamente
      </motion.span>
    </span>
  );
}
