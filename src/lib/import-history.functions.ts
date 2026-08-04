import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-2.5-flash";

const CATEGORIES = [
  "Moradia", "Alimentação", "Transporte", "Saúde", "Educação",
  "Lazer", "Pessoal", "Investimentos", "Vida Espiritual",
  "Empresa e Autônomo", "Outros", "Receita",
] as const;

const SYSTEM = `Você é o interpretador MASTER de importação financeira do Shark Money. Recebe conteúdo bruto de qualquer origem (planilha, CSV, TXT, PDF, OFX/QIF, extrato bancário, print/imagem, bloco de notas, exportação de outro app, conversa exportada) e extrai TODAS as movimentações financeiras encontradas, sem exceção e SEM LIMITE de quantidade. Nunca invente lançamentos.

Categorias válidas: ${CATEGORIES.join(", ")}.

Heurística de categorização (identifique por marca/descrição, mesmo sem coluna de categoria):
- Alimentação: mercado, supermercado, padaria, restaurante, iFood, McDonald's, Burger King, Subway, Habib's, Rappi, delivery, açougue, hortifruti, Zé Delivery, cafeteria.
- Transporte: Uber, 99, InDrive, Cabify, táxi, combustível, posto, Shell, BR, Ipiranga, Ale, pedágio, estacionamento, ônibus, metrô, passagem, mecânico, oficina, IPVA, seguro auto.
- Moradia: aluguel, condomínio, IPTU, luz, energia, Enel, CPFL, água, Sabesp, gás, internet, Vivo Fibra, Claro Net, Oi Fibra, TIM Live, mensalidade fibra.
- Saúde: farmácia, Drogasil, Droga Raia, Pacheco, Panvel, plano de saúde, Amil, Unimed, Bradesco Saúde, hospital, clínica, laboratório, consulta, exame, academia, Smart Fit, Bio Ritmo, nutricionista, psicólogo.
- Educação: escola, faculdade, mensalidade, curso, Udemy, Alura, Coursera, livros, material escolar.
- Lazer: cinema, ingresso, streaming, Netflix, Spotify, Prime Video, Disney+, HBO, YouTube Premium, Deezer, viagem, hotel, Airbnb, bar, balada, show, jogos, Steam, PSN, Xbox.
- Pessoal: barbeiro, salão, cabeleireiro, cosméticos, roupas, calçados, Renner, C&A, Riachuelo, Zara, presentes.
- Investimentos: aplicação, resgate, tesouro, CDB, LCI, LCA, ações, XP, Rico, Nubank invest, Inter invest, cripto, Binance.
- Vida Espiritual: dízimo, oferta, igreja, doação religiosa.
- Empresa e Autônomo: nota fiscal, cliente, fornecedor, PJ, MEI, contador, honorários.
- Receita (income): salário, holerite, PIX recebido, transferência recebida, TED recebida, DOC recebido, depósito, comissão, venda, freelance, freela, rendimento, dividendo, cashback, reembolso, restituição, aluguel recebido, adiantamento, 13º, férias.
- Outros: quando não houver correspondência clara.

Regras de leitura:
- Fuso America/Sao_Paulo. Hoje é ${new Date().toISOString().slice(0,10)}. Se a data não tiver ano, use o ano mais provável pelo contexto do arquivo; se ambíguo, use o ano atual (se resultar em data futura sem outra referência, use o ano anterior). Datas ISO YYYY-MM-DD.
- Datas futuras SÃO PERMITIDAS quando o contexto indicar (ex.: parcelamento com parcelas futuras, contas agendadas, cheques pré-datados). NÃO ignore.
- kind: "income" para entradas/receitas/recebimentos/créditos; "expense" para gastos/despesas/pagamentos/débitos. Sinais "+"/"C" = income; "-"/"D" = expense.
- amount: SEMPRE número positivo em BRL (sem símbolo, sem separador de milhar; ponto decimal). Se vier "R$ 1.234,56", retorne 1234.56.
- description: texto curto e limpo do item (remova ruído de tabela, códigos de transação irrelevantes).
- notes: coloque informações auxiliares — "Parcela 3/12", "Fatura Nubank", "Cartão final 1234", banco/conta, ID quando útil.
- IGNORE cabeçalhos, totais, subtotais, saldos, "Saldo anterior", "Saldo final", linhas em branco, e linhas sem valor monetário.
- Não perca lançamentos: mesmo que uma planilha tenha colunas fora de ordem, identifique Data, Valor, Descrição, Tipo, Categoria, Conta/Cartão em QUALQUER posição.
- Cartão de crédito: cada compra da fatura é um "expense" separado (com nota "Fatura <banco>"). "Pagamento da fatura" é 1 lançamento único do tipo "expense" categoria Outros com nota "Pagamento de fatura" (não duplicar as compras).
- Parcelamentos: se detectar "3x de 150", "Parcela 2/10", "10x R$89,90":
  - Se a linha representar UMA parcela específica (ex.: "Parcela 3/12"): retorne apenas essa parcela com installment.current e installment.total preenchidos.
  - Se representar a compra completa em parcelas futuras (ex.: "Sofá 10x R$300 - início 05/2025") e não houver linhas individuais das parcelas: retorne UMA linha por parcela, cada uma na data correspondente (mês a mês), installment.current e installment.total preenchidos.
- Recorrência: quando reconhecer conta fixa (Netflix, Spotify, aluguel, internet, luz, água, academia, escola, seguro, mensalidade), marque recurring=true no lançamento (não altera o valor; apenas sinaliza).

Campos opcionais em cada item:
- installment: { current: number, total: number } quando aplicável.
- recurring: true quando identificar recorrência típica.

Responda SEMPRE com JSON puro (sem markdown, sem comentários) no formato exato:
{"items":[{"date":"YYYY-MM-DD","time":"HH:MM"|null,"amount":123.45,"kind":"expense"|"income","category":"…","description":"…","notes":"…"|null,"installment":{"current":1,"total":12}|null,"recurring":true|false}]}`;

