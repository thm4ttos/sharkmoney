import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Handshake, Copy, Check, RefreshCw, Loader2, Users, MousePointerClick, Wallet, QrCode, Sparkles, Send, X, Megaphone, Trophy, Target } from "lucide-react";
import { getMyAffiliateOverview, requestAffiliateAccess, requestPayout, getAffiliateLeaderboard, listAffiliateGoals } from "@/lib/affiliate.functions";


export const Route = createFileRoute("/app/afiliados")({
  head: () => ({
    meta: [
      { title: "Programa de Afiliados · Shark Money" },
      { name: "description", content: "Indique o Shark Money, acompanhe cliques, cadastros e receba comissões." },
    ],
  }),
  component: Page,
});

const brl = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const SITE = "https://abio.fun";

function Page() {
  const qc = useQueryClient();
  const overviewFn = useServerFn(getMyAffiliateOverview);
  const requestFn = useServerFn(requestAffiliateAccess);
  const payoutFn = useServerFn(requestPayout);
  const q = useQuery({ queryKey: ["my-affiliate-overview"], queryFn: () => overviewFn() as any });
  const request = useMutation({ mutationFn: () => requestFn() as any, onSuccess: () => q.refetch() });
  const [showPayout, setShowPayout] = useState(false);
  const [payoutError, setPayoutError] = useState<string | null>(null);
  const payout = useMutation({
    mutationFn: (v: any) => payoutFn({ data: v }) as any,
    onSuccess: () => { setShowPayout(false); setPayoutError(null); qc.invalidateQueries({ queryKey: ["my-affiliate-overview"] }); },
    onError: (e: any) => setPayoutError(e?.message || "Erro ao solicitar saque"),
  });

  const aff = q.data?.affiliate;
  const link = aff ? `${SITE}/?ref=${aff.code}` : "";
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!link) return;
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch {}
  };

  const qrUrl = useMemo(() =>
    link ? `https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(link)}` : "",
  [link]);

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-24 md:pb-6">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 grid place-items-center rounded-2xl border border-primary/30 bg-primary/10 text-primary">
            <Handshake className="h-6 w-6" />
          </div>
          <div>
            <h1 className="font-display text-3xl">Programa de Afiliados</h1>
            <p className="text-sm text-muted-foreground">Convide amigos, ganhe comissões recorrentes.</p>
          </div>
        </div>
        <button
          onClick={() => q.refetch()}
          disabled={q.isFetching}
          className="inline-flex items-center gap-2 rounded-xl border border-border bg-card/60 px-3 py-1.5 text-sm hover:border-primary/40 disabled:opacity-50"
        >
          {q.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Atualizar
        </button>
      </header>

      {q.isLoading && (
        <div className="rounded-2xl border border-border bg-card/60 p-8 text-center text-sm text-muted-foreground">Carregando…</div>
      )}

      {q.data && !aff && (
        <div className="rounded-2xl border border-border bg-card/60 p-6 space-y-4">
          <div className="flex items-center gap-3">
            <Sparkles className="h-6 w-6 text-primary" />
            <h2 className="font-display text-xl">Ainda não é afiliado</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Solicite o acesso ao programa. Após a aprovação você recebe um link exclusivo, materiais e passa a acompanhar suas comissões aqui.
          </p>
          <button
            onClick={() => request.mutate()}
            disabled={request.isPending}
            className="inline-flex items-center gap-2 rounded-xl bg-primary text-primary-foreground px-4 py-2 text-sm hover:opacity-90 disabled:opacity-50"
          >
            {request.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Handshake className="h-4 w-4" />}
            Solicitar acesso
          </button>
        </div>
      )}

      {aff && aff.status === "pending" && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-500">
          Sua solicitação está em análise. Você receberá uma notificação assim que for aprovada.
        </div>
      )}

      {aff && aff.status === "blocked" && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-500">
          Sua conta de afiliado está bloqueada. Entre em contato com o suporte.
        </div>
      )}

      {aff && aff.status === "active" && (
        <>
          <section className="rounded-2xl border border-border bg-card/60 p-6 space-y-4">
            <div className="flex flex-col md:flex-row md:items-center gap-4 md:gap-6">
              <div className="flex-1 space-y-2">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Seu link exclusivo</div>
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    value={link}
                    className="flex-1 rounded-xl border border-border bg-input px-3 py-2 text-sm font-mono"
                  />
                  <button
                    onClick={copy}
                    className="inline-flex items-center gap-2 rounded-xl bg-primary text-primary-foreground px-3 py-2 text-sm hover:opacity-90"
                  >
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    {copied ? "Copiado" : "Copiar"}
                  </button>
                </div>
                <div className="text-xs text-muted-foreground">
                  Código: <span className="font-mono text-foreground">{aff.code}</span>
                  {aff.coupon_code && <> · Cupom: <span className="font-mono text-foreground">{aff.coupon_code}</span></>}
                  {aff.custom_commission_pct != null && <> · Comissão: <span className="text-foreground">{aff.custom_commission_pct}%</span></>}
                </div>
              </div>
              <div className="flex flex-col items-center gap-2">
                <div className="rounded-xl border border-border bg-background p-2">
                  {qrUrl ? <img src={qrUrl} alt="QR Code" width={140} height={140} className="rounded-md" /> : null}
                </div>
                <a href={qrUrl} download={`abio-afiliado-${aff.code}.png`} className="text-xs inline-flex items-center gap-1 text-primary hover:underline">
                  <QrCode className="h-3 w-3" /> Baixar QR
                </a>
              </div>
            </div>
          </section>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard icon={<MousePointerClick className="h-4 w-4" />} label="Cliques" value={String(q.data.clicksCount ?? 0)} />
            <StatCard icon={<Users className="h-4 w-4" />} label="Cadastros" value={String(q.data.referralsCount ?? 0)} />
            <StatCard icon={<Wallet className="h-4 w-4" />} label="Disponível" value={brl(q.data.commissions?.availableCents ?? 0)} />
            <StatCard icon={<Wallet className="h-4 w-4" />} label="Pendente" value={brl(q.data.commissions?.pendingCents ?? 0)} />
          </div>

          <section className="rounded-2xl border border-border bg-card/60 p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Saldo disponível para saque</div>
              <div className="font-display text-2xl">{brl(q.data.commissions?.availableCents ?? 0)}</div>
              {q.data.settings?.min_payout_cents ? (
                <div className="text-xs text-muted-foreground mt-0.5">Mínimo para saque: {brl(q.data.settings.min_payout_cents)}</div>
              ) : null}
            </div>
            <button
              disabled={(q.data.commissions?.availableCents ?? 0) < (q.data.settings?.min_payout_cents ?? 5000)}
              onClick={() => { setPayoutError(null); setShowPayout(true); }}
              className="inline-flex items-center gap-2 rounded-xl bg-primary text-primary-foreground px-4 py-2 text-sm hover:opacity-90 disabled:opacity-50"
            >
              <Send className="h-4 w-4" /> Solicitar saque
            </button>
          </section>

          <section className="grid md:grid-cols-2 gap-4">

            <Card title="Últimos cadastros">
              {(q.data.referrals ?? []).length === 0 && (
                <div className="text-sm text-muted-foreground">Ainda sem cadastros. Compartilhe seu link!</div>
              )}
              <ul className="divide-y divide-border">
                {(q.data.referrals ?? []).map((r: any) => (
                  <li key={r.id} className="py-2 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm truncate">{r.profile?.name || "(sem nome)"}</div>
                      <div className="text-xs text-muted-foreground truncate">{r.profile?.email || "—"}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${
                        r.status === "converted" ? "bg-emerald-500/10 text-emerald-500" :
                        r.status === "signup" ? "bg-primary/10 text-primary" :
                        "bg-muted text-muted-foreground"
                      }`}>{r.status}</span>
                      <div className="text-[10px] text-muted-foreground mt-0.5">{new Date(r.created_at).toLocaleDateString("pt-BR")}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>

            <Card title="Últimos saques">
              {(q.data.payouts ?? []).length === 0 && (
                <div className="text-sm text-muted-foreground">Nenhum saque solicitado ainda.</div>
              )}
              <ul className="divide-y divide-border">
                {(q.data.payouts ?? []).map((p: any) => (
                  <li key={p.id} className="py-2 flex items-center justify-between gap-3">
                    <div className="text-sm">{brl(p.amount_cents)} <span className="text-xs text-muted-foreground">· {p.method}</span></div>
                    <div className="text-right">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${
                        p.status === "paid" ? "bg-emerald-500/10 text-emerald-500" :
                        p.status === "approved" ? "bg-primary/10 text-primary" :
                        p.status === "rejected" ? "bg-red-500/10 text-red-500" :
                        "bg-amber-500/10 text-amber-500"
                      }`}>{p.status}</span>
                      <div className="text-[10px] text-muted-foreground mt-0.5">{new Date(p.created_at).toLocaleDateString("pt-BR")}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          </section>

          <GoalsSection />
          <LeaderboardSection />
          <MaterialsSection link={link} code={aff.code} coupon={aff.coupon_code} />
        </>
      )}

      {showPayout && aff && (
        <PayoutDialog
          available={q.data?.commissions?.availableCents ?? 0}
          error={payoutError}
          loading={payout.isPending}
          onClose={() => setShowPayout(false)}
          onSubmit={(v) => payout.mutate(v)}
        />
      )}
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

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card/60 p-4">
      <h3 className="font-medium mb-2">{title}</h3>
      {children}
    </div>
  );
}

