
ALTER TABLE public.trade_journal
  ADD COLUMN IF NOT EXISTS slippage_bps numeric,
  ADD COLUMN IF NOT EXISTS signal_price numeric;

ALTER TABLE public.auto_trade_settings
  ADD COLUMN IF NOT EXISTS prefer_limit_orders boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS limit_price_offset_bps integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS slippage_aware_sizing boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS premarket_scanner_enabled boolean NOT NULL DEFAULT true;
