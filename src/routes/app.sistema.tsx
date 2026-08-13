import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Settings2, MessageCircle, LifeBuoy, FileBarChart2, ShieldCheck, Upload } from "lucide-react";
import { WhatsAppView } from "@/components/brinzap/sistema/WhatsAppView";
import { SuporteView } from "@/components/brinzap/sistema/SuporteView";
import { RelatoriosView } from "@/components/brinzap/sistema/RelatoriosView";
import { AuditoriaView } from "@/components/brinzap/sistema/AuditoriaView";
import { ImportarView } from "@/components/brinzap/sistema/ImportarView";

type SistemaView = "whatsapp" | "suporte" | "relatorios" | "auditoria" | "importar";

export const Route = createFileRoute("/app/sistema")({
  validateSearch: (s: Record<string, unknown>) => ({
    view: (["whatsapp", "suporte", "relatorios", "auditoria", "importar"].includes(s.view as string)
      ? s.view
      : "whatsapp") as SistemaView,
  }),
  head: () => ({ meta: [{ title: "Sistema · Abio" }] }),
  component: SistemaPage,
});

const TABS: { key: SistemaView; label: string; icon: typeof MessageCircle }[] = [
  { key: "whatsapp", label: "WhatsApp", icon: MessageCircle },
  { key: "suporte", label: "Suporte", icon: LifeBuoy },
  { key: "relatorios", label: "Relatórios", icon: FileBarChart2 },
  { key: "auditoria", label: "Auditoria", icon: ShieldCheck },
  { key: "importar", label: "Importar Histórico", icon: Upload },
];

function SistemaPage() {
  const search = Route.useSearch();
  const [view, setView] = useState<SistemaView>(search.view);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 grid place-items-center rounded-2xl border border-border bg-card/60">
            <Settings2 className="h-6 w-6 text-primary" />
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-primary">Sistema</p>
            <h1 className="font-display text-3xl mt-1">Sistema</h1>
          </div>
        </div>
        <div className="flex flex-wrap gap-1 rounded-xl border border-border bg-card/60 p-1">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = view === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setView(t.key)}
                className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm transition-smooth ${active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                <Icon className="h-4 w-4" /> {t.label}
              </button>
            );
          })}
        </div>
      </header>

      {view === "whatsapp" && <WhatsAppView />}
      {view === "suporte" && <SuporteView />}
      {view === "relatorios" && <RelatoriosView />}
      {view === "auditoria" && <AuditoriaView />}
      {view === "importar" && <ImportarView />}
    </div>
  );
}
