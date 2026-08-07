import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Handshake, RefreshCw, Loader2, Users, MousePointerClick, Wallet, Search, Plus, Save, X, Settings2, Send, CheckCircle2, XCircle, Sparkles, Target, Download, Trash2, BarChart3, TrendingUp, MousePointer } from "lucide-react";
import {
  adminListAffiliates,
  adminPromoteToAffiliate,
  adminUpdateAffiliate,
  adminAffiliateStats,
  getAffiliateSettings,
  adminUpdateAffiliateSettings,
  adminListPayouts,
  adminUpdatePayoutStatus,
  adminMatureAffiliateCommissions,
  listAffiliateGoals,
  adminUpsertGoal,
  adminDeleteGoal,
  adminExportAffiliatesCsv,
} from "@/lib/affiliate.functions";
import { adminListUsers } from "@/lib/brinzap.functions";

export const Route = createFileRoute("/admin/afiliados")({
  head: () => ({ meta: [{ title: "Afiliados · Shark Money Admin" }, { name: "robots", content: "noindex" }] }),
  component: Page,
});

const brl = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const AFFILIATE_SITE = "https://abio.fun";

function AffiliateLinkCell({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const link = `${AFFILIATE_SITE}/?ref=${code}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt("Copie o link de afiliado:", link);
    }
  };
  return (
    <div className="flex items-center gap-2 max-w-[320px]">
      <a
        href={link}
        target="_blank"
        rel="noreferrer"
        className="font-mono text-xs text-primary hover:underline truncate"
        title={link}
      >
        {link}
      </a>
      <button
        onClick={copy}
        className="text-[10px] rounded-md border border-border px-2 py-1 hover:border-primary/40 whitespace-nowrap"
      >
        {copied ? "Copiado!" : "Copiar"}
      </button>
    </div>
  );
}

function AffiliateStatsPopover({ a, children }: { a: any; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const updatePos = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (!r) return;
      const width = 256;
      const left = Math.min(Math.max(8, r.right - width), window.innerWidth - width - 8);
      setCoords({ top: r.bottom + 8, left });
    };
    updatePos();
    const onDoc = (e: MouseEvent) => {
      if (panelRef.current?.contains(e.target as Node)) return;
      if (btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", updatePos, true);
    window.addEventListener("resize", updatePos);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", updatePos, true);
      window.removeEventListener("resize", updatePos);
    };
  }, [open]);

  const conversionRate = a.clicksCount > 0
    ? ((a.signupsCount / a.clicksCount) * 100).toFixed(1)
    : "0.0";

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded-md border border-border bg-card/60 px-2 py-1 text-xs hover:border-primary/40 hover:text-primary transition-smooth"
      >
        {children}
      </button>
      {open && coords && createPortal(
        <div
          ref={panelRef}
          style={{ position: "fixed", top: coords.top, left: coords.left, width: 256, zIndex: 1000 }}
          className="rounded-2xl border border-primary/30 bg-card shadow-2xl backdrop-blur-xl p-4"
        >
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-display text-sm">Estatísticas do afiliado</h4>
            <button
              onClick={() => setOpen(false)}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Fechar"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-xl border border-border bg-background/50 p-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <MousePointer className="h-3.5 w-3.5 text-primary" />
                Cliques
              </div>
              <div className="font-display text-lg">{a.clicksCount ?? 0}</div>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-border bg-background/50 p-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Users className="h-3.5 w-3.5 text-emerald-500" />
                Cadastros
              </div>
              <div className="font-display text-lg">{a.signupsCount ?? 0}</div>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-border bg-background/50 p-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <TrendingUp className="h-3.5 w-3.5 text-amber-500" />
                Conversão
              </div>
              <div className="font-display text-lg">{conversionRate}%</div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

function Page() {
  const qc = useQueryClient();
  const listFn = useServerFn(adminListAffiliates);
  const statsFn = useServerFn(adminAffiliateStats);
  const settingsFn = useServerFn(getAffiliateSettings);
  const usersFn = useServerFn(adminListUsers);
  const promote = useServerFn(adminPromoteToAffiliate);
  const update = useServerFn(adminUpdateAffiliate);
  const saveSettings = useServerFn(adminUpdateAffiliateSettings);
  const payoutsFn = useServerFn(adminListPayouts);
  const updatePayout = useServerFn(adminUpdatePayoutStatus);
  const matureFn = useServerFn(adminMatureAffiliateCommissions);

  const affiliates = useQuery({ queryKey: ["admin-affiliates"], queryFn: () => listFn() as any });
  const stats = useQuery({ queryKey: ["admin-affiliates-stats"], queryFn: () => statsFn() as any });
  const settings = useQuery({ queryKey: ["admin-affiliate-settings"], queryFn: () => settingsFn() as any });
  const payouts = useQuery({ queryKey: ["admin-affiliate-payouts"], queryFn: () => payoutsFn() as any });

  const [showPromote, setShowPromote] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showGoals, setShowGoals] = useState(false);
  const exportFn = useServerFn(adminExportAffiliatesCsv);
  const [exporting, setExporting] = useState<string | null>(null);
  const doExport = async (dataset: "affiliates" | "commissions" | "payouts" | "referrals") => {
    try {
      setExporting(dataset);
      const res: any = await exportFn({ data: { dataset } });
      const blob = new Blob([res.csv || ""], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = res.filename; a.click();
      URL.revokeObjectURL(url);
    } finally { setExporting(null); }
  };

  const promoteMut = useMutation({
    mutationFn: (v: any) => promote({ data: v }) as any,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-affiliates"] });
      qc.invalidateQueries({ queryKey: ["admin-affiliates-stats"] });
      setShowPromote(false);
    },
    onError: (err: any) => {
      const msg = err?.message || "Não foi possível promover o usuário.";
      alert(`Erro ao tornar afiliado: ${msg}`);
      console.error("[admin.afiliados] promote error", err);
    },
  });

  const updateMut = useMutation({
    mutationFn: (v: any) => update({ data: v }) as any,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-affiliates"] }),
  });

  const payoutMut = useMutation({
    mutationFn: (v: any) => updatePayout({ data: v }) as any,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-affiliate-payouts"] });
      qc.invalidateQueries({ queryKey: ["admin-affiliates-stats"] });
    },
  });

  const matureMut = useMutation({
    mutationFn: () => matureFn() as any,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-affiliates-stats"] }),
  });

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 grid place-items-center rounded-2xl border border-primary/30 bg-primary/10 text-primary">
            <Handshake className="h-6 w-6" />
          </div>
          <div>
            <h1 className="font-display text-3xl">Afiliados</h1>
            <p className="text-sm text-muted-foreground">Gestão de parceiros, comissões e configurações globais.</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => matureMut.mutate()}
            disabled={matureMut.isPending}
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-card/60 px-3 py-1.5 text-sm hover:border-primary/40 disabled:opacity-50"
            title="Amadurecer comissões elegíveis (pendente → disponível)"
          >
            {matureMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Amadurecer
          </button>
          <button
            onClick={() => setShowGoals(true)}
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-card/60 px-3 py-1.5 text-sm hover:border-primary/40"
          >
            <Target className="h-4 w-4" /> Metas
          </button>
          <div className="inline-flex rounded-xl border border-border bg-card/60 overflow-hidden text-sm">
            <span className="px-2.5 py-1.5 text-xs text-muted-foreground inline-flex items-center gap-1"><Download className="h-3 w-3" />CSV</span>
            {(["affiliates", "commissions", "payouts", "referrals"] as const).map((d) => (
              <button key={d} disabled={exporting === d} onClick={() => doExport(d)} className="px-2 py-1.5 text-xs border-l border-border hover:bg-primary/10 disabled:opacity-50 capitalize">
                {exporting === d ? <Loader2 className="h-3 w-3 animate-spin inline" /> : d}
              </button>
            ))}
          </div>
          <button
            onClick={() => setShowSettings(true)}
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-card/60 px-3 py-1.5 text-sm hover:border-primary/40"
          >
            <Settings2 className="h-4 w-4" /> Configurações
          </button>
          <button
            onClick={() => setShowPromote(true)}
            className="inline-flex items-center gap-2 rounded-xl border border-primary bg-primary/10 text-primary px-3 py-1.5 text-sm hover:bg-primary/20"
          >
            <Plus className="h-4 w-4" /> Tornar Afiliado
          </button>
          <button
            onClick={() => { affiliates.refetch(); stats.refetch(); }}
            disabled={affiliates.isFetching}
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-card/60 px-3 py-1.5 text-sm hover:border-primary/40 disabled:opacity-50"
          >
            {affiliates.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Atualizar
          </button>
        </div>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={<Users className="h-4 w-4" />} label="Afiliados ativos" value={`${stats.data?.activeAff ?? 0} / ${stats.data?.totalAff ?? 0}`} />
        <StatCard icon={<MousePointerClick className="h-4 w-4" />} label="Cliques" value={String(stats.data?.clicks ?? 0)} />
        <StatCard icon={<Users className="h-4 w-4" />} label="Cadastros" value={String(stats.data?.signups ?? 0)} />
        <StatCard icon={<Wallet className="h-4 w-4" />} label="Comissões (pend./disp./pago)" value={`${brl(stats.data?.pendingCents ?? 0)} · ${brl(stats.data?.availableCents ?? 0)} · ${brl(stats.data?.paidCents ?? 0)}`} />
      </div>

      <div className="rounded-2xl border border-border bg-card/60 overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h2 className="font-medium">Afiliados cadastrados</h2>
          <span className="text-xs text-muted-foreground">{affiliates.data?.length ?? 0} registros</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground bg-muted/30">
              <tr>
                <th className="px-4 py-2">Nome</th>
                <th className="px-4 py-2">Link de afiliado</th>
                <th className="px-4 py-2">Comissão</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Criado em</th>
                <th className="px-4 py-2 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {(affiliates.data ?? []).map((a: any) => (
                <tr key={a.id} className="border-t border-border">
                  <td className="px-4 py-2">
                    <div>{a.profile?.name || "—"}</div>
                    <div className="text-xs text-muted-foreground">{a.profile?.email || a.profile?.phone || "—"}</div>
                  </td>
                  <td className="px-4 py-2">
                    <AffiliateLinkCell code={a.code} />
                  </td>
                  <td className="px-4 py-2">{a.custom_commission_pct != null ? `${a.custom_commission_pct}%` : "padrão"}</td>
                  <td className="px-4 py-2">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${
                      a.status === "active" ? "bg-emerald-500/10 text-emerald-500" :
                      a.status === "blocked" ? "bg-red-500/10 text-red-500" :
                      "bg-amber-500/10 text-amber-500"
                    }`}>{a.status}</span>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{new Date(a.created_at).toLocaleDateString("pt-BR")}</td>
                  <td className="px-4 py-2 text-right space-x-1">
                    <AffiliateStatsPopover a={a}>
                      <BarChart3 className="h-3.5 w-3.5" /> Estatísticas
                    </AffiliateStatsPopover>
                    {a.status !== "active" && (
                      <button onClick={() => updateMut.mutate({ affiliateId: a.id, status: "active" })} className="text-xs rounded-md border border-emerald-500/30 bg-emerald-500/10 text-emerald-500 px-2 py-1 hover:bg-emerald-500/20">Ativar</button>
                    )}
                    {a.status !== "blocked" && (
                      <button onClick={() => updateMut.mutate({ affiliateId: a.id, status: "blocked" })} className="text-xs rounded-md border border-red-500/30 bg-red-500/10 text-red-500 px-2 py-1 hover:bg-red-500/20">Bloquear</button>
                    )}
                  </td>
                </tr>
              ))}
              {!affiliates.isLoading && (affiliates.data ?? []).length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">Nenhum afiliado ainda. Use "Tornar Afiliado" para promover um usuário.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card/60 overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h2 className="font-medium">Solicitações de saque</h2>
          <span className="text-xs text-muted-foreground">{payouts.data?.length ?? 0} registros</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground bg-muted/30">
              <tr>
                <th className="px-4 py-2">Afiliado</th>
                <th className="px-4 py-2">Valor</th>
                <th className="px-4 py-2">Método</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Solicitado</th>
                <th className="px-4 py-2 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {(payouts.data ?? []).map((p: any) => (
                <tr key={p.id} className="border-t border-border align-top">
                  <td className="px-4 py-2">
                    <div>{p.profile?.name || "—"}</div>
                    <div className="text-xs text-muted-foreground">{p.profile?.email || p.affiliate?.code || "—"}</div>
                  </td>
                  <td className="px-4 py-2 font-medium">{brl(p.amount_cents)}</td>
                  <td className="px-4 py-2 capitalize">
                    <div>{p.method}</div>
                    <details className="text-[10px] text-muted-foreground cursor-pointer">
                      <summary>ver dados</summary>
                      <pre className="mt-1 whitespace-pre-wrap break-all">{JSON.stringify(p.payload ?? {}, null, 2)}</pre>
                    </details>
                  </td>
                  <td className="px-4 py-2">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${
                      p.status === "paid" ? "bg-emerald-500/10 text-emerald-500" :
                      p.status === "approved" ? "bg-primary/10 text-primary" :
                      p.status === "rejected" ? "bg-red-500/10 text-red-500" :
                      "bg-amber-500/10 text-amber-500"
                    }`}>{p.status}</span>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground text-xs">{new Date(p.requested_at).toLocaleString("pt-BR")}</td>
                  <td className="px-4 py-2 text-right space-x-1 whitespace-nowrap">
                    {p.status === "pending" && (
                      <button onClick={() => payoutMut.mutate({ payoutId: p.id, status: "approved" })} className="text-xs rounded-md border border-primary/30 bg-primary/10 text-primary px-2 py-1 hover:bg-primary/20 inline-flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />Aprovar</button>
                    )}
                    {(p.status === "pending" || p.status === "approved") && (
                      <>
                        <button onClick={() => payoutMut.mutate({ payoutId: p.id, status: "paid" })} className="text-xs rounded-md border border-emerald-500/30 bg-emerald-500/10 text-emerald-500 px-2 py-1 hover:bg-emerald-500/20 inline-flex items-center gap-1"><Send className="h-3 w-3" />Marcar pago</button>
                        <button onClick={() => payoutMut.mutate({ payoutId: p.id, status: "rejected" })} className="text-xs rounded-md border border-red-500/30 bg-red-500/10 text-red-500 px-2 py-1 hover:bg-red-500/20 inline-flex items-center gap-1"><XCircle className="h-3 w-3" />Rejeitar</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {!payouts.isLoading && (payouts.data ?? []).length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">Nenhuma solicitação de saque ainda.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>



      {showPromote && (
        <PromoteDialog
          onClose={() => setShowPromote(false)}
          onSubmit={(v) => promoteMut.mutate(v)}
          loading={promoteMut.isPending}
          loadUsers={() => usersFn() as any}
        />
      )}

      {showSettings && (
        <SettingsDialog
          initial={settings.data}
          onClose={() => setShowSettings(false)}
          onSubmit={async (v) => {
            await saveSettings({ data: v });
            qc.invalidateQueries({ queryKey: ["admin-affiliate-settings"] });
            setShowSettings(false);
          }}
        />
      )}

      {showGoals && <GoalsDialog onClose={() => setShowGoals(false)} />}
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card/60 p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">{icon} {label}</div>
      <div className="mt-1 font-display text-lg">{value}</div>
    </div>
  );
}

function PromoteDialog({ onClose, onSubmit, loading, loadUsers }: {
  onClose: () => void;
  onSubmit: (v: { userId: string; customCommissionPct?: number; couponCode?: string; adminNote?: string }) => void;
  loading: boolean;
  loadUsers: () => Promise<any>;
}) {
  const users = useQuery({ queryKey: ["admin-list-users-affiliate"], queryFn: loadUsers });
  const [search, setSearch] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [pct, setPct] = useState<string>("");
  const [coupon, setCoupon] = useState("");
  const [note, setNote] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = users.data ?? [];
    if (!q) return all.slice(0, 30);
    return all.filter((u: any) =>
      (u.name || "").toLowerCase().includes(q) ||
      (u.email || "").toLowerCase().includes(q) ||
      (u.phone || "").toLowerCase().includes(q)
    ).slice(0, 30);
  }, [users.data, search]);

  const selected = (users.data ?? []).find((u: any) => u.id === userId);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-xl">Tornar Afiliado</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>

        {!userId ? (
          <>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nome, e-mail ou telefone"
                className="w-full rounded-xl border border-border bg-input pl-9 pr-3 py-2 text-sm"
              />
            </div>
            <div className="max-h-72 overflow-y-auto rounded-xl border border-border divide-y divide-border">
              {users.isLoading && <div className="p-4 text-center text-sm text-muted-foreground">Carregando…</div>}
              {filtered.map((u: any) => (
                <button
                  key={u.id}
                  onClick={() => setUserId(u.id)}
                  className="w-full text-left px-3 py-2 hover:bg-muted/40 transition-smooth"
                >
                  <div className="text-sm">{u.name || "(sem nome)"}</div>
                  <div className="text-xs text-muted-foreground">{u.email || u.phone || u.id}</div>
                </button>
              ))}
              {!users.isLoading && filtered.length === 0 && (
                <div className="p-4 text-center text-sm text-muted-foreground">Nenhum usuário encontrado.</div>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="rounded-xl border border-border p-3">
              <div className="text-sm">{selected?.name || "(sem nome)"}</div>
              <div className="text-xs text-muted-foreground">{selected?.email || selected?.phone}</div>
              <button onClick={() => setUserId(null)} className="mt-2 text-xs text-primary hover:underline">Trocar usuário</button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs space-y-1">
                <span className="text-muted-foreground">Comissão % (opcional)</span>
                <input value={pct} onChange={(e) => setPct(e.target.value)} placeholder="ex.: 30" className="w-full rounded-lg border border-border bg-input px-2 py-1.5 text-sm" />
              </label>
              <label className="text-xs space-y-1">
                <span className="text-muted-foreground">Cupom (opcional)</span>
                <input value={coupon} onChange={(e) => setCoupon(e.target.value)} placeholder="ex.: MARIA10" className="w-full rounded-lg border border-border bg-input px-2 py-1.5 text-sm uppercase" />
              </label>
            </div>
            <label className="text-xs space-y-1 block">
              <span className="text-muted-foreground">Observação interna (opcional)</span>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="w-full rounded-lg border border-border bg-input px-2 py-1.5 text-sm" />
            </label>
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="rounded-xl border border-border px-3 py-1.5 text-sm">Cancelar</button>
              <button
                disabled={loading}
                onClick={() => {
                  const rawPct = pct.replace(/[^0-9,.\-]/g, "").replace(",", ".");
                  const parsedPct = rawPct ? Number(rawPct) : undefined;
                  if (parsedPct !== undefined && (!Number.isFinite(parsedPct) || parsedPct < 0 || parsedPct > 100)) {
                    alert("Informe uma comissão válida entre 0 e 100 (ex.: 10).");
                    return;
                  }
                  onSubmit({
                    userId,
                    customCommissionPct: parsedPct,
                    couponCode: coupon.trim() || undefined,
                    adminNote: note.trim() || undefined,
                  });
                }}
                className="inline-flex items-center gap-2 rounded-xl bg-primary text-primary-foreground px-3 py-1.5 text-sm hover:opacity-90 disabled:opacity-50"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Promover
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SettingsDialog({ initial, onClose, onSubmit }: {
  initial: any;
  onClose: () => void;
  onSubmit: (v: any) => Promise<void>;
}) {
  const [form, setForm] = useState({
    cookie_days: initial?.cookie_days ?? 60,
    min_payout_cents: initial?.min_payout_cents ?? 5000,
    commission_pct_monthly: initial?.commission_pct_monthly ?? 20,
    commission_pct_quarterly: initial?.commission_pct_quarterly ?? 25,
    commission_pct_semiannual: initial?.commission_pct_semiannual ?? 30,
    commission_pct_annual: initial?.commission_pct_annual ?? 35,
    commission_pct_lifetime: initial?.commission_pct_lifetime ?? 40,
    hold_days: initial?.hold_days ?? 30,
  });
  const [saving, setSaving] = useState(false);

  const num = (k: keyof typeof form) => ({
    value: String(form[k] ?? ""),
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: Number(e.target.value.replace(",", ".")) || 0 }),
  });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl rounded-2xl border border-border bg-card p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-xl">Configurações globais</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
          <Field label="Cookie (dias)"><input {...num("cookie_days")} className="input" /></Field>
          <Field label="Saque mínimo (centavos)"><input {...num("min_payout_cents")} className="input" /></Field>
          <Field label="Carência (dias)"><input {...num("hold_days")} className="input" /></Field>
          <Field label="% Mensal"><input {...num("commission_pct_monthly")} className="input" /></Field>
          <Field label="% Trimestral"><input {...num("commission_pct_quarterly")} className="input" /></Field>
          <Field label="% Semestral"><input {...num("commission_pct_semiannual")} className="input" /></Field>
          <Field label="% Anual"><input {...num("commission_pct_annual")} className="input" /></Field>
          <Field label="% Vitalício"><input {...num("commission_pct_lifetime")} className="input" /></Field>
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-xl border border-border px-3 py-1.5 text-sm">Cancelar</button>
          <button
            disabled={saving}
            onClick={async () => { setSaving(true); try { await onSubmit(form); } finally { setSaving(false); } }}
            className="inline-flex items-center gap-2 rounded-xl bg-primary text-primary-foreground px-3 py-1.5 text-sm hover:opacity-90 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Salvar
          </button>
        </div>
        <style>{`.input{width:100%;border:1px solid hsl(var(--border));background:hsl(var(--input));border-radius:.5rem;padding:.375rem .5rem;font-size:.875rem;color:hsl(var(--foreground))}`}</style>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1 block">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function GoalsDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listAffiliateGoals);
  const upsertFn = useServerFn(adminUpsertGoal);
  const deleteFn = useServerFn(adminDeleteGoal);
  const q = useQuery({ queryKey: ["admin-goals"], queryFn: () => listFn() as any });
  const upsert = useMutation({
    mutationFn: (v: any) => upsertFn({ data: v }) as any,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-goals"] }); qc.invalidateQueries({ queryKey: ["affiliate-goals"] }); },
  });
  const del = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }) as any,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-goals"] }); qc.invalidateQueries({ queryKey: ["affiliate-goals"] }); },
  });
  const [form, setForm] = useState({ sales_count: 5, reward_type: "bonus_cents" as "bonus_cents" | "commission_boost" | "gift", reward_value_cents: 5000, description: "", active: true });
  const goals = q.data?.goals ?? [];

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl rounded-2xl border border-border bg-card p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-xl inline-flex items-center gap-2"><Target className="h-5 w-5 text-primary" />Metas de afiliados</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>

        <div className="rounded-xl border border-border p-3 space-y-2">
          <div className="text-sm font-medium">Nova meta</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <label className="space-y-1 block"><span className="text-muted-foreground">Conversões</span><input type="number" min={1} value={form.sales_count} onChange={(e) => setForm({ ...form, sales_count: Number(e.target.value) })} className="w-full rounded-lg border border-border bg-input px-2 py-1.5 text-sm" /></label>
            <label className="space-y-1 block"><span className="text-muted-foreground">Tipo</span>
              <select value={form.reward_type} onChange={(e) => setForm({ ...form, reward_type: e.target.value as any })} className="w-full rounded-lg border border-border bg-input px-2 py-1.5 text-sm">
                <option value="bonus_cents">Bônus (R$)</option>
                <option value="commission_boost">Boost comissão (pp)</option>
                <option value="gift">Brinde</option>
              </select>
            </label>
            <label className="space-y-1 block"><span className="text-muted-foreground">Valor (centavos)</span><input type="number" min={0} value={form.reward_value_cents} onChange={(e) => setForm({ ...form, reward_value_cents: Number(e.target.value) })} className="w-full rounded-lg border border-border bg-input px-2 py-1.5 text-sm" /></label>
            <label className="space-y-1 block col-span-2 md:col-span-4"><span className="text-muted-foreground">Descrição</span><input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full rounded-lg border border-border bg-input px-2 py-1.5 text-sm" /></label>
          </div>
          <div className="flex justify-end">
            <button onClick={() => upsert.mutate(form)} disabled={upsert.isPending} className="inline-flex items-center gap-2 rounded-xl bg-primary text-primary-foreground px-3 py-1.5 text-sm hover:opacity-90 disabled:opacity-50">
              {upsert.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Adicionar meta
            </button>
          </div>
        </div>

        <div className="space-y-2">
          {goals.map((g: any) => (
            <div key={g.id} className="flex items-center justify-between gap-2 rounded-xl border border-border p-2 text-sm">
              <div>
                <div className="font-medium">{g.sales_count} conversões — {g.reward_type === "bonus_cents" ? brl(g.reward_value_cents) : g.reward_type === "commission_boost" ? `+${(g.reward_value_cents / 100).toFixed(1)}pp` : "Brinde"}</div>
                {g.description && <div className="text-xs text-muted-foreground">{g.description}</div>}
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => upsert.mutate({ id: g.id, sales_count: g.sales_count, reward_type: g.reward_type, reward_value_cents: g.reward_value_cents, description: g.description, active: !g.active })} className={`text-xs rounded-md border px-2 py-1 ${g.active ? "border-emerald-500/40 text-emerald-500" : "border-border text-muted-foreground"}`}>{g.active ? "Ativa" : "Inativa"}</button>
                <button onClick={() => { if (confirm("Excluir meta?")) del.mutate(g.id); }} className="text-xs rounded-md border border-red-500/40 text-red-500 px-2 py-1 hover:bg-red-500/10 inline-flex items-center gap-1"><Trash2 className="h-3 w-3" />Excluir</button>
              </div>
            </div>
          ))}
          {!q.isLoading && goals.length === 0 && <div className="text-center text-sm text-muted-foreground py-6">Nenhuma meta cadastrada.</div>}
        </div>
      </div>
    </div>
  );
}


