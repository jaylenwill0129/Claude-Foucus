create table if not exists public.agent_prospects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  business_name text not null,
  website text,
  contact_route text,
  problem_evidence text not null,
  offer_fit text not null,
  status text not null default 'qualified',
  source text not null,
  source_record_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.agent_prospects enable row level security;

create policy "Users manage their prospects"
on public.agent_prospects for all
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);
