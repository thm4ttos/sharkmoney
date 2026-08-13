import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ArrowLeft, CreditCard, QrCode, ShieldCheck, Loader2, CheckCircle2, XCircle, Copy } from "lucide-react";
import { getPlan, subscriptionPlans, brl, type SubscriptionPlanId } from "@/lib/plans";
import { startCheckout, getMyCheckoutIntent, getAppmaxPublicConfig } from "@/lib/appmax.functions";

const PLAN_IDS_SET = new Set(subscriptionPlans.map((p) => p.id));

export const Route = createFileRoute("/app/checkout")({
  validateSearch: (s: Record<string, unknown>) => ({
    plan: (typeof s.plan === "string" && PLAN_IDS_SET.has(s.plan as SubscriptionPlanId) ? s.plan : "monthly") as string,
  }),
  head: () => ({ meta: [{ title: "Assinar · Abio" }] }),
  component: Page,
});

declare global {
  interface Window { AppmaxScripts?: { init: (...args: any[]) => void } }
}

const APPMAX_SCRIPT_SRC = "https://scripts.appmax.com.br/appmax.min.js";

/** `appmax-form-element` não é um atributo `data-*` — o Appmax.js exige esse nome exato pra tokenizar o campo. */
function appmaxField(name: "number" | "holder_name" | "expiration_month" | "expiration_year" | "cvv") {
  return { "appmax-form-element": name } as Record<string, string>;
}

