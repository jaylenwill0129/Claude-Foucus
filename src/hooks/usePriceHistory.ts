import { useState, useEffect, useRef, useCallback } from "react";
import { TickerData } from "@/hooks/useWebullData";
import { supabase } from "@/integrations/supabase/client";
import { invokeAlpacaTrade } from "@/lib/alpacaAccount";

export interface PricePoint {
  time: number;
  price: number;
  label: string;
}

const STORAGE_KEY = "neuraltrade_price_history";
const MAX_POINTS = 120; // ~2 hours at 1-min intervals

function loadHistory(): Record<string, PricePoint[]> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw);
    // Prune entries older than 24h
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const pruned: Record<string, PricePoint[]> = {};
    for (const [sym, points] of Object.entries(data)) {
      pruned[sym] = (points as PricePoint[]).filter(p => p.time > cutoff).slice(-MAX_POINTS);
    }
    return pruned;
  } catch {
    return {};
  }
}

function saveHistory(history: Record<string, PricePoint[]>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch { /* quota */ }
}

export function usePriceHistory(tickers: Record<string, TickerData>) {
  const [history, setHistory] = useState<Record<string, PricePoint[]>>(loadHistory);
  const lastRecordRef = useRef<number>(0);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backfilledRef = useRef<Set<string>>(new Set());

  // Backfill recent 1-min bars from Alpaca for any newly-seen symbol so charts
  // show LIVE data immediately and prediction engines have real history from
  // tick #1 (no SIMULATED warm-up window).
  useEffect(() => {
    const symbols = Object.keys(tickers).filter(s => !backfilledRef.current.has(s));
    if (symbols.length === 0) return;
    symbols.forEach(s => backfilledRef.current.add(s));

    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await invokeAlpacaTrade({
          body: { action: "bars", symbols, timeframe: "1Min", limit: 120, mode: "paper" },
        });
        if (cancelled || error || !data?.bars) return;
        setHistory(prev => {
          const next = { ...prev };
          for (const sym of symbols) {
            const bars = data.bars[sym] || data.bars[sym.toUpperCase()];
            if (!Array.isArray(bars) || bars.length === 0) continue;
            // Only seed if we don't already have meaningful history
            const existing = next[sym] || [];
            if (existing.length >= 5) continue;
            const seeded: PricePoint[] = bars.map((b: any) => {
              const t = new Date(b.t).getTime();
              return {
                time: t,
                price: Number(b.c),
                label: new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
              };
            }).filter(p => isFinite(p.price) && p.price > 0);
            // Merge with any existing (in case live ticks arrived first), dedupe by time
            const merged = [...seeded, ...existing]
              .sort((a, b) => a.time - b.time)
              .filter((p, i, arr) => i === 0 || p.time !== arr[i - 1].time)
              .slice(-MAX_POINTS);
            next[sym] = merged;
          }
          saveHistory(next);
          return next;
        });
      } catch (e) {
        console.warn("price history backfill failed", e);
      }
    })();
    return () => { cancelled = true; };
  }, [tickers]);

  // Record a price point every ~60s for each visible ticker
  useEffect(() => {
    const now = Date.now();
    if (now - lastRecordRef.current < 55_000) return; // debounce to ~1min
    lastRecordRef.current = now;

    const symbols = Object.keys(tickers);
    if (symbols.length === 0) return;

    setHistory(prev => {
      const next = { ...prev };
      const timeLabel = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

      for (const sym of symbols) {
        const price = parseFloat(tickers[sym].price);
        if (!isFinite(price) || price <= 0) continue;

        const existing = next[sym] || [];
        // Don't add duplicate if price hasn't changed and last entry is <30s old
        const last = existing[existing.length - 1];
        if (last && last.price === price && now - last.time < 30_000) continue;

        next[sym] = [...existing, { time: now, price, label: timeLabel }].slice(-MAX_POINTS);
      }
      return next;
    });

    // Debounced save to localStorage
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      setHistory(current => {
        saveHistory(current);
        return current;
      });
    }, 5000);
  }, [tickers]);

  const getHistory = useCallback((symbol: string): PricePoint[] => {
    return history[symbol] || [];
  }, [history]);

  return { getHistory, history };
}
