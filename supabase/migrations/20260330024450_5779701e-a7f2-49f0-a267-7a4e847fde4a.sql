ALTER TABLE public.auto_trade_settings
ADD COLUMN min_price numeric NOT NULL DEFAULT 1,
ADD COLUMN max_price numeric NOT NULL DEFAULT 10000;