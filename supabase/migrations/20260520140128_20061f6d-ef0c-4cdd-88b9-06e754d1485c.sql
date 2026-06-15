-- Phase 1: trade events funnel + latency
CREATE TABLE public.trade_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  symbol TEXT,
  signal_id UUID,
  order_id TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  latency_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_trade_events_user_created ON public.trade_events(user_id, created_at DESC);
CREATE INDEX idx_trade_events_type ON public.trade_events(event_type);
CREATE INDEX idx_trade_events_symbol ON public.trade_events(symbol);

ALTER TABLE public.trade_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own events" ON public.trade_events FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own events" ON public.trade_events FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Service role full access events" ON public.trade_events FOR ALL TO service_role USING (true) WITH CHECK (true);

-- AI analysis cache (shared across users)
CREATE TABLE public.ai_analysis_cache (
  cache_key TEXT NOT NULL PRIMARY KEY,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  model TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_ai_cache_expires ON public.ai_analysis_cache(expires_at);
CREATE INDEX idx_ai_cache_symbol ON public.ai_analysis_cache(symbol);

ALTER TABLE public.ai_analysis_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read cache" ON public.ai_analysis_cache FOR SELECT TO authenticated, anon USING (expires_at > now());
CREATE POLICY "Service role writes cache" ON public.ai_analysis_cache FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Backtest runs
CREATE TABLE public.backtest_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  strategy_name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  train_start TIMESTAMPTZ NOT NULL,
  train_end TIMESTAMPTZ NOT NULL,
  test_start TIMESTAMPTZ NOT NULL,
  test_end TIMESTAMPTZ NOT NULL,
  params JSONB NOT NULL DEFAULT '{}'::jsonb,
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  win_rate NUMERIC,
  expectancy NUMERIC,
  max_drawdown_pct NUMERIC,
  sharpe NUMERIC,
  trades_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_backtest_user ON public.backtest_runs(user_id, created_at DESC);

ALTER TABLE public.backtest_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own backtests" ON public.backtest_runs FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own backtests" ON public.backtest_runs FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own backtests" ON public.backtest_runs FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Kill switch + drawdown breaker on auto_trade_settings
ALTER TABLE public.auto_trade_settings
  ADD COLUMN IF NOT EXISTS trading_halted BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS halt_reason TEXT,
  ADD COLUMN IF NOT EXISTS halted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS max_weekly_drawdown_pct NUMERIC NOT NULL DEFAULT 5.0,
  ADD COLUMN IF NOT EXISTS weekly_pause_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS server_side_trading BOOLEAN NOT NULL DEFAULT false;

-- Cleanup function for expired cache entries
CREATE OR REPLACE FUNCTION public.cleanup_expired_ai_cache()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.ai_analysis_cache WHERE expires_at < now();
$$;