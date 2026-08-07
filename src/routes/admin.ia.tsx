import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Bot, Eye, EyeOff, Save, Plug, PowerOff, AlertTriangle, CheckCircle2, XCircle, Loader2, ChevronDown, ChevronRight, Search, Sparkles, MessageSquare, Send } from "lucide-react";
import {
  adminGetAiSettings,
  adminSaveAiSettings,
  adminTestAiConnection,
  adminGetAiStats,
  adminTestAiReply,
} from "@/lib/ai-admin.functions";
import { adminAiLogs } from "@/lib/ai-logs.functions";


export const Route = createFileRoute("/admin/ia")({
  head: () => ({ meta: [{ title: "Inteligência Artificial · Abio Admin" }, { name: "robots", content: "noindex" }] }),
  component: Page,
});

const MODEL_LABELS: Record<string, string> = {
  "gpt-5": "GPT-5",
  "gpt-5-mini": "GPT-5 Mini",
  "gpt-4.1": "GPT-4.1",
  "gpt-4o": "GPT-4o",
  "gpt-4o-mini": "GPT-4o Mini",
};

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("pt-BR");
  } catch {
    return iso;
  }
}

function Page() {
  const qc = useQueryClient();
  const getSettings = useServerFn(adminGetAiSettings);
  const saveSettings = useServerFn(adminSaveAiSettings);
  const testConn = useServerFn(adminTestAiConnection);
  const getStats = useServerFn(adminGetAiStats);

  const settingsQ = useQuery({ queryKey: ["ai-settings"], queryFn: () => getSettings() });
  const statsQ = useQuery({ queryKey: ["ai-stats"], queryFn: () => getStats(), refetchInterval: 15_000 });

  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [model, setModel] = useState<string>("gpt-4o");
  const [enabled, setEnabled] = useState<boolean>(true);
  const [tone, setTone] = useState<"formal" | "amigavel" | "vendedor">("amigavel");
  const [masterPrompt, setMasterPrompt] = useState<string>("");
  const [welcomeMsg, setWelcomeMsg] = useState<string>("");
  const [guestMsg, setGuestMsg] = useState<string>("");
  const [signupDoneMsg, setSignupDoneMsg] = useState<string>("");
  const [dirty, setDirty] = useState(false);
  const [testResult, setTestResult] = useState<null | { ok: boolean; msg: string }>(null);

  const loaded = settingsQ.data;
  useEffect(() => {
    if (loaded && !dirty) {
      setModel(loaded.model);
      setEnabled(loaded.enabled);
      setTone((loaded as any).tone ?? "amigavel");
      setMasterPrompt((loaded as any).master_prompt ?? "");
      setWelcomeMsg((loaded as any).welcome_message ?? "");
      setGuestMsg((loaded as any).guest_message ?? "");
      setSignupDoneMsg((loaded as any).signup_done_message ?? "");
    }
  }, [loaded, dirty]);


  const saveMut = useMutation({
    mutationFn: async (payload: { apiKey?: string; model: string; enabled: boolean }) =>
      saveSettings({ data: payload as any }),
    onSuccess: () => {
      setApiKey("");
      setDirty(false);
      qc.invalidateQueries({ queryKey: ["ai-settings"] });
    },
  });

  const testMut = useMutation({
    mutationFn: async () => testConn(),
    onSuccess: (r: any) => {
      setTestResult(
        r?.ok
          ? { ok: true, msg: `✅ Conectado com sucesso${r.modelCount ? ` (${r.modelCount} modelos)` : ""}` }
          : { ok: false, msg: `❌ Erro na autenticação: ${r?.error ?? "desconhecido"}` },
      );
    },
    onError: (e: any) => setTestResult({ ok: false, msg: `❌ Falha: ${e?.message ?? "erro"}` }),
  });

  const onSave = () => {
    const payload: any = {
      model,
      enabled,
      tone,
      master_prompt: masterPrompt,
      welcome_message: welcomeMsg,
      guest_message: guestMsg,
      signup_done_message: signupDoneMsg,
    };
    if (apiKey.trim()) payload.apiKey = apiKey.trim();
    saveMut.mutate(payload);
  };

  const onDisable = () => {
    setEnabled(false);
    setDirty(true);
    saveMut.mutate({ model, enabled: false } as any);
  };


  const status = enabled && loaded?.hasKey ? "active" : !loaded?.hasKey ? "missing" : "off";

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <header className="flex items-center gap-4">
        <div className="h-14 w-14 grid place-items-center rounded-2xl border border-primary/30 bg-primary/10 text-primary">
          <Bot className="h-6 w-6" />
        </div>
        <div>
          <h1 className="font-display text-3xl">Inteligência Artificial</h1>
          <p className="text-sm text-muted-foreground">
            Gerencie a chave OpenAI usada por todas as automações do Abio.
          </p>
        </div>
      </header>

      {loaded && !loaded.hasKey && (
        <div className="rounded-2xl border border-yellow-500/30 bg-yellow-500/10 text-yellow-200 p-4 flex gap-3">
          <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
          <p className="text-sm">
            <b>⚠️ OpenAI não configurada.</b> As automações inteligentes do Abio estão desativadas.
            Cadastre uma chave abaixo para ativar texto, áudio e imagem.
          </p>
        </div>
      )}

      {/* Configuração */}
      <section className="rounded-3xl border border-border bg-card/60 backdrop-blur-xl p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl">Configuração OpenAI</h2>
          <span
            className={[
              "inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs border",
              status === "active" && "border-primary/40 bg-primary/10 text-primary",
              status === "missing" && "border-yellow-500/40 bg-yellow-500/10 text-yellow-200",
              status === "off" && "border-muted bg-muted/20 text-muted-foreground",
            ].filter(Boolean).join(" ")}
          >
            <span className={[
              "h-2 w-2 rounded-full",
              status === "active" ? "bg-primary" : status === "missing" ? "bg-yellow-400" : "bg-muted-foreground",
            ].join(" ")} />
            {status === "active" ? "Ativa" : status === "missing" ? "Sem chave" : "Desativada"}
          </span>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-xs uppercase tracking-wider text-muted-foreground">OpenAI API Key</label>
            <div className="flex items-center gap-2">
              <input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => { setApiKey(e.target.value); setDirty(true); }}
                placeholder={loaded?.hasKey ? `Atual: ${loaded.keyMasked} — deixe vazio p/ manter` : "sk-..."}
                className="flex-1 rounded-xl border border-border bg-background/40 px-3 py-2 text-sm font-mono"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="rounded-xl border border-border bg-background/40 p-2 hover:border-primary/40"
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs uppercase tracking-wider text-muted-foreground">Modelo utilizado</label>
            <select
              value={model}
              onChange={(e) => { setModel(e.target.value); setDirty(true); }}
              className="w-full rounded-xl border border-border bg-background/40 px-3 py-2 text-sm"
            >
              {Object.entries(MODEL_LABELS).map(([v, label]) => (
                <option key={v} value={v}>{label}</option>
              ))}
            </select>
          </div>
        </div>

        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => { setEnabled(e.target.checked); setDirty(true); }}
            className="h-4 w-4 accent-primary"
          />
          IA ativa — automações respondem mensagens, áudios e imagens
        </label>

        <div className="flex flex-wrap gap-2 pt-2">
          <button
            onClick={onSave}
            disabled={saveMut.isPending}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-brand px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {saveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Salvar configuração
          </button>
          <button
            onClick={() => testMut.mutate()}
            disabled={testMut.isPending}
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-background/40 px-4 py-2 text-sm hover:border-primary/40 disabled:opacity-50"
          >
            {testMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />}
            Testar conexão
          </button>
          <button
            onClick={onDisable}
            disabled={saveMut.isPending || !enabled}
            className="inline-flex items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 text-destructive px-4 py-2 text-sm hover:bg-destructive/20 disabled:opacity-50"
          >
            <PowerOff className="h-4 w-4" /> Desativar IA
          </button>
        </div>

        {saveMut.isSuccess && !dirty && (
          <p className="text-xs text-primary inline-flex items-center gap-1">
            <CheckCircle2 className="h-3.5 w-3.5" /> Configuração salva.
          </p>
        )}
        {saveMut.isError && (
          <p className="text-xs text-destructive inline-flex items-center gap-1">
            <XCircle className="h-3.5 w-3.5" /> Erro ao salvar.
          </p>
        )}
        {testResult && (
          <p className={`text-sm ${testResult.ok ? "text-primary" : "text-destructive"}`}>{testResult.msg}</p>
        )}
      </section>

      {/* Estatísticas */}
      <section className="rounded-3xl border border-border bg-card/60 backdrop-blur-xl p-6 space-y-4">
        <h2 className="font-display text-xl">Estatísticas da IA</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Stat label="Status" value={status === "active" ? "Ativa" : "Inativa"} />
          <Stat label="Modelo atual" value={MODEL_LABELS[loaded?.model ?? "gpt-4o"] ?? loaded?.model ?? "—"} />
          <Stat label="Última utilização" value={fmtDate(statsQ.data?.lastUsed ?? loaded?.last_used_at ?? null)} />
          <Stat label="Mensagens processadas" value={statsQ.data?.processed ?? "—"} />
          <Stat label="Áudios processados" value={statsQ.data?.audios ?? "—"} />
          <Stat label="Imagens analisadas" value={statsQ.data?.images ?? "—"} />
        </div>
      </section>

      <PromptsEditor
        tone={tone} setTone={(v) => { setTone(v); setDirty(true); }}
        masterPrompt={masterPrompt} setMasterPrompt={(v) => { setMasterPrompt(v); setDirty(true); }}
        welcomeMsg={welcomeMsg} setWelcomeMsg={(v) => { setWelcomeMsg(v); setDirty(true); }}
        guestMsg={guestMsg} setGuestMsg={(v) => { setGuestMsg(v); setDirty(true); }}
        signupDoneMsg={signupDoneMsg} setSignupDoneMsg={(v) => { setSignupDoneMsg(v); setDirty(true); }}
        saving={saveMut.isPending}
        onSave={onSave}
        dirty={dirty}
      />

      <AiTester />

      <AiLogsPanel />

    </div>
  );
}

