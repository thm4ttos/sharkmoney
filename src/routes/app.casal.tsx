import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { motion } from "framer-motion";
import { Heart, Send, Check, X, Unlink, Users } from "lucide-react";
import {
  getCoupleStatus, createCoupleInvite, respondCoupleInvite, unlinkCouple,
  updateSplitRatio, listSharedItems, computeCoupleBalance,
} from "@/lib/couple.functions";

export const Route = createFileRoute("/app/casal")({
  head: () => ({ meta: [{ title: "Casal · Abio" }] }),
  component: Page,
});

const BRL = (n: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n ?? 0);

function Page() {
  const qc = useQueryClient();
  const runStatus = useServerFn(getCoupleStatus);
  const runInvite = useServerFn(createCoupleInvite);
  const runRespond = useServerFn(respondCoupleInvite);
  const runUnlink = useServerFn(unlinkCouple);
  const runSplit = useServerFn(updateSplitRatio);
  const runShared = useServerFn(listSharedItems);
  const runBalance = useServerFn(computeCoupleBalance);

  const status = useQuery({ queryKey: ["couple-status"], queryFn: () => runStatus() as any });
  const link = (status.data as any)?.link ?? null;
  const role = (status.data as any)?.role ?? null;
  const partner = (status.data as any)?.partner ?? null;
  const isAccepted = link?.status === "accepted";

  const shared = useQuery({ queryKey: ["couple-shared"], queryFn: () => runShared() as any, enabled: isAccepted });
  const balance = useQuery({ queryKey: ["couple-balance"], queryFn: () => runBalance() as any, enabled: isAccepted });

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
          <p className="text-sm text-muted-foreground">Compartilhe gastos escolhidos a dedo com seu parceiro(a) — o resto continua privado.</p>
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
          balance={balance.data as any}
          shared={shared.data as any}
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
      <p className="text-sm text-muted-foreground mt-1">Vocês vão poder compartilhar gastos, contas, parcelamentos e metas escolhidos a dedo. O resto continua privado.</p>
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

function Accepted({ partnerName, link, balance, shared, onUnlink, unlinking, onSplitChange }: {
  partnerName: string; link: any; balance: any; shared: any; onUnlink: () => void; unlinking: boolean; onSplitChange: (v: number) => void;
}) {
  const [ratio, setRatio] = useState(String(link.split_ratio_requester ?? 50));
  const items = shared
    ? [...(shared.transactions ?? []), ...(shared.bills ?? []), ...(shared.installments ?? []), ...(shared.goals ?? [])]
    : [];

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="font-display text-lg">Vinculado com {partnerName} ❤️</p>
            <p className="text-xs text-muted-foreground">Vocês compartilham só o que estiver marcado como compartilhado.</p>
          </div>
          <button onClick={onUnlink} disabled={unlinking}
            className="inline-flex items-center gap-2 rounded-xl border border-destructive/30 text-destructive px-3 py-2 text-xs hover:bg-destructive/10 disabled:opacity-50">
            <Unlink className="h-3.5 w-3.5" /> {unlinking ? "Desvinculando..." : "Desvincular"}
          </button>
        </div>
      </Card>

      {balance ? (
        <Card>
          <p className="font-display text-lg mb-3">Saldo do mês</p>
          <div className="grid sm:grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl border border-border bg-background/40 p-3">
              <p className="text-xs text-muted-foreground">Total compartilhado</p>
              <p className="font-display text-xl">{BRL(balance.total ?? 0)}</p>
            </div>
            <div className="rounded-xl border border-border bg-background/40 p-3">
              <p className="text-xs text-muted-foreground">Divisão combinada</p>
              <p className="font-display text-xl">{Number(link.split_ratio_requester)}% / {100 - Number(link.split_ratio_requester)}%</p>
            </div>
          </div>
          <p className="text-sm mt-3">
            {Math.abs(balance.requesterDelta ?? 0) < 0.01
              ? "✅ Está tudo em dia entre vocês."
              : (balance.requesterDelta ?? 0) > 0
              ? `${partnerName} deve ${BRL(balance.requesterDelta)} pra quem convidou.`
              : `Quem convidou deve ${BRL(Math.abs(balance.requesterDelta))} pra ${partnerName}.`}
          </p>
          <div className="mt-4 flex items-center gap-2">
            <label className="text-xs text-muted-foreground">Divisão (% de quem convidou):</label>
            <input value={ratio} onChange={(e) => setRatio(e.target.value)} inputMode="numeric"
              className="w-16 bg-input rounded-lg px-2 py-1.5 text-xs" />
            <button onClick={() => onSplitChange(Math.max(0, Math.min(100, Number(ratio) || 50)))}
              className="rounded-lg bg-primary/20 text-primary border border-primary/30 px-2.5 py-1.5 text-xs hover:bg-primary/30">
              Salvar
            </button>
          </div>
        </Card>
      ) : null}

      <Card>
        <p className="font-display text-lg mb-3">Lançamentos compartilhados</p>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nada compartilhado ainda. Marque um gasto, conta fixa, parcelamento ou meta como "compartilhado" nas telas de Transações, Contas Fixas, Compras Parceladas ou Metas.
          </p>
        ) : (
          <div className="space-y-2">
            {items.slice(0, 30).map((it: any) => (
              <div key={it.id} className="flex items-center justify-between rounded-xl border border-border bg-background/40 px-3 py-2 text-sm">
                <span className="truncate">{it.title || it.description || "Lançamento"}</span>
                <span className="text-muted-foreground text-xs shrink-0 ml-2">{it.amount != null ? BRL(Number(it.amount)) : it.target_amount != null ? BRL(Number(it.target_amount)) : ""}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
