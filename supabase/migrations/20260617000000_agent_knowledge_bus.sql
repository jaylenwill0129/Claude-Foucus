-- Cross-agent learning bus. Every agent writes structured learnings here and
-- reads each other's, so the world learns autonomously. Maya (research) uses it
-- to hand efficient, machine-readable data to the rest of the agents.
create table public.agent_knowledge (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  agent text not null,                      -- who learned it (Maya/Marcus/Lena/Dev/Ledger/Hermes/Aria)
  audience text not null default 'all',     -- 'all' or a specific agent name
  kind text not null,                       -- research_digest | outcome | insight | signal
  topic text not null,
  insight text not null,                    -- human-readable summary
  data jsonb not null default '{}'::jsonb,  -- structured payload for efficient machine consumption
  confidence numeric(4,3) not null default 0.5 check (confidence between 0 and 1),
  created_at timestamptz not null default now()
);

create index agent_knowledge_owner_recent_idx on public.agent_knowledge (owner_id, created_at desc);
create index agent_knowledge_audience_idx on public.agent_knowledge (owner_id, audience, created_at desc);

alter table public.agent_knowledge enable row level security;

create policy "Operators read their agent knowledge"
on public.agent_knowledge for select to authenticated
using ((select auth.uid()) = owner_id);

create policy "Operators write their agent knowledge"
on public.agent_knowledge for insert to authenticated
with check ((select auth.uid()) = owner_id);

grant select, insert on public.agent_knowledge to authenticated;
