// SERVER-ONLY. "Conversa com meu financeiro" — modo consultor.
// Agrega TODO o histórico financeiro do usuário e conversa com a IA sem registrar lançamentos.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const TZ = "America/Sao_Paulo";

// Frases que ATIVAM o modo consultor.
export const ADVISOR_TRIGGER_RE =
  /(conversa(r)?\s+(com\s+)?meu\s+financeiro|consultor(a)?\s+financeir[oa]|ia\s+financeir[oa]|analis[ae]\s+(minhas?\s+)?finan[çc]as|análise\s+financeira|como\s+estou\s+financeiramente|me\s+ajuda?\s+com\s+(meu\s+dinheiro|minhas?\s+finan[çc]as)|quero\s+conversar\s+sobre\s+(meu\s+dinheiro|minhas?\s+finan[çc]as)|me\s+d[êe]\s+um\s+conselho\s+financeiro|analise\s+minha\s+situa[çc][ãa]o\s+financeira)/i;

// Frases que ENCERRAM o modo consultor.
export const ADVISOR_EXIT_RE =
  /^(sair|encerrar|voltar|finalizar(\s+conversa)?|parar|fechar|tchau|obrigado|obrigada|valeu)\.?!?$/i;

export type AdvisorSnapshot = {
  hasData: boolean;
  summary: string;
};

function monthKey(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, year: "numeric", month: "2-digit" }).format(d);
}

function weekdayPT(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, weekday: "long" }).format(d);
}

const BRL = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });

/**
 * Constrói um resumo textual compacto com TODOS os dados financeiros do usuário
 * para ser injetado no system prompt do consultor.
 */
