// SERVER-ONLY. Encurtador de links próprio, hospedado em abio.fun — evita
// mandar URLs gigantes (tokens de recuperação de senha etc.) por WhatsApp,
// que parecem spam/phishing pro usuário.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"; // sem 0/O/1/l/I

function randomCode(len = 8): string {
  let s = "";
  for (let i = 0; i < len; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

/** Cria um link curto abio.fun/api/public/r?c=XXXX que redireciona para targetUrl. */
export async function createShortLink(targetUrl: string): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    const { error } = await supabaseAdmin.from("short_links").insert({ code, target_url: targetUrl });
    if (!error) return `https://abio.fun/api/public/r?c=${code}`;
    if (!/duplicate|unique/i.test(error.message)) throw new Error(error.message);
  }
  throw new Error("Falha ao gerar link curto.");
}
