import { describe, it, expect } from "vitest";
import { parseMoneyAmount, normalizeSpokenMoney, detectCentsAmbiguity } from "@/lib/money-speech";

// Casos da auditoria "CORREÇÃO GLOBAL DE INTERPRETAÇÃO DO ABIO" (PARTE 5 e
// TESTE 4) — bug real: "20mil" virava R$201.000,00 porque o tokenizador
// concatenava strings ("20" + "1000") em vez de multiplicar.
describe("parseMoneyAmount — PARTE 5", () => {
  it.each([
    ["20mil", 20000],
    ["20 mil", 20000],
    ["20k", 20000],
    ["vinte mil", 20000],
    ["2 mil", 2000],
    ["2,5 mil", 2500],
    ["1,5k", 1500],
    ["1.200", 1200],
    ["1.200,50", 1200.5],
    ["1200,50", 1200.5],
    ["37,25", 37.25],
    ["37 reais e 25 centavos", 37.25],
  ])("%s -> %d", (input, expected) => {
    expect(parseMoneyAmount(input)).toBeCloseTo(expected, 2);
  });

  // TESTE 4 do pedido original: "20mil" como renda mensal -> 20000, nunca
  // 201000 (bug real observado em produção no onboarding).
  it("nunca concatena dígito solto + 'mil' (bug real: 20mil -> 201000)", () => {
    expect(parseMoneyAmount("20mil")).toBe(20000);
    expect(parseMoneyAmount("Minha renda é 20mil")).toBe(20000);
  });

  it("retorna null para texto sem valor monetário", () => {
    expect(parseMoneyAmount("oi tudo bem")).toBeNull();
    expect(parseMoneyAmount("")).toBeNull();
  });
});

// TESTE 2 do pedido original.
describe("normalizeSpokenMoney — reais e centavos", () => {
  it("funde 'X reais e Y centavos' num único decimal", () => {
    expect(normalizeSpokenMoney("gastei 37 reais e 25 centavos no mercado")).toContain("37,25");
  });

  it("não funde dois valores reais independentes", () => {
    // "37 reais no sorvete e 25 reais no lanche" — dois gastos, não 37,25.
    const out = normalizeSpokenMoney("37 reais no sorvete e 25 reais no lanche");
    expect(out).not.toContain("37,25");
  });
});

describe("detectCentsAmbiguity", () => {
  it("sinaliza ambiguidade real ('37 e 25' sem reais/centavos)", () => {
    const r = detectCentsAmbiguity("paguei 37 e 25 no sorvete");
    expect(r).toEqual({ whole: 37, cents: 25 });
  });

  it("não sinaliza quando a construção já é explícita", () => {
    expect(detectCentsAmbiguity("paguei 37 reais e 25 centavos")).toBeNull();
  });
});