function Stat({ label, value }: { label: string; value: any }) {
  return (
    <div className="rounded-2xl border border-border bg-background/40 p-4">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-lg truncate">{String(value)}</p>
    </div>
  );
}

function AiLogsPanel() {
  const run = useServerFn(adminAiLogs);
  const [range, setRange] = useState<"today" | "week" | "month">("week");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["ai-logs", range, search],
    queryFn: () => run({ data: { range, search: search || undefined } }) as any,
    refetchInterval: 30_000,
  });

  const summary = (q.data as any)?.summary ?? { total: 0, totalTokens: 0, avgLatencyMs: 0, errorCount: 0, estCostUsd: 0 };
  const logs: any[] = (q.data as any)?.logs ?? [];

  return (
    <section className="rounded-3xl border border-border bg-card/60 backdrop-blur-xl p-6 space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl">Central de Monitoramento</h2>
          <p className="text-xs text-muted-foreground">Tudo o que a IA processou nos últimos dias</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(["today", "week", "month"] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={[
                "px-3 py-1.5 rounded-xl text-xs border transition-smooth",
                range === r ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-background/40 text-muted-foreground hover:text-foreground",
              ].join(" ")}
            >
              {r === "today" ? "Hoje" : r === "week" ? "Semana" : "Mês"}
            </button>
          ))}
          <div className="relative">
            <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Telefone…"
              className="pl-7 pr-3 py-1.5 text-xs rounded-xl border border-border bg-background/40 w-40"
            />
          </div>
        </div>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Stat label="Total" value={summary.total} />
        <Stat label="Tokens" value={summary.totalTokens.toLocaleString("pt-BR")} />
        <Stat label="Latência média" value={`${summary.avgLatencyMs}ms`} />
        <Stat label="Erros" value={summary.errorCount} />
        <Stat label="Custo estim. (USD)" value={`$${summary.estCostUsd}`} />
      </div>

      {q.isLoading ? (
        <div className="py-10 text-center text-sm text-muted-foreground">Carregando logs…</div>
      ) : logs.length === 0 ? (
        <div className="py-10 text-center text-sm text-muted-foreground">Nenhum log no período.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border">
                <th className="py-2 pr-2 w-6"></th>
                <th className="py-2 pr-3">Quando</th>
                <th className="py-2 pr-3">Telefone</th>
                <th className="py-2 pr-3">Intent</th>
                <th className="py-2 pr-3">Modo</th>
                <th className="py-2 pr-3">Modelo</th>
                <th className="py-2 pr-3">Tokens</th>
                <th className="py-2 pr-3">Latência</th>
                <th className="py-2 pr-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <FragmentRow
                  key={l.id}
                  log={l}
                  expanded={expanded === l.id}
                  onToggle={() => setExpanded((p) => (p === l.id ? null : l.id))}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function FragmentRow({ log: l, expanded, onToggle }: { log: any; expanded: boolean; onToggle: () => void }) {
  return (
    <>
      <tr onClick={onToggle} className="border-b border-border/40 hover:bg-background/30 cursor-pointer">
        <td className="py-2 pr-2">{expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</td>
        <td className="py-2 pr-3 whitespace-nowrap">{new Date(l.created_at).toLocaleString("pt-BR")}</td>
        <td className="py-2 pr-3 font-mono">{l.phone}</td>
        <td className="py-2 pr-3">{l.intent}</td>
        <td className="py-2 pr-3">{l.mode}</td>
        <td className="py-2 pr-3">{l.model ?? "—"}</td>
        <td className="py-2 pr-3">{l.tokens ?? "—"}</td>
        <td className="py-2 pr-3">{l.latencyMs ? `${l.latencyMs}ms` : "—"}</td>
        <td className="py-2 pr-3">
          <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] ${l.error ? "bg-destructive/20 text-destructive" : "bg-primary/20 text-primary"}`}>
            {l.error ? "erro" : "ok"}
          </span>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-border/40 bg-background/20">
          <td></td>
          <td colSpan={8} className="py-3 pr-3 space-y-2">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Mensagem recebida</p>
              <p className="text-sm mt-1 whitespace-pre-wrap">{l.prompt}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Resposta enviada</p>
              <p className="text-sm mt-1 whitespace-pre-wrap text-primary">{l.reply ?? "(sem resposta)"}</p>
            </div>
            {l.payload && (
              <details>
                <summary className="text-[10px] uppercase tracking-wider text-muted-foreground cursor-pointer">Payload IA</summary>
                <pre className="text-[10px] mt-1 bg-background/40 p-2 rounded-lg overflow-auto">{JSON.stringify(l.payload, null, 2)}</pre>
              </details>
            )}
            {l.error && <p className="text-xs text-destructive">Erro: {String(l.error)}</p>}
          </td>
        </tr>
      )}
    </>
  );
}

const TONE_OPTIONS: { value: "formal" | "amigavel" | "vendedor"; label: string; desc: string }[] = [
  { value: "formal", label: "Formal", desc: "Profissional, cordial, sem gírias" },
  { value: "amigavel", label: "Amigável", desc: "Humano, próximo, leve" },
  { value: "vendedor", label: "Vendedor", desc: "Persuasivo, convida a criar conta" },
];

function PromptsEditor(props: {
  tone: "formal" | "amigavel" | "vendedor";
  setTone: (v: "formal" | "amigavel" | "vendedor") => void;
  masterPrompt: string; setMasterPrompt: (v: string) => void;
  welcomeMsg: string; setWelcomeMsg: (v: string) => void;
  guestMsg: string; setGuestMsg: (v: string) => void;
  signupDoneMsg: string; setSignupDoneMsg: (v: string) => void;
  saving: boolean;
  onSave: () => void;
  dirty: boolean;
}) {
  return (
    <section className="rounded-3xl border border-border bg-card/60 backdrop-blur-xl p-6 space-y-5">
      <header className="flex items-center gap-3">
        <div className="h-10 w-10 grid place-items-center rounded-xl border border-primary/30 bg-primary/10 text-primary">
          <Sparkles className="h-5 w-5" />
        </div>
        <div>
          <h2 className="font-display text-xl">Prompts &amp; Mensagens</h2>
          <p className="text-xs text-muted-foreground">Personalize como o Abio conversa pelo WhatsApp.</p>
        </div>
      </header>

      <div className="space-y-2">
        <label className="text-xs uppercase tracking-wider text-muted-foreground">Tom da IA</label>
        <div className="grid sm:grid-cols-3 gap-2">
          {TONE_OPTIONS.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => props.setTone(t.value)}
              className={[
                "rounded-2xl border px-4 py-3 text-left transition-smooth",
                props.tone === t.value
                  ? "border-primary/50 bg-primary/10 text-foreground"
                  : "border-border bg-background/40 text-muted-foreground hover:text-foreground",
              ].join(" ")}
            >
              <p className="text-sm font-medium">{t.label}</p>
              <p className="text-[11px] mt-0.5 opacity-80">{t.desc}</p>
            </button>
          ))}
        </div>
      </div>

      <PromptField
        label="Prompt Mestre"
        hint="Instruções base usadas em todas as conversas. Deixe vazio para usar o padrão do Abio."
        value={props.masterPrompt}
        onChange={props.setMasterPrompt}
        rows={6}
        placeholder={'Você é o Abio, um assistente financeiro inteligente e amigável...'}
      />
      <PromptField
        label="Mensagem de Boas-vindas"
        hint="Usada na primeira interação do usuário."
        value={props.welcomeMsg}
        onChange={props.setWelcomeMsg}
        rows={3}
        placeholder={"Oi! Eu sou o Abio, seu assistente financeiro 🚀"}
      />
      <PromptField
        label="Mensagem para Não Cadastrados"
        hint="Orientação extra para responder quem ainda não tem conta."
        value={props.guestMsg}
        onChange={props.setGuestMsg}
        rows={4}
        placeholder={"Explique o Abio com simpatia e convide para criar conta em abio.fun."}
      />
      <PromptField
        label="Cadastro Concluído"
        hint="Resposta quando o usuário informar que acabou de se cadastrar."
        value={props.signupDoneMsg}
        onChange={props.setSignupDoneMsg}
        rows={3}
        placeholder={"Boa! Cadastro feito. Agora é só me mandar um gasto que eu registro 💸"}
      />

      <div className="flex items-center justify-between pt-2">
        <p className="text-xs text-muted-foreground">
          {props.dirty ? "Você tem alterações não salvas." : "Tudo salvo."}
        </p>
        <button
          onClick={props.onSave}
          disabled={props.saving}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-brand px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {props.saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Salvar prompts
        </button>
      </div>
    </section>
  );
}

function PromptField({ label, hint, value, onChange, rows, placeholder }: {
  label: string; hint?: string; value: string; onChange: (v: string) => void; rows: number; placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label className="text-xs uppercase tracking-wider text-muted-foreground">{label}</label>
        <span className="text-[10px] text-muted-foreground">{value.length} caracteres</span>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        placeholder={placeholder}
        className="w-full rounded-xl border border-border bg-background/40 px-3 py-2 text-sm font-mono resize-y focus:border-primary/40 focus:outline-none"
      />
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function AiTester() {
  const run = useServerFn(adminTestAiReply);
  const [mode, setMode] = useState<"guest" | "user">("guest");
  const [input, setInput] = useState("");
  const [chat, setChat] = useState<{ role: "user" | "assistant"; content: string; ms?: number }[]>([]);
  const mut = useMutation({
    mutationFn: async (message: string) => run({ data: { message, mode } }) as any,
    onSuccess: (r: any) => {
      if (r?.ok) {
        setChat((c) => [...c, { role: "assistant", content: r.reply, ms: r.ms }]);
      } else {
        setChat((c) => [...c, { role: "assistant", content: `❌ ${r?.error ?? "erro"}` }]);
      }
    },
  });

  const send = () => {
    const m = input.trim();
    if (!m) return;
    setChat((c) => [...c, { role: "user", content: m }]);
    setInput("");
    mut.mutate(m);
  };

  return (
    <section className="rounded-3xl border border-border bg-card/60 backdrop-blur-xl p-6 space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 grid place-items-center rounded-xl border border-primary/30 bg-primary/10 text-primary">
            <MessageSquare className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-display text-xl">Teste a IA em tempo real</h2>
            <p className="text-xs text-muted-foreground">Simule uma conversa com as configurações atuais.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {(["guest", "user"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={[
                "px-3 py-1.5 rounded-xl text-xs border transition-smooth",
                mode === m ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-background/40 text-muted-foreground hover:text-foreground",
              ].join(" ")}
            >
              {m === "guest" ? "Não cadastrado" : "Cadastrado"}
            </button>
          ))}
          <button
            onClick={() => setChat([])}
            className="px-3 py-1.5 rounded-xl text-xs border border-border bg-background/40 text-muted-foreground hover:text-foreground"
          >
            Limpar
          </button>
        </div>
      </header>

      <div className="rounded-2xl border border-border bg-background/40 p-3 min-h-[180px] max-h-[360px] overflow-auto space-y-2">
        {chat.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-8">
            Envie uma mensagem para ver como o Abio responderia agora.
          </p>
        ) : (
          chat.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={[
                  "max-w-[80%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap",
                  m.role === "user"
                    ? "bg-primary/15 text-foreground border border-primary/30"
                    : "bg-card border border-border text-foreground",
                ].join(" ")}
              >
                {m.content}
                {m.ms !== undefined && (
                  <span className="block text-[10px] text-muted-foreground mt-1">{m.ms}ms</span>
                )}
              </div>
            </div>
          ))
        )}
        {mut.isPending && (
          <div className="flex justify-start">
            <div className="bg-card border border-border rounded-2xl px-3 py-2 text-xs text-muted-foreground inline-flex items-center gap-2">
              <Loader2 className="h-3 w-3 animate-spin" /> Abio está pensando…
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder={mode === "guest" ? "Ex.: Como funciona o Abio?" : "Ex.: Quanto gastei essa semana?"}
          className="flex-1 rounded-xl border border-border bg-background/40 px-3 py-2 text-sm"
        />
        <button
          onClick={send}
          disabled={mut.isPending || !input.trim()}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-brand px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {mut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Enviar
        </button>
      </div>
    </section>
  );
}
