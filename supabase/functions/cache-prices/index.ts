// Background snapshot writer: pulls latest Alpaca trades for a curated symbol
// list and upserts into market_prices_cache so cold loads have data instantly
// and edge analytics don't depend on a live browser session.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYMBOLS = [
  "AAPL","MSFT","NVDA","GOOGL","META","AMZN","TSLA","AMD","NFLX","CRM",
  "AVGO","COST","JPM","V","MA","WMT","XOM","JNJ","UNH","LLY",
  "SPY","QQQ","IWM","DIA","VTI","ARKK",
];

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ALPACA_KEY = Deno.env.get("ALPACA_API_KEY");
    const ALPACA_SECRET = Deno.env.get("ALPACA_API_SECRET");
    if (!ALPACA_KEY || !ALPACA_SECRET) {
      return new Response(JSON.stringify({ skipped: "no alpaca creds" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    const symParam = encodeURIComponent(SYMBOLS.join(","));
    const snapResp = await fetch(`https://data.alpaca.markets/v2/stocks/snapshots?symbols=${symParam}&feed=iex`, {
      headers: { "APCA-API-KEY-ID": ALPACA_KEY, "APCA-API-SECRET-KEY": ALPACA_SECRET },
    });
    if (!snapResp.ok) {
      return new Response(JSON.stringify({ error: `alpaca ${snapResp.status}` }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const snapshots = await snapResp.json() as Record<string, { latestTrade?: { p: number }; dailyBar?: { o: number; h: number; l: number; c: number; v: number }; prevDailyBar?: { c: number } }>;

    const rows: Array<Record<string, unknown>> = [];
    for (const sym of Object.keys(snapshots)) {
      const s = snapshots[sym];
      const price = s.latestTrade?.p ?? s.dailyBar?.c ?? 0;
      if (!price) continue;
      const prev = s.prevDailyBar?.c ?? price;
      const changePct = prev > 0 ? ((price - prev) / prev) * 100 : 0;
      rows.push({
        symbol: sym,
        name: sym,
        price,
        change_pct: Number(changePct.toFixed(3)),
        volume: String(s.dailyBar?.v ?? 0),
        high: s.dailyBar?.h ?? null,
        low: s.dailyBar?.l ?? null,
        updated_at: new Date().toISOString(),
      });
    }
    if (rows.length > 0) {
      await sb.from("market_prices_cache").upsert(rows, { onConflict: "symbol" });
    }
    return new Response(JSON.stringify({ ok: true, count: rows.length }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});