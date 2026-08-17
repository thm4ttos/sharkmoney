import { describe, it, expect } from "vitest";
import { detectCustomReminderLeadMinutes } from "@/lib/appointment-nlp.server";

// Correção urgente: "me avisar com 30 minutos de antecedência" (por texto OU
// áudio transcrito) precisa ser entendido como pedido de lembrete
// customizado, não virar ruído/lixo no título do compromisso.
describe("detectCustomReminderLeadMinutes", () => {
  it("'Me avisar com 30 minutos antecedência cada' -> 30 minutos (caso real do bug)", () => {
    const r = detectCustomReminderLeadMinutes("Me avisar com 30 minutos antecedência cada");
    expect(r?.leadMinutes).toBe(30);
  });

  it("'me avisar com 30 minutos de antecedência' (com 'de') -> 30 minutos", () => {
    const r = detectCustomReminderLeadMinutes("me avisar com 30 minutos de antecedência");
    expect(r?.leadMinutes).toBe(30);
  });

  it("'avisar 2 horas antes' -> 120 minutos", () => {
    const r = detectCustomReminderLeadMinutes("Dentista amanhã 14h, avisar 2 horas antes");
    expect(r?.leadMinutes).toBe(120);
  });

  it("'me avise 15 minutos antes' -> 15 minutos", () => {
    const r = detectCustomReminderLeadMinutes("me avise 15 minutos antes por favor");
    expect(r?.leadMinutes).toBe(15);
  });

  it("'lembrar 1 dia antes' -> 1440 minutos", () => {
    const r = detectCustomReminderLeadMinutes("Reunião importante, lembrar 1 dia antes");
    expect(r?.leadMinutes).toBe(1440);
  });

  it("mensagem normal sem pedido de lembrete -> null", () => {
    expect(detectCustomReminderLeadMinutes("Dentista amanhã às 14h")).toBeNull();
  });

  it("'reunião em 2 horas' (hora do próprio compromisso, não pedido de aviso) -> null", () => {
    expect(detectCustomReminderLeadMinutes("Reunião em 2 horas")).toBeNull();
  });
});
