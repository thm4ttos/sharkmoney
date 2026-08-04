import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Server, RefreshCw, Loader2, AlertCircle, MessageSquare, Activity, Trash2, ShieldAlert } from "lucide-react";
import { motion } from "framer-motion";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { adminSystemHealth } from "@/lib/system-health.functions";
import { adminSystemMetrics } from "@/lib/sistema.functions";
import { getDemoDataStats, cleanupDemoData } from "@/lib/admin-cleanup.functions";

export const Route = createFileRoute("/admin/sistema")({
  head: () => ({ meta: [{ title: "Sistema · Shark Money Admin" }, { name: "robots", content: "noindex" }] }),
  component: Page,
});

const STATUS_LABEL: Record<string, string> = {
  received: "Recebida",
  processed: "Processada",
  sent: "Enviada",
  send_error: "Falha de envio",
  ai_error: "Erro IA",
  ai_disabled: "IA off",
};

function Page() {
  const health = useServerFn(adminSystemHealth);
  const metrics = useServerFn(adminSystemMetrics);

  const hq = useQuery({ queryKey: ["admin-health"], queryFn: () => health() as any, refetchInterval: 30_000 });
  const mq = useQuery({ queryKey: ["admin-metrics"], queryFn: () => metrics() as any, refetchInterval: 30_000 });

  const [tab, setTab] = useState<"webhooks" | "failures">("webhooks");

  const checks = (hq.data as any)?.checks ?? [];
  const totals = (mq.data as any)?.totals ?? { in: 0, out: 0, ai: 0, failures: 0 };
  const usage = (mq.data as any)?.usage ?? [];
  const recent = (mq.data as any)?.recent ?? [];
  const failures = (mq.data as any)?.failures ?? [];

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 grid place-items-center rounded-2xl border border-primary/30 bg-primary/10 text-primary">
            <Server className="h-6 w-6" />
          </div>
          <div>
            <h1 className="font-display text-3xl">Central de Sistema</h1>
            <p className="text-sm text-muted-foreground">Controle total da operação Shark Money em tempo real.</p>
          </div>
        </div>
        <button
          onClick={() => { hq.refetch(); mq.refetch(); }}
          disabled={hq.isFetching || mq.isFetching}
          className="inline-flex items-center gap-2 rounded-xl border border-border bg-card/60 px-4 py-2 text-sm hover:border-primary/40 disabled:opacity-50"
        >
          {(hq.isFetching || mq.isFetching) ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Atualizar
        </button>
      </header>

      {/* Status grid */}
      <section className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {checks.map((c: any, i: number) => (
          <motion.div
            key={c.name}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04, duration: 0.4 }}
            className={[
              "rounded-2xl border p-4 backdrop-blur-xl",
              c.ok ? "border-primary/30 bg-primary/5" : "border-destructive/40 bg-destructive/5",
            ].join(" ")}
          >
            <div className="flex items-center justify-between">
              <p className="font-medium text-sm flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${c.ok ? "bg-primary" : "bg-destructive"} animate-pulse`} />
                {c.name}
              </p>
              {typeof c.latencyMs === "number" && c.latencyMs > 0 && (
                <span className="text-[11px] text-muted-foreground font-mono">{c.latencyMs}ms</span>
              )}
            </div>
            {c.detail ? (
              <p className={`text-xs mt-2 ${c.ok ? "text-muted-foreground" : "text-destructive"}`}>{c.detail}</p>
            ) : null}
          </motion.div>
        ))}
      </section>

      {/* Consumption KPIs */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Recebidas (7d)" value={totals.in} tone="brand" />
        <Kpi label="Enviadas (7d)" value={totals.out} tone="brand" />
        <Kpi label="Processadas pela IA" value={totals.ai} tone="neutral" />
        <Kpi label="Falhas" value={totals.failures} tone={totals.failures > 0 ? "danger" : "neutral"} />
      </section>

      {/* Consumption chart */}
      <section className="rounded-3xl border border-border bg-card/60 backdrop-blur-xl p-5">
        <h2 className="font-display text-xl">Consumo nos últimos 7 dias</h2>
        <p className="text-xs text-muted-foreground mb-4">WhatsApp + OpenAI</p>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={usage}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(1 0 0 / 0.06)" />
              <XAxis dataKey="label" stroke="oklch(0.714 0.019 261.3)" fontSize={11} />
              <YAxis stroke="oklch(0.714 0.019 261.3)" fontSize={11} />
              <Tooltip contentStyle={{ background: "oklch(0.239 0.018 266.2)", border: "1px solid oklch(0.544 0.252 262.5 / 45%)", borderRadius: 12, color: "white" }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="in" name="Recebidas" fill="oklch(0.544 0.252 262.5)" radius={[6, 6, 0, 0]} />
              <Bar dataKey="out" name="Enviadas" fill="oklch(0.723 0.192 149.6)" radius={[6, 6, 0, 0]} />
              <Bar dataKey="ai" name="IA" fill="oklch(0.861 0.173 91.9)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Tabs */}
      <section className="rounded-3xl border border-border bg-card/60 backdrop-blur-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <TabBtn active={tab === "webhooks"} onClick={() => setTab("webhooks")} icon={MessageSquare}>
            Últimos webhooks ({recent.length})
          </TabBtn>
          <TabBtn active={tab === "failures"} onClick={() => setTab("failures")} icon={AlertCircle}>
            Falhas ({failures.length})
          </TabBtn>
        </div>

        {tab === "webhooks" ? (
          <Table
            empty="Nenhum webhook recente."
            head={["Quando", "Telefone", "Direção", "Tipo", "Status", "Conteúdo"]}
            rows={recent.map((r: any) => [
              new Date(r.created_at).toLocaleString("pt-BR"),
              r.phone,
              r.direction,
              r.media_type,
              STATUS_LABEL[r.status] ?? r.status,
              truncate(r.content ?? "—", 60),
            ])}
          />
        ) : (
          <Table
            empty="Sem falhas registradas. Tudo certo!"
            head={["Quando", "Telefone", "Status", "Conteúdo"]}
            rows={failures.map((r: any) => [
              new Date(r.created_at).toLocaleString("pt-BR"),
              r.phone,
              STATUS_LABEL[r.status] ?? r.status,
              truncate(r.content ?? "—", 80),
            ])}
          />
        )}
      </section>

      <DemoCleanupCard />

      <p className="text-[11px] text-muted-foreground text-center inline-flex items-center gap-1.5 justify-center w-full">
        <Activity className="h-3 w-3" /> Atualiza automaticamente a cada 30 segundos.
      </p>
    </div>
  );
}

