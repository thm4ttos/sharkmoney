import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  adminGetZapiCreds,
  adminSaveZapiCreds,
  adminListWaContacts,
  adminCreateWaContact,
  adminDeleteWaContact,
  adminSendBroadcast,
  adminListWhatsappTimeline,
  adminGetZapiStatus,
  adminGetZapiDevice,
} from "@/lib/zapi-admin.functions";
import { adminTestFullFlow } from "@/lib/flow-test.functions";
import { listWaTemplates, saveWaTemplate } from "@/lib/wa-templates.functions";
import { MessageCircle, Save, Trash2, Send, KeyRound, Users, History, CheckCircle2, XCircle, Activity, Smartphone, ArrowDownLeft, ArrowUpRight, Megaphone, Bug, FileText, Loader2 } from "lucide-react";

export const Route = createFileRoute("/admin/whatsapp")({
  head: () => ({ meta: [{ title: "WhatsApp · Admin Shark Money" }] }),
  component: Page,
});

type Tab = "creds" | "contatos" | "enviar" | "historico" | "diagnostico" | "templates";

function Page() {
  const [tab, setTab] = useState<Tab>("enviar");

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-4">
        <div className="h-12 w-12 grid place-items-center rounded-2xl border border-primary/30 bg-primary/10 text-primary">
          <MessageCircle className="h-5 w-5" />
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-primary">Disparos</p>
          <h1 className="font-display text-3xl mt-1">WhatsApp (Z-API)</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Cadastre números, configure credenciais e dispare mensagens/imagens.
          </p>
        </div>
      </header>

      <nav className="flex flex-wrap gap-2">
        {[
          { id: "enviar", label: "Enviar", icon: Send },
          { id: "contatos", label: "Contatos", icon: Users },
          { id: "templates", label: "Templates", icon: FileText },
          { id: "creds", label: "Credenciais", icon: KeyRound },
          { id: "historico", label: "Histórico", icon: History },
          { id: "diagnostico", label: "Diagnóstico", icon: Bug },
        ].map((t) => {
          const Icon = t.icon;
          const active = tab === (t.id as Tab);
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id as Tab)}
              className={[
                "inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-smooth",
                active
                  ? "border-primary/50 bg-primary/10 text-foreground"
                  : "border-border bg-card/60 text-muted-foreground hover:text-foreground",
              ].join(" ")}
            >
              <Icon className="h-4 w-4" /> {t.label}
            </button>
          );
        })}
      </nav>

      {tab === "creds" && <><CredsCard /><StatusCard /></>}
      {tab === "contatos" && <ContactsCard />}
      {tab === "enviar" && <SendCard />}
      {tab === "historico" && <HistoryCard />}
      {tab === "diagnostico" && <DiagnosticCard />}
      {tab === "templates" && <TemplatesCard />}
    </div>
  );
}

