import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Activity, CheckCircle2, XCircle, RefreshCw, Loader2 } from "lucide-react";
import { adminSystemHealth } from "@/lib/system-health.functions";

export const Route = createFileRoute("/admin/diagnostico")({
  head: () => ({ meta: [{ title: "Diagnóstico · Shark Money Admin" }, { name: "robots", content: "noindex" }] }),
  component: Page,
});

function Page() {
  const run = useServerFn(adminSystemHealth);
  const q = useQuery({
    queryKey: ["admin-system-health"],
    queryFn: () => run() as any,
    refetchInterval: 30_000,
  });

  const checks: Array<{ name: string; ok: boolean; detail?: string; latencyMs?: number }> =
    (q.data as any)?.checks ?? [];
  const allOk = (q.data as any)?.ok;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 grid place-items-center rounded-2xl border border-primary/30 bg-primary/10 text-primary">
            <Activity className="h-6 w-6" />
          </div>
          <div>
            <h1 className="font-display text-3xl">Diagnóstico do sistema</h1>
            <p className="text-sm text-muted-foreground">Status em tempo real de todos os módulos do Shark Money.</p>
          </div>
        </div>
        <button
          onClick={() => q.refetch()}
          disabled={q.isFetching}
          className="inline-flex items-center gap-2 rounded-xl border border-border bg-card/60 px-4 py-2 text-sm hover:border-primary/40 disabled:opacity-50"
        >
          {q.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Re-testar
        </button>
      </header>

      {q.isLoading && (
        <div className="rounded-2xl border border-border bg-card/60 p-8 text-center text-sm text-muted-foreground">
          Rodando checks…
        </div>
      )}

      {q.data && (
        <>
          <div
            className={[
              "rounded-2xl border p-5 flex items-center gap-4",
              allOk
                ? "border-primary/40 bg-primary/10"
                : "border-destructive/40 bg-destructive/10",
            ].join(" ")}
          >
            {allOk ? (
              <CheckCircle2 className="h-8 w-8 text-primary" />
            ) : (
              <XCircle className="h-8 w-8 text-destructive" />
            )}
            <div>
              <p className="font-display text-xl">
                {allOk ? "Todos os sistemas operacionais" : "Atenção: alguns sistemas com problema"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Última verificação: {new Date((q.data as any).timestamp).toLocaleString("pt-BR")}
              </p>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            {checks.map((c) => (
              <div
                key={c.name}
                className={[
                  "rounded-2xl border p-4 backdrop-blur-xl",
                  c.ok ? "border-primary/30 bg-primary/5" : "border-destructive/40 bg-destructive/5",
                ].join(" ")}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {c.ok ? (
                      <CheckCircle2 className="h-4 w-4 text-primary" />
                    ) : (
                      <XCircle className="h-4 w-4 text-destructive" />
                    )}
                    <p className="font-medium text-sm">{c.name}</p>
                  </div>
                  {typeof c.latencyMs === "number" && c.latencyMs > 0 && (
                    <span className="text-[11px] text-muted-foreground font-mono">{c.latencyMs}ms</span>
                  )}
                </div>
                {c.detail && (
                  <p className={`text-xs mt-2 ${c.ok ? "text-muted-foreground" : "text-destructive"}`}>{c.detail}</p>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {q.isError && (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-5 text-sm text-destructive">
          Falha ao executar diagnóstico: {(q.error as any)?.message ?? "erro desconhecido"}
        </div>
      )}
    </div>
  );
}
