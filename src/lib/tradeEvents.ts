import { supabase } from "@/integrations/supabase/client";

export type TradeEventType =
  | "signal_generated"
  | "signal_rejected"
  | "order_placed"
  | "order_failed"
  | "order_filled"
  | "position_exited"
  | "killswitch_blocked"
  | "drawdown_paused"
  | "regime_blocked";

export interface LogTradeEventArgs {
  type: TradeEventType;
  symbol?: string;
  signalId?: string;
  orderId?: string;
  payload?: Record<string, unknown>;
  latencyMs?: number;
}

/** Fire-and-forget. Failures are swallowed; logging must never break a trade. */
export async function logTradeEvent(args: LogTradeEventArgs): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("trade_events").insert([{
      user_id: user.id,
      event_type: args.type,
      symbol: args.symbol ?? undefined,
      signal_id: args.signalId ?? undefined,
      order_id: args.orderId ?? undefined,
      payload: (args.payload ?? {}) as never,
      latency_ms: args.latencyMs ?? undefined,
    }]);
  } catch (e) {
    // intentionally silent
    console.warn("logTradeEvent failed", e);
  }
}

/** Helper to time an async op and log a single event with latency_ms. */
export async function timedTradeEvent<T>(
  type: TradeEventType,
  fn: () => Promise<T>,
  extra: Omit<LogTradeEventArgs, "type" | "latencyMs"> = {},
): Promise<T> {
  const t0 = performance.now();
  try {
    const out = await fn();
    void logTradeEvent({ ...extra, type, latencyMs: Math.round(performance.now() - t0) });
    return out;
  } catch (err) {
    void logTradeEvent({
      ...extra,
      type: "order_failed",
      latencyMs: Math.round(performance.now() - t0),
      payload: { ...(extra.payload ?? {}), error: String(err) },
    });
    throw err;
  }
}