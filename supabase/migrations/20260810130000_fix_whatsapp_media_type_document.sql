-- Causa raiz do PDF "não reconhecido": a tabela whatsapp_messages nunca
-- permitiu media_type='document' no check constraint, embora o código do
-- webhook (src/routes/api/public/whatsapp.ts) já calculasse "document" pra
-- qualquer PDF/anexo detectado. Toda inserção de PDF violava o constraint,
-- o insert falhava silenciosamente (o webhook responde 200 pra Z-API de
-- qualquer forma) e a mensagem nunca chegava a ser processada — não é um
-- problema de entrega/roteamento nem de um número específico, afeta
-- QUALQUER usuário que mande um documento.
ALTER TABLE public.whatsapp_messages
  DROP CONSTRAINT IF EXISTS whatsapp_messages_media_type_check;
ALTER TABLE public.whatsapp_messages
  ADD CONSTRAINT whatsapp_messages_media_type_check
  CHECK (media_type IN ('text', 'audio', 'image', 'document', 'other'));
