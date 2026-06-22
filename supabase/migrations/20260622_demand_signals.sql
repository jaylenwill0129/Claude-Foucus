-- Latent-demand "painkiller" research: real complaints/pains Maya mines (Reddit
-- public JSON from the edge fn, or live web search from the painkiller-web-research
-- scheduled task) -> validated product/offer opportunities for Cyrus (physical) and
-- Lena (digital). Mirrored to agent_knowledge (kind='opportunity') so producers act.
create table if not exists public.demand_signals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  source text not null default 'reddit',  -- reddit | web | synthesized
  niche text,
  pain text not null,
  evidence text,
  evidence_url text,
  audience text,
  acuteness int not null default 50,
  product_idea text not null,
  product_type text,            -- physical | digital
  build_agent text,             -- commerce | product
  status text not null default 'new',  -- new | actioned | dismissed
  created_at timestamptz not null default now()
);
create index if not exists demand_signals_owner_idx on public.demand_signals (owner_id, acuteness desc, created_at desc);
create unique index if not exists demand_signals_dedupe on public.demand_signals (owner_id, lower(product_idea));
alter table public.demand_signals enable row level security;
drop policy if exists "owner reads own signals" on public.demand_signals;
create policy "owner reads own signals" on public.demand_signals for select using (auth.uid() = owner_id);
-- writes via service_role only.
