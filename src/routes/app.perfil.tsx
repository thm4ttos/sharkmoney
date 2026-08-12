import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { logout } from "@/lib/user-session";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  User as UserIcon, Trash2, AlertTriangle, Crown, Clock, CheckCircle2, XCircle,
  Mail, Phone, Calendar, KeyRound, LogOut, Download, Bell, MessageCircle,
  Wallet, TrendingUp, TrendingDown, PiggyBank, ShieldCheck, Bot, BarChart3,
  Image as ImageIcon, Mic, Layers, Target, ListChecks, Hash, Activity,
  Sparkles, Globe, Cpu, RefreshCw, Camera, ArrowUpRight,
} from "lucide-react";
import { resetUserHistory } from "@/lib/user-extras.functions";
import { getMySubscription, getMySubscriptionHistory } from "@/lib/subscriptions.functions";
import {
  getProfileOverview, updateMyProfile, signOutAllSessions, exportMyData,
} from "@/lib/profile.functions";
import { WhatsappConnectionCard } from "@/components/brinzap/WhatsappConnectionCard";
import { getDashboardStats } from "@/lib/dashboard.functions";
import { ClickableKpi, TxListPanel, BalancePanel, useKpiPopover } from "@/components/brinzap/dashboard/KpiPopover";
import { AvatarEditor } from "@/components/brinzap/AvatarEditor";

export const Route = createFileRoute("/app/perfil")({
  head: () => ({ meta: [{ title: "Meu Perfil · Abio" }] }),
  component: Page,
});

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

