// Server-side auto-trader tick (pg_cron every 1 min).
// Per user with server_side_trading=true:
//   1. enforce drawdown / kill switch
//   2. open new entries from fresh strategy_history signals (gated by regime)
//   3. manage open positions with asymmetric scaling + chandelier ATR trail
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PAPER_BASE = "https://paper-api.alpaca.markets";
const DATA_BASE = "https://data.alpaca.markets";
const GRADE_RANK: Record<string, number> = { A: 4, B: 3, C: 2, D: 1, F: 0 };

async function alpaca(path: string, init: RequestInit = {}, base = PAPER_BASE) {
  const key = Deno.env.get("ALPACA_API_KEY")!;
  const secret = Deno.env.get("ALPACA_API_SECRET")!;
  return await fetch(`${base}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      "APCA-API-KEY-ID": key,
      "APCA-API-SECRET-KEY": secret,
      "Content-Type": "application/json",
    },
  });
}

async function getLatestPrice(symbol: string): Promise<number | null> {
  const isCrypto = symbol.includes("/") || /USD$/.test(symbol) && symbol.length <= 7 && !["SPY","QQQ","DIA","IWM"].includes(symbol);
  const path = isCrypto
    ? `/v1beta3/crypto/us/latest/trades?symbols=${encodeURIComponent(symbol)}`
    : `/v2/stocks/${encodeURIComponent(symbol)}/trades/latest?feed=iex`;
  const r = await alpaca(path, {}, DATA_BASE);
  if (!r.ok) { await r.text(); return null; }
  const j = await r.json();
  if (isCrypto) return j?.trades?.[symbol]?.p ?? null;
  return j?.trade?.p ?? null;
}

async function atr14(symbol: string): Promise<number | null> {
  const r = await alpaca(`/v2/stocks/${encodeURIComponent(symbol)}/bars?timeframe=5Min&limit=30&feed=iex`, {}, DATA_BASE);
  if (!r.ok) { await r.text(); return null; }
  const j = await r.json();
  const bars = (j.bars ?? []) as Array<{ h: number; l: number; c: number }>;
  if (bars.length < 15) return null;
  let sum = 0;
  for (let i = 1; i < bars.length; i++) {
    const tr = Math.max(bars[i].h - bars[i].l, Math.abs(bars[i].h - bars[i - 1].c), Math.abs(bars[i].l - bars[i - 1].c));
    sum += tr;
  }
  return sum / (bars.length - 1);
}

async function getRegime(sb: ReturnType<typeof createClient>) {
  const { data } = await sb.from("market_regime_cache").select("*").eq("id", "global").maybeSingle();
  return data as null | {
    regime: string; size_multiplier: number; min_grade: string;
    long_bias: number; short_bias: number;
  };
}

function isMarketOpenET(now = new Date()): boolean {
  // US equities 9:30-16:00 ET, Mon-Fri (rough; ignores holidays)
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  const parts = Object.fromEntries(fmt.formatToParts(now).map(p => [p.type, p.value]));
  const day = parts.weekday;
  if (day === "Sat" || day === "Sun") return false;
  const hm = parseInt(parts.hour, 10) * 60 + parseInt(parts.minute, 10);
  return hm >= 9 * 60 + 30 && hm < 16 * 60;
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
      .select("*")
      .eq("server_side_trading", true)
      .eq("enabled", true);

    const regime = await getRegime(sb);
    const summary: Array<Record<string, unknown>> = [];

    for (const u of users ?? []) {
      if (u.trading_halted) { summary.push({ user: u.user_id, skip: "halted" }); continue; }
      if (u.weekly_pause_until && new Date(u.weekly_pause_until as string) > new Date()) {
        summary.push({ user: u.user_id, skip: "dd_pause" }); continue;
      }

      // ---- Drawdown breaker (unchanged) ----
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data: weekTrades } = await sb.from("trade_journal").select("pnl").eq("user_id", u.user_id).gte("created_at", weekAgo);
      const weekPnl = (weekTrades ?? []).reduce((acc, r) => acc + Number(r.pnl ?? 0), 0);
      const acctResp = await alpaca("/v2/account");
      if (!acctResp.ok) { await acctResp.text(); summary.push({ user: u.user_id, error: "account_fetch" }); continue; }
      const acct = await acctResp.json();
      const equity = Number(acct.equity ?? 0);
      if (equity > 0 && weekPnl / equity * 100 <= -Number(u.max_weekly_drawdown_pct ?? 5)) {
        const until = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        await sb.from("auto_trade_settings").update({ weekly_pause_until: until }).eq("user_id", u.user_id);
        await sb.from("trade_events").insert([{ user_id: u.user_id, event_type: "drawdown_paused", payload: { weekPnl, equity } as never }]);
        summary.push({ user: u.user_id, action: "paused_24h" });
        continue;
      }

      // ===== EXITS: asymmetric scaling + chandelier trail =====
      const posResp = await alpaca("/v2/positions");
      const positions = posResp.ok
        ? await posResp.json() as Array<{ symbol: string; qty: string; unrealized_plpc: string; side: string; avg_entry_price: string; current_price: string }>
        : [];
      if (!posResp.ok) await posResp.text();

      const { data: states } = await sb.from("position_state").select("*").eq("user_id", u.user_id);
      const stateBySymbol = new Map((states ?? []).map(s => [s.symbol as string, s]));

      for (const p of positions) {
        const st = stateBySymbol.get(p.symbol);
        const current = Number(p.current_price);
        const qty = Math.abs(Number(p.qty));
        const isLong = p.side === "long";
        const exitMode = (u.exit_mode ?? "asymmetric") as string;

        // SYMMETRIC fallback for users who opted out
        if (exitMode !== "asymmetric" || !st) {
          const pnlPct = Number(p.unrealized_plpc) * 100;
          const hitSL = pnlPct <= -Number(u.stop_loss_pct ?? 2);
          const hitTP = pnlPct >= Number(u.take_profit_pct ?? 5);
          if (hitSL || hitTP) {
            const r = await alpaca(`/v2/positions/${encodeURIComponent(p.symbol)}`, { method: "DELETE" });
            await r.text();
            await sb.from("trade_events").insert([{ user_id: u.user_id, event_type: "position_exited", symbol: p.symbol, payload: { reason: hitSL ? "server_sl" : "server_tp", pnlPct, qty } as never }]);
            if (st) await sb.from("position_state").delete().eq("id", st.id);
            summary.push({ user: u.user_id, symbol: p.symbol, exit: hitSL ? "SL" : "TP" });
          }
          continue;
        }

        // ASYMMETRIC path (we have state)
        const entry = Number(st.entry_price);
        const rDol = Number(st.r_dollars);
        const atr = Number(st.atr_at_entry) || rDol; // fallback
        const chandMult = Number(u.chandelier_atr_mult ?? 3);

        // Update high/low water mark
        const newHigh = Math.max(Number(st.high_water_mark), current);
        const newLow = Math.min(Number(st.low_water_mark), current);
        if (newHigh !== Number(st.high_water_mark) || newLow !== Number(st.low_water_mark)) {
          await sb.from("position_state").update({ high_water_mark: newHigh, low_water_mark: newLow }).eq("id", st.id);
        }

        const rMove = isLong ? (current - entry) / rDol : (entry - current) / rDol;

        // Hard initial stop (1R against)
        const initialStopHit = isLong ? current <= entry - rDol : current >= entry + rDol;
        // After breakeven: stop is entry
        const beStopHit = st.breakeven_moved && (isLong ? current <= entry : current >= entry);
        // Chandelier trail (only after tier2 filled, so the runner)
        const chandStop = isLong ? newHigh - chandMult * atr : newLow + chandMult * atr;
        const trailHit = st.tier2_filled && (isLong ? current <= chandStop : current >= chandStop);

        if (initialStopHit || beStopHit || trailHit) {
          const r = await alpaca(`/v2/positions/${encodeURIComponent(p.symbol)}`, { method: "DELETE" });
          await r.text();
          await sb.from("position_state").delete().eq("id", st.id);
          await sb.from("trade_events").insert([{ user_id: u.user_id, event_type: "position_exited", symbol: p.symbol, payload: { reason: trailHit ? "chandelier" : beStopHit ? "breakeven_stop" : "initial_stop", rMove, qty } as never }]);
          summary.push({ user: u.user_id, symbol: p.symbol, exit: trailHit ? "TRAIL" : "STOP", rMove: rMove.toFixed(2) });
          continue;
        }

        // Tier 1: 25% off at +1R, move stop to breakeven
        if (!st.tier1_filled && rMove >= 1) {
          const slice = Math.max(1, Math.floor(Number(st.initial_qty) * 0.25));
          const r = await alpaca("/v2/orders", { method: "POST", body: JSON.stringify({ symbol: p.symbol, qty: slice, side: isLong ? "sell" : "buy", type: "market", time_in_force: "day" }) });
          await r.text();
          await sb.from("position_state").update({ tier1_filled: true, breakeven_moved: true }).eq("id", st.id);
          await sb.from("trade_events").insert([{ user_id: u.user_id, event_type: "tier_exit", symbol: p.symbol, payload: { tier: 1, qty: slice, rMove } as never }]);
          summary.push({ user: u.user_id, symbol: p.symbol, tier: 1 });
          continue;
        }
        // Tier 2: 25% off at +2R
        if (st.tier1_filled && !st.tier2_filled && rMove >= 2) {
          const slice = Math.max(1, Math.floor(Number(st.initial_qty) * 0.25));
          const r = await alpaca("/v2/orders", { method: "POST", body: JSON.stringify({ symbol: p.symbol, qty: slice, side: isLong ? "sell" : "buy", type: "market", time_in_force: "day" }) });
          await r.text();
          await sb.from("position_state").update({ tier2_filled: true }).eq("id", st.id);
          await sb.from("trade_events").insert([{ user_id: u.user_id, event_type: "tier_exit", symbol: p.symbol, payload: { tier: 2, qty: slice, rMove } as never }]);
          summary.push({ user: u.user_id, symbol: p.symbol, tier: 2 });
          continue;
        }
      }

      // ===== ENTRIES: pull fresh signals, gate by regime, submit brackets =====
      const openSyms = new Set(positions.map(p => p.symbol));
      const maxOpen = Number(u.max_open_positions ?? 3);
      if (positions.length >= maxOpen) { summary.push({ user: u.user_id, skip: "max_open" }); continue; }

      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const { data: signals } = await sb
        .from("strategy_history")
        .select("id, symbol, overall_bias, confidence, current_price_at_gen, risk_assessment, signals")
        .eq("user_id", u.user_id)
        .eq("outcome", "pending")
        .gte("created_at", fiveMinAgo)
        .order("confidence", { ascending: false })
        .limit(10);

      const confFloor = Number(u.hard_confidence_floor ?? 65);
      const minGradeRank = u.regime_gate_enabled && regime ? (GRADE_RANK[regime.min_grade] ?? 0) : 0;
      const sizeMult = u.regime_gate_enabled && regime ? Number(regime.size_multiplier) : 1.0;

      for (const sig of signals ?? []) {
        if (positions.length + 1 > maxOpen) break;
        if (openSyms.has(sig.symbol)) continue;
        if (Number(sig.confidence) < confFloor) continue;

        const bias = (sig.overall_bias as string)?.toLowerCase();
        const side = bias?.includes("bull") ? "buy" : bias?.includes("bear") ? "sell" : null;
        if (!side) continue;

        const isStock = !sig.symbol.includes("/") && !/USD$/.test(sig.symbol as string);
        if (isStock && !isMarketOpenET()) continue;

        // Regime bias gate
        if (u.regime_gate_enabled && regime) {
          const grade = (sig as any).risk_assessment?.grade ?? "B";
          if ((GRADE_RANK[grade] ?? 0) < minGradeRank) continue;
          if (regime.regime === "HIGH_VOL") {
            // Skip mean-reversion strategies in high-vol regimes
            const strategy = (sig as any).strategy_name ?? "";
            if (/mean.?revers/i.test(strategy)) continue;
          }
        }

        const price = Number(sig.current_price_at_gen);
        if (!price || price <= 0) continue;

        // Sizing
        const basePct = Number(u.position_size_pct ?? 5) / 100;
        const bias_dir = side === "buy" ? Number(regime?.long_bias ?? 1) : Number(regime?.short_bias ?? 1);
        const positionPct = basePct * sizeMult * bias_dir;
        const dollars = equity * positionPct;
        const qty = Math.max(1, Math.floor(dollars / price));

        const slPct = Number(u.stop_loss_pct ?? 2) / 100;
        const tpPct = Number(u.take_profit_pct ?? 5) / 100;
        const stopPrice = side === "buy" ? price * (1 - slPct) : price * (1 + slPct);
        const tpPrice = side === "buy" ? price * (1 + tpPct) : price * (1 - tpPct);

        const orderResp = await alpaca("/v2/orders", {
          method: "POST",
          body: JSON.stringify({
            symbol: sig.symbol, qty, side, type: "market", time_in_force: "day",
            order_class: "bracket",
            stop_loss: { stop_price: stopPrice.toFixed(2) },
            take_profit: { limit_price: tpPrice.toFixed(2) },
          }),
        });
        const orderBody = await orderResp.text();
        if (!orderResp.ok) {
          await sb.from("trade_events").insert([{ user_id: u.user_id, event_type: "entry_failed", symbol: sig.symbol, payload: { status: orderResp.status, body: orderBody.slice(0, 400) } as never }]);
          summary.push({ user: u.user_id, symbol: sig.symbol, entry: "FAILED", status: orderResp.status });
          continue;
        }
        const order = JSON.parse(orderBody);

        // Seed position_state for asymmetric exit management
        const r_dollars = Math.abs(price - stopPrice);
        const atr = (isStock ? await atr14(sig.symbol).catch(() => null) : null) ?? r_dollars;
        await sb.from("position_state").insert([{
          user_id: u.user_id, symbol: sig.symbol,
          side: side === "buy" ? "long" : "short",
          entry_price: price, initial_qty: qty,
          r_dollars, atr_at_entry: atr,
          high_water_mark: price, low_water_mark: price,
          alpaca_order_id: order.id ?? null,
        }]);
        await sb.from("trade_events").insert([{ user_id: u.user_id, event_type: "entry_submitted", symbol: sig.symbol, payload: { qty, price, side, regime: regime?.regime, sizeMult, bias_dir } as never }]);
        await sb.from("strategy_history").update({ entry_hit: true, entry_hit_at: new Date().toISOString() }).eq("id", sig.id);
        openSyms.add(sig.symbol);
        positions.push({ symbol: sig.symbol, qty: String(qty), side: side === "buy" ? "long" : "short", unrealized_plpc: "0", avg_entry_price: String(price), current_price: String(price) });
        summary.push({ user: u.user_id, symbol: sig.symbol, entry: side, qty });
      }
    }

    return new Response(JSON.stringify({ ok: true, regime: regime?.regime, summary }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});