import { describe, it, expect } from "vitest";
import { parseExplicitDate, parsePaymentDay, parseCorrectedAmount, parseTotalInstallments, parsePaidInstallments, parseFrequencyFollowUp, parseBillFollowUp } from "@/lib/bill-installments";

// Bug real: "mudar a data... pro dia 10 de dezembro de 2026" virava só
// "dia 10" (mês/ano perdidos) porque só existia parsePaymentDay (dia solto).
describe("parseExplicitDate", () => {
  it("captura dia + mês + ano por extenso", () => {
    expect(parseExplicitDate("dia 10 de dezembro de 2026")).toBe("2026-12-10");
  });

  it("captura DD/MM/AAAA", () => {
    expect(parseExplicitDate("02/01/2027")).toBe("2027-01-02");
  });

  it("sem ano explícito, usa o ano corrente", () => {
    const year = new Date().getFullYear();
    expect(parseExplicitDate("10 de dezembro")).toBe(`${year}-12-10`);
  });

  it("retorna null quando não há data completa (só dia solto)", () => {
    expect(parseExplicitDate("todo dia 10")).toBeNull();
  });
});

describe("parsePaymentDay", () => {
  it("captura o dia solto de vencimento mensal", () => {
    expect(parsePaymentDay("vence todo dia 15")).toBe(15);
    expect(parsePaymentDay("pago dia 10")).toBe(10);
  });
});

describe("parseCorrectedAmount", () => {
  it("exige verbo explícito de correção/mudança — nunca um valor solto", () => {
    expect(parseCorrectedAmount("corrige pra 850")).toBe(850);
    expect(parseCorrectedAmount("na verdade é 90")).toBe(90);
    expect(parseCorrectedAmount("aluguel aumentou pra 1300")).toBe(1300);
    expect(parseCorrectedAmount("netflix ficou em 59,90")).toBe(59.9);
    expect(parseCorrectedAmount("mando 850 pro aluguel")).toBeNull();
  });
});

// Bug real reportado: "Corrigindo é toda semana, nas quinta-feira" não batia
// com nenhum parser de patch (não existia parsing de frequência/dia da
// semana), então a correção caía num interrogatório genérico ou virava um
// compromisso fantasma com o texto da correção como título.
describe("parseFrequencyFollowUp", () => {
  it("'toda quinta-feira' -> weekly, ancorado na próxima quinta (>= hoje)", () => {
    const r = parseFrequencyFollowUp("é toda semana, nas quinta-feira");
    expect(r?.frequency).toBe("weekly");
    expect(r?.next_due_at).toBeTruthy();
    const d = new Date(`${r!.next_due_at}T12:00:00`);
    expect(d.getUTCDay()).toBe(4); // quinta-feira
    expect(d.getTime()).toBeGreaterThanOrEqual(new Date(new Date().toDateString()).getTime());
  });

  it("'todas as sextas' -> weekly, sexta-feira", () => {
    const r = parseFrequencyFollowUp("mudar pra todas as sextas");
    expect(r?.frequency).toBe("weekly");
    const d = new Date(`${r!.next_due_at}T12:00:00`);
    expect(d.getUTCDay()).toBe(5);
  });

  it("'quinzenal' -> biweekly sem data (não sabe o dia)", () => {
    expect(parseFrequencyFollowUp("agora é quinzenal")?.frequency).toBe("biweekly");
  });

  it("'todo ano' -> yearly", () => {
    expect(parseFrequencyFollowUp("passa a ser todo ano")?.frequency).toBe("yearly");
  });

  it("texto sem sinal de frequência -> null", () => {
    expect(parseFrequencyFollowUp("mando 100 pro aluguel")).toBeNull();
  });
});

describe("parseBillFollowUp com frequência", () => {
  it("'Corrigindo é toda semana, nas quinta-feira' produz um patch válido", () => {
    const patch = parseBillFollowUp("Corrigindo é toda semana, nas quinta-feira");
    expect(patch).toBeTruthy();
    expect(patch?.frequency).toBe("weekly");
    expect(patch?.next_due_at).toBeTruthy();
  });
});

describe("parseTotalInstallments / parsePaidInstallments", () => {
  it("PARTE 28 (consórcio): 220 parcelas, 1 já paga", () => {
    const total = parseTotalInstallments("220 parcelas, já paguei 1");
    expect(total).toBe(220);
    expect(parsePaidInstallments("220 parcelas, já paguei 1", total)).toBe(1);
  });
});
