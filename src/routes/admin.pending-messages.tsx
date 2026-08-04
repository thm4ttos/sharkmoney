import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Inbox, RefreshCw, AlertTriangle, CheckCircle2, Clock, Phone, Timer, Zap, Ban } from "lucide-react";
import { getPendingMessagesPanel, reprocessPendingMessages } from "@/lib/wa-pending.functions";

export const Route = createFileRoute("/admin/pending-messages")({
  head: () => ({ meta: [{ title: "Mensagens Pendentes · Admin" }] }),
  component: Page,
});

function fmt(ts: string | null) {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleString("pt-BR");
}

function StatCard({ label, value, icon: Icon, tone = "default" }: any) {
  const toneCls =
    tone === "error" ? "border-destructive/40 text-destructive" :
    tone === "warn" ? "border-amber-500/40 text-amber-400" :
    tone === "ok" ? "border-emerald-500/40 text-emerald-400" :
    "border-border text-foreground";
  return (
    <div className={`rounded-2xl border ${toneCls} bg-card/60 p-4`}>
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        <Icon className="h-4 w-4" /> {label}
      </div>
      <p className="font-display text-3xl mt-2">{value}</p>
    </div>
  );
}

function Page() {
  const fetchPanel = useServerFn(getPendingMessagesPanel);
  const reprocess = useServerFn(reprocessPendingMessages);
  const qc = useQueryClient();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["wa-pending"],
    queryFn: () => fetchPanel() as any,
    refetchInterval: 15_000,
  });

  const [lastRun, setLastRun] = useState<any>(null);

  const m = useMutation({
    mutationFn: () => reprocess({ data: { limit: 100 } }) as any,
    onSuccess: (res) => { setLastRun(res); qc.invalidateQueries({ queryKey: ["wa-pending"] }); },
  });

  const stats = data?.stats;
  const list = data?.list ?? [];

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-3xl">Mensagens Pendentes</h1>
          <p className="text-sm text-muted-foreground">Monitoramento e reprocessamento de mensagens WhatsApp não respondidas.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => refetch()} className="inline-flex items-center gap-2 rounded-xl border border-border bg-background/60 px-4 py-2 text-sm hover:border-primary/40">
            <RefreshCw className="h-4 w-4" /> Atualizar
          </button>
          <button
            disabled={m.isPending}
            onClick={() => m.mutate()}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-brand text-white px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${m.isPending ? "animate-spin" : ""}`} />
            {m.isPending ? "Reprocessando..." : "Reprocessar Pendentes"}
          </button>
        </div>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Pendentes" value={stats?.pending ?? "—"} icon={Clock} tone={(stats?.pending ?? 0) > 0 ? "warn" : "ok"} />
        <StatCard label="Processadas (24h)" value={stats?.processed ?? "—"} icon={CheckCircle2} tone="ok" />
        <StatCard label="Erros (24h)" value={stats?.errors ?? "—"} icon={AlertTriangle} tone={(stats?.errors ?? 0) > 0 ? "error" : "default"} />
        <StatCard label="Total 24h" value={stats?.last24h ?? "—"} icon={Inbox} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Tempo médio (resposta)"
          value={stats ? `${(stats.avgResponseMs / 1000).toFixed(2)}s` : "—"}
          icon={Timer}
          tone={stats && stats.avgResponseMs > 3000 ? "warn" : "ok"}
        />
        <StatCard
          label="Maior tempo"
          value={stats ? `${(stats.maxResponseMs / 1000).toFixed(2)}s` : "—"}
          icon={Zap}
          tone={stats && stats.maxResponseMs > 5000 ? "error" : stats && stats.maxResponseMs > 3000 ? "warn" : "ok"}
        />
        <StatCard
          label="Fora do SLA (>3s)"
          value={stats?.overSlaCount ?? "—"}
          icon={AlertTriangle}
          tone={(stats?.overSlaCount ?? 0) > 0 ? "warn" : "ok"}
        />
        <StatCard
          label="Falha permanente"
          value={stats?.failedPermanent ?? "—"}
          icon={Ban}
          tone={(stats?.failedPermanent ?? 0) > 0 ? "error" : "default"}
        />
      </div>

      <div className="rounded-2xl border border-border bg-card/60 p-4 text-sm space-y-1">
        <p><span className="text-muted-foreground">Última mensagem recebida: </span><span className="font-medium">{fmt(stats?.lastMessageAt ?? null)}</span> <span className="text-muted-foreground">({stats?.lastMessageStatus ?? "—"})</span></p>
        <p className="text-xs text-muted-foreground">SLA-alvo: até 3s por mensagem. Watchdog roda a cada 30s recuperando qualquer mensagem pendente. Retry automático até 6 tentativas antes de marcar falha permanente. Status: {JSON.stringify(stats?.counts ?? {})}</p>
        {lastRun ? (
          <p className="text-xs text-emerald-400 mt-2">Última execução manual: {lastRun.processed} processadas em {lastRun.durationMs}ms.</p>
        ) : null}
      </div>

      <div className="rounded-2xl border border-border bg-card/60 overflow-hidden">
        <div className="px-4 py-3 border-b border-border text-sm font-medium">Mensagens com status não-final ({list.length})</div>
        {isLoading ? (
          <div className="p-6 text-sm text-muted-foreground">Carregando…</div>
        ) : list.length === 0 ? (
          <div className="p-6 text-sm text-emerald-400 flex items-center gap-2"><CheckCircle2 className="h-4 w-4" /> Nenhuma pendência. Tudo respondido!</div>
        ) : (
          <div className="divide-y divide-border">
            {list.map((r: any) => (
              <div key={r.id} className="px-4 py-3 flex items-start gap-3">
                <div className="rounded-lg bg-background/60 border border-border p-2 mt-1"><Phone className="h-4 w-4" /></div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{r.phone} <span className="text-xs text-muted-foreground">· {fmt(r.created_at)}</span></p>
                  <p className="text-sm text-muted-foreground truncate">{r.transcription || r.content || "(sem texto)"}</p>
                </div>
                <span className={`text-[11px] uppercase tracking-wider rounded-full px-2 py-1 border ${
                  r.status === "error" || r.status === "ai_error" || r.status === "send_error" || r.status === "transcribe_error"
                    ? "border-destructive/40 text-destructive"
                    : "border-amber-500/40 text-amber-400"
                }`}>{r.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
