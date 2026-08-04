import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Copy, RefreshCw } from "lucide-react";

export const Route = createFileRoute("/admin/duplicates")({
  head: () => ({ meta: [{ title: "Mensagens Duplicadas · Admin" }] }),
  component: Page,
});

const REASON_LABEL: Record<string, string> = {
  duplicate_message_id: "Mesmo messageId recebido novamente",
  duplicate_message_id_race: "Race: mesmo messageId em paralelo",
  duplicate_content_30s: "Conteúdo idêntico em <30s",
};

function Page() {
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["admin-wa-duplicates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wa_duplicate_log" as any)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data as any[];
    },
    refetchInterval: 15_000,
  });

  return (
    <div className="space-y-6 animate-fade-in">
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 grid place-items-center rounded-2xl border border-amber-500/30 bg-amber-500/10 text-amber-300">
            <Copy className="h-5 w-5" />
          </div>
          <div>
            <h1 className="font-display text-2xl">Mensagens Duplicadas</h1>
            <p className="text-sm text-muted-foreground">Webhooks/mensagens bloqueadas pelo controle de idempotência.</p>
          </div>
        </div>
        <button
          onClick={() => refetch()}
          className="inline-flex items-center gap-2 rounded-xl border border-border bg-card/60 px-3 py-2 text-sm hover:border-primary/40"
        >
          <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} /> Atualizar
        </button>
      </header>

      <div className="rounded-3xl border border-border bg-card/60 backdrop-blur-xl overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-sm text-muted-foreground">Carregando…</div>
        ) : !data || data.length === 0 ? (
          <div className="p-12 text-center">
            <p className="font-display text-lg">Nenhuma duplicata bloqueada 🎉</p>
            <p className="text-sm text-muted-foreground mt-1">O sistema está processando cada mensagem uma única vez.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-background/40 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left p-3">Quando</th>
                  <th className="text-left p-3">Telefone</th>
                  <th className="text-left p-3">Motivo</th>
                  <th className="text-left p-3">Conteúdo</th>
                  <th className="text-left p-3">Tipo</th>
                  <th className="text-right p-3">Valor</th>
                  <th className="text-left p-3">messageId</th>
                </tr>
              </thead>
              <tbody>
                {data.map((r) => (
                  <tr key={r.id} className="border-t border-border hover:bg-background/30">
                    <td className="p-3 whitespace-nowrap text-muted-foreground">
                      {new Date(r.created_at).toLocaleString("pt-BR")}
                    </td>
                    <td className="p-3 font-mono text-xs">{r.phone || "—"}</td>
                    <td className="p-3">
                      <span className="rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-300 px-2 py-0.5 text-[11px]">
                        {REASON_LABEL[r.reason] ?? r.reason}
                      </span>
                    </td>
                    <td className="p-3 max-w-xs truncate" title={r.content ?? ""}>{r.content ?? "—"}</td>
                    <td className="p-3">{r.kind ?? "—"}</td>
                    <td className="p-3 text-right">{r.amount != null ? `R$ ${Number(r.amount).toFixed(2).replace(".", ",")}` : "—"}</td>
                    <td className="p-3 font-mono text-[11px] text-muted-foreground max-w-[200px] truncate" title={r.raw_message_id ?? ""}>
                      {r.raw_message_id ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-border bg-card/40 p-4 text-xs text-muted-foreground space-y-1">
        <p><b>Proteções ativas:</b></p>
        <p>• <b>UNIQUE</b> em <code>whatsapp_messages.raw_message_id</code> — impede gravar a mesma mensagem duas vezes.</p>
        <p>• <b>Janela de 30s</b> por usuário/tipo/valor/descrição em <code>transactions</code> — bloqueia reenvios com novo messageId.</p>
        <p>• Fila por telefone garante processamento sequencial sem perda.</p>
      </div>
    </div>
  );
}