export async function buildFinancialSnapshot(userId: string): Promise<AdvisorSnapshot> {
  const [txRes, billsRes, instRes, debtsRes, goalsRes, salaryRes] = await Promise.all([
    supabaseAdmin.from("transactions").select("kind, amount, category, description, occurred_at").eq("user_id", userId),
    supabaseAdmin.from("recurring_bills").select("title, amount, frequency, due_day, category, active").eq("user_id", userId),
    supabaseAdmin.from("installment_purchases").select("title, amount, installments_total, installments_paid, total_amount").eq("user_id", userId),
    supabaseAdmin.from("debts").select("title, amount, creditor, description").eq("user_id", userId),
    supabaseAdmin.from("financial_goals").select("title, target_amount, current_amount, target_date").eq("user_id", userId),
    supabaseAdmin.from("salary_entries").select("amount, received_at").eq("user_id", userId),
  ]);

  const tx = (txRes.data ?? []) as any[];
  const bills = (billsRes.data ?? []) as any[];
  const inst = (instRes.data ?? []) as any[];
  const debts = (debtsRes.data ?? []) as any[];
  const goals = (goalsRes.data ?? []) as any[];
  const salary = (salaryRes.data ?? []) as any[];

  const hasData = tx.length + bills.length + inst.length + debts.length + goals.length + salary.length > 0;

  if (!hasData) {
    return { hasData: false, summary: "Este usuário ainda não possui nenhum lançamento, conta, dívida, meta ou salário registrado." };
  }

  // ===== Agregados de transações =====
  let totalIncome = 0, totalExpense = 0;
  const byCategory: Record<string, number> = {};
  const byMonth: Record<string, { income: number; expense: number }> = {};
  const byWeekday: Record<string, number> = {};
  let firstDate: string | null = null, lastDate: string | null = null;

  for (const r of tx) {
    const amt = Number(r.amount) || 0;
    const iso = r.occurred_at as string;
    if (r.kind === "income") totalIncome += amt; else totalExpense += amt;
    if (r.kind === "expense") {
      const cat = r.category || "Outros";
      byCategory[cat] = (byCategory[cat] || 0) + amt;
      const wd = weekdayPT(iso);
      byWeekday[wd] = (byWeekday[wd] || 0) + amt;
    }
    const mk = monthKey(iso);
    byMonth[mk] = byMonth[mk] || { income: 0, expense: 0 };
    if (r.kind === "income") byMonth[mk].income += amt; else byMonth[mk].expense += amt;
    if (!firstDate || iso < firstDate) firstDate = iso;
    if (!lastDate || iso > lastDate) lastDate = iso;
  }

  const balance = totalIncome - totalExpense;
  const monthsSorted = Object.entries(byMonth).sort(([a], [b]) => a.localeCompare(b));
  const monthsCount = monthsSorted.length;
  const avgMonthlyExpense = monthsCount ? totalExpense / monthsCount : 0;
  const avgMonthlyIncome = monthsCount ? totalIncome / monthsCount : 0;
  const avgMonthlySavings = avgMonthlyIncome - avgMonthlyExpense;

  const bestMonth = monthsSorted
    .map(([k, v]) => ({ k, saldo: v.income - v.expense }))
    .sort((a, b) => b.saldo - a.saldo)[0];
  const worstMonth = monthsSorted
    .map(([k, v]) => ({ k, saldo: v.income - v.expense }))
    .sort((a, b) => a.saldo - b.saldo)[0];

  const topCats = Object.entries(byCategory)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 6)
    .map(([c, v]) => `${c}: ${BRL(v)}`);

  const topWeekdays = Object.entries(byWeekday)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([d, v]) => `${d}: ${BRL(v)}`);

  // Últimos 3 meses de tendência
  const last3 = monthsSorted.slice(-3).map(([k, v]) => `${k} — receitas ${BRL(v.income)} / despesas ${BRL(v.expense)} / saldo ${BRL(v.income - v.expense)}`);

  const lines: string[] = [];
  lines.push(`Período com registros: ${firstDate?.slice(0, 10) ?? "?"} a ${lastDate?.slice(0, 10) ?? "?"} (${monthsCount} ${monthsCount === 1 ? "mês" : "meses"}).`);
  lines.push(`Totais histórico completo: receitas ${BRL(totalIncome)}, despesas ${BRL(totalExpense)}, saldo acumulado ${BRL(balance)}.`);
  lines.push(`Médias mensais: receita ${BRL(avgMonthlyIncome)}, despesa ${BRL(avgMonthlyExpense)}, sobra ${BRL(avgMonthlySavings)}.`);
  if (topCats.length) lines.push(`Categorias que mais consomem: ${topCats.join("; ")}.`);
  if (topWeekdays.length) lines.push(`Dias da semana com maior gasto: ${topWeekdays.join("; ")}.`);
  if (bestMonth) lines.push(`Melhor mês (maior saldo): ${bestMonth.k} (${BRL(bestMonth.saldo)}).`);
  if (worstMonth && worstMonth.k !== bestMonth?.k) lines.push(`Pior mês (menor saldo): ${worstMonth.k} (${BRL(worstMonth.saldo)}).`);
  if (last3.length) lines.push(`Últimos meses:\n- ${last3.join("\n- ")}`);

  // Contas fixas
  if (bills.length) {
    const active = bills.filter((b) => b.active !== false);
    const monthly = active.reduce((s, b) => s + Number(b.amount || 0), 0);
    lines.push(`Contas fixas ativas (${active.length}): total mensal ${BRL(monthly)}. Itens: ${active.slice(0, 10).map((b) => `${b.title} ${BRL(Number(b.amount || 0))} (dia ${b.due_day ?? "?"})`).join("; ")}.`);
  }
  // Parcelamentos
  if (inst.length) {
    const pend = inst.reduce((s, i) => {
      const paid = Number(i.installments_paid || 0);
      const total = Number(i.installments_total || 0);
      const per = Number(i.amount || 0);
      return s + Math.max(0, total - paid) * per;
    }, 0);
    lines.push(`Parcelamentos em aberto (${inst.length}): valor restante estimado ${BRL(pend)}. Itens: ${inst.slice(0, 8).map((i) => `${i.title} ${i.installments_paid || 0}/${i.installments_total || 0} de ${BRL(Number(i.amount || 0))}`).join("; ")}.`);
  }
  // Dívidas
  if (debts.length) {
    const total = debts.reduce((s, d) => s + Number(d.amount || 0), 0);
    lines.push(`Dívidas (${debts.length}): total ${BRL(total)}. Itens: ${debts.slice(0, 8).map((d) => `${d.title || d.description || "dívida"} ${BRL(Number(d.amount || 0))}${d.creditor ? ` (${d.creditor})` : ""}`).join("; ")}.`);
  }
  // Metas
  if (goals.length) {
    lines.push(`Metas (${goals.length}): ${goals.slice(0, 8).map((g) => `${g.title} — atual ${BRL(Number(g.current_amount || 0))} / alvo ${BRL(Number(g.target_amount || 0))}${g.target_date ? ` até ${String(g.target_date).slice(0, 10)}` : ""}`).join("; ")}.`);
  }
  // Salário
  if (salary.length) {
    const totS = salary.reduce((s, r) => s + Number(r.amount || 0), 0);
    lines.push(`Salários registrados (${salary.length}): total ${BRL(totS)}.`);
  }

  return { hasData: true, summary: lines.join("\n") };
}