type ParsedItem = {
  date: string;
  time?: string | null;
  amount: number;
  kind: "expense" | "income";
  category: string;
  description: string;
  notes?: string | null;
  installment?: { current: number; total: number } | null;
  recurring?: boolean;
};

async function callGatewayOnce(userContent: any, timeoutMs: number): Promise<Response> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("A IA de importação está indisponível no momento. Tente novamente em instantes.");
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(GATEWAY_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: userContent },
        ],
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(t);
  }
}

async function callGateway(userContent: any): Promise<ParsedItem[]> {
  const MAX_ATTEMPTS = 3;
  const TIMEOUT_MS = 90_000;
  let lastErr: any = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await callGatewayOnce(userContent, TIMEOUT_MS);
      if (res.status === 402) throw new Error("A IA de importação atingiu o limite de créditos. Adicione créditos para continuar.");
      if (res.status === 408 || res.status === 425 || res.status === 429 || (res.status >= 500 && res.status <= 599)) {
        lastErr = new Error(`retryable_${res.status}`);
        if (attempt < MAX_ATTEMPTS) {
          await new Promise(r => setTimeout(r, 1500 * attempt));
          continue;
        }
        throw new Error("A IA está demorando mais que o normal. Tente novamente em instantes ou envie um arquivo menor.");
      }
      if (!res.ok) {
        throw new Error("Não consegui interpretar este conteúdo. Verifique o arquivo e tente novamente.");
      }
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content ?? "{}";
      let parsed: any = {};
      try { parsed = JSON.parse(text); } catch {
        const m = String(text).match(/\{[\s\S]*\}/);
        if (m) { try { parsed = JSON.parse(m[0]); } catch { parsed = {}; } }
      }
      const items = Array.isArray(parsed?.items) ? parsed.items : [];
      const clean: ParsedItem[] = [];
      for (const it of items) {
        const amt = Number(String(it?.amount ?? "").toString().replace(",", "."));
        if (!Number.isFinite(amt) || amt <= 0) continue;
        const kind = it?.kind === "income" ? "income" : "expense";
        const dateStr = typeof it?.date === "string" && /^\d{4}-\d{2}-\d{2}/.test(it.date) ? it.date.slice(0, 10) : null;
        if (!dateStr) continue;
        const inst = it?.installment && Number.isFinite(Number(it.installment.current)) && Number.isFinite(Number(it.installment.total))
          ? { current: Number(it.installment.current), total: Number(it.installment.total) }
          : null;
        clean.push({
          date: dateStr,
          time: typeof it?.time === "string" && /^\d{2}:\d{2}/.test(it.time) ? it.time.slice(0, 5) : null,
          amount: Math.round(amt * 100) / 100,
          kind,
          category: (CATEGORIES as readonly string[]).includes(it?.category) ? it.category : (kind === "income" ? "Receita" : "Outros"),
          description: String(it?.description ?? "").trim().slice(0, 200),
          notes: it?.notes ? String(it.notes).slice(0, 500) : null,
          installment: inst,
          recurring: !!it?.recurring,
        });
      }
      return clean;
    } catch (e: any) {
      lastErr = e;
      const msg = String(e?.message ?? "");
      const isAbort = e?.name === "AbortError" || /abort/i.test(msg);
      const isRetryable = isAbort || msg.startsWith("retryable_") || /network|fetch failed|ECONN|ENOTFOUND|timeout/i.test(msg);
      if (isRetryable && attempt < MAX_ATTEMPTS) {
        await new Promise(r => setTimeout(r, 1500 * attempt));
        continue;
      }
      if (/IA|créditos|arquivo|conteúdo|instantes/i.test(msg)) throw e;
      throw new Error("A IA está demorando mais que o normal. Tente novamente em instantes.");
    }
  }
  throw lastErr ?? new Error("Falha temporária ao processar. Tente novamente.");
}

