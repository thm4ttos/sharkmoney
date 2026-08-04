import {
  Home, ShoppingCart, Car, Heart, GraduationCap, Smile, User,
  TrendingUp, Church, Briefcase, MoreHorizontal, type LucideIcon
} from "lucide-react";

export type CategoryGroup = {
  key: string;
  name: string;
  description: string;
  icon: LucideIcon;
  color: string; // tailwind color class
  categories: string[];
};

export const categoryGroups: CategoryGroup[] = [
  { key: "moradia", name: "Moradia", description: "Despesas com habitação", icon: Home, color: "text-emerald-400",
    categories: ["Aluguel", "Condomínio", "Energia Elétrica", "Água", "Gás", "Internet", "Manutenção"] },
  { key: "alimentacao", name: "Alimentação", description: "Gastos com alimentação", icon: ShoppingCart, color: "text-amber-400",
    categories: ["Mercado", "Restaurante", "Delivery", "Padaria"] },
  { key: "transporte", name: "Transporte", description: "Despesas com locomoção", icon: Car, color: "text-orange-400",
    categories: ["Combustível", "Uber/99", "Transporte público", "Estacionamento", "Manutenção", "IPVA"] },
  { key: "saude", name: "Saúde", description: "Cuidados com saúde", icon: Heart, color: "text-rose-400",
    categories: ["Plano de Saúde", "Farmácia", "Consultas", "Exames", "Dentista", "Terapia"] },
  { key: "educacao", name: "Educação", description: "Investimento em conhecimento", icon: GraduationCap, color: "text-brand-blue-light",
    categories: ["Faculdade", "Cursos", "Livros", "Idiomas", "Materiais"] },
  { key: "lazer", name: "Lazer", description: "Entretenimento e diversão", icon: Smile, color: "text-yellow-400",
    categories: ["Cinema", "Streaming", "Viagens", "Bares", "Eventos", "Hobbies"] },
  { key: "pessoal", name: "Pessoal", description: "Cuidados pessoais", icon: User, color: "text-pink-400",
    categories: ["Vestuário", "Salão", "Estética", "Presentes"] },
  { key: "investimentos", name: "Investimentos", description: "Aplicações financeiras", icon: TrendingUp, color: "text-emerald-400",
    categories: ["Renda Fixa", "Renda Variável", "Previdência", "Reserva de Emergência"] },
  { key: "espiritual", name: "Vida Espiritual", description: "Dízimos e ofertas", icon: Church, color: "text-amber-300",
    categories: ["Dízimo", "Oferta", "Doações", "Retiros"] },
  { key: "empresa", name: "Empresa e Autônomo", description: "Despesas empresariais", icon: Briefcase, color: "text-brand-blue-light",
    categories: ["Impostos", "Software", "Marketing", "Equipamentos", "Honorários", "Funcionários"] },
  { key: "outros", name: "Outros", description: "Despesas diversas", icon: MoreHorizontal, color: "text-slate-300",
    categories: ["Outros", "Imprevistos", "Taxas", "Sem categoria"] },
];

export type Tx = {
  id: string;
  date: string; // yyyy-mm-dd
  desc: string;
  group: string;
  category: string;
  amount: number;
  type: "income" | "expense";
  source: "whatsapp" | "manual";
};

export const userTransactions: Tx[] = [
  { id: "t1", date: "2026-05-17", desc: "Mercado Pão de Açúcar", group: "alimentacao", category: "Mercado", amount: 287.4, type: "expense", source: "whatsapp" },
  { id: "t2", date: "2026-05-17", desc: "Freela design", group: "empresa", category: "Honorários", amount: 2000, type: "income", source: "whatsapp" },
  { id: "t3", date: "2026-05-16", desc: "Uber", group: "transporte", category: "Uber/99", amount: 28.5, type: "expense", source: "whatsapp" },
  { id: "t4", date: "2026-05-16", desc: "Salário", group: "empresa", category: "Honorários", amount: 6500, type: "income", source: "manual" },
  { id: "t5", date: "2026-05-15", desc: "Aluguel", group: "moradia", category: "Aluguel", amount: 1800, type: "expense", source: "manual" },
  { id: "t6", date: "2026-05-14", desc: "Netflix", group: "lazer", category: "Streaming", amount: 39.9, type: "expense", source: "whatsapp" },
  { id: "t7", date: "2026-05-13", desc: "Farmácia", group: "saude", category: "Farmácia", amount: 86.2, type: "expense", source: "whatsapp" },
  { id: "t8", date: "2026-05-12", desc: "Restaurante japonês", group: "alimentacao", category: "Restaurante", amount: 162, type: "expense", source: "whatsapp" },
  { id: "t9", date: "2026-05-11", desc: "Curso de inglês", group: "educacao", category: "Idiomas", amount: 220, type: "expense", source: "manual" },
  { id: "t10", date: "2026-05-10", desc: "Consultoria avulsa", group: "empresa", category: "Honorários", amount: 850, type: "income", source: "whatsapp" },
  { id: "t11", date: "2026-05-09", desc: "Posto Shell", group: "transporte", category: "Combustível", amount: 230, type: "expense", source: "whatsapp" },
  { id: "t12", date: "2026-05-08", desc: "Cinema", group: "lazer", category: "Cinema", amount: 64, type: "expense", source: "whatsapp" },
  { id: "t13", date: "2026-05-06", desc: "Mercado Carrefour", group: "alimentacao", category: "Mercado", amount: 412.8, type: "expense", source: "whatsapp" },
  { id: "t14", date: "2026-05-05", desc: "Plano de saúde", group: "saude", category: "Plano de Saúde", amount: 540, type: "expense", source: "manual" },
];

export type Compromisso = {
  id: string;
  date: string;
  time: string;
  title: string;
  group: string;
};

export const userAppointments: Compromisso[] = [
  { id: "a1", date: "2026-05-19", time: "14:00", title: "Consulta médica", group: "saude" },
  { id: "a2", date: "2026-05-20", time: "09:00", title: "Reunião cliente", group: "empresa" },
  { id: "a3", date: "2026-05-22", time: "19:30", title: "Jantar com Marina", group: "lazer" },
  { id: "a4", date: "2026-05-25", time: "08:00", title: "Pagar boleto luz", group: "moradia" },
];

export function formatBRL(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function monthLabel(date = new Date()) {
  return date.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

export function groupOf(key: string) {
  return categoryGroups.find((g) => g.key === key) ?? categoryGroups[categoryGroups.length - 1];
}
