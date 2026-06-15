// Server-side worker: polls Alpaca account activities (FILL) and upserts
// missing rows into trade_journal so users get reconciled P&L even
// when their browser tab is closed. Designed for pg_cron (every 1-2 min).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ALPACA_KEY = Deno.env.get("ALPACA_API_KEY");
    const ALPACA_SECRET = Deno.env.get("ALPACA_API_SECRET");
    if (!ALPACA_KEY || !ALPACA_SECRET) {
      return new Response(JSON.stringify({ skipped: "no alpaca creds" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);

    const resp = await fetch("https://paper-api.alpaca.markets/v2/account/activities/FILL?direction=desc&page_size=100", {
      headers: { "APCA-API-KEY-ID": ALPACA_KEY, "APCA-API-SECRET-KEY": ALPACA_SECRET },
    });
    if (!resp.ok) {
      return new Response(JSON.stringify({ error: `alpaca ${resp.status}` }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const fills = await resp.json() as Array<{ id: string; order_id: string; symbol: string; side: string; qty: string; price: string; transaction_time: string }>;

    let inserted = 0;
    let orphansCanceled = 0;

    // ---- Orphan bracket cleanup: if a parent is filled/canceled but its legs are still open, cancel them.
    try {
      const oResp = await fetch("https://paper-api.alpaca.markets/v2/orders?status=open&limit=200&nested=true", {
        headers: { "APCA-API-KEY-ID": ALPACA_KEY, "APCA-API-SECRET-KEY": ALPACA_SECRET },
      });
      if (oResp.ok) {
        const open = await oResp.json() as Array<{ id: string; symbol: string; order_class: string; legs?: Array<{ id: string; status: string }> }>;
        // Cancel TP/SL legs whose sibling has already filled (parent vanished -> legs alone)
        const posResp = await fetch("https://paper-api.alpaca.markets/v2/positions", {
          headers: { "APCA-API-KEY-ID": ALPACA_KEY, "APCA-API-SECRET-KEY": ALPACA_SECRET },
        });
        const openPositions = posResp.ok ? await posResp.json() as Array<{ symbol: string }> : [];
        if (!posResp.ok) await posResp.text();
        const heldSymbols = new Set(openPositions.map(p => p.symbol));
        for (const o of open) {
          // standalone leg on a symbol with no open position -> orphan
          if ((!o.order_class || o.order_class === "simple") && !heldSymbols.has(o.symbol)) {
            const c = await fetch(`https://paper-api.alpaca.markets/v2/orders/${o.id}`, {
              method: "DELETE",
              headers: { "APCA-API-KEY-ID": ALPACA_KEY, "APCA-API-SECRET-KEY": ALPACA_SECRET },
            });
            await c.text();
            if (c.ok) orphansCanceled++;
          }
        }
      } else {
        await oResp.text();
      }
    } catch (_e) { /* non-fatal */ }

    // Pull recent journal rows once, build a Set of order_ids for dedup.
    const { data: recent } = await sb
      .from("trade_journal")
      .select("alpaca_order_id")
      .not("alpaca_order_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(500);
    const seen = new Set((recent ?? []).map((r) => r.alpaca_order_id).filter(Boolean) as string[]);

    for (const f of fills) {
      if (seen.has(f.order_id)) continue;
      // Best-effort: associate to most recent strategy_history row for the symbol with a user_id.
      const { data: strat } = await sb
        .from("strategy_history")
        .select("user_id")
        .eq("symbol", f.symbol)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!strat?.user_id) continue;
      await sb.from("trade_journal").insert([{
        user_id: strat.user_id,
        symbol: f.symbol,
        side: f.side,
        qty: Number(f.qty),
        filled_price: Number(f.price),
        entry_price: Number(f.price),
        order_type: "market",
        trade_type: f.side === "sell" ? "exit" : "entry",
        mode: "paper",
        alpaca_order_id: f.order_id,
        market_session: "reconciled",
      }]);
      inserted++;
    }
    return new Response(JSON.stringify({ ok: true, processed: fills.length, inserted, orphansCanceled }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});