function PayoutDialog({ available, error, loading, onClose, onSubmit }: {
  available: number;
  error: string | null;
  loading: boolean;
  onClose: () => void;
  onSubmit: (v: { method: "pix" | "bank" | "wallet"; payload: Record<string, string> }) => void;
}) {
  const [method, setMethod] = useState<"pix" | "bank" | "wallet">("pix");
  const [pixKey, setPixKey] = useState("");
  const [bank, setBank] = useState({ bank: "", agency: "", account: "", holder: "", document: "" });
  const [wallet, setWallet] = useState({ provider: "", account: "" });

  const submit = () => {
    const payload: Record<string, string> =
      method === "pix" ? { pixKey } :
      method === "bank" ? bank :
      { ...wallet };
    onSubmit({ method, payload });
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-xl">Solicitar saque</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm">
          Valor total a solicitar: <strong>{brl(available)}</strong>
          <div className="text-xs text-muted-foreground mt-1">Todas as comissões disponíveis serão incluídas neste saque.</div>
        </div>
        <div className="flex gap-2">
          {(["pix", "bank", "wallet"] as const).map((m) => (
            <button key={m} onClick={() => setMethod(m)} className={`flex-1 rounded-xl border px-3 py-2 text-sm capitalize ${method === m ? "border-primary bg-primary/10 text-primary" : "border-border"}`}>
              {m === "pix" ? "PIX" : m === "bank" ? "Conta bancária" : "Carteira"}
            </button>
          ))}
        </div>
        {method === "pix" && (
          <label className="text-xs space-y-1 block">
            <span className="text-muted-foreground">Chave PIX</span>
            <input value={pixKey} onChange={(e) => setPixKey(e.target.value)} placeholder="CPF, e-mail, telefone ou chave aleatória" className="w-full rounded-lg border border-border bg-input px-2 py-1.5 text-sm" />
          </label>
        )}
        {method === "bank" && (
          <div className="grid grid-cols-2 gap-2 text-xs">
            <label className="space-y-1 block col-span-2"><span className="text-muted-foreground">Titular</span><input value={bank.holder} onChange={(e) => setBank({ ...bank, holder: e.target.value })} className="w-full rounded-lg border border-border bg-input px-2 py-1.5 text-sm" /></label>
            <label className="space-y-1 block col-span-2"><span className="text-muted-foreground">CPF/CNPJ</span><input value={bank.document} onChange={(e) => setBank({ ...bank, document: e.target.value })} className="w-full rounded-lg border border-border bg-input px-2 py-1.5 text-sm" /></label>
            <label className="space-y-1 block col-span-2"><span className="text-muted-foreground">Banco</span><input value={bank.bank} onChange={(e) => setBank({ ...bank, bank: e.target.value })} className="w-full rounded-lg border border-border bg-input px-2 py-1.5 text-sm" /></label>
            <label className="space-y-1 block"><span className="text-muted-foreground">Agência</span><input value={bank.agency} onChange={(e) => setBank({ ...bank, agency: e.target.value })} className="w-full rounded-lg border border-border bg-input px-2 py-1.5 text-sm" /></label>
            <label className="space-y-1 block"><span className="text-muted-foreground">Conta</span><input value={bank.account} onChange={(e) => setBank({ ...bank, account: e.target.value })} className="w-full rounded-lg border border-border bg-input px-2 py-1.5 text-sm" /></label>
          </div>
        )}
        {method === "wallet" && (
          <div className="grid grid-cols-1 gap-2 text-xs">
            <label className="space-y-1 block"><span className="text-muted-foreground">Provedor (ex.: PayPal, Wise)</span><input value={wallet.provider} onChange={(e) => setWallet({ ...wallet, provider: e.target.value })} className="w-full rounded-lg border border-border bg-input px-2 py-1.5 text-sm" /></label>
            <label className="space-y-1 block"><span className="text-muted-foreground">Conta / e-mail</span><input value={wallet.account} onChange={(e) => setWallet({ ...wallet, account: e.target.value })} className="w-full rounded-lg border border-border bg-input px-2 py-1.5 text-sm" /></label>
          </div>
        )}
        {error && <div className="text-sm text-red-500">{error}</div>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-xl border border-border px-3 py-1.5 text-sm">Cancelar</button>
          <button disabled={loading} onClick={submit} className="inline-flex items-center gap-2 rounded-xl bg-primary text-primary-foreground px-3 py-1.5 text-sm hover:opacity-90 disabled:opacity-50">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Confirmar solicitação
          </button>
        </div>
      </div>
    </div>
  );
}

function MaterialsSection({ link, code, coupon }: { link: string; code: string; coupon?: string | null }) {
  const messages = useMemo(() => [
    `Estou usando o *Shark Money* como assistente financeiro no WhatsApp — registra gastos, receitas, contas fixas e lembretes numa conversa. Testa com meu link: ${link}`,
    `Ei! O Shark Money virou meu financeiro pessoal 🤖💰\nÉ tudo pelo WhatsApp e organiza minhas contas automaticamente.\nExperimenta: ${link}${coupon ? `\nCupom: ${coupon}` : ""}`,
    `Se você quer controle financeiro sem planilha, o *Shark Money* resolve. Basta mandar mensagem no WhatsApp e ele registra tudo. Comece por aqui: ${link}`,
  ], [link, coupon]);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const copy = async (i: number, text: string) => {
    try { await navigator.clipboard.writeText(text); setCopiedIdx(i); setTimeout(() => setCopiedIdx(null), 1600); } catch {}
  };
  return (
    <section className="rounded-2xl border border-border bg-card/60 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Megaphone className="h-4 w-4 text-primary" />
        <h3 className="font-medium">Materiais de divulgação</h3>
      </div>
      <p className="text-xs text-muted-foreground">Mensagens prontas com seu link{coupon ? " e cupom" : ""}. Copie e envie no WhatsApp ou redes sociais.</p>
      <div className="grid md:grid-cols-3 gap-3">
        {messages.map((msg, i) => (
          <div key={i} className="rounded-xl border border-border bg-background/40 p-3 flex flex-col gap-2">
            <div className="text-xs whitespace-pre-line text-muted-foreground flex-1">{msg}</div>
            <button onClick={() => copy(i, msg)} className="inline-flex items-center justify-center gap-2 rounded-lg border border-primary/40 bg-primary/10 text-primary px-2 py-1 text-xs hover:bg-primary/20">
              {copiedIdx === i ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              {copiedIdx === i ? "Copiado" : "Copiar mensagem"}
            </button>
          </div>
        ))}
      </div>
      <div className="text-xs text-muted-foreground">Código: <span className="font-mono text-foreground">{code}</span>{coupon ? <> · Cupom: <span className="font-mono text-foreground">{coupon}</span></> : null}</div>
    </section>
  );
}

function LeaderboardSection() {
  const fn = useServerFn(getAffiliateLeaderboard);
  const q = useQuery({ queryKey: ["affiliate-leaderboard"], queryFn: () => fn() as any });
  if (q.isLoading) return <section className="rounded-2xl border border-border bg-card/60 p-4 text-sm text-muted-foreground">Carregando ranking…</section>;
  const rows = q.data?.rows ?? [];
  return (
    <section className="rounded-2xl border border-border bg-card/60 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Trophy className="h-4 w-4 text-amber-500" />
        <h3 className="font-medium">Ranking (últimos 30 dias)</h3>
        {q.data?.myRank && <span className="ml-auto text-xs text-muted-foreground">Você está em <strong className="text-primary">#{q.data.myRank}</strong></span>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr><th className="py-1">#</th><th>Afiliado</th><th>Conversões</th><th className="text-right">Comissão</th></tr>
          </thead>
          <tbody>
            {rows.slice(0, 10).map((r: any, i: number) => (
              <tr key={r.affiliate_id} className="border-t border-border">
                <td className="py-2">{i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1}</td>
                <td className="py-2"><span className="font-medium">{r.name}</span> <span className="text-xs text-muted-foreground font-mono">{r.code}</span></td>
                <td className="py-2">{r.conversions}</td>
                <td className="py-2 text-right">{brl(r.commission_cents)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={4} className="py-4 text-center text-muted-foreground text-xs">Ainda sem atividade nos últimos 30 dias.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function GoalsSection() {
  const fn = useServerFn(listAffiliateGoals);
  const q = useQuery({ queryKey: ["affiliate-goals"], queryFn: () => fn() as any });
  if (q.isLoading) return null;
  const goals = q.data?.goals ?? [];
  const converted = q.data?.converted ?? 0;
  if (!goals.length) return null;
  return (
    <section className="rounded-2xl border border-border bg-card/60 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Target className="h-4 w-4 text-primary" />
        <h3 className="font-medium">Metas & recompensas</h3>
        <span className="ml-auto text-xs text-muted-foreground">Suas conversões: <strong className="text-foreground">{converted}</strong></span>
      </div>
      <div className="grid md:grid-cols-3 gap-3">
        {goals.map((g: any) => {
          const pct = Math.min(100, Math.round((converted / g.sales_count) * 100));
          const done = converted >= g.sales_count;
          const rewardLabel = g.reward_type === "bonus_cents" ? `Bônus ${brl(g.reward_value_cents)}` : g.reward_type === "commission_boost" ? `+${(g.reward_value_cents / 100).toFixed(1)}pp comissão` : "Brinde especial";
          return (
            <div key={g.id} className={`rounded-xl border p-3 ${done ? "border-emerald-500/40 bg-emerald-500/5" : "border-border bg-background/40"}`}>
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium">{g.sales_count} conversões</span>
                {done && <span className="text-emerald-500 inline-flex items-center gap-1"><Check className="h-3 w-3" />Conquistado</span>}
              </div>
              <div className="mt-1 text-sm">{rewardLabel}</div>
              {g.description && <div className="text-xs text-muted-foreground mt-1">{g.description}</div>}
              <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
                <div className={`h-full ${done ? "bg-emerald-500" : "bg-primary"}`} style={{ width: `${pct}%` }} />
              </div>
              <div className="mt-1 text-[10px] text-muted-foreground text-right">{converted}/{g.sales_count} ({pct}%)</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
