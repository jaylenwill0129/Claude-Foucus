import { useEffect, useRef, useCallback, useState } from "react";

// Live IEX trade stream via the alpaca-stream edge function.
// Drops effective quote latency from ~10s polling to <500ms push.
// Falls back silently if the WS can't connect — the existing 10s polling
// in useWebullData stays as a safety net.

export interface StreamTrade {
  symbol: string;
  price: number;
  size: number;
  ts: number;
}

type Listener = (t: StreamTrade) => void;

const WS_URL = `wss://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.functions.supabase.co/alpaca-stream`;

export function useAlpacaStream(symbols: string[], onTrade?: Listener) {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const subscribedRef = useRef<Set<string>>(new Set());
  const onTradeRef = useRef<Listener | undefined>(onTrade);
  const reconnectTimerRef = useRef<number | null>(null);

  useEffect(() => { onTradeRef.current = onTrade; }, [onTrade]);

  const connect = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState <= 1) return;
    let ws: WebSocket;
    try { ws = new WebSocket(WS_URL); } catch (e) { console.warn("alpaca-stream connect failed", e); return; }
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      const syms = Array.from(subscribedRef.current);
      if (syms.length > 0) ws.send(JSON.stringify({ action: "subscribe", trades: syms }));
    };
    ws.onmessage = (ev) => {
      let arr: any;
      try { arr = JSON.parse(ev.data); } catch { return; }
      if (!Array.isArray(arr)) return;
      for (const m of arr) {
        if (m?.T === "t" && typeof m.S === "string" && typeof m.p === "number") {
          onTradeRef.current?.({
            symbol: m.S,
            price: m.p,
            size: typeof m.s === "number" ? m.s : 0,
            ts: m.t ? new Date(m.t).getTime() : Date.now(),
          });
        }
      }
    };
    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;
      // exponential-ish reconnect
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = setTimeout(connect, 5000) as unknown as number;
    };
    ws.onerror = () => { try { ws.close(); } catch { /* ignore */ } };
  }, []);

  // Maintain subscriptions diff
  useEffect(() => {
    const next = new Set(symbols.filter(s => /^[A-Z.]{1,8}$/.test(s)));
    const prev = subscribedRef.current;
    const toAdd = Array.from(next).filter(s => !prev.has(s));
    const toRemove = Array.from(prev).filter(s => !next.has(s));
    subscribedRef.current = next;
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      if (toAdd.length) ws.send(JSON.stringify({ action: "subscribe", trades: toAdd }));
      if (toRemove.length) ws.send(JSON.stringify({ action: "unsubscribe", trades: toRemove }));
    }
  }, [symbols.join(",")]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      try { wsRef.current?.close(); } catch { /* ignore */ }
      wsRef.current = null;
    };
  }, [connect]);

  return { connected };
}