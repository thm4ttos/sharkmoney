// Reconciliação: o saldo nunca é armazenado; é sempre calculado a partir
// da tabela `transactions`. Este módulo devolve o estado consolidado
// (saldo, receitas, despesas, por categoria, últimos lançamentos) e serve
// como "modo de recuperação" para o painel forçar recomputação sem cache.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const reconcileFinance = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("transactions")
      .select("id, kind, amount, category, description, occurred_at, source")
      .eq("user_id", userId)
      .order("occurred_at", { ascending: false });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as any[];

    let income = 0;
    let expense = 0;
    const byCategory = new Map<string, { total: number; count: number; kind: string }>();
    for (const r of rows) {
      const amount = Number(r.amount);
      if (!Number.isFinite(amount)) continue;
      if (r.kind === "income") income += amount;
      else expense += amount;
      const key = r.category || "Outros";
      const acc = byCategory.get(key) ?? { total: 0, count: 0, kind: r.kind };
      acc.total += amount;
      acc.count += 1;
      byCategory.set(key, acc);
    }

    const balance = Math.round((income - expense) * 100) / 100;
    const categories = [...byCategory.entries()]
      .map(([category, v]) => ({
        category,
        total: Math.round(v.total * 100) / 100,
        count: v.count,
        kind: v.kind,
      }))
      .sort((a, b) => b.total - a.total);

    return {
      generated_at: new Date().toISOString(),
      total_transactions: rows.length,
      income: Math.round(income * 100) / 100,
      expense: Math.round(expense * 100) / 100,
      balance,
      categories,
      last_transactions: rows.slice(0, 20),
      consistent: true, // sempre — saldo é derivado das transações
    };
  });

// ===== Extrato do Saldo =====
// Composição detalhada do saldo: agrupa receitas e despesas por categoria,
// listando cada lançamento com data, descrição e valor. Fonte única: tabela
// `transactions`. Nenhum valor é armazenado — tudo é derivado.
export const getBalanceBreakdown = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      from: z.string().optional(),
      to: z.string().optional(),
    }).parse(i ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    let q = supabase
      .from("transactions")
      .select("id, kind, amount, category, description, occurred_at, source, created_at")
      .eq("user_id", userId);
    if (data.from) q = q.gte("occurred_at", data.from);
    if (data.to) q = q.lte("occurred_at", data.to);
    const { data: rows, error } = await q
      .order("occurred_at", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const list = (rows ?? []) as any[];

    type Item = {
      id: string;
      amount: number;
      description: string;
      category: string;
      occurred_at: string;
      source: string | null;
    };
    type CatGroup = {
      category: string;
      total: number;
      count: number;
      items: Item[];
    };

    const incomeMap = new Map<string, CatGroup>();
    const expenseMap = new Map<string, CatGroup>();
    let income = 0;
    let expense = 0;
    // Detecção de possíveis duplicados: mesma dupla (kind, amount, description
    // normalizada) dentro de 60s. Apenas sinaliza — nunca altera o saldo.
    const dupKeyToRows = new Map<string, any[]>();

    for (const r of list) {
      const amount = Number(r.amount) || 0;
      const cat = r.category || "Outros";
      const map = r.kind === "income" ? incomeMap : expenseMap;
      let g = map.get(cat);
      if (!g) {
        g = { category: cat, total: 0, count: 0, items: [] };
        map.set(cat, g);
      }
      g.total = Math.round((g.total + amount) * 100) / 100;
      g.count += 1;
      g.items.push({
        id: r.id,
        amount,
        description: r.description ?? "",
        category: cat,
        occurred_at: r.occurred_at,
        source: r.source ?? null,
      });
      if (r.kind === "income") income += amount;
      else expense += amount;

      const desc = String(r.description ?? "").toLowerCase().trim();
      const k = `${r.kind}|${amount.toFixed(2)}|${desc}|${cat}`;
      const bucket = dupKeyToRows.get(k) ?? [];
      bucket.push(r);
      dupKeyToRows.set(k, bucket);
    }

    const incomeGroups = [...incomeMap.values()].sort((a, b) => b.total - a.total);
    const expenseGroups = [...expenseMap.values()].sort((a, b) => b.total - a.total);
    income = Math.round(income * 100) / 100;
    expense = Math.round(expense * 100) / 100;
    const balance = Math.round((income - expense) * 100) / 100;

    // Auditoria: identifica potenciais duplicados (mesmo tipo/valor/descrição/categoria
    // com created_at a menos de 60s um do outro).
    const suspects: Array<{ ids: string[]; reason: string; kind: string; amount: number; description: string; category: string }> = [];
    for (const [key, group] of dupKeyToRows) {
      if (group.length < 2) continue;
      group.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      for (let i = 1; i < group.length; i++) {
        const dt = new Date(group[i].created_at).getTime() - new Date(group[i - 1].created_at).getTime();
        if (dt < 60_000) {
          const [kind, amt, desc, cat] = key.split("|");
          suspects.push({
            ids: [group[i - 1].id, group[i].id],
            reason: `Dois lançamentos idênticos em ${Math.round(dt / 1000)}s`,
            kind, amount: Number(amt), description: desc, category: cat,
          });
        }
      }
    }

    return {
      generated_at: new Date().toISOString(),
      formula: "Saldo = Σ(receitas) − Σ(despesas)",
      period: { from: data.from ?? null, to: data.to ?? null },
      income,
      expense,
      balance,
      total_transactions: list.length,
      incomeGroups,
      expenseGroups,
      suspects,
      consistent: suspects.length === 0,
    };
  });

