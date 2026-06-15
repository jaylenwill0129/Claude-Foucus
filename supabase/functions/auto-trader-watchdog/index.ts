// Watchdog — runs every ~1 min. Per user with server_side_trading=true:
//  - cancel orphan bracket legs (parent gone but leg still open)
//  - flatten naked positions older than max_hold_minutes
//  - detect DB↔Alpaca position drift -> alert
//  - detect runaway loops (>N trades/hr/symbol) -> auto-halt
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const PAPER_BASE = "https://paper-api.alpaca.markets";

async function alpaca(path: string, init: RequestInit = {}) {
  const key = Deno.env.get("ALPACA_API_KEY")!;
  const secret = Deno.env.get("ALPACA_API_SECRET")!;
  return await fetch(`${PAPER_BASE}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      "APCA-API-KEY-ID": key,
      "APCA-API-SECRET-KEY": secret,
      "Content-Type": "application/json",
    },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (!Deno.env.get("ALPACA_API_KEY")) {
      return new Response(JSON.stringify({ skipped: "no_alpaca" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: users } = await sb
      .from("auto_trade_settings")
      .select("user_id, max_hold_minutes, max_trades_per_hour_per_symbol")
      .eq("server_side_trading", true)
      .eq("enabled", true);

    const actions: Array<Record<string, unknown>> = [];

    // ----- ORPHAN BRACKETS (account-wide, not per-user since Alpaca is shared paper acct) -----
    const ordersResp = await alpaca("/v2/orders?status=open&limit=200&nested=true");
    if (ordersResp.ok) {
      const openOrders = await ordersResp.json() as Array<{ id: string; symbol: string; order_class: string; status: string; legs?: Array<{ id: string; status: string }>; replaces?: string }>;
      const orderIds = new Set(openOrders.map(o => o.id));
      for (const o of openOrders) {
        // bracket legs whose parent is no longer open
        if (o.order_class === "bracket" && o.legs?.length) {
          for (const leg of o.legs) {
            if (leg.status === "new" || leg.status === "accepted" || leg.status === "pending_new") {
              if (!orderIds.has(o.id)) {
                await alpaca(`/v2/orders/${leg.id}`, { method: "DELETE" });
                actions.push({ orphan_leg_cancelled: leg.id, symbol: o.symbol });
              }
            }
          }
        }
      }
    } else {
      await ordersResp.text();
    }

    // Account-wide positions snapshot
    const posResp = await alpaca("/v2/positions");
    const positions = posResp.ok
      ? await posResp.json() as Array<{ symbol: string; qty: string; side: string; avg_entry_price: string }>
      : [];
    if (!posResp.ok) await posResp.text();

    // ----- PER-USER GUARDS -----
    for (const u of users ?? []) {
      const maxHold = Number(u.max_hold_minutes ?? 240);
      const maxPerHr = Number(u.max_trades_per_hour_per_symbol ?? 8);

      // (a) runaway loop detection - last 60 min trades by symbol
      const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { data: recentTrades } = await sb
        .from("trade_journal")
        .select("symbol")
        .eq("user_id", u.user_id)
        .gte("created_at", hourAgo);
      const bySym: Record<string, number> = {};
      for (const r of recentTrades ?? []) bySym[r.symbol] = (bySym[r.symbol] ?? 0) + 1;
      const runaway = Object.entries(bySym).filter(([, n]) => n > maxPerHr);
      if (runaway.length) {
        await sb.from("auto_trade_settings").update({
          trading_halted: true,
          halted_at: new Date().toISOString(),
          halt_reason: `runaway_loop: ${runaway.map(([s, n]) => `${s}=${n}`).join(",")}`,
        }).eq("user_id", u.user_id);
        await sb.from("trade_events").insert([{
          user_id: u.user_id, event_type: "auto_halted",
          payload: { reason: "runaway_loop", details: runaway } as never,
        }]);
        actions.push({ user: u.user_id, halted: "runaway", runaway });
        continue;
      }

      // (b) naked positions older than maxHold (use position_state created_at or fallback to Alpaca side info)
      const { data: states } = await sb
        .from("position_state")
        .select("id, symbol, side, initial_qty, created_at")
        .eq("user_id", u.user_id);
      const cutoff = Date.now() - maxHold * 60 * 1000;
      for (const s of states ?? []) {
        if (new Date(s.created_at).getTime() < cutoff) {
          const closeResp = await alpaca(`/v2/positions/${encodeURIComponent(s.symbol)}`, { method: "DELETE" });
          await closeResp.text();
          await sb.from("position_state").delete().eq("id", s.id);
          await sb.from("trade_events").insert([{
            user_id: u.user_id, event_type: "max_hold_flatten",
            symbol: s.symbol,
            payload: { age_min: Math.round((Date.now() - new Date(s.created_at).getTime()) / 60000) } as never,
          }]);
          actions.push({ user: u.user_id, max_hold_flatten: s.symbol });
        }
      }

      // (c) drift detection: alpaca symbol not in position_state for this user (best-effort, just alert)
      const userStateSyms = new Set((states ?? []).map(s => s.symbol));
      for (const p of positions) {
        if (!userStateSyms.has(p.symbol)) {
          // Only alert once per symbol per 10 min
          const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
          const { data: recentAlert } = await sb
            .from("trade_events")
            .select("id")
            .eq("user_id", u.user_id)
            .eq("event_type", "position_drift")
            .eq("symbol", p.symbol)
            .gte("created_at", tenMinAgo)
            .maybeSingle();
          if (!recentAlert) {
            await sb.from("trade_events").insert([{
              user_id: u.user_id, event_type: "position_drift", symbol: p.symbol,
              payload: { qty: p.qty, side: p.side, avg_entry: p.avg_entry_price } as never,
            }]);
            actions.push({ user: u.user_id, drift: p.symbol });
          }
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, actions }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});