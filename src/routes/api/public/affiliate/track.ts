import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";

export const Route = createFileRoute("/api/public/affiliate/track")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await request.json().catch(() => ({}));
          const ref_code = String(body?.ref ?? "").trim().slice(0, 60);
          if (!ref_code) return Response.json({ ok: false }, { status: 400 });

          const url = process.env.SUPABASE_URL!;
          const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
          const supa = createClient(url, key, { auth: { persistSession: false } });

          const { data: aff } = await supa
            .from("affiliates")
            .select("id, code, status")
            .ilike("code", ref_code)
            .maybeSingle();
          if (!aff || aff.status !== "active") {
            return Response.json({ ok: false, reason: "invalid" }, { status: 200 });
          }

          const ip =
            request.headers.get("cf-connecting-ip") ||
            request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
            "";
          const ua = request.headers.get("user-agent") ?? "";
          const ip_hash = ip ? createHash("sha256").update(ip + "|" + ua).digest("hex").slice(0, 32) : null;

          const ua_l = ua.toLowerCase();
          const device = /mobile|android|iphone/.test(ua_l) ? "mobile" : /ipad|tablet/.test(ua_l) ? "tablet" : "desktop";
          const browser = /chrome/.test(ua_l) ? "chrome" : /safari/.test(ua_l) ? "safari" : /firefox/.test(ua_l) ? "firefox" : /edg/.test(ua_l) ? "edge" : "other";
          const os = /windows/.test(ua_l) ? "windows" : /android/.test(ua_l) ? "android" : /iphone|ipad|ios|mac os/.test(ua_l) ? "ios/mac" : /linux/.test(ua_l) ? "linux" : "other";

          const { data: click } = await supa.from("affiliate_clicks").insert({
            affiliate_id: aff.id,
            ref_code: aff.code,
            campaign_slug: body?.campaign ?? null,
            ip_hash,
            user_agent: ua.slice(0, 500),
            device,
            browser,
            os,
            source: body?.source ?? null,
            landing_path: String(body?.path ?? "").slice(0, 500) || null,
            referer: String(request.headers.get("referer") ?? "").slice(0, 500) || null,
            utm: body?.utm ?? null,
          }).select("id").maybeSingle();

          return Response.json({ ok: true, code: aff.code, click_id: click?.id ?? null });
        } catch (err: any) {
          return Response.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 });
        }
      },
    },
  },
});
