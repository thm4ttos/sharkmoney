import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ArrowLeft, CreditCard, ShieldCheck, Loader2, CheckCircle2, XCircle, QrCode, Copy, Check } from "lucide-react";
import { getPlan, subscriptionPlans, monthlyEquivalent, savings, brl, type SubscriptionPlanId } from "@/lib/plans";
import { startCheckout, getMyCheckoutIntent, getMercadoPagoPublicConfig } from "@/lib/mercadopago.functions";

const PLAN_IDS_SET = new Set(subscriptionPlans.map((p) => p.id));

export const Route = createFileRoute("/app/checkout")({
  validateSearch: (s: Record<string, unknown>) => ({
    plan: (typeof s.plan === "string" && PLAN_IDS_SET.has(s.plan as SubscriptionPlanId) ? s.plan : "monthly") as string,
  }),
  head: () => ({ meta: [{ title: "Assinar · Abio" }] }),
  component: Page,
});

declare global {
  interface Window {
    MercadoPago?: new (publicKey: string, opts?: { locale?: string }) => {
      createCardToken: (params: Record<string, string>) => Promise<{ id: string }>;
    };
  }
}

const MP_SCRIPT_SRC = "https://sdk.mercadopago.com/js/v2";

function Page() {
  const { plan: planSlug } = Route.useSearch();
  const navigate = useNavigate();
  const plan = getPlan(planSlug) ?? subscriptionPlans[0];

  const [paymentMethod, setPaymentMethod] = useState<"credit_card" | "pix">("credit_card");
  const [cardNumber, setCardNumber] = useState("");
  const [holderName, setHolderName] = useState("");
  const [expMonth, setExpMonth] = useState("");
  const [expYear, setExpYear] = useState("");
  const [cvv, setCvv] = useState("");
  const [documentNumber, setDocumentNumber] = useState("");
  const [scriptReady, setScriptReady] = useState(false);
  const [scriptError, setScriptError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ status: "completed" | "failed" | "pending"; reason?: string } | null>(null);
  const [pendingIntentId, setPendingIntentId] = useState<string | null>(null);
  const [pixData, setPixData] = useState<{ qrCodeBase64: string | null; emv: string | null } | null>(null);
  const [copied, setCopied] = useState(false);

  // Trocar de plano no meio do fluxo limpa qualquer erro/resultado em exibição.
  useEffect(() => {
    setResult(null);
    setError("");
    setPendingIntentId(null);
    setPixData(null);
  }, [planSlug]);

  const runConfig = useServerFn(getMercadoPagoPublicConfig);
  const runCheckout = useServerFn(startCheckout);
  const runIntent = useServerFn(getMyCheckoutIntent);

  const config = useQuery({ queryKey: ["mercadopago-public-config"], queryFn: () => runConfig() as any });

  // Carrega o SDK JS do Mercado Pago só uma vez, assim que a public key estiver disponível.
  useEffect(() => {
    if (!config.data?.publicKey) return;
    if (window.MercadoPago) { setScriptReady(true); return; }
    const existing = document.querySelector(`script[src="${MP_SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => setScriptReady(true));
      return;
    }
    const script = document.createElement("script");
    script.src = MP_SCRIPT_SRC;
    script.async = true;
    script.onload = () => setScriptReady(true);
    script.onerror = () => setScriptError("Não foi possível carregar o formulário de cartão. Recarregue a página e tente de novo.");
    document.body.appendChild(script);
  }, [config.data?.publicKey]);

  // Enquanto espera a confirmação assíncrona (assinatura ficou "pending" no
  // Mercado Pago), faz polling simples do status via checkout_intents.
  const intentStatus = useQuery({
    queryKey: ["checkout-intent", pendingIntentId],
    queryFn: () => runIntent({ data: { intentId: pendingIntentId! } }) as any,
    enabled: !!pendingIntentId,
    refetchInterval: (q) => (q.state.data?.status === "pending" ? 4000 : false),
  });
  useEffect(() => {
    if (intentStatus.data?.status && intentStatus.data.status !== "pending") {
      setResult({ status: intentStatus.data.status });
    }
  }, [intentStatus.data?.status]);

  const submitCard = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const doc = documentNumber.replace(/\D/g, "");
    if (doc.length !== 11) { setError("Informe um CPF válido."); return; }
    if (!scriptReady || !config.data?.publicKey || !window.MercadoPago) {
      setError("O formulário de cartão ainda está carregando, aguarde um instante.");
      return;
    }
    setSubmitting(true);
    try {
      const mp = new window.MercadoPago(config.data.publicKey, { locale: "pt-BR" });
      // Tokenização acontece aqui, no navegador — o servidor do Abio nunca
      // recebe número de cartão/CVV, só o token já gerado.
      const cardToken = await mp.createCardToken({
        cardNumber: cardNumber.replace(/\s/g, ""),
        cardholderName: holderName.trim(),
        cardExpirationMonth: expMonth.trim(),
        cardExpirationYear: expYear.trim(),
        securityCode: cvv.trim(),
        identificationType: "CPF",
        identificationNumber: doc,
      });
      const res = await runCheckout({ data: { planSlug: plan.slug, paymentMethod: "credit_card", document: doc, cardToken: cardToken.id } }) as any;
      if (res.status === "pending") setPendingIntentId(res.intentId);
      else setResult({ status: res.status, reason: res.reason });
    } catch (e: any) {
      setError(e?.message || "Cartão recusado ou dados inválidos. Confira e tente de novo.");
    } finally {
      setSubmitting(false);
    }
  };

  const submitPix = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const doc = documentNumber.replace(/\D/g, "");
    if (doc.length !== 11) { setError("Informe um CPF válido."); return; }
    setSubmitting(true);
    try {
      const res = await runCheckout({ data: { planSlug: plan.slug, paymentMethod: "pix", document: doc } }) as any;
      if (res.status === "pending") {
        setPixData({ qrCodeBase64: res.pixQrCode ?? null, emv: res.pixEmv ?? null });
        setPendingIntentId(res.intentId);
      } else {
        setResult({ status: res.status, reason: res.reason });
      }
    } catch (e: any) {
      setError(e?.message || "Não foi possível gerar o Pix. Tente de novo.");
    } finally {
      setSubmitting(false);
    }
  };

  const copyPixCode = async () => {
    if (!pixData?.emv) return;
    try {
      await navigator.clipboard.writeText(pixData.emv);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch { /* clipboard indisponível — o campo abaixo continua selecionável manualmente */ }
  };

  if (result) {
    return (
      <div className="max-w-lg mx-auto">
        <ResultCard result={result} plan={plan} />
      </div>
    );
  }

  if (pendingIntentId && pixData) {
    return (
      <div className="max-w-lg mx-auto">
        <div className="rounded-3xl border border-border bg-card/60 backdrop-blur-xl p-8 text-center space-y-4">
          <h1 className="font-display text-2xl">Pague com Pix pra ativar</h1>
          <p className="text-sm text-muted-foreground">Escaneie o QR code ou copie o código abaixo no app do seu banco.</p>
          {pixData.qrCodeBase64 && (
            <img src={`data:image/png;base64,${pixData.qrCodeBase64}`} alt="QR code Pix"
              className="mx-auto h-52 w-52 rounded-xl border border-border bg-white p-2" />
          )}
          {pixData.emv && (
            <div className="text-left">
              <label className="text-xs text-muted-foreground">Pix copia e cola</label>
              <div className="mt-1 flex gap-2">
                <input readOnly value={pixData.emv}
                  className="flex-1 min-w-0 bg-input rounded-xl px-3 py-2.5 text-xs truncate" />
                <button onClick={copyPixCode} type="button"
                  className="shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-gradient-brand text-primary-foreground px-3 py-2.5 text-xs glow-neon">
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? "Copiado" : "Copiar"}
                </button>
              </div>
            </div>
          )}
          <div className="inline-flex items-center gap-2 text-sm text-muted-foreground pt-1">
            <Loader2 className="h-4 w-4 animate-spin" /> Aguardando confirmação do pagamento...
          </div>
        </div>
      </div>
    );
  }

  if (pendingIntentId) {
    return (
      <div className="max-w-lg mx-auto">
        <div className="rounded-3xl border border-border bg-card/60 backdrop-blur-xl p-8 text-center space-y-3">
          <Loader2 className="h-10 w-10 animate-spin mx-auto text-primary" />
          <h1 className="font-display text-2xl">Confirmando pagamento...</h1>
          <p className="text-sm text-muted-foreground">Isso pode levar alguns segundos.</p>
        </div>
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
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="font-display text-3xl">Assinar {plan.name}</h1>
          <span className="inline-flex items-center rounded-full border border-neon/40 bg-neon/10 px-2.5 py-0.5 text-xs font-semibold" style={{ color: "#39D353" }}>
            {plan.discountPercentage}% OFF
          </span>
        </div>
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
        <div>
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-muted-foreground">Valor</span>
            <div className="text-right">
              <span className="text-xs text-muted-foreground line-through mr-1.5">{brl(plan.originalPrice)}{plan.billing === "one_time" ? "/mês" : ""}</span>
              <span className="font-display text-2xl">{brl(plan.totalPrice)}</span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground text-right mt-0.5">
            {plan.billing === "one_time" ? `${brl(monthlyEquivalent(plan))}/mês equivalente — ` : ""}você economiza {brl(savings(plan))}
          </p>
        </div>

        <div className="flex gap-2">
          <button type="button" onClick={() => { setPaymentMethod("credit_card"); setError(""); }}
            className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition-smooth ${paymentMethod === "credit_card" ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-background/40"}`}>
            <CreditCard className="h-3.5 w-3.5" /> Cartão de crédito
          </button>
          <button type="button" onClick={() => { setPaymentMethod("pix"); setError(""); }}
            className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition-smooth ${paymentMethod === "pix" ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-background/40"}`}>
            <QrCode className="h-3.5 w-3.5" /> Pix
          </button>
        </div>

        {paymentMethod === "credit_card" ? (
          <>
            <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <CreditCard className="h-4 w-4" /> Cobrança automática no cartão
            </div>

            <form onSubmit={submitCard} className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground">CPF do titular</label>
                <input value={documentNumber} onChange={(e) => setDocumentNumber(e.target.value)}
                  placeholder="000.000.000-00" inputMode="numeric"
                  className="w-full mt-1 bg-input rounded-xl px-3 py-2.5 text-sm" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Número do cartão</label>
                <input value={cardNumber} onChange={(e) => setCardNumber(e.target.value)}
                  placeholder="0000 0000 0000 0000" inputMode="numeric"
                  className="w-full mt-1 bg-input rounded-xl px-3 py-2.5 text-sm" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Nome no cartão</label>
                <input value={holderName} onChange={(e) => setHolderName(e.target.value)}
                  placeholder="Como está impresso no cartão"
                  className="w-full mt-1 bg-input rounded-xl px-3 py-2.5 text-sm" />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <input value={expMonth} onChange={(e) => setExpMonth(e.target.value)} placeholder="MM" inputMode="numeric"
                  className="bg-input rounded-xl px-3 py-2.5 text-sm" />
                <input value={expYear} onChange={(e) => setExpYear(e.target.value)} placeholder="AAAA" inputMode="numeric"
                  className="bg-input rounded-xl px-3 py-2.5 text-sm" />
                <input value={cvv} onChange={(e) => setCvv(e.target.value)} placeholder="CVV" inputMode="numeric"
                  className="bg-input rounded-xl px-3 py-2.5 text-sm" />
              </div>

              {scriptError && <p className="text-xs text-destructive">{scriptError}</p>}
              {error && <p className="text-xs text-destructive">{error}</p>}

              <button type="submit" disabled={submitting || !scriptReady}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-brand text-primary-foreground py-2.5 text-sm glow-neon disabled:opacity-50">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                {submitting ? "Processando..." : !scriptReady ? "Carregando formulário seguro..." : `Assinar ${brl(plan.totalPrice)}`}
              </button>
            </form>

            <p className="text-[11px] text-muted-foreground text-center flex items-center justify-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5" /> Pagamento processado com segurança pelo Mercado Pago. Seus dados de cartão nunca passam pelos servidores do Abio.
            </p>
          </>
        ) : (
          <>
            <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <QrCode className="h-4 w-4" /> QR code ou copia-e-cola — renovação exige gerar um novo Pix a cada ciclo
            </div>

            <form onSubmit={submitPix} className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground">Seu CPF</label>
                <input value={documentNumber} onChange={(e) => setDocumentNumber(e.target.value)}
                  placeholder="000.000.000-00" inputMode="numeric"
                  className="w-full mt-1 bg-input rounded-xl px-3 py-2.5 text-sm" />
              </div>

              {error && <p className="text-xs text-destructive">{error}</p>}

              <button type="submit" disabled={submitting}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-brand text-primary-foreground py-2.5 text-sm glow-neon disabled:opacity-50">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />}
                {submitting ? "Gerando..." : `Gerar Pix de ${brl(plan.totalPrice)}`}
              </button>
            </form>

            <p className="text-[11px] text-muted-foreground text-center flex items-center justify-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5" /> Pagamento processado com segurança pelo Mercado Pago.
            </p>
          </>
        )}
      </div>
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
