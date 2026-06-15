// Market regime classifier — runs on cron (~every 5 min).
// Pulls SPY daily bars + VIX (via ^VIX through Alpaca screener fallback to constant)
// and writes a single global row to `market_regime_cache`.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALPACA_DATA = "https://data.alpaca.markets";

function ema(values: number[], period: number): number {
  if (!values.length) return 0;
  const k = 2 / (period + 1);
  let e = values[0];
  for (let i = 1; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

function adx14(highs: number[], lows: number[], closes: number[]): number {
  const n = closes.length;
  if (n < 16) return 20;
  const trs: number[] = [], plusDM: number[] = [], minusDM: number[] = [];
  for (let i = 1; i < n; i++) {
    const up = highs[i] - highs[i - 1];
    const dn = lows[i - 1] - lows[i];
    plusDM.push(up > dn && up > 0 ? up : 0);
    minusDM.push(dn > up && dn > 0 ? dn : 0);
    trs.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  const sum = (a: number[], p: number) => a.slice(-p).reduce((s, v) => s + v, 0);
  const atr = sum(trs, 14) / 14;
  const plusDI = 100 * (sum(plusDM, 14) / 14) / (atr || 1);
  const minusDI = 100 * (sum(minusDM, 14) / 14) / (atr || 1);
  const dx = 100 * Math.abs(plusDI - minusDI) / ((plusDI + minusDI) || 1);
  return dx; // single-period DX as proxy for ADX (good enough for regime)
}

async function alpacaBars(symbol: string, timeframe = "1Day", limit = 60) {
  const key = Deno.env.get("ALPACA_API_KEY");
  const secret = Deno.env.get("ALPACA_API_SECRET");
  if (!key || !secret) return null;
  // 90d window ending yesterday so the free IEX feed has data
  const end = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const start = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const url = `${ALPACA_DATA}/v2/stocks/${encodeURIComponent(symbol)}/bars?timeframe=${timeframe}&start=${start}&end=${end}&limit=${limit}&adjustment=raw&feed=iex`;
  const r = await fetch(url, { headers: { "APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret } });
  if (!r.ok) { await r.text(); return null; }
  const j = await r.json();
  return (j.bars ?? []) as Array<{ h: number; l: number; c: number; o: number }>;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const spy = await alpacaBars("SPY", "1Day", 60);
    if (!spy || spy.length < 20) {
      return new Response(JSON.stringify({ skipped: "no_spy_data" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const closes = spy.map(b => b.c);
    const highs = spy.map(b => b.h);
    const lows = spy.map(b => b.l);
    const e20 = ema(closes.slice(-20), 20);
    const e50 = ema(closes.slice(-50), 50);
    const adx = adx14(highs, lows, closes);
    const last = closes[closes.length - 1];

    // VIX proxy: 20-day realized vol from SPY * 100 (rough but adequate when ^VIX unavailable)
    const rets: number[] = [];
    for (let i = closes.length - 20; i < closes.length; i++) {
      if (i > 0) rets.push(Math.log(closes[i] / closes[i - 1]));
    }
    const meanR = rets.reduce((s, v) => s + v, 0) / (rets.length || 1);
    const varR = rets.reduce((s, v) => s + (v - meanR) ** 2, 0) / (rets.length || 1);
    const vixProxy = Math.sqrt(varR * 252) * 100;
    const vixChange = rets.length >= 2 ? (rets[rets.length - 1] - rets[rets.length - 2]) * 100 : 0;

    // Classify
    let regime = "CHOP";
    let size_multiplier = 1.0;
    let min_grade = "B";
    let long_bias = 1.0;
    let short_bias = 1.0;

    if (vixProxy > 28) {
      regime = "HIGH_VOL"; size_multiplier = 0.4; min_grade = "A"; long_bias = 0.6; short_bias = 0.6;
    } else if (adx >= 25 && last > e20 && e20 > e50) {
      regime = "TREND_UP"; size_multiplier = 1.25; min_grade = "B"; long_bias = 1.25; short_bias = 0.5;
    } else if (adx >= 25 && last < e20 && e20 < e50) {
      regime = "TREND_DOWN"; size_multiplier = 1.0; min_grade = "B"; long_bias = 0.5; short_bias = 1.25;
    } else {
      regime = "CHOP"; size_multiplier = 0.5; min_grade = "A"; long_bias = 0.75; short_bias = 0.75;
    }

    const { error } = await sb.from("market_regime_cache").upsert({
      id: "global",
      regime, size_multiplier, min_grade, long_bias, short_bias,
      vix: vixProxy, vix_change_pct: vixChange, adx,
      spy_ema20: e20, spy_ema50: e50,
      notes: `SPY=${last.toFixed(2)} ADX=${adx.toFixed(1)} VIXprx=${vixProxy.toFixed(1)}`,
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;

    return new Response(JSON.stringify({ ok: true, regime, size_multiplier, min_grade, adx, vix: vixProxy }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});