-- Hermes world-intelligence memory.
-- Each row is one reasoning pass Hermes made over the live control plane.
-- Persisting them gives Hermes a memory loop: it reads prior briefs as context,
-- so it can tell whether a bottleneck it named earlier actually resolved and
-- adjust its routing toward profit and efficiency over time.

create table public.agent_hermes_briefs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  model text not null,
  mood text not null,
  headline text not null,
  bottleneck text not null,
  route text not null,
  intelligence_score integer not null default 0 check (intelligence_score between 0 and 100),
  confidence numeric(4, 3) not null default 0 check (confidence between 0 and 1),
  agent_routes jsonb not null default '[]'::jsonb,
  display_upgrade text,
  reasoning text,
  world_state jsonb not null default '{}'::jsonb,
  prompt_tokens integer not null default 0,
  completion_tokens integer not null default 0,
  latency_ms integer not null default 0,
  created_at timestamptz not null default now()
);

create index agent_hermes_briefs_owner_recent_idx
on public.agent_hermes_briefs (owner_id, created_at desc);

alter table public.agent_hermes_briefs enable row level security;

-- The edge function writes with the service role. Operators may read their own
-- history; inserts/updates/deletes stay server-side only.
create policy "Operators read their Hermes briefs"
on public.agent_hermes_briefs for select
to authenticated
using ((select auth.uid()) = owner_id);

grant select on public.agent_hermes_briefs to authenticated;

create or replace view public.agent_hermes_latest_brief
with (security_invoker = true) as
select distinct on (owner_id)
  owner_id,
  id,
  model,
  mood,
  headline,
  bottleneck,
  route,
  intelligence_score,
  confidence,
  agent_routes,
  display_upgrade,
  reasoning,
  created_at
from public.agent_hermes_briefs
order by owner_id, created_at desc;

grant select on public.agent_hermes_latest_brief to authenticated;
