import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { motion } from "framer-motion";
import { Heart, Send, Check, X, Unlink, Users, LayoutDashboard } from "lucide-react";
import {
  getCoupleStatus, createCoupleInvite, respondCoupleInvite, unlinkCouple, updateSplitRatio,
} from "@/lib/couple.functions";

export const Route = createFileRoute("/app/casal")({
  head: () => ({ meta: [{ title: "Casal · Abio" }] }),
  component: Page,
});

function Page() {
  const qc = useQueryClient();
  const runStatus = useServerFn(getCoupleStatus);
  const runInvite = useServerFn(createCoupleInvite);
  const runRespond = useServerFn(respondCoupleInvite);
  const runUnlink = useServerFn(unlinkCouple);
  const runSplit = useServerFn(updateSplitRatio);

  const status = useQuery({ queryKey: ["couple-status"], queryFn: () => runStatus() as any });
  const link = (status.data as any)?.link ?? null;
  const role = (status.data as any)?.role ?? null;
  const partner = (status.data as any)?.partner ?? null;
  const isAccepted = link?.status === "accepted";

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["couple-status"] });
    qc.invalidateQueries({ queryKey: ["couple-shared"] });
    qc.invalidateQueries({ queryKey: ["couple-balance"] });
  };

  const mInvite = useMutation({
    mutationFn: (phone: string) => runInvite({ data: { phone } }) as any,
    onSuccess: invalidateAll,
  });
  const mRespond = useMutation({
    mutationFn: (accept: boolean) => runRespond({ data: { linkId: link.id, accept } }) as any,
    onSuccess: invalidateAll,
  });
  const mUnlink = useMutation({
    mutationFn: () => runUnlink({ data: { linkId: link.id } }) as any,
    onSuccess: invalidateAll,
  });
  const mSplit = useMutation({
    mutationFn: (ratio: number) => runSplit({ data: { linkId: link.id, splitRatioRequester: ratio } }) as any,
    onSuccess: invalidateAll,
  });

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <motion.header initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-4">
        <div className="h-14 w-14 grid place-items-center rounded-2xl border border-border bg-card/60">
          <Heart className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="font-display text-3xl">Modo Casal</h1>
          <p className="text-sm text-muted-foreground">Vincule sua conta à do seu parceiro(a) — depois do aceite, as receitas e despesas de vocês dois aparecem automaticamente num painel só do casal.</p>
        </div>
      </motion.header>

      {status.isLoading ? (
        <div className="h-40 rounded-3xl border border-border bg-card/40 animate-pulse" />
      ) : !link ? (
        <InviteForm onInvite={(phone) => mInvite.mutate(phone)} pending={mInvite.isPending} error={(mInvite.error as any)?.message} />
      ) : link.status === "pending" && role === "requester" ? (
        <PendingSent onCancel={() => mUnlink.mutate()} canceling={mUnlink.isPending} />
      ) : link.status === "pending" && role === "partner" ? (
        <PendingReceived
          requesterName={partner?.name}
          onAccept={() => mRespond.mutate(true)}
          onReject={() => mRespond.mutate(false)}
          pending={mRespond.isPending}
        />
      ) : isAccepted ? (
        <Accepted
          partnerName={partner?.name || "seu parceiro(a)"}
          link={link}
          onUnlink={() => mUnlink.mutate()}
          unlinking={mUnlink.isPending}
          onSplitChange={(v) => mSplit.mutate(v)}
        />
      ) : (
        <InviteForm onInvite={(phone) => mInvite.mutate(phone)} pending={mInvite.isPending} error={(mInvite.error as any)?.message} />
      )}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      className="rounded-3xl border border-border bg-card/60 backdrop-blur-xl p-6 shadow-card">
      {children}
    </motion.div>
  );
}

function InviteForm({ onInvite, pending, error }: { onInvite: (phone: string) => void; pending: boolean; error?: string }) {
  const [phone, setPhone] = useState("");
  return (
    <Card>
      <div className="flex items-center gap-3 mb-4">
        <div className="h-10 w-10 grid place-items-center rounded-xl bg-gradient-brand-soft border border-primary/30">
          <Users className="h-5 w-5 text-primary" />
        </div>
        <div>
          <p className="font-display text-lg">Convide seu parceiro(a)</p>
          <p className="text-xs text-muted-foreground">A pessoa precisa já ter uma conta Abio. Ela vai receber o convite pelo WhatsApp.</p>
        </div>
      </div>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="Celular (com DDI) — ex.: 5511999990000"
          className="flex-1 bg-input rounded-xl px-3 py-2.5 text-sm"
        />
        <button
          onClick={() => phone.trim() && onInvite(phone.trim())}
          disabled={pending || !phone.trim()}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-brand text-primary-foreground px-4 py-2.5 text-sm glow-neon disabled:opacity-50"
        >
          <Send className="h-4 w-4" /> {pending ? "Enviando..." : "Convidar"}
        </button>
      </div>
      {error ? <p className="text-xs text-destructive mt-2">{error}</p> : null}
    </Card>
  );
}

