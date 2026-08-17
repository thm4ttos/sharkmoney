import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { LifeBuoy, MessageCircle, Send } from "lucide-react";
import { listMyTickets, createTicket } from "@/lib/support.functions";

const FAQ = [
  { q: "Como começo a usar?", a: "Mande mensagens, áudios ou comprovantes para o WhatsApp do Abio. Tudo é registrado automaticamente." },
  { q: "Como crio uma meta?", a: "Acesse a aba Metas e clique em ‘Nova meta’. Acompanhe pela barra de progresso, ou crie dizendo algo como ‘quero juntar R$ 5.000 pra viagem’ no WhatsApp." },
  { q: "Como funcionam os lembretes?", a: "Cadastre em Lembretes ou diga ‘Consulta amanhã 14h’ no WhatsApp." },
  { q: "Posso exportar relatórios?", a: "Sim. Em Sistema → Relatórios, escolha o período, clique em ‘Gerar relatório’ e baixe em PDF ou Excel." },
  { q: "Como apago todos os dados?", a: "Em Transações, clique em ‘Zerar todos os dados’. Também dá pra dizer ‘zerar meu histórico’ ou ‘apagar tudo’ no WhatsApp — o Abio pede confirmação antes de excluir." },
];

export function SuporteView() {
  const qc = useQueryClient();
  const list = useServerFn(listMyTickets);
  const create = useServerFn(createTicket);
  const q = useQuery({ queryKey: ["tickets"], queryFn: () => list() as any });
  const m = useMutation({ mutationFn: (d: any) => create({ data: d }) as any, onSuccess: () => { qc.invalidateQueries({ queryKey: ["tickets"] }); setSubject(""); setMessage(""); } });

  const [type, setType] = useState<"chamado" | "suggestion" | "bug">("chamado");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  const waLink = `https://wa.me/?text=${encodeURIComponent("Olá Abio, preciso de ajuda.")}`;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <header className="flex items-center gap-4">
        <div className="h-14 w-14 grid place-items-center rounded-2xl border border-border bg-card/60"><LifeBuoy className="h-6 w-6 text-primary" /></div>
        <div><h1 className="font-display text-3xl">Suporte</h1><p className="text-sm text-muted-foreground">Tire dúvidas, abra chamados, envie sugestões.</p></div>
      </header>

      <section className="rounded-3xl border border-border bg-card/60 p-5">
        <h2 className="font-display text-lg mb-3">Perguntas frequentes</h2>
        <div className="space-y-2">
          {FAQ.map((f, i) => (
            <div key={i} className="rounded-2xl border border-border bg-background/40">
              <button onClick={() => setOpenFaq(openFaq === i ? null : i)} className="w-full text-left p-3 font-medium text-sm flex justify-between items-center">{f.q}<span className="text-primary">{openFaq === i ? "−" : "+"}</span></button>
              {openFaq === i && <p className="px-3 pb-3 text-sm text-muted-foreground">{f.a}</p>}
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-3xl border border-primary/30 bg-gradient-brand-soft p-5">
        <h2 className="font-display text-lg">Fale conosco no WhatsApp</h2>
        <p className="text-sm text-muted-foreground mt-1">Resposta rápida pelo canal direto do Abio.</p>
        <a href={waLink} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-2 rounded-xl bg-gradient-brand text-primary-foreground px-4 py-2.5 text-sm glow-neon"><MessageCircle className="h-4 w-4" /> Abrir WhatsApp</a>
      </section>

      <section className="rounded-3xl border border-border bg-card/60 p-5">
        <h2 className="font-display text-lg mb-3">Abrir chamado / sugestão / reportar erro</h2>
        <div className="space-y-3">
          <div className="grid md:grid-cols-3 gap-2">
            <select value={type} onChange={(e) => setType(e.target.value as any)} className="bg-input rounded-xl px-3 py-2.5 text-sm">
              <option value="chamado">Chamado</option><option value="suggestion">Sugestão</option><option value="bug">Reportar erro</option>
            </select>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Assunto" className="md:col-span-2 bg-input rounded-xl px-3 py-2.5 text-sm" />
          </div>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Descreva sua mensagem" rows={4} className="w-full bg-input rounded-xl px-3 py-2.5 text-sm" />
          <button disabled={!subject || !message || m.isPending} onClick={() => m.mutate({ type, subject, message })} className="inline-flex items-center gap-2 rounded-xl bg-gradient-brand text-primary-foreground px-4 py-2.5 text-sm glow-neon disabled:opacity-50"><Send className="h-4 w-4" /> {m.isPending ? "Enviando..." : "Enviar"}</button>
        </div>

        {(q.data ?? []).length > 0 && (
          <div className="mt-5">
            <h3 className="font-medium mb-2 text-sm">Meus chamados</h3>
            <div className="space-y-2">
              {(q.data ?? []).map((t: any) => (
                <div key={t.id} className="rounded-2xl border border-border bg-background/40 p-3 text-sm">
                  <div className="flex justify-between items-center"><p className="font-medium">{t.subject}</p><span className="text-[10px] uppercase tracking-wider text-primary">{t.status}</span></div>
                  <p className="text-xs text-muted-foreground">{new Date(t.created_at).toLocaleString("pt-BR")} · {t.type}</p>
                  <p className="text-sm mt-1">{t.message}</p>
                  {t.admin_reply && <p className="text-sm mt-2 text-primary border-l-2 border-primary pl-2">{t.admin_reply}</p>}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
