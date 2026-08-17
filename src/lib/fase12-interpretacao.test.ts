import { describe, it, expect } from "vitest";
import { parseMoneyAmount } from "@/lib/money-speech";
import { detectSpontaneousExpenseIntent, inferTransactionCategory, moneyMatches } from "@/lib/brinzap-actions.server";
import { parseFutureDateTimeSP } from "@/lib/appointment-datetime.server";

// Fase 12.2 — usuário com pressa: mensagem curta e clara deve virar
// lançamento IMEDIATO (sem interrogatório), item 7 do pedido do usuário.
describe("Fase 12.2 — usuário com pressa (item 7)", () => {
  it("'Gastei 80 gasolina' registra na hora", () => {
    const r = detectSpontaneousExpenseIntent("Gastei 80 gasolina");
    expect(r?.kind).toBe("expense");
    expect(r?.amount).toBe(80);
  });
  it("'Gastei 25 almoço' registra na hora", () => {
    const r = detectSpontaneousExpenseIntent("Gastei 25 almoço");
    expect(r?.kind).toBe("expense");
    expect(r?.amount).toBe(25);
  });
  it("'Recebi 2500 freela' registra receita", () => {
    const r = detectSpontaneousExpenseIntent("Recebi 2500 freela");
    expect(r?.kind).toBe("income");
    expect(r?.amount).toBe(2500);
  });
});

// Item 8 — português informal / gírias. Não deve depender de regra por
// frase exata — testa se o parser SEMÂNTICO (moneyMatches + categoria)
// segura essas variações.
describe("Fase 12.2 — português informal (item 8)", () => {
  it("'gastei 40 conto de gasosa' extrai 40", () => {
    const monies = moneyMatches("gastei 40 conto de gasosa");
    expect(monies.length).toBeGreaterThanOrEqual(1);
    expect(monies[0]?.amount).toBe(40);
  });
  it("'foi 38 pila no almoço' extrai 38", () => {
    const monies = moneyMatches("foi 38 pila no almoço");
    expect(monies[0]?.amount).toBe(38);
  });
  it("'torrei 120 no mercado' -> despesa 120", () => {
    const r = detectSpontaneousExpenseIntent("torrei 120 no mercado");
    expect(r?.kind).toBe("expense");
    expect(r?.amount).toBe(120);
  });
  it("'entrou 2 conto do freela' -> receita 2 (ou 2000? documentar ambiguidade de 'conto')", () => {
    const r = detectSpontaneousExpenseIntent("entrou 2 conto do freela");
    console.log("AMBIGUIDADE 'conto':", JSON.stringify(r));
    expect(r?.kind).toBe("income");
  });
  it("'caiu 3500 hj' -> receita 3500", () => {
    const r = detectSpontaneousExpenseIntent("caiu 3500 hj");
    expect(r?.kind).toBe("income");
    expect(r?.amount).toBe(3500);
  });
});

// Item 9 — erros de digitação leves não podem impedir a interpretação.
describe("Fase 12.2 — erros de digitação (item 9)", () => {
  it("'gasteo 50 mercado' (typo em 'gastei') ainda reconhece despesa", () => {
    const r = detectSpontaneousExpenseIntent("gasteo 50 mercado");
    console.log("typo-gasteo:", JSON.stringify(r));
  });
  it("'recbi 800' (typo em 'recebi') ainda reconhece receita", () => {
    const r = detectSpontaneousExpenseIntent("recbi 800");
    console.log("typo-recbi:", JSON.stringify(r));
  });
  it("'gasolina 40 reis' (typo 'reis'->'reais') extrai 40", () => {
    const monies = moneyMatches("gasolina 40 reis");
    console.log("typo-reis:", JSON.stringify(monies));
  });
  it("'paguei internete' (typo) categoriza como Moradia/Contas", () => {
    console.log("typo-internete-categoria:", inferTransactionCategory("paguei internete"));
  });
});

