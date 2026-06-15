create table if not exists public.agent_oauth_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  refresh_token text not null,
  scope text,
  provider_account_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);

create table if not exists public.agent_oauth_states (
  state text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.agent_oauth_connections enable row level security;
alter table public.agent_oauth_states enable row level security;

create policy "Users can inspect their connector state"
on public.agent_oauth_connections for select
to authenticated
using ((select auth.uid()) = user_id);
