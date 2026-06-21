-- Token-free publish queue. The autonomous brain (autopublish/Hermes) writes
-- competitively-validated winning products here; a scheduled publisher (the
-- Shopify MCP OAuth connection, via the 'cyrus-shopify-publisher' scheduled task)
-- drains pending rows to the live store. No shpat_ Admin API token required.
create table if not exists public.product_drafts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  title text not null,
  description_html text not null default '',
  product_type text not null default 'General',
  price_usd numeric not null default 0,
  sku text,
  tags text[] not null default '{}',
  competitor jsonb not null default '{}'::jsonb,
  winning_traits jsonb not null default '{}'::jsonb,
  advantage text,
  est_net_margin_pct numeric,
  status text not null default 'pending_publish', -- pending_publish | published | failed | skipped
  shopify_product_id text,
  error text,
  created_at timestamptz not null default now(),
  published_at timestamptz
);
create index if not exists product_drafts_status_idx on public.product_drafts (status, created_at desc);
create unique index if not exists product_drafts_owner_title_uq on public.product_drafts (owner_id, lower(title));

alter table public.product_drafts enable row level security;
drop policy if exists "owner reads own drafts" on public.product_drafts;
create policy "owner reads own drafts" on public.product_drafts for select using (auth.uid() = owner_id);
-- writes happen via service_role (edge functions / scheduled publisher); no anon/authenticated write policy.