function Page() {
  const { plan: planSlug } = Route.useSearch();
  const navigate = useNavigate();
  const plan = getPlan(planSlug) ?? subscriptionPlans[0];

  const [method, setMethod] = useState<"credit_card" | "pix">("credit_card");
  const [documentNumber, setDocumentNumber] = useState("");
  const [installments, setInstallments] = useState(1);
  const [scriptReady, setScriptReady] = useState(false);
  const [scriptError, setScriptError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ status: "completed" | "failed" | "pending"; reason?: string } | null>(null);
  const [pix, setPix] = useState<{ qr: string | null; emv: string | null; intentId: string } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // Trocar de plano no meio do fluxo cancela qualquer Pix pendente/erro em
  // exibição — evita mostrar um QR code ou erro que já não é do plano atual.
  useEffect(() => {
    setPix(null);
    setResult(null);
    setError("");
  }, [planSlug]);

  const runConfig = useServerFn(getAppmaxPublicConfig);
  const runCheckout = useServerFn(startCheckout);
  const runIntent = useServerFn(getMyCheckoutIntent);

  const config = useQuery({ queryKey: ["appmax-public-config"], queryFn: () => runConfig() as any });

  // Carrega o Appmax.js só quando precisa (pagamento por cartão) e só uma vez.
  useEffect(() => {
    if (method !== "credit_card" || !config.data?.externalId) return;
    if (window.AppmaxScripts) { setScriptReady(true); return; }
    const existing = document.querySelector(`script[src="${APPMAX_SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => setScriptReady(true));
      return;
    }
    const script = document.createElement("script");
    script.src = APPMAX_SCRIPT_SRC;
    script.async = true;
    script.onload = () => setScriptReady(true);
    script.onerror = () => setScriptError("Não foi possível carregar o formulário de cartão. Tente Pix ou recarregue a página.");
    document.body.appendChild(script);
  }, [method, config.data?.externalId]);

  // Inicializa o SDK assim que o script + externalId estiverem prontos.
  useEffect(() => {
    if (!scriptReady || !window.AppmaxScripts || !config.data?.externalId) return;
    window.AppmaxScripts.init(
      async (payload: { token: string }) => {
        await finishCardCheckout(payload.token);
      },
      (err: any) => {
        setSubmitting(false);
        setError(err?.message || "Cartão recusado ou dados inválidos. Confira e tente de novo.");
      },
      config.data.externalId,
    );
  }, [scriptReady, config.data?.externalId]);

  async function finishCardCheckout(cardToken: string) {
    try {
      const res = await runCheckout({
        data: { planSlug: plan.slug, paymentMethod: "credit_card", document: documentNumber, cardToken, installments },
      }) as any;
      setResult({ status: res.status, reason: res.reason });
    } catch (e: any) {
      setError(e?.message ?? "Falha ao processar o pagamento.");
    } finally {
      setSubmitting(false);
    }
  }

  const mPix = useMutation({
    mutationFn: async () => {
      const res = await runCheckout({
        data: { planSlug: plan.slug, paymentMethod: "pix", document: documentNumber },
      }) as any;
      return res;
    },
    onSuccess: (res) => {
      setPix({ qr: res.pixQrCode, emv: res.pixEmv, intentId: res.intentId });
    },
    onError: (e: any) => setError(e?.message ?? "Falha ao gerar o Pix."),
  });

  // Enquanto espera a confirmação do Pix, faz polling simples do status.
  const intentStatus = useQuery({
    queryKey: ["checkout-intent", pix?.intentId],
    queryFn: () => runIntent({ data: { intentId: pix!.intentId } }) as any,
    enabled: !!pix?.intentId,
    refetchInterval: (q) => (q.state.data?.status === "pending" ? 4000 : false),
  });
  useEffect(() => {
    if (intentStatus.data?.status && intentStatus.data.status !== "pending") {
      setResult({ status: intentStatus.data.status });
    }
  }, [intentStatus.data?.status]);

  const submitCard = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!documentNumber.trim()) { setError("Informe seu CPF."); return; }
    if (!scriptReady) { setError("O formulário de cartão ainda está carregando, aguarde um instante."); return; }
    setSubmitting(true);
    // O Appmax.js intercepta este submit (form[data-appmax-checkout]),
    // tokeniza os campos [appmax-form-element] e chama o callback onSuccess
    // do init() acima — que então dispara finishCardCheckout().
    formRef.current?.requestSubmit();
  };

  if (result) {
    return (
      <div className="max-w-lg mx-auto">
        <ResultCard result={result} plan={plan} />
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <button onClick={() => navigate({ to: "/app/perfil" })}
        className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1 transition-smooth">
        <ArrowLeft className="h-4 w-4" /> Voltar
      </button>

      <motion.header initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="font-display text-3xl">Assinar {plan.name}</h1>
        <p className="text-sm text-muted-foreground mt-1">{plan.billingLabel} — {plan.accessLabel}</p>
      </motion.header>

      <div className="flex gap-2">
        {subscriptionPlans.map((p) => (
          <Link key={p.id} to="/app/checkout" search={{ plan: p.id }}
            className={`flex-1 rounded-xl border px-3 py-2.5 text-sm text-center transition-smooth ${p.id === plan.id ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-background/40"}`}>
            {p.name.replace("Plano ", "")}
          </Link>
        ))}
      </div>

      <div className="rounded-3xl border border-border bg-card/60 backdrop-blur-xl p-6 shadow-card space-y-5">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-muted-foreground">Valor</span>
          <span className="font-display text-2xl">{brl(plan.totalPrice)}</span>
        </div>

        <div className="flex gap-2">
          <button type="button" onClick={() => setMethod("credit_card")}
            className={`flex-1 inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm transition-smooth ${method === "credit_card" ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-background/40"}`}>
            <CreditCard className="h-4 w-4" /> Cartão
          </button>
          <button type="button" onClick={() => setMethod("pix")}
            className={`flex-1 inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm transition-smooth ${method === "pix" ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-background/40"}`}>
            <QrCode className="h-4 w-4" /> Pix
          </button>
        </div>

        <div>
          <label className="text-xs text-muted-foreground">CPF do titular</label>
          <input value={documentNumber} onChange={(e) => setDocumentNumber(e.target.value)}
            placeholder="000.000.000-00" inputMode="numeric"
            className="w-full mt-1 bg-input rounded-xl px-3 py-2.5 text-sm" />
        </div>

        {method === "credit_card" ? (
          !pix ? (
            <form ref={formRef} data-appmax-checkout onSubmit={submitCard} className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground">Número do cartão</label>
                <input {...appmaxField("number")} placeholder="0000 0000 0000 0000"
                  className="w-full mt-1 bg-input rounded-xl px-3 py-2.5 text-sm" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Nome no cartão</label>
                <input {...appmaxField("holder_name")} placeholder="Como está impresso no cartão"
                  className="w-full mt-1 bg-input rounded-xl px-3 py-2.5 text-sm" />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <input {...appmaxField("expiration_month")} placeholder="MM"
                  className="bg-input rounded-xl px-3 py-2.5 text-sm" />
                <input {...appmaxField("expiration_year")} placeholder="AAAA"
                  className="bg-input rounded-xl px-3 py-2.5 text-sm" />
                <input {...appmaxField("cvv")} placeholder="CVV"
                  className="bg-input rounded-xl px-3 py-2.5 text-sm" />
              </div>
              {plan.billing === "one_time" && (
                <div>
                  <label className="text-xs text-muted-foreground">Parcelas</label>
                  <select value={installments} onChange={(e) => setInstallments(Number(e.target.value))}
                    className="w-full mt-1 bg-input rounded-xl px-3 py-2.5 text-sm">
                    {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}x</option>)}
                  </select>
                </div>
              )}

              {scriptError && <p className="text-xs text-destructive">{scriptError}</p>}
              {error && <p className="text-xs text-destructive">{error}</p>}

              <button type="submit" disabled={submitting || !scriptReady}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-brand text-primary-foreground py-2.5 text-sm glow-neon disabled:opacity-50">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                {submitting ? "Processando..." : !scriptReady ? "Carregando formulário seguro..." : `Assinar ${brl(plan.totalPrice)}`}
              </button>
            </form>
          ) : null
        ) : !pix ? (
          <div className="space-y-3">
            {error && <p className="text-xs text-destructive">{error}</p>}
            <button onClick={() => mPix.mutate()} disabled={mPix.isPending || !documentNumber.trim()}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-brand text-primary-foreground py-2.5 text-sm glow-neon disabled:opacity-50">
              {mPix.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />}
              {mPix.isPending ? "Gerando Pix..." : `Gerar Pix de ${brl(plan.totalPrice)}`}
            </button>
          </div>
        ) : (
          <PixPending pix={pix} />
        )}

        <p className="text-[11px] text-muted-foreground text-center flex items-center justify-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5" /> Pagamento processado com segurança pela Appmax. Seus dados de cartão nunca passam pelos servidores do Abio.
        </p>
      </div>
    </div>
  );
}