function toIso(date: string, time?: string | null): string {
  const t = time && /^\d{2}:\d{2}/.test(time) ? time.slice(0, 5) : "12:00";
  return `${date}T${t}:00-03:00`;
}

export const previewImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      // Limite alto — o cliente ainda faz chunking, mas nunca deve bloquear por tamanho.
      text: z.string().max(2_000_000).optional(),
      pdfBase64: z.string().max(25_000_000).optional(),
      pdfMime: z.string().optional(),
      imageBase64: z.string().max(25_000_000).optional(),
      imageMime: z.string().optional(),
      fileName: z.string().optional(),
    }).parse(i ?? {})
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    let items: ParsedItem[] = [];
    if (data.pdfBase64) {
      items = await callGateway([
        { type: "text", text: "Extraia TODOS os lançamentos financeiros deste PDF (extrato, fatura, exportação, comprovante). Não pule linhas nem limite quantidade." },
        { type: "file", file: { filename: data.fileName ?? "arquivo.pdf", file_data: `data:${data.pdfMime || "application/pdf"};base64,${data.pdfBase64}` } },
      ]);
    } else if (data.imageBase64) {
      items = await callGateway([
        { type: "text", text: "Esta é uma imagem (print de banco, extrato, planilha, bloco de notas ou foto de anotações). Use OCR para ler TODO o conteúdo e extrair TODOS os lançamentos financeiros: receitas, despesas, PIX, boletos, cartões, transferências, contas fixas, parcelamentos. Não pule nada." },
        { type: "image_url", image_url: { url: `data:${data.imageMime || "image/jpeg"};base64,${data.imageBase64}` } },
      ]);
    } else if (data.text && data.text.trim()) {
      items = await callGateway([
        { type: "text", text: `Extraia TODOS os lançamentos financeiros do conteúdo a seguir (arquivo: ${data.fileName ?? "colado"}). Não pule nem limite quantidade — importe tudo que for movimentação financeira.\n\n${data.text}` },
      ]);
    } else {
      throw new Error("Nada para importar.");
    }

    // Duplicate detection: buscar transactions existentes no intervalo relevante.
    const dates = Array.from(new Set(items.map(i => i.date))).sort();
    let existing: any[] = [];
    if (dates.length) {
      const from = dates[0];
      const to = dates[dates.length - 1];
      const { data: rows } = await supabase
        .from("transactions")
        .select("amount, kind, description, occurred_at, category")
        .eq("user_id", userId)
        .gte("occurred_at", `${from}T00:00:00-03:00`)
        .lte("occurred_at", `${to}T23:59:59-03:00`);
      existing = rows ?? [];
    }
    const normDesc = (s?: string | null) => String(s ?? "").toLowerCase().trim();
    const enriched = items.map((it, idx) => {
      const dup = existing.find(e =>
        Number(e.amount) === it.amount &&
        e.kind === it.kind &&
        String(e.occurred_at).slice(0, 10) === it.date &&
        normDesc(e.description) === normDesc(it.description)
      );
      return { ...it, _idx: idx, duplicate: !!dup };
    });

    const income = enriched.filter(i => i.kind === "income").reduce((s, i) => s + i.amount, 0);
    const expense = enriched.filter(i => i.kind === "expense").reduce((s, i) => s + i.amount, 0);
    const duplicates = enriched.filter(i => i.duplicate).length;
    const uncategorized = enriched.filter(i => i.category === "Outros").length;
    const installments = enriched.filter(i => i.installment && i.installment.total > 1).length;
    const recurring = enriched.filter(i => i.recurring).length;
    const period = dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null;

    return { items: enriched, stats: { total: enriched.length, income, expense, duplicates, uncategorized, installments, recurring, period } };
  });

