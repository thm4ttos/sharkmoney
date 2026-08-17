import { describe, it, expect } from "vitest";
import { parseSmartFinancialMessage } from "@/lib/brinzap-actions.server";

// Fase 12.4 — item 21: lista mista (contas fixas + parcelamento) precisa
// separar cada estrutura corretamente. Bug real corrigido: a linha de
// parcelamento (formato "Título parcela N/M valor", sem traço) era
// descartada silenciosamente da lista.
describe("Fase 12.4 — lista mista: contas + parcelamento (item 21)", () => {
  it("'Consórcio parcela 3/10 250' isolado -> 1 item installment, não descarta", () => {
    const r = parseSmartFinancialMessage("Consórcio parcela 3/10 250\nInternet 120");
    expect(r?.ok).toBe(true);
    if (r?.ok) {
      const inst = r.items.find((i) => i.kind === "installment");
      expect(inst).toBeTruthy();
      expect((inst as any)?.installments_total).toBe(10);
      expect((inst as any)?.installments_paid).toBe(2);
      expect((inst as any)?.amount).toBe(250);
    }
  });

  it("lista mista completa: 3 contas + 1 parcelamento -> 4 itens, nenhum perdido", () => {
    const msg = "internet 120\nágua 80\nconsórcio parcela 3/10 250\nfaculdade 400";
    const r = parseSmartFinancialMessage(msg);
    expect(r?.ok).toBe(true);
    if (r?.ok) {
      expect(r.items.length).toBe(4);
      const inst = r.items.filter((i) => i.kind === "installment");
      expect(inst.length).toBe(1);
    }
  });

  it("formato antigo 'parcela N/M Título — R$X' continua funcionando (sem regressão)", () => {
    const r = parseSmartFinancialMessage("parcela 7/10 Consórcio Brenna — R$ 100,00\nágua 80");
    expect(r?.ok).toBe(true);
    if (r?.ok) {
      const inst = r.items.find((i) => i.kind === "installment");
      expect((inst as any)?.installments_total).toBe(10);
      expect((inst as any)?.amount).toBe(100);
    }
  });
});

// Item 20/21 — "vence dia N" sozinho já é sinal suficiente de conta fixa,
// sem precisar da palavra "fixa" na frase. Bug real corrigido: sem a
// palavra "fixa" litaral, a lista inteira virava gasto avulso e o dueDay já
// detectado era descartado.
describe("Fase 12.4 — lista espontânea sem a palavra 'fixa' (item 20)", () => {
  it("'todas vencem dia 5: água 56, internet 165, luz 330' -> 3 contas fixas, dia 5", () => {
    const r = parseSmartFinancialMessage("todas vencem dia 5:\nágua 56\ninternet 165\nluz 330");
    expect(r?.ok).toBe(true);
    if (r?.ok) {
      expect(r.items.length).toBe(3);
      for (const it of r.items) expect(it.kind).toBe("bill");
    }
  });

  it("sem menção a 'vence dia N' e sem 'fixa' -> continua gasto avulso (comportamento inalterado)", () => {
    const r = parseSmartFinancialMessage("mercado 80\nfarmácia 45\nuber 23");
    expect(r?.ok).toBe(true);
    if (r?.ok) {
      for (const it of r.items) expect(it.kind).toBe("expense");
    }
  });

  it("'são todas fixas' (sinal explícito antigo) continua funcionando", () => {
    const r = parseSmartFinancialMessage("são todas fixas:\naluguel 900\ninternet 120");
    expect(r?.ok).toBe(true);
    if (r?.ok) {
      for (const it of r.items) expect(it.kind).toBe("bill");
    }
  });
});