function PixPending({ pix }: { pix: { qr: string | null; emv: string | null } }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-3 text-center">
      {pix.qr ? (
        <img src={`data:image/png;base64,${pix.qr}`} alt="QR Code Pix" className="mx-auto rounded-xl border border-border w-48 h-48 object-contain bg-white p-2" />
      ) : null}
      {pix.emv ? (
        <button
          onClick={() => { navigator.clipboard.writeText(pix.emv!); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
          className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-border px-3 py-2.5 text-sm hover:bg-background/40"
        >
          <Copy className="h-4 w-4" /> {copied ? "Copiado!" : "Copiar código Pix"}
        </button>
      ) : null}
      <p className="text-xs text-muted-foreground flex items-center justify-center gap-2">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Aguardando confirmação do pagamento...
      </p>
    </div>
  );
}

function ResultCard({ result, plan }: { result: { status: "completed" | "failed" | "pending"; reason?: string }; plan: ReturnType<typeof getPlan> }) {
  if (result.status === "completed") {
    return (
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
        className="rounded-3xl border border-primary/30 bg-primary/10 p-8 text-center space-y-3">
        <CheckCircle2 className="h-12 w-12 text-primary mx-auto" />
        <h1 className="font-display text-2xl">Assinatura ativada!</h1>
        <p className="text-sm text-muted-foreground">Seu {plan?.name} já está ativo. Bem-vindo(a) de volta ao Abio.</p>
        <Link to="/app/perfil" className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-brand text-primary-foreground px-5 py-2.5 text-sm glow-neon mt-2">
          Ir pro meu perfil
        </Link>
      </motion.div>
    );
  }
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      className="rounded-3xl border border-destructive/30 bg-destructive/10 p-8 text-center space-y-3">
      <XCircle className="h-12 w-12 text-destructive mx-auto" />
      <h1 className="font-display text-2xl">Pagamento não aprovado</h1>
      <p className="text-sm text-muted-foreground">{result.reason || "Não conseguimos confirmar o pagamento. Confira os dados e tente novamente."}</p>
      <Link to="/app/checkout" search={{ plan: plan?.id ?? "monthly" }}
        className="inline-flex items-center justify-center gap-2 rounded-xl border border-border px-5 py-2.5 text-sm hover:bg-background/40 mt-2">
        Tentar de novo
      </Link>
    </motion.div>
  );
}
