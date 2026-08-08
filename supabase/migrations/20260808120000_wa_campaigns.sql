-- Disparos em massa do WhatsApp: campanhas + destinatários, processados por
-- um watchdog (pg_cron) em lotes pequenos, em vez de um loop síncrono na
-- requisição do admin (mesmo motivo do wa-reprocess: evitar timeout).

create table if not exists public.wa_campaigns (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references auth.users(id) on delete set null,
  kind text not null check (kind in ('text','image')),
  message text,
  image_url text,
  caption text,
  total_recipients integer not null default 0,
  sent_count integer not null default 0,
  failed_count integer not null default 0,
  status text not null default 'queued' check (status in ('queued','processing','done')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger wa_campaigns_touch_updated_at
  before update on public.wa_campaigns
  for each row execute function public.touch_updated_at();

create table if not exists public.wa_campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.wa_campaigns(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  name text,
  phone text not null,
  status text not null default 'pending' check (status in ('pending','sent','failed')),
  error text,
  response jsonb,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (campaign_id, phone)
);

create index if not exists idx_wa_campaign_recipients_pending
  on public.wa_campaign_recipients (created_at)
  where status = 'pending';
create index if not exists idx_wa_campaign_recipients_campaign
  on public.wa_campaign_recipients (campaign_id);

alter table public.wa_campaigns enable row level security;
alter table public.wa_campaign_recipients enable row level security;

create policy "admins manage wa_campaigns" on public.wa_campaigns
  for all using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));
create policy "admins manage wa_campaign_recipients" on public.wa_campaign_recipients
  for all using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

-- Bucket público só para imagens de disparo (não é onde ficam comprovantes
-- recebidos dos usuários, esses continuam privados em outro fluxo).
insert into storage.buckets (id, name, public)
values ('wa-media', 'wa-media', true)
on conflict (id) do nothing;

create policy "wa-media public read"
  on storage.objects for select
  using (bucket_id = 'wa-media');

create policy "wa-media admin write"
  on storage.objects for insert
  with check (bucket_id = 'wa-media' and public.has_role(auth.uid(),'admin'));