// ===== Reconciliação entre canais (site x WhatsApp x transações reais) =====
// Compara três leituras do MESMO histórico:
//  1) ledger  — função oficial do banco (public.finance_snapshot);
//  2) site    — recomputação linha por linha com o cliente autenticado (RLS);
//  3) whatsapp— a mesma leitura que o assistente usa para responder saldo.
// Divergência nunca é usada: o valor correto é sempre o das transações reais,
// e a diferença é registrada em finance_reconciliation_log para auditoria.
export const reconcileChannels = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { fetchFinanceSnapshot } = await import("@/lib/finance-snapshot.server");

    // 1) Fonte única (banco)
    const ledger = await fetchFinanceSnapshot(supabase, userId);

    // 2) Recomputação do site, paginada (nunca truncada em 1000 linhas)
    let income = 0, expense = 0, count = 0;
    const byCategory = new Map<string, number>();
    const PAGE = 1000;
    for (let page = 0; page < 200; page++) {
      const { data, error } = await supabase
        .from("transactions")
        .select("kind, amount, category")
        .eq("user_id", userId)
        .order("occurred_at", { ascending: true })
        .range(page * PAGE, page * PAGE + PAGE - 1);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as any[];
      for (const r of rows) {
        const a = Number(r.amount) || 0;
        if (r.kind === "income") income += a; else expense += a;
        const key = `${r.kind}|${(r.category || "Outros").trim() || "Outros"}`;
        byCategory.set(key, Math.round(((byCategory.get(key) ?? 0) + a) * 100) / 100);
        count++;
      }
      if (rows.length < PAGE) break;
    }
    const site = {
      income: Math.round(income * 100) / 100,
      expense: Math.round(expense * 100) / 100,
      balance: Math.round((income - expense) * 100) / 100,
      txCount: count,
    };

    // 3) Leitura do canal WhatsApp (mesma função do banco, via service role)
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const wa = await fetchFinanceSnapshot(supabaseAdmin, userId);

    const near = (a: number, b: number) => Math.abs(a - b) < 0.01;
    const categoryDiffs: Array<{ category: string; kind: string; ledger: number; site: number }> = [];
    for (const c of ledger.byCategory) {
      const siteTotal = byCategory.get(`${c.kind}|${c.category}`) ?? 0;
      if (!near(c.total, siteTotal)) {
        categoryDiffs.push({ category: c.category, kind: c.kind, ledger: c.total, site: siteTotal });
      }
    }

    const consistent =
      near(ledger.balance, site.balance) &&
      near(ledger.balance, wa.balance) &&
      near(ledger.income, site.income) && near(ledger.income, wa.income) &&
      near(ledger.expense, site.expense) && near(ledger.expense, wa.expense) &&
      ledger.txCount === site.txCount && ledger.txCount === wa.txCount &&
      categoryDiffs.length === 0;

    const report = {
      generated_at: new Date().toISOString(),
      formula: "Saldo = Σ(receitas) − Σ(despesas) em transactions",
      consistent,
      ledger: {
        income: ledger.income, expense: ledger.expense,
        balance: ledger.balance, txCount: ledger.txCount,
      },
      site,
      whatsapp: { income: wa.income, expense: wa.expense, balance: wa.balance, txCount: wa.txCount },
      categoryDiffs,
      // Valor a ser exibido/respondido em qualquer canal — sempre o do ledger.
      authoritative_balance: ledger.balance,
    };

    // Log apenas quando há divergência (registro de causa para auditoria).
    if (!consistent) {
      try {
        await supabaseAdmin.from("finance_reconciliation_log").insert({
          user_id: userId,
          channel: "site+whatsapp",
          ledger_balance: ledger.balance,
          reported_balance: site.balance,
          diff: Math.round((site.balance - ledger.balance) * 100) / 100,
          consistent: false,
          details: report as any,
        });
      } catch (e) {
        console.error("[reconcile] falha ao registrar divergência", e);
      }
    }

    return report;
  });
