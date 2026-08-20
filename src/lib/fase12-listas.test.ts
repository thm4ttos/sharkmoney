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

// Correção crítica — bug real reportado em produção: mensagem com 2 compras
// parceladas em blocos "Título\nN parcelas de R$X (paguei M hoje)" nunca
// virava installment de verdade — a IA misturava os dois itens, inventava
// um valor fantasma de R$1,00 (lido errado de "paguei 1 hoje") e só criava
// uma despesa avulsa genérica. Nenhuma das duas compras aparecia em Compras
// Parceladas.
describe("Fase 12.8 — blocos de compra parcelada com 'paguei N hoje' (correção crítica)", () => {
  it("mensagem real do bug: 2 blocos -> 2 installments, sem item fantasma", () => {
    const msg = "compras parceladas\n\nParcelas do simples\n20 parcelas de R$ 312,43 (paguei 1 hoje)\n\nParcelas atraso do MEI\n8 parcelas de R$ 53,01 (paguei 1 hoje)";
    const r = parseSmartFinancialMessage(msg);
    expect(r?.ok).toBe(true);
    if (r?.ok) {
      expect(r.items.length).toBe(2);
      for (const it of r.items) expect(it.kind).toBe("installment");

      const simples = r.items.find((i: any) => /simples/i.test(i.title));
      expect(simples).toBeTruthy();
      expect((simples as any)?.amount).toBe(312.43);
      expect((simples as any)?.installments_total).toBe(20);
      expect((simples as any)?.paid_today).toBe(1);
      // Nunca existe um item fantasma de R$1,00 (lido errado de "paguei 1 hoje").
      expect((simples as any)?.amount).not.toBe(1);

      const mei = r.items.find((i: any) => /mei/i.test(i.title));
      expect(mei).toBeTruthy();
      expect((mei as any)?.amount).toBe(53.01);
      expect((mei as any)?.installments_total).toBe(8);
      expect((mei as any)?.paid_today).toBe(1);
    }
  });

  it("bloco único sem 'paguei hoje' -> installment sem paid_today", () => {
    const r = parseSmartFinancialMessage("Notebook novo\n10 parcelas de R$ 250,00");
    expect(r?.ok).toBe(true);
    if (r?.ok) {
      expect(r.items.length).toBe(1);
      expect(r.items[0].kind).toBe("installment");
      expect((r.items[0] as any).paid_today).toBeUndefined();
      expect((r.items[0] as any).amount).toBe(250);
    }
  });

  it("mensagem normal de lista de contas continua funcionando (sem regressão)", () => {
    const r = parseSmartFinancialMessage("água 80\nluz 120\ninternet 100");
    expect(r?.ok).toBe(true);
    if (r?.ok) expect(r.items.length).toBe(3);
  });
});