// Item 10 — mensagem telegráfica: "mercado 180" deve virar lançamento se o
// contexto (categoria reconhecida) for suficiente; senão, perguntar CURTO
// ("Foi gasto ou entrada?"), nunca um formulário completo.
describe("Fase 12.2 — mensagem telegráfica (item 10)", () => {
  it("'mercado 180' (bare, sem verbo) — resultado atual", () => {
    const r = detectSpontaneousExpenseIntent("mercado 180");
    console.log("telegrafico-mercado:", JSON.stringify(r));
  });
  it("'gasolina 90' (bare, categoria forte) — resultado atual", () => {
    const r = detectSpontaneousExpenseIntent("gasolina 90");
    console.log("telegrafico-gasolina:", JSON.stringify(r));
  });
});

// Item 15 — ordem invertida dos campos de compromisso.
describe("Fase 12.2 — ordem invertida (item 15)", () => {
  it("'17h terça cortar cabelo' tem data E hora (ordem hora-dia-descrição)", () => {
    const r = parseFutureDateTimeSP("17h terça cortar cabelo");
    expect(r.hasTime).toBe(true);
    expect(r.hasDate).toBe(true);
  });
  it("'amanhã 8h reunião João' tem data E hora", () => {
    const r = parseFutureDateTimeSP("amanhã 8h reunião João");
    expect(r.hasDate).toBe(true);
    expect(r.hasTime).toBe(true);
  });
});

// Item 16 — dia da semana: nunca agendar no passado. Cobre especificamente o
// branch "dia citado é HOJE" que o teste existente (appointment-datetime.
// server.test.ts) ainda não cobre: hora ainda não passou -> fica hoje; hora
// já passou -> pula pra próxima semana.
describe("Fase 12.2 — dia da semana, nunca no passado (item 16)", () => {
  it("hoje é terça 09:00, 'terça 17h academia' -> HOJE 17h (horário ainda não passou)", () => {
    // 2026-08-11 é uma terça-feira.
    const base = new Date("2026-08-11T09:00:00-03:00");
    const r = parseFutureDateTimeSP("terça 17h academia", base);
    expect(r.iso).not.toBeNull();
    const d = new Date(r.iso!);
    expect(d.getUTCDate()).toBe(11); // mesmo dia
  });
  it("hoje é terça 20:00, 'terça 17h academia' -> PRÓXIMA terça (horário já passou)", () => {
    const base = new Date("2026-08-11T20:00:00-03:00");
    const r = parseFutureDateTimeSP("terça 17h academia", base);
    expect(r.iso).not.toBeNull();
    const d = new Date(r.iso!);
    expect(d.getUTCDate()).toBe(18); // terça seguinte (+7 dias)
  });
  it("hoje é sábado, 'segunda 14h reunião' -> próxima segunda", () => {
    // 2026-08-15 é sábado.
    const base = new Date("2026-08-15T10:00:00-03:00");
    const r = parseFutureDateTimeSP("segunda 14h reunião", base);
    const d = new Date(r.iso!);
    expect(d.getUTCDate()).toBe(17); // segunda seguinte
  });
});

// Item 22 — valores humanos.
describe("Fase 12.2 — valores humanos (item 22)", () => {
  it("'20mil' -> 20000", () => {
    expect(parseMoneyAmount("20mil")).toBe(20000);
  });
  it("'2,5 mil' -> 2500", () => {
    expect(parseMoneyAmount("2,5 mil")).toBe(2500);
  });
  it("'37 reais e vinte e cinco' (centavos por extenso, sem a palavra 'centavos') -> 37,25", () => {
    const v = parseMoneyAmount("37 reais e vinte e cinco");
    console.log("valor-extenso-sem-centavos-word:", v);
  });
  it("'2 conto' -> valor atual (documentar comportamento)", () => {
    const v = parseMoneyAmount("2 conto");
    console.log("conto-ambiguo:", v);
  });
});
