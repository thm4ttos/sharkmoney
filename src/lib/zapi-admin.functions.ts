import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normalizePhone } from "@/lib/phone";

async function ensureAdmin(supabase: any, userId: string) {
  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Error("Forbidden");
}

async function getCreds(supabase: any) {
  const { data } = await supabase
    .from("zapi_credentials")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (data) {
    return {
      instanceId: data.instance_id as string,
      instanceToken: data.instance_token as string,
      clientToken: data.client_token as string,
    };
  }
  // fallback aos secrets já existentes
  const base = process.env.UAZAPI_BASE_URL ?? "";
  const m = base.match(/instances\/([^/]+)\/token\/([^/]+)/);
  return {
    instanceId: m?.[1] ?? "",
    instanceToken: m?.[2] ?? "",
    clientToken: process.env.UAZAPI_INSTANCE_TOKEN ?? "",
  };
}

// ===== Credenciais =====
export const adminGetZapiCreds = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await ensureAdmin(supabase, userId);
    const { data } = await supabase
      .from("zapi_credentials")
      .select("id, instance_id, instance_token, client_token, updated_at")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data;
  });

export const adminSaveZapiCreds = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      instance_id: z.string().min(3).max(120),
      instance_token: z.string().min(3).max(200),
      client_token: z.string().min(3).max(200),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await ensureAdmin(supabase, userId);
    const { data: existing } = await supabase
      .from("zapi_credentials")
      .select("id")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing) {
      const { error } = await supabase
        .from("zapi_credentials")
        .update({ ...data, updated_by: userId })
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase
        .from("zapi_credentials")
        .insert({ ...data, updated_by: userId });
      if (error) throw new Error(error.message);
    }
    const { invalidateZapiCredsCache } = await import("@/lib/uazapi.server");
    invalidateZapiCredsCache();
    return { ok: true };
  });

// ===== Contatos =====
// Fonte oficial: base de usuários (profiles), não uma lista paralela.
// Qualquer cadastro/edição de nome ou telefone no Abio reflete aqui na hora,
// sem precisar recadastrar nada no painel.
export const adminListWaContacts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await ensureAdmin(supabase, userId);
    const { data, error } = await supabase
      .from("profiles")
      .select("id, name, phone, status")
      .not("phone", "is", null)
      .neq("phone", "")
      .order("name", { ascending: true })
      .limit(2000);
    if (error) throw new Error(error.message);
    return (data ?? []).map((p: any) => ({
      id: p.id,
      user_id: p.id,
      name: p.name?.trim() || null,
      phone: normalizePhone(p.phone),
      blocked: p.status === "blocked",
    }));
  });

export const adminCreateWaContact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      name: z.string().trim().max(120).default(""),
      phone: z.string().trim().min(10).max(20),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await ensureAdmin(supabase, userId);
    const phone = normalizePhone(data.phone);
    if (phone.length < 12 || phone.length > 13) {
      throw new Error("Telefone inválido. Use DDI 55 + DDD + número.");
    }
    const { data: row, error } = await supabase
      .from("wa_contacts")
      .insert({ name: data.name, phone, created_by: userId })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const adminDeleteWaContact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await ensureAdmin(supabase, userId);
    const { error } = await supabase.from("wa_contacts").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ===== Upload de imagem para disparo =====
// Recebe a imagem como data URL (base64) do navegador e guarda no bucket
// público wa-media — a Z-API precisa de uma URL pública pra buscar a imagem.
export const adminUploadWaImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      fileName: z.string().min(1).max(200),
      dataUrl: z.string().min(20).max(10_000_000),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await ensureAdmin(supabase, userId);

    const match = /^data:([^;]+);base64,(.+)$/.exec(data.dataUrl);
    if (!match) throw new Error("Formato de imagem inválido.");
    const mime = match[1];
    if (!mime.startsWith("image/")) throw new Error("Apenas imagens são permitidas.");
    const bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));
    if (bytes.byteLength > 8_000_000) throw new Error("Imagem muito grande (máx. 8MB).");

    const ext = (data.fileName.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
    const path = `broadcasts/${userId}/${Date.now()}-${crypto.randomUUID()}.${ext}`;

    const { error } = await supabase.storage.from("wa-media").upload(path, bytes, {
      contentType: mime,
      upsert: false,
    });
    if (error) throw new Error(error.message);

    const { data: pub } = supabase.storage.from("wa-media").getPublicUrl(path);
    return { url: pub.publicUrl };
  });