export const previewImportStructured = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      fileName: z.string().optional(),
      items: z.array(z.object({
        date: z.string(),
        time: z.string().nullable().optional(),
        amount: z.number().positive(),
        kind: z.enum(["income", "expense"]),
        category: z.string(),
        description: z.string(),
        notes: z.string().nullable().optional(),
        installment: z.object({ current: z.number(), total: z.number() }).nullable().optional(),
        recurring: z.boolean().optional(),
      })),
    }).parse(i)
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const items = data.items;
    const dates = Array.from(new Set(items.map(i => i.date))).sort();
    let existing: any[] = [];
    if (dates.length) {
      const { data: rows } = await supabase
        .from("transactions")
        .select("amount, kind, description, occurred_at, category")
        .eq("user_id", userId)
        .gte("occurred_at", `${dates[0]}T00:00:00-03:00`)
        .lte("occurred_at", `${dates[dates.length - 1]}T23:59:59-03:00`);
      existing = rows ?? [];
    }
    const normDesc = (s?: string | null) => String(s ?? "").toLowerCase().trim();
    const enriched = items.map((it, idx) => {
      const dup = existing.find(e =>
        Number(e.amount) === it.amount &&
        e.kind === it.kind &&
        String(e.occurred_at).slice(0, 10) === it.date &&
        normDesc(e.description) === normDesc(it.description)
      );
      return { ...it, _idx: idx, duplicate: !!dup };
    });
    let income = 0, expense = 0, duplicates = 0, uncategorized = 0, installments = 0, recurring = 0;
    for (const it of enriched) {
      if (it.kind === "income") income += it.amount; else expense += it.amount;
      if (it.duplicate) duplicates++;
      if (it.category === "Outros") uncategorized++;
      if (it.installment && it.installment.total > 1) installments++;
      if (it.recurring) recurring++;
    }
    return {
      items: enriched,
      stats: {
        total: enriched.length,
        income: Math.round(income * 100) / 100,
        expense: Math.round(expense * 100) / 100,
        duplicates, uncategorized, installments, recurring,
        period: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null,
      },
    };
  });

