import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminListUsers, adminSetUserStatus, adminUpdateUserProfile } from "@/lib/brinzap.functions";
import {
  adminImpersonateUser,
  adminSendPasswordReset,
  adminListAuditLog,
} from "@/lib/admin-audit.functions";
import {
  adminListSubscriptions,
  adminSubscriptionStats,
  adminAssignSubscription,
  adminExtendSubscription,
  adminCancelSubscription,
  adminReactivateSubscription,
  adminUpdateSubscription,
  listPlans,
} from "@/lib/subscriptions.functions";
import {
  Search, Lock, Unlock, Phone, KeyRound, Mail, History, Copy, ExternalLink, X, Loader2,
  CalendarPlus, Ban, RefreshCw, Edit3, Sparkles, Users as UsersIcon, Clock, CheckCircle2, XCircle, Wallet, AlertTriangle,
  User, CreditCard,
} from "lucide-react";

export const Route = createFileRoute("/admin/users")({
  component: AdminUsers,
});

type Profile = {
  id: string; name: string; email: string | null; phone: string;
  plan: string; status: string; created_at: string; trial_ends_at: string;
  blocked_at: string | null;
};
type Subscription = {
  id: string; user_id: string; plan_slug: string; plan_name: string;
  period: string; status: string; price_cents: number;
  started_at: string; ends_at: string | null; cancelled_at: string | null;
  admin_note: string | null; created_at: string;
};
type Plan = { slug: string; name: string; period: string; price_cents: number; duration_days: number | null };
type Stats = { total: number; trials: number; active: number; expired: number; cancelled: number; mrrCents: number; expiringSoon: number };
type AuditRow = {
  id: string; target_user_id: string; admin_user_id: string;
  admin_email: string | null; action: string; description: string;
  metadata: any; created_at: string;
};
type LinkModal = { kind: "impersonate" | "reset"; email: string; link: string; userName: string; } | null;
type FilterKind = "all" | "trial" | "active" | "expired" | "cancelled" | "blocked";

const PERIOD_LABEL: Record<string, string> = {
  trial: "Trial", monthly: "Mensal", quarterly: "Trimestral",
  semiannual: "Semestral", annual: "Anual", lifetime: "Vitalício",
};

const fmtBRL = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function subStateOf(sub: Subscription | undefined): { state: "active" | "trial" | "expiring" | "expired" | "cancelled" | "none"; daysLeft: number | null } {
  if (!sub) return { state: "none", daysLeft: null };
  if (sub.status === "cancelled") return { state: "cancelled", daysLeft: null };
  if (sub.period === "lifetime") return { state: "active", daysLeft: null };
  const now = Date.now();
  const end = sub.ends_at ? new Date(sub.ends_at).getTime() : null;
  if (end !== null && end < now) return { state: "expired", daysLeft: 0 };
  const days = end !== null ? Math.max(0, Math.ceil((end - now) / 86400_000)) : null;
  if (sub.status === "trial") return { state: "trial", daysLeft: days };
  if (days !== null && days <= 7) return { state: "expiring", daysLeft: days };
  return { state: "active", daysLeft: days };
}

