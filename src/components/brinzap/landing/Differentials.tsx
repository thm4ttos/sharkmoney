import {
  BellRing,
  BrainCircuit,
  FileText,
  Image as ImageIcon,
  Layers,
  LineChart,
  MessageSquareText,
  Mic2,
  ReceiptText,
} from "lucide-react";
import { Reveal, StaggerGroup, StaggerItem } from "./Reveal";

const items = [
  { icon: MessageSquareText, title: "Conversa pelo WhatsApp", desc: "Sem app extra. O financeiro vive onde você já conversa todos os dias." },
  { icon: Mic2, title: "Reconhecimento de áudio", desc: "Mandou áudio? Transcrevemos, interpretamos e registramos em segundos." },
  { icon: ImageIcon, title: "Reconhecimento de imagens", desc: "Foto de cupom, etiqueta ou tela: a IA lê valores e datas sozinha." },
  { icon: FileText, title: "Leitura de PDF", desc: "Boletos, faturas e extratos completos processados automaticamente." },
  { icon: ReceiptText, title: "Comprovantes Pix e TED", desc: "Envie o comprovante e o lançamento aparece pronto no painel." },
  { icon: Layers, title: "Parcelamentos", desc: "“12x de 250” vira um plano completo com todas as parcelas futuras." },
  { icon: BellRing, title: "Lembretes inteligentes", desc: "Avisos 3 dias antes, no dia e na hora. Você nunca mais esquece." },
  { icon: BrainCircuit, title: "Dashboard inteligente", desc: "Filtros por período, extrato de saldo e indicadores em tempo real." },
  { icon: LineChart, title: "Relatórios", desc: "Fechamento semanal automático direto no seu WhatsApp." },
];

export function Differentials() {
  return (
    <section id="diferenciais" className="relative px-5 sm:px-6 py-20 md:py-28">
      <div className="mx-auto max-w-7xl">
        <Reveal className="max-w-2xl">
          <span className="text-[11px] uppercase tracking-[0.24em] text-neon">Diferenciais</span>
          <h2 className="font-display text-3xl sm:text-4xl md:text-5xl mt-3 leading-tight">
            Recursos que <span className="text-gradient-brand">só o Shark Money tem.</span>
          </h2>
          <p className="text-muted-foreground mt-3 text-base md:text-lg">
            Uma IA financeira completa, treinada para o jeito brasileiro de falar de dinheiro.
          </p>
        </Reveal>

        <StaggerGroup className="mt-10 md:mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map(({ icon: Icon, title, desc }) => (
            <StaggerItem key={title}>
              <div className="group relative h-full overflow-hidden rounded-3xl border border-border bg-card/50 backdrop-blur-xl p-6 transition-colors hover:-translate-y-1.5 hover:border-neon/50">
                <div className="relative h-12 w-12 rounded-2xl bg-secondary border border-border grid place-items-center transition-colors">
                  <Icon className="h-5 w-5 text-neon" />
                </div>
                <h3 className="relative font-display text-lg mt-5">{title}</h3>
                <p className="relative text-sm text-muted-foreground mt-2 leading-relaxed">{desc}</p>
              </div>
            </StaggerItem>
          ))}
        </StaggerGroup>
      </div>
    </section>
  );
}
