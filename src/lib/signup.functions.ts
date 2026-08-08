import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { phoneLookupVariants } from "@/lib/phone";

// Checagem pública (sem sessão) se já existe conta com esse celular — usada
// pelo signup pra mostrar um erro claro antes de tentar criar o usuário no
// Supabase Auth, cujo erro genérico ("Database error saving new user") vem
// do trigger que barra telefone duplicado em profiles.
export const checkPhoneTaken = createServerFn({ method: "GET" })
  .inputValidator((i) => z.object({ phone: z.string().min(8).max(20) }).parse(i))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: existing } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .in("phone", phoneLookupVariants(data.phone))
      .maybeSingle();
    return { taken: !!existing };
  });
