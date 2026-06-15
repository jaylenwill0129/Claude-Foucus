
CREATE TABLE public.strategy_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  symbol TEXT NOT NULL,
  strategy_name TEXT NOT NULL,
  overall_bias TEXT NOT NULL,
  confidence INTEGER NOT NULL,
  analysis_mode TEXT DEFAULT 'fallback',
  preset TEXT,
  current_price_at_gen NUMERIC NOT NULL,
  signals JSONB NOT NULL DEFAULT '[]',
  indicators JSONB DEFAULT '{}',
  risk_assessment JSONB DEFAULT '{}',
  reasoning TEXT[] DEFAULT '{}',
  -- Tracking fields
  entry_hit BOOLEAN DEFAULT false,
  entry_hit_at TIMESTAMP WITH TIME ZONE,
  tp_hit BOOLEAN DEFAULT false,
  tp_hit_at TIMESTAMP WITH TIME ZONE,
  sl_hit BOOLEAN DEFAULT false,
  sl_hit_at TIMESTAMP WITH TIME ZONE,
  outcome TEXT DEFAULT 'pending',
  actual_pnl_pct NUMERIC,
  resolved_at TIMESTAMP WITH TIME ZONE,
  notes TEXT DEFAULT ''
);

ALTER TABLE public.strategy_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own strategies" ON public.strategy_history FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own strategies" ON public.strategy_history FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own strategies" ON public.strategy_history FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own strategies" ON public.strategy_history FOR DELETE TO authenticated USING (auth.uid() = user_id);
