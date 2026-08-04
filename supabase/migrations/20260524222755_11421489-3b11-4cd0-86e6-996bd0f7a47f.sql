
-- Roles
create type public.app_role as enum ('admin','user');

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique(user_id, role)
);
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

create policy "users see own roles" on public.user_roles for select
  using (auth.uid() = user_id or public.has_role(auth.uid(),'admin'));
create policy "admins manage roles" on public.user_roles for all
  using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

-- Profiles
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  phone text not null unique,
  email text,
  plan text not null default 'Trial 7 dias',
  trial_ends_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create policy "own profile select" on public.profiles for select
  using (auth.uid() = id or public.has_role(auth.uid(),'admin'));
create policy "own profile update" on public.profiles for update
  using (auth.uid() = id or public.has_role(auth.uid(),'admin'));
create policy "own profile insert" on public.profiles for insert
  with check (auth.uid() = id);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name, phone, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name',''),
    coalesce(new.raw_user_meta_data->>'phone', regexp_replace(coalesce(new.phone,''),'\D','','g')),
    new.email
  )
  on conflict (id) do nothing;
  insert into public.user_roles(user_id, role) values (new.id,'user') on conflict do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- Transactions
create type public.tx_kind as enum ('income','expense');

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind public.tx_kind not null,
  amount numeric(12,2) not null check (amount >= 0),
  category text not null default 'Outros',
  description text,
  occurred_at timestamptz not null default now(),
  source text not null default 'web',
  created_at timestamptz not null default now()
);
create index on public.transactions(user_id, occurred_at desc);
alter table public.transactions enable row level security;

create policy "tx own all" on public.transactions for all
  using (auth.uid() = user_id or public.has_role(auth.uid(),'admin'))
  with check (auth.uid() = user_id or public.has_role(auth.uid(),'admin'));

-- Appointments
create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  notes text,
  scheduled_at timestamptz not null,
  source text not null default 'web',
  created_at timestamptz not null default now()
);
create index on public.appointments(user_id, scheduled_at);
alter table public.appointments enable row level security;

create policy "appt own all" on public.appointments for all
  using (auth.uid() = user_id or public.has_role(auth.uid(),'admin'))
  with check (auth.uid() = user_id or public.has_role(auth.uid(),'admin'));

-- WhatsApp messages
create table public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  phone text not null,
  direction text not null check (direction in ('in','out')),
  media_type text not null default 'text' check (media_type in ('text','audio','image','other')),
  content text,
  transcription text,
  ai_intent text,
  ai_payload jsonb,
  raw jsonb,
  raw_message_id text unique,
  status text not null default 'received',
  created_at timestamptz not null default now()
);
create index on public.whatsapp_messages(user_id, created_at desc);
create index on public.whatsapp_messages(phone);
alter table public.whatsapp_messages enable row level security;

create policy "wa own select" on public.whatsapp_messages for select
  using (auth.uid() = user_id or public.has_role(auth.uid(),'admin'));
create policy "wa admin manage" on public.whatsapp_messages for all
  using (public.has_role(auth.uid(),'admin'))
  with check (public.has_role(auth.uid(),'admin'));
