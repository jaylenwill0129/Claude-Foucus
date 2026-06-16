-- Aria's creative studio output. Each row is one approval-ready release package
-- prepared by the creative preparation loop. Nothing here is ever auto-posted:
-- packages stay in 'awaiting_approval' until an operator promotes them, and
-- external publishing requires a separate gated action with a provider receipt.

create table public.agent_creative_packages (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  model text not null,
  title text not null,
  trend_cluster jsonb not null default '{}'::jsonb,
  track jsonb not null default '{}'::jsonb,
  visual jsonb not null default '{}'::jsonb,
  caption text not null default '',
  hashtags jsonb not null default '[]'::jsonb,
  pending_providers jsonb not null default '[]'::jsonb,
  status text not null default 'awaiting_approval'
    check (status in ('awaiting_approval', 'approved', 'rejected', 'published')),
  reasoning text,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create index agent_creative_packages_owner_recent_idx
on public.agent_creative_packages (owner_id, created_at desc);

alter table public.agent_creative_packages enable row level security;

-- The edge function writes with the service role. Operators read their own
-- packages and may update status (approve/reject) on their own rows.
create policy "Operators read their creative packages"
on public.agent_creative_packages for select
to authenticated
using ((select auth.uid()) = owner_id);

create policy "Operators decide their creative packages"
on public.agent_creative_packages for update
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

grant select, update on public.agent_creative_packages to authenticated;
