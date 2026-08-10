import { describe, it, expect } from "vitest";
import { MONTHS_PT, WEEKDAYS_PT, WEEKDAY_NAME_PATTERN, normalizeWeekdayKey } from "@/lib/temporal-vocab";

// PARTE 9 do pedido original: reconhecer segunda/segunda-feira/segunda feira/
// seg, e o mesmo padrão pros outros dias. Bug real: o parser de compromissos
// (appointment-datetime.server.ts) não reconhecia abreviações antes desta
// correção — só o nome completo, com ou sem "-feira".
// Os parsers reais (datetime.ts, appointment-datetime.server.ts) sempre
// removem acento ANTES de casar contra WEEKDAY_NAME_PATTERN — o padrão em
// si só conhece as formas sem acento ("terca", não "terça").
function strip(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

describe("WEEKDAY_NAME_PATTERN + normalizeWeekdayKey", () => {
  const re = new RegExp(`\\b(${WEEKDAY_NAME_PATTERN})\\b`, "i");

  it.each([
    ["segunda", 1], ["segunda-feira", 1], ["segunda feira", 1], ["seg", 1],
    ["terca", 2], ["terca-feira", 2], ["ter", 2],
    ["quarta", 3], ["qua", 3],
    ["quinta", 4], ["qui", 4],
    ["sexta", 5], ["sexta-feira", 5], ["sex", 5],
    ["sabado", 6], ["sab", 6],
    ["domingo", 0], ["dom", 0],
  ])("reconhece '%s' como dia %d", (raw, expected) => {
    const m = raw.match(re);
    expect(m).not.toBeNull();
    const key = normalizeWeekdayKey(m![1]);
    expect(WEEKDAYS_PT[key]).toBe(expected);
  });

  it("reconhece dentro de uma frase real", () => {
    const m = "cortar cabelo terça feira 17h".match(re);
    expect(m).not.toBeNull();
    expect(WEEKDAYS_PT[normalizeWeekdayKey(m![1])]).toBe(2);
  });
});

describe("MONTHS_PT", () => {
  it("aceita nome completo e abreviação de 3 letras", () => {
    expect(MONTHS_PT["dezembro"]).toBe(12);
    expect(MONTHS_PT["dez"]).toBe(12);
    expect(MONTHS_PT["marco"]).toBe(3);
    expect(MONTHS_PT["mar"]).toBe(3);
  });
});
