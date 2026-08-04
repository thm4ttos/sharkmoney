import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  adminDebugListUsers,
  adminPromoteUser,
  adminDemoteUser,
  type DebugUserRow,
} from "@/lib/admin-debug.functions";
import { adminResetUserData } from "@/lib/user-extras.functions";
import { Shield, ShieldCheck, ShieldOff, Search, Loader2, CheckCircle2, XCircle, Trash2 } from "lucide-react";

export const Route = createFileRoute("/admin/debug-users")({
  component: DebugUsersPage,
});

function DebugUsersPage() {
  const listFn = useServerFn(adminDebugListUsers);
  const promoteFn = useServerFn(adminPromoteUser);
  const demoteFn = useServerFn(adminDemoteUser);
  const resetFn = useServerFn(adminResetUserData);
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [resetTarget, setResetTarget] = useState<DebugUserRow | null>(null);
  const [resetConfirm1, setResetConfirm1] = useState(false);
  const [resetConfirm2, setResetConfirm2] = useState("");
  const [resetBusy, setResetBusy] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "debug-users"],
    queryFn: () => listFn(),
  });

  const promote = useMutation({
    mutationFn: (targetUserId: string) => promoteFn({ data: { targetUserId } }),
    onSuccess: () => {
      setMsg({ kind: "ok", text: "Permissão de administrador concedida." });
      qc.invalidateQueries({ queryKey: ["admin", "debug-users"] });
    },
    onError: (e: any) => setMsg({ kind: "err", text: e?.message ?? "Falha ao promover." }),
  });

  const demote = useMutation({
    mutationFn: (targetUserId: string) => demoteFn({ data: { targetUserId } }),
    onSuccess: () => {
      setMsg({ kind: "ok", text: "Permissão de administrador removida." });
      qc.invalidateQueries({ queryKey: ["admin", "debug-users"] });
    },
    onError: (e: any) => setMsg({ kind: "err", text: e?.message ?? "Falha ao rebaixar." }),
  });

  const filtered = useMemo(() => {
    const rows = data ?? [];
    if (!q.trim()) return rows;
    const needle = q.toLowerCase();
    return rows.filter((r) =>
      [r.name, r.email ?? "", r.phone, r.id].some((v) => v.toLowerCase().includes(needle)),
    );
  }, [data, q]);

  const admins = (data ?? []).filter((u) => u.is_admin);

  return (
    <div className="space-y-6 max-w-6xl">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display flex items-center gap-2">
            <Shield className="h-6 w-6 text-primary" /> Diagnóstico de usuários
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Rota temporária para inspecionar papéis e restaurar permissões de administrador.
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card/60 p-3 text-xs min-w-[200px]">
          <div className="text-muted-foreground">Administradores ativos</div>
          <div className="text-2xl font-display mt-1">{admins.length}</div>
        </div>
      </header>

      {msg && (
        <div
          className={`rounded-lg border p-3 text-sm flex items-center gap-2 ${
            msg.kind === "ok"
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
              : "border-destructive/40 bg-destructive/10 text-destructive"
          }`}
        >
          {msg.kind === "ok" ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
          {msg.text}
        </div>
      )}

      <div className="rounded-xl border border-border bg-card/40 p-4">
        <div className="relative">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por nome, e-mail, telefone ou ID..."
            className="w-full bg-background/60 border border-border rounded-lg pl-9 pr-3 py-2 text-sm"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando usuários...
        </div>
      ) : error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {(error as any)?.message ?? "Erro ao carregar usuários."}
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-card/60 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left p-3">Usuário</th>
                <th className="text-left p-3">Contato</th>
                <th className="text-left p-3">Papéis</th>
                <th className="text-left p-3">Status</th>
                <th className="text-left p-3">Último login</th>
                <th className="text-right p-3">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <UserRow
                  key={u.id}
                  u={u}
                  onPromote={() => promote.mutate(u.id)}
                  onDemote={() => demote.mutate(u.id)}
                  onReset={() => { setResetTarget(u); setResetConfirm1(false); setResetConfirm2(""); }}
                  busy={promote.isPending || demote.isPending}
                />
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-muted-foreground text-sm">
                    Nenhum usuário encontrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {resetTarget && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm grid place-items-center p-4" onClick={() => !resetBusy && setResetTarget(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-2xl border border-destructive/40 bg-card p-5 space-y-4">
            <h3 className="font-display text-lg text-destructive flex items-center gap-2"><Trash2 className="h-5 w-5" /> Zerar dados do usuário</h3>
            <p className="text-sm text-muted-foreground">
              Esta ação removerá <b>todo o histórico financeiro e operacional</b> de
              <b className="text-foreground"> {resetTarget.name || resetTarget.email || resetTarget.id}</b>.
              Cadastro, login, plano e assinatura serão mantidos.
            </p>
            <label className="flex items-start gap-2 text-xs">
              <input type="checkbox" checked={resetConfirm1} onChange={(e) => setResetConfirm1(e.target.checked)} className="mt-0.5" />
              <span>Entendo que esta ação é <b>irreversível</b>.</span>
            </label>
            <div>
              <p className="text-xs mb-1">Digite <b className="text-destructive">CONFIRMAR</b> para concluir:</p>
              <input value={resetConfirm2} onChange={(e) => setResetConfirm2(e.target.value)} placeholder="CONFIRMAR" className="w-full bg-input rounded-lg px-3 py-2 text-sm" />
            </div>
            <div className="flex gap-2">
              <button
                disabled={!resetConfirm1 || resetConfirm2.trim().toUpperCase() !== "CONFIRMAR" || resetBusy}
                onClick={async () => {
                  setResetBusy(true);
                  try {
                    const r: any = await resetFn({ data: { userId: resetTarget.id, confirm: resetConfirm2 } });
                    const total = r?.total ?? 0;
                    setMsg({ kind: "ok", text: `Histórico do usuário zerado (${total} registros).` });
                    setResetTarget(null);
                    qc.invalidateQueries();
                  } catch (e: any) {
                    setMsg({ kind: "err", text: e?.message ?? "Falha ao zerar." });
                  } finally {
                    setResetBusy(false);
                  }
                }}
                className="flex-1 rounded-lg bg-destructive text-destructive-foreground font-medium py-2 text-sm disabled:opacity-50"
              >
                {resetBusy ? "Zerando…" : "Zerar agora"}
              </button>
              <button disabled={resetBusy} onClick={() => setResetTarget(null)} className="rounded-lg border border-border px-4 py-2 text-sm">Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function UserRow({
  u,
  onPromote,
  onDemote,
  onReset,
  busy,
}: {
  u: DebugUserRow;
  onPromote: () => void;
  onDemote: () => void;
  onReset: () => void;
  busy: boolean;
}) {
  return (
    <tr className="border-t border-border/60 hover:bg-card/30">
      <td className="p-3">
        <div className="font-medium">{u.name || "—"}</div>
        <div className="text-[11px] text-muted-foreground font-mono">{u.id}</div>
      </td>
      <td className="p-3">
        <div>{u.email ?? "—"}</div>
        <div className="text-xs text-muted-foreground">{u.phone || "—"}</div>
      </td>
      <td className="p-3">
        <div className="flex flex-wrap gap-1">
          {u.roles.length === 0 && (
            <span className="text-xs text-muted-foreground italic">sem papéis</span>
          )}
          {u.roles.map((r) => (
            <span
              key={r}
              className={`px-2 py-0.5 rounded-full text-[11px] border ${
                r === "admin"
                  ? "border-primary/50 bg-primary/10 text-primary"
                  : "border-border bg-card/60 text-muted-foreground"
              }`}
            >
              {r}
            </span>
          ))}
        </div>
        <div className="text-[11px] text-muted-foreground mt-1">
          is_admin: <span className={u.is_admin ? "text-emerald-400" : "text-muted-foreground"}>{String(u.is_admin)}</span>
        </div>
      </td>
      <td className="p-3">
        <span
          className={`text-xs px-2 py-0.5 rounded-full border ${
            u.blocked_at
              ? "border-destructive/40 bg-destructive/10 text-destructive"
              : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
          }`}
        >
          {u.blocked_at ? "bloqueado" : u.status}
        </span>
        <div className="text-[11px] text-muted-foreground mt-1">
          email_confirmed: {u.email_confirmed_at ? "sim" : "não"}
        </div>
      </td>
      <td className="p-3 text-xs text-muted-foreground">
        {u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleString("pt-BR") : "nunca"}
      </td>
      <td className="p-3 text-right">
        <div className="inline-flex items-center gap-1.5">
          {u.is_admin ? (
            <button
              onClick={onDemote}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background/60 px-3 py-1.5 text-xs hover:border-destructive/40 hover:text-destructive transition-smooth disabled:opacity-50"
            >
              <ShieldOff className="h-3.5 w-3.5" /> Remover admin
            </button>
          ) : (
            <button
              onClick={onPromote}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs text-primary hover:bg-primary/20 transition-smooth disabled:opacity-50"
            >
              <ShieldCheck className="h-3.5 w-3.5" /> Promover a admin
            </button>
          )}
          <button
            onClick={onReset}
            disabled={busy}
            title="Zerar dados do usuário"
            className="inline-flex items-center gap-1.5 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/20 transition-smooth disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" /> Zerar dados
          </button>
        </div>
      </td>
    </tr>
  );
}
