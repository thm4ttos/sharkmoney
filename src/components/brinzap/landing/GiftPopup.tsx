import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useLandingI18n } from "@/lib/landing-i18n";

const KEY = "abio:gift-seen";

export function GiftPopup() {
  const { t } = useLandingI18n();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(KEY)) return;
    const timer = setTimeout(() => setOpen(true), 6000);
    return () => clearTimeout(timer);
  }, []);

  const dismiss = () => {
    localStorage.setItem(KEY, "1");
    setOpen(false);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          initial={{ opacity: 0, y: 24, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.97 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="fixed inset-x-4 bottom-4 z-50 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:max-w-xs"
        >
          <div className="relative rounded-2xl border border-primary/30 bg-card p-5 shadow-card backdrop-blur-xl">
            <button
              onClick={dismiss}
              aria-label={t("gift.close")}
              className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" strokeWidth={1.75} />
            </button>
            <span className="text-2xl leading-none" aria-hidden>
              🎁
            </span>
            <p className="font-display text-base font-semibold mt-3 pr-6 leading-snug">{t("gift.title")}</p>
            <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{t("gift.desc")}</p>
            <Link
              to="/signup"
              onClick={dismiss}
              className="mt-4 inline-flex w-full items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              {t("cta.startNow")}
            </Link>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
