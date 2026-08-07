import { AppLogo } from "@/components/brinzap/AppLogo";
import { scrollToSection } from "./Navbar";

export function Footer() {
  return (
    <footer className="border-t border-border px-5 sm:px-6 py-12">
      <div className="mx-auto max-w-7xl grid gap-8 md:grid-cols-[1.4fr_repeat(2,minmax(0,1fr))]">
        <div>
          <div className="flex items-center gap-2">
            <AppLogo size={32} />
          </div>
          <p className="text-sm text-muted-foreground mt-3 max-w-sm leading-relaxed">
            Seu Assistente Virtual. Controle financeiro inteligente que vive dentro do seu WhatsApp.
          </p>
        </div>

        <div>
          <p className="text-sm font-medium">Produto</p>
          <div className="mt-3 flex flex-col gap-2.5 text-sm text-muted-foreground">
            <button onClick={() => scrollToSection("#como-funciona")} className="text-left hover:text-foreground transition-colors">Como funciona</button>
            <button onClick={() => scrollToSection("#dashboard")} className="text-left hover:text-foreground transition-colors">Dashboard</button>
            <button onClick={() => scrollToSection("#planos")} className="text-left hover:text-foreground transition-colors">Planos</button>
            <button onClick={() => scrollToSection("#faq")} className="text-left hover:text-foreground transition-colors">FAQ</button>
          </div>
        </div>

        <div>
          <p className="text-sm font-medium">Legal</p>
          <div className="mt-3 flex flex-col gap-2.5 text-sm text-muted-foreground">
            <a href="#" className="hover:text-foreground transition-colors">Privacidade</a>
            <a href="#" className="hover:text-foreground transition-colors">Termos</a>
            <a href="#" className="hover:text-foreground transition-colors">Contato</a>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl mt-10 pt-6 border-t border-border/60 text-xs text-muted-foreground">
        © {new Date().getFullYear()} Abio · Seu Assistente Virtual.
      </div>
    </footer>
  );
}