/* ============ Templates automáticos ============ */
function TemplatesCard() {
  const list = useServerFn(listWaTemplates);
  const save = useServerFn(saveWaTemplate);
  const qc = useQueryClient();
  const { data: templates = [], isLoading } = useQuery({
    queryKey: ["wa-templates"],
    queryFn: () => list() as any,
  });

  const [drafts, setDrafts] = useState<Record<string, { title: string; body: string }>>({});
  const [savedKey, setSavedKey] = useState<string | null>(null);

  const getDraft = (t: any) => drafts[t.key] ?? { title: t.title, body: t.body };

  const mut = useMutation({
    mutationFn: (payload: { key: string; title: string; body: string }) => save({ data: payload }),
    onSuccess: (_r, vars) => {
      setSavedKey(vars.key);
      setTimeout(() => setSavedKey(null), 2000);
      qc.invalidateQueries({ queryKey: ["wa-templates"] });
    },
  });

  return (
    <section className="space-y-4 max-w-4xl">
      <div className="rounded-3xl border border-border bg-card/60 backdrop-blur-xl p-5">
        <h2 className="font-display text-lg">Mensagens automáticas</h2>
        <p className="text-xs text-muted-foreground mt-1">
          Templates enviados ao cliente em momentos-chave (boas-vindas, renovação, cancelamento, upgrade).
          Use *negrito* com asteriscos no padrão WhatsApp.
        </p>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : (
        <div className="grid gap-4">
          {templates.map((t: any) => {
            const d = getDraft(t);
            const dirty = d.title !== t.title || d.body !== t.body;
            return (
              <div key={t.key} className="rounded-3xl border border-border bg-card/60 backdrop-blur-xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-primary">{t.key}</p>
                    <input
                      value={d.title}
                      onChange={(e) => setDrafts((s) => ({ ...s, [t.key]: { ...d, title: e.target.value } }))}
                      className="font-display text-lg bg-transparent border-b border-transparent hover:border-border focus:border-primary outline-none"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    {savedKey === t.key && (
                      <span className="text-xs text-primary inline-flex items-center gap-1">
                        <CheckCircle2 className="h-3.5 w-3.5" /> salvo
                      </span>
                    )}
                    <button
                      onClick={() => mut.mutate({ key: t.key, title: d.title, body: d.body })}
                      disabled={!dirty || mut.isPending}
                      className="inline-flex items-center gap-2 rounded-xl bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:opacity-90 disabled:opacity-40"
                    >
                      {mut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                      Salvar
                    </button>
                  </div>
                </div>
                <textarea
                  value={d.body}
                  onChange={(e) => setDrafts((s) => ({ ...s, [t.key]: { ...d, body: e.target.value } }))}
                  rows={6}
                  className="w-full rounded-xl border border-border bg-background/40 px-3 py-2 text-sm font-mono"
                />
                <p className="text-[11px] text-muted-foreground">
                  Atualizado em {new Date(t.updated_at).toLocaleString("pt-BR")}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ============ Diagnóstico: Testar Fluxo Completo ============ */
function DiagnosticCard() {
  const run = useServerFn(adminTestFullFlow);
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("Gastei 50 reais no mercado");
  const [result, setResult] = useState<any>(null);
  const mut = useMutation({
    mutationFn: () => run({ data: { phone, message } }),
    onSuccess: (r) => setResult(r),
    onError: (e: any) => setResult({ ok: false, error: e?.message ?? "Erro" }),
  });

  return (
    <section className="rounded-3xl border border-border bg-card/60 backdrop-blur-xl p-5 space-y-4">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 grid place-items-center rounded-xl border border-primary/30 bg-primary/10 text-primary">
          <Bug className="h-4 w-4" />
        </div>
        <div>
          <h2 className="font-display text-lg">Testar Fluxo Completo</h2>
          <p className="text-xs text-muted-foreground">
            Simula mensagem recebida → OpenAI → envio Z-API (mesma função do auto-reply).
          </p>
        </div>
      </div>

      <div className="grid sm:grid-cols-[1fr_1fr] gap-3">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Número destino</p>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="5511999999999"
            className="w-full rounded-xl border border-border bg-background/40 px-3 py-2 text-sm font-mono"
          />
        </div>
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Mensagem simulada</p>
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="w-full rounded-xl border border-border bg-background/40 px-3 py-2 text-sm"
          />
        </div>
      </div>

      <button
        onClick={() => { setResult(null); mut.mutate(); }}
        disabled={!phone || !message || mut.isPending}
        className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50"
      >
        <Bug className="h-4 w-4" />
        {mut.isPending ? "Executando…" : "Testar Fluxo Completo"}
      </button>

      {result && (
        <div className="space-y-2">
          <div className={`rounded-xl border px-3 py-2 text-sm ${result.ok ? "border-primary/40 bg-primary/5 text-foreground" : "border-destructive/40 bg-destructive/5 text-destructive"}`}>
            {result.ok ? "✅ Fluxo executado com sucesso" : `❌ Falha no fluxo${result.error ? `: ${result.error}` : ""}`}
            {typeof result.totalMs === "number" && <span className="text-xs text-muted-foreground ml-2">({result.totalMs}ms)</span>}
          </div>
          {Array.isArray(result.steps) && result.steps.map((s: any, i: number) => (
            <div key={i} className="rounded-xl border border-border bg-background/40 p-3 text-xs">
              <div className="flex items-center gap-2 mb-1">
                {s.ok ? <CheckCircle2 className="h-3.5 w-3.5 text-primary" /> : <XCircle className="h-3.5 w-3.5 text-destructive" />}
                <span className="font-mono font-medium">{s.step}</span>
              </div>
              <pre className="whitespace-pre-wrap break-all text-muted-foreground">
                {JSON.stringify(s.detail, null, 2)}
              </pre>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ============ Credenciais ============ */
function CredsCard() {
  const get = useServerFn(adminGetZapiCreds);
  const save = useServerFn(adminSaveZapiCreds);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["zapi-creds"], queryFn: () => get() });

  const [form, setForm] = useState({ instance_id: "", instance_token: "", client_token: "" });
  const [touched, setTouched] = useState(false);

  useMemo(() => {
    if (data && !touched) {
      setForm({
        instance_id: data.instance_id ?? "",
        instance_token: data.instance_token ?? "",
        client_token: data.client_token ?? "",
      });
    }
  }, [data, touched]);

  const mutation = useMutation({
    mutationFn: () => save({ data: form }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["zapi-creds"] }),
  });

  return (
    <section className="rounded-3xl border border-border bg-card/60 backdrop-blur-xl p-5 space-y-4 max-w-2xl">
      <div>
        <h2 className="font-display text-lg">Credenciais Z-API</h2>
        <p className="text-xs text-muted-foreground">
          Encontre em <b>painel do Z-API → sua instância</b>. O <b>Client-Token</b> é exigido em
          todas as requisições e fica no cabeçalho.
        </p>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : (
        <div className="space-y-3">
          <Field label="Instance ID" value={form.instance_id} onChange={(v) => { setTouched(true); setForm((f) => ({ ...f, instance_id: v })); }} />
          <Field label="Instance Token" value={form.instance_token} onChange={(v) => { setTouched(true); setForm((f) => ({ ...f, instance_token: v })); }} mono />
          <Field label="Client-Token" value={form.client_token} onChange={(v) => { setTouched(true); setForm((f) => ({ ...f, client_token: v })); }} mono />

          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              <Save className="h-4 w-4" /> {mutation.isPending ? "Salvando…" : "Salvar credenciais"}
            </button>
            {mutation.isSuccess && <span className="text-xs text-primary inline-flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> salvo</span>}
            {mutation.isError && <span className="text-xs text-destructive">{(mutation.error as any)?.message ?? "Erro ao salvar"}</span>}
          </div>

          <p className="text-[11px] text-muted-foreground pt-2 border-t border-border">
            URL final: <code className="text-primary">https://api.z-api.io/instances/{form.instance_id || "<id>"}/token/{form.instance_token ? "•••" : "<token>"}/send-text</code>
          </p>
        </div>
      )}
    </section>
  );
}

function Field({ label, value, onChange, mono }: { label: string; value: string; onChange: (v: string) => void; mono?: boolean }) {
  return (
    <label className="block">
      <span className="block text-xs uppercase tracking-wider text-muted-foreground mb-1">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={["w-full rounded-xl border border-border bg-background/40 px-3 py-2 text-sm outline-none focus:border-primary/50", mono ? "font-mono" : ""].join(" ")}
      />
    </label>
  );
}

/* ============ Contatos ============ */
function ContactsCard() {
  const list = useServerFn(adminListWaContacts);
  const create = useServerFn(adminCreateWaContact);
  const del = useServerFn(adminDeleteWaContact);
  const qc = useQueryClient();
  const { data: contacts = [] } = useQuery({ queryKey: ["wa-contacts"], queryFn: () => list() });

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const add = useMutation({
    mutationFn: () => create({ data: { name, phone } }),
    onSuccess: () => {
      setName(""); setPhone(""); setErr(null);
      qc.invalidateQueries({ queryKey: ["wa-contacts"] });
    },
    onError: (e: any) => setErr(e?.message ?? "Erro"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wa-contacts"] }),
  });

  return (
    <section className="space-y-4 max-w-3xl">
      <div className="rounded-3xl border border-border bg-card/60 backdrop-blur-xl p-5 space-y-3">
        <h2 className="font-display text-lg">Novo contato</h2>
        <p className="text-xs text-muted-foreground">Formato do telefone: <b>DDI 55 + DDD + número</b>. Ex.: <code>5511987654321</code>. Pode digitar só DDD + número que normalizamos para BR.</p>
        <div className="grid sm:grid-cols-[1fr_240px_auto] gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome" className="rounded-xl border border-border bg-background/40 px-3 py-2 text-sm" />
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="55 11 98765-4321" className="rounded-xl border border-border bg-background/40 px-3 py-2 text-sm font-mono" />
          <button onClick={() => add.mutate()} disabled={add.isPending || !phone} className="rounded-xl bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50">
            Adicionar
          </button>
        </div>
        {err && <p className="text-xs text-destructive">{err}</p>}
      </div>

      <div className="rounded-3xl border border-border bg-card/60 backdrop-blur-xl p-5">
        <h2 className="font-display text-lg">Contatos ({contacts.length})</h2>
        <div className="mt-3 divide-y divide-border">
          {contacts.length === 0 && <p className="text-sm text-muted-foreground py-4">Nenhum contato ainda.</p>}
          {contacts.map((c: any) => (
            <div key={c.id} className="flex items-center justify-between py-3">
              <div>
                <p className="text-sm font-medium">{c.name || "(sem nome)"}</p>
                <p className="text-xs text-muted-foreground font-mono">{c.phone}</p>
              </div>
              <button onClick={() => remove.mutate(c.id)} className="rounded-lg border border-border p-2 hover:border-destructive/40 hover:text-destructive">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============ Enviar ============ */
function SendCard() {
  const list = useServerFn(adminListWaContacts);
  const send = useServerFn(adminSendBroadcast);
  const qc = useQueryClient();
  const { data: contacts = [] } = useQuery({ queryKey: ["wa-contacts"], queryFn: () => list() });

  const [kind, setKind] = useState<"text" | "image">("text");
  const [message, setMessage] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [extraPhones, setExtraPhones] = useState("");
  const [result, setResult] = useState<any>(null);

  const toggle = (phone: string) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(phone)) n.delete(phone); else n.add(phone);
      return n;
    });
  };
  const toggleAll = () => {
    if (selected.size === contacts.length) setSelected(new Set());
    else setSelected(new Set(contacts.map((c: any) => c.phone)));
  };

  const phones = useMemo(() => {
    const extra = extraPhones.split(/[\s,;\n]+/).map((p) => p.trim()).filter(Boolean);
    return Array.from(new Set([...selected, ...extra]));
  }, [selected, extraPhones]);

  const mutation = useMutation({
    mutationFn: () => send({ data: { phones, kind, message, image_url: imageUrl || undefined, caption } as any }),
    onSuccess: (r) => {
      setResult(r);
      qc.invalidateQueries({ queryKey: ["wa-broadcasts"] });
    },
    onError: (e: any) => setResult({ error: e?.message ?? "Erro" }),
  });

  const canSend = phones.length > 0 && ((kind === "text" && message.trim()) || (kind === "image" && imageUrl.trim()));

  return (
    <section className="grid lg:grid-cols-[1fr_360px] gap-4">
      <div className="rounded-3xl border border-border bg-card/60 backdrop-blur-xl p-5 space-y-4">
        <h2 className="font-display text-lg">Conteúdo</h2>

        <div className="inline-flex rounded-xl border border-border p-1 bg-background/40">
          {(["text", "image"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={["px-4 py-1.5 text-sm rounded-lg transition-smooth", kind === k ? "bg-primary text-primary-foreground" : "text-muted-foreground"].join(" ")}
            >
              {k === "text" ? "Texto" : "Imagem"}
            </button>
          ))}
        </div>

        {kind === "text" ? (
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={8}
            placeholder="Digite a mensagem…"
            className="w-full rounded-xl border border-border bg-background/40 px-3 py-2 text-sm"
          />
        ) : (
          <div className="space-y-2">
            <input
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://… (URL pública da imagem)"
              className="w-full rounded-xl border border-border bg-background/40 px-3 py-2 text-sm font-mono"
            />
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={4}
              placeholder="Legenda (opcional)"
              className="w-full rounded-xl border border-border bg-background/40 px-3 py-2 text-sm"
            />
            {imageUrl && <img src={imageUrl} alt="" className="max-h-48 rounded-xl border border-border" />}
          </div>
        )}

        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Números extras (opcional)</p>
          <textarea
            value={extraPhones}
            onChange={(e) => setExtraPhones(e.target.value)}
            rows={2}
            placeholder="5511999999999, 5521988887777"
            className="w-full rounded-xl border border-border bg-background/40 px-3 py-2 text-xs font-mono"
          />
        </div>

        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={() => mutation.mutate()}
            disabled={!canSend || mutation.isPending}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
            {mutation.isPending ? "Enviando…" : `Enviar para ${phones.length} contato(s)`}
          </button>
        </div>

        {result && (
          <div className="rounded-xl border border-border bg-background/40 p-3 text-xs space-y-1 max-h-56 overflow-auto">
            {result.error && <p className="text-destructive">{result.error}</p>}
            {result.results?.map((r: any, i: number) => (
              <div key={i} className="flex items-center gap-2">
                {r.ok ? <CheckCircle2 className="h-3.5 w-3.5 text-primary" /> : <XCircle className="h-3.5 w-3.5 text-destructive" />}
                <span className="font-mono">{r.phone}</span>
                {r.error && <span className="text-destructive truncate">— {r.error}</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-3xl border border-border bg-card/60 backdrop-blur-xl p-5">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-display text-lg">Contatos</h2>
          <button onClick={toggleAll} className="text-xs text-primary">
            {selected.size === contacts.length && contacts.length > 0 ? "Limpar" : "Todos"}
          </button>
        </div>
        <div className="space-y-1 max-h-[480px] overflow-auto">
          {contacts.length === 0 && <p className="text-sm text-muted-foreground">Cadastre contatos na aba "Contatos".</p>}
          {contacts.map((c: any) => {
            const on = selected.has(c.phone);
            return (
              <label key={c.id} className={["flex items-center gap-2 rounded-lg border px-3 py-2 cursor-pointer text-sm transition-smooth", on ? "border-primary/40 bg-primary/10" : "border-border bg-background/30"].join(" ")}>
                <input type="checkbox" checked={on} onChange={() => toggle(c.phone)} />
                <div className="min-w-0 flex-1">
                  <p className="truncate">{c.name || "(sem nome)"}</p>
                  <p className="text-[11px] text-muted-foreground font-mono">{c.phone}</p>
                </div>
              </label>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ============ Histórico ============ */
function HistoryCard() {
  const list = useServerFn(adminListWhatsappTimeline);
  const { data = [] } = useQuery({ queryKey: ["wa-timeline"], queryFn: () => list(), refetchInterval: 5000 });
  const [filter, setFilter] = useState<"all" | "broadcast" | "in" | "out" | "error">("all");
  const [openId, setOpenId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (filter === "all") return data;
    if (filter === "error") return data.filter((i: any) => i.error || i.status === "error" || i.status?.endsWith("_error"));
    return data.filter((i: any) => i.kind === filter);
  }, [data, filter]);

  const tabs = [
    { id: "all", label: "Todos", icon: History },
    { id: "broadcast", label: "Disparos", icon: Megaphone },
    { id: "in", label: "Recebidos", icon: ArrowDownLeft },
    { id: "out", label: "Respostas bot", icon: ArrowUpRight },
    { id: "error", label: "Com erro", icon: XCircle },
  ] as const;

  return (
    <section className="rounded-3xl border border-border bg-card/60 backdrop-blur-xl p-5 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="font-display text-lg">Timeline ({filtered.length})</h2>
        <div className="flex flex-wrap gap-1.5">
          {tabs.map((t) => {
            const Icon = t.icon;
            const on = filter === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setFilter(t.id)}
                className={["inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-smooth", on ? "border-primary/50 bg-primary/10 text-foreground" : "border-border bg-background/30 text-muted-foreground"].join(" ")}
              >
                <Icon className="h-3 w-3" /> {t.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="divide-y divide-border">
        {filtered.length === 0 && <p className="text-sm text-muted-foreground py-4">Nada por aqui.</p>}
        {filtered.map((i: any) => {
          const isError = i.error || i.status === "error" || i.status?.endsWith("_error");
          const Icon = i.kind === "broadcast" ? Megaphone : i.kind === "in" ? ArrowDownLeft : ArrowUpRight;
          const color = isError ? "text-destructive" : i.kind === "in" ? "text-primary" : i.kind === "out" ? "text-emerald-400" : "text-amber-400";
          const open = openId === i.id;
          return (
            <div key={i.id} className="py-2.5 text-sm">
              <button onClick={() => setOpenId(open ? null : i.id)} className="w-full text-left">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-2">
                    <Icon className={`h-3.5 w-3.5 ${color}`} />
                    <span className="font-mono">{i.phone}</span>
                    <span>· {i.media}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] border border-border ${isError ? "text-destructive" : ""}`}>{i.status}</span>
                  </span>
                  <span>{new Date(i.when).toLocaleString("pt-BR")}</span>
                </div>
                <p className="mt-1 truncate">{i.content || <span className="text-muted-foreground">(sem conteúdo)</span>}</p>
                {i.error && <p className="text-xs text-destructive mt-0.5">{i.error}</p>}
              </button>
              {open && (
                <pre className="mt-2 max-h-72 overflow-auto rounded-lg border border-border bg-background/40 p-2 text-[10px] font-mono whitespace-pre-wrap break-all">
                  {JSON.stringify(i.detail, null, 2)}
                </pre>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ============ Status da instância ============ */
function StatusCard() {
  const getStatus = useServerFn(adminGetZapiStatus);
  const getDevice = useServerFn(adminGetZapiDevice);
  const [data, setData] = useState<{ status?: any; device?: any; error?: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const check = async () => {
    setLoading(true);
    setData(null);
    try {
      const [s, d] = await Promise.all([getStatus(), getDevice()]);
      setData({ status: s, device: d });
    } catch (e: any) {
      setData({ error: e?.message ?? "Erro" });
    } finally {
      setLoading(false);
    }
  };

  const st = data?.status?.data;
  const dv = data?.device?.data;
  const connected = !!(st?.connected ?? st?.smartphoneConnected);

  return (
    <section className="rounded-3xl border border-border bg-card/60 backdrop-blur-xl p-5 space-y-4 max-w-2xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="font-display text-lg inline-flex items-center gap-2"><Activity className="h-4 w-4 text-primary" /> Status da instância</h2>
          <p className="text-xs text-muted-foreground">Consulta os endpoints <code>/status</code> e <code>/device</code> da Z-API.</p>
        </div>
        <button
          onClick={check}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          <Activity className="h-4 w-4" /> {loading ? "Verificando…" : "Verificar status"}
        </button>
      </div>

      {data?.error && <p className="text-sm text-destructive">{data.error}</p>}

      {data && !data.error && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className={["inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs border", connected ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" : "border-destructive/40 bg-destructive/10 text-destructive"].join(" ")}>
              {connected ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
              {connected ? "Conectado" : "Desconectado"}
            </span>
            {st?.session && <span className="text-xs text-muted-foreground">sessão: {String(st.session)}</span>}
          </div>

          {dv && (
            <div className="rounded-xl border border-border bg-background/40 p-3 text-sm">
              <div className="flex items-center gap-2 text-primary mb-2"><Smartphone className="h-4 w-4" /> Aparelho</div>
              <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1 text-xs">
                {dv.phone && <p><span className="text-muted-foreground">Número:</span> <span className="font-mono">{dv.phone}</span></p>}
                {dv.device && <p><span className="text-muted-foreground">Aparelho:</span> {dv.device}</p>}
                {dv.deviceManufacturer && <p><span className="text-muted-foreground">Fabricante:</span> {dv.deviceManufacturer}</p>}
                {dv.deviceModel && <p><span className="text-muted-foreground">Modelo:</span> {dv.deviceModel}</p>}
                {dv.platform && <p><span className="text-muted-foreground">Plataforma:</span> {dv.platform}</p>}
                {dv.batteryLevel !== undefined && <p><span className="text-muted-foreground">Bateria:</span> {dv.batteryLevel}%</p>}
                {dv.waVersion && <p><span className="text-muted-foreground">WA versão:</span> {dv.waVersion}</p>}
              </div>
            </div>
          )}

          <details className="rounded-xl border border-border bg-background/40 p-3 text-xs">
            <summary className="cursor-pointer text-muted-foreground">Resposta crua</summary>
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px]">
{JSON.stringify({ status: data.status, device: data.device }, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </section>
  );
}
