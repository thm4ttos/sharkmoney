// Redireciona links curtos (?c=código) gerados por createShortLink.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/r")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const code = new URL(request.url).searchParams.get("c");
        if (!code) return new Response("Link inválido.", { status: 400 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data } = await supabaseAdmin
          .from("short_links")
          .select("target_url")
          .eq("code", code)
          .maybeSingle();

        if (!data?.target_url) return new Response("Link expirado ou inválido.", { status: 404 });
        return new Response(null, { status: 302, headers: { Location: data.target_url } });
      },
    },
  },
});
