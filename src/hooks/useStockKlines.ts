import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { invokeAlpacaTrade } from "@/lib/alpacaAccount";

export interface Kline {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Fetches daily kline/candle data for any US stock symbol using the free Yahoo Finance v8 chart API.
 * Falls back to generating synthetic klines from ticker data if the API fails.
 */
export function useStockKlines(symbol: string, tickerPrice?: number) {
  const [klines, setKlines] = useState<Kline[]>([]);
  const [loading, setLoading] = useState(false);
  const lastSymbol = useRef("");

  useEffect(() => {
    if (!symbol) {
      setKlines([]);
      return;
    }

    // Don't refetch for same symbol
    if (lastSymbol.current === symbol && klines.length > 0) return;
    lastSymbol.current = symbol;

    let cancelled = false;
    const fetchKlines = async () => {
      setLoading(true);
      try {
        // Use our Alpaca bars edge function — no CORS, real candles, works for
        // equities and crypto. Replaces direct Yahoo fetch which fails from the
        // browser due to CORS/network blocking.
        const { data, error } = await invokeAlpacaTrade({
          body: { action: "bars", symbol, timeframe: "1Day", limit: 180, mode: "paper" },
        });
        if (error) throw error;
        const sym = symbol.toUpperCase();
        const bars = data?.bars?.[sym] || data?.bars?.[sym.replace("/", "")] || [];
        const parsed: Kline[] = bars
          .map((b: any) => ({
            time: new Date(b.t).getTime(),
            open: Number(b.o), high: Number(b.h), low: Number(b.l), close: Number(b.c),
            volume: Number(b.v) || 0,
          }))
          .filter((k: Kline) => isFinite(k.close) && k.close > 0);

        if (!cancelled && parsed.length >= 10) {
          setKlines(parsed);
          setLoading(false);
          return;
        }
        if (parsed.length < 10) throw new Error("Insufficient data");
      } catch (e) {
        console.warn(`Alpaca bars fetch failed for ${symbol}, using synthetic fallback...`, e);
      }

      // Fallback: generate synthetic klines from current price
      try {
        const price = tickerPrice || 100;
        const synthetic: Kline[] = [];
        const now = Date.now();
        for (let i = 99; i >= 0; i--) {
          const dayOffset = i;
          const t = now - dayOffset * 86400000;
          const noise = (Math.random() - 0.5) * price * 0.03;
          const trend = (99 - i) / 99 * (Math.random() - 0.5) * price * 0.1;
          const c = price + noise + trend;
          const spread = price * 0.015;
          synthetic.push({
            time: t,
            open: c + (Math.random() - 0.5) * spread,
            high: c + Math.random() * spread,
            low: c - Math.random() * spread,
            close: c,
            volume: Math.floor(1000000 + Math.random() * 5000000),
          });
        }
        if (!cancelled) setKlines(synthetic);
      } catch {
        // silently fail
      }

      if (!cancelled) setLoading(false);
    };

    fetchKlines();
    return () => { cancelled = true; };
  }, [symbol, tickerPrice]);

  return { klines, loading };
}
