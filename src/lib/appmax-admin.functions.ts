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

export const adminGetAppmaxCreds = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await ensureAdmin(supabase, userId);
    const { data } = await supabase
      .from("appmax_credentials")
      .select("id, client_id, client_secret, external_id, environment, updated_at")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data;
  });

export const adminSaveAppmaxCreds = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      client_id: z.string().min(3).max(200),
      client_secret: z.string().min(3).max(200),
      external_id: z.string().max(200).optional().default(""),
      environment: z.enum(["sandbox", "production"]),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await ensureAdmin(supabase, userId);
    const { data: existing } = await supabase
      .from("appmax_credentials")
      .select("id")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing) {
      const { error } = await supabase
        .from("appmax_credentials")
        .update({ ...data, updated_by: userId })
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase
        .from("appmax_credentials")
        .insert({ ...data, updated_by: userId });
      if (error) throw new Error(error.message);
    }
    const { invalidateAppmaxCredsCache } = await import("@/lib/appmax.server");
    invalidateAppmaxCredsCache();
    return { ok: true };
  });
