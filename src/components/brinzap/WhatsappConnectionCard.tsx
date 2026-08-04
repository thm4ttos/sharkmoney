import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  MessageCircle, RefreshCw, Power, Send, Wifi, WifiOff,
  AlertTriangle, CheckCircle2, Loader2,
} from "lucide-react";
import {
  getWhatsAppConnection, sendWhatsAppTest,
  reconnectWhatsApp, disconnectWhatsApp,
} from "@/lib/profile.functions";
import { useAuthProfile } from "@/hooks/use-auth-profile";
import { formatPhoneDisplay } from "@/lib/phone";

type Props = {
  compact?: boolean;
  showManagement?: boolean;
};

function fmtRelative(iso?: string | null) {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return new Date(iso).toLocaleString("pt-BR");
  if (diff < 60_000) return "agora mesmo";
  if (diff < 3_600_000) return `há ${Math.round(diff / 60_000)} min`;
  if (diff < 86_400_000) return `hoje às ${new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
  return new Date(iso).toLocaleString("pt-BR");
}

export function WhatsappConnectionCard({ compact = false, showManagement = false }: Props) {
  const qc = useQueryClient();
  const { profile } = useAuthProfile();
  const fetchConn = useServerFn(getWhatsAppConnection);
  const testFn = useServerFn(sendWhatsAppTest);
  const reconnectFn = useServerFn(reconnectWhatsApp);
  const disconnectFn = useServerFn(disconnectWhatsApp);

  const { data, isLoading, isFetching, refetch } = useQuery<any>({
    queryKey: ["whatsapp-connection", profile?.id],
    queryFn: () => fetchConn() as any,
    enabled: !!profile?.id,
    refetchInterval: 30_000,
  });

  const userPhoneFormatted = formatPhoneDisplay(profile?.phone);

  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const showMsg = (kind: "ok" | "err", text: string) => {
    setMsg({ kind, text });
    setTimeout(() => setMsg(null), 4000);
  };

  const testMut = useMutation({
    mutationFn: async () => testFn({}),
    onSuccess: (r: any) => {
      if (r?.ok) showMsg("ok", "Mensagem de teste enviada para o seu WhatsApp.");
      else showMsg("err", r?.error ?? "Falha ao enviar mensagem de teste.");
    },
    onError: (e: any) => showMsg("err", e?.message ?? "Falha ao enviar mensagem de teste."),
  });

  const reconnectMut = useMutation({
    mutationFn: async () => reconnectFn({}),
    onSuccess: (r: any) => {
      if (r?.ok) showMsg("ok", "Comando de reconexão enviado.");
      else showMsg("err", r?.error ?? "Falha ao reconectar.");
      qc.invalidateQueries({ queryKey: ["whatsapp-connection"] });
    },
    onError: (e: any) => showMsg("err", e?.message ?? "Falha ao reconectar."),
  });

  const disconnectMut = useMutation({
    mutationFn: async () => disconnectFn({}),
    onSuccess: (r: any) => {
      if (r?.ok) showMsg("ok", "WhatsApp desconectado.");
      else showMsg("err", r?.error ?? "Falha ao desconectar.");
      setConfirmDisconnect(false);
      qc.invalidateQueries({ queryKey: ["whatsapp-connection"] });
    },
    onError: (e: any) => showMsg("err", e?.message ?? "Falha ao desconectar."),
  });

  if (isLoading) {
    return <section className="rounded-3xl border border-border bg-card/60 backdrop-blur-xl p-5 animate-pulse h-32" />;
  }

  const connected = !!data?.connected && !!userPhoneFormatted;
  const mismatch = !!data?.mismatch;

  if (compact) {
    if (!userPhoneFormatted) {
      return (
        <div className="rounded-xl border border-border bg-background/40 p-3 text-xs space-y-1">
          <div className="flex items-center gap-2 text-muted-foreground">
            <span className="h-2 w-2 rounded-full bg-muted-foreground/60" />
            <span className="font-medium">Sem WhatsApp</span>
          </div>
          {profile?.name && <p className="text-foreground truncate">{profile.name}</p>}
        </div>
      );
    }
    return (
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs space-y-1 hover:border-emerald-500/40 transition-smooth">
        <div className="flex items-center gap-2 text-emerald-300">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/70" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(74,222,128,0.8)]" />
          </span>
          <span className="font-medium">Online</span>
        </div>
        {profile?.name && <p className="text-foreground font-medium truncate">{profile.name}</p>}
        <p className="text-muted-foreground font-mono truncate">{userPhoneFormatted}</p>
      </div>
    );
  }

  return (
    <section className={`rounded-3xl border p-5 space-y-4 ${connected ? "border-emerald-500/30 bg-emerald-500/5" : "border-border bg-card/60"}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className={`h-11 w-11 grid place-items-center rounded-2xl ${connected ? "bg-emerald-500/15 text-emerald-300" : "bg-muted text-muted-foreground"}`}>
            <MessageCircle className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Integração WhatsApp</p>
            <p className="font-display text-xl flex items-center gap-2">
              {connected ? (
                <><span className="text-emerald-300">🟢</span> Conectado</>
              ) : (
                <><span>🔴</span> Desconectado</>
              )}
            </p>
          </div>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="inline-flex items-center gap-1.5 text-xs rounded-lg border border-border bg-background/40 px-3 py-1.5 hover:bg-background/60 disabled:opacity-60"
        >
          {isFetching ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Atualizar
        </button>
      </div>

      {/* Details */}
      <dl className="grid sm:grid-cols-2 gap-3 text-sm">
        <Detail label="Número conectado" value={data?.connectedPhoneFormatted || "—"} />
        <Detail label="Titular" value={data?.ownerName || "—"} />
        <Detail label="Última sincronização" value={fmtRelative(data?.lastSyncAt)} />
        <Detail label="Mensagens processadas" value={String(data?.processed ?? 0)} />
        <Detail label="Respostas da IA" value={String(data?.aiReplies ?? 0)} />
        <Detail label="Seu cadastro" value={userPhoneFormatted || "—"} />
      </dl>

      {!data?.configured && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          Credenciais da Z-API ainda não foram configuradas pelo administrador.
        </div>
      )}

      {mismatch && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          O número conectado na Z-API ({data?.connectedPhoneFormatted}) é diferente do seu cadastro ({userPhoneFormatted}).
        </div>
      )}

      {msg && (
        <div className={`rounded-xl border p-3 text-xs flex items-start gap-2 ${msg.kind === "ok" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : "border-destructive/30 bg-destructive/10 text-destructive"}`}>
          {msg.kind === "ok" ? <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" /> : <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />}
          <span>{msg.text}</span>
        </div>
      )}

      {/* Management actions */}
      {showManagement && (
        <div className="border-t border-border/60 pt-4 space-y-3">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Gerenciamento</p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            <button onClick={() => refetch()} disabled={isFetching}
              className="rounded-xl border border-border bg-background/40 px-3 py-2 text-xs hover:bg-background/60 inline-flex items-center justify-center gap-1.5 disabled:opacity-60">
              <RefreshCw className={`h-3 w-3 ${isFetching ? "animate-spin" : ""}`} /> Atualizar
            </button>
            <button onClick={() => reconnectMut.mutate()} disabled={reconnectMut.isPending}
              className="rounded-xl border border-border bg-background/40 px-3 py-2 text-xs hover:bg-background/60 inline-flex items-center justify-center gap-1.5 disabled:opacity-60">
              <Wifi className="h-3 w-3" /> {reconnectMut.isPending ? "Reconectando…" : "Reconectar"}
            </button>
            <button onClick={() => testMut.mutate()} disabled={testMut.isPending}
              className="rounded-xl border border-primary/30 bg-primary/10 text-primary px-3 py-2 text-xs hover:bg-primary/20 inline-flex items-center justify-center gap-1.5 disabled:opacity-60">
              <Send className="h-3 w-3" /> {testMut.isPending ? "Enviando…" : "Testar envio"}
            </button>
            <button onClick={() => setConfirmDisconnect(true)}
              className="rounded-xl border border-destructive/30 bg-destructive/10 text-destructive px-3 py-2 text-xs hover:bg-destructive/20 inline-flex items-center justify-center gap-1.5">
              <Power className="h-3 w-3" /> Desconectar
            </button>
          </div>

          {confirmDisconnect && (
            <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-3 space-y-2 text-xs">
              <p className="text-destructive font-medium flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" /> Deseja realmente desconectar o WhatsApp da Z-API?
              </p>
              <div className="flex gap-2">
                <button onClick={() => disconnectMut.mutate()} disabled={disconnectMut.isPending}
                  className="rounded-xl bg-destructive text-destructive-foreground px-3 py-1.5 disabled:opacity-60">
                  {disconnectMut.isPending ? "Desconectando…" : "Sim, desconectar"}
                </button>
                <button onClick={() => setConfirmDisconnect(false)}
                  className="rounded-xl border border-border px-3 py-1.5 hover:bg-background/40">
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-background/30 p-3">
      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium mt-0.5 truncate">{value}</dd>
    </div>
  );
}
