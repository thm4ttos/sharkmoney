export type WhatsappMedia = {
  text?: string;
  audioUrl?: string;
  imageUrl?: string;
  imageCaption?: string;
  documentUrl?: string;
  documentName?: string;
  documentMime?: string;
  hasDocument: boolean;
};

/** Normaliza os formatos de webhook usados pela Z-API/UAZAPI em um único lugar. */
export function extractWhatsappMedia(raw: any): WhatsappMedia {
  const envelope = raw?.data ?? raw ?? {};
  const msg = envelope?.message ?? raw?.message ?? envelope;
  const nested = msg?.message ?? {};
  const nestedDocument = nested?.documentMessage ??
    nested?.documentWithCaptionMessage?.message?.documentMessage ??
    msg?.documentMessage ?? msg?.documentWithCaptionMessage?.message?.documentMessage;
  const document = raw?.document ?? envelope?.document ?? msg?.document ?? nestedDocument;
  const messageType = String(
    raw?.messageType ?? envelope?.messageType ?? msg?.messageType ?? raw?.type ?? envelope?.type ?? "",
  ).toLowerCase();
  const documentName = document?.fileName ?? document?.filename ?? document?.title ??
    raw?.fileName ?? envelope?.fileName ?? msg?.fileName;
  const documentMime = document?.mimeType ?? document?.mimetype ?? document?.mime ??
    raw?.mimeType ?? envelope?.mimeType ?? msg?.mimeType ??
    (String(documentName ?? "").toLowerCase().endsWith(".pdf") ? "application/pdf" : undefined);
  const documentUrl = document?.documentUrl ?? document?.url ?? document?.downloadUrl ?? document?.mediaUrl ??
    raw?.file?.url ?? envelope?.file?.url ?? msg?.file?.url ??
    (messageType.includes("document") ? (msg?.mediaUrl ?? msg?.url ?? envelope?.mediaUrl ?? envelope?.url ?? raw?.mediaUrl ?? raw?.url) : undefined);
  const hasDocument = Boolean(
    document || documentUrl || messageType.includes("document") ||
    String(documentMime ?? "").toLowerCase().includes("pdf") ||
    String(documentName ?? "").toLowerCase().endsWith(".pdf"),
  );
  const text = raw?.text?.message ?? envelope?.text?.message ?? msg?.text?.message ??
    (typeof msg?.text === "string" ? msg.text : undefined) ?? msg?.body ??
    nested?.conversation ?? nested?.extendedTextMessage?.text;
  const audioUrl = raw?.audio?.audioUrl ?? envelope?.audio?.audioUrl ?? msg?.audio?.audioUrl ??
    msg?.audio?.url ?? nested?.audioMessage?.url ??
    (messageType === "audio" ? (msg?.mediaUrl ?? msg?.url ?? envelope?.mediaUrl ?? envelope?.url) : undefined);
  const imageUrl = raw?.image?.imageUrl ?? envelope?.image?.imageUrl ?? msg?.image?.imageUrl ??
    raw?.image?.url ?? envelope?.image?.url ?? msg?.image?.url ?? nested?.imageMessage?.url ??
    (messageType === "image" ? (msg?.mediaUrl ?? msg?.url ?? envelope?.mediaUrl ?? envelope?.url) : undefined);
  const imageCaption = raw?.image?.caption ?? envelope?.image?.caption ?? msg?.image?.caption ??
    nested?.imageMessage?.caption ?? document?.caption;

  return { text, audioUrl, imageUrl, imageCaption, documentUrl, documentName, documentMime, hasDocument };
}