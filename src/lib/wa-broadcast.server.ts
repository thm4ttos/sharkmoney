// SERVER-ONLY. Processa a fila de disparos em massa (wa_campaign_recipients)
// em lotes pequenos — chamado tanto pelo admin (primeiro lote, síncrono, pra
// dar feedback rápido em envios pequenos) quanto pelo watchdog em cron
// (lotes seguintes, pra campanhas grandes), mesmo padrão do wa-reprocess:
// nunca mandar tudo de uma vez dentro de uma única requisição.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendWhatsAppText, sendWhatsAppImage } from "@/lib/uazapi.server";

export type ProcessBatchResult = { processed: number; sent: number; failed: number };

export async function processWaBroadcastBatch(limit = 20): Promise<ProcessBatchResult> {
  const { data: pending, error } = await supabaseAdmin
    .from("wa_campaign_recipients")
    .select("id, campaign_id, phone, wa_campaigns(id, kind, message, image_url, caption, status)")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) throw new Error(error.message);
  if (!pending || pending.length === 0) return { processed: 0, sent: 0, failed: 0 };

  const touchedCampaigns = new Set<string>();
  let sent = 0, failed = 0;

  for (const row of pending as any[]) {
    const campaign = row.wa_campaigns;
    touchedCampaigns.add(row.campaign_id);

    if (campaign?.status === "queued") {
      await supabaseAdmin.from("wa_campaigns").update({ status: "processing" }).eq("id", row.campaign_id).eq("status", "queued");
    }

    let result;
    if (campaign?.kind === "image") {
      result = await sendWhatsAppImage(row.phone, campaign.image_url, campaign.caption ?? undefined);
    } else {
      result = await sendWhatsAppText(row.phone, campaign?.message ?? "");
    }

    if (result.ok) {
      sent++;
      await supabaseAdmin.from("wa_campaign_recipients").update({
        status: "sent", response: result.response ?? null, sent_at: new Date().toISOString(), error: null,
      }).eq("id", row.id);
      const { data: c } = await supabaseAdmin.from("wa_campaigns").select("sent_count").eq("id", row.campaign_id).maybeSingle();
      await supabaseAdmin.from("wa_campaigns").update({ sent_count: (c?.sent_count ?? 0) + 1 }).eq("id", row.campaign_id);
    } else {
      failed++;
      await supabaseAdmin.from("wa_campaign_recipients").update({
        status: "failed", error: result.error ?? "Falha desconhecida", response: result.response ?? null,
      }).eq("id", row.id);
      const { data: c } = await supabaseAdmin.from("wa_campaigns").select("failed_count").eq("id", row.campaign_id).maybeSingle();
      await supabaseAdmin.from("wa_campaigns").update({ failed_count: (c?.failed_count ?? 0) + 1 }).eq("id", row.campaign_id);
    }
  }

  // Fecha campanhas sem mais pendentes.
  for (const campaignId of touchedCampaigns) {
    const { count } = await supabaseAdmin
      .from("wa_campaign_recipients")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .eq("status", "pending");
    if (!count) {
      await supabaseAdmin.from("wa_campaigns").update({ status: "done" }).eq("id", campaignId);
    }
  }

  return { processed: pending.length, sent, failed };
}
