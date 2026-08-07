import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { ArrowRight, LayoutDashboard, MessageCircle, Sparkles } from "lucide-react";
import { useRef } from "react";
import { Navbar, scrollToSection } from "@/components/brinzap/landing/Navbar";
import { HeroChat } from "@/components/brinzap/landing/HeroChat";
import { StartSteps } from "@/components/brinzap/landing/StartSteps";
import { ChatExamples } from "@/components/brinzap/landing/ChatExamples";
import { FeatureChips } from "@/components/brinzap/landing/FeatureChips";
import { GiftPopup } from "@/components/brinzap/landing/GiftPopup";
import { Benefits } from "@/components/brinzap/landing/Benefits";
import { HowItWorks } from "@/components/brinzap/landing/HowItWorks";
import { DashboardShowcase } from "@/components/brinzap/landing/DashboardShowcase";
import { Differentials } from "@/components/brinzap/landing/Differentials";
import { Comparison } from "@/components/brinzap/landing/Comparison";
import { SocialProof } from "@/components/brinzap/landing/SocialProof";
import { FAQ } from "@/components/brinzap/landing/FAQ";
import { Pricing } from "@/components/brinzap/landing/Pricing";
import { Footer } from "@/components/brinzap/landing/Footer";
import { Reveal } from "@/components/brinzap/landing/Reveal";
import { LandingI18nProvider, useLandingI18n } from "@/lib/landing-i18n";


export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Abio — Seu Assistente Financeiro e Pessoal no WhatsApp" },
      {
        name: "description",
        content:
          "Organize suas finanças, compromissos e lembretes diretamente pelo WhatsApp. Simples, inteligente e sempre com você.",
      },
      { property: "og:title", content: "Abio — Seu Assistente Financeiro e Pessoal no WhatsApp" },
      {
        property: "og:description",
        content:
          "Organize suas finanças, compromissos e lembretes diretamente pelo WhatsApp. Simples, inteligente e sempre com você.",
      },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "Abio" },
      { property: "og:url", content: "https://abio.fun" },
      { property: "og:image", content: "https://abio.fun/og-abio.jpg" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: "Abio — Seu Assistente Financeiro e Pessoal no WhatsApp" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Abio — Seu Assistente Financeiro e Pessoal no WhatsApp" },
      {
        name: "twitter:description",
        content:
          "Organize suas finanças, compromissos e lembretes diretamente pelo WhatsApp. Simples, inteligente e sempre com você.",
      },
      { name: "twitter:image", content: "https://abio.fun/og-abio.jpg" },
    ],
    links: [
      { rel: "canonical", href: "https://abio.fun" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Sora:wght@500;600;700&family=Inter:wght@400;500;600&display=swap",
      },
    ],
  }),

  component: LandingPage,
});

function Hero() {
  const ref = useRef<HTMLElement>(null);
  const { t } = useLandingI18n();

  return (
    <section ref={ref} className="relative px-5 sm:px-6 pt-12 sm:pt-20 pb-20 md:pb-32">
      <div className="mx-auto max-w-7xl">
        <div className="grid lg:grid-cols-[1fr_0.9fr] gap-14 lg:gap-20 items-center">
          <div className="text-center lg:text-left">
            <motion.span
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-[11px] sm:text-xs text-muted-foreground"
            >
              <MessageCircle className="h-3.5 w-3.5 text-primary shrink-0" strokeWidth={1.75} />
              {t("hero.badge")}
            </motion.span>

            <motion.h1
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.05, ease: [0.4, 0, 0.2, 1] }}
              className="font-display text-[2.6rem] leading-[1.06] sm:text-6xl lg:text-[4.25rem] mt-8 font-semibold"
            >
              {t("hero.title1")}
              <br />
              <span className="text-gradient-brand">{t("hero.title2")}</span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.12 }}
              className="text-muted-foreground text-base sm:text-lg mt-6 max-w-lg mx-auto lg:mx-0 leading-relaxed"
            >
              {t("hero.sub")}
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.18 }}
              className="mt-9 flex flex-col sm:flex-row items-stretch sm:items-center justify-center lg:justify-start gap-3"
            >
              <Link
                to="/signup"
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground text-base font-semibold px-7 py-4 shadow-card hover:bg-primary/90 hover:-translate-y-0.5 transition-all duration-200"
              >
                {t("cta.start")} <ArrowRight className="h-4 w-4" strokeWidth={2} />
              </Link>
              <button
                onClick={() => scrollToSection("#dashboard")}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-transparent px-6 py-4 text-sm text-muted-foreground hover:text-foreground hover:border-border/80 transition-colors"
              >
                <LayoutDashboard className="h-4 w-4" strokeWidth={1.75} /> {t("hero.secondary")}
              </button>
            </motion.div>

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.26 }}
              className="mt-6 text-xs text-muted-foreground"
            >
              <Sparkles className="inline h-3.5 w-3.5 mr-1.5 -mt-0.5" strokeWidth={1.75} />
              {t("hero.note")}
            </motion.p>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.15, ease: [0.4, 0, 0.2, 1] }}
            className="relative"
          >
            <HeroChat />
          </motion.div>
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  const { t } = useLandingI18n();
  return (
    <section className="px-5 sm:px-6 pb-28">
      <Reveal dir="up">
        <div className="mx-auto max-w-4xl rounded-3xl border border-border bg-card p-10 sm:p-16 text-center">
          <h2 className="font-display text-3xl sm:text-5xl leading-[1.12] font-semibold">{t("final.title")}</h2>
          <p className="text-muted-foreground mt-5 max-w-lg mx-auto text-base sm:text-lg">{t("final.sub")}</p>
          <Link
            to="/signup"
            className="mt-9 inline-flex items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground text-base font-semibold px-8 py-4 shadow-card hover:bg-primary/90 hover:-translate-y-0.5 transition-all duration-200"
          >
            {t("cta.startNow")} <ArrowRight className="h-4 w-4" strokeWidth={2} />
          </Link>
        </div>
      </Reveal>
    </section>
  );
}

function LandingPage() {
  return (
    <LandingI18nProvider>
      <div className="min-h-screen relative overflow-x-hidden">
        <div className="absolute inset-0 grid-overlay pointer-events-none" />
        <Navbar />

        <main>
          <Hero />
          <StartSteps />
          <ChatExamples />
          <FeatureChips />
          <Benefits />
          <HowItWorks />
          <DashboardShowcase />
          <Differentials />
          <Comparison />
          <SocialProof />
          <FAQ />
          <Pricing />
          <FinalCta />
        </main>

        <Footer />
        <GiftPopup />
      </div>
    </LandingI18nProvider>
  );
}
