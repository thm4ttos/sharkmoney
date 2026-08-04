import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { adminUsers, appointments, statusClasses, statusLabel, transactions, whatsappMessages, type SubStatus } from "@/lib/admin-mock";
import { ArrowLeft, Check, CheckCheck, Edit3, Mic, Save, Trash2, X } from "lucide-react";

export const Route = createFileRoute("/admin/users/$userId")({
  component: UserDetail,
});

function UserDetail() {
  const { userId } = Route.useParams();
  const navigate = useNavigate();
  const user = adminUsers.find((u) => u.id === userId);
  const [tab, setTab] = useState<"transactions" | "appointments" | "whatsapp">("transactions");

  // editable copies (mock)
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(user ? { name: user.name, email: user.email, whatsapp: user.whatsapp, plan: user.plan, status: user.status } : null);

  const [txs, setTxs] = useState(transactions.filter((t) => t.userId === userId));
  const [editingTx, setEditingTx] = useState<string | null>(null);

  if (!user || !draft) {
    return (
      <div className="text-center py-20">
        <p className="text-muted-foreground">Usuário não encontrado.</p>
        <Link to="/admin/users" className="text-primary text-sm mt-3 inline-block">Voltar</Link>
      </div>
    );
  }

  const userAppointments = appointments.filter((a) => a.userId === userId);
  const userMessages = whatsappMessages.filter((m) => m.userId === userId);

  const save = () => { setEditing(false); /* persist later */ };

  return (
    <div className="space-y-6">
      <button onClick={() => navigate({ to: "/admin/users" })} className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1 transition-smooth">
        <ArrowLeft className="h-4 w-4" /> Voltar
      </button>

      {/* User card */}
      <div className="rounded-2xl border border-border bg-card/60 backdrop-blur-xl p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <div className="h-14 w-14 rounded-full bg-gradient-brand grid place-items-center text-primary-foreground font-semibold text-lg">
              {user.name.split(" ").map((p) => p[0]).slice(0, 2).join("")}
            </div>
            <div>
              {editing ? (
                <input className="bg-input rounded-md px-2 py-1 text-lg font-display" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              ) : (
                <h1 className="font-display text-2xl">{draft.name}</h1>
              )}
              <p className="text-sm text-muted-foreground">Cadastrado em {user.joined}</p>
            </div>
          </div>
          <div className="flex gap-2">
            {editing ? (
              <>
                <button onClick={save} className="inline-flex items-center gap-2 rounded-lg bg-gradient-brand text-primary-foreground px-3 py-2 text-sm glow-neon">
                  <Save className="h-4 w-4" /> Salvar
                </button>
                <button onClick={() => setEditing(false)} className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                  <X className="h-4 w-4" /> Cancelar
                </button>
              </>
            ) : (
              <button onClick={() => setEditing(true)} className="inline-flex items-center gap-2 rounded-lg border border-border bg-card/60 px-3 py-2 text-sm hover:border-primary/40 transition-smooth">
                <Edit3 className="h-4 w-4" /> Editar
              </button>
            )}
          </div>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
          <Field label="Email" value={draft.email} editing={editing} onChange={(v) => setDraft({ ...draft, email: v })} />
          <Field label="WhatsApp" value={draft.whatsapp} editing={editing} onChange={(v) => setDraft({ ...draft, whatsapp: v })} />
          <Field label="Plano" value={draft.plan} editing={editing} onChange={(v) => setDraft({ ...draft, plan: v })} />
          <div>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Status</p>
            {editing ? (
              <select
                value={draft.status}
                onChange={(e) => setDraft({ ...draft, status: e.target.value as SubStatus })}
                className="bg-input rounded-md px-2 py-1.5 text-sm w-full"
              >
                <option value="active">Ativo</option>
                <option value="trial">Teste</option>
                <option value="canceled">Cancelado</option>
              </select>
            ) : (
              <span className={`text-xs px-2 py-1 rounded-full inline-block ${statusClasses[draft.status]}`}>
                {statusLabel[draft.status]}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl border border-border bg-card/60 p-1 w-fit">
        {[
          { id: "transactions" as const, label: `Transações (${txs.length})` },
          { id: "appointments" as const, label: `Compromissos (${userAppointments.length})` },
          { id: "whatsapp" as const, label: `WhatsApp (${userMessages.length})` },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={[
              "px-4 py-1.5 text-sm rounded-lg transition-smooth",
              tab === t.id ? "bg-gradient-brand text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            ].join(" ")}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {tab === "transactions" && (
        <div className="rounded-2xl border border-border bg-card/60 backdrop-blur-xl overflow-hidden">
          <div className="grid grid-cols-12 px-5 py-3 text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border bg-background/30">
            <div className="col-span-3">Data</div>
            <div className="col-span-4">Descrição</div>
            <div className="col-span-2">Categoria</div>
            <div className="col-span-2 text-right">Valor</div>
            <div className="col-span-1 text-right">Ações</div>
          </div>
          {txs.length === 0 && <div className="p-8 text-center text-sm text-muted-foreground">Sem transações.</div>}
          <div className="divide-y divide-border">
            {txs.map((t) => {
              const isEdit = editingTx === t.id;
              return (
                <div key={t.id} className="grid grid-cols-12 px-5 py-3 items-center text-sm">
                  <div className="col-span-3 text-muted-foreground">{t.date}</div>
                  <div className="col-span-4 flex items-center gap-2">
                    {isEdit ? (
                      <input
                        className="bg-input rounded px-2 py-1 text-sm w-full"
                        value={t.description}
                        onChange={(e) => setTxs(txs.map((x) => x.id === t.id ? { ...x, description: e.target.value } : x))}
                      />
                    ) : (
                      <>
                        <span>{t.description}</span>
                        {t.source === "whatsapp" && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/15 text-primary border border-primary/30">WA</span>
                        )}
                      </>
                    )}
                  </div>
                  <div className="col-span-2 text-muted-foreground">{t.category}</div>
                  <div className={`col-span-2 text-right font-medium ${t.type === "income" ? "text-primary" : "text-foreground"}`}>
                    {t.type === "income" ? "+" : "-"}R$ {t.amount.toFixed(2).replace(".", ",")}
                  </div>
                  <div className="col-span-1 flex justify-end gap-1">
                    {isEdit ? (
                      <button onClick={() => setEditingTx(null)} className="h-7 w-7 grid place-items-center rounded-md hover:bg-primary/15 text-primary">
                        <Save className="h-3.5 w-3.5" />
                      </button>
                    ) : (
                      <button onClick={() => setEditingTx(t.id)} className="h-7 w-7 grid place-items-center rounded-md hover:bg-accent/20 text-muted-foreground hover:text-foreground">
                        <Edit3 className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button onClick={() => setTxs(txs.filter((x) => x.id !== t.id))} className="h-7 w-7 grid place-items-center rounded-md hover:bg-destructive/15 text-muted-foreground hover:text-destructive">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === "appointments" && (
        <div className="grid sm:grid-cols-2 gap-3">
          {userAppointments.map((a) => (
            <div key={a.id} className="rounded-xl p-4 border border-border bg-card/60 hover:border-primary/40 transition-smooth">
              <p className="text-[11px] text-primary">{a.date}</p>
              <p className="text-sm font-medium mt-1">{a.title}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{a.category}</p>
            </div>
          ))}
          {userAppointments.length === 0 && <p className="text-sm text-muted-foreground col-span-2">Sem compromissos.</p>}
        </div>
      )}

      {tab === "whatsapp" && (
        <div className="rounded-2xl border border-border bg-card/60 backdrop-blur-xl p-5 max-w-xl">
          <p className="text-xs text-muted-foreground mb-4">Histórico de mensagens · somente leitura</p>
          <div className="space-y-2">
            {userMessages.map((m) => (
              <div key={m.id} className={`flex ${m.from === "user" ? "justify-end" : "justify-start"}`}>
                <div className={[
                  "max-w-[78%] rounded-2xl px-3 py-2 text-sm",
                  m.from === "user"
                    ? "bg-[oklch(0.32_0.18_138_/_0.85)] rounded-br-sm"
                    : "bg-[oklch(0.28_0.14_305_/_0.7)] rounded-bl-sm",
                ].join(" ")}>
                  {m.audio ? (
                    <span className="flex items-center gap-2">
                      <Mic className="h-4 w-4 text-primary" />
                      <span className="h-1.5 w-28 rounded-full bg-foreground/20" />
                      <span className="text-xs text-muted-foreground">0:06</span>
                    </span>
                  ) : (
                    m.text
                  )}
                  <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-muted-foreground">
                    {m.time}
                    {m.from === "user" ? <CheckCheck className="h-3 w-3 text-primary" /> : <Check className="h-3 w-3" />}
                  </div>
                </div>
              </div>
            ))}
            {userMessages.length === 0 && <p className="text-sm text-muted-foreground">Sem mensagens.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, editing, onChange }: { label: string; value: string; editing: boolean; onChange: (v: string) => void }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">{label}</p>
      {editing ? (
        <input value={value} onChange={(e) => onChange(e.target.value)} className="bg-input rounded-md px-2 py-1.5 text-sm w-full" />
      ) : (
        <p className="text-sm truncate">{value}</p>
      )}
    </div>
  );
}
