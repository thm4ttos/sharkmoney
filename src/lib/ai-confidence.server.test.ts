import { describe, it, expect } from "vitest";
import { gateConfidence, CONFIDENCE_HIGH, CONFIDENCE_LOW, CONFIDENCE_FLOOR } from "@/lib/ai-confidence.server";

// PARTE 7 do pedido original — escala real usada pra decidir executar vs.
// perguntar. O prompt da IA (ai-classify.server.ts) foi alinhado pra pedir
// confidence nesta MESMA escala (Fase 3) — este teste fixa o contrato.
describe("gateConfidence", () => {
  it("undefined/null -> execute (override determinístico, sem confidence)", () => {
    expect(gateConfidence(undefined)).toBe("execute");
    expect(gateConfidence(null)).toBe("execute");
  });

  it(`>= ${CONFIDENCE_HIGH} -> execute`, () => {
    expect(gateConfidence(CONFIDENCE_HIGH)).toBe("execute");
    expect(gateConfidence(0.95)).toBe("execute");
  });

  it(`[${CONFIDENCE_LOW}, ${CONFIDENCE_HIGH}) -> execute_and_learn`, () => {
    expect(gateConfidence(CONFIDENCE_LOW)).toBe("execute_and_learn");
    expect(gateConfidence(0.6)).toBe("execute_and_learn");
  });

  it(`[${CONFIDENCE_FLOOR}, ${CONFIDENCE_LOW}) -> ask`, () => {
    expect(gateConfidence(CONFIDENCE_FLOOR)).toBe("ask");
    expect(gateConfidence(0.4)).toBe("ask");
  });

  it(`< ${CONFIDENCE_FLOOR} -> menu (nunca executa)`, () => {
    expect(gateConfidence(0.1)).toBe("menu");
    expect(gateConfidence(0)).toBe("menu");
  });
});
