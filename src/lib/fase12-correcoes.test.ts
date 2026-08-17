import { describe, it, expect } from "vitest";
import {
  detectAmountCorrectionIntent,
  detectPreviousEntryEditIntent,
} from "@/lib/brinzap-actions.server";

// Fase 12.3 — item 11: correções devem SEMPRE atualizar (UPDATE), nunca criar
// lançamento novo, e nunca depender de pontuação exata.
describe("Fase 12.3 — correção de valor (item 11)", () => {
  it("'não, foi 90' (com vírgula) dispara correção — bug real corrigido", () => {
    const r = detectAmountCorrectionIntent("não, foi 90");
    expect(r).not.toBeNull();
    expect(r?.newAmount).toBe(90);
  });
  it("'não foi 90' (sem vírgula) continua funcionando", () => {
    const r = detectAmountCorrectionIntent("não foi 90");
    expect(r?.newAmount).toBe(90);
  });
  it("'Não foi 17, foi 37,25' -> newAmount 37.25", () => {
    const r = detectAmountCorrectionIntent("Não foi 17, foi 37,25");
    expect(r?.newAmount).toBeCloseTo(37.25, 2);
  });
  it("'Errei, era 17' -> newAmount 17 (só um valor)", () => {
    const r = detectAmountCorrectionIntent("Errei, era 17");
    expect(r?.newAmount).toBe(17);
  });
  it("'Gastei 80 no mercado' NÃO é correção — é lançamento novo", () => {
    expect(detectAmountCorrectionIntent("Gastei 80 no mercado")).toBeNull();
  });
});

// Item 11 — "Foi ontem." deve editar a DATA (não some, não vira gasto novo).
describe("Fase 12.3 — correção de data (item 11)", () => {
  it("'Foi ontem.' -> patch de data", () => {
    const r = detectPreviousEntryEditIntent("Foi ontem.");
    expect(r?.kind).toBe("date");
  });
  it("'Isso foi dia 22' -> patch de data", () => {
    const r = detectPreviousEntryEditIntent("Isso foi dia 22");
    expect(r?.kind).toBe("date");
  });
});

// Item 11 — troca de categoria/descrição ("Não era gasolina, era álcool").
// Documenta o gap encontrado: o gatilho de categoria só reconhece a lista de
// CATEGORIAS (combustível, alimentação...), não sub-palavras como "gasolina"/
// "álcool" — mesmo essas palavras já existindo no mapa CAT_MAP. Fica sem
// detecção determinística hoje (cai pra IA).
describe("Fase 12.3 — troca de categoria (item 11) — comportamento atual", () => {
  it("'Não era gasolina, era álcool' — resultado atual (gap conhecido)", () => {
    const r = detectPreviousEntryEditIntent("Não era gasolina, era álcool");
    console.log("categoria-subpalavra:", JSON.stringify(r));
  });
  it("'Muda a categoria pra combustível' — deve reconhecer categoria diretamente", () => {
    const r = detectPreviousEntryEditIntent("Muda a categoria pra combustível");
    expect(r?.kind).toBe("category");
  });
});

// Item 43/44 — apagar precisa de confirmação, nunca cegamente.
describe("Fase 12.3 — exclusão via linguagem natural", () => {
  it("'apaga esse lançamento' -> patch delete", () => {
    const r = detectPreviousEntryEditIntent("apaga esse lançamento");
    expect(r?.kind).toBe("delete");
  });
  it("'apaga' sozinho (sem referência) — não deve disparar delete às cegas", () => {
    const r = detectPreviousEntryEditIntent("apaga");
    expect(r?.kind).not.toBe("delete");
  });
});
