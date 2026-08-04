export type SubStatus = "active" | "trial" | "canceled";

export type AdminUser = {
  id: string;
  name: string;
  email: string;
  whatsapp: string;
  plan: string;
  status: SubStatus;
  joined: string;
  mrr: number;
  trialEndsIn?: number;
};

export type Transaction = {
  id: string;
  userId: string;
  date: string;
  description: string;
  category: string;
  amount: number;
  type: "income" | "expense";
  source: "whatsapp" | "dashboard";
};

export type Appointment = {
  id: string;
  userId: string;
  date: string;
  title: string;
  category: string;
};

export type WhatsAppMessage = {
  id: string;
  userId: string;
  time: string;
  from: "user" | "bot";
  text: string;
  audio?: boolean;
};

export const adminUsers: AdminUser[] = [
  { id: "u_001", name: "Marina Souza", email: "marina@abio.com", whatsapp: "+55 11 98123-4567", plan: "Individual 6 meses", status: "active", joined: "12/08/2026", mrr: 12.9 },
  { id: "u_002", name: "Rafael Lima", email: "rafa.lima@gmail.com", whatsapp: "+55 21 99876-1122", plan: "Casal 12 meses", status: "active", joined: "03/09/2026", mrr: 14.98 },
  { id: "u_003", name: "Beatriz Costa", email: "bea@costa.com", whatsapp: "+55 31 98555-7766", plan: "Trial", status: "trial", joined: "21/11/2026", mrr: 0, trialEndsIn: 3 },
  { id: "u_004", name: "João Pereira", email: "joao.p@hotmail.com", whatsapp: "+55 41 98444-2200", plan: "Individual Mensal", status: "canceled", joined: "01/06/2026", mrr: 0 },
  { id: "u_005", name: "Camila Reis", email: "camila.reis@me.com", whatsapp: "+55 11 97333-9911", plan: "Individual 12 meses", status: "active", joined: "18/04/2026", mrr: 9.98 },
  { id: "u_006", name: "Diego Alves", email: "diego@alvesdev.io", whatsapp: "+55 51 98222-1010", plan: "Trial", status: "trial", joined: "22/11/2026", mrr: 0, trialEndsIn: 5 },
  { id: "u_007", name: "Larissa Mendes", email: "lari@mendes.app", whatsapp: "+55 81 99111-7788", plan: "Individual 6 meses", status: "active", joined: "07/10/2026", mrr: 12.9 },
  { id: "u_008", name: "Eduardo Tavares", email: "edu.tavares@uol.com.br", whatsapp: "+55 11 98777-6543", plan: "Casal 6 meses", status: "active", joined: "30/07/2026", mrr: 19.0 },
];

export const transactions: Transaction[] = [
  { id: "t1", userId: "u_001", date: "23/11 09:12", description: "Mercado Pão de Açúcar", category: "Alimentação", amount: 50, type: "expense", source: "whatsapp" },
  { id: "t2", userId: "u_001", date: "23/11 10:03", description: "Freela design", category: "Freelance", amount: 2000, type: "income", source: "whatsapp" },
  { id: "t3", userId: "u_001", date: "22/11 19:40", description: "Uber", category: "Transporte", amount: 28.5, type: "expense", source: "whatsapp" },
  { id: "t4", userId: "u_001", date: "21/11 12:10", description: "Almoço", category: "Alimentação", amount: 42, type: "expense", source: "dashboard" },
  { id: "t5", userId: "u_002", date: "23/11 08:30", description: "Salário", category: "Trabalho", amount: 6500, type: "income", source: "dashboard" },
  { id: "t6", userId: "u_002", date: "22/11 22:15", description: "Cinema", category: "Lazer", amount: 80, type: "expense", source: "whatsapp" },
];

export const appointments: Appointment[] = [
  { id: "a1", userId: "u_001", date: "24/11 14:00", title: "Consulta médica", category: "Saúde" },
  { id: "a2", userId: "u_001", date: "26/11 19:30", title: "Jantar com Marina", category: "Lazer" },
  { id: "a3", userId: "u_002", date: "25/11 09:00", title: "Reunião cliente", category: "Trabalho" },
];

export const whatsappMessages: WhatsAppMessage[] = [
  { id: "m1", userId: "u_001", time: "09:12", from: "user", text: "Gastei 50 no mercado" },
  { id: "m2", userId: "u_001", time: "09:12", from: "bot", text: "Registrado: R$ 50,00 em Alimentação ✅" },
  { id: "m3", userId: "u_001", time: "10:03", from: "user", text: "Recebi 2000 de freela" },
  { id: "m4", userId: "u_001", time: "10:03", from: "bot", text: "Receita de R$ 2.000,00 registrada em Freelance 💸" },
  { id: "m5", userId: "u_001", time: "14:48", from: "user", text: "🎙️ Áudio (00:06)", audio: true },
  { id: "m6", userId: "u_001", time: "14:48", from: "bot", text: "Compromisso criado: Consulta amanhã às 14h 📅" },
  { id: "m7", userId: "u_002", time: "08:30", from: "user", text: "Recebi 6500 do salário" },
  { id: "m8", userId: "u_002", time: "08:30", from: "bot", text: "Receita de R$ 6.500,00 registrada ✅" },
];

export const statusLabel: Record<SubStatus, string> = {
  active: "Ativo",
  trial: "Teste",
  canceled: "Cancelado",
};

export const statusClasses: Record<SubStatus, string> = {
  active: "bg-primary/15 text-primary border border-primary/30",
  trial: "bg-accent/20 text-accent border border-accent/40",
  canceled: "bg-destructive/15 text-destructive border border-destructive/30",
};