// ===== Campanhas (disparo em massa via fila) =====
const campaignInput = z.object({
  kind: z.enum(["text", "image"]),
  message: z.string().max(4000).optional(),
  image_url: z.string().url().max(2000).optional(),
  caption: z.string().max(1000).optional(),
  recipients: z.array(z.object({
    phone: z.string().min(10).max(20),
    user_id: z.string().uuid().optional(),
    name: z.string().max(120).optional(),
  })).min(1).max(5000),
});

export const adminCreateWaCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => campaignInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await ensureAdmin(supabase, userId);
    if (data.kind === "text" && !data.message?.trim()) {
      throw new Error("Mensagem é obrigatória para envio de texto.");
    }
    if (data.kind === "image" && !data.image_url?.trim()) {
      throw new Error("Imagem é obrigatória.");
    }

    // Normaliza + deduplica (defesa em profundidade — o cliente já dedupe).
    const byPhone = new Map<string, { phone: string; user_id?: string; name?: string }>();
    for (const r of data.recipients) {
      const phone = normalizePhone(r.phone);
      if (phone.length < 12 || phone.length > 13) continue; // ignora número claramente inválido
      if (!byPhone.has(phone)) byPhone.set(phone, { phone, user_id: r.user_id, name: r.name });
    }
    const recipients = [...byPhone.values()];
    if (recipients.length === 0) throw new Error("Nenhum número válido selecionado.");

    const { data: campaign, error: campErr } = await supabase
      .from("wa_campaigns")
      .insert({
        created_by: userId,
        kind: data.kind,
        message: data.message ?? null,
        image_url: data.image_url ?? null,
        caption: data.caption ?? null,
        total_recipients: recipients.length,
      })
      .select("id")
      .single();
    if (campErr) throw new Error(campErr.message);

    const rows = recipients.map((r) => ({
      campaign_id: campaign.id,
      phone: r.phone,
      user_id: r.user_id ?? null,
      name: r.name ?? null,
    }));
    // Insere em lotes de 500 (limite de payload razoável).
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabase.from("wa_campaign_recipients").insert(rows.slice(i, i + 500));
      if (error) throw new Error(error.message);
    }

    // Processa o primeiro lote na hora — dá feedback imediato pra envios
    // pequenos (o caso comum). Campanhas grandes continuam pelo watchdog.
    try {
      const { processWaBroadcastBatch } = await import("@/lib/wa-broadcast.server");
      await processWaBroadcastBatch(20);
    } catch (e) {
      console.error("[adminCreateWaCampaign] first batch failed", e);
    }

    return { campaignId: campaign.id as string, total: recipients.length };
  });

export const adminGetCampaignStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ campaignId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await ensureAdmin(supabase, userId);
    const { data: c, error } = await supabase
      .from("wa_campaigns")
      .select("id, kind, status, total_recipients, sent_count, failed_count, created_at")
      .eq("id", data.campaignId)
      .single();
    if (error) throw new Error(error.message);
    return {
      ...c,
      pending: Math.max(0, c.total_recipients - c.sent_count - c.failed_count),
    };
  });

export const adminListWaCampaigns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await ensureAdmin(supabase, userId);
    const { data, error } = await supabase
      .from("wa_campaigns")
      .select("id, kind, message, image_url, caption, status, total_recipients, sent_count, failed_count, created_at, created_by")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return (data ?? []).map((c: any) => ({
      ...c,
      pending: Math.max(0, c.total_recipients - c.sent_count - c.failed_count),
    }));
  });

export const adminGetCampaignRecipients = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ campaignId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await ensureAdmin(supabase, userId);
    const { data: rows, error } = await supabase
      .from("wa_campaign_recipients")
      .select("id, phone, name, status, error, sent_at, created_at")
      .eq("campaign_id", data.campaignId)
      .order("created_at", { ascending: true })
      .limit(5000);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

