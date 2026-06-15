
-- 1. position_state: per-position scaling state for asymmetric exits
CREATE TABLE public.position_state (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  entry_price NUMERIC NOT NULL,
  initial_qty NUMERIC NOT NULL,
  r_dollars NUMERIC NOT NULL,
  atr_at_entry NUMERIC NOT NULL DEFAULT 0,
  high_water_mark NUMERIC NOT NULL,
  low_water_mark NUMERIC NOT NULL,
  tier1_filled BOOLEAN NOT NULL DEFAULT false,
  tier2_filled BOOLEAN NOT NULL DEFAULT false,
  breakeven_moved BOOLEAN NOT NULL DEFAULT false,
  alpaca_order_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_position_state_user_symbol ON public.position_state(user_id, symbol);
ALTER TABLE public.position_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own position_state"
  ON public.position_state FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Users insert own position_state"
  ON public.position_state FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own position_state"
  ON public.position_state FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Users delete own position_state"
  ON public.position_state FOR DELETE TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Service role full access position_state"
  ON public.position_state FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_position_state_updated
  BEFORE UPDATE ON public.position_state
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 2. market_regime_cache: global single-row cache
CREATE TABLE public.market_regime_cache (
  id TEXT NOT NULL PRIMARY KEY DEFAULT 'global',
  regime TEXT NOT NULL DEFAULT 'CHOP',
  size_multiplier NUMERIC NOT NULL DEFAULT 1.0,
  min_grade TEXT NOT NULL DEFAULT 'B',
  long_bias NUMERIC NOT NULL DEFAULT 1.0,
  short_bias NUMERIC NOT NULL DEFAULT 1.0,
  vix NUMERIC,
  vix_change_pct NUMERIC,
  adx NUMERIC,
  spy_ema20 NUMERIC,
  spy_ema50 NUMERIC,
  notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT regime_singleton CHECK (id = 'global')
);
ALTER TABLE public.market_regime_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read regime"
  ON public.market_regime_cache FOR SELECT TO anon, authenticated
  USING (true);
CREATE POLICY "Service role writes regime"
  ON public.market_regime_cache FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- seed the singleton row
INSERT INTO public.market_regime_cache (id) VALUES ('global')
  ON CONFLICT (id) DO NOTHING;

-- 3. auto_trade_settings additions
ALTER TABLE public.auto_trade_settings
  ADD COLUMN IF NOT EXISTS exit_mode TEXT NOT NULL DEFAULT 'asymmetric',
  ADD COLUMN IF NOT EXISTS chandelier_atr_mult NUMERIC NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS max_hold_minutes INTEGER NOT NULL DEFAULT 240,
  ADD COLUMN IF NOT EXISTS max_trades_per_hour_per_symbol INTEGER NOT NULL DEFAULT 8,
  ADD COLUMN IF NOT EXISTS regime_gate_enabled BOOLEAN NOT NULL DEFAULT true;

-- 4. Enable pg_cron + pg_net for scheduled functions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
