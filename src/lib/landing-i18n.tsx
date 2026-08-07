import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Lang = "pt" | "en";

const KEY = "abio:lang";

const DICT = {
  pt: {
    "nav.how": "Como funciona",
    "nav.features": "Recursos",
    "nav.dashboard": "Painel",
    "nav.pricing": "Planos",
    "nav.faq": "FAQ",
    "nav.login": "Entrar",
    "cta.start": "Começar grátis",
    "cta.startNow": "Começar agora",
    "hero.badge": "Seu assistente pessoal no WhatsApp",
    "hero.title1": "Basta conversar.",
    "hero.title2": "O Abio resolve.",
    "hero.sub":
      "Gastos, compromissos e lembretes organizados por mensagem — texto, áudio, foto ou PDF. Sem app novo, sem planilha.",
    "hero.secondary": "Ver o painel",
    "hero.note": "7 dias grátis · Sem cartão de crédito",
    "steps.eyebrow": "Comece em 30 segundos",
    "steps.title": "Como funciona",
    "steps.1.title": "Crie sua conta",
    "steps.1.desc": "Telefone, senha e seu nome. Em menos de 30 segundos, você já está dentro.",
    "steps.2.title": "Abra seu WhatsApp",
    "steps.2.desc": "Você receberá uma mensagem do Abio automaticamente. É só responder e começar.",
    "steps.3.title": "Pronto!",
    "steps.3.desc": "Envie textos, áudios, fotos ou PDFs. O Abio organiza o resto.",
    "examples.title1": "Basta conversar.",
    "examples.title2": "O Abio entende.",
    "examples.sub": "Do jeito que você já fala no WhatsApp. Sem comandos, sem configuração.",
    "examples.1.msg": "Uber 32",
    "examples.1.res": "Gasto registrado.",
    "examples.2.msg": "Reunião amanhã às 19h",
    "examples.2.res": "Compromisso criado.",
    "examples.3.msg": "Quanto gastei este mês?",
    "examples.3.res": "Resumo financeiro enviado.",
    "chips.eyebrow": "Tudo em um só lugar",
    "chips.title": "Um assistente, muitos superpoderes",
    "gift.title": "Você ganhou 7 dias grátis!",
    "gift.desc": "Teste todos os recursos do Abio sem compromisso.",
    "gift.close": "Fechar aviso",
    "final.title": "Comece gratuitamente hoje.",
    "final.sub": "7 dias grátis para conhecer todos os recursos.",
    "theme.toggle": "Alternar tema",
    "lang.label": "Idioma",
  },
  en: {
    "nav.how": "How it works",
    "nav.features": "Features",
    "nav.dashboard": "Dashboard",
    "nav.pricing": "Pricing",
    "nav.faq": "FAQ",
    "nav.login": "Sign in",
    "cta.start": "Start free",
    "cta.startNow": "Start now",
    "hero.badge": "Your personal assistant on WhatsApp",
    "hero.title1": "Just chat.",
    "hero.title2": "Abio handles it.",
    "hero.sub":
      "Expenses, appointments and reminders organized by message — text, audio, photo or PDF. No new app, no spreadsheet.",
    "hero.secondary": "See the dashboard",
    "hero.note": "7 days free · No credit card",
    "steps.eyebrow": "Get started in 30 seconds",
    "steps.title": "How it works",
    "steps.1.title": "Create your account",
    "steps.1.desc": "Phone, password and your name. In under 30 seconds you're in.",
    "steps.2.title": "Open WhatsApp",
    "steps.2.desc": "You'll get a message from Abio automatically. Just reply and go.",
    "steps.3.title": "Done!",
    "steps.3.desc": "Send text, audio, photos or PDFs. Abio organizes the rest.",
    "examples.title1": "Just chat.",
    "examples.title2": "Abio understands.",
    "examples.sub": "The way you already talk on WhatsApp. No commands, no setup.",
    "examples.1.msg": "Uber 32",
    "examples.1.res": "Expense recorded.",
    "examples.2.msg": "Meeting tomorrow at 7pm",
    "examples.2.res": "Appointment created.",
    "examples.3.msg": "How much did I spend this month?",
    "examples.3.res": "Financial summary sent.",
    "chips.eyebrow": "All in one place",
    "chips.title": "One assistant, many superpowers",
    "gift.title": "You got 7 days free!",
    "gift.desc": "Try every Abio feature with no commitment.",
    "gift.close": "Dismiss",
    "final.title": "Start for free today.",
    "final.sub": "7 days free to explore every feature.",
    "theme.toggle": "Toggle theme",
    "lang.label": "Language",
  },
} as const;

export type TKey = keyof (typeof DICT)["pt"];

const Ctx = createContext<{ lang: Lang; setLang: (l: Lang) => void; t: (k: TKey) => string }>({
  lang: "pt",
  setLang: () => {},
  t: (k) => DICT.pt[k],
});

export function LandingI18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("pt");

  useEffect(() => {
    const stored = localStorage.getItem(KEY) as Lang | null;
    if (stored === "pt" || stored === "en") setLangState(stored);
  }, []);

  const value = useMemo(
    () => ({
      lang,
      setLang: (l: Lang) => {
        localStorage.setItem(KEY, l);
        setLangState(l);
      },
      t: (k: TKey) => DICT[lang][k] ?? DICT.pt[k],
    }),
    [lang],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLandingI18n() {
  return useContext(Ctx);
}
