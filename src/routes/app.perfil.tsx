import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { logout } from "@/lib/user-session";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  User as UserIcon, Crown, Clock, CheckCircle2, XCircle,
  Mail, Phone, Calendar, KeyRound, LogOut, Download, Bell, MessageCircle,
  Wallet, TrendingUp, TrendingDown, PiggyBank, ShieldCheck, BarChart3,
  Layers, Target, ListChecks, Hash, Globe, RefreshCw, Camera, ArrowUpRight, Heart,
  ArrowDownRight, Plus, CalendarRange, Sparkles, Ban,
} from "lucide-react";
import { getMySubscription, getMySubscriptionHistory } from "@/lib/subscriptions.functions";
import { cancelMySubscription } from "@/lib/mercadopago.functions";
import { getPlan } from "@/lib/plans";
import {
  getProfileOverview, updateMyProfile, signOutAllSessions, exportMyData,
} from "@/lib/profile.functions";
import { getDashboardStats, type DashboardRange } from "@/lib/dashboard.functions";
import { listTransactions, sendWelcomeWhatsapp } from "@/lib/brinzap.functions";
import { formatBRL, categoryGroups, groupOf } from "@/lib/user-mock";
import { formatDateSP } from "@/lib/datetime";
import { ClickableKpi, TxListPanel, BalancePanel, useKpiPopover } from "@/components/brinzap/dashboard/KpiPopover";
import { BalanceBreakdownDialog } from "@/components/brinzap/dashboard/BalanceBreakdownDialog";
import { UpcomingBillsCard } from "@/components/brinzap/dashboard/UpcomingBillsCard";
import { AvatarEditor } from "@/components/brinzap/AvatarEditor";

export const Route = createFileRoute("/app/perfil")({
  head: () => ({ meta: [{ title: "Meu Perfil · Abio" }] }),
  component: Page,
});

const RANGE_OPTIONS: { key: DashboardRange; label: string }[] = [
  { key: "all", label: "Histórico completo" },
  { key: "today", label: "Hoje" },
  { key: "yesterday", label: "Ontem" },
  { key: "this_week", label: "Esta semana" },
  { key: "last_7_days", label: "Últimos 7 dias" },
  { key: "this_month", label: "Este mês" },
  { key: "last_month", label: "Mês passado" },
  { key: "this_year", label: "Este ano" },
  { key: "custom", label: "Personalizado" },
];

