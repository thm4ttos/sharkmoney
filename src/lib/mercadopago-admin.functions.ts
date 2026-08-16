import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function ensureAdmin(supabase: any, userId: string) {
  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Error("Forbidden");
}

export const adminGetMercadoPagoCreds = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await ensureAdmin(supabase, userId);
    const { data } = await supabase
      .from("mercadopago_credentials")
      .select("id, access_token, public_key, webhook_secret, environment, updated_at")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data;
  });

export const adminSaveMercadoPagoCreds = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      access_token: z.string().max(300).optional().default(""),
      public_key: z.string().max(300).optional().default(""),
      webhook_secret: z.string().max(300).optional().default(""),
      environment: z.enum(["sandbox", "production"]),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await ensureAdmin(supabase, userId);
    const { data: existing } = await supabase
      .from("mercadopago_credentials")
      .select("id")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing) {
      const { error } = await supabase
        .from("mercadopago_credentials")
        .update({ ...data, updated_by: userId })
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase
        .from("mercadopago_credentials")
        .insert({ ...data, updated_by: userId });
      if (error) throw new Error(error.message);
    }
    const { invalidateMercadoPagoCredsCache } = await import("@/lib/mercadopago.server");
    invalidateMercadoPagoCredsCache();
    return { ok: true };
  });

// Confirma que o Mercado Pago aceita o access_token salvo (chamada real de
// leitura, sem criar/alterar nada) sem nunca expor o token de volta pro admin.
export const adminTestMercadoPagoConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await ensureAdmin(supabase, userId);
    try {
      const { mpRequest, loadMercadoPagoCreds } = await import("@/lib/mercadopago.server");
      const creds = await loadMercadoPagoCreds();
      // /users/me é o endpoint mais simples de "quem sou eu" — só confirma
      // que o access_token é válido, sem efeito colateral nenhum.
      await mpRequest("GET", "/users/me");
      return { ok: true as const, environment: creds.environment };
    } catch (e: any) {
      return { ok: false as const, error: e?.message ?? "Falha desconhecida" };
    }
  });