export const commitImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      fileName: z.string().optional(),
      sourceKind: z.string().default("text"),
      duplicatePolicy: z.enum(["skip", "keep_both"]).default("skip"),
      items: z.array(z.object({
        date: z.string(),
        time: z.string().nullable().optional(),
        amount: z.number().positive(),
        kind: z.enum(["income", "expense"]),
        category: z.string(),
        description: z.string(),
        notes: z.string().nullable().optional(),
        duplicate: z.boolean().optional(),
        installment: z.object({ current: z.number(), total: z.number() }).nullable().optional(),
        recurring: z.boolean().optional(),
      })).min(1),
      expected: z.object({
        total: z.number(),
        income: z.number(),
        expense: z.number(),
      }).optional(),
    }).parse(i)
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: batch, error: bErr } = await supabase
      .from("import_batches")
      .insert({
        user_id: userId,
        file_name: data.fileName ?? null,
        source_kind: data.sourceKind,
        status: "committed",
      })
      .select("id")
      .single();
    if (bErr || !batch) throw new Error(bErr?.message ?? "Falha ao criar lote");

    let imported = 0, skipped = 0, errors = 0;
    let importedIncome = 0, importedExpense = 0;
    const toInsert: any[] = [];
    let expectedInsertCount = 0;
    for (const it of data.items) {
      if (it.duplicate && data.duplicatePolicy === "skip") { skipped++; continue; }
      const suffixParts: string[] = [];
      if (it.installment && it.installment.total > 1) suffixParts.push(`Parcela ${it.installment.current}/${it.installment.total}`);
      if (it.recurring) suffixParts.push("Recorrente");
      if (it.notes) suffixParts.push(it.notes);
      const desc = [it.description, suffixParts.length ? `(${suffixParts.join(" · ")})` : ""].filter(Boolean).join(" ").trim();
      toInsert.push({
        user_id: userId,
        kind: it.kind,
        amount: it.amount,
        category: it.category || (it.kind === "income" ? "Receita" : "Outros"),
        description: desc || null,
        occurred_at: toIso(it.date, it.time),
        source: "import",
        import_batch_id: batch.id,
      });
      expectedInsertCount++;
      if (it.kind === "income") importedIncome += it.amount; else importedExpense += it.amount;
    }
    const BATCH = 500;
    for (let i = 0; i < toInsert.length; i += BATCH) {
      const slice = toInsert.slice(i, i + BATCH);
      const { error, count } = await supabase.from("transactions").insert(slice as any, { count: "exact" });
      if (error) {
        for (const row of slice) {
          const r = await supabase.from("transactions").insert(row as any);
          if (r.error) errors++; else imported++;
        }
      } else {
        imported += count ?? slice.length;
      }
    }

    const round = (n: number) => Math.round(n * 100) / 100;
    let mismatch: string | null = null;
    if (imported !== expectedInsertCount || errors > 0) {
      mismatch = `Registros salvos (${imported}) não conferem com o esperado (${expectedInsertCount}).`;
    } else if (data.expected && skipped === 0) {
      if (imported !== data.expected.total) mismatch = `Quantidade divergente: ${imported} vs ${data.expected.total}.`;
      else if (round(importedIncome) !== round(data.expected.income)) mismatch = `Receitas divergem.`;
      else if (round(importedExpense) !== round(data.expected.expense)) mismatch = `Despesas divergem.`;
    }

    if (mismatch) {
      await supabase.from("transactions").delete().eq("user_id", userId).eq("import_batch_id", batch.id);
      await supabase.from("import_batches").update({ status: "reverted", imported_count: 0, skipped_count: skipped, error_count: errors }).eq("id", batch.id);
      throw new Error("Encontramos divergências durante a importação. Nenhum dado foi salvo para evitar inconsistências.");
    }

    await supabase
      .from("import_batches")
      .update({ imported_count: imported, skipped_count: skipped, error_count: errors })
      .eq("id", batch.id);
    return {
      batchId: batch.id,
      imported,
      skipped,
      errors,
      totals: { income: round(importedIncome), expense: round(importedExpense) },
    };
  });

export const listImportBatches = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("import_batches")
      .select("*")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const undoImportBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ batchId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: batch } = await supabase
      .from("import_batches").select("id, user_id, status").eq("id", data.batchId).maybeSingle();
    if (!batch || batch.user_id !== userId) throw new Error("Lote não encontrado.");
    if (batch.status === "reverted") throw new Error("Este lote já foi desfeito.");
    const { error: dErr, count } = await supabase
      .from("transactions")
      .delete({ count: "exact" })
      .eq("user_id", userId)
      .eq("import_batch_id", data.batchId);
    if (dErr) throw new Error(dErr.message);
    await supabase.from("import_batches").update({ status: "reverted" }).eq("id", data.batchId);
    return { removed: count ?? 0 };
  });
