
-- Trade journal table for logging every Alpaca fill with analysis
CREATE TABLE public.trade_journal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Trade data
  symbol text NOT NULL,
  side text NOT NULL,
  qty numeric NOT NULL,
  entry_price numeric,
  exit_price numeric,
  filled_price numeric NOT NULL,
  pnl numeric,
  pnl_pct numeric,
  -- Alpaca metadata
  alpaca_order_id text,
  order_type text NOT NULL DEFAULT 'market',
  order_class text,
  trade_type text NOT NULL DEFAULT 'entry', -- 'entry', 'exit', 'partial_exit'
  mode text NOT NULL DEFAULT 'paper', -- 'paper' or 'live'
  -- Analysis
  confidence numeric,
  risk_reward numeric,
  entry_quality text,
  signal_type text,
  stat_edge_score numeric,
  -- Chart snapshot data (prices at trade time)
  chart_snapshot jsonb,
  -- User notes
  notes text DEFAULT '',
  tags text[] DEFAULT '{}',
  rating integer, -- 1-5 star rating
  lessons_learned text DEFAULT '',
  -- Context
  market_session text,
  sector text,
  holding_time_ms bigint
);

ALTER TABLE public.trade_journal ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own journal" ON public.trade_journal
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own journal" ON public.trade_journal
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own journal" ON public.trade_journal
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own journal" ON public.trade_journal
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX idx_trade_journal_user_id ON public.trade_journal(user_id);
CREATE INDEX idx_trade_journal_symbol ON public.trade_journal(symbol);
CREATE INDEX idx_trade_journal_created_at ON public.trade_journal(created_at DESC);
