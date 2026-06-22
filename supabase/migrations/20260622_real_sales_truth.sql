-- Revenue-truth: real paid orders pulled from Shopify (via the Shopify MCP, by the
-- 'revenue-truth-loop' scheduled task) so finance + the kaizen loop reason on actual
-- sales/margins/refunds, not estimates. The task also writes a 'revenue_digest' into
-- agent_knowledge so every agent sees ground-truth revenue via the shared bus.
create table if not exists public.real_sales (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  order_id text not null,
  order_name text,
  total_usd numeric not null default 0,
  currency text not null default 'USD',
  financial_status text,
  fulfillment_status text,
  customer_email text,
  ordered_at timestamptz,
  recorded_at timestamptz not null default now(),
  unique (owner_id, order_id)
);
create index if not exists real_sales_owner_idx on public.real_sales (owner_id, ordered_at desc);
alter table public.real_sales enable row level security;
drop policy if exists "owner reads own sales" on public.real_sales;
create policy "owner reads own sales" on public.real_sales for select using (auth.uid() = owner_id);
-- writes via service_role only.
