// Detalhe de auditoria de UMA transação — somente leitura.
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getTransactionOrigin } from "@/lib/audit.functions";
import { Loader2, ShieldCheck } from "lucide-react";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex items-start justify-between gap-3 py-2 border-b border-border/60 last:border-0">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground shrink-0">{label}</span>
      <span className="text-xs text-right break-all">{value}</span>
    </div>
  );
}

export function AuditDetails({ id, actions }: { id: string; actions?: (data: any) => React.ReactNode }) {
  const fetchOrigin = useServerFn(getTransactionOrigin);
  const { data, isLoading, error } = useQuery({
    queryKey: ["tx-origin", id],
    queryFn: () => fetchOrigin({ data: { id } }) as any,
  });


  if (isLoading) {
    return (
      <div className="py-8 grid place-items-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }
  if (error || !data) {
    return <p className="text-xs text-destructive">Não foi possível carregar a auditoria desta transação.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2">
        <ShieldCheck className="h-4 w-4 text-primary shrink-0" />
        <p className="text-xs">
          Este lançamento existe na tabela oficial de transações e compõe o saldo com origem rastreável.
        </p>
      </div>
      <div className="rounded-xl border border-border bg-background/30 px-3 py-1">
        <Row label="ID" value={data.id} />
        <Row label="Origem" value={data.origin} />
        <Row label="Canal" value={data.channel} />
        <Row label="Tipo" value={data.kind === "income" ? "Receita" : "Despesa"} />
        <Row label="Valor" value={`R$ ${Number(data.amount).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`} />
        <Row label="Categoria" value={data.category} />
        <Row label="Descrição" value={data.description} />
        <Row label="Data do lançamento" value={data.occurredAt} />
        <Row label="Registrado em" value={data.createdAt} />
        <Row label="Identificador da operação" value={data.operationId} />
        <Row label="Mensagem original (WhatsApp)" value={data.rawMessageId} />
        <Row label="Conta fixa vinculada" value={data.linkedBill} />
        <Row
          label="Pagamento da conta fixa"
          value={
            data.billPayment
              ? `R$ ${Number(data.billPayment.amount).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}${data.billPayment.cycle ? ` • ciclo ${data.billPayment.cycle}` : ""} • ${data.billPayment.full ? "quitação" : "parcial"}`
              : null
          }
        />
        <Row label="Compra parcelada" value={data.linkedInstallment} />
        <Row label="Lote de importação" value={data.importBatchId} />
        <Row label="Fonte técnica" value={`${data.source}${data.sourceType ? ` / ${data.sourceType}` : ""}`} />
      </div>
      {actions ? <div className="pt-1">{actions(data)}</div> : null}
    </div>
  );
}

