-- A Appmax exige um fluxo de instalação separado (POST /app/authorize ->
-- redirecionamento manual -> POST /app/client/generate) pra trocar as
-- credenciais de nível de APP (só autorizam a instalação) por credenciais
-- de nível de MERCHANT (as únicas que funcionam em /v1/customers, /v1/orders
-- etc.) — descoberto ao testar o checkout em sandbox e receber
-- "404 Merchant not found". `app_id` é o UUID do app (aba "Identificação"
-- no painel da Appmax), exigido pra chamar /app/authorize.
ALTER TABLE public.appmax_credentials
  ADD COLUMN IF NOT EXISTS app_id text;
