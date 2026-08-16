import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { motion } from "framer-motion";
import {
  Crown, Clock, CheckCircle2, XCircle, ArrowUpRight, RefreshCw, ListChecks, Ban, CalendarPlus,
} from "lucide-react";
import { getMySubscription, getMySubscriptionHistory } from "@/lib/subscriptions.functions";
import { cancelMySubscription } from "@/lib/mercadopago.functions";
import { getPlan, subscriptionPlans, brl as brlPlan } from "@/lib/plans";

export const Route = createFileRoute("/app/assinatura")({
  head: () => ({ meta: [{ title: "Assinatura · Abio" }] }),
  component: Page,
});

const brl = (n: number) => (Number.isFinite(n) ? n : 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function Page() {
  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <motion.header initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-4">
        <div className="h-14 w-14 grid place-items-center rounded-2xl border border-border bg-card/60">
          <Crown className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="font-display text-3xl">Assinatura</h1>
          <p className="text-sm text-muted-foreground">Seu plano, dias restantes e histórico de renovações.</p>
        </div>
      </motion.header>

      <SubscriptionCard />
      <AddMoreTimeCard />
      <RenewalHistoryCard />
    </div>
  );
}

function Card({ title, icon: Icon, children, delay = 0, action }: {
  title: string; icon: any; children: React.ReactNode; delay?: number; action?: React.ReactNode;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}
      className="rounded-3xl border border-border bg-card/60 backdrop-blur-xl shadow-card p-5"
    >
      <header className="flex items-center justify-between gap-3 mb-4">
        <h3 className="font-display text-lg flex items-center gap-2">
          <Icon className="h-4 w-4 text-primary" /> {title}
        </h3>
        {action}
      </header>
      {children}
    </motion.section>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: "danger" }) {
  return (
    <div className="rounded-xl border border-border bg-background/30 py-2.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-sm font-medium mt-0.5 ${tone === "danger" ? "text-destructive" : ""}`}>{value}</p>
    </div>
  );
}

