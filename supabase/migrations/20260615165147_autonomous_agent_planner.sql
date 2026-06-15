alter table public.agent_automation_policies
  add column if not exists allow_crm_sync boolean not null default true,
  add column if not exists prospect_keywords text not null default 'home services contractors follow up',
  add column if not exists last_planned_at timestamptz;

alter table public.agent_automation_jobs
  drop constraint if exists agent_automation_jobs_connector_check;

alter table public.agent_automation_jobs
  add constraint agent_automation_jobs_connector_check
  check (connector in ('crm', 'outreach', 'storefront', 'fulfillment'));

create index if not exists agent_automation_jobs_owner_status_idx
on public.agent_automation_jobs (owner_id, status, created_at desc);

create index if not exists agent_automation_policies_enabled_idx
on public.agent_automation_policies (enabled, paused)
where enabled = true;
