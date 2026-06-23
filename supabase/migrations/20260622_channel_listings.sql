-- Multi-channel distribution tracking. Each product × sales channel: what's live,
-- what's exported (ready-to-paste marketplace packs), what still needs the operator
-- to connect a channel. Populated by the 'multi-channel-lister' scheduled task.
-- Shopify-app channels (TikTok Shop, Facebook/Instagram, Google/YouTube) sync the
-- Shopify catalog once the operator installs the channel app + connects their seller
-- account; marketplaces (Etsy/eBay/Amazon) get listing packs exported to Drive.
create table if not exists public.channel_listings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  product_title text not null,
  shopify_product_id text,
  channel text not null,                 -- shopify | tiktok_shop | facebook_instagram | google_youtube | etsy | ebay | amazon | gumroad
  status text not null default 'target', -- target | needs_connection | exported | live
  listing jsonb not null default '{}'::jsonb,
  external_url text,
  drive_url text,
  note text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create unique index if not exists channel_listings_uq on public.channel_listings (owner_id, lower(product_title), channel);
create index if not exists channel_listings_owner_idx on public.channel_listings (owner_id, channel, status);
alter table public.channel_listings enable row level security;
drop policy if exists "owner reads own listings" on public.channel_listings;
create policy "owner reads own listings" on public.channel_listings for select using (auth.uid() = owner_id);
-- writes via service_role only.
