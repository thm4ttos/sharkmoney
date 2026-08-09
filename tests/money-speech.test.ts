// Testes das funções PURAS de normalização monetária (src/lib/money-speech.ts).
//
// IMPORTANTE — como foram gerados: este ambiente não tem Node/Bun/npm
// instalado, então estes testes foram escritos traçando o código à mão
// (linha a linha) para prever a saída esperada, e NÃO foram executados.
// Antes de confiar neles como rede de regressão, rode localmente:
//   bun add -d vitest   (ou: npm i -D vitest)
//   bunx vitest run tests/money-speech.test.ts
// Se algum caso falhar, o mais provável é a previsão manual estar errada,
// não necessariamente o código — confira os dois antes de "corrigir".

import { describe, it, expect } from "vitest";
import {
  ptNumberWordsToDigits,
  normalizeSpokenMoney,
  hasExplicitCentsConstruction,
  detectCentsAmbiguity,
} from "@/lib/money-speech";

describe("ptNumberWordsToDigits — números por extenso e abreviações", () => {
  it("gírias k/mil coladas ou soltas viram multiplicação, nunca concatenação", () => {
    expect(ptNumberWordsToDigits("20mil")).toBe("20000");
    expect(ptNumberWordsToDigits("20 mil")).toBe("20000");
    expect(ptNumberWordsToDigits("2mil")).toBe("2000");
    expect(ptNumberWordsToDigits("10k")).toBe("10000");
    expect(ptNumberWordsToDigits("1k")).toBe("1000");
    expect(ptNumberWordsToDigits("2k")).toBe("2000");
    expect(ptNumberWordsToDigits("1,5k")).toBe("1500");
    expect(ptNumberWordsToDigits("1.5k")).toBe("1500");
    expect(ptNumberWordsToDigits("2,5 mil")).toBe("2500");
  });

  it("não confunde 'km'/'kg' com a abreviação de mil (k precisa de fronteira de palavra)", () => {
    expect(ptNumberWordsToDigits("rodei 50km hoje")).toBe("rodei 50km hoje");
    expect(ptNumberWordsToDigits("comprei 2kg de carne")).toBe("comprei 2kg de carne");
  });

  it("números simples por extenso", () => {
    expect(ptNumberWordsToDigits("cinquenta")).toBe("50");
    expect(ptNumberWordsToDigits("dez")).toBe("10");
    expect(ptNumberWordsToDigits("cento e cinquenta")).toBe("150");
    expect(ptNumberWordsToDigits("duzentos")).toBe("200");
  });

  it("milhar composto por extenso ('mil e X', 'dois mil e X')", () => {
    expect(ptNumberWordsToDigits("mil e quinhentos")).toBe("1500");
    expect(ptNumberWordsToDigits("dois mil e quinhentos")).toBe("2500");
    expect(ptNumberWordsToDigits("mil e duzentos")).toBe("1200");
  });

  it("gíria de moeda (conto/pila) não é tocada — só o número vira dígito", () => {
    expect(ptNumberWordsToDigits("cinquenta conto")).toBe("50 conto");
    expect(ptNumberWordsToDigits("cem conto")).toBe("100 conto");
  });

  it("dois grupos por extenso unidos por 'e' (sem 'reais'/'centavos') viram par decimal — é o comportamento intencional do parser, não trata como dois valores", () => {
    // Ver comentário no topo do arquivo: isso é uma limitação conhecida e
    // deliberada (o parser não sabe se "dez e cinquenta" é 10,50 ou "10 [algo]
    // e 50 [outro algo]" sem mais contexto) — registrado aqui pra não regredir
    // silenciosamente pra pior nem melhorar sem que o teste avise.
    expect(ptNumberWordsToDigits("dez e cinquenta")).toBe("10,50");
    expect(ptNumberWordsToDigits("noventa e nove e noventa")).toBe("99,90");
  });

  it("números soltos em meio a frase continuam legíveis", () => {
    expect(ptNumberWordsToDigits("gastei cinquenta no mercado")).toBe("gastei 50 no mercado");
  });
});

describe("normalizeSpokenMoney — reais e centavos como valor único", () => {
  it("'X reais e Y centavos' vira X,YY", () => {
    expect(normalizeSpokenMoney("37 reais e 25 centavos")).toBe("37,25");
    expect(normalizeSpokenMoney("8 reais e 5 centavos")).toBe("8,05");
    expect(normalizeSpokenMoney("1 real e 25 centavos")).toBe("1,25");
  });

  it("'X reais com Y' (sem a palavra centavos) também vira X,YY", () => {
    expect(normalizeSpokenMoney("37 reais com 25")).toBe("37,25");
  });

  it("'Y centavos' isolado vira 0,YY", () => {
    expect(normalizeSpokenMoney("25 centavos")).toBe("0,25");
  });

  it("valores por extenso completos ('trinta e sete reais e vinte e cinco centavos')", () => {
    // ptNumberWordsToDigits primeiro funde "trinta e sete" -> 37 e "vinte e
    // cinco" -> 25 (cada um é um grupo por extenso fechado, sem "e" entre os
    // dois porque a palavra "reais" quebra a adjacência); normalizeSpokenMoney
    // então junta "37 reais e 25 centavos" -> "37,25".
    expect(normalizeSpokenMoney("trinta e sete reais e vinte e cinco centavos")).toBe("37,25");
  });
});

describe("hasExplicitCentsConstruction", () => {
  it("detecta construção explícita de centavos", () => {
    expect(hasExplicitCentsConstruction("37 reais e 25 centavos")).toBe(true);
    expect(hasExplicitCentsConstruction("25 centavos")).toBe(true);
    expect(hasExplicitCentsConstruction("37 reais com 25")).toBe(true);
  });

  it("não confunde com valores independentes ou frases sem centavos", () => {
    expect(hasExplicitCentsConstruction("gastei 37 no mercado")).toBe(false);
    expect(hasExplicitCentsConstruction("37 reais no sorvete e 25 reais no lanche")).toBe(false);
  });
});

describe("detectCentsAmbiguity — dois inteiros colados por 'e', sem reais/centavos", () => {
  it("sinaliza ambiguidade real (não decide sozinho)", () => {
    expect(detectCentsAmbiguity("paguei 37 e 25 no sorvete")).toEqual({ whole: 37, cents: 25 });
  });

  it("dois valores explicitamente 'reais' cada um NÃO é ambíguo (são dois lançamentos)", () => {
    expect(detectCentsAmbiguity("37 reais no sorvete e 25 reais no lanche")).toBeNull();
  });

  it("mensagem com centavos explícitos não entra nesse caminho", () => {
    expect(detectCentsAmbiguity("37 reais e 25 centavos")).toBeNull();
  });
});