const TABLE_LABEL: Record<string, string> = {
  transactions: "Transações",
  appointments: "Compromissos",
  whatsapp_messages: "Mensagens",
  wa_broadcasts: "Disparos",
};

function DemoCleanupCard() {
  const stats = useServerFn(getDemoDataStats);
  const cleanup = useServerFn(cleanupDemoData);
  const sq = useQuery({ queryKey: ["admin-demo-stats"], queryFn: () => stats() as any });
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const data = (sq.data ?? {}) as Record<string, { demo: number; real: number }>;
  const totalDemo = Object.values(data).reduce((a, b) => a + (b?.demo ?? 0), 0);
  const totalReal = Object.values(data).reduce((a, b) => a + (b?.real ?? 0), 0);

  async function run() {
    setBusy(true); setErr(null);
    try {
      const r = await cleanup();
      setReport(r);
      setConfirming(false);
      sq.refetch();
    } catch (e: any) {
      setErr(e?.message ?? "Falha ao executar limpeza.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-3xl border border-destructive/30 bg-destructive/5 backdrop-blur-xl p-5">
      <div className="flex items-start gap-4">
        <div className="h-12 w-12 grid place-items-center rounded-2xl border border-destructive/40 bg-destructive/10 text-destructive">
          <Trash2 className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="font-display text-xl">Limpar dados de demonstração</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Remove todos os registros marcados como <code className="text-foreground">is_demo = true</code>. Contas, credenciais, planos, permissões e configurações de sistema não são afetadas.
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
            {Object.entries(TABLE_LABEL).map(([k, label]) => (
              <div key={k} className="rounded-xl border border-border bg-background/40 p-3">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
                <p className="text-lg font-display mt-0.5">{data[k]?.demo ?? 0}</p>
                <p className="text-[10px] text-muted-foreground">demo · {data[k]?.real ?? 0} reais</p>
              </div>
            ))}
          </div>

          {!confirming && !report && (
            <button
              onClick={() => setConfirming(true)}
              disabled={sq.isLoading || totalDemo === 0}
              className="mt-4 inline-flex items-center gap-2 rounded-xl border border-destructive/50 bg-destructive/10 text-destructive px-4 py-2 text-sm hover:bg-destructive/20 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
              {totalDemo === 0 ? "Nada a limpar" : `Limpar ${totalDemo} registros de demonstração`}
            </button>
          )}

          {confirming && !report && (
            <div className="mt-4 rounded-2xl border border-destructive/40 bg-background/60 p-4">
              <p className="flex items-start gap-2 text-sm">
                <ShieldAlert className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                Esta ação removerá permanentemente todos os dados de teste e demonstração. Deseja continuar?
              </p>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={run}
                  disabled={busy}
                  className="inline-flex items-center gap-2 rounded-xl bg-destructive text-destructive-foreground px-4 py-2 text-sm hover:opacity-90 disabled:opacity-50"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  Sim, limpar agora
                </button>
                <button
                  onClick={() => setConfirming(false)}
                  disabled={busy}
                  className="rounded-xl border border-border bg-card/60 px-4 py-2 text-sm hover:border-primary/40"
                >
                  Cancelar
                </button>
              </div>
              {err && <p className="text-xs text-destructive mt-2">{err}</p>}
            </div>
          )}

          {report && (
            <div className="mt-4 rounded-2xl border border-primary/40 bg-primary/5 p-4 text-sm">
              <p className="font-medium text-primary">Limpeza concluída ✓</p>
              <ul className="mt-2 space-y-1 text-xs">
                {Object.entries(TABLE_LABEL).map(([k, label]) => (
                  <li key={k} className="flex justify-between border-b border-border/30 py-1">
                    <span className="text-muted-foreground">{label}</span>
                    <span>
                      <strong className="text-destructive">−{report.removed?.[k] ?? 0}</strong>
                      <span className="text-muted-foreground"> · {report.preserved?.[k] ?? 0} preservados</span>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs">
                Total removido: <strong>{report.totals.removed}</strong> ·
                Total preservado (dados reais): <strong>{report.totals.preserved}</strong>
              </p>
              <button
                onClick={() => { setReport(null); }}
                className="mt-3 text-xs underline text-muted-foreground hover:text-foreground"
              >
                Fechar relatório
              </button>
            </div>
          )}

          {!confirming && !report && totalReal > 0 && (
            <p className="text-[11px] text-muted-foreground mt-3">
              {totalReal} registros reais protegidos e não serão tocados.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function Kpi({ label, value, tone }: { label: string; value: number; tone: "brand" | "neutral" | "danger" }) {
  const cls =
    tone === "danger"
      ? "border-destructive/40 bg-destructive/10 text-destructive"
      : tone === "brand"
        ? "border-primary/30 bg-gradient-brand-soft"
        : "border-border bg-card/60";
  return (
    <div className={`rounded-2xl border p-4 ${cls}`}>
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="font-display text-2xl mt-1">{value}</p>
    </div>
  );
}

function TabBtn({ active, onClick, children, icon: Icon }: any) {
  return (
    <button
      onClick={onClick}
      className={[
        "inline-flex items-center gap-2 rounded-xl px-3 py-1.5 text-sm border transition-smooth",
        active ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-background/40 text-muted-foreground hover:text-foreground",
      ].join(" ")}
    >
      <Icon className="h-3.5 w-3.5" />
      {children}
    </button>
  );
}

function Table({ head, rows, empty }: { head: string[]; rows: any[][]; empty: string }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground py-8 text-center">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-muted-foreground border-b border-border">
            {head.map((h) => <th key={h} className="py-2 pr-3 font-medium">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-border/40 hover:bg-background/30">
              {r.map((c, j) => <td key={j} className="py-2 pr-3 align-top">{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n) + "…" : s;
}
