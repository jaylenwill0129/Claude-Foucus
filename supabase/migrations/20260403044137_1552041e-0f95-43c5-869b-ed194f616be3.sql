
CREATE TABLE public.market_prices_cache (
  symbol TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  price NUMERIC NOT NULL DEFAULT 0,
  change_pct NUMERIC NOT NULL DEFAULT 0,
  volume TEXT NOT NULL DEFAULT '0',
  high NUMERIC,
  low NUMERIC,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.market_prices_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read cached prices"
  ON public.market_prices_cache
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Only service role can modify prices"
  ON public.market_prices_cache
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE INDEX idx_market_prices_updated ON public.market_prices_cache(updated_at);
