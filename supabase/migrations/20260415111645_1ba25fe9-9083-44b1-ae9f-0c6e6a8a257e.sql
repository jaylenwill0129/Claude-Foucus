CREATE TABLE public.signal_copies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  symbol text NOT NULL,
  side text NOT NULL,
  entry_price numeric NOT NULL,
  tp_price numeric NOT NULL,
  sl_price numeric NOT NULL,
  qty integer NOT NULL DEFAULT 1,
  position_value numeric NOT NULL DEFAULT 0,
  risk_pct numeric NOT NULL DEFAULT 2,
  rr_ratio numeric,
  confidence integer,
  grade text,
  signal_reasons text[],
  copied_at timestamptz NOT NULL DEFAULT now(),
  executed boolean DEFAULT false,
  executed_at timestamptz,
  execution_price numeric,
  execution_notes text,
  outcome text DEFAULT 'pending',
  pnl numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.signal_copies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own signal copies"
  ON public.signal_copies FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own signal copies"
  ON public.signal_copies FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own signal copies"
  ON public.signal_copies FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own signal copies"
  ON public.signal_copies FOR DELETE TO authenticated
  USING (auth.uid() = user_id);