// ===== Envio (legado — mantido pra não quebrar integrações existentes) =====
async function zapiSend(
  creds: { instanceId: string; instanceToken: string; clientToken: string },
  endpoint: "send-text" | "send-image",
  body: Record<string, unknown>,
) {
  if (!creds.instanceId || !creds.instanceToken || !creds.clientToken) {
    throw new Error("Credenciais Z-API não configuradas.");
  }
  const url = `https://api.z-api.io/instances/${creds.instanceId}/token/${creds.instanceToken}/${endpoint}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Client-Token": creds.clientToken,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* ignore */ }
  if (!res.ok) {
    throw new Error(`Z-API ${res.status}: ${text.slice(0, 300)}`);
  }
  return json ?? { raw: text };
}

const sendInput = z.object({
  phones: z.array(z.string().min(10).max(20)).min(1).max(500),
  kind: z.enum(["text", "image"]),
  message: z.string().max(4000).optional(),
  image_url: z.string().url().max(2000).optional(),
  caption: z.string().max(1000).optional(),
});

export const adminSendBroadcast = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => sendInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await ensureAdmin(supabase, userId);
    if (data.kind === "text" && !data.message?.trim()) {
      throw new Error("Mensagem é obrigatória para envio de texto.");
    }
    if (data.kind === "image" && !data.image_url?.trim()) {
      throw new Error("URL da imagem é obrigatória.");
    }
    const creds = await getCreds(supabase);
    const results: Array<{ phone: string; ok: boolean; error?: string }> = [];
    for (const raw of data.phones) {
      const phone = normalizePhone(raw);
      let ok = false;
      let err: string | undefined;
      let response: any = null;
      try {
        if (data.kind === "text") {
          response = await zapiSend(creds, "send-text", { phone, message: data.message });
        } else {
          response = await zapiSend(creds, "send-image", {
            phone,
            image: data.image_url,
            caption: data.caption ?? "",
          });
        }
        ok = true;
      } catch (e: any) {
        err = e?.message ?? "Erro desconhecido";
      }
      await supabase.from("wa_broadcasts").insert({
        phone,
        kind: data.kind,
        content: data.message ?? null,
        image_url: data.image_url ?? null,
        caption: data.caption ?? null,
        status: ok ? "sent" : "error",
        error: err ?? null,
        response: response ?? null,
        sent_by: userId,
      });
      results.push({ phone, ok, error: err });
    }
    return { results };
  });

export const adminListBroadcasts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await ensureAdmin(supabase, userId);
    const { data, error } = await supabase
      .from("wa_broadcasts")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

// ===== Timeline unificado: disparos + webhooks recebidos + respostas do bot =====
export const adminListWhatsappTimeline = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await ensureAdmin(supabase, userId);
    const [bcRes, msgRes] = await Promise.all([
      supabase
        .from("wa_broadcasts")
        .select("id, created_at, phone, kind, content, image_url, caption, status, error, response")
        .order("created_at", { ascending: false })
        .limit(150),
      supabase
        .from("whatsapp_messages")
        .select("id, created_at, phone, direction, media_type, content, transcription, ai_intent, ai_payload, status, raw")
        .order("created_at", { ascending: false })
        .limit(150),
    ]);
    if (bcRes.error) throw new Error(bcRes.error.message);
    if (msgRes.error) throw new Error(msgRes.error.message);

    type Item = {
      id: string;
      when: string;
      kind: "broadcast" | "in" | "out";
      phone: string;
      media: string;
      content: string | null;
      status: string;
      error: string | null;
      detail: any;
    };
    const items: Item[] = [];
    for (const b of bcRes.data ?? []) {
      items.push({
        id: `b-${b.id}`,
        when: b.created_at as string,
        kind: "broadcast",
        phone: b.phone,
        media: b.kind,
        content: b.content ?? b.caption ?? b.image_url ?? null,
        status: b.status,
        error: b.error,
        detail: { image_url: b.image_url, caption: b.caption, response: b.response },
      });
    }
    for (const m of msgRes.data ?? []) {
      items.push({
        id: `m-${m.id}`,
        when: m.created_at as string,
        kind: m.direction === "in" ? "in" : "out",
        phone: m.phone,
        media: m.media_type,
        content: m.transcription ?? m.content ?? null,
        status: m.status,
        error: null,
        detail: { ai_intent: m.ai_intent, ai_payload: m.ai_payload, raw: m.raw },
      });
    }
    items.sort((a, b) => (a.when < b.when ? 1 : -1));
    return items.slice(0, 250);
  });

// ===== Diagnóstico da instância =====
async function zapiGet(creds: { instanceId: string; instanceToken: string; clientToken: string }, path: string) {
  if (!creds.instanceId || !creds.instanceToken || !creds.clientToken) {
    throw new Error("Credenciais Z-API não configuradas.");
  }
  const url = `https://api.z-api.io/instances/${creds.instanceId}/token/${creds.instanceToken}/${path}`;
  const res = await fetch(url, { headers: { "Client-Token": creds.clientToken } });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* ignore */ }
  return { ok: res.ok, status: res.status, data: json ?? { raw: text } };
}

export const adminGetZapiStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await ensureAdmin(supabase, userId);
    const creds = await getCreds(supabase);
    return zapiGet(creds, "status");
  });

export const adminGetZapiDevice = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await ensureAdmin(supabase, userId);
    const creds = await getCreds(supabase);
    return zapiGet(creds, "device");
  });
