import { useEffect, useRef, useState } from "react";
import { Check, Sparkles } from "lucide-react";
import { Reveal, StaggerGroup, StaggerItem } from "./Reveal";
import {
  subscriptionPlans,
  monthlyEquivalent,
  savings,
  brl,
  type SubscriptionPlan,
} from "@/lib/plans";

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

/** Anima 0 -> target apenas quando entra na viewport, uma única vez. */
function useCountUpOnView(target: number, duration = 900) {
  const ref = useRef<HTMLDivElement | null>(null);
  const reduced = usePrefersReducedMotion();
  const [value, setValue] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (reduced) {
      setValue(target);
      setDone(true);
      return;
    }
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        io.disconnect();
        const start = performance.now();
        const tick = (now: number) => {
          const t = Math.min(1, (now - start) / duration);
          const eased = 1 - Math.pow(1 - t, 3);
          setValue(target * eased);
          if (t < 1) raf = requestAnimationFrame(tick);
          else setDone(true);
        };
        raf = requestAnimationFrame(tick);
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [target, duration, reduced]);

  return { ref, value, done };
}

function PlanCard({ plan }: { plan: SubscriptionPlan }) {
  const { ref, value, done } = useCountUpOnView(plan.discountPercentage, 1000);
  const eq = monthlyEquivalent(plan);

  return (
    <div
      ref={ref}
      className={[
        "relative h-full rounded-3xl p-6 border bg-card-xl transition-colors hover:-translate-y-1.5",
        plan.highlight
          ? "border-primary/50 bg-card"
          : "border-border hover:border-primary/50",
      ].join(" ")}
    >
      {plan.badges.length > 0 && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap px-3 py-1 rounded-full text-[11px] font-semibold bg-primary text-primary-foreground">
          {plan.badges[0]}
        </span>
      )}

      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {plan.name}
      </p>


      {/* Destaque principal: percentual */}
      <div
        className={[
          "mt-3 inline-flex items-baseline gap-1 rounded-2xl border border-neon/40 bg-neon/10 px-4 py-2 transition-all duration-500",
          done ? "shadow-[0_0_28px_-6px_hsl(var(--neon,142_70%_45%)/0.55)] scale-[1.02]" : "",
        ].join(" ")}
        style={{ color: "#39D353" }}
      >
        <span className="font-display text-4xl sm:text-5xl leading-none tabular-nums">
          {Math.round(value)}%
        </span>
        <span className="text-sm font-semibold tracking-wide">OFF</span>
      </div>

      <div className="mt-4">
        <p className="text-sm text-muted-foreground">
          De{" "}
          <span className="line-through tabular-nums">{brl(plan.originalPrice)}</span>
          {plan.billing === "one_time" ? "/mês" : ""}
        </p>
        <div
          className={[
            "flex items-baseline gap-2 flex-wrap transition-all duration-700",
            done ? "opacity-100 translate-y-0" : "opacity-70 translate-y-1",
          ].join(" ")}
        >
          <span className="text-sm text-muted-foreground">Por</span>
          <span className="font-display text-4xl tabular-nums">{brl(eq)}</span>
          <span className="text-sm text-muted-foreground">/mês</span>
        </div>
        <p className="text-sm font-medium text-foreground mt-2 tabular-nums">
          {plan.billingLabel}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {plan.accessLabel} · você economiza {brl(savings(plan))}
        </p>
      </div>


      <ul className="mt-5 space-y-2.5">
        {plan.features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-sm">
            <Check className="h-4 w-4 text-neon mt-0.5 shrink-0" />
            <span className="text-foreground/90">{f}</span>
          </li>
        ))}
      </ul>

      <a
        href={`/signup?plan=${plan.id}`}
        className={[
          "mt-6 block text-center w-full rounded-full py-3.5 sm:py-3 text-sm font-medium transition-colors active:scale-[0.98]",
          plan.highlight
            ? "bg-primary text-primary-foreground hover:bg-primary/90"
            : "bg-secondary text-foreground hover:bg-secondary/70 border border-border",
        ].join(" ")}
      >
        {plan.cta}
      </a>
    </div>
  );
}

export function Pricing() {
  return (
    <section id="planos" className="relative px-5 sm:px-6 py-20 md:py-28 scroll-mt-20">
      <div className="mx-auto max-w-6xl">
        <Reveal className="text-center max-w-2xl mx-auto">
          <span className="inline-flex items-center gap-2 rounded-full border border-neon/40 bg-neon/10 px-3 py-1 text-xs text-neon">
            <Sparkles className="h-3.5 w-3.5" /> 7 dias grátis · sem cartão
          </span>
          <h2 className="font-display text-3xl sm:text-4xl md:text-5xl mt-5 leading-tight">
            Escolha seu plano e <span className="text-gradient-brand">economize até 70%</span>
          </h2>
          <p className="text-muted-foreground mt-3 text-base md:text-lg">
            Três opções, sem pegadinha. Comece grátis e cancele quando quiser.
          </p>
        </Reveal>

        <StaggerGroup className="mt-10 md:mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {subscriptionPlans.map((p) => (
            <StaggerItem key={p.id}>
              <PlanCard plan={p} />
            </StaggerItem>
          ))}
        </StaggerGroup>

        <p className="mt-8 text-center text-sm text-muted-foreground max-w-2xl mx-auto">
          Os valores mensais dos planos semestral e anual são equivalentes. O pagamento do
          período completo é realizado de uma só vez.
        </p>
      </div>
    </section>
  );

}
