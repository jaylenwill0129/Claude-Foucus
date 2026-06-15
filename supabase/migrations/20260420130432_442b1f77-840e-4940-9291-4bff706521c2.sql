ALTER TABLE public.auto_trade_settings
  ADD COLUMN IF NOT EXISTS hard_confidence_floor integer NOT NULL DEFAULT 65,
  ADD COLUMN IF NOT EXISTS bearish_stock_weight numeric NOT NULL DEFAULT 0.7,
  ADD COLUMN IF NOT EXISTS bearish_crypto_block boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS block_crypto_mean_reversion boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS tiered_sizing_by_confidence boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS after_hours_crypto_only_mode boolean NOT NULL DEFAULT true;