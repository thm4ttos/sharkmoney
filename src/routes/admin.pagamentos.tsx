import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { CreditCard, Save, CheckCircle2, XCircle, Plug } from "lucide-react";
import { adminGetAppmaxCreds, adminSaveAppmaxCreds, adminTestAppmaxConnection } from "@/lib/appmax-admin.functions";

export const Route = createFileRoute("/admin/pagamentos")({
  head: () => ({ meta: [{ title: "Pagamentos · Abio Admin" }, { name: "robots", content: "noindex" }] }),
  component: Page,
});

function Page() {
  return (
    <div className="space-y-8">
      <motion.header initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
        className="flex items-center gap-4">
        <div className="h-12 w-12 grid place-items-center rounded-2xl border border-primary/30 bg-gradient-brand-soft text-primary">
          <CreditCard className="h-5 w-5" />
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-primary">Pagamentos</p>
          <h1 className="font-display text-3xl mt-1">Gateway (Appmax)</h1>
        </div>
      </motion.header>

      <CredsCard />
    </div>
  );
}

function CredsCard() {
  const get = useServerFn(adminGetAppmaxCreds);
  const save = useServerFn(adminSaveAppmaxCreds);
  const test = useServerFn(adminTestAppmaxConnection);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["appmax-creds"], queryFn: () => get() });

  const [form, setForm] = useState({ client_id: "", client_secret: "", external_id: "", environment: "sandbox" as "sandbox" | "production" });
  const [touched, setTouched] = useState(false);

  useMemo(() => {
    if (data && !touched) {
      setForm({
        client_id: data.client_id ?? "",
        client_secret: data.client_secret ?? "",
        external_id: data.external_id ?? "",
        environment: (data.environment as "sandbox" | "production") ?? "sandbox",
      });
    }
  }, [data, touched]);

  const mutation = useMutation({
    mutationFn: () => save({ data: form }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["appmax-creds"] }),
  });
  const testMutation = useMutation({ mutationFn: () => test() as any });

  return (
    <section className="rounded-3xl border border-border bg-card/60 backdrop-blur-xl p-5 space-y-4 max-w-2xl">
      <div>
        <h2 className="font-display text-lg">Credenciais Appmax</h2>
        <p className="text-xs text-muted-foreground">
          Criadas no painel da Appmax ao registrar um "app" privado (Loja de Aplicativos). O <b>External ID</b> não é
          secreto — vai pro navegador (exigido pelo Appmax.js pra tokenizar cartão no checkout). Comece em <b>sandbox</b>,
          teste uma compra de ponta a ponta, e só então mude pra <b>produção</b>.
        </p>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : (
        <div className="space-y-3">
          <Field label="Client ID" value={form.client_id} onChange={(v) => { setTouched(true); setForm((f) => ({ ...f, client_id: v })); }} mono />
          <Field label="Client Secret" value={form.client_secret} onChange={(v) => { setTouched(true); setForm((f) => ({ ...f, client_secret: v })); }} mono />
          <Field label="External ID (app da Appmax)" value={form.external_id} onChange={(v) => { setTouched(true); setForm((f) => ({ ...f, external_id: v })); }} mono />

          <label className="block">
            <span className="block text-xs uppercase tracking-wider text-muted-foreground mb-1">Ambiente</span>
            <select
              value={form.environment}
              onChange={(e) => { setTouched(true); setForm((f) => ({ ...f, environment: e.target.value as "sandbox" | "production" })); }}
              className="w-full rounded-xl border border-border bg-background/40 px-3 py-2 text-sm outline-none focus:border-primary/50"
            >
              <option value="sandbox">Sandbox (testes)</option>
              <option value="production">Produção</option>
            </select>
          </label>

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

            <button
              onClick={() => testMutation.mutate()}
              disabled={testMutation.isPending}
              className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm hover:bg-background/40 disabled:opacity-50"
            >
              <Plug className="h-4 w-4" /> {testMutation.isPending ? "Testando…" : "Testar conexão"}
            </button>
          </div>
          {testMutation.data?.ok && (
            <p className="text-xs text-primary inline-flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" /> Conectado ({testMutation.data.environment}) — a Appmax aceitou as credenciais.
            </p>
          )}
          {testMutation.data && !testMutation.data.ok && (
            <p className="text-xs text-destructive inline-flex items-center gap-1">
              <XCircle className="h-3.5 w-3.5" /> {testMutation.data.error}
            </p>
          )}
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
