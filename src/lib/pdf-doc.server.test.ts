import { describe, it, expect } from "vitest";
import { extractReceiptAmount, extractReceiptDate } from "@/lib/pdf-doc.server";

// TESTE 8, 9 e 10 do pedido original (PARTE 17-21: hierarquia de valores em
// notas fiscais). Bug real: uma nota com "VALOR TOTAL: R$472,93" seguida de
// um detalhamento de forma de pagamento ("Dinheiro: R$120,00" / "PIX:
// R$352,93") registrava R$120 em vez de R$472,93.
describe("extractReceiptAmount", () => {
  it("TESTE 8: total explícito nunca é sobrescrito por forma de pagamento dividida", () => {
    const text = [
      "SUPERMERCADO EXEMPLO LTDA",
      "Subtotal: R$472,93",
      "VALOR TOTAL: R$472,93",
      "FORMA DE PAGAMENTO",
      "Valor Pago em Dinheiro: R$120,00",
      "Valor do Pix: R$352,93",
    ].join("\n");
    expect(extractReceiptAmount(text)).toBe(472.93);
  });

  it("reconstrói o total somando as formas de pagamento quando não há rótulo de total", () => {
    const text = [
      "COMPROVANTE DE VENDA",
      "Valor Pago em Dinheiro: R$120,00",
      "Valor do Pix: R$352,93",
    ].join("\n");
    expect(extractReceiptAmount(text)).toBe(472.93);
  });

  it("TESTE 9: troco nunca vira o valor da despesa", () => {
    const text = ["Total: R$79,24", "Dinheiro: R$100,00", "Troco: R$20,76"].join("\n");
    expect(extractReceiptAmount(text)).toBe(79.24);
  });

  it("desconto: usa o valor A PAGAR, não o subtotal", () => {
    const text = ["Subtotal: R$500,00", "Desconto: R$30,00", "Total a pagar: R$470,00"].join("\n");
    expect(extractReceiptAmount(text)).toBe(470);
  });

  it("nota com um único valor, sem rótulo, ainda é aceita", () => {
    expect(extractReceiptAmount("Recibo\nR$150,00\nObrigado")).toBe(150);
  });
});

// TESTE 10.
describe("extractReceiptDate", () => {
  it("usa a data impressa no documento", () => {
    expect(extractReceiptDate("Data da compra: 17/07/2026\nTotal: R$50,00")).toBe("17/07/2026");
  });
});
