// WebSocket proxy that bridges browser clients to Alpaca's IEX market-data
// stream. The browser cannot connect to Alpaca directly without leaking the
// API key; this function holds the upstream connection, authenticates with
// server-side credentials, and relays subscribe/unsubscribe + trade/quote/bar
// events. One upstream connection per client connection keeps the logic
// simple and avoids cross-user symbol leakage.
//
// Client protocol (JSON over WS):
//   { action: "subscribe",   trades?: string[], quotes?: string[], bars?: string[] }
//   { action: "unsubscribe", trades?: string[], quotes?: string[], bars?: string[] }
// Server forwards Alpaca messages verbatim. Heartbeat ping every 30s.

const ALPACA_WS_URL = "wss://stream.data.alpaca.markets/v2/iex";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, upgrade",
};

Deno.serve((req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const upgrade = req.headers.get("upgrade") || "";
  if (upgrade.toLowerCase() !== "websocket") {
    return new Response(JSON.stringify({ error: "Expected WebSocket upgrade" }), {
      status: 426,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const key = Deno.env.get("ALPACA_API_KEY");
  const secret = Deno.env.get("ALPACA_API_SECRET");
  if (!key || !secret) {
    return new Response(JSON.stringify({ error: "Alpaca credentials missing" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { socket: client, response } = Deno.upgradeWebSocket(req);
  let upstream: WebSocket | null = null;
  let authed = false;
  const pendingSubs: any[] = [];
  let pingTimer: number | null = null;

  const safeSend = (sock: WebSocket | null, payload: unknown) => {
    if (!sock || sock.readyState !== WebSocket.OPEN) return;
    try { sock.send(typeof payload === "string" ? payload : JSON.stringify(payload)); } catch { /* ignore */ }
  };

  const connectUpstream = () => {
    upstream = new WebSocket(ALPACA_WS_URL);
    upstream.onopen = () => {
      safeSend(upstream, { action: "auth", key, secret });
    };
    upstream.onmessage = (ev) => {
      // Alpaca ws frames are JSON arrays. Detect auth success then flush queued subs.
      if (!authed) {
        try {
          const arr = JSON.parse(ev.data);
          if (Array.isArray(arr) && arr.some((m) => m?.T === "success" && m?.msg === "authenticated")) {
            authed = true;
            for (const sub of pendingSubs) safeSend(upstream, sub);
            pendingSubs.length = 0;
          }
        } catch { /* fallthrough relay */ }
      }
      safeSend(client, ev.data);
    };
    upstream.onerror = (e) => {
      console.warn("upstream error", e);
      safeSend(client, JSON.stringify([{ T: "error", msg: "upstream error" }]));
    };
    upstream.onclose = () => {
      try { client.close(1011, "upstream closed"); } catch { /* ignore */ }
    };
  };

  client.onopen = () => {
    connectUpstream();
    pingTimer = setInterval(() => safeSend(client, JSON.stringify([{ T: "ping" }])), 30_000) as unknown as number;
  };

  client.onmessage = (ev) => {
    let msg: any;
    try { msg = typeof ev.data === "string" ? JSON.parse(ev.data) : null; } catch { return; }
    if (!msg || (msg.action !== "subscribe" && msg.action !== "unsubscribe")) return;
    const forward = {
      action: msg.action,
      trades: Array.isArray(msg.trades) ? msg.trades : undefined,
      quotes: Array.isArray(msg.quotes) ? msg.quotes : undefined,
      bars: Array.isArray(msg.bars) ? msg.bars : undefined,
    };
    if (!authed) pendingSubs.push(forward);
    else safeSend(upstream, forward);
  };

  client.onclose = () => {
    if (pingTimer) clearInterval(pingTimer);
    try { upstream?.close(); } catch { /* ignore */ }
  };
  client.onerror = () => {
    if (pingTimer) clearInterval(pingTimer);
    try { upstream?.close(); } catch { /* ignore */ }
  };

  // Add CORS headers to the upgrade response
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(corsHeaders)) headers.set(k, v);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
});
