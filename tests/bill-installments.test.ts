// Testes das funções PURAS de contas fixas com prazo / parcelamentos
// (src/lib/bill-installments.ts).
//
// IMPORTANTE — mesma ressalva do tests/money-speech.test.ts: escrito por
// rastreamento manual do código, sem execução (sem Node/Bun/npm neste
// ambiente). Rode `bunx vitest run tests/bill-installments.test.ts`
// localmente antes de confiar nisso como rede de regressão.

import { describe, it, expect } from "vitest";
import {
  parseTotalInstallments,
  parsePaidInstallments,
  parsePaymentDay,
  parseCorrectedAmount,
  parseBillFollowUp,
} from "@/lib/bill-installments";

describe("parseTotalInstallments", () => {
  it("reconhece contagem em várias formas", () => {
    expect(parseTotalInstallments("220 parcelas")).toBe(220);
    expect(parseTotalInstallments("em 10 vezes")).toBe(10);
    expect(parseTotalInstallments("10x")).toBe(10);
    expect(parseTotalInstallments("parcelado em 12 vezes")).toBe(12);
    expect(parseTotalInstallments("total de 6 mensalidades")).toBe(6);
  });

  it("não confunde o total com o valor monetário quando os dois aparecem na mesma frase", () => {
    // "3 mil" -> 3000 pelo normalizador de valores, mas isso não é seguido
    // de "parcelas/vezes/x", então não é candidato a total de parcelas; "10
    // vezes" é quem tem o marcador de contagem.
    expect(parseTotalInstallments("Parcele 3 mil em 10 vezes")).toBe(10);
  });

  it("ignora a quantidade PAGA ao procurar o total", () => {
    // "já paguei 10 parcelas" não deve virar o total; só "220" com "parcelas"
    // logo depois conta.
    expect(parseTotalInstallments("já paguei 10 parcelas, são 220 parcelas")).toBe(220);
  });

  it("fora da faixa plausível (2 a 2000) retorna null", () => {
    expect(parseTotalInstallments("1 parcela")).toBeNull();
    expect(parseTotalInstallments("sem número nenhum aqui")).toBeNull();
  });
});

describe("parsePaidInstallments", () => {
  it("'já paguei N'", () => {
    expect(parsePaidInstallments("já paguei 10", 220)).toBe(10);
    expect(parsePaidInstallments("já paguei 1", 220)).toBe(1);
  });

  it("'parcela N de TOTAL' — a parcela atual implica N-1 já pagas", () => {
    expect(parsePaidInstallments("parcela 12 de 220", 220)).toBe(11);
  });

  it("'faltam N' calcula a partir do total conhecido", () => {
    expect(parsePaidInstallments("faltam 210", 220)).toBe(10);
  });

  it("nunca extrapola o total (clamp)", () => {
    expect(parsePaidInstallments("já paguei 300", 220)).toBe(220);
  });

  it("sem nenhum padrão reconhecido, retorna null (não adivinha)", () => {
    expect(parsePaidInstallments("estou pagando certinho", 220)).toBeNull();
  });
});

describe("parsePaymentDay", () => {
  it("reconhece 'todo dia X' e 'vence dia X'", () => {
    expect(parsePaymentDay("todo dia 15")).toBe(15);
    expect(parsePaymentDay("vence dia 10")).toBe(10);
    expect(parsePaymentDay("vencimento dia 5")).toBe(5);
  });

  it("dia fora de 1-31 é rejeitado", () => {
    expect(parsePaymentDay("todo dia 35")).toBeNull();
  });
});

describe("parseCorrectedAmount — valor com VERBO explícito (nunca número solto)", () => {
  it("verbos de correção de erro", () => {
    expect(parseCorrectedAmount("corrige pra 850")).toBe(850);
    expect(parseCorrectedAmount("na verdade é 90")).toBe(90);
    expect(parseCorrectedAmount("muda o valor pra 1200")).toBe(1200);
    expect(parseCorrectedAmount("troca o valor pra 500")).toBe(500);
    expect(parseCorrectedAmount("valor certo é 850")).toBe(850);
  });

  it("verbos de mudança real de valor (reajuste)", () => {
    expect(parseCorrectedAmount("aluguel aumentou pra 1300")).toBe(1300);
    expect(parseCorrectedAmount("netflix agora custa 59,90")).toBe(59.9);
    expect(parseCorrectedAmount("internet subiu pra 130")).toBe(130);
  });

  it("um valor solto, sem verbo de correção, NÃO é interpretado (ambíguo com lançamento novo)", () => {
    expect(parseCorrectedAmount("gastei 850 no mercado")).toBeNull();
    expect(parseCorrectedAmount("850")).toBeNull();
  });
});

describe("parseBillFollowUp — combina vários campos de uma mensagem complementar", () => {
  it("total + pagas + dia de vencimento juntos", () => {
    const patch = parseBillFollowUp("220 parcelas, já paguei 10, vence dia 15");
    expect(patch).toEqual({ total_installments: 220, paid_installments: 10, payment_day: 15 });
  });

  it("correção de valor sozinha", () => {
    expect(parseBillFollowUp("aluguel aumentou pra 1300")).toEqual({ amount: 1300 });
  });

  it("mensagem sem nenhum campo reconhecível retorna null", () => {
    expect(parseBillFollowUp("beleza, valeu")).toBeNull();
  });
});
