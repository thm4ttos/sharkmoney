import { Link } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { Globe, Menu, Moon, Sun, X } from "lucide-react";
import { useEffect, useState } from "react";
import { AppLogo } from "@/components/brinzap/AppLogo";
import { useLandingI18n, type Lang } from "@/lib/landing-i18n";
import { useTheme } from "@/lib/landing-theme";

export function scrollToSection(id: string) {
  document.querySelector(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function Navbar() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { theme, toggle } = useTheme();
  const { t, lang, setLang } = useLandingI18n();

  const links = [
    { href: "#como-funciona", label: t("nav.how") },
    { href: "#recursos", label: t("nav.features") },
    { href: "#dashboard", label: t("nav.dashboard") },
    { href: "#planos", label: t("nav.pricing") },
    { href: "#faq", label: t("nav.faq") },
  ];

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const go = (href: string) => {
    setOpen(false);
    setTimeout(() => scrollToSection(href), 60);
  };

  const nextLang: Lang = lang === "pt" ? "en" : "pt";

  return (
    <header
      className={`sticky top-0 z-50 transition-colors ${
        scrolled ? "backdrop-blur-xl bg-background/85 border-b border-border" : "bg-transparent"
      }`}
    >
      <div className="mx-auto max-w-7xl px-5 sm:px-6 h-16 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
        <Link to="/" className="flex items-center shrink-0" aria-label="Shark Money">
          <AppLogo size={40} className="h-9 w-9 sm:h-10 sm:w-10" />
        </Link>

        <nav className="hidden lg:flex items-center justify-center gap-8 text-sm text-muted-foreground">
          {links.map((l) => (
            <button key={l.href} onClick={() => go(l.href)} className="hover:text-foreground transition-colors">
              {l.label}
            </button>
          ))}
        </nav>
        <span className="lg:hidden" />

        <div className="flex items-center gap-1.5 justify-end">
          <button
            onClick={() => setLang(nextLang)}
            aria-label={t("lang.label")}
            title={t("lang.label")}
            className="hidden sm:inline-flex items-center gap-1.5 h-10 rounded-lg px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <Globe className="h-4 w-4" strokeWidth={1.75} />
            {lang === "pt" ? "PT" : "EN"}
          </button>
          <button
            onClick={toggle}
            aria-label={t("theme.toggle")}
            title={t("theme.toggle")}
            className="h-10 w-10 grid place-items-center rounded-lg text-muted-foreground hover:text-foreground transition-colors"
          >
            {theme === "dark" ? <Sun className="h-4.5 w-4.5" strokeWidth={1.75} /> : <Moon className="h-4.5 w-4.5" strokeWidth={1.75} />}
          </button>
          <Link
            to="/signup"
            className="inline-flex items-center rounded-lg bg-primary text-primary-foreground font-medium px-4 py-2.5 text-sm hover:bg-primary/90 transition-colors"
          >
            {t("cta.start")}
          </Link>
          <button
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Fechar menu" : "Abrir menu"}
            className="lg:hidden h-10 w-10 grid place-items-center rounded-lg border border-border bg-card"
          >
            {open ? <X className="h-5 w-5" strokeWidth={1.75} /> : <Menu className="h-5 w-5" strokeWidth={1.75} />}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.25 }}
            className="lg:hidden border-t border-border bg-background/95 backdrop-blur-xl"
          >
            <nav className="px-5 py-4 flex flex-col">
              {links.map((l) => (
                <button
                  key={l.href}
                  onClick={() => go(l.href)}
                  className="text-left py-3.5 text-base border-b border-border/50 active:text-primary transition-colors"
                >
                  {l.label}
                </button>
              ))}
              <div className="flex items-center justify-between py-3.5 border-b border-border/50">
                <span className="text-base text-muted-foreground">{t("lang.label")}</span>
                <button
                  onClick={() => setLang(nextLang)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm"
                >
                  <Globe className="h-4 w-4" strokeWidth={1.75} /> {lang === "pt" ? "Português" : "English"}
                </button>
              </div>
              <Link
                to="/login"
                onClick={() => setOpen(false)}
                className="py-3.5 text-base text-muted-foreground active:text-primary transition-colors"
              >
                {t("nav.login")}
              </Link>
              <Link
                to="/signup"
                onClick={() => setOpen(false)}
                className="mt-2 mb-2 w-full rounded-lg bg-primary text-primary-foreground font-medium py-3 text-sm text-center"
              >
                {t("cta.start")}
              </Link>
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
