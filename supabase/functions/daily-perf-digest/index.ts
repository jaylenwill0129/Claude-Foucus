import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

// Aggregates last 24h of trade_journal per user and writes a digest
// row into trade_events (type = 'daily_digest'). UI surfaces it as a banner.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

    const { data: rows, error } = await supabase
      .from("trade_journal")
      .select("user_id, symbol, trade_type, pnl, slippage_bps, market_session, sector")
      .gte("created_at", since);

    if (error) throw error;

    const byUser = new Map<string, any[]>();
    for (const r of rows || []) {
      if (!byUser.has(r.user_id)) byUser.set(r.user_id, []);
      byUser.get(r.user_id)!.push(r);
    }

    const inserts: any[] = [];
    for (const [user_id, items] of byUser) {
      const exits = items.filter(i => i.trade_type !== "entry");
      const wins = exits.filter(i => Number(i.pnl) > 0).length;
      const losses = exits.filter(i => Number(i.pnl) < 0).length;
      const totalPnl = exits.reduce((s, i) => s + (Number(i.pnl) || 0), 0);
      const timeExits = exits.filter(i => i.trade_type === "time_exit").length;
      const worstSymbol = (() => {
        const m = new Map<string, number>();
        for (const e of exits) m.set(e.symbol, (m.get(e.symbol) || 0) + (Number(e.pnl) || 0));
        let worst: [string, number] | null = null;
        for (const kv of m) if (!worst || kv[1] < worst[1]) worst = kv as [string, number];
        return worst && worst[1] < 0 ? { symbol: worst[0], pnl: worst[1] } : null;
      })();

      inserts.push({
        user_id,
        event_type: "daily_digest",
        payload: {
          generated_at: new Date().toISOString(),
          window_hours: 24,
          trades: exits.length,
          wins, losses,
          win_rate: exits.length ? wins / exits.length : 0,
          total_pnl: Number(totalPnl.toFixed(4)),
          time_exit_count: timeExits,
          worst_symbol: worstSymbol,
        },
      });
    }

    if (inserts.length) {
      const { error: insErr } = await supabase.from("trade_events").insert(inserts);
      if (insErr) throw insErr;
    }

    return new Response(JSON.stringify({ ok: true, digests: inserts.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("daily-perf-digest error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "unknown" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});