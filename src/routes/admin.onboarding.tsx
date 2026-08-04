import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ClipboardList, RefreshCw, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/admin/onboarding")({
  head: () => ({
    meta: [{ title: "Onboarding · Shark Money Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: Page,
});

type Row = {
  user_id: string;
  status: string;
  current_step: string;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
  answers: any;
  profile?: { name: string | null; email: string | null; phone: string | null } | null;
};

function Page() {
  const q = useQuery({
    queryKey: ["admin-onboarding"],
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase
        .from("onboarding_progress")
        .select("*")
        .order("updated_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      const ids = (data ?? []).map((r: any) => r.user_id);
      if (!ids.length) return [];
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, name, email, phone")
        .in("id", ids);
      const map = new Map((profs ?? []).map((p: any) => [p.id, p]));
      return (data as any[]).map((r) => ({ ...r, profile: map.get(r.user_id) ?? null }));
    },
    refetchInterval: 30_000,
  });

  const rows = q.data ?? [];
  const stats = {
    invited: rows.filter((r) => r.status === "invited").length,
    in_progress: rows.filter((r) => r.status === "in_progress").length,
    completed: rows.filter((r) => r.status === "completed").length,
    declined: rows.filter((r) => r.status === "declined").length,
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 grid place-items-center rounded-2xl border border-primary/30 bg-primary/10 text-primary">
            <ClipboardList className="h-6 w-6" />
          </div>
          <div>
            <h1 className="font-display text-3xl">Onboarding</h1>
            <p className="text-sm text-muted-foreground">
              Status do onboarding conversacional dos usuários.
            </p>
          </div>
        </div>
        <button
          onClick={() => q.refetch()}
          disabled={q.isFetching}
          className="inline-flex items-center gap-2 rounded-xl border border-border bg-card/60 px-4 py-2 text-sm hover:border-primary/40 disabled:opacity-50"
        >
          {q.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Atualizar
        </button>
      </header>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { k: "Convidados", v: stats.invited, c: "text-amber-400 border-amber-500/30 bg-amber-500/10" },
          { k: "Em progresso", v: stats.in_progress, c: "text-sky-400 border-sky-500/30 bg-sky-500/10" },
          { k: "Concluídos", v: stats.completed, c: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10" },
          { k: "Recusados", v: stats.declined, c: "text-rose-400 border-rose-500/30 bg-rose-500/10" },
        ].map((s) => (
          <div key={s.k} className={`rounded-2xl border px-4 py-3 ${s.c}`}>
            <div className="text-xs uppercase opacity-80">{s.k}</div>
            <div className="text-2xl font-semibold">{s.v}</div>
          </div>
        ))}
      </section>

      <section className="rounded-2xl border border-border bg-card/60 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left">
            <tr>
              <th className="px-4 py-2">Usuário</th>
              <th className="px-4 py-2">Telefone</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Etapa</th>
              <th className="px-4 py-2">Atualizado</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.user_id} className="border-t border-border/60">
                <td className="px-4 py-2">
                  <div className="font-medium">{r.profile?.name || r.answers?.name || "—"}</div>
                  <div className="text-xs text-muted-foreground">{r.profile?.email}</div>
                </td>
                <td className="px-4 py-2 font-mono text-xs">{r.profile?.phone || "—"}</td>
                <td className="px-4 py-2 capitalize">{r.status.replace("_", " ")}</td>
                <td className="px-4 py-2"><code className="text-xs">{r.current_step}</code></td>
                <td className="px-4 py-2 text-xs text-muted-foreground">
                  {new Date(r.updated_at).toLocaleString("pt-BR")}
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  Nenhum onboarding iniciado ainda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
