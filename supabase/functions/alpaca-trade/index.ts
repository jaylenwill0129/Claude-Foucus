import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PAPER_BASE = "https://paper-api.alpaca.markets";
const LIVE_BASE = "https://api.alpaca.markets";
const DATA_BASE = "https://data.alpaca.markets";
const CRYPTO_DATA_BASE = "https://data.alpaca.markets/v1beta3/crypto/us";

function isCryptoSymbol(symbol: string): boolean {
  return symbol.includes("/") && symbol.endsWith("USD");
}

function toAlpacaCryptoFormat(displaySymbol: string): string {
  // BTCUSD → BTC/USD
  if (displaySymbol.includes("/")) return displaySymbol;
  return displaySymbol.replace(/USD$/, "/USD");
}

// Alpaca-renamed/unsupported crypto tickers. Map display → Alpaca tradable.
// RNDR was rebranded to RENDER; MATIC → POL on Alpaca, etc.
const CRYPTO_ALIASES: Record<string, string> = {
  "RNDR/USD": "RENDER/USD",
  "MATIC/USD": "POL/USD",
};

function parseInactiveAssetMessage(message: string): string | null {
  const match = message.match(/asset\s+([^\"]+)\s+is not active/i);
  return match?.[1]?.trim() ?? null;
}

function skippedInactiveAssetResponse(symbol: string, message?: string) {
  return new Response(JSON.stringify({
    skipped: true,
    reason: "asset_inactive",
    message: message || `${symbol} is not active/tradable on Alpaca — skipping order`,
    symbol,
  }), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeTradingSymbol(input: string): string {
  let s = String(input).toUpperCase();
  if (s.endsWith("USD") && s.length > 4 && !s.includes("/")) {
    s = toAlpacaCryptoFormat(s);
  }
  return CRYPTO_ALIASES[s] ?? s;
}

type PaperAccount = "paper1" | "paper2";

function getCredentials(mode: "paper" | "live", paperAccount: PaperAccount = "paper2") {
  if (mode === "live") {
    const key = Deno.env.get("ALPACA_LIVE_API_KEY");
    const secret = Deno.env.get("ALPACA_LIVE_API_SECRET");
    if (key && secret) return { key, secret, base: LIVE_BASE };
    throw new Error("Live Alpaca API credentials not configured. Add ALPACA_LIVE_API_KEY and ALPACA_LIVE_API_SECRET secrets.");
  }
  // Paper account selection: paper1 = ALPACA_API_KEY, paper2 = ALPACA_PAPER2_API_KEY
  const primaryKeyName = paperAccount === "paper1" ? "ALPACA_API_KEY" : "ALPACA_PAPER2_API_KEY";
  const primarySecretName = paperAccount === "paper1" ? "ALPACA_API_SECRET" : "ALPACA_PAPER2_API_SECRET";
  const fallbackKeyName = paperAccount === "paper1" ? "ALPACA_PAPER2_API_KEY" : "ALPACA_API_KEY";
  const fallbackSecretName = paperAccount === "paper1" ? "ALPACA_PAPER2_API_SECRET" : "ALPACA_API_SECRET";
  const key = Deno.env.get(primaryKeyName) ?? Deno.env.get(fallbackKeyName);
  const secret = Deno.env.get(primarySecretName) ?? Deno.env.get(fallbackSecretName);
  if (key && secret) return { key, secret, base: PAPER_BASE };
  throw new Error(`Paper Alpaca API credentials not configured for ${paperAccount}.`);
}

async function alpacaFetch(path: string, method: string, body?: any, mode: "paper" | "live" = "paper", useDataApi = false, paperAccount: PaperAccount = "paper2") {
  const creds = getCredentials(mode, paperAccount);
  const base = useDataApi ? DATA_BASE : creds.base;

  const headers: Record<string, string> = {
    "APCA-API-KEY-ID": creds.key,
    "APCA-API-SECRET-KEY": creds.secret,
    "Content-Type": "application/json",
  };

  const options: RequestInit = { method, headers };
  if (body && (method === "POST" || method === "PATCH")) {
    options.body = JSON.stringify(body);
  }

  const url = `${base}${path}`;
  const resp = await fetch(url, options);
  const data = await resp.json().catch(() => null);

  if (!resp.ok) {
    throw new Error(`Alpaca API error [${resp.status}]: ${JSON.stringify(data)}`);
  }

  return data;
}

function parseNumericValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function roundPriceToCent(value: number, direction: "up" | "down"): number {
  const scaled = value * 100;
  const rounded = direction === "up"
    ? Math.ceil(scaled - 1e-9)
    : Math.floor(scaled + 1e-9);
  return Number((rounded / 100).toFixed(2));
}

async function getReferencePrice(symbol: string, mode: "paper" | "live", fallback?: unknown, paperAccount: PaperAccount = "paper2"): Promise<number | null> {
  const fallbackPrice = parseNumericValue(fallback);
  if (fallbackPrice !== null && fallbackPrice > 0) return fallbackPrice;

  try {
    const snapshots = await alpacaFetch(
      `/v2/stocks/snapshots?symbols=${encodeURIComponent(symbol)}&feed=iex`,
      "GET",
      undefined,
      mode,
      true,
      paperAccount,
    );
    const snapshot = snapshots?.[symbol] ?? snapshots?.[symbol.toUpperCase()];
    return parseNumericValue(snapshot?.latestTrade?.p)
      ?? parseNumericValue(snapshot?.minuteBar?.c)
      ?? parseNumericValue(snapshot?.dailyBar?.c)
      ?? fallbackPrice;
  } catch {
    return fallbackPrice;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, ...params } = await req.json();
    const mode = params.mode || "paper";
    const paperAccount: PaperAccount = params.paperAccount === "paper1" ? "paper1" : "paper2";

    let result: any;

    switch (action) {
      case "verify": {
        try {
          const acc = await alpacaFetch("/v2/account", "GET", undefined, mode, false, paperAccount);
          result = { connected: true, status: acc.status, account_number: acc.account_number, mode };
        } catch (e: any) {
          result = { connected: false, error: e.message, mode };
        }
        break;
      }

      case "account": {
        result = await alpacaFetch("/v2/account", "GET", undefined, mode, false, paperAccount);
        break;
      }

      // Enhanced order with bracket (take-profit + stop-loss) support
      case "order": {
        const { symbol, qty, side, type = "market", time_in_force = "day", limit_price, stop_price, notional, take_profit, stop_loss, order_class, base_price } = params;
        if (!symbol || !side) {
          return new Response(JSON.stringify({ error: "symbol and side are required" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const normalizedSymbol = normalizeTradingSymbol(symbol);
        const isCrypto = isCryptoSymbol(normalizedSymbol);
        const parsedQty = parseNumericValue(qty);
        const parsedNotional = parseNumericValue(notional);
        const parsedLimitPrice = parseNumericValue(limit_price);
        const parsedStopPrice = parseNumericValue(stop_price);
        const parsedTakeProfit = parseNumericValue(take_profit);
        const parsedStopLoss = parseNumericValue(stop_loss);
        const hasQty = parsedQty !== null && parsedQty > 0;
        const hasNotional = parsedNotional !== null && parsedNotional > 0;

        // Alpaca does not support advanced order_class (bracket/oco/oto/otoco) or
        // attached take_profit/stop_loss legs for crypto — strip them silently.
        let effectiveOrderClass = isCrypto ? undefined : order_class;
        let allowAdvancedLegs = !isCrypto;

        // Crypto uses GTC by default, fractional qty allowed
        const effectiveTif = isCrypto ? (time_in_force === "day" ? "gtc" : time_in_force) : time_in_force;
        const orderBody: any = { symbol: normalizedSymbol, side, type, time_in_force: effectiveTif };

        // Pre-flight: verify the asset is active/tradable on Alpaca to avoid 422 "not active" errors
        try {
          const asset = await alpacaFetch(`/v2/assets/${encodeURIComponent(normalizedSymbol)}`, "GET", undefined, mode, false, paperAccount);
          const tradable = asset?.tradable === true && (asset?.status ?? "active") === "active";
          if (!tradable) {
            return skippedInactiveAssetResponse(normalizedSymbol);
          }
        } catch (e) {
          // Unknown symbol (e.g. SUI/USD not listed) — soft-skip instead of 422
          const msg = e instanceof Error ? e.message : String(e);
          if (/not found|404/i.test(msg)) {
            return skippedInactiveAssetResponse(normalizedSymbol, `${normalizedSymbol} is not listed on Alpaca — skipping order`);
          }
          // Other lookup failures: let the order attempt proceed
        }

        // Skip shortability check for crypto (can't short crypto on Alpaca)
        if (side === "sell" && !isCrypto) {
          let hasLongPosition = false;
          try {
            const position = await alpacaFetch(`/v2/positions/${encodeURIComponent(normalizedSymbol)}`, "GET", undefined, mode, false, paperAccount);
            hasLongPosition = position?.side === "long" && (parseNumericValue(position?.qty) ?? 0) > 0;
          } catch {
            hasLongPosition = false;
          }

          if (!hasLongPosition) {
            try {
              const asset = await alpacaFetch(`/v2/assets/${encodeURIComponent(normalizedSymbol)}`, "GET", undefined, mode, false, paperAccount);
              if (!asset.shortable) {
                // Soft-skip: not an error, just unsupported for this asset
                return new Response(JSON.stringify({
                  skipped: true,
                  reason: "not_shortable",
                  message: `${normalizedSymbol} is not shortable on Alpaca — skipping order`,
                  symbol: normalizedSymbol,
                }), {
                  status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
                });
              }
            } catch {
            }
          }
        } else if (side === "sell" && isCrypto) {
          // Crypto: verify we hold a position before selling
          try {
            const position = await alpacaFetch(`/v2/positions/${encodeURIComponent(normalizedSymbol)}`, "GET", undefined, mode, false, paperAccount);
            if (!position || (parseNumericValue(position?.qty) ?? 0) <= 0) {
              return new Response(JSON.stringify({ error: `No ${normalizedSymbol} position to sell — crypto shorting not supported` }), {
                status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
              });
            }
          } catch {
            return new Response(JSON.stringify({ error: `No ${normalizedSymbol} position found` }), {
              status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
        }

        if (effectiveOrderClass) {
          orderBody.order_class = effectiveOrderClass;
        }

        // Alpaca rejects advanced order_class (bracket/oto/oco/otoco) when the order
        // would not be an entry — i.e. when a same-side position already exists, the
        // new order is treated as an add-to/reduce and brackets aren't allowed.
        // Detect that case and downgrade to a plain order.
        if (
          orderBody.order_class &&
          (orderBody.order_class === "bracket" || orderBody.order_class === "oto" ||
            orderBody.order_class === "oco" || orderBody.order_class === "otoco")
        ) {
          try {
            const existing = await alpacaFetch(
              `/v2/positions/${encodeURIComponent(normalizedSymbol)}`,
              "GET", undefined, mode, false, paperAccount,
            );
            const existingQty = parseNumericValue(existing?.qty) ?? 0;
            const existingSide = existing?.side; // "long" | "short"
            const sameSide =
              (side === "buy" && existingSide === "long" && existingQty > 0) ||
              (side === "sell" && existingSide === "short" && existingQty > 0);
            if (sameSide) {
              console.log(`Stripping ${orderBody.order_class} legs — existing ${existingSide} position on ${normalizedSymbol}, not an entry order`);
              delete orderBody.order_class;
              effectiveOrderClass = undefined;
              allowAdvancedLegs = false;
            }
          } catch {
            // No existing position (404) — entry order, keep bracket
          }
        }

        if (hasNotional) {
          orderBody.notional = parsedNotional.toFixed(2);
        } else if (hasQty) {
          orderBody.qty = String(parsedQty);
        } else {
          return new Response(JSON.stringify({ error: "qty or notional is required" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        if (parsedLimitPrice !== null) orderBody.limit_price = parsedLimitPrice.toFixed(2);
        if (parsedStopPrice !== null) orderBody.stop_price = parsedStopPrice.toFixed(2);

        if (allowAdvancedLegs && (effectiveOrderClass === "bracket" || effectiveOrderClass === "oco" || effectiveOrderClass === "oto") && (parsedTakeProfit !== null || parsedStopLoss !== null)) {
          const referencePrice = await getReferencePrice(
            normalizedSymbol,
            mode,
            parseNumericValue(base_price) ?? parsedLimitPrice ?? parsedStopPrice,
            paperAccount,
          );
          // Alpaca evaluates against its own base_price (latest trade) which can drift
          // from our referencePrice. Use a generous buffer + percentage floor to stay
          // safely above base_price + 0.01 (Alpaca's minimum gap).
          const pctBuffer = (referencePrice ?? 0) * 0.005; // 0.5%
          const priceBuffer = Math.max(type === "market" ? 0.05 : 0.03, pctBuffer);

          if (referencePrice !== null && referencePrice > priceBuffer) {
            const minAboveBase = roundPriceToCent(referencePrice + priceBuffer, "up");
            const maxBelowBase = roundPriceToCent(referencePrice - priceBuffer, "down");

            if (side === "buy") {
              if (parsedTakeProfit !== null) {
                const safeTakeProfit = Math.max(roundPriceToCent(parsedTakeProfit, "up"), minAboveBase);
                orderBody.take_profit = { limit_price: safeTakeProfit.toFixed(2) };
              }
              if (parsedStopLoss !== null) {
                const safeStopLoss = Math.min(roundPriceToCent(parsedStopLoss, "down"), maxBelowBase);
                orderBody.stop_loss = { stop_price: safeStopLoss.toFixed(2) };
              }
            } else {
              if (parsedTakeProfit !== null) {
                const safeTakeProfit = Math.min(roundPriceToCent(parsedTakeProfit, "down"), maxBelowBase);
                orderBody.take_profit = { limit_price: safeTakeProfit.toFixed(2) };
              }
              if (parsedStopLoss !== null) {
                const safeStopLoss = Math.max(roundPriceToCent(parsedStopLoss, "up"), minAboveBase);
                orderBody.stop_loss = { stop_price: safeStopLoss.toFixed(2) };
              }
            }

            console.log("Sanitized bracket order", {
              symbol: normalizedSymbol,
              side,
              type,
              referencePrice,
              takeProfit: orderBody.take_profit?.limit_price ?? null,
              stopLoss: orderBody.stop_loss?.stop_price ?? null,
            });
          } else {
            if (parsedTakeProfit !== null) {
              orderBody.take_profit = { limit_price: parsedTakeProfit.toFixed(2) };
            }
            if (parsedStopLoss !== null) {
              orderBody.stop_loss = { stop_price: parsedStopLoss.toFixed(2) };
            }
          }
        } else if (allowAdvancedLegs) {
          if (parsedTakeProfit !== null) {
            orderBody.take_profit = { limit_price: parsedTakeProfit.toFixed(2) };
          }
          if (parsedStopLoss !== null) {
            orderBody.stop_loss = { stop_price: parsedStopLoss.toFixed(2) };
          }
        }

        try {
          result = await alpacaFetch("/v2/orders", "POST", orderBody, mode, false, paperAccount);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const inactiveSymbol = parseInactiveAssetMessage(message);
          if (inactiveSymbol) {
            return skippedInactiveAssetResponse(inactiveSymbol, `${inactiveSymbol} is not active on Alpaca — skipping order`);
          }
          // Account-level shorting disabled (403 / code 40310000)
          if (/not allowed to short|40310000/i.test(message)) {
            return new Response(JSON.stringify({
              skipped: true,
              reason: "shorting_disabled",
              message: `${normalizedSymbol}: account is not allowed to short — skipping order`,
              symbol: normalizedSymbol,
            }), {
              status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          throw err;
        }
        break;
      }

      case "positions": {
        result = await alpacaFetch("/v2/positions", "GET", undefined, mode, false, paperAccount);
        break;
      }

      case "close_position": {
        const { symbol: closeSym, qty: closeQty, percentage } = params;
        if (!closeSym) {
          return new Response(JSON.stringify({ error: "symbol is required" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const closeNormalized = normalizeTradingSymbol(closeSym);
        const queryParams = percentage ? `?percentage=${percentage}` : closeQty ? `?qty=${closeQty}` : "";
        result = await alpacaFetch(`/v2/positions/${encodeURIComponent(closeNormalized)}${queryParams}`, "DELETE", undefined, mode, false, paperAccount);
        break;
      }

      case "close_all": {
        result = await alpacaFetch("/v2/positions?cancel_orders=true", "DELETE", undefined, mode, false, paperAccount);
        break;
      }

      case "orders": {
        const status = params.status || "all";
        const limit = params.limit || 50;
        result = await alpacaFetch(`/v2/orders?status=${status}&limit=${limit}&direction=desc`, "GET", undefined, mode, false, paperAccount);
        break;
      }

      case "cancel_order": {
        const { order_id } = params;
        if (!order_id) {
          return new Response(JSON.stringify({ error: "order_id is required" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        result = await alpacaFetch(`/v2/orders/${order_id}`, "DELETE", undefined, mode, false, paperAccount);
        break;
      }

      case "cancel_all": {
        result = await alpacaFetch("/v2/orders", "DELETE", undefined, mode, false, paperAccount);
        break;
      }

      case "clock": {
        result = await alpacaFetch("/v2/clock", "GET", undefined, mode, false, paperAccount);
        break;
      }

      // Backfill recent 1-minute bars for one or more symbols.
      // Used to seed the in-app price history so charts show LIVE data
      // immediately on mount (no SIMULATED warm-up window) and so micro-prediction
      // engines have real bars to analyze from minute 1.
      case "bars": {
        const requested: string[] = Array.isArray(params.symbols)
          ? params.symbols.map((s: string) => String(s).toUpperCase())
          : params.symbol ? [String(params.symbol).toUpperCase()] : [];
        if (requested.length === 0) {
          return new Response(JSON.stringify({ error: "symbols or symbol is required" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const timeframe = params.timeframe || "1Min";
        const limit = Math.min(Math.max(parseInt(params.limit ?? "120", 10) || 120, 1), 1000);

        // Split crypto vs equity — different endpoints
        const cryptoSyms: string[] = [];
        const equitySyms: string[] = [];
        for (const raw of requested) {
          let s = raw;
          if (s.endsWith("USD") && s.length > 4 && !s.includes("/")) s = toAlpacaCryptoFormat(s);
          if (isCryptoSymbol(s)) cryptoSyms.push(s); else equitySyms.push(s);
        }

        const out: Record<string, Array<{ t: string; o: number; h: number; l: number; c: number; v: number }>> = {};

        if (equitySyms.length > 0) {
          // Alpaca v2 stocks/bars supports comma-separated symbols
          const qs = `symbols=${encodeURIComponent(equitySyms.join(","))}&timeframe=${encodeURIComponent(timeframe)}&limit=${limit}&feed=iex&adjustment=raw`;
          try {
            const data = await alpacaFetch(`/v2/stocks/bars?${qs}`, "GET", undefined, mode, true, paperAccount);
            if (data?.bars && typeof data.bars === "object") {
              for (const sym of Object.keys(data.bars)) {
                out[sym] = data.bars[sym] ?? [];
              }
            }
          } catch (e: any) {
            console.warn("equity bars fetch failed", e?.message);
          }
        }

        for (const sym of cryptoSyms) {
          try {
            const qs = `symbols=${encodeURIComponent(sym)}&timeframe=${encodeURIComponent(timeframe)}&limit=${limit}`;
            const url = `${CRYPTO_DATA_BASE}/bars?${qs}`;
            const creds = getCredentials(mode);
            const resp = await fetch(url, {
              headers: {
                "APCA-API-KEY-ID": creds.key,
                "APCA-API-SECRET-KEY": creds.secret,
              },
            });
            const data = await resp.json().catch(() => null);
            if (resp.ok && data?.bars?.[sym]) {
              // Normalize crypto display key (BTC/USD -> BTCUSD) so client lookups work
              out[sym.replace("/", "")] = data.bars[sym];
            }
          } catch (e: any) {
            console.warn(`crypto bars fetch failed for ${sym}`, e?.message);
          }
        }

        result = { bars: out, timeframe, limit };
        break;
      }

      // Portfolio history for P&L charts
      case "portfolio_history": {
        const period = params.period || "1M";
        const timeframe = params.timeframe || "1D";
        result = await alpacaFetch(`/v2/account/portfolio/history?period=${period}&timeframe=${timeframe}`, "GET", undefined, mode, false, paperAccount);
        break;
      }

      // Get account activities (fills, dividends, etc.)
      case "activities": {
        const activityType = params.activity_type || "FILL";
        const limit = params.limit || 50;
        result = await alpacaFetch(`/v2/account/activities/${activityType}?direction=desc&page_size=${limit}`, "GET", undefined, mode, false, paperAccount);
        break;
      }

      // Replace an existing order (modify)
      case "replace_order": {
        const { order_id: replaceId, qty: newQty, limit_price: newLimit, stop_price: newStop, time_in_force: newTif } = params;
        if (!replaceId) {
          return new Response(JSON.stringify({ error: "order_id is required" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const replaceBody: any = {};
        if (newQty) replaceBody.qty = String(newQty);
        if (newLimit) replaceBody.limit_price = String(newLimit);
        if (newStop) replaceBody.stop_price = String(newStop);
        if (newTif) replaceBody.time_in_force = newTif;
        result = await alpacaFetch(`/v2/orders/${replaceId}`, "PATCH", replaceBody, mode, false, paperAccount);
        break;
      }

      // Get latest quote for a symbol
      case "quote": {
        const { symbol: quoteSym } = params;
        if (!quoteSym) {
          return new Response(JSON.stringify({ error: "symbol is required" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const creds = getCredentials(mode);
        const quoteResp = await fetch(`${DATA_BASE}/v2/stocks/${encodeURIComponent(quoteSym)}/quotes/latest`, {
          headers: {
            "APCA-API-KEY-ID": creds.key,
            "APCA-API-SECRET-KEY": creds.secret,
          },
        });
        result = await quoteResp.json();
        break;
      }

      // Batch latest trades for multiple symbols (live prices)
      case "batch_quotes": {
        const { symbols: batchSymbols } = params;
        if (!batchSymbols || !Array.isArray(batchSymbols) || batchSymbols.length === 0) {
          return new Response(JSON.stringify({ error: "symbols array is required" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const creds = getCredentials(mode);
        const symbolsParam = batchSymbols.slice(0, 50).join(",");
        const tradesResp = await fetch(`${DATA_BASE}/v2/stocks/trades/latest?symbols=${encodeURIComponent(symbolsParam)}&feed=iex`, {
          headers: {
            "APCA-API-KEY-ID": creds.key,
            "APCA-API-SECRET-KEY": creds.secret,
          },
        });
        result = await tradesResp.json();
        break;
      }

      // Batch latest bars for multiple symbols (OHLCV)
      case "batch_bars": {
        const { symbols: barSymbols, timeframe: barTf } = params;
        if (!barSymbols || !Array.isArray(barSymbols) || barSymbols.length === 0) {
          return new Response(JSON.stringify({ error: "symbols array is required" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const creds = getCredentials(mode);
        const syms = barSymbols.slice(0, 50).join(",");
        const tf = barTf || "1Day";
        const barsResp = await fetch(`${DATA_BASE}/v2/stocks/bars/latest?symbols=${encodeURIComponent(syms)}&feed=iex`, {
          headers: {
            "APCA-API-KEY-ID": creds.key,
            "APCA-API-SECRET-KEY": creds.secret,
          },
        });
        result = await barsResp.json();
        break;
      }

      // Snapshot: latest trade + quote + bar for multiple symbols
      case "snapshots": {
        const { symbols: snapSymbols } = params;
        if (!snapSymbols || !Array.isArray(snapSymbols) || snapSymbols.length === 0) {
          return new Response(JSON.stringify({ error: "symbols array is required" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const creds = getCredentials(mode);
        const syms = snapSymbols.slice(0, 50).join(",");
        const snapResp = await fetch(`${DATA_BASE}/v2/stocks/snapshots?symbols=${encodeURIComponent(syms)}&feed=iex`, {
          headers: {
            "APCA-API-KEY-ID": creds.key,
            "APCA-API-SECRET-KEY": creds.secret,
          },
        });
        result = await snapResp.json();
        break;
      }

      // Crypto snapshots
      case "crypto_snapshots": {
        const { symbols: cryptoSyms } = params;
        if (!cryptoSyms || !Array.isArray(cryptoSyms) || cryptoSyms.length === 0) {
          return new Response(JSON.stringify({ error: "symbols array is required" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const creds = getCredentials(mode);
        // Convert display symbols (BTCUSD) to API format (BTC/USD)
        const apiSyms = cryptoSyms.map((s: string) => toAlpacaCryptoFormat(s)).slice(0, 50).join(",");
        const cryptoResp = await fetch(`${CRYPTO_DATA_BASE}/snapshots?symbols=${encodeURIComponent(apiSyms)}`, {
          headers: {
            "APCA-API-KEY-ID": creds.key,
            "APCA-API-SECRET-KEY": creds.secret,
          },
        });
        result = await cryptoResp.json();
        break;
      }

      // Crypto latest quotes
      case "crypto_quote": {
        const { symbol: cqSym } = params;
        if (!cqSym) {
          return new Response(JSON.stringify({ error: "symbol is required" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const creds = getCredentials(mode);
        const apiSym = toAlpacaCryptoFormat(cqSym);
        const cqResp = await fetch(`${CRYPTO_DATA_BASE}/latest/trades?symbols=${encodeURIComponent(apiSym)}`, {
          headers: {
            "APCA-API-KEY-ID": creds.key,
            "APCA-API-SECRET-KEY": creds.secret,
          },
        });
        result = await cqResp.json();
        break;
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Alpaca function error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    const statusMatch = message.match(/Alpaca API error \[(\d{3})\]/);
    const status = statusMatch ? Number(statusMatch[1]) : 500;
    return new Response(JSON.stringify({ error: message }), {
      status: status >= 400 && status < 500 ? status : 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