// ============================================================
// Page
// ============================================================
function Page() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const fetchOverview = useServerFn(getProfileOverview);
  const updateFn = useServerFn(updateMyProfile);
  const signOutAllFn = useServerFn(signOutAllSessions);
  const exportFn = useServerFn(exportMyData);
  const runReset = useServerFn(resetUserHistory);

  const { data: overview, isLoading } = useQuery<any>({
    queryKey: ["profile-overview"],
    queryFn: () => fetchOverview() as any,
    refetchInterval: 60_000,
  });

  const runStats = useServerFn(getDashboardStats);
  const statsQ = useQuery({
    queryKey: ["dashboard-stats-v2"],
    queryFn: () => runStats() as any,
    refetchInterval: 60_000,
  });
  const kpiData: any = statsQ.data;
  const { openCard, toggle, close } = useKpiPopover();

  const profile = overview?.profile;
  const finance = overview?.finance;
  const counts = overview?.counts;
  const ai = overview?.ai;
  const security = overview?.security;

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

  // ===== Confirm reset =====
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [resetting, setResetting] = useState(false);
  const [resetResult, setResetResult] = useState<Record<string, number> | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);

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

  const doReset = async () => {
    setResetting(true); setResetError(null);
    try {
      const r: any = await runReset({ data: { confirm: confirmText } });
      setResetResult(r.removed);
      setConfirmOpen(false); setConfirmText("");
      qc.invalidateQueries();
      qc.refetchQueries({ type: "active" });
    } catch (e: any) {
      setResetError(e?.message ?? "Falha ao zerar histórico.");
    } finally {
      setResetting(false);
    }
  };

  if (isLoading || !profile) return <Skeleton />;

  const statusBadge =
    profile.status === "blocked"
      ? { label: "Bloqueado", cls: "border-destructive/40 bg-destructive/10 text-destructive", Icon: XCircle }
      : { label: "Ativa", cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300", Icon: CheckCircle2 };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
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
          </div>
          <div className="flex flex-row md:flex-col gap-2 self-start md:self-center">
            <button
              onClick={() => setEditing(true)}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-gradient-brand text-primary-foreground px-4 py-2 text-sm font-medium glow-neon hover:opacity-90"
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

      {/* ===== FINANCIAL KPIs ===== */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <ClickableKpi open={openCard === "balance"} onToggle={() => toggle("balance")} onClose={close} panel={<BalancePanel d={kpiData} onClose={close} />}>
          <KPI delay={0.05} icon={Wallet} label="Saldo atual" value={brl(finance?.balance ?? 0)} tone={(finance?.balance ?? 0) < 0 ? "danger" : "primary"} />
        </ClickableKpi>
        <ClickableKpi open={openCard === "income"} onToggle={() => toggle("income")} onClose={close} panel={<TxListPanel title="💰 Últimas receitas" kind="income" items={kpiData?.recentIncome ?? []} onClose={close} />}>
          <KPI delay={0.1} icon={TrendingUp} label="Receitas totais" value={brl(finance?.incomeMonth ?? 0)} tone="success" />
        </ClickableKpi>
        <ClickableKpi open={openCard === "expense"} onToggle={() => toggle("expense")} onClose={close} panel={<TxListPanel title="💸 Últimas despesas" kind="expense" items={kpiData?.recentExpense ?? []} onClose={close} />}>
          <KPI delay={0.15} icon={TrendingDown} label="Despesas totais" value={brl(finance?.expenseMonth ?? 0)} tone="danger" />
        </ClickableKpi>
        <KPI delay={0.2} icon={PiggyBank} label="Economia total" value={brl(finance?.savedMonth ?? 0)} tone={(finance?.savedMonth ?? 0) < 0 ? "danger" : "primary"} sub={`${counts?.transactions ?? 0} lançamentos no total`} />
      </section>

      {/* WhatsApp e Configurações da IA removidos da visão do usuário — disponíveis apenas no admin */}

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

      {/* ===== DATA EXPORT ===== */}
      <Card title="Meus dados" icon={Download} delay={0.36}>
        <div className="grid sm:grid-cols-2 gap-3">
          <button disabled={exportBusy} onClick={onExport}
            className="rounded-xl border border-border bg-background/40 px-3 py-2.5 text-sm hover:bg-background/60 inline-flex items-center justify-center gap-2 disabled:opacity-60">
            <Download className="h-3.5 w-3.5" /> {exportBusy ? "Gerando…" : "Exportar meus dados (JSON)"}
          </button>
        </div>
        <p className="text-[11px] text-muted-foreground mt-3">
          Para zerar seu histórico financeiro, acesse a aba <Link to="/app/transacoes" className="text-primary hover:underline">Transações</Link>.
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
// Subscription cards (kept)
// ============================================================
function SubscriptionCard() {
  const fetchSub = useServerFn(getMySubscription);
  const { data: sub, isLoading } = useQuery<any>({
    queryKey: ["my-subscription"],
    queryFn: () => fetchSub() as any,
  });

  if (isLoading) return <section className="rounded-3xl border border-border bg-card/60 backdrop-blur-xl p-5 animate-pulse h-32" />;
  if (!sub) return (
    <Card title="Assinatura e plano" icon={Crown} delay={0.28}>
      <p className="text-sm text-muted-foreground">Nenhuma assinatura ativa. <Link to="/app/suporte" className="text-primary hover:underline">Configure sua conta</Link> para aproveitar todos os recursos.</p>
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

      <div className="grid sm:grid-cols-3 gap-3 mt-4">
        <Link to="/app/suporte" className="rounded-xl border border-primary/30 bg-primary/10 text-primary px-3 py-2.5 text-sm inline-flex items-center justify-center gap-2 hover:bg-primary/20">
          <ArrowUpRight className="h-3.5 w-3.5" /> Fazer upgrade
        </Link>
        <Link to="/app/suporte" className="rounded-xl border border-border bg-background/40 px-3 py-2.5 text-sm hover:bg-background/60 inline-flex items-center justify-center gap-2">
          <RefreshCw className="h-3.5 w-3.5" /> Renovar plano
        </Link>
        <Link to="/app/suporte" className="rounded-xl border border-border bg-background/40 px-3 py-2.5 text-sm hover:bg-background/60 inline-flex items-center justify-center gap-2">
          <ListChecks className="h-3.5 w-3.5" /> Histórico de pagamentos
        </Link>
      </div>
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

function KPI({ icon: Icon, label, value, tone = "primary", sub, delay = 0 }: {
  icon: any; label: string; value: string; tone?: "primary" | "success" | "danger"; sub?: string; delay?: number;
}) {
  const toneCls =
    tone === "success" ? "text-emerald-300 border-emerald-500/30 bg-emerald-500/5" :
    tone === "danger" ? "text-destructive border-destructive/30 bg-destructive/5" :
    "text-primary border-border bg-card/60";
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.4 }}
      className={`relative isolate overflow-hidden rounded-2xl border p-3 backdrop-blur-xl ${toneCls}`}
    >
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <p
        key={value}
        className="text-lg font-display mt-1 truncate tabular-nums whitespace-nowrap"
        style={{ willChange: "auto", backfaceVisibility: "hidden" }}
      >
        {value}
      </p>
      {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
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
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="h-36 rounded-3xl bg-card/40 animate-pulse" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 rounded-2xl bg-card/40 animate-pulse" />)}
      </div>
      <div className="h-48 rounded-3xl bg-card/40 animate-pulse" />
      <div className="h-48 rounded-3xl bg-card/40 animate-pulse" />
      <div className="h-64 rounded-3xl bg-card/40 animate-pulse" />
    </div>
  );
}
