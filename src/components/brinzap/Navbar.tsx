import { Link } from "@tanstack/react-router";
import { AppLogo } from "@/components/brinzap/AppLogo";

export function Navbar() {
  return (
    <header className="sticky top-0 z-40 backdrop-blur-xl bg-background/60 border-b border-border/60">
      <div className="mx-auto max-w-7xl px-6 h-16 flex items-center justify-between">
        <Link to="/" className="flex items-center">
          <AppLogo size={40} />
        </Link>
        <nav className="hidden md:flex items-center gap-8 text-sm text-muted-foreground">
          <a href="#como-funciona" className="hover:text-foreground transition-smooth">Como funciona</a>
          <a href="#dashboard" className="hover:text-foreground transition-smooth">Dashboard</a>
          <a href="#planos" className="hover:text-foreground transition-smooth">Planos</a>
          <a href="#faq" className="hover:text-foreground transition-smooth">FAQ</a>
        </nav>
        <div className="flex items-center gap-3">
          <Link
            to="/login"
            className="inline-flex items-center gap-2 rounded-full bg-gradient-brand text-primary-foreground font-medium px-4 py-2 text-sm glow-neon hover:scale-[1.02] transition-smooth"
          >
            Entrar
          </Link>
        </div>
      </div>
    </header>
  );
}
