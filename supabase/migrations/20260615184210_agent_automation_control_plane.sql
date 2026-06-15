create table public.agent_automation_policies (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  paused boolean not null default false,
  allow_outreach boolean not null default false,
  allow_draft_products boolean not null default false,
  max_outreach_recipients integer not null default 5 check (max_outreach_recipients between 1 and 25),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  updated_at timestamptz not null default now()
);

create table public.agent_automation_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  agent text not null,
  action_type text not null,
  connector text not null check (connector in ('outreach', 'storefront', 'fulfillment')),
  risk_level text not null default 'low' check (risk_level in ('low', 'medium', 'high')),
  status text not null default 'queued' check (status in ('queued', 'awaiting_approval', 'running', 'succeeded', 'failed', 'cancelled')),
  payload jsonb not null default '{}'::jsonb,
  requires_approval boolean not null default true,
  approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  run_after timestamptz not null default now(),
  attempts integer not null default 0,
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  idempotency_key text not null,
  last_error text,
  provider_receipt jsonb,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, idempotency_key)
);

create index agent_automation_jobs_runnable_idx
on public.agent_automation_jobs (status, run_after)
where status in ('queued', 'running');

create table public.agent_automation_events (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid references public.agent_automation_jobs(id) on delete cascade,
  event_type text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.agent_automation_policies enable row level security;
alter table public.agent_automation_jobs enable row level security;
alter table public.agent_automation_events enable row level security;

create policy "Users manage their automation policy"
on public.agent_automation_policies for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users manage their automation jobs"
on public.agent_automation_jobs for all
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

create policy "Users read their automation events"
on public.agent_automation_events for select
to authenticated
using ((select auth.uid()) = owner_id);

grant select, insert, update, delete on public.agent_automation_policies to authenticated;
grant select, insert, update, delete on public.agent_automation_jobs to authenticated;
grant select on public.agent_automation_events to authenticated;

create or replace view public.agent_automation_summary
with (security_invoker = true) as
select
  owner_id,
  count(*) filter (where status in ('queued', 'running'))::bigint as active_jobs,
  count(*) filter (where status = 'awaiting_approval')::bigint as awaiting_approval,
  count(*) filter (where status = 'succeeded')::bigint as succeeded_jobs,
  count(*) filter (where status = 'failed')::bigint as failed_jobs,
  max(updated_at) as last_activity_at
from public.agent_automation_jobs
group by owner_id;

grant select on public.agent_automation_summary to authenticated;