function SubscriptionCard() {
  const qc = useQueryClient();
  const fetchSub = useServerFn(getMySubscription);
  const runCancel = useServerFn(cancelMySubscription);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const { data: sub, isLoading } = useQuery<any>({
    queryKey: ["my-subscription"],
    queryFn: () => fetchSub() as any,
  });
  const mCancel = useMutation({
    mutationFn: () => runCancel() as any,
    onSuccess: () => {
      setConfirmingCancel(false);
      qc.invalidateQueries({ queryKey: ["my-subscription"] });
      qc.invalidateQueries({ queryKey: ["my-sub-history"] });
    },
  });

  if (isLoading) return <section className="rounded-3xl border border-border bg-card/60 backdrop-blur-xl p-5 animate-pulse h-32" />;
  if (!sub) return (
    <Card title="Assinatura e plano" icon={Crown}>
      <p className="text-sm text-muted-foreground">Nenhuma assinatura ativa. <Link to="/app/checkout" search={{ plan: "monthly" }} className="text-primary hover:underline">Assine um plano</Link> para aproveitar todos os recursos.</p>
    </Card>
  );

  const now = Date.now();
  const endsAt = sub.ends_at ? new Date(sub.ends_at).getTime() : null;
  const daysLeft = endsAt ? Math.max(0, Math.ceil((endsAt - now) / 86400_000)) : null;
  const isLifetime = sub.period === "lifetime";
  const isExpired = sub.status === "expired" || (endsAt !== null && endsAt < now);
  const isTrial = sub.status === "trial";
  const isCancelled = sub.status === "cancelled";

  const badge = isCancelled
    ? { label: "Cancelado", cls: "bg-muted text-muted-foreground", Icon: XCircle }
    : isExpired
    ? { label: "Expirado", cls: "bg-destructive/15 text-destructive border border-destructive/30", Icon: XCircle }
    : isTrial
    ? { label: "Trial", cls: "bg-amber-500/15 text-amber-300 border border-amber-500/30", Icon: Clock }
    : { label: "Ativo", cls: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30", Icon: CheckCircle2 };

  const periodLabel: Record<string, string> = {
    trial: "Trial", monthly: "Mensal", quarterly: "Trimestral",
    semiannual: "Semestral", annual: "Anual", lifetime: "Vitalício",
  };

  return (
    <Card title="Assinatura e plano" icon={Crown}
      action={
        <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${badge.cls}`}>
          <badge.Icon className="h-3 w-3" /> {badge.label}
        </span>
      }
    >
      <div className="flex items-center gap-3 mb-4">
        <div className="h-11 w-11 grid place-items-center rounded-2xl bg-gradient-brand text-primary-foreground glow-neon">
          <Crown className="h-5 w-5" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Plano atual</p>
          <p className="font-display text-xl">{sub.plan_name}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
        <Tile label="Período" value={periodLabel[sub.period] ?? sub.period} />
        <Tile label="Valor" value={(sub.price_cents ?? 0) > 0 ? brl((sub.price_cents ?? 0) / 100) : "Grátis"} />
        <Tile label={isLifetime ? "Validade" : "Restam"} value={isLifetime ? "∞" : daysLeft !== null ? `${daysLeft} dias` : "—"} tone={daysLeft !== null && daysLeft <= 3 && !isLifetime ? "danger" : undefined} />
        <Tile label="Renovação" value={endsAt && !isLifetime ? new Date(endsAt).toLocaleDateString("pt-BR") : "—"} />
      </div>

      {(() => {
        const checkoutPlan = getPlan(sub.plan_slug)?.id ?? "monthly";
        return (
          <div className="grid sm:grid-cols-3 gap-3 mt-4">
            <Link to="/app/checkout" search={{ plan: checkoutPlan }} className="rounded-xl border border-primary/30 bg-primary/10 text-primary px-3 py-2.5 text-sm inline-flex items-center justify-center gap-2 hover:bg-primary/20">
              <ArrowUpRight className="h-3.5 w-3.5" /> Fazer upgrade
            </Link>
            <Link to="/app/checkout" search={{ plan: checkoutPlan }} className="rounded-xl border border-border bg-background/40 px-3 py-2.5 text-sm hover:bg-background/60 inline-flex items-center justify-center gap-2">
              <RefreshCw className="h-3.5 w-3.5" /> Renovar plano
            </Link>
            <Link to="/app/sistema" search={{ view: "suporte" }} className="rounded-xl border border-border bg-background/40 px-3 py-2.5 text-sm hover:bg-background/60 inline-flex items-center justify-center gap-2">
              <ListChecks className="h-3.5 w-3.5" /> Histórico de pagamentos
            </Link>
          </div>
        );
      })()}

      {!isCancelled && !isExpired && sub.mp_preapproval_id ? (
        <div className="mt-3 flex items-center justify-end">
          {confirmingCancel ? (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Cancelar a renovação automática?</span>
              <button onClick={() => mCancel.mutate()} disabled={mCancel.isPending}
                className="rounded-lg border border-destructive/30 text-destructive px-2.5 py-1.5 hover:bg-destructive/10 disabled:opacity-50">
                {mCancel.isPending ? "Cancelando..." : "Sim, cancelar"}
              </button>
              <button onClick={() => setConfirmingCancel(false)} className="rounded-lg border border-border px-2.5 py-1.5 hover:bg-background/40">
                Voltar
              </button>
            </div>
          ) : (
            <button onClick={() => setConfirmingCancel(true)}
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive">
              <Ban className="h-3.5 w-3.5" /> Cancelar assinatura
            </button>
          )}
        </div>
      ) : null}
    </Card>
  );
}

// Deixa fácil trocar de plano ou adiantar a renovação sem precisar ir em
// Meu Perfil primeiro — mesmos 3 planos do checkout, com preço já visível.
function AddMoreTimeCard() {
  return (
    <Card title="Assinar mais tempo" icon={CalendarPlus}>
      <div className="grid sm:grid-cols-3 gap-3">
        {subscriptionPlans.map((p) => (
          <Link key={p.id} to="/app/checkout" search={{ plan: p.id }}
            className="rounded-2xl border border-border bg-background/40 p-4 hover:border-primary/50 hover:scale-[1.02] transition-smooth text-left">
            <p className="text-xs text-muted-foreground">{p.name}</p>
            <p className="font-display text-xl mt-1">{brlPlan(p.totalPrice)}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">{p.accessLabel}</p>
          </Link>
        ))}
      </div>
    </Card>
  );
}

function RenewalHistoryCard() {
  const fetchHist = useServerFn(getMySubscriptionHistory);
  const { data: rows = [], isLoading } = useQuery<any[]>({
    queryKey: ["my-sub-history"],
    queryFn: () => fetchHist() as any,
  });
  if (isLoading) return <section className="rounded-3xl border border-border bg-card/60 backdrop-blur-xl p-5 animate-pulse h-24" />;
  if (rows.length === 0) return null;

  const periodLabel: Record<string, string> = {
    trial: "Trial", monthly: "Mensal", quarterly: "Trimestral",
    semiannual: "Semestral", annual: "Anual", lifetime: "Vitalício",
  };

  return (
    <Card title="Histórico de renovações" icon={Clock}>
      <ol className="relative border-l border-border ml-2 space-y-4">
        {rows.map((r) => {
          const statusCls =
            r.status === "active" ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" :
            r.status === "trial" ? "bg-amber-500/15 text-amber-300 border-amber-500/30" :
            r.status === "expired" ? "bg-destructive/15 text-destructive border-destructive/30" :
            "bg-muted text-muted-foreground border-border";
          return (
            <li key={r.id} className="ml-4">
              <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full bg-gradient-brand glow-neon" />
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="text-sm font-medium">{r.plan_name} <span className="text-xs text-muted-foreground">· {periodLabel[r.period] ?? r.period}</span></p>
                <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border ${statusCls}`}>{r.status}</span>
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {new Date(r.started_at).toLocaleDateString("pt-BR")}
                {r.ends_at ? ` → ${new Date(r.ends_at).toLocaleDateString("pt-BR")}` : ""}
                {r.price_cents ? ` · ${(r.price_cents/100).toLocaleString("pt-BR",{style:"currency",currency:"BRL"})}` : ""}
              </p>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
