import { AppLogo } from "@/components/brinzap/AppLogo";

export function Footer() {
  return (
    <footer className="border-t border-border py-10 px-6">
      <div className="mx-auto max-w-7xl flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <AppLogo size={28} />
          <span className="text-sm text-muted-foreground">© {new Date().getFullYear()} Abio · Seu Assistente Virtual.</span>
        </div>
        <div className="flex gap-6 text-sm text-muted-foreground">
          <a href="#" className="hover:text-foreground transition-smooth">Privacidade</a>
          <a href="#" className="hover:text-foreground transition-smooth">Termos</a>
          <a href="#" className="hover:text-foreground transition-smooth">Contato</a>
        </div>
      </div>
    </footer>
  );
}
