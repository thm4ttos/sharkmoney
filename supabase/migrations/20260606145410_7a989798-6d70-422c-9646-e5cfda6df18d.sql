
CREATE TABLE public.ai_settings (
  id integer PRIMARY KEY CHECK (id = 1),
  api_key text,
  model text NOT NULL DEFAULT 'gpt-4o',
  enabled boolean NOT NULL DEFAULT true,
  last_used_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

GRANT ALL ON public.ai_settings TO service_role;

ALTER TABLE public.ai_settings ENABLE ROW LEVEL SECURITY;

INSERT INTO public.ai_settings (id, model, enabled) VALUES (1, 'gpt-4o', true)
ON CONFLICT (id) DO NOTHING;
