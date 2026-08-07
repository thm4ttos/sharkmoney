import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Gauge, RefreshCw, Loader2, AlertTriangle, CheckCircle2, Activity, Users, Copy, Timer } from "lucide-react";
import { getAdminDiagnostics } from "@/lib/admin-diagnostics.functions";

export const Route = createFileRoute("/admin/metricas")({
  head: () => ({ meta: [{ title: "Métricas & Fila · Abio Admin" }, { name: "robots", content: "noindex" }] }),
  component: Page,
});

function Page() {
  const [windowHours, setWindowHours] = useState(24);
  const run = useServerFn(getAdminDiagnostics);
  const q = useQuery({
    queryKey: ["admin-diagnostics", windowHours],
    queryFn: () => run({ data: { windowHours } }) as any,
    refetchInterval: 30_000,
  });
  const d: any = q.data ?? {};

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 grid place-items-center rounded-2xl border border-primary/30 bg-primary/10 text-primary">
            <Gauge className="h-6 w-6" />
          </div>
          <div>
            <h1 className="font-display text-3xl">Métricas & Fila</h1>
            <p className="text-sm text-muted-foreground">Confiabilidade, tempo de resposta e reprocessamentos.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {[6, 24, 72, 168].map((h) => (
            <button
              key={h}
              onClick={() => setWindowHours(h)}
              className={`rounded-xl border px-3 py-1.5 text-sm ${windowHours === h ? "border-primary bg-primary/10 text-primary" : "border-border bg-card/60 hover:border-primary/40"}`}
            >
              {h === 168 ? "7d" : `${h}h`}
            </button>
          ))}
          <button
            onClick={() => q.refetch()}
            disabled={q.isFetching}
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-card/60 px-3 py-1.5 text-sm hover:border-primary/40 disabled:opacity-50"
          >
            {q.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Atualizar
          </button>
        </div>
      </header>

      {q.isLoading && (
        <div className="rounded-2xl border border-border bg-card/60 p-8 text-center text-sm text-muted-foreground">Carregando…</div>
      )}

      {q.data && (
        <>
          <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Kpi icon={Activity} label="Mensagens" value={d.messages?.total ?? 0} sub={`${d.messages?.processing ?? 0} em processamento`} />
            <Kpi icon={AlertTriangle} label="Falhas WA" value={d.messages?.failed ?? 0} tone="danger" />
            <Kpi icon={Timer} label="Resposta p50 / p95" value={`${d.latency?.p50 ?? 0} / ${d.latency?.p95 ?? 0} ms`} sub={`amostra ${d.latency?.samples ?? 0}`} />
            <Kpi icon={Users} label="Usuários ativos" value={d.activeUsers ?? 0} />
            <Kpi icon={CheckCircle2} label="Jobs concluídos" value={(d.jobs?.total ?? 0) - (d.jobs?.pending ?? 0) - (d.jobs?.failed ?? 0)} />
            <Kpi icon={Loader2} label="Jobs pendentes" value={d.jobs?.pending ?? 0} />
            <Kpi icon={AlertTriangle} label="Jobs falhos" value={d.jobs?.failed ?? 0} tone={d.jobs?.failed ? "danger" : undefined} />
            <Kpi icon={Copy} label="Duplicatas evitadas" value={d.duplicatesAvoided ?? 0} />
          </section>

          <section className="rounded-2xl border border-border bg-card/60 p-5">
            <h2 className="font-display text-xl mb-3">Performance por função</h2>
            {(!d.fnStats || d.fnStats.length === 0) ? (
              <p className="text-sm text-muted-foreground">Sem dados de métrica neste período. As instrumentações começam a preencher quando os pipelines gravarem em <code>system_metrics</code>.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase text-muted-foreground">
                    <tr><th className="py-2">Função</th><th>Total</th><th>OK</th><th>Falha</th><th>Média (ms)</th></tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {d.fnStats.map((f: any) => (
                      <tr key={f.fn}>
                        <td className="py-2 font-mono text-xs">{f.fn}</td>
                        <td>{f.total}</td>
                        <td className="text-emerald-500">{f.ok}</td>
                        <td className={f.fail ? "text-red-500" : ""}>{f.fail}</td>
                        <td>{f.avg_ms}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-border bg-card/60 p-5">
            <h2 className="font-display text-xl mb-3">Últimos erros</h2>
            {(!d.recentErrors || d.recentErrors.length === 0) ? (
              <p className="text-sm text-muted-foreground">Nenhum erro registrado no período. 🎉</p>
            ) : (
              <ul className="space-y-2">
                {d.recentErrors.map((e: any) => (
                  <li key={e.id} className="rounded-xl border border-red-500/20 bg-red-500/5 p-3 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono text-xs">{e.fn_name}{e.stage ? ` · ${e.stage}` : ""}</span>
                      <span className="text-xs text-muted-foreground">{new Date(e.created_at).toLocaleString("pt-BR")}</span>
                    </div>
                    <p className="mt-1 text-red-400 text-xs break-words">{e.error_code ? `[${e.error_code}] ` : ""}{e.error_message}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-border bg-card/60 p-5">
            <h2 className="font-display text-xl mb-3">Fila WhatsApp — jobs a reprocessar</h2>
            {(!d.failedJobs || d.failedJobs.length === 0) ? (
              <p className="text-sm text-muted-foreground">Nenhum job pendente ou falho. A fila alimenta assim que o novo pipeline entrar no ar.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase text-muted-foreground">
                    <tr><th className="py-2">Job</th><th>Stage</th><th>Status</th><th>Tent.</th><th>Erro</th><th>Atualizado</th></tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {d.failedJobs.map((j: any) => (
                      <tr key={j.id}>
                        <td className="py-2 font-mono text-[10px]">{String(j.id).slice(0, 8)}</td>
                        <td>{j.stage}</td>
                        <td>{j.status}</td>
                        <td>{j.attempts}</td>
                        <td className="text-red-400 text-xs max-w-[280px] truncate" title={j.last_error ?? ""}>{j.last_error ?? "—"}</td>
                        <td className="text-xs text-muted-foreground">{new Date(j.updated_at).toLocaleString("pt-BR")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Kpi({ icon: Icon, label, value, sub, tone }: { icon: any; label: string; value: any; sub?: string; tone?: "danger" }) {
  return (
    <div className={`rounded-2xl border p-4 ${tone === "danger" ? "border-red-500/30 bg-red-500/5" : "border-border bg-card/60"}`}>
      <div className="flex items-center justify-between text-xs uppercase text-muted-foreground">
        <span>{label}</span>
        <Icon className="h-4 w-4" />
      </div>
      <div className={`mt-1 font-display text-2xl ${tone === "danger" ? "text-red-400" : ""}`}>{value}</div>
      {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
    </div>
  );
}
