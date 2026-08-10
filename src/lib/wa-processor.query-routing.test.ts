import { describe, it, expect } from "vitest";
import { detectModuleQueryIntent, detectPeriodFromTextLocal } from "@/lib/wa-processor.server";

// TESTE 5 do pedido original — bug real: "Qual minha renda mensal?" caía em
// query_summary/buildReport ("nenhuma movimentação registrada") porque
// renda mensal cadastrada é dado de PERFIL, não transação. Fase 6 adicionou
// uma guarda determinística (mesmo padrão já usado pra hábitos/metas/
// dívidas/parcelamentos neste roteador).
describe("detectModuleQueryIntent — query_profile (Fase 6)", () => {
  it("'Qual minha renda mensal?' roteia pra query_profile, não pra transação", () => {
    const r = detectModuleQueryIntent("Qual minha renda mensal?");
    expect(r).toEqual({ kind: "query_profile", profile_field: "income" });
  });

  it("'Quanto eu ganho?' também roteia pra perfil", () => {
    const r = detectModuleQueryIntent("Quanto eu ganho?");
    expect(r?.kind).toBe("query_profile");
  });

  it("'Minha renda é 20 mil' (com valor) NÃO é query — vai pra IA (update_profile)", () => {
    const r = detectModuleQueryIntent("Minha renda é 20 mil");
    expect(r?.kind).not.toBe("query_profile");
  });

  it("'Quanto recebi esse mês?' continua sendo consulta de MOVIMENTAÇÃO, não de perfil", () => {
    const r = detectModuleQueryIntent("Quanto recebi esse mês?");
    expect(r?.kind).not.toBe("query_profile");
  });
});

// Regressão do bug original desta sessão (root cause do "ai_meta.ms:0"):
// criação de parcelamento/dívida/meta/hábito com valor numérico não pode
// ser interceptada como consulta antes de chegar na IA.
describe("detectModuleQueryIntent — criação não é engolida como consulta", () => {
  it("uma CRIAÇÃO de parcelamento (com valor) não vira query_installments", () => {
    const r = detectModuleQueryIntent("Compra parcelada, 10 parcelas de 1000 reais no cartão");
    expect(r?.kind).not.toBe("query_installments");
  });

  it("uma CONSULTA pura de parcelamentos (sem valor) continua funcionando", () => {
    const r = detectModuleQueryIntent("Quais são minhas compras parceladas?");
    expect(r?.kind).toBe("query_installments");
  });
});

describe("detectPeriodFromTextLocal — abreviação de mês (bônus da Fase 2)", () => {
  it("reconhece mês abreviado ('em jan'), que antes não existia neste detector", () => {
    const r = detectPeriodFromTextLocal("quanto gastei em jan");
    expect(r).not.toBeNull();
  });

  it("'mês atual' sem período explícito não força nenhum range especial", () => {
    expect(detectPeriodFromTextLocal("quanto gastei")).toBeNull();
  });
});