const brl = (n: number) =>
  (Number.isFinite(n) ? n : 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function initials(name?: string | null) {
  if (!name) return "U";
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("") || "U";
}
function fmtDateTime(s?: string | null) {
  if (!s) return "—";
  try { return new Date(s).toLocaleString("pt-BR"); } catch { return "—"; }
}
function fmtDate(s?: string | null) {
  if (!s) return "—";
  try { return new Date(s).toLocaleDateString("pt-BR"); } catch { return "—"; }
}
function daysSince(s?: string | null) {
  if (!s) return 0;
  const diff = Date.now() - new Date(s).getTime();
  return Math.max(0, Math.floor(diff / 86400_000));
}
function groupKeyForCategory(category?: string | null) {
  const raw = String(category ?? "").toLowerCase().trim();
  if (!raw) return "outros";
  const found = categoryGroups.find((g) =>
    g.name.toLowerCase() === raw || g.categories.some((c) => c.toLowerCase() === raw)
  );
  return found?.key ?? "outros";
}

// ============================================================
// Page — "Meu Perfil" (inclui o que antes era a página "Início":
// resumo financeiro por período, últimos lançamentos, lembretes
// próximos e atalhos por categoria, tudo na mesma aba).
// ============================================================
function Page() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const fetchOverview = useServerFn(getProfileOverview);
  const updateFn = useServerFn(updateMyProfile);
  const signOutAllFn = useServerFn(signOutAllSessions);
  const exportFn = useServerFn(exportMyData);
  const sendWelcome = useServerFn(sendWelcomeWhatsapp);
  const fetchStats = useServerFn(getDashboardStats);
  const fetchTransactions = useServerFn(listTransactions);

  const { data: overview, isLoading } = useQuery<any>({
    queryKey: ["profile-overview"],
    queryFn: () => fetchOverview() as any,
    refetchInterval: 60_000,
  });

  const profile = overview?.profile;
  const finance = overview?.finance;
  const counts = overview?.counts;
  const security = overview?.security;

  // Boas-vindas no WhatsApp — dispara uma vez, assim que o telefone é conhecido.
  const triedWelcome = useRef(false);
  useEffect(() => {
    if (triedWelcome.current) return;
    if (!profile?.phone) return;
    triedWelcome.current = true;
    sendWelcome({ data: { phone: profile.phone } }).catch(() => {});
  }, [profile?.phone, sendWelcome]);

  const { openCard, toggle, close } = useKpiPopover();
  const [explainOpen, setExplainOpen] = useState(false);
  const [range, setRange] = useState<DashboardRange>("all");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  const effectiveArgs = useMemo(() => {
    if (range === "custom" && customStart && customEnd) return { range, start: customStart, end: customEnd };
    return { range };
  }, [range, customStart, customEnd]);

  const { data: live } = useQuery({
    queryKey: ["home-stats", profile?.id, effectiveArgs.range, effectiveArgs.start ?? "", effectiveArgs.end ?? ""],
    queryFn: () => fetchStats({ data: effectiveArgs }) as any,
    enabled: !!profile?.id && (range !== "custom" || (!!customStart && !!customEnd)),
    staleTime: 30_000,
  });

  // Fonte única de verdade: mesma query usada em /app/transacoes (página 1, sem filtros).
  const { data: latestTx } = useQuery<{ rows: any[]; total: number }>({
    queryKey: ["transactions", { q: undefined, kind: undefined, categories: undefined, limit: 5, offset: 0, withCount: true }],
    queryFn: () => fetchTransactions({ data: { limit: 5, offset: 0, withCount: true } }) as any,
    enabled: !!profile?.id,
    staleTime: 15_000,
  });
  const latestRows = latestTx?.rows ?? [];

  const homeStats = useMemo(() => {
    const income = Number(live?.income ?? 0);
    const expense = Number(live?.expense ?? 0);
    const top = live?.topCategories?.[0];
    return {
      income, expense, balance: income - expense,
      topGroup: top ? { name: top.category } : null,
      hasData: (live?.transactionCount ?? 0) > 0 || income > 0 || expense > 0,
      prevExpense: Number(live?.prevExpense ?? 0),
      prevIncome: Number(live?.prevIncome ?? 0),
      appointments: (live?.appointments ?? []) as Array<any>,
      rangeLabel: (live?.rangeLabel ?? "Histórico completo") as string,
      hasCompare: Boolean(live?.hasCompare),
    };
  }, [live]);

  const comparative = useMemo(() => {
    if (!homeStats.hasCompare || !homeStats.hasData) return null;
    if (homeStats.prevExpense > 0 && homeStats.expense < homeStats.prevExpense) {
      const pct = Math.round(((homeStats.prevExpense - homeStats.expense) / homeStats.prevExpense) * 100);
      return `🚀 Você gastou ${pct}% menos que no período anterior. Continue assim!`;
    }
    if (homeStats.prevExpense > 0 && homeStats.expense > homeStats.prevExpense) {
      const pct = Math.round(((homeStats.expense - homeStats.prevExpense) / homeStats.prevExpense) * 100);
      return `⚠️ Suas despesas subiram ${pct}% em relação ao período anterior.`;
    }
    if (homeStats.prevIncome > 0 && homeStats.income > homeStats.prevIncome) {
      const pct = Math.round(((homeStats.income - homeStats.prevIncome) / homeStats.prevIncome) * 100);
      return `📈 Sua receita aumentou ${pct}% em relação ao período anterior.`;
    }
    return null;
  }, [homeStats]);

  const motivational = useMemo(() => {
    if (!homeStats.hasData) return "💡 Dica: envie fotos de comprovantes pelo WhatsApp para registrar gastos automaticamente.";
    if (comparative) return comparative;
    if (homeStats.balance > 0) return `💰 Seu saldo está positivo em ${formatBRL(homeStats.balance)}. Bom trabalho!`;
    return "💡 Envie mensagens no WhatsApp para registrar suas movimentações sem esforço.";
  }, [homeStats, comparative]);

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [gender, setGender] = useState("");
  const [notifyWa, setNotifyWa] = useState(true);
  const [notifyEmail, setNotifyEmail] = useState(true);
  const [notifyWeekly, setNotifyWeekly] = useState(true);
  const [saved, setSaved] = useState<string | null>(null);
  const [avatarOpen, setAvatarOpen] = useState(false);

  useEffect(() => {
    if (profile) {
      setName(profile.name ?? "");
      setEmail(profile.email ?? "");
      setPhone(profile.phone ?? "");
      setGender(profile.gender ?? "");
      setNotifyWa(!!profile.notify_whatsapp);
      setNotifyEmail(!!profile.notify_email);
      // Padrão é ligado — mesma regra usada no envio (weekly-summary.ts:
      // "p.weekly_summary_enabled !== false"), null/undefined conta como true.
      setNotifyWeekly((profile as any).weekly_summary_enabled !== false);
    }
  }, [profile]);

  const saveAvatar = async (dataUri: string | null) => {
    await updateFn({ data: { avatar_url: dataUri } as any });
    await qc.invalidateQueries({ queryKey: ["profile-overview"] });
    await qc.invalidateQueries({ queryKey: ["auth-profile"] });
    window.dispatchEvent(new CustomEvent("abio:profile-updated"));
  };

  const memberSince = useMemo(() => fmtDate(profile?.created_at), [profile]);
  const lastAccess = useMemo(() => fmtDateTime(profile?.last_seen_at ?? profile?.updated_at), [profile]);
  const accountAgeDays = useMemo(() => daysSince(profile?.created_at), [profile]);
  const username = useMemo(() => {
    if (!profile) return "—";
    if (profile.email) return String(profile.email).split("@")[0];
    return (profile.name ?? "").toLowerCase().replace(/\s+/g, ".") || "—";
  }, [profile]);

  // ===== Password change =====
  const [pwOpen, setPwOpen] = useState(false);
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const [pwBusy, setPwBusy] = useState(false);

  // ===== Misc =====
  const [signOutBusy, setSignOutBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);

  const onSave = async () => {
    try {
      await updateFn({
        data: {
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim(),
          notify_whatsapp: notifyWa,
          notify_email: notifyEmail,
          gender: (gender || null) as any,
        } as any,
      });
      setSaved("Dados atualizados ✅");
      qc.invalidateQueries({ queryKey: ["profile-overview"] });
      qc.invalidateQueries({ queryKey: ["auth-profile"] });
      window.dispatchEvent(new CustomEvent("abio:profile-updated"));
      setEditing(false);
    } catch (e: any) {
      setSaved(e?.message ?? "Erro ao salvar.");
    } finally {
      setTimeout(() => setSaved(null), 2500);
    }
  };

  const onToggleNotify = async (kind: "wa" | "email" | "weekly", v: boolean) => {
    if (kind === "wa") setNotifyWa(v);
    else if (kind === "email") setNotifyEmail(v);
    else setNotifyWeekly(v);
    try {
      const patch = kind === "wa" ? { notify_whatsapp: v }
        : kind === "email" ? { notify_email: v }
        : { weekly_summary_enabled: v };
      await updateFn({ data: patch });
      qc.invalidateQueries({ queryKey: ["profile-overview"] });
    } catch { /* ignore */ }
  };

  const onChangePassword = async () => {
    setPwMsg(null);
    if (newPw.length < 8) return setPwMsg("Use ao menos 8 caracteres.");
    if (newPw !== newPw2) return setPwMsg("As senhas não coincidem.");
    setPwBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPw });
      if (error) throw error;
      setPwMsg("Senha alterada com sucesso ✅");
      setNewPw(""); setNewPw2("");
      setTimeout(() => { setPwOpen(false); setPwMsg(null); }, 1500);
    } catch (e: any) {
      setPwMsg(e?.message ?? "Erro ao alterar senha.");
    } finally {
      setPwBusy(false);
    }
  };

  const onSignOutAll = async () => {
    if (!confirm("Encerrar todas as sessões? Você precisará fazer login novamente em todos os dispositivos.")) return;
    setSignOutBusy(true);
    try {
      await signOutAllFn({});
      await logout();
      navigate({ to: "/login" });
    } catch (e: any) {
      alert(e?.message ?? "Erro ao encerrar sessões.");
    } finally {
      setSignOutBusy(false);
    }
  };

  const onExport = async () => {
    setExportBusy(true);
    try {
      const dump = await exportFn({});
      const blob = new Blob([JSON.stringify(dump, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `abio-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert(e?.message ?? "Erro ao exportar.");
    } finally {
      setExportBusy(false);
    }
  };

  if (isLoading || !profile) return <Skeleton />;

  const statusBadge =
    profile.status === "blocked"
      ? { label: "Bloqueado", cls: "border-destructive/40 bg-destructive/10 text-destructive", Icon: XCircle }
      : { label: "Ativa", cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300", Icon: CheckCircle2 };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <AvatarEditor open={avatarOpen} onOpenChange={setAvatarOpen} currentUrl={profile.avatar_url} onSave={saveAvatar} />

      {/* ===== HERO HEADER ===== */}
      <motion.header
        initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
        className="relative overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-primary/15 via-card/60 to-card/40 backdrop-blur-xl p-6"
      >
        <div className="absolute -top-24 -right-24 h-64 w-64 rounded-full bg-primary/20 blur-3xl pointer-events-none" />
        <div className="relative flex flex-col md:flex-row md:items-center gap-5">
          <div className="relative group">
            <button
              type="button"
              onClick={() => setAvatarOpen(true)}
              title="Alterar foto"
              className="h-20 w-20 rounded-2xl overflow-hidden bg-gradient-brand text-primary-foreground grid place-items-center text-3xl font-display glow-neon shrink-0"
            >
              {profile.avatar_url
                ? <img src={profile.avatar_url} alt={`Foto de ${profile.name ?? "perfil"}`} className="h-full w-full object-cover" />
                : initials(profile.name)}
            </button>
            <button
              type="button"
              onClick={() => setAvatarOpen(true)}
              title="Alterar foto"
              className="absolute -bottom-1 -right-1 h-7 w-7 grid place-items-center rounded-full border border-border bg-background/80 backdrop-blur text-foreground hover:bg-background"
            >
              <Camera className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="font-display text-3xl truncate">{profile.name || "Sem nome"}</h1>
              <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border ${statusBadge.cls}`}>
                <statusBadge.Icon className="h-3 w-3" /> {statusBadge.label}
              </span>
              <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border border-primary/30 bg-primary/10 text-primary">
                <Crown className="h-3 w-3" /> {profile.plan ?? "—"}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">@{username}</p>
            <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1 mt-3 text-xs text-muted-foreground">
              <p className="flex items-center gap-1.5"><Mail className="h-3 w-3" /> {profile.email ?? "Informação ainda não cadastrada."}</p>
              <p className="flex items-center gap-1.5"><Phone className="h-3 w-3" /> {profile.phone ? `+${profile.phone}` : "Informação ainda não cadastrada."}</p>
              <p className="flex items-center gap-1.5"><Calendar className="h-3 w-3" /> Cadastro: <b className="text-foreground">{memberSince}</b> ({accountAgeDays}d)</p>
              <p className="flex items-center gap-1.5"><Clock className="h-3 w-3" /> Último acesso: <b className="text-foreground">{lastAccess}</b></p>
            </div>
            <p className="text-sm mt-3 text-primary/90 leading-relaxed max-w-xl">{motivational}</p>
          </div>
          <div className="flex flex-row md:flex-col gap-2 self-start md:self-center">
            <Link
              to="/app/lancar"
              className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-gradient-brand text-primary-foreground px-4 py-2 text-sm font-medium glow-neon hover:opacity-90"
            >
              <Plus className="h-3.5 w-3.5" /> Lançar rápido
            </Link>
            <button
              onClick={() => setEditing(true)}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-border bg-background/40 px-4 py-2 text-sm hover:bg-background/60"
            >
              <UserIcon className="h-3.5 w-3.5" /> Editar perfil
            </button>
            <button
              onClick={() => setPwOpen(true)}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-border bg-background/40 px-4 py-2 text-sm hover:bg-background/60"
            >
              <KeyRound className="h-3.5 w-3.5" /> Alterar senha
            </button>
          </div>
        </div>
      </motion.header>

      {/* ===== PERÍODO ===== */}
      <section className="rounded-3xl border border-border bg-card/60 backdrop-blur-xl p-4">
        <div className="flex items-center gap-2 mb-3 text-xs uppercase tracking-[0.2em] text-primary">
          <CalendarRange className="h-3.5 w-3.5" /> Período
        </div>
        <div className="flex flex-wrap gap-2">
          {RANGE_OPTIONS.map((opt) => {
            const active = range === opt.key;
            return (
              <button
                key={opt.key}
                onClick={() => setRange(opt.key)}
                className={[
                  "px-3 py-1.5 rounded-xl text-xs border transition-smooth",
                  active
                    ? "border-primary/50 bg-primary/15 text-primary"
                    : "border-border bg-background/40 text-muted-foreground hover:text-foreground hover:border-primary/30",
                ].join(" ")}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
        {range === "custom" && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <label className="text-muted-foreground">De</label>
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="px-2 py-1.5 rounded-xl border border-border bg-background/40 text-foreground"
            />
            <label className="text-muted-foreground">até</label>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="px-2 py-1.5 rounded-xl border border-border bg-background/40 text-foreground"
            />
          </div>
        )}
      </section>

      <BalanceBreakdownDialog
        open={explainOpen}
        onClose={() => setExplainOpen(false)}
        from={range === "custom" && customStart ? customStart : undefined}
        to={range === "custom" && customEnd ? customEnd : undefined}
        periodLabel={homeStats.rangeLabel}
      />

      {/* ===== KPIs DO PERÍODO ===== */}
      <div className="grid md:grid-cols-3 gap-4">
        <ClickableKpi open={openCard === "balance"} onToggle={() => toggle("balance")} onClose={close} panel={<BalancePanel d={live} onClose={close} onExplain={() => setExplainOpen(true)} />}>
          <BigCard label="Saldo" value={formatBRL(homeStats.balance)} accent="bg-gradient-brand-soft border-primary/30" icon={Sparkles} />
        </ClickableKpi>
        <ClickableKpi open={openCard === "income"} onToggle={() => toggle("income")} onClose={close} panel={<TxListPanel title="💰 Últimas receitas" kind="income" items={(live as any)?.recentIncome ?? []} onClose={close} />}>
          <BigCard label="Receitas" value={formatBRL(homeStats.income)} accent="bg-emerald-500/10 border-emerald-500/30" icon={ArrowUpRight} subtle="text-emerald-300" />
        </ClickableKpi>
        <ClickableKpi open={openCard === "expense"} onToggle={() => toggle("expense")} onClose={close} panel={<TxListPanel title="💸 Últimas despesas" kind="expense" items={(live as any)?.recentExpense ?? []} onClose={close} />}>
          <BigCard label="Despesas" value={formatBRL(homeStats.expense)} accent="bg-rose-500/10 border-rose-500/30" icon={ArrowDownRight} subtle="text-rose-300" />
        </ClickableKpi>
      </div>

      {/* ===== ÚLTIMOS LANÇAMENTOS + PRÓXIMOS LEMBRETES ===== */}
      <div className="grid lg:grid-cols-[1.4fr_1fr] gap-4">
        <section className="rounded-3xl border border-border bg-card/60 backdrop-blur-xl p-5 hover:border-primary/40 transition-smooth">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl">Últimos lançamentos</h2>
            {latestRows.length > 0 && (
              <Link to="/app/transacoes" search={{ kind: undefined, view: "lista" }} className="text-xs text-primary hover:underline">Ver todos</Link>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">Mesma fonte de dados da aba Transações.</p>
          {latestRows.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-dashed border-border bg-background/30 p-6 text-center">
              <p className="text-sm text-muted-foreground">Nenhum lançamento registrado ainda.</p>
              <p className="text-xs text-muted-foreground mt-1">Envie uma mensagem pelo WhatsApp para começar.</p>
            </div>
          ) : (
            <div className="mt-4 divide-y divide-border">
              {latestRows.slice(0, 5).map((t: any) => {
                const g = groupOf(groupKeyForCategory(t.category));
                const Icon = g.icon;
                const occurredAt = String(t.occurred_at ?? "");
                const isIncome = t.kind === "income";
                return (
                  <div key={t.id} className="flex items-center gap-3 py-3 text-sm">
                    <div className={`h-9 w-9 grid place-items-center rounded-xl bg-background/50 ${g.color}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="truncate font-medium">{t.description || t.category || "Lançamento"}</p>
                      <p className="text-xs text-muted-foreground">
                        {t.category}{occurredAt ? ` · ${formatDateSP(occurredAt)}` : ""}
                      </p>
                    </div>
                    <p className={`font-medium ${isIncome ? "text-emerald-400" : "text-rose-400"}`}>
                      {isIncome ? "+" : "-"} {formatBRL(Number(t.amount ?? 0))}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {homeStats.appointments.length > 0 ? (
          <section className="rounded-3xl border border-border bg-card/60 backdrop-blur-xl p-5 hover:border-primary/40 transition-smooth">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xl">Próximos lembretes</h2>
              <Link to="/app/compromissos" className="text-xs text-primary hover:underline">Ver todos</Link>
            </div>
            <div className="mt-4 space-y-3">
              {homeStats.appointments.slice(0, 4).map((a: any) => {
                const when = new Date(a.scheduled_at);
                return (
                  <div key={a.id} className="flex items-center gap-3 rounded-2xl border border-border bg-background/40 p-3 hover:border-primary/30 transition-smooth">
                    <div className="h-10 w-10 grid place-items-center rounded-xl bg-primary/10 text-primary">
                      <MessageCircle className="h-4 w-4" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm truncate">{a.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {when.toLocaleDateString("pt-BR")} · {when.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ) : (
          <UpcomingBillsCard />
        )}
      </div>

      {/* ===== ATALHOS POR CATEGORIA ===== */}
      <section className="rounded-3xl border border-border bg-card/60 backdrop-blur-xl p-5">
        <h2 className="font-display text-xl">Atalhos por categoria</h2>
        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {categoryGroups.slice(0, 12).map((g) => {
            const Icon = g.icon;
            return (
              <Link key={g.key} to="/app/transacoes" search={{ kind: undefined, view: "categorias" }} className="rounded-2xl border border-border bg-background/40 p-4 hover:border-primary/40 hover:scale-[1.02] transition-smooth group">
                <div className={`${g.color}`}><Icon className="h-5 w-5" /></div>
                <p className="text-sm mt-3 group-hover:text-primary transition-smooth">{g.name}</p>
                <p className="text-[11px] text-muted-foreground">{g.categories.length} categorias</p>
              </Link>
            );
          })}
        </div>
      </section>

      {/* ===== SUBSCRIPTION ===== */}
      <SubscriptionCard />
      <RenewalHistoryCard />

      {/* ===== ACCOUNT STATISTICS ===== */}
      <Card title="Estatísticas da conta" icon={BarChart3} delay={0.3}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatTile icon={TrendingUp} label="Receitas registradas" value={brl(finance?.totalIncome ?? 0)} tone="success" />
          <StatTile icon={TrendingDown} label="Despesas registradas" value={brl(finance?.totalExpense ?? 0)} tone="danger" />
          <StatTile icon={Hash} label="Total de lançamentos" value={String(counts?.transactions ?? 0)} />
          <StatTile icon={Layers} label="Categorias utilizadas" value={String(counts?.categoriesUsed ?? 0)} />
          <StatTile icon={Target} label="Metas criadas" value={String(counts?.goals ?? 0)} />
          <StatTile icon={ListChecks} label="Lembretes criados" value={String(counts?.remindersTotal ?? 0)} sub={`${counts?.appointments ?? 0} compromissos · ${counts?.bills ?? 0} contas`} />
          <StatTile icon={MessageCircle} label="Mensagens WhatsApp" value={String(counts?.whatsappMessages ?? 0)} />
          <StatTile icon={Clock} label="Tempo de uso" value={`${accountAgeDays} dias`} sub={`Desde ${memberSince}`} />
        </div>
      </Card>

      {/* ===== SECURITY ===== */}
      <Card title="Segurança" icon={ShieldCheck} delay={0.32}>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <StatTile icon={Clock} label="Último login" value={fmtDateTime(security?.lastSignInAt)} />
          <StatTile icon={Globe} label="Último IP" value={security?.lastIp ?? "Não disponível"} />
          <StatTile icon={ShieldCheck} label="Sessões ativas" value={`${security?.sessions ?? 1}`} sub={security?.provider ? `Provedor: ${security.provider}` : undefined} />
        </div>
        <div className="grid sm:grid-cols-3 gap-3 mt-4">
          <button onClick={() => setPwOpen(true)}
            className="rounded-xl border border-border bg-background/40 px-3 py-2.5 text-sm hover:bg-background/60 inline-flex items-center justify-center gap-2">
            <KeyRound className="h-3.5 w-3.5" /> Alterar senha
          </button>
          <button disabled={signOutBusy} onClick={onSignOutAll}
            className="rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-200 px-3 py-2.5 text-sm hover:bg-amber-500/20 inline-flex items-center justify-center gap-2 disabled:opacity-60">
            <LogOut className="h-3.5 w-3.5" /> {signOutBusy ? "Encerrando…" : "Encerrar outras sessões"}
          </button>
          <button
            type="button" disabled
            title="2FA em breve"
            className="rounded-xl border border-border bg-background/40 px-3 py-2.5 text-sm inline-flex items-center justify-center gap-2 opacity-60 cursor-not-allowed"
          >
            <ShieldCheck className="h-3.5 w-3.5" /> Ativar 2FA (em breve)
          </button>
        </div>
      </Card>

      {/* ===== ACCOUNT SETTINGS (edit + notifications) ===== */}
      <Card title="Configurações da conta" icon={UserIcon} delay={0.34}
        action={
          !editing ? (
            <button onClick={() => setEditing(true)} className="text-xs rounded-lg border border-border px-3 py-1.5 hover:bg-background/60">
              Editar
            </button>
          ) : null
        }
      >
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Nome completo">
            <input disabled={!editing} value={name} onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full bg-input rounded-xl px-3 py-2.5 text-sm disabled:opacity-70" />
          </Field>
          <Field label="E-mail">
            <input disabled={!editing} value={email} onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full bg-input rounded-xl px-3 py-2.5 text-sm disabled:opacity-70" />
          </Field>
          <Field label="Celular (com DDI)">
            <input disabled={!editing} value={phone} onChange={(e) => setPhone(e.target.value)}
              placeholder="5511999990000"
              className="mt-1 w-full bg-input rounded-xl px-3 py-2.5 text-sm disabled:opacity-70" />
          </Field>
          <Field label="Gênero">
            <select disabled={!editing} value={gender} onChange={(e) => setGender(e.target.value)}
              className="mt-1 w-full bg-input rounded-xl px-3 py-2.5 text-sm disabled:opacity-70">
              <option value="">Não informado</option>
              <option value="male">Masculino</option>
              <option value="female">Feminino</option>
              <option value="other">Outro</option>
            </select>
          </Field>
          <Field label="Usuário">
            <input disabled value={`@${username}`}
              className="mt-1 w-full bg-input rounded-xl px-3 py-2.5 text-sm opacity-70" />
          </Field>
        </div>

        {editing && (
          <div className="flex gap-2 flex-wrap mt-4">
            <button onClick={onSave} className="rounded-xl bg-gradient-brand text-primary-foreground px-4 py-2 text-sm font-medium glow-neon">
              Salvar alterações
            </button>
            <button onClick={() => { setEditing(false); if (profile) { setName(profile.name); setEmail(profile.email ?? ""); setPhone(profile.phone ?? ""); } }}
              className="rounded-xl border border-border px-4 py-2 text-sm hover:bg-background/40">
              Cancelar
            </button>
          </div>
        )}
        {saved && <p className="text-xs text-emerald-300 mt-2">{saved}</p>}

        {pwOpen && (
          <div className="rounded-2xl border border-border bg-background/40 p-4 space-y-3 mt-4">
            <p className="text-sm font-medium">Trocar senha</p>
            <input type="password" placeholder="Nova senha" value={newPw} onChange={(e) => setNewPw(e.target.value)}
              className="w-full bg-input rounded-xl px-3 py-2.5 text-sm" />
            <input type="password" placeholder="Confirmar nova senha" value={newPw2} onChange={(e) => setNewPw2(e.target.value)}
              className="w-full bg-input rounded-xl px-3 py-2.5 text-sm" />
            {pwMsg && <p className={`text-xs ${pwMsg.includes("✅") ? "text-emerald-300" : "text-destructive"}`}>{pwMsg}</p>}
            <div className="flex gap-2">
              <button disabled={pwBusy} onClick={onChangePassword}
                className="rounded-xl bg-gradient-brand text-primary-foreground px-4 py-2 text-sm font-medium glow-neon disabled:opacity-60">
                {pwBusy ? "Salvando…" : "Confirmar"}
              </button>
              <button onClick={() => { setPwOpen(false); setNewPw(""); setNewPw2(""); setPwMsg(null); }}
                className="rounded-xl border border-border px-4 py-2 text-sm hover:bg-background/40">
                Cancelar
              </button>
            </div>
          </div>
        )}

        <div className="border-t border-border pt-4 mt-4 space-y-3">
          <p className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-2"><Bell className="h-3 w-3" /> Notificações</p>
          <ToggleRow
            label="Notificações pelo WhatsApp"
            description="Lembretes, alertas de orçamento e respostas da IA."
            checked={notifyWa}
            onChange={(v) => onToggleNotify("wa", v)}
          />
          <ToggleRow
            label="Notificações por e-mail"
            description="Resumo mensal, recibos e avisos da conta."
            checked={notifyEmail}
            onChange={(v) => onToggleNotify("email", v)}
          />
          <ToggleRow
            label="Resumo semanal"
            description="Enviado aos domingos às 21:00, pelo WhatsApp."
            checked={notifyWeekly}
            onChange={(v) => onToggleNotify("weekly", v)}
          />
        </div>
      </Card>

      {/* ===== MODO CASAL ===== */}
      <Card title="Modo Casal" icon={Heart} delay={0.35}>
        <p className="text-sm text-muted-foreground">
          Vincule sua conta com a do seu parceiro(a) — depois do aceite, as receitas e despesas de vocês dois aparecem automaticamente num painel só do casal.
        </p>
        <Link to="/app/casal"
          className="mt-3 inline-flex items-center gap-2 rounded-xl bg-gradient-brand text-primary-foreground px-4 py-2.5 text-sm glow-neon hover:scale-[1.02] transition-smooth">
          <Heart className="h-4 w-4" /> Abrir Modo Casal
        </Link>
      </Card>

      {/* ===== DATA EXPORT ===== */}
      <Card title="Meus dados" icon={Download} delay={0.36}>
        <div className="grid sm:grid-cols-2 gap-3">
          <button disabled={exportBusy} onClick={onExport}
            className="rounded-xl border border-border bg-background/40 px-3 py-2.5 text-sm hover:bg-background/60 inline-flex items-center justify-center gap-2 disabled:opacity-60">
            <Download className="h-3.5 w-3.5" /> {exportBusy ? "Gerando…" : "Exportar meus dados (JSON)"}
          </button>
        </div>
        <p className="text-[11px] text-muted-foreground mt-3">
          Para zerar seu histórico financeiro, acesse a aba <Link to="/app/transacoes" search={{ kind: undefined, view: "lista" }} className="text-primary hover:underline">Transações</Link>.
        </p>
      </Card>

      <section className="rounded-3xl border border-border bg-card/60 backdrop-blur-xl p-5">
        <button onClick={async () => { await logout(); navigate({ to: "/" }); }}
          className="inline-flex items-center gap-2 rounded-xl border border-border bg-background/40 px-4 py-2 text-sm hover:border-destructive/40 hover:text-destructive transition-smooth">
          <LogOut className="h-3.5 w-3.5" /> Sair desta conta
        </button>
      </section>
    </div>
  );
}

// ============================================================
// Subscription cards
// ============================================================
function SubscriptionCard() {
  const qc = useQueryClient();
  const fetchSub = useServerFn(getMySubscription);
  const runCancel = useServerFn(cancelMySubscription);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const { data: sub, isLoading } = useQuery<any>({
    queryKey: ["my-subscription"],
    queryFn: () => fetchSub() as any,
  });
  const mCancel = useMutation({
    mutationFn: () => runCancel() as any,
    onSuccess: () => {
      setConfirmingCancel(false);
      qc.invalidateQueries({ queryKey: ["my-subscription"] });
      qc.invalidateQueries({ queryKey: ["my-sub-history"] });
    },
  });

  if (isLoading) return <section className="rounded-3xl border border-border bg-card/60 backdrop-blur-xl p-5 animate-pulse h-32" />;
  if (!sub) return (
    <Card title="Assinatura e plano" icon={Crown} delay={0.28}>
      <p className="text-sm text-muted-foreground">Nenhuma assinatura ativa. <Link to="/app/checkout" search={{ plan: "monthly" }} className="text-primary hover:underline">Assine um plano</Link> para aproveitar todos os recursos.</p>
    </Card>
  );

  const now = Date.now();
  const endsAt = sub.ends_at ? new Date(sub.ends_at).getTime() : null;
  const daysLeft = endsAt ? Math.max(0, Math.ceil((endsAt - now) / 86400_000)) : null;
  const isLifetime = sub.period === "lifetime";
  const isExpired = sub.status === "expired" || (endsAt !== null && endsAt < now);
  const isTrial = sub.status === "trial";
  const isCancelled = sub.status === "cancelled";

  const badge = isCancelled
    ? { label: "Cancelado", cls: "bg-muted text-muted-foreground", Icon: XCircle }
    : isExpired
    ? { label: "Expirado", cls: "bg-destructive/15 text-destructive border border-destructive/30", Icon: XCircle }
    : isTrial
    ? { label: "Trial", cls: "bg-amber-500/15 text-amber-300 border border-amber-500/30", Icon: Clock }
    : { label: "Ativo", cls: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30", Icon: CheckCircle2 };

  const periodLabel: Record<string, string> = {
    trial: "Trial", monthly: "Mensal", quarterly: "Trimestral",
    semiannual: "Semestral", annual: "Anual", lifetime: "Vitalício",
  };

  return (
    <Card title="Assinatura e plano" icon={Crown} delay={0.28}
      action={
        <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${badge.cls}`}>
          <badge.Icon className="h-3 w-3" /> {badge.label}
        </span>
      }
    >
      <div className="flex items-center gap-3 mb-4">
        <div className="h-11 w-11 grid place-items-center rounded-2xl bg-gradient-brand text-primary-foreground glow-neon">
          <Crown className="h-5 w-5" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Plano atual</p>
          <p className="font-display text-xl">{sub.plan_name}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
        <Tile label="Período" value={periodLabel[sub.period] ?? sub.period} />
        <Tile label="Valor" value={(sub.price_cents ?? 0) > 0 ? brl((sub.price_cents ?? 0) / 100) : "Grátis"} />
        <Tile label={isLifetime ? "Validade" : "Restam"} value={isLifetime ? "∞" : daysLeft !== null ? `${daysLeft} dias` : "—"} tone={daysLeft !== null && daysLeft <= 3 && !isLifetime ? "danger" : undefined} />
        <Tile label="Renovação" value={endsAt && !isLifetime ? new Date(endsAt).toLocaleDateString("pt-BR") : "—"} />
      </div>

      {(() => {
        const checkoutPlan = getPlan(sub.plan_slug)?.id ?? "monthly";
        return (
          <div className="grid sm:grid-cols-3 gap-3 mt-4">
            <Link to="/app/checkout" search={{ plan: checkoutPlan }} className="rounded-xl border border-primary/30 bg-primary/10 text-primary px-3 py-2.5 text-sm inline-flex items-center justify-center gap-2 hover:bg-primary/20">
              <ArrowUpRight className="h-3.5 w-3.5" /> Fazer upgrade
            </Link>
            <Link to="/app/checkout" search={{ plan: checkoutPlan }} className="rounded-xl border border-border bg-background/40 px-3 py-2.5 text-sm hover:bg-background/60 inline-flex items-center justify-center gap-2">
              <RefreshCw className="h-3.5 w-3.5" /> Renovar plano
            </Link>
            <Link to="/app/sistema" search={{ view: "suporte" }} className="rounded-xl border border-border bg-background/40 px-3 py-2.5 text-sm hover:bg-background/60 inline-flex items-center justify-center gap-2">
              <ListChecks className="h-3.5 w-3.5" /> Histórico de pagamentos
            </Link>
          </div>
        );
      })()}

      {!isCancelled && !isExpired && sub.mp_preapproval_id ? (
        <div className="mt-3 flex items-center justify-end">
          {confirmingCancel ? (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Cancelar a renovação automática?</span>
              <button onClick={() => mCancel.mutate()} disabled={mCancel.isPending}
                className="rounded-lg border border-destructive/30 text-destructive px-2.5 py-1.5 hover:bg-destructive/10 disabled:opacity-50">
                {mCancel.isPending ? "Cancelando..." : "Sim, cancelar"}
              </button>
              <button onClick={() => setConfirmingCancel(false)} className="rounded-lg border border-border px-2.5 py-1.5 hover:bg-background/40">
                Voltar
              </button>
            </div>
          ) : (
            <button onClick={() => setConfirmingCancel(true)}
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive">
              <Ban className="h-3.5 w-3.5" /> Cancelar assinatura
            </button>
          )}
        </div>
      ) : null}
    </Card>
  );
}

function RenewalHistoryCard() {
  const fetchHist = useServerFn(getMySubscriptionHistory);
  const { data: rows = [], isLoading } = useQuery<any[]>({
    queryKey: ["my-sub-history"],
    queryFn: () => fetchHist() as any,
  });
  if (isLoading) return <section className="rounded-3xl border border-border bg-card/60 backdrop-blur-xl p-5 animate-pulse h-24" />;
  if (rows.length === 0) return null;

  const periodLabel: Record<string, string> = {
    trial: "Trial", monthly: "Mensal", quarterly: "Trimestral",
    semiannual: "Semestral", annual: "Anual", lifetime: "Vitalício",
  };

  return (
    <Card title="Histórico de renovações" icon={Clock} delay={0.29}>
      <ol className="relative border-l border-border ml-2 space-y-4">
        {rows.map((r) => {
          const statusCls =
            r.status === "active" ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" :
            r.status === "trial" ? "bg-amber-500/15 text-amber-300 border-amber-500/30" :
            r.status === "expired" ? "bg-destructive/15 text-destructive border-destructive/30" :
            "bg-muted text-muted-foreground border-border";
          return (
            <li key={r.id} className="ml-4">
              <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full bg-gradient-brand glow-neon" />
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="text-sm font-medium">{r.plan_name} <span className="text-xs text-muted-foreground">· {periodLabel[r.period] ?? r.period}</span></p>
                <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border ${statusCls}`}>{r.status}</span>
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {new Date(r.started_at).toLocaleDateString("pt-BR")}
                {r.ends_at ? ` → ${new Date(r.ends_at).toLocaleDateString("pt-BR")}` : ""}
                {r.price_cents ? ` · ${(r.price_cents/100).toLocaleString("pt-BR",{style:"currency",currency:"BRL"})}` : ""}
              </p>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

// ============================================================
// Small components
// ============================================================
function Card({
  title, icon: Icon, children, delay = 0, action,
}: { title: string; icon: any; children: React.ReactNode; delay?: number; action?: React.ReactNode }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}
      className="rounded-3xl border border-border bg-card/60 backdrop-blur-xl shadow-card p-5"
    >
      <header className="flex items-center justify-between gap-3 mb-4">
        <h3 className="font-display text-lg flex items-center gap-2">
          <Icon className="h-4 w-4 text-primary" /> {title}
        </h3>
        {action}
      </header>
      {children}
    </motion.section>
  );
}

function BigCard({ label, value, accent, icon: Icon, subtle }: { label: string; value: string; accent: string; icon: typeof Sparkles; subtle?: string }) {
  return (
    <motion.div
      whileHover={{ y: -3 }}
      className={`relative isolate w-full overflow-hidden rounded-3xl border p-5 max-[380px]:p-4 backdrop-blur-xl transition-smooth hover:shadow-lg ${accent}`}
    >
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="truncate">{label}</span>
        <Icon className={`h-4 w-4 shrink-0 ${subtle ?? "text-primary"}`} />
      </div>
      <p
        key={value}
        className="font-display mt-2 tabular-nums whitespace-nowrap truncate"
        style={{ willChange: "auto", backfaceVisibility: "hidden", fontSize: "clamp(1.5rem, 7vw, 1.875rem)" }}
      >
        {value}
      </p>
    </motion.div>
  );
}

function StatTile({
  icon: Icon, label, value, sub, tone, badge, badgeTone, compact,
}: {
  icon: any; label: string; value: string; sub?: string;
  tone?: "success" | "danger" | "muted";
  badge?: string; badgeTone?: "success" | "muted";
  compact?: boolean;
}) {
  const valueTone =
    tone === "success" ? "text-emerald-300" :
    tone === "danger" ? "text-destructive" :
    tone === "muted" ? "text-muted-foreground" : "text-foreground";
  const badgeCls =
    badgeTone === "success" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
      : "border-border bg-background/40 text-muted-foreground";
  return (
    <div className={`rounded-2xl border border-border bg-background/30 p-3 ${compact ? "" : ""}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
          <Icon className="h-3 w-3 text-primary" /> {label}
        </span>
        {badge && <span className={`text-[10px] px-2 py-0.5 rounded-full border ${badgeCls}`}>{badge}</span>}
      </div>
      <p className={`mt-1 font-display ${compact ? "text-base" : "text-lg"} truncate ${valueTone}`}>{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{sub}</p>}
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: "danger" }) {
  return (
    <div className="rounded-xl border border-border bg-background/30 py-2.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-sm font-medium mt-0.5 ${tone === "danger" ? "text-destructive" : ""}`}>{value}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

function ToggleRow({ label, description, checked, onChange }: {
  label: string; description?: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start justify-between gap-3 rounded-xl border border-border bg-background/40 p-3 cursor-pointer">
      <div className="min-w-0">
        <p className="text-sm">{label}</p>
        {description && <p className="text-[11px] text-muted-foreground mt-0.5">{description}</p>}
      </div>
      <button type="button" onClick={() => onChange(!checked)}
        className={`relative w-10 h-6 rounded-full transition-smooth shrink-0 ${checked ? "bg-gradient-brand glow-neon" : "bg-muted"}`}>
        <span className={`absolute top-0.5 left-0.5 h-5 w-5 bg-background rounded-full transition-transform ${checked ? "translate-x-4" : ""}`} />
      </button>
    </label>
  );
}

function Skeleton() {
  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="h-44 rounded-3xl bg-card/40 animate-pulse" />
      <div className="h-24 rounded-3xl bg-card/40 animate-pulse" />
      <div className="grid md:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-28 rounded-3xl bg-card/40 animate-pulse" />)}
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 rounded-2xl bg-card/40 animate-pulse" />)}
      </div>
      <div className="h-48 rounded-3xl bg-card/40 animate-pulse" />
      <div className="h-48 rounded-3xl bg-card/40 animate-pulse" />
      <div className="h-64 rounded-3xl bg-card/40 animate-pulse" />
    </div>
  );
}