function StatCard({ label, value, sub, icon: Icon, accent }: { label: string; value: string; sub?: string; icon: any; accent: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card/60 backdrop-blur-xl p-4 hover:border-primary/40 transition-smooth">
      <div className="flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
        <div className={`h-8 w-8 grid place-items-center rounded-xl ${accent}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <p className="font-display text-2xl mt-2">{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

function AdminUsers() {
  const fetchUsers = useServerFn(adminListUsers);
  const fetchSubs = useServerFn(adminListSubscriptions);
  const fetchStats = useServerFn(adminSubscriptionStats);
  const fetchPlans = useServerFn(listPlans);
  const setStatus = useServerFn(adminSetUserStatus);
  const impersonate = useServerFn(adminImpersonateUser);
  const sendReset = useServerFn(adminSendPasswordReset);
  const extendSub = useServerFn(adminExtendSubscription);
  const cancelSub = useServerFn(adminCancelSubscription);
  const reactivateSub = useServerFn(adminReactivateSubscription);
  const qc = useQueryClient();

  const { data: users = [], isLoading } = useQuery<Profile[]>({
    queryKey: ["admin-users"],
    queryFn: () => fetchUsers() as Promise<Profile[]>,
  });
  const { data: subs = [] } = useQuery<Subscription[]>({
    queryKey: ["admin-subs"],
    queryFn: () => fetchSubs() as Promise<Subscription[]>,
  });
  const { data: stats } = useQuery<Stats>({
    queryKey: ["admin-sub-stats"],
    queryFn: () => fetchStats() as Promise<Stats>,
  });
  const { data: plans = [] } = useQuery<Plan[]>({
    queryKey: ["admin-plans"],
    queryFn: () => fetchPlans() as Promise<Plan[]>,
  });

  // map latest sub per user
  const subByUser = useMemo(() => {
    const map = new Map<string, Subscription>();
    for (const s of subs) {
      const cur = map.get(s.user_id);
      if (!cur || new Date(s.created_at).getTime() > new Date(cur.created_at).getTime()) map.set(s.user_id, s);
    }
    return map;
  }, [subs]);

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["admin-users"] });
    qc.invalidateQueries({ queryKey: ["admin-subs"] });
    qc.invalidateQueries({ queryKey: ["admin-sub-stats"] });
  };

  const mutStatus = useMutation({
    mutationFn: (v: { userId: string; status: "active" | "blocked" }) => setStatus({ data: v }),
    onSuccess: invalidateAll,
  });
  const mutExtend = useMutation({
    mutationFn: (v: { subscriptionId: string; days: number }) => extendSub({ data: v }),
    onSuccess: invalidateAll,
  });
  const mutCancel = useMutation({
    mutationFn: (v: { subscriptionId: string }) => cancelSub({ data: v }),
    onSuccess: invalidateAll,
  });
  const mutReactivate = useMutation({
    mutationFn: (v: { subscriptionId: string; days?: number }) => reactivateSub({ data: v }),
    onSuccess: invalidateAll,
  });

  const [linkModal, setLinkModal] = useState<LinkModal>(null);
  const [historyOf, setHistoryOf] = useState<Profile | null>(null);
  const [editSub, setEditSub] = useState<{ user: Profile; sub: Subscription | undefined } | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const handleImpersonate = async (u: Profile) => {
    setPendingId(u.id + ":imp");
    try {
      const r: any = await impersonate({ data: { targetUserId: u.id } });
      if (r?.actionLink) setLinkModal({ kind: "impersonate", email: r.email, link: r.actionLink, userName: u.name });
      else alert("Falha ao gerar link.");
    } catch (e: any) { alert(e?.message ?? "Erro ao impersonar."); } finally { setPendingId(null); }
  };
  const handleReset = async (u: Profile) => {
    setPendingId(u.id + ":reset");
    try {
      const redirectTo = typeof window !== "undefined" ? window.location.origin + "/reset-password" : undefined;
      const r: any = await sendReset({ data: { targetUserId: u.id, redirectTo } });
      if (r?.actionLink) setLinkModal({ kind: "reset", email: r.email, link: r.actionLink, userName: u.name });
      else alert("Falha ao gerar link.");
    } catch (e: any) { alert(e?.message ?? "Erro ao redefinir."); } finally { setPendingId(null); }
  };

  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<FilterKind>("all");

  const filtered = useMemo(() => {
    return users.filter((u) => {
      const matchQ = !q
        || (u.name?.toLowerCase() ?? "").includes(q.toLowerCase())
        || (u.email?.toLowerCase() ?? "").includes(q.toLowerCase())
        || (u.phone ?? "").includes(q);
      if (!matchQ) return false;
      if (filter === "all") return true;
      if (filter === "blocked") return u.status === "blocked";
      const sub = subByUser.get(u.id);
      const { state } = subStateOf(sub);
      if (filter === "active") return state === "active" || state === "expiring";
      if (filter === "trial") return state === "trial";
      if (filter === "expired") return state === "expired";
      if (filter === "cancelled") return state === "cancelled";
      return true;
    });
  }, [users, q, filter, subByUser]);

  const annualMrr = stats ? stats.mrrCents * 12 : 0;

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs uppercase tracking-[0.2em] text-primary">Base</p>
        <h1 className="font-display text-3xl mt-1">Usuários & Assinaturas</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {users.length} cadastrados · controle total de planos, vencimentos e renovações.
        </p>
      </header>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        <StatCard label="Total" value={String(stats?.total ?? 0)} icon={UsersIcon} accent="bg-primary/15 text-primary" />
        <StatCard label="Trials" value={String(stats?.trials ?? 0)} icon={Clock} accent="bg-amber-500/15 text-amber-300" />
        <StatCard label="Ativos" value={String(stats?.active ?? 0)} icon={CheckCircle2} accent="bg-emerald-500/15 text-emerald-300" />
        <StatCard label="Expirados" value={String(stats?.expired ?? 0)} icon={XCircle} accent="bg-destructive/15 text-destructive" />
        <StatCard label="Cancelados" value={String(stats?.cancelled ?? 0)} icon={Ban} accent="bg-muted text-muted-foreground" />
        <StatCard label="MRR estimado" value={fmtBRL(stats?.mrrCents ?? 0)} sub={`ARR ${fmtBRL(annualMrr)}`} icon={Wallet} accent="bg-primary/15 text-primary" />
        <StatCard label="Vencem em ≤7d" value={String(stats?.expiringSoon ?? 0)} icon={AlertTriangle} accent="bg-amber-500/15 text-amber-300" />
      </div>

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por nome, email ou telefone…"
            className="w-full bg-card/60 border border-border rounded-xl pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:border-primary/60 transition-smooth"
          />
        </div>
        <div className="flex gap-1 rounded-xl border border-border bg-card/60 p-1 flex-wrap">
          {(["all","trial","active","expired","cancelled","blocked"] as FilterKind[]).map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={[
                "px-3 py-1.5 text-xs rounded-lg transition-smooth capitalize",
                filter === s ? "bg-gradient-brand text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              ].join(" ")}
            >
              {s === "all" ? "Todos" : s === "trial" ? "Trial" : s === "active" ? "Ativos" : s === "expired" ? "Expirados" : s === "cancelled" ? "Cancelados" : "Bloqueados"}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="rounded-2xl border border-border bg-card/60 backdrop-blur-xl overflow-hidden">
        <div className="divide-y divide-border">
          {isLoading && <div className="px-5 py-10 text-center text-sm text-muted-foreground">Carregando…</div>}
          {!isLoading && filtered.map((u) => {
            const sub = subByUser.get(u.id);
            const { state, daysLeft } = subStateOf(sub);
            const blocked = u.status === "blocked";
            const impLoading = pendingId === u.id + ":imp";
            const resLoading = pendingId === u.id + ":reset";

            const ring =
              state === "active" ? "border-l-emerald-500" :
              state === "expiring" ? "border-l-amber-500" :
              state === "trial" ? "border-l-amber-400" :
              state === "expired" ? "border-l-destructive" :
              state === "cancelled" ? "border-l-muted-foreground" :
              "border-l-border";

            const stateBadge =
              state === "active" ? { label: "Ativo", cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" } :
              state === "expiring" ? { label: `Vence em ${daysLeft}d`, cls: "bg-amber-500/15 text-amber-300 border-amber-500/30" } :
              state === "trial" ? { label: `Trial · ${daysLeft ?? 0}d`, cls: "bg-amber-500/15 text-amber-300 border-amber-500/30" } :
              state === "expired" ? { label: "Expirada", cls: "bg-destructive/15 text-destructive border-destructive/30" } :
              state === "cancelled" ? { label: "Cancelada", cls: "bg-muted text-muted-foreground border-border" } :
              { label: "Sem plano", cls: "bg-muted text-muted-foreground border-border" };

            return (
              <div key={u.id} className={`px-5 py-4 border-l-4 ${ring} hover:bg-background/40 transition-smooth`}>
                <div className="flex items-start gap-4 flex-wrap">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="h-10 w-10 rounded-full bg-gradient-brand grid place-items-center text-primary-foreground text-xs font-semibold shrink-0">
                      {(u.name || "?").split(" ").map((p) => p[0]).slice(0, 2).join("")}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium truncate">{u.name || "(sem nome)"}</p>
                        {blocked && <span className="text-[10px] px-1.5 py-0.5 rounded bg-destructive/15 text-destructive border border-destructive/30 uppercase tracking-wider">Bloqueado</span>}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{u.email ?? "—"}</p>
                      <p className="text-[11px] text-muted-foreground inline-flex items-center gap-1 mt-0.5">
                        <Phone className="h-3 w-3" /> {u.phone || "—"}
                      </p>
                    </div>
                  </div>

                  <div className="min-w-[200px]">
                    <span className={`inline-block text-[11px] px-2 py-0.5 rounded-full border ${stateBadge.cls}`}>{stateBadge.label}</span>
                    <p className="text-sm font-medium mt-1">{sub?.plan_name ?? u.plan ?? "—"}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {sub ? `${PERIOD_LABEL[sub.period] ?? sub.period} · ${fmtBRL(sub.price_cents)}` : "Sem assinatura"}
                    </p>
                    {sub?.ends_at && (
                      <p className="text-[11px] text-muted-foreground">
                        Vence: {new Date(sub.ends_at).toLocaleDateString("pt-BR")}
                      </p>
                    )}
                    {sub?.started_at && (
                      <p className="text-[10px] text-muted-foreground">
                        Início: {new Date(sub.started_at).toLocaleDateString("pt-BR")}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-1.5 justify-end items-start">
                    {sub && state !== "cancelled" && [7, 30, 180, 365].map((d) => (
                      <button
                        key={d}
                        disabled={mutExtend.isPending}
                        onClick={() => mutExtend.mutate({ subscriptionId: sub.id, days: d })}
                        title={`Adicionar ${d} dias`}
                        className="inline-flex items-center gap-1 rounded-lg border border-primary/30 text-primary px-2 py-1 text-[11px] hover:bg-primary/10 transition-smooth disabled:opacity-50"
                      >
                        <CalendarPlus className="h-3 w-3" /> +{d}d
                      </button>
                    ))}
                    {sub && state !== "cancelled" && (
                      <button
                        disabled={mutCancel.isPending}
                        onClick={() => { if (confirm("Cancelar assinatura?")) mutCancel.mutate({ subscriptionId: sub.id }); }}
                        className="inline-flex items-center gap-1 rounded-lg border border-destructive/40 text-destructive px-2 py-1 text-[11px] hover:bg-destructive/10 transition-smooth disabled:opacity-50"
                      >
                        <Ban className="h-3 w-3" /> Cancelar
                      </button>
                    )}
                    {sub && (state === "cancelled" || state === "expired") && (
                      <button
                        disabled={mutReactivate.isPending}
                        onClick={() => mutReactivate.mutate({ subscriptionId: sub.id, days: 30 })}
                        className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/40 text-emerald-300 px-2 py-1 text-[11px] hover:bg-emerald-500/10 transition-smooth disabled:opacity-50"
                      >
                        <RefreshCw className="h-3 w-3" /> Reativar
                      </button>
                    )}
                    <button
                      onClick={() => setEditSub({ user: u, sub })}
                      className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] hover:border-primary/40 transition-smooth"
                    >
                      {sub ? <Edit3 className="h-3 w-3" /> : <Sparkles className="h-3 w-3" />}
                      {sub ? "Editar" : "Criar"}
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-border">
                  <button
                    disabled={impLoading}
                    onClick={() => handleImpersonate(u)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-primary/40 text-primary px-2.5 py-1 text-[11px] hover:bg-primary/10 transition-smooth disabled:opacity-50"
                  >
                    {impLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <KeyRound className="h-3 w-3" />}
                    Entrar como
                  </button>
                  <button
                    disabled={resLoading}
                    onClick={() => handleReset(u)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-[11px] hover:border-accent/40 transition-smooth disabled:opacity-50"
                  >
                    {resLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Mail className="h-3 w-3" />}
                    Reset senha
                  </button>
                  <button
                    onClick={() => setHistoryOf(u)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-[11px] hover:border-primary/40 transition-smooth"
                  >
                    <History className="h-3 w-3" /> Histórico
                  </button>
                  <button
                    disabled={mutStatus.isPending}
                    onClick={() => mutStatus.mutate({ userId: u.id, status: blocked ? "active" : "blocked" })}
                    className={[
                      "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] transition-smooth disabled:opacity-50 ml-auto",
                      blocked ? "border-primary/40 text-primary hover:bg-primary/10" : "border-destructive/40 text-destructive hover:bg-destructive/10",
                    ].join(" ")}
                  >
                    {blocked ? <><Unlock className="h-3 w-3" /> Desbloquear</> : <><Lock className="h-3 w-3" /> Bloquear</>}
                  </button>
                </div>
              </div>
            );
          })}
          {!isLoading && filtered.length === 0 && (
            <div className="px-5 py-10 text-center text-sm text-muted-foreground">Nenhum usuário encontrado.</div>
          )}
        </div>
      </div>

      {linkModal && <LinkResultModal modal={linkModal} onClose={() => setLinkModal(null)} />}
      {historyOf && <HistoryModal user={historyOf} onClose={() => setHistoryOf(null)} />}
      {editSub && (
        <SubscriptionEditorModal
          user={editSub.user}
          sub={editSub.sub}
          plans={plans}
          onClose={() => setEditSub(null)}
          onSaved={() => { invalidateAll(); setEditSub(null); }}
        />
      )}
    </div>
  );
}

function LinkResultModal({ modal, onClose }: { modal: NonNullable<LinkModal>; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const isImp = modal.kind === "impersonate";
  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm grid place-items-center p-4">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl">
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-primary">
              {isImp ? "Link de acesso direto" : "Link de redefinição de senha"}
            </p>
            <h2 className="font-display text-xl mt-1">{modal.userName}</h2>
            <p className="text-xs text-muted-foreground">{modal.email}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>
        <div className="rounded-xl border border-border bg-background/40 p-3 text-xs break-all max-h-32 overflow-auto">{modal.link}</div>
        <p className="text-xs text-muted-foreground mt-3">
          {isImp ? "Abra este link em aba anônima para entrar como este usuário. O link funciona uma única vez." : "Envie este link ao usuário (e-mail ou WhatsApp). Ao abrir, ele poderá definir uma nova senha."}
        </p>
        <div className="flex gap-2 mt-4">
          <button
            onClick={() => { navigator.clipboard.writeText(modal.link); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
            className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:border-primary/40 transition-smooth"
          >
            <Copy className="h-4 w-4" /> {copied ? "Copiado!" : "Copiar link"}
          </button>
          <a href={modal.link} target="_blank" rel="noopener noreferrer"
            className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-brand text-primary-foreground px-3 py-2 text-sm glow-neon">
            <ExternalLink className="h-4 w-4" /> Abrir
          </a>
        </div>
      </div>
    </div>
  );
}

function HistoryModal({ user, onClose }: { user: Profile; onClose: () => void }) {
  const fetchLog = useServerFn(adminListAuditLog);
  const { data: rows = [], isLoading } = useQuery<AuditRow[]>({
    queryKey: ["admin-audit", user.id],
    queryFn: () => fetchLog({ data: { targetUserId: user.id, limit: 200 } }) as Promise<AuditRow[]>,
  });
  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm grid place-items-center p-4">
      <div className="w-full max-w-2xl rounded-2xl border border-border bg-card shadow-2xl flex flex-col max-h-[80vh]">
        <div className="flex items-start justify-between p-6 border-b border-border">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-primary">Histórico admin</p>
            <h2 className="font-display text-xl mt-1">{user.name}</h2>
            <p className="text-xs text-muted-foreground">{user.email ?? user.phone}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>
        <div className="overflow-y-auto p-6">
          {isLoading && <p className="text-sm text-muted-foreground text-center py-8">Carregando…</p>}
          {!isLoading && rows.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">Nenhuma ação administrativa registrada.</p>
          )}
          <ol className="relative border-l border-border ml-3 space-y-5">
            {rows.map((r) => (
              <li key={r.id} className="ml-5">
                <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full bg-gradient-brand glow-neon" />
                <p className="text-[11px] text-muted-foreground">{new Date(r.created_at).toLocaleString("pt-BR")}</p>
                <p className="text-sm font-medium mt-0.5 whitespace-pre-line">{r.description}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  <span className="inline-block px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 mr-2 text-[10px] uppercase tracking-wider">{r.action}</span>
                  por {r.admin_email ?? r.admin_user_id.slice(0, 8)}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}

const QUICK_DAYS = [7, 30, 180, 365];

function addDaysToDateInput(base: string, days: number): string {
  const from = base ? new Date(base + "T12:00:00") : new Date();
  const start = from.getTime() > Date.now() ? from : new Date();
  const next = new Date(start.getTime() + days * 86400_000);
  return next.toISOString().slice(0, 10);
}

function SubscriptionEditorModal({
  user, sub, plans, onClose, onSaved,
}: {
  user: Profile; sub: Subscription | undefined; plans: Plan[];
  onClose: () => void; onSaved: () => void;
}) {
  const isCreate = !sub;
  const assign = useServerFn(adminAssignSubscription);
  const update = useServerFn(adminUpdateSubscription);
  const updateProfile = useServerFn(adminUpdateUserProfile);

  const [tab, setTab] = useState<"perfil" | "assinatura">("perfil");

  // ----- Perfil -----
  const [name, setName] = useState(user.name ?? "");
  const [email, setEmail] = useState(user.email ?? "");
  const [phone, setPhone] = useState(user.phone ?? "");

  // ----- Assinatura -----
  const [planSlug, setPlanSlug] = useState(sub?.plan_slug ?? plans[0]?.slug ?? "monthly");
  const [priceReais, setPriceReais] = useState(((sub?.price_cents ?? 0) / 100).toFixed(2));
  const [startedAt, setStartedAt] = useState<string>(sub?.started_at ? sub.started_at.slice(0, 10) : "");
  const [endsAt, setEndsAt] = useState<string>(sub?.ends_at ? sub.ends_at.slice(0, 10) : "");
  const [status, setStatus] = useState<string>(sub?.status ?? "active");
  const [note, setNote] = useState("");

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const applyQuickDays = (days: number) => setEndsAt((cur) => addDaysToDateInput(cur, days));

  const submit = async () => {
    setSaving(true); setErr(null);
    try {
      const profileChanged = name.trim() !== (user.name ?? "") || email.trim() !== (user.email ?? "") || phone.trim() !== (user.phone ?? "");
      if (profileChanged) {
        if (!name.trim()) throw new Error("Nome é obrigatório.");
        if (!email.trim()) throw new Error("E-mail é obrigatório.");
        if (!phone.trim()) throw new Error("WhatsApp é obrigatório.");
        await updateProfile({ data: { userId: user.id, name: name.trim(), email: email.trim(), phone: phone.trim() } });
      }

      const priceCents = Math.round(Number(priceReais.replace(",", ".")) * 100);
      if (!Number.isFinite(priceCents) || priceCents < 0) throw new Error("Valor inválido");
      const startedAtIso = startedAt ? new Date(startedAt + "T00:00:00").toISOString() : null;
      const endsAtIso = endsAt ? new Date(endsAt + "T23:59:59").toISOString() : null;
      if (isCreate) {
        await assign({ data: { userId: user.id, planSlug, adminNote: note || undefined } });
      } else {
        await update({
          data: {
            subscriptionId: sub!.id,
            planSlug,
            priceCents,
            startedAt: startedAtIso,
            endsAt: endsAtIso,
            status: status as any,
          },
        });
      }
      onSaved();
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm grid place-items-center p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl">
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-primary">Editar usuário</p>
            <h2 className="font-display text-xl mt-1">{user.name || "(sem nome)"}</h2>
            <p className="text-xs text-muted-foreground">{user.email ?? user.phone}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>

        <div className="inline-flex rounded-xl border border-border p-1 bg-background/40 mb-4">
          {([
            { id: "perfil" as const, label: "Perfil", icon: User },
            { id: "assinatura" as const, label: "Assinatura", icon: CreditCard },
          ]).map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={["inline-flex items-center gap-1.5 px-4 py-1.5 text-sm rounded-lg transition-smooth", tab === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground"].join(" ")}
              >
                <Icon className="h-3.5 w-3.5" /> {t.label}
              </button>
            );
          })}
        </div>

        {tab === "perfil" ? (
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">Nome</label>
              <input value={name} onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full bg-input rounded-xl px-3 py-2.5 text-sm" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">E-mail</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full bg-input rounded-xl px-3 py-2.5 text-sm" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">WhatsApp</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+55 32 99999-4241" className="mt-1 w-full bg-input rounded-xl px-3 py-2.5 text-sm font-mono" />
              <p className="text-[11px] text-muted-foreground mt-1">Sincroniza automaticamente com Admin &gt; WhatsApp &gt; Contatos.</p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">Plano</label>
              <select value={planSlug} onChange={(e) => {
                setPlanSlug(e.target.value);
                const p = plans.find((pp) => pp.slug === e.target.value);
                if (p) setPriceReais((p.price_cents / 100).toFixed(2));
              }} className="mt-1 w-full bg-input rounded-xl px-3 py-2.5 text-sm">
                {plans.map((p) => (
                  <option key={p.slug} value={p.slug}>{p.name} · {PERIOD_LABEL[p.period] ?? p.period}</option>
                ))}
              </select>
            </div>

            {!isCreate && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-muted-foreground">Valor (R$)</label>
                  <input value={priceReais} onChange={(e) => setPriceReais(e.target.value)}
                    className="mt-1 w-full bg-input rounded-xl px-3 py-2.5 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Status</label>
                  <select value={status} onChange={(e) => setStatus(e.target.value)}
                    className="mt-1 w-full bg-input rounded-xl px-3 py-2.5 text-sm">
                    <option value="trial">Trial</option>
                    <option value="active">Ativo</option>
                    <option value="expired">Expirado</option>
                    <option value="cancelled">Cancelado</option>
                  </select>
                </div>
              </div>
            )}

            {!isCreate && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-muted-foreground">Data de início</label>
                  <input type="date" value={startedAt} onChange={(e) => setStartedAt(e.target.value)}
                    className="mt-1 w-full bg-input rounded-xl px-3 py-2.5 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Vencimento</label>
                  <input type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)}
                    className="mt-1 w-full bg-input rounded-xl px-3 py-2.5 text-sm" />
                </div>
              </div>
            )}

            {!isCreate && (
              <div>
                <p className="text-[11px] text-muted-foreground mb-1">Adicionar ao vencimento</p>
                <div className="flex gap-1.5">
                  {QUICK_DAYS.map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => applyQuickDays(d)}
                      className="inline-flex items-center gap-1 rounded-lg border border-primary/30 text-primary px-2 py-1 text-[11px] hover:bg-primary/10 transition-smooth"
                    >
                      <CalendarPlus className="h-3 w-3" /> +{d}d
                    </button>
                  ))}
                </div>
                {endsAt && <p className="text-[11px] text-muted-foreground mt-1">Novo vencimento: {new Date(endsAt + "T12:00:00").toLocaleDateString("pt-BR")}</p>}
              </div>
            )}

            {isCreate && (
              <div>
                <label className="text-xs text-muted-foreground">Observação (opcional)</label>
                <input value={note} onChange={(e) => setNote(e.target.value)}
                  placeholder="Ex: Concedido manualmente pelo suporte"
                  className="mt-1 w-full bg-input rounded-xl px-3 py-2.5 text-sm" />
              </div>
            )}
          </div>
        )}

        {err && <p className="text-xs text-destructive mt-3">{err}</p>}

        <button
          disabled={saving}
          onClick={submit}
          className="w-full rounded-xl bg-gradient-brand text-primary-foreground font-medium py-2.5 glow-neon disabled:opacity-50 hover:scale-[1.01] transition-smooth mt-4"
        >
          {saving ? "Salvando…" : isCreate ? "Criar assinatura" : "Salvar alterações"}
        </button>
      </div>
    </div>
  );
}
