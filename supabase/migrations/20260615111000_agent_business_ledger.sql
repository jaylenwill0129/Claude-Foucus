create table if not exists public.agent_revenue_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null unique,
  event_type text not null,
  amount_cents bigint not null default 0,
  currency text not null default 'usd',
  customer_ref text,
  payment_ref text,
  status text not null,
  occurred_at timestamptz not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.agent_revenue_events enable row level security;

create policy "Authenticated users can read verified revenue"
on public.agent_revenue_events for select
to authenticated
using (true);

create or replace view public.agent_revenue_summary
with (security_invoker = true) as
select
  coalesce(sum(
    case
      when event_type in ('checkout.session.completed', 'payment_intent.succeeded', 'charge.succeeded') then amount_cents
      when event_type in ('charge.refunded', 'refund.created') then -amount_cents
      else 0
    end
  ), 0)::bigint as net_revenue_cents,
  count(distinct customer_ref) filter (where customer_ref is not null) as verified_customers,
  count(*) as verified_events,
  max(occurred_at) as last_event_at
from public.agent_revenue_events;

grant select on public.agent_revenue_summary to authenticated;
