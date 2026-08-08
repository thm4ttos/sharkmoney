-- Encurtador de links próprio (domínio abio.fun) — usado hoje pro link de
-- recuperação de senha enviado por WhatsApp, que sem isso é um JWT gigante
-- e parece spam. Só o backend (service role) acessa essa tabela.
create table if not exists public.short_links (
  code text primary key,
  target_url text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_short_links_created_at on public.short_links (created_at);

alter table public.short_links enable row level security;
-- Sem policies: nenhum acesso via anon/authenticated, só supabaseAdmin (service role) no backend.