function PendingSent({ onCancel, canceling }: { onCancel: () => void; canceling: boolean }) {
  return (
    <Card>
      <p className="font-display text-lg">Convite enviado 💌</p>
      <p className="text-sm text-muted-foreground mt-1">Aguardando a outra pessoa aceitar pelo WhatsApp (ou por aqui).</p>
      <button onClick={onCancel} disabled={canceling}
        className="mt-4 inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm hover:bg-background/40 disabled:opacity-50">
        <X className="h-4 w-4" /> {canceling ? "Cancelando..." : "Cancelar convite"}
      </button>
    </Card>
  );
}

function PendingReceived({ requesterName, onAccept, onReject, pending }: { requesterName?: string; onAccept: () => void; onReject: () => void; pending: boolean }) {
  return (
    <Card>
      <p className="font-display text-lg">{requesterName || "Alguém"} te convidou pro Modo Casal 💙</p>
      <p className="text-sm text-muted-foreground mt-1">Se aceitar, as receitas, despesas, contas fixas, parcelamentos e metas de vocês dois passam a aparecer automaticamente pra ambos, num painel só do casal.</p>
      <div className="mt-4 flex gap-2">
        <button onClick={onAccept} disabled={pending}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-brand text-primary-foreground px-4 py-2 text-sm glow-neon disabled:opacity-50">
          <Check className="h-4 w-4" /> Aceitar
        </button>
        <button onClick={onReject} disabled={pending}
          className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm hover:bg-background/40 disabled:opacity-50">
          <X className="h-4 w-4" /> Recusar
        </button>
      </div>
    </Card>
  );
}

function Accepted({ partnerName, link, onUnlink, unlinking, onSplitChange }: {
  partnerName: string; link: any; onUnlink: () => void; unlinking: boolean; onSplitChange: (v: number) => void;
}) {
  const [ratio, setRatio] = useState(String(link.split_ratio_requester ?? 50));

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="font-display text-lg">Vinculado com {partnerName} ❤️</p>
            <p className="text-xs text-muted-foreground">As receitas e despesas de vocês dois já aparecem automaticamente no painel do casal.</p>
          </div>
          <Link to="/app/casal-dashboard"
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-brand text-primary-foreground px-4 py-2.5 text-sm glow-neon hover:scale-[1.02] transition-smooth">
            <LayoutDashboard className="h-4 w-4" /> Ver Dashboard do Casal
          </Link>
        </div>
      </Card>

      <Card>
        <p className="font-display text-lg mb-3">Divisão de gastos</p>
        <p className="text-xs text-muted-foreground mb-3">
          Percentual de quem convidou sobre o total de gastos do casal — usado só pra calcular o desequilíbrio no Dashboard, nunca cria transferência automática.
        </p>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground">Divisão (% de quem convidou):</label>
          <input value={ratio} onChange={(e) => setRatio(e.target.value)} inputMode="numeric"
            className="w-16 bg-input rounded-lg px-2 py-1.5 text-xs" />
          <button onClick={() => onSplitChange(Math.max(0, Math.min(100, Number(ratio) || 50)))}
            className="rounded-lg bg-primary/20 text-primary border border-primary/30 px-2.5 py-1.5 text-xs hover:bg-primary/30">
            Salvar
          </button>
        </div>
      </Card>

      <Card>
        <div className="flex items-center justify-between">
          <div>
            <p className="font-display text-lg">Desvincular</p>
            <p className="text-xs text-muted-foreground">Encerra o compartilhamento na hora — o histórico do vínculo fica registrado, mas nenhum dado novo continua visível.</p>
          </div>
          <button onClick={onUnlink} disabled={unlinking}
            className="inline-flex items-center gap-2 rounded-xl border border-destructive/30 text-destructive px-3 py-2 text-xs hover:bg-destructive/10 disabled:opacity-50 shrink-0">
            <Unlink className="h-3.5 w-3.5" /> {unlinking ? "Desvinculando..." : "Desvincular"}
          </button>
        </div>
      </Card>
    </div>
  );
}
