-- Multi-channel distribution: each product targets multiple sales platforms so the
-- business has more revenue windows. Cyrus/Lena recommend the channels (computed in
-- code by product type in autopublish); Shopify is auto-published, the rest are
-- operator-connectable listing targets (TikTok Shop, eBay, Amazon, Etsy, Gumroad,
-- Lemon Squeezy).
alter table public.product_drafts add column if not exists channels jsonb not null default '[]'::jsonb;
