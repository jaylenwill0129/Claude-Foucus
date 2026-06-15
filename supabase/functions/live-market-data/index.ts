type AssetClass = "option" | "future" | "stock";

interface LiveQuote {
  symbol: string;
  underlyingSymbol?: string;
  assetClass: AssetClass;
  price: number;
  changePct: number;
  bid?: number;
  ask?: number;
  volume?: number;
  openInterest?: number;
  impliedVolatility?: number;
  delta?: number;
  gamma?: number;
  theta?: number;
  expiration?: string;
  strike?: number;
  contractType?: "call" | "put";
  source: "alpha_vantage" | "polygon" | "futures_proxy" | "fallback";
  updatedAt: string;
}

type CatalystType = "takeover" | "earnings" | "guidance" | "regulatory" | "product" | "unusual_options" | "macro";

interface CatalystEvent {
  symbol: string;
  type: CatalystType;
  headline: string;
  detectedAt: string;
  movePct: number;
  stockPrice: number;
  dealPrice?: number;
  optionVolume?: number;
  urgencyScore: number;
  chaseRisk: "low" | "medium" | "high";
  sources?: string[];
  corroborationScore?: number;
  contractSignal: string;
  action: string;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const safeNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function redactProviderMessage(message: string) {
  return message
    .replace(/[A-Z0-9]{12,}/g, "[redacted]")
    .replace(/apikey=[^&\s]+/gi, "apikey=[redacted]");
}

function parsePct(value: unknown) {
  if (typeof value === "number") return value;
  return safeNumber(String(value ?? "").replace("%", ""));
}

function normalizeTicker(value: string) {
  return value.replace(/^[A-Z]+:/, "").replace(/[^A-Z0-9.-]/gi, "").toUpperCase();
}

function inferCatalystType(text: string): CatalystType {
  const lower = text.toLowerCase();
  if (/(acquire|acquisition|merger|takeover|buyout|cash offer|deal price|tender offer)/.test(lower)) return "takeover";
  if (/(earnings|revenue|eps|guidance|forecast|outlook)/.test(lower)) return "earnings";
  if (/(fda|approval|regulatory|sec |doj |ftc )/.test(lower)) return "regulatory";
  if (/(launch|chip|ai|product|partnership|contract|award)/.test(lower)) return "product";
  return "macro";
}

function eventActionFor(type: CatalystType, movePct: number) {
  if (type === "takeover") return "Flag immediately. If price is already near the cash/deal value, avoid chasing calls unless a higher bid is confirmed.";
  if (Math.abs(movePct) >= 12) return "Big move detected. Wait for opening-range hold and live option spread confirmation before considering a trade.";
  if (type === "earnings") return "Treat as event risk. Prefer defined-risk structures and avoid holding through IV crush without a plan.";
  return "Watch for confirmation from price, volume, and option spreads before entering.";
}

function chaseRiskFor(type: CatalystType, movePct: number): CatalystEvent["chaseRisk"] {
  if (type === "takeover" || Math.abs(movePct) >= 18) return "high";
  if (Math.abs(movePct) >= 8 || type === "earnings") return "medium";
  return "low";
}

function urgencyFor(type: CatalystType, movePct: number, relevance = 0, sentiment = 0) {
  const typeBoost = type === "takeover" ? 34 : type === "earnings" ? 18 : type === "product" ? 14 : 10;
  return Math.round(Math.min(100, Math.max(0, Math.abs(movePct) * 2.2 + relevance * 34 + Math.abs(sentiment) * 18 + typeBoost)));
}

function withSource(events: CatalystEvent[], source: string) {
  return events.map((event) => ({
    ...event,
    sources: Array.from(new Set([...(event.sources ?? []), source])),
  }));
}

function mergeProviderCatalysts(groups: CatalystEvent[][]): CatalystEvent[] {
  const bySymbol = new Map<string, CatalystEvent>();

  groups.flat().forEach((event) => {
    const symbol = normalizeTicker(event.symbol);
    if (!symbol) return;
    const sources = Array.from(new Set(event.sources?.length ? event.sources : ["Unknown"]));
    const existing = bySymbol.get(symbol);

    if (!existing) {
      bySymbol.set(symbol, { ...event, symbol, sources, corroborationScore: sources.length });
      return;
    }

    const mergedSources = Array.from(new Set([...(existing.sources ?? []), ...sources]));
    const stronger = event.urgencyScore > existing.urgencyScore ? event : existing;
    bySymbol.set(symbol, {
      ...stronger,
      symbol,
      movePct: Math.abs(event.movePct) > Math.abs(existing.movePct) ? event.movePct : existing.movePct,
      stockPrice: event.stockPrice || existing.stockPrice,
      dealPrice: event.dealPrice ?? existing.dealPrice,
      optionVolume: Math.max(event.optionVolume ?? 0, existing.optionVolume ?? 0) || undefined,
      urgencyScore: Math.min(100, Math.max(existing.urgencyScore, event.urgencyScore) + Math.min(18, (mergedSources.length - 1) * 6)),
      sources: mergedSources,
      corroborationScore: mergedSources.length,
      action: mergedSources.length > 1 ? `Confirmed by ${mergedSources.length} sources. ${stronger.action}` : stronger.action,
    });
  });

  return Array.from(bySymbol.values()).sort((a, b) => b.urgencyScore - a.urgencyScore).slice(0, 30);
}

async function fetchPolygonOptions(apiKey: string, underlyings: string[]): Promise<LiveQuote[]> {
  const settled = await Promise.allSettled(
    underlyings.map(async (underlying) => {
      const url = new URL(`https://api.polygon.io/v3/snapshot/options/${underlying}`);
      url.searchParams.set("limit", "20");
      url.searchParams.set("apiKey", apiKey);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${underlying} options ${response.status}`);
      const payload = await response.json();
      const contracts = Array.isArray(payload.results) ? payload.results : [];
      return contracts.slice(0, 8).map((contract: any): LiveQuote => {
        const details = contract.details ?? {};
        const quote = contract.last_quote ?? {};
        const greeks = contract.greeks ?? {};
        const day = contract.day ?? {};
        const bid = quote.bid === undefined ? undefined : safeNumber(quote.bid);
        const ask = quote.ask === undefined ? undefined : safeNumber(quote.ask);
        const price = safeNumber(contract.fmv, safeNumber(day.close, bid && ask ? (bid + ask) / 2 : 0));

        return {
          symbol: details.ticker ?? `${underlying} option`,
          underlyingSymbol: underlying,
          assetClass: "option",
          price,
          changePct: safeNumber(day.change_percent),
          bid,
          ask,
          volume: safeNumber(day.volume),
          openInterest: safeNumber(contract.open_interest),
          impliedVolatility: safeNumber(contract.implied_volatility),
          delta: safeNumber(greeks.delta),
          gamma: safeNumber(greeks.gamma),
          theta: safeNumber(greeks.theta),
          expiration: details.expiration_date,
          strike: safeNumber(details.strike_price),
          contractType: details.contract_type,
          source: "polygon",
          updatedAt: new Date().toISOString(),
        };
      });
    }),
  );

  return settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
}

function assertAlphaVantagePayload(payload: any, label: string) {
  const message = payload?.Information ?? payload?.Note ?? payload?.["Error Message"];
  if (message) throw new Error(`${label}: ${redactProviderMessage(message)}`);
}

async function fetchAlphaVantageOptions(apiKey: string, underlyings: string[]): Promise<LiveQuote[]> {
  const quotes: LiveQuote[] = [];

  for (const [index, underlying] of underlyings.entries()) {
    if (index > 0) await sleep(1200);
      const url = new URL("https://www.alphavantage.co/query");
      url.searchParams.set("function", "REALTIME_OPTIONS");
      url.searchParams.set("symbol", underlying);
      url.searchParams.set("require_greeks", "true");
      url.searchParams.set("apikey", apiKey);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${underlying} options ${response.status}`);
      const payload = await response.json();
      assertAlphaVantagePayload(payload, `${underlying} options`);
      const contracts = Array.isArray(payload.data) ? payload.data : Array.isArray(payload.options) ? payload.options : [];

      const normalized = contracts
        .filter((contract: any) => {
          const contractId = String(contract.contractID ?? contract.contract_id ?? "");
          return !contractId || contractId.toUpperCase().startsWith(underlying.toUpperCase());
        })
        .slice(0, 8)
        .map((contract: any): LiveQuote => {
        const bid = contract.bid === undefined ? undefined : safeNumber(contract.bid);
        const ask = contract.ask === undefined ? undefined : safeNumber(contract.ask);
        const price = safeNumber(contract.mark, safeNumber(contract.last, bid && ask ? (bid + ask) / 2 : 0));
        return {
          symbol: contract.contractID ?? contract.contract_id ?? `${underlying} option`,
          underlyingSymbol: underlying,
          assetClass: "option",
          price,
          changePct: safeNumber(contract.change_percentage ?? contract.percent_change),
          bid,
          ask,
          volume: safeNumber(contract.volume),
          openInterest: safeNumber(contract.open_interest),
          impliedVolatility: safeNumber(contract.implied_volatility),
          delta: safeNumber(contract.delta),
          gamma: safeNumber(contract.gamma),
          theta: safeNumber(contract.theta),
          expiration: contract.expiration,
          strike: safeNumber(contract.strike),
          contractType: contract.type,
          source: "alpha_vantage" as LiveQuote["source"],
          updatedAt: new Date().toISOString(),
        };
      });
      if (!normalized.length && contracts.length) {
        throw new Error(`${underlying} options returned sample or mismatched contracts`);
      }
      quotes.push(...normalized);
  }

  return quotes;
}

async function fetchFuturesProxy(proxyUrl: string, symbols: string[]): Promise<LiveQuote[]> {
  const url = new URL(proxyUrl);
  url.searchParams.set("symbols", symbols.join(","));
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Futures proxy ${response.status}`);
  const payload = await response.json();
  const quotes = Array.isArray(payload.quotes) ? payload.quotes : Array.isArray(payload) ? payload : [];

  return quotes.map((quote: any): LiveQuote => ({
    symbol: quote.symbol,
    assetClass: "future",
    price: safeNumber(quote.price ?? quote.last),
    changePct: safeNumber(quote.changePct ?? quote.change_percent),
    bid: quote.bid === undefined ? undefined : safeNumber(quote.bid),
    ask: quote.ask === undefined ? undefined : safeNumber(quote.ask),
    volume: quote.volume === undefined ? undefined : safeNumber(quote.volume),
    source: "futures_proxy",
    updatedAt: quote.updatedAt ?? new Date().toISOString(),
  }));
}

async function fetchPolygonCatalysts(apiKey: string): Promise<CatalystEvent[]> {
  const url = new URL("https://api.polygon.io/v2/reference/news");
  url.searchParams.set("limit", "50");
  url.searchParams.set("order", "descending");
  url.searchParams.set("sort", "published_utc");
  url.searchParams.set("apiKey", apiKey);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Polygon news ${response.status}`);
  const payload = await response.json();
  const articles = Array.isArray(payload.results) ? payload.results : [];
  const bySymbol = new Map<string, CatalystEvent>();

  articles.forEach((article: any) => {
    const headline = String(article.title ?? "Market catalyst detected");
    const description = String(article.description ?? "");
    const type = inferCatalystType(`${headline} ${description}`);
    const tickers = Array.isArray(article.tickers) ? article.tickers : [];
    tickers.slice(0, 6).forEach((ticker: string) => {
      const symbol = normalizeTicker(ticker);
      if (!symbol) return;
      const existing = bySymbol.get(symbol);
      const event: CatalystEvent = {
        symbol,
        type,
        headline,
        detectedAt: String(article.published_utc ?? new Date().toISOString()),
        movePct: existing?.movePct ?? 0,
        stockPrice: existing?.stockPrice ?? 0,
        optionVolume: existing?.optionVolume ?? 0,
        urgencyScore: urgencyFor(type, existing?.movePct ?? 0, 0.32, 0),
        chaseRisk: chaseRiskFor(type, existing?.movePct ?? 0),
        contractSignal: type === "takeover"
          ? "Potential deal/news repricing. Search the option chain immediately, but avoid calls after price pins near deal value."
          : "Fresh Polygon news hit. Confirm price reaction and cheap-option liquidity before entry.",
        action: eventActionFor(type, existing?.movePct ?? 0),
      };
      if (!existing || event.urgencyScore > existing.urgencyScore) bySymbol.set(symbol, event);
    });
  });

  return withSource(Array.from(bySymbol.values()).sort((a, b) => b.urgencyScore - a.urgencyScore).slice(0, 20), "Polygon News");
}

function benzingaNodeText(node: Element, tag: string) {
  return node.getElementsByTagName(tag)[0]?.textContent ?? "";
}

function parseBenzingaXmlItems(xml: string): any[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const items = Array.from(doc.getElementsByTagName("item"));
  return items.map((item) => ({
    id: benzingaNodeText(item, "id"),
    title: benzingaNodeText(item, "title") || benzingaNodeText(item, "description"),
    headline: benzingaNodeText(item, "title") || benzingaNodeText(item, "description"),
    teaser: benzingaNodeText(item, "teaser"),
    body: benzingaNodeText(item, "body"),
    created: benzingaNodeText(item, "created"),
    updated: benzingaNodeText(item, "updated"),
    ticker: benzingaNodeText(item, "ticker"),
    symbol: benzingaNodeText(item, "ticker") || benzingaNodeText(item, "symbol"),
    put_call: benzingaNodeText(item, "put_call"),
    option_type: benzingaNodeText(item, "option_type"),
    sentiment: benzingaNodeText(item, "sentiment"),
    volume: benzingaNodeText(item, "volume"),
    cost_basis: benzingaNodeText(item, "cost_basis"),
    strike_price: benzingaNodeText(item, "strike_price"),
    underlying_price: benzingaNodeText(item, "underlying_price"),
    stocks: Array.from(item.getElementsByTagName("stocks")[0]?.getElementsByTagName("item") ?? []).map((stock) => ({
      name: benzingaNodeText(stock, "name"),
    })),
  }));
}

async function fetchBenzingaPayload(url: URL) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Benzinga ${response.status}`);
  const text = await response.text();
  if (text.trim().startsWith("<")) return parseBenzingaXmlItems(text);
  return JSON.parse(text);
}

async function fetchBenzingaCatalysts(apiKey: string): Promise<CatalystEvent[]> {
  const bySymbol = new Map<string, CatalystEvent>();

  try {
    const newsUrl = new URL("https://api.benzinga.com/api/v2/news");
    newsUrl.searchParams.set("token", apiKey);
    newsUrl.searchParams.set("pageSize", "50");
    newsUrl.searchParams.set("displayOutput", "full");
    const payload = await fetchBenzingaPayload(newsUrl);
    const articles = Array.isArray(payload) ? payload : Array.isArray(payload.news) ? payload.news : Array.isArray(payload.data) ? payload.data : [];

    articles.forEach((article: any) => {
      const headline = String(article.title ?? article.headline ?? "Benzinga catalyst detected");
      const body = String(article.body ?? article.teaser ?? article.summary ?? "");
      const type = inferCatalystType(`${headline} ${body}`);
      const stocks = Array.isArray(article.stocks)
        ? article.stocks
        : Array.isArray(article.tickers)
          ? article.tickers
          : [];
      stocks.slice(0, 8).forEach((stock: any) => {
        const symbol = normalizeTicker(String(typeof stock === "string" ? stock : stock.name ?? stock.symbol ?? stock.ticker ?? ""));
        if (!symbol) return;
        const existing = bySymbol.get(symbol);
        bySymbol.set(symbol, {
          symbol,
          type,
          headline,
          detectedAt: String(article.created_at ?? article.updated_at ?? article.published_at ?? new Date().toISOString()),
          movePct: existing?.movePct ?? 0,
          stockPrice: existing?.stockPrice ?? 0,
          optionVolume: existing?.optionVolume ?? 0,
          urgencyScore: Math.max(existing?.urgencyScore ?? 0, urgencyFor(type, existing?.movePct ?? 0, 0.44, 0)),
          chaseRisk: chaseRiskFor(type, existing?.movePct ?? 0),
          contractSignal: type === "takeover"
            ? "Benzinga news hit: search the option chain immediately, then avoid calls after price pins near deal value."
            : "Benzinga catalyst hit: confirm price reaction, unusual options, bid/ask, and IV before entry.",
          action: eventActionFor(type, existing?.movePct ?? 0),
        });
      });
    });
  } catch {
    // Some Benzinga plans expose option activity without full newsfeed access.
  }

  try {
    const optionsUrl = new URL("https://api.benzinga.com/api/v1/signal/option_activity");
    optionsUrl.searchParams.set("token", apiKey);
    const payload = await fetchBenzingaPayload(optionsUrl);
    const rows = Array.isArray(payload.option_activity)
      ? payload.option_activity
      : Array.isArray(payload.data)
        ? payload.data
        : Array.isArray(payload)
          ? payload
          : [];

    rows.slice(0, 80).forEach((row: any) => {
      const symbol = normalizeTicker(String(row.ticker ?? row.symbol ?? ""));
      if (!symbol) return;
      const putCall = String(row.put_call ?? row.option_type ?? "").toUpperCase();
      const sentiment = String(row.sentiment ?? "").toUpperCase();
      const price = safeNumber(row.underlying_price ?? row.underlyingPrice);
      const optionVolume = safeNumber(row.volume ?? row.size ?? row.trade_count);
      const costBasis = safeNumber(row.cost_basis ?? row.costBasis);
      const strike = safeNumber(row.strike_price ?? row.strike);
      const existing = bySymbol.get(symbol);
      const type: CatalystType = existing?.type ?? "unusual_options";
      const optionUrgency = Math.min(100, Math.max(existing?.urgencyScore ?? 0, 46 + Math.log10(Math.max(10, costBasis || optionVolume)) * 12));
      bySymbol.set(symbol, {
        symbol,
        type,
        headline: existing?.headline ?? `${sentiment || "Unusual"} ${putCall || "option"} activity detected${strike ? ` near ${strike}` : ""}`,
        detectedAt: String(row.date_expiration ?? row.updated ?? row.time ?? new Date().toISOString()),
        movePct: existing?.movePct ?? 0,
        stockPrice: price || existing?.stockPrice || 0,
        dealPrice: existing?.dealPrice,
        optionVolume: Math.max(optionVolume, existing?.optionVolume ?? 0),
        urgencyScore: Math.round(optionUrgency),
        chaseRisk: existing?.chaseRisk ?? "medium",
        contractSignal: `Benzinga unusual options: ${putCall || "option"} ${sentiment || "flow"} with ${optionVolume ? optionVolume.toLocaleString() : "noted"} volume. Verify fills before trade.`,
        action: existing?.action ?? "Use as a high-priority watchlist alert. Enter only after price confirms and the option spread is tight.",
      });
    });
  } catch {
    // Newsfeed alone is still useful if unusual options are unavailable.
  }

  return withSource(Array.from(bySymbol.values()).sort((a, b) => b.urgencyScore - a.urgencyScore).slice(0, 25), "Benzinga");
}

async function fetchAlphaVantageCatalysts(apiKey: string, topics: string[]): Promise<CatalystEvent[]> {
  const eventsBySymbol = new Map<string, CatalystEvent>();
  const newsUrl = new URL("https://www.alphavantage.co/query");
  newsUrl.searchParams.set("function", "NEWS_SENTIMENT");
  newsUrl.searchParams.set("topics", topics.join(","));
  newsUrl.searchParams.set("sort", "LATEST");
  newsUrl.searchParams.set("limit", "50");
  newsUrl.searchParams.set("apikey", apiKey);
  const newsResponse = await fetch(newsUrl);
  if (!newsResponse.ok) throw new Error(`Catalyst news ${newsResponse.status}`);
  const newsPayload = await newsResponse.json();
  assertAlphaVantagePayload(newsPayload, "Catalyst news");

  const feed = Array.isArray(newsPayload.feed) ? newsPayload.feed : [];
  feed.forEach((article: any) => {
    const headline = String(article.title ?? "Market catalyst detected");
    const summary = String(article.summary ?? "");
    const type = inferCatalystType(`${headline} ${summary}`);
    const tickers = Array.isArray(article.ticker_sentiment) ? article.ticker_sentiment : [];
    tickers.slice(0, 4).forEach((tickerData: any) => {
      const symbol = normalizeTicker(String(tickerData.ticker ?? ""));
      if (!symbol || symbol.includes(":")) return;
      const relevance = safeNumber(tickerData.relevance_score);
      if (relevance < 0.08) return;
      const sentiment = safeNumber(tickerData.ticker_sentiment_score);
      const existing = eventsBySymbol.get(symbol);
      const event: CatalystEvent = {
        symbol,
        type,
        headline,
        detectedAt: String(article.time_published ?? new Date().toISOString()),
        movePct: existing?.movePct ?? 0,
        stockPrice: existing?.stockPrice ?? 0,
        optionVolume: existing?.optionVolume ?? 0,
        urgencyScore: urgencyFor(type, existing?.movePct ?? 0, relevance, sentiment),
        chaseRisk: chaseRiskFor(type, existing?.movePct ?? 0),
        contractSignal: type === "takeover"
          ? "Deal/news repricing can make cheap calls explode before the stock pins near deal value."
          : "News catalyst detected; verify live option volume, bid/ask, and IV before entry.",
        action: eventActionFor(type, existing?.movePct ?? 0),
      };
      if (!existing || event.urgencyScore > existing.urgencyScore) eventsBySymbol.set(symbol, event);
    });
  });

  try {
    const moversUrl = new URL("https://www.alphavantage.co/query");
    moversUrl.searchParams.set("function", "TOP_GAINERS_LOSERS");
    moversUrl.searchParams.set("apikey", apiKey);
    const moversResponse = await fetch(moversUrl);
    if (moversResponse.ok) {
      const moversPayload = await moversResponse.json();
      assertAlphaVantagePayload(moversPayload, "Top movers");
      const movers = [
        ...(Array.isArray(moversPayload.top_gainers) ? moversPayload.top_gainers : []),
        ...(Array.isArray(moversPayload.top_losers) ? moversPayload.top_losers : []),
      ];
      movers.forEach((mover: any) => {
        const symbol = normalizeTicker(String(mover.ticker ?? ""));
        const movePct = parsePct(mover.change_percentage);
        if (!symbol || Math.abs(movePct) < 6) return;
        const existing = eventsBySymbol.get(symbol);
        const type = existing?.type ?? "unusual_options";
        eventsBySymbol.set(symbol, {
          symbol,
          type,
          headline: existing?.headline ?? `Top mover scan: ${symbol} moved ${movePct >= 0 ? "+" : ""}${movePct.toFixed(1)}%`,
          detectedAt: existing?.detectedAt ?? String(moversPayload.last_updated ?? new Date().toISOString()),
          movePct,
          stockPrice: safeNumber(mover.price, existing?.stockPrice ?? 0),
          dealPrice: existing?.dealPrice,
          optionVolume: existing?.optionVolume ?? 0,
          urgencyScore: Math.max(existing?.urgencyScore ?? 0, urgencyFor(type, movePct, 0.2, 0)),
          chaseRisk: chaseRiskFor(type, movePct),
          contractSignal: existing?.contractSignal ?? "Large stock move detected; search near-term option chain for $0.10-$0.50 contracts with tight spreads.",
          action: eventActionFor(type, movePct),
        });
      });
    }
  } catch {
    // Top movers are useful but optional; keep news catalysts if available.
  }

  return withSource(Array.from(eventsBySymbol.values()).sort((a, b) => b.urgencyScore - a.urgencyScore).slice(0, 20), "Alpha Vantage");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const optionsSymbols = (url.searchParams.get("options") ?? "SPY,QQQ,NVDA,AAPL")
    .split(",")
    .map((symbol) => symbol.trim())
    .filter(Boolean);
  const futuresSymbols = (url.searchParams.get("futures") ?? "ES,NQ,CL")
    .split(",")
    .map((symbol) => symbol.trim())
    .filter(Boolean);
  const catalystTopics = (url.searchParams.get("topics") ?? "mergers_and_acquisitions,earnings,financial_markets")
    .split(",")
    .map((topic) => topic.trim())
    .filter(Boolean);
  const errors: string[] = [];
  let options: LiveQuote[] = [];
  let futures: LiveQuote[] = [];
  let catalysts: CatalystEvent[] = [];

  const alphaVantageApiKey = Deno.env.get("ALPHA_VANTAGE_API_KEY");
  const polygonApiKey = Deno.env.get("POLYGON_API_KEY");
  const benzingaApiKey = Deno.env.get("BENZINGA_API_KEY");
  const catalystRequests: Promise<CatalystEvent[]>[] = [];
  const catalystLabels: string[] = [];
  if (benzingaApiKey) {
    catalystLabels.push("Benzinga");
    catalystRequests.push(fetchBenzingaCatalysts(benzingaApiKey));
  }
  if (polygonApiKey) {
    catalystLabels.push("Polygon news");
    catalystRequests.push(fetchPolygonCatalysts(polygonApiKey));
  }
  if (alphaVantageApiKey) {
    catalystLabels.push("Alpha Vantage");
    catalystRequests.push(fetchAlphaVantageCatalysts(alphaVantageApiKey, catalystTopics));
  }
  if (catalystRequests.length) {
    const settled = await Promise.allSettled(catalystRequests);
    const catalystGroups: CatalystEvent[][] = [];
    settled.forEach((result, index) => {
      if (result.status === "fulfilled") catalystGroups.push(result.value);
      else errors.push(`${catalystLabels[index]} catalysts: ${redactProviderMessage(result.reason instanceof Error ? result.reason.message : "failed")}`);
    });
    catalysts = mergeProviderCatalysts(catalystGroups);
  }

  if (alphaVantageApiKey) {
    try {
      options = await fetchAlphaVantageOptions(alphaVantageApiKey, optionsSymbols);
    } catch (error) {
      errors.push(error instanceof Error ? redactProviderMessage(error.message) : "Alpha Vantage options failed");
    }
  } else if (polygonApiKey) {
    try {
      options = await fetchPolygonOptions(polygonApiKey, optionsSymbols);
    } catch (error) {
      errors.push(error instanceof Error ? redactProviderMessage(error.message) : "Polygon options failed");
    }
  } else {
    errors.push("ALPHA_VANTAGE_API_KEY or POLYGON_API_KEY is not configured");
  }

  const futuresProxyUrl = Deno.env.get("FUTURES_PROXY_URL");
  if (futuresProxyUrl) {
    try {
      futures = await fetchFuturesProxy(futuresProxyUrl, futuresSymbols);
    } catch (error) {
      errors.push(error instanceof Error ? redactProviderMessage(error.message) : "Futures proxy failed");
    }
  } else {
    errors.push("FUTURES_PROXY_URL is not configured");
  }

  return new Response(JSON.stringify({ options, futures, catalysts, errors, updatedAt: new Date().toISOString() }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
