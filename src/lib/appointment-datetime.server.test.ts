import { describe, it, expect } from "vitest";
import { parseFutureDateTimeSP } from "@/lib/appointment-datetime.server";

// TESTE 6 e 7 do pedido original.
describe("parseFutureDateTimeSP", () => {
  it("TESTE 6: 'Cortar cabelo terça feira 17h' tem data E hora completas", () => {
    const r = parseFutureDateTimeSP("Cortar cabelo terça feira 17h");
    expect(r.hasDate).toBe(true);
    expect(r.hasTime).toBe(true);
    expect(r.iso).not.toBeNull();
  });

  it("TESTE 7: 'Cortar cabelo terça' tem SÓ data — falta hora", () => {
    const r = parseFutureDateTimeSP("Cortar cabelo terça");
    expect(r.hasDate).toBe(true);
    expect(r.hasTime).toBe(false);
  });

  it("reconhece abreviação de dia da semana ('ter 17h')", () => {
    const r = parseFutureDateTimeSP("consulta ter 17h");
    expect(r.hasDate).toBe(true);
    expect(r.hasTime).toBe(true);
  });

  it("nunca cria compromisso no passado: dia da semana sempre resolve pra próxima ocorrência", () => {
    // Segunda-feira fixa como base (2026-08-10 é uma segunda-feira).
    const base = new Date("2026-08-10T10:00:00-03:00");
    const r = parseFutureDateTimeSP("segunda 9h", base); // hoje é segunda, mas 9h já passou (base=10h)
    expect(r.iso).not.toBeNull();
    expect(new Date(r.iso!).getTime()).toBeGreaterThan(base.getTime());
  });

  it("data explícita DD/MM tem prioridade e nunca fica no passado sem ano informado", () => {
    const r = parseFutureDateTimeSP("reunião 02/01/2027 15h");
    expect(r.hasDate).toBe(true);
    expect(r.hasTime).toBe(true);
    expect(r.iso).toContain("2027");
  });
});
