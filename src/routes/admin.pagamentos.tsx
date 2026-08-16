import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { CreditCard, Save, CheckCircle2, XCircle, Plug } from "lucide-react";
import { adminGetMercadoPagoCreds, adminSaveMercadoPagoCreds, adminTestMercadoPagoConnection } from "@/lib/mercadopago-admin.functions";

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
          <h1 className="font-display text-3xl mt-1">Gateway (Mercado Pago)</h1>
        </div>
      </motion.header>

      <CredsCard />
    </div>
  );
}

function CredsCard() {
  const get = useServerFn(adminGetMercadoPagoCreds);
  const save = useServerFn(adminSaveMercadoPagoCreds);
  const test = useServerFn(adminTestMercadoPagoConnection);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["mercadopago-creds"], queryFn: () => get() });

  const [form, setForm] = useState({ access_token: "", public_key: "", webhook_secret: "", environment: "sandbox" as "sandbox" | "production" });
  const [touched, setTouched] = useState(false);

  useMemo(() => {
    if (data && !touched) {
      setForm({
        access_token: data.access_token ?? "",
        public_key: data.public_key ?? "",
        webhook_secret: data.webhook_secret ?? "",
        environment: (data.environment as "sandbox" | "production") ?? "sandbox",
      });
    }
  }, [data, touched]);

  const mutation = useMutation({
    mutationFn: () => save({ data: form }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mercadopago-creds"] }),
  });
  const testMutation = useMutation({ mutationFn: () => test() as any });

  return (
    <section className="rounded-3xl border border-border bg-card/60 backdrop-blur-xl p-5 space-y-4 max-w-2xl">
      <div>
        <h2 className="font-display text-lg">Credenciais Mercado Pago</h2>
        <p className="text-xs text-muted-foreground">
          Encontre em <b>Suas integrações → sua aplicação</b>, nas abas "Credenciais de teste" ou "Credenciais de
          produção" no painel do Mercado Pago. O <b>Access Token</b> é privado (servidor). A <b>Public Key</b> não é
          secreta — vai pro navegador (exigida pelo SDK JS pra tokenizar cartão no checkout). O <b>Webhook Secret</b> é
          gerado à parte, ao configurar a URL de notificação em "Webhooks" na mesma tela. Comece em <b>sandbox</b>,
          teste uma compra de ponta a ponta, e só então mude pra <b>produção</b>.
        </p>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : (
        <div className="space-y-3">
          <Field label="Access Token" value={form.access_token} onChange={(v) => { setTouched(true); setForm((f) => ({ ...f, access_token: v })); }} mono />
          <Field label="Public Key" value={form.public_key} onChange={(v) => { setTouched(true); setForm((f) => ({ ...f, public_key: v })); }} mono />
          <Field label="Webhook Secret" value={form.webhook_secret} onChange={(v) => { setTouched(true); setForm((f) => ({ ...f, webhook_secret: v })); }} mono />

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
              <CheckCircle2 className="h-3.5 w-3.5" /> Conectado ({testMutation.data.environment}) — o Mercado Pago aceitou o token.
            </p>
          )}
          {testMutation.data && !testMutation.data.ok && (
            <p className="text-xs text-destructive inline-flex items-center gap-1">
              <XCircle className="h-3.5 w-3.5" /> {testMutation.data.error}
            </p>
          )}

          <p className="text-[11px] text-muted-foreground pt-2 border-t border-border">
            URL de webhook pra configurar no painel do Mercado Pago: <code className="text-primary">https://abio.fun/api/public/hooks/mercadopago-webhook</code> —
            eventos a marcar: <b>subscription_preapproval</b> e <b>subscription_authorized_payment</b>.
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
