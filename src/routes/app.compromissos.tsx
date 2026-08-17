import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { listAppointments, createAppointment, updateAppointment, deleteAppointment } from "@/lib/brinzap.functions";
import { supabase } from "@/integrations/supabase/client";
import { Bell, MessageCircle, Loader2, Plus, Pencil, Trash2, Check, X, CalendarClock } from "lucide-react";
import { MobileFormModal, MobileField, MobileFieldRow } from "@/components/brinzap/MobileFormModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

export const Route = createFileRoute("/app/compromissos")({
  component: Page,
});

const CATEGORIES = ["Compromisso", "Tarefa", "Evento", "Reunião", "Consulta", "Pagamento", "Aniversário", "Lembrete"];
const PRIORITIES = ["Baixa", "Média", "Alta"];

type Appt = {
  id: string;
  title: string;
  notes: string | null;
  scheduled_at: string;
  source: string;
  status?: string | null;
  category?: string | null;
  priority?: string | null;
};

const pad = (n: number) => String(n).padStart(2, "0");
function toLocalParts(iso?: string) {
  const d = iso ? new Date(iso) : new Date();
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

const emptyForm = () => ({
  id: "" as string,
  title: "",
  description: "",
  ...toLocalParts(),
  category: "Compromisso",
  priority: "Média",
});

function Page() {
  const qc = useQueryClient();
  const fetchAppointments = useServerFn(listAppointments);
  const createFn = useServerFn(createAppointment);
  const updateFn = useServerFn(updateAppointment);
  const deleteFn = useServerFn(deleteAppointment);

  const { data: appointments = [], isLoading } = useQuery<Appt[]>({
    queryKey: ["appointments"],
    queryFn: () => fetchAppointments() as any,
  });

  // Realtime: qualquer lembrete criado no WhatsApp / outro dispositivo aparece na hora.
  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getUser();
      const uid = data.user?.id;
      if (!uid || cancelled) return;
      channel = supabase
        .channel(`appointments-live-${uid}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "appointments", filter: `user_id=eq.${uid}` },
          () => {
            qc.invalidateQueries({ queryKey: ["appointments"] });
            qc.invalidateQueries({ queryKey: ["dashboard-stats-v2"] });
            qc.invalidateQueries({ queryKey: ["home-stats"] });
            qc.invalidateQueries({ queryKey: ["calendar-month"] });
          },
        )
        .subscribe();
    })();
    return () => { cancelled = true; if (channel) supabase.removeChannel(channel); };
  }, [qc]);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const isEditing = Boolean(form.id);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["appointments"] });
    qc.invalidateQueries({ queryKey: ["dashboard-stats-v2"] });
    qc.invalidateQueries({ queryKey: ["home-stats"] });
    qc.invalidateQueries({ queryKey: ["calendar-month"] });
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!form.title.trim()) throw new Error("Informe um título.");
      if (!form.date || !form.time) throw new Error("Informe data e hora.");
      const when = new Date(`${form.date}T${form.time}:00`);
      if (isNaN(when.getTime())) throw new Error("Data/hora inválida.");
      const payload = {
        title: form.title.trim(),
        notes: form.description.trim() || undefined,
        scheduled_at: when.toISOString(),
        category: form.category,
        priority: form.priority,
      };
      if (isEditing) return await (updateFn as any)({ data: { id: form.id, ...payload, notes: payload.notes ?? null } });
      return await (createFn as any)({ data: payload });
    },
    onSuccess: () => {
      toast.success(isEditing ? "Lembrete atualizado" : "Lembrete criado com sucesso");
      invalidate();
      setOpen(false);
      setForm(emptyForm());
    },
    onError: (e: any) => toast.error(e?.message ?? "Falha ao salvar"),
  });

  const setStatus = useMutation({
    mutationFn: async (v: { id: string; status: "pending" | "done" | "cancelled" }) =>
      await (updateFn as any)({ data: v }),
    onSuccess: () => { toast.success("Lembrete atualizado"); invalidate(); },
    onError: (e: any) => toast.error(e?.message ?? "Falha ao atualizar"),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => await (deleteFn as any)({ data: { id } }),
    onSuccess: () => { toast.success("Lembrete excluído"); invalidate(); },
    onError: (e: any) => toast.error(e?.message ?? "Falha ao excluir"),
  });

  const openNew = () => { setForm(emptyForm()); setOpen(true); };
  const openEdit = (a: Appt) => {
    const p = toLocalParts(a.scheduled_at);
    setForm({
      id: a.id,
      title: a.title ?? "",
      description: a.notes ?? "",
      date: p.date,
      time: p.time,
      category: a.category ?? "Compromisso",
      priority: a.priority ?? "Média",
    });
    setOpen(true);
  };

  const sorted = useMemo(
    () => [...appointments].sort((a, b) => String(a.scheduled_at).localeCompare(String(b.scheduled_at))),
    [appointments],
  );

  const [view, setView] = useState<"pending" | "done">("pending");
  const pendingList = useMemo(() => sorted.filter((a) => (a.status ?? "pending") === "pending"), [sorted]);
  const doneList = useMemo(() => sorted.filter((a) => (a.status ?? "pending") !== "pending"), [sorted]);
  const visible = view === "pending" ? pendingList : doneList;

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-28 lg:pb-6">
      <header className="flex items-center gap-4">
        <div className="h-14 w-14 grid place-items-center rounded-2xl border border-border bg-card/60">
          <Bell className="h-6 w-6 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="font-display text-2xl sm:text-3xl">Lembretes & Compromissos</h1>
          <p className="text-sm text-muted-foreground">Sincronizado em tempo real com o WhatsApp.</p>
        </div>
        <Button onClick={openNew} className="hidden sm:inline-flex gap-2 bg-neon text-neon-foreground hover:bg-neon/90">
          <Plus className="h-4 w-4" /> Novo lembrete
        </Button>
      </header>

      <div className="flex gap-2">
        <button
          onClick={() => setView("pending")}
          className={`flex-1 sm:flex-none rounded-xl border px-4 py-2 text-sm font-medium transition-smooth ${view === "pending" ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-background/40"}`}
        >
          Pendentes {pendingList.length > 0 ? `(${pendingList.length})` : ""}
        </button>
        <button
          onClick={() => setView("done")}
          className={`flex-1 sm:flex-none rounded-xl border px-4 py-2 text-sm font-medium transition-smooth ${view === "done" ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-background/40"}`}
        >
          Concluídos {doneList.length > 0 ? `(${doneList.length})` : ""}
        </button>
      </div>

      <div className="rounded-3xl border border-border bg-card/60 backdrop-blur-xl divide-y divide-border">
        {isLoading && (
          <div className="p-10 text-center text-sm text-muted-foreground inline-flex items-center justify-center gap-2 w-full">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando lembretes...
          </div>
        )}
        {!isLoading && visible.map((a) => {
          const scheduledAt = String(a.scheduled_at ?? "");
          const when = scheduledAt ? new Date(scheduledAt) : null;
          const status = a.status ?? "pending";
          return (
            <div key={a.id} className="flex flex-wrap items-center gap-3 p-4 sm:p-5">
              <div className="h-12 w-12 grid place-items-center rounded-2xl bg-background/40 text-center shrink-0">
                <div>
                  <p className="text-[10px] uppercase text-muted-foreground leading-none">
                    {when ? when.toLocaleDateString("pt-BR", { month: "short" }) : "—"}
                  </p>
                  <p className="font-display text-lg leading-none">{when ? pad(when.getDate()) : "—"}</p>
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <p className={`font-medium truncate ${status !== "pending" ? "line-through text-muted-foreground" : ""}`}>
                  {a.title}
                </p>
                <p className="text-xs text-muted-foreground flex flex-wrap items-center gap-2 mt-0.5">
                  <CalendarClock className="h-3 w-3 text-primary" />
                  {when ? when.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
                  {a.category ? <span>· {a.category}</span> : null}
                  {status === "done" && <span className="text-neon">· Concluído</span>}
                  {status === "cancelled" && <span className="text-destructive">· Cancelado</span>}
                  {a.source === "whatsapp" && (
                    <span className="text-primary inline-flex items-center gap-1"><MessageCircle className="h-3 w-3" /> WhatsApp</span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-1 ml-auto">
                {status !== "done" && (
                  <Button size="icon" variant="ghost" title="Concluir" onClick={() => setStatus.mutate({ id: a.id, status: "done" })}>
                    <Check className="h-4 w-4 text-neon" />
                  </Button>
                )}
                {status !== "cancelled" && (
                  <Button size="icon" variant="ghost" title="Cancelar" onClick={() => setStatus.mutate({ id: a.id, status: "cancelled" })}>
                    <X className="h-4 w-4" />
                  </Button>
                )}
                {status !== "pending" && (
                  <Button size="icon" variant="ghost" title="Reabrir" onClick={() => setStatus.mutate({ id: a.id, status: "pending" })}>
                    <Bell className="h-4 w-4" />
                  </Button>
                )}
                <Button size="icon" variant="ghost" title="Editar / reagendar" onClick={() => openEdit(a)}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" title="Excluir" onClick={() => { if (confirm("Excluir este lembrete?")) remove.mutate(a.id); }}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>
          );
        })}
        {!isLoading && visible.length === 0 && view === "pending" && (
          <div className="p-10 text-center text-sm text-muted-foreground">
            Nenhum lembrete pendente. Toque em <b>Novo lembrete</b> para adicionar.
          </div>
        )}
        {!isLoading && visible.length === 0 && view === "done" && (
          <div className="p-10 text-center text-sm text-muted-foreground">
            Nenhum lembrete concluído ou cancelado ainda.
          </div>
        )}
      </div>

      <button
        onClick={openNew}
        aria-label="Novo lembrete"
        className="sm:hidden fixed right-4 bottom-[calc(6rem+env(safe-area-inset-bottom))] z-30 h-14 w-14 rounded-full bg-neon text-neon-foreground shadow-[0_10px_30px_-6px_var(--neon)] grid place-items-center active:scale-95 transition-transform"
      >
        <Plus className="h-7 w-7" strokeWidth={2.5} />
      </button>

      <MobileFormModal
        open={open}
        onOpenChange={(o) => { setOpen(o); if (!o) setForm(emptyForm()); }}
        title={isEditing ? "Editar lembrete" : "Novo lembrete"}
        description="Você receberá alertas no WhatsApp antes do horário."
        submitLabel={isEditing ? "Salvar alterações" : "Criar lembrete"}
        submitting={save.isPending}
        onSubmit={() => save.mutate()}
      >
        <MobileField label="Título" htmlFor="lb-title">
          <Input id="lb-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Ex: Consulta com o dentista" />
        </MobileField>

        <MobileField label="Descrição (opcional)" htmlFor="lb-desc">
          <Textarea id="lb-desc" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Detalhes, local, observações..." />
        </MobileField>

        <MobileFieldRow>
          <MobileField label="Data" htmlFor="lb-date">
            <Input id="lb-date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </MobileField>
          <MobileField label="Hora" htmlFor="lb-time">
            <Input id="lb-time" type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} />
          </MobileField>
        </MobileFieldRow>

        <MobileFieldRow>
          <MobileField label="Categoria">
            <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </MobileField>
          <MobileField label="Prioridade">
            <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PRIORITIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </MobileField>
        </MobileFieldRow>
      </MobileFormModal>

    </div>
  );
}
