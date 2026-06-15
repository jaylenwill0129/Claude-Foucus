import { rankedPlans, scoreSetup, type AssetClass, type CatalystEvent, type CatalystType, type MarketSetup, type OpportunityPlan } from "@/lib/derivativesEngine";

export type LiveConnectionState = "not_configured" | "connecting" | "live" | "degraded" | "error";

export interface LiveQuote {
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

export interface LiveDataSnapshot {
  state: LiveConnectionState;
  options: LiveQuote[];
  futures: LiveQuote[];
  catalysts: CatalystEvent[];
  mergedPlans: OpportunityPlan[];
  lastUpdated?: string;
  errors: string[];
  configured: {
    polygon: boolean;
    futuresProxy: boolean;
    catalystNews: boolean;
  };
}

const parseList = (value: string | undefined, fallback: string[]) =>
  (value ?? fallback.join(","))
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

async function fetchWithTimeout(url: string, timeoutMs = liveDataConfig.providerTimeoutMs) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>) {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(Math.floor(concurrency) || 1, items.length));

  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      try {
        results[index] = { status: "fulfilled", value: await mapper(items[index]) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  };

  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

function redactProviderMessage(message: string) {
  return message
    .replace(/[A-Z0-9]{12,}/g, "[redacted]")
    .replace(/apikey=[^&\s]+/gi, "apikey=[redacted]");
}

export const liveDataConfig = {
  liveDataProxyUrl: import.meta.env.VITE_LIVE_DATA_PROXY_URL,
  catalystProxyUrl: import.meta.env.VITE_CATALYST_PROXY_URL,
  reutersNewsProxyUrl: import.meta.env.VITE_REUTERS_NEWS_PROXY_URL,
  dowJonesNewsProxyUrl: import.meta.env.VITE_DOW_JONES_NEWS_PROXY_URL,
  benzingaApiKey: import.meta.env.VITE_BENZINGA_API_KEY,
  alphaVantageApiKey: import.meta.env.VITE_ALPHA_VANTAGE_API_KEY,
  polygonApiKey: import.meta.env.VITE_POLYGON_API_KEY,
  optionsUnderlyings: parseList(import.meta.env.VITE_OPTIONS_UNDERLYINGS, ["SPY", "QQQ", "NVDA", "AAPL"]),
  discoverySymbols: parseList(import.meta.env.VITE_DISCOVERY_SYMBOLS, ["MMED", "MNMD", "CMPS", "ATAI"]),
  catalystTopics: parseList(import.meta.env.VITE_CATALYST_TOPICS, ["mergers_and_acquisitions", "earnings", "financial_markets"]),
  catalystScanMs: Number(import.meta.env.VITE_CATALYST_SCAN_MS || 300000),
  maxOptionUniverse: Number(import.meta.env.VITE_MAX_OPTION_UNIVERSE || 100),
  optionContractsPerSymbol: Number(import.meta.env.VITE_OPTION_CONTRACTS_PER_SYMBOL || 12),
  optionScanConcurrency: Number(import.meta.env.VITE_OPTION_SCAN_CONCURRENCY || 6),
  alphaVantageFallbackSymbols: Number(import.meta.env.VITE_ALPHA_VANTAGE_FALLBACK_SYMBOLS || 4),
  directOptionBatchSize: Number(import.meta.env.VITE_DIRECT_OPTION_BATCH_SIZE || 36),
  providerTimeoutMs: Number(import.meta.env.VITE_PROVIDER_TIMEOUT_MS || 6000),
  futuresProxyUrl: import.meta.env.VITE_FUTURES_PROXY_URL,
  futuresSymbols: parseList(import.meta.env.VITE_FUTURES_SYMBOLS, []),
  pollMs: Number(import.meta.env.VITE_LIVE_POLL_MS || 30000),
};

const extremeMoverSeeds = ["XOS", "WKHS", "LEV", "REE", "GOEV", "MULN", "RIVN", "NKLA"];
const hotThemeSeeds = ["CIFR", "IREN", "WULF", "LUNR", "RKLB", "RDW", "QBTS", "RGTI", "PLUG", "KULR", "IONQ", "CHPT", "MMED", "MNMD", "WCT", "TJGC", "SDOT", "STAK", "STI", "SBEV", "SVCO", "ASTC", "CRWD", "FIVE", "AVGO"];
const liquidOptionSeeds = [
  "SPY", "QQQ", "IWM", "DIA", "XLK", "XLF", "XLE", "SMH", "SOXX", "ARKK", "TLT", "GLD", "SLV", "USO",
  "NVDA", "AAPL", "MSFT", "AMZN", "META", "GOOGL", "TSLA", "AMD", "AVGO", "MU", "INTC", "ARM", "ORCL", "CRM",
  "NFLX", "UBER", "COIN", "MARA", "RIOT", "HOOD", "PLTR", "SOFI", "RIVN", "LCID", "F", "GM", "BA", "JPM",
  "BAC", "C", "GS", "XOM", "CVX", "OXY", "LLY", "NVO", "PFE", "MRNA", "PANW", "SHOP", "SNAP", "ROKU",
  "DKNG", "MGM", "GME", "AMC",
];

export function buildStaticDiscoveryUniverse() {
  return Array.from(new Set([...liveDataConfig.optionsUnderlyings, ...liveDataConfig.discoverySymbols, ...liquidOptionSeeds, ...extremeMoverSeeds, ...hotThemeSeeds]))
    .filter((symbol) => /^[A-Z][A-Z0-9.-]{0,5}$/.test(symbol))
    .slice(0, liveDataConfig.maxOptionUniverse);
}

export function buildOptionDiscoveryUniverse(catalysts: CatalystEvent[]) {
  const base = liveDataConfig.optionsUnderlyings;
  const discovery = liveDataConfig.discoverySymbols;
  const catalystSymbols = catalysts
    .filter((event) => event.urgencyScore >= 45 || Math.abs(event.movePct) >= 5)
    .sort((a, b) => b.urgencyScore - a.urgencyScore)
    .map((event) => event.symbol);

  return Array.from(new Set([...catalystSymbols, ...base, ...discovery, ...liquidOptionSeeds, ...extremeMoverSeeds, ...hotThemeSeeds]))
    .filter((symbol) => /^[A-Z][A-Z0-9.-]{0,5}$/.test(symbol))
    .slice(0, liveDataConfig.maxOptionUniverse);
}

let catalystCache: { at: number; events: CatalystEvent[] } | null = null;
let optionUniverseCursor = 0;

export function buildDirectOptionBatch(optionUniverse: string[]) {
  const batchSize = Math.max(1, Math.min(liveDataConfig.directOptionBatchSize, optionUniverse.length));
  if (optionUniverse.length <= batchSize) return optionUniverse;

  const priorityCount = Math.min(12, Math.floor(batchSize / 2), optionUniverse.length);
  const priority = optionUniverse.slice(0, priorityCount);
  const rotating = optionUniverse.slice(priorityCount);
  const rotatingCount = batchSize - priority.length;
  const selected = Array.from({ length: rotatingCount }, (_, index) => rotating[(optionUniverseCursor + index) % rotating.length]);
  optionUniverseCursor = (optionUniverseCursor + rotatingCount) % rotating.length;
  return Array.from(new Set([...priority, ...selected]));
}

function safeNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function calculateSpreadBps(bid?: number, ask?: number) {
  if (!bid || !ask || bid <= 0 || ask <= 0) return undefined;
  const mid = (bid + ask) / 2;
  return mid > 0 ? ((ask - bid) / mid) * 10000 : undefined;
}

function assertAlphaVantagePayload(payload: any, label: string) {
  const message = payload?.Information ?? payload?.Note ?? payload?.["Error Message"];
  if (message) throw new Error(`${label}: ${redactProviderMessage(message)}`);
}

async function fetchAlphaVantageOptions(apiKey: string, underlyings: string[]): Promise<LiveQuote[]> {
  const quotes: LiveQuote[] = [];
  const errors: string[] = [];

  for (const [index, underlying] of underlyings.entries()) {
    if (index > 0) await sleep(1200);
    try {
      const url = new URL("https://www.alphavantage.co/query");
      url.searchParams.set("function", "REALTIME_OPTIONS");
      url.searchParams.set("symbol", underlying);
      url.searchParams.set("require_greeks", "true");
      url.searchParams.set("apikey", apiKey);
      const response = await fetchWithTimeout(url.toString());
      if (!response.ok) throw new Error(`${underlying} options ${response.status}`);
      const payload = await response.json();
      assertAlphaVantagePayload(payload, `${underlying} options`);
      const contracts = Array.isArray(payload.data) ? payload.data : Array.isArray(payload.options) ? payload.options : [];

      const normalized = contracts
        .filter((contract: any) => {
          const contractId = String(contract.contractID ?? contract.contract_id ?? "");
          return !contractId || contractId.toUpperCase().startsWith(underlying.toUpperCase());
        })
        .slice(0, liveDataConfig.optionContractsPerSymbol)
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
    } catch (error) {
      errors.push(error instanceof Error ? redactProviderMessage(error.message) : "Alpha Vantage options failed");
    }
  }

  if (quotes.length === 0 && errors.length) throw new Error(errors.join("; "));
  return quotes;
}

async function fetchPolygonOptions(apiKey: string, underlyings: string[]): Promise<LiveQuote[]> {
  const results = await mapWithConcurrency(
    underlyings,
    liveDataConfig.optionScanConcurrency,
    async (underlying) => {
      const url = new URL(`https://api.polygon.io/v3/snapshot/options/${underlying}`);
      url.searchParams.set("limit", "20");
      url.searchParams.set("apiKey", apiKey);
      const response = await fetchWithTimeout(url.toString());
      if (!response.ok) {
        if (response.status === 403) throw new Error("Polygon options access denied (403). Enable options snapshot entitlement.");
        if (response.status === 429) throw new Error("Polygon options rate limit reached (429).");
        throw new Error(`${underlying} options ${response.status}`);
      }
      const payload = await response.json();
      const contracts = Array.isArray(payload.results) ? payload.results : [];
      return contracts.slice(0, liveDataConfig.optionContractsPerSymbol).map((contract: any): LiveQuote => {
        const details = contract.details ?? {};
        const quote = contract.last_quote ?? {};
        const greeks = contract.greeks ?? {};
        const day = contract.day ?? {};
        const bid = safeNumber(quote.bid, undefined as unknown as number);
        const ask = safeNumber(quote.ask, undefined as unknown as number);
        const price = safeNumber(contract.fmv, safeNumber(day.close, (bid && ask ? (bid + ask) / 2 : 0)));
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
    }
  );

  const quotes: LiveQuote[] = [];
  const errors: string[] = [];
  results.forEach((result) => {
    if (result.status === "fulfilled") quotes.push(...result.value);
    else errors.push(result.reason instanceof Error ? result.reason.message : "Options request failed");
  });
  if (quotes.length === 0 && errors.length) throw new Error(errors.join("; "));
  return quotes;
}

function summarizeProviderErrors(errors: string[]) {
  const counts = new Map<string, number>();
  errors.forEach((error) => {
    const cleaned = redactProviderMessage(error);
    const normalized = cleaned
      .replace(/\b[A-Z][A-Z0-9.-]{0,5} options\b/g, "Options request")
      .replace(/\s+/g, " ")
      .trim();
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  });
  return Array.from(counts.entries())
    .sort(([a], [b]) => Number(/options|option chain/i.test(b)) - Number(/options|option chain/i.test(a)))
    .map(([message, count]) => count > 1 ? `${message} (${count} requests)` : message)
    .slice(0, 8);
}

async function fetchFuturesProxy(proxyUrl: string, symbols: string[]): Promise<LiveQuote[]> {
  const url = new URL(proxyUrl);
  url.searchParams.set("symbols", symbols.join(","));
  const response = await fetch(url.toString());
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

async function fetchLiveDataProxy(proxyUrl: string, optionSymbols: string[]): Promise<{ options: LiveQuote[]; futures: LiveQuote[]; catalysts: CatalystEvent[]; errors: string[] }> {
  const url = new URL(proxyUrl);
  url.searchParams.set("options", optionSymbols.join(","));
  url.searchParams.set("futures", liveDataConfig.futuresSymbols.join(","));
  url.searchParams.set("topics", liveDataConfig.catalystTopics.join(","));
  const response = await fetch(url.toString());
  if (!response.ok) throw new Error(`Live data proxy ${response.status}`);
  const payload = await response.json();
  return {
    options: Array.isArray(payload.options) ? payload.options : [],
    futures: Array.isArray(payload.futures) ? payload.futures : [],
    catalysts: Array.isArray(payload.catalysts) ? normalizeCatalystEvents(payload.catalysts) : [],
    errors: Array.isArray(payload.errors) ? payload.errors : [],
  };
}

async function fetchCatalystProxy(proxyUrl: string): Promise<CatalystEvent[]> {
  const url = new URL(proxyUrl);
  url.searchParams.set("symbols", buildStaticDiscoveryUniverse().join(","));
  url.searchParams.set("topics", liveDataConfig.catalystTopics.join(","));
  const response = await fetch(url.toString());
  if (!response.ok) throw new Error(`Catalyst proxy ${response.status}`);
  const payload = await response.json();
  const raw = Array.isArray(payload) ? payload : Array.isArray(payload.catalysts) ? payload.catalysts : [];
  return normalizeCatalystEvents(raw);
}

async function fetchLicensedNewsProxy(proxyUrl: string, source: string): Promise<CatalystEvent[]> {
  return withSource(await fetchCatalystProxy(proxyUrl), source);
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

export function assessCatalystCredibility(event: CatalystEvent, now = Date.now()) {
  const text = event.headline.toLowerCase();
  const sources = event.corroborationScore ?? event.sources?.length ?? 0;
  const parsedAt = Date.parse(event.detectedAt);
  const freshnessMinutes = Number.isFinite(parsedAt) ? Math.max(0, Math.round((now - parsedAt) / 60000)) : undefined;
  const qualityFlags: string[] = [];
  let score = 30;

  if (event.type === "takeover") score += 25;
  if (event.type === "regulatory") score += 20;
  if (event.type === "earnings" || event.type === "guidance") score += 16;
  if (event.type === "product") score += 12;
  if (event.type === "unusual_options") score += 10;
  if (/(approval|fda|contract|award|acquisition|merger|buyout|guidance|raises|beats|partnership|launch|upgrade|downgrade|price target)/.test(text)) score += 15;
  if (/(how much.*invested|shopping list|worth today|opinion|recap|reminder|watch these|why .* stock)/.test(text)) {
    score -= 24;
    qualityFlags.push("low-actionability headline");
  }
  if ((event.optionVolume ?? 0) >= 5000) score += 18;
  else if ((event.optionVolume ?? 0) >= 500) score += 10;
  else if ((event.optionVolume ?? 0) > 0) score += 4;
  if (Math.abs(event.movePct) >= 10) score += 18;
  else if (Math.abs(event.movePct) >= 5) score += 10;
  if (sources >= 2) score += 12;
  if (freshnessMinutes !== undefined && freshnessMinutes <= 60) score += 12;
  else if (freshnessMinutes !== undefined && freshnessMinutes <= 360) score += 6;
  else if (freshnessMinutes !== undefined && freshnessMinutes > 1440) {
    score -= 20;
    qualityFlags.push("stale catalyst");
  }
  if (Math.abs(event.movePct) < 1 && !(event.optionVolume && event.optionVolume > 0)) {
    score -= 12;
    qualityFlags.push("no market confirmation");
  }
  if (!Number.isFinite(parsedAt)) qualityFlags.push("unknown timestamp");
  if (Number.isFinite(parsedAt) && parsedAt > now + 5 * 60 * 1000) {
    score -= 20;
    qualityFlags.push("future timestamp rejected");
  }

  return {
    credibilityScore: Math.min(100, Math.max(0, Math.round(score))),
    freshnessMinutes,
    qualityFlags,
  };
}

function qualityAdjustCatalyst(event: CatalystEvent) {
  const assessment = assessCatalystCredibility(event);
  let urgencyScore = Math.round(event.urgencyScore * 0.6 + assessment.credibilityScore * 0.4);
  if (assessment.credibilityScore < 45) urgencyScore = Math.min(68, urgencyScore);
  if ((event.sources?.length ?? 0) < 2 && Math.abs(event.movePct) < 1 && !(event.optionVolume && event.optionVolume > 0)) {
    urgencyScore = Math.min(72, urgencyScore);
  }
  return { ...event, ...assessment, urgencyScore };
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
      bySymbol.set(symbol, {
        ...event,
        symbol,
        sources,
        corroborationScore: sources.length,
      });
      return;
    }

    const mergedSources = Array.from(new Set([...(existing.sources ?? []), ...sources]));
    const stronger = event.urgencyScore > existing.urgencyScore ? event : existing;
    const movePct = Math.abs(event.movePct) > Math.abs(existing.movePct) ? event.movePct : existing.movePct;
    const urgencyScore = Math.min(100, Math.max(existing.urgencyScore, event.urgencyScore) + Math.min(18, (mergedSources.length - 1) * 6));

    bySymbol.set(symbol, {
      ...stronger,
      symbol,
      movePct,
      stockPrice: event.stockPrice || existing.stockPrice,
      dealPrice: event.dealPrice ?? existing.dealPrice,
      optionVolume: Math.max(event.optionVolume ?? 0, existing.optionVolume ?? 0) || undefined,
      urgencyScore,
      chaseRisk: stronger.chaseRisk,
      sources: mergedSources,
      corroborationScore: mergedSources.length,
      action: mergedSources.length > 1
        ? `Confirmed by ${mergedSources.length} sources. ${stronger.action}`
        : stronger.action,
    });
  });

  return Array.from(bySymbol.values())
    .map(qualityAdjustCatalyst)
    .filter((event) => (event.freshnessMinutes ?? 0) <= 3 * 24 * 60 && (event.credibilityScore ?? 0) >= 25)
    .sort((a, b) => b.urgencyScore - a.urgencyScore)
    .slice(0, 30);
}

function normalizeCatalystEvents(rawEvents: any[]): CatalystEvent[] {
  return rawEvents
    .map((event: any): CatalystEvent | null => {
      const symbol = normalizeTicker(String(event.symbol ?? event.ticker ?? ""));
      if (!symbol) return null;
      const type = (event.type ?? inferCatalystType(`${event.headline ?? ""} ${event.summary ?? ""}`)) as CatalystType;
      const movePct = safeNumber(event.movePct ?? event.changePct ?? event.change_percentage);
      return {
        symbol,
        type,
        headline: String(event.headline ?? event.title ?? "Catalyst detected"),
        detectedAt: String(event.detectedAt ?? event.published_utc ?? event.created_at ?? new Date().toISOString()),
        movePct,
        stockPrice: safeNumber(event.stockPrice ?? event.price),
        dealPrice: event.dealPrice === undefined ? undefined : safeNumber(event.dealPrice),
        optionVolume: event.optionVolume === undefined ? undefined : safeNumber(event.optionVolume),
        urgencyScore: event.urgencyScore === undefined ? urgencyFor(type, movePct, 0.25, 0) : safeNumber(event.urgencyScore),
        chaseRisk: event.chaseRisk ?? chaseRiskFor(type, movePct),
        sources: Array.isArray(event.sources) ? event.sources.map(String) : event.source ? [String(event.source)] : ["Proxy"],
        corroborationScore: event.corroborationScore === undefined ? undefined : safeNumber(event.corroborationScore),
        contractSignal: String(event.contractSignal ?? "Catalyst detected; verify option volume, spread, and IV before entry."),
        action: String(event.action ?? eventActionFor(type, movePct)),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.urgencyScore - a.urgencyScore) as CatalystEvent[];
}

async function fetchPolygonCatalysts(apiKey: string): Promise<CatalystEvent[]> {
  const url = new URL("https://api.polygon.io/v2/reference/news");
  url.searchParams.set("limit", "50");
  url.searchParams.set("order", "descending");
  url.searchParams.set("sort", "published_utc");
  url.searchParams.set("apiKey", apiKey);
  const response = await fetch(url.toString());
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
  const response = await fetch(url.toString());
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
        const event: CatalystEvent = {
          symbol,
          type,
          headline,
        detectedAt: String(article.created_at ?? article.created ?? article.updated_at ?? article.updated ?? article.published_at ?? new Date().toISOString()),
          movePct: existing?.movePct ?? 0,
          stockPrice: existing?.stockPrice ?? 0,
          optionVolume: existing?.optionVolume ?? 0,
          urgencyScore: Math.max(existing?.urgencyScore ?? 0, urgencyFor(type, existing?.movePct ?? 0, 0.44, 0)),
          chaseRisk: chaseRiskFor(type, existing?.movePct ?? 0),
          contractSignal: type === "takeover"
            ? "Benzinga news hit: search the option chain immediately, then avoid calls after price pins near deal value."
            : "Benzinga catalyst hit: confirm price reaction, unusual options, bid/ask, and IV before entry.",
          action: eventActionFor(type, existing?.movePct ?? 0),
        };
        bySymbol.set(symbol, event);
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
        detectedAt: String(row.updated ?? row.time ?? row.date ?? row.created_at ?? new Date().toISOString()),
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

async function fetchAlphaVantageCatalysts(apiKey: string): Promise<CatalystEvent[]> {
  const now = Date.now();
  if (catalystCache && now - catalystCache.at < liveDataConfig.catalystScanMs) return catalystCache.events;

  const eventsBySymbol = new Map<string, CatalystEvent>();

  try {
    const url = new URL("https://www.alphavantage.co/query");
    url.searchParams.set("function", "NEWS_SENTIMENT");
    url.searchParams.set("topics", liveDataConfig.catalystTopics.join(","));
    url.searchParams.set("sort", "LATEST");
    url.searchParams.set("limit", "50");
    url.searchParams.set("apikey", apiKey);
    const response = await fetch(url.toString());
    if (!response.ok) throw new Error(`Catalyst news ${response.status}`);
    const payload = await response.json();
    assertAlphaVantagePayload(payload, "Catalyst news");

    const feed = Array.isArray(payload.feed) ? payload.feed : [];
    feed.forEach((article: any) => {
      const headline = String(article.title ?? "Market catalyst detected");
      const summary = String(article.summary ?? "");
      const text = `${headline} ${summary}`;
      const type = inferCatalystType(text);
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
  } catch (error) {
    throw error instanceof Error ? error : new Error("Catalyst news failed");
  }

  try {
    const url = new URL("https://www.alphavantage.co/query");
    url.searchParams.set("function", "TOP_GAINERS_LOSERS");
    url.searchParams.set("apikey", apiKey);
    const response = await fetch(url.toString());
    if (!response.ok) throw new Error(`Top movers ${response.status}`);
    const payload = await response.json();
    assertAlphaVantagePayload(payload, "Top movers");
    const movers = [
      ...(Array.isArray(payload.top_gainers) ? payload.top_gainers : []),
      ...(Array.isArray(payload.top_losers) ? payload.top_losers : []),
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
        detectedAt: existing?.detectedAt ?? String(payload.last_updated ?? new Date().toISOString()),
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
  } catch {
    // News is the primary catalyst feed; top movers are useful but optional.
  }

  const events = withSource(Array.from(eventsBySymbol.values()).sort((a, b) => b.urgencyScore - a.urgencyScore).slice(0, 20), "Alpha Vantage");
  catalystCache = { at: now, events };
  return events;
}

export function mergeQuotesIntoPlans(options: LiveQuote[], futures: LiveQuote[]): OpportunityPlan[] {
  const quoteByRoot = new Map<string, LiveQuote>();
  [...options, ...futures].forEach((quote) => {
    const root = quote.symbol.split(/[ .]/)[0].replace(/^O:/, "");
    if (!quoteByRoot.has(root)) quoteByRoot.set(root, quote);
  });

  return rankedPlans.flatMap((plan) => {
    const planRoot = plan.symbol.split(" ")[0];
    const quote = quoteByRoot.get(planRoot);
    if (!quote || quote.price <= 0) return [];
    const spreadBps = calculateSpreadBps(quote.bid, quote.ask);
    return [{
      ...plan,
      price: quote.price,
      week52High: Math.max(plan.week52High, quote.price),
      changePct: quote.changePct,
      spreadBps: spreadBps === undefined ? plan.spreadBps : Math.round(spreadBps),
      volumeScore: quote.volume ? Math.min(100, Math.max(40, Math.round(Math.log10(quote.volume + 1) * 14))) : plan.volumeScore,
      ivRank: quote.impliedVolatility ? Math.round(Math.min(100, quote.impliedVolatility * 100)) : plan.ivRank,
      delta: quote.delta ?? plan.delta,
    }];
  });
}

function dynamicPlanFromCatalyst(event: CatalystEvent, quotes: LiveQuote[]): OpportunityPlan | null {
  const root = normalizeTicker(event.symbol);
  if (!root || rankedPlans.some((plan) => plan.symbol === root || plan.symbol.split(" ")[0] === root)) return null;
  const relatedQuotes = quotes.filter((quote) => quote.underlyingSymbol === root || quote.symbol.includes(root));
  const bestQuote = relatedQuotes
    .filter((quote) => quote.price > 0)
    .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))[0];
  if (!bestQuote) return null;
  const stockPrice = event.stockPrice > 0 ? event.stockPrice : bestQuote.strike && bestQuote.strike > 0 ? bestQuote.strike : bestQuote.price;
  if (!stockPrice || stockPrice <= 0) return null;
  const movePct = event.movePct || bestQuote?.changePct || 0;
  const spreadBps = calculateSpreadBps(bestQuote?.bid, bestQuote?.ask);
  const extremeMove = Math.abs(movePct) >= 50;
  const catalystBoost = Math.min(100, Math.max(65, event.urgencyScore));
  const volumeScore = bestQuote?.volume ? Math.min(100, Math.max(55, Math.round(Math.log10(bestQuote.volume + 1) * 16))) : event.optionVolume ? 78 : 62;
  const setup: MarketSetup = {
    symbol: root,
    name: `${root} ${extremeMove ? "extreme mover" : "catalyst discovery"} options`,
    assetClass: "option",
    bias: movePct >= 0 ? "bullish" : "neutral",
    price: stockPrice,
    week52High: Math.max(stockPrice * (extremeMove ? 1.45 : 1.22), stockPrice + 1),
    support: Number((stockPrice * (extremeMove ? 0.82 : 0.92)).toFixed(2)),
    resistance: Number((stockPrice * (extremeMove ? 1.18 : 1.08)).toFixed(2)),
    higherTimeframeTrend: movePct >= 8 ? "uptrend" : "range",
    retestStatus: Math.abs(movePct) >= 12 ? "retesting" : "waiting",
    qualityCompanyScore: event.type === "regulatory" ? 58 : event.type === "takeover" ? 72 : 62,
    changePct: movePct,
    atrPct: Math.min(18, Math.max(2.2, Math.abs(movePct) / 2)),
    ivRank: bestQuote?.impliedVolatility ? Math.round(Math.min(100, bestQuote.impliedVolatility * 100)) : event.type === "regulatory" ? 78 : 62,
    volumeScore,
    spreadBps: spreadBps === undefined ? 18 : Math.round(spreadBps),
    catalystScore: catalystBoost,
    trendScore: movePct >= 8 ? 78 : 62,
    flowScore: bestQuote?.volume || event.optionVolume ? 76 : 58,
    eventRisk: extremeMove ? 94 : event.type === "regulatory" ? 86 : event.chaseRisk === "high" ? 82 : 66,
    marginImpact: 12,
    thetaDrag: event.type === "regulatory" || event.type === "earnings" ? 72 : 55,
    delta: bestQuote?.delta ?? 0.32,
    dte: 30,
    preferredStructure: extremeMove
      ? "Extreme mover watch only; do not chase first halt/gap candle. Use tiny defined-risk option only after reclaim/retest."
      : "Catalyst discovery watch; use only tight-spread contracts after opening-range reclaim.",
    trigger: extremeMove
      ? "Only after live news is confirmed, volume stays elevated, and price reclaims VWAP after the first major pullback."
      : "Enter only after live news is confirmed, option spread is tight, and price holds VWAP/opening range.",
    invalidation: extremeMove
      ? "Exit if it loses VWAP/reclaim level, halts against you, or option spread widens."
      : "Exit if news fades, VWAP fails, or option loses 30% of premium.",
    target: extremeMove
      ? "Treat as scalp only; partial quickly on option pop and never average down."
      : "Fast partial on 25-50% option pop; trail only while stock holds trend.",
    session: "open-drive",
  };

  return scoreSetup(setup);
}

function mergeQuotesAndCatalystsIntoPlans(options: LiveQuote[], futures: LiveQuote[], catalysts: CatalystEvent[]): OpportunityPlan[] {
  const merged = mergeQuotesIntoPlans(options, futures);
  const dynamic = catalysts
    .filter((event) => event.urgencyScore >= 52 || Math.abs(event.movePct) >= 8)
    .map((event) => dynamicPlanFromCatalyst(event, options))
    .filter(Boolean) as OpportunityPlan[];

  return [...merged, ...dynamic].sort((a, b) => b.efficiencyScore - a.efficiencyScore);
}

export async function loadLiveDataSnapshot(): Promise<LiveDataSnapshot> {
  const errors: string[] = [];
  let options: LiveQuote[] = [];
  let futures: LiveQuote[] = [];
  let catalysts: CatalystEvent[] = [];

  const catalystRequests: Promise<CatalystEvent[]>[] = [];
  const catalystLabels: string[] = [];
  if (liveDataConfig.catalystProxyUrl) {
    catalystLabels.push("Catalyst proxy");
    catalystRequests.push(fetchCatalystProxy(liveDataConfig.catalystProxyUrl));
  }
  if (liveDataConfig.reutersNewsProxyUrl) {
    catalystLabels.push("Reuters/LSEG");
    catalystRequests.push(fetchLicensedNewsProxy(liveDataConfig.reutersNewsProxyUrl, "Reuters"));
  }
  if (liveDataConfig.dowJonesNewsProxyUrl) {
    catalystLabels.push("Dow Jones");
    catalystRequests.push(fetchLicensedNewsProxy(liveDataConfig.dowJonesNewsProxyUrl, "Dow Jones / WSJ / Barron's"));
  }
  if (liveDataConfig.benzingaApiKey) {
    catalystLabels.push("Benzinga");
    catalystRequests.push(fetchBenzingaCatalysts(liveDataConfig.benzingaApiKey));
  }
  if (liveDataConfig.polygonApiKey) {
    catalystLabels.push("Polygon news");
    catalystRequests.push(fetchPolygonCatalysts(liveDataConfig.polygonApiKey));
  }
  if (liveDataConfig.alphaVantageApiKey) {
    catalystLabels.push("Alpha Vantage");
    catalystRequests.push(fetchAlphaVantageCatalysts(liveDataConfig.alphaVantageApiKey));
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

  const optionUniverse = buildOptionDiscoveryUniverse(catalysts);
  const directOptionBatch = buildDirectOptionBatch(optionUniverse);

  if (liveDataConfig.liveDataProxyUrl) {
    try {
      const proxied = await fetchLiveDataProxy(liveDataConfig.liveDataProxyUrl, optionUniverse);
      options = proxied.options;
      futures = proxied.futures;
      catalysts = mergeProviderCatalysts([catalysts, proxied.catalysts]);
      errors.push(...proxied.errors.map(redactProviderMessage));
    } catch (error) {
      errors.push(error instanceof Error ? redactProviderMessage(error.message) : "Live data proxy failed");
    }
  }

  if (!options.length && liveDataConfig.polygonApiKey) {
    try {
      options = await fetchPolygonOptions(liveDataConfig.polygonApiKey, directOptionBatch);
    } catch (error) {
      errors.push(error instanceof Error ? redactProviderMessage(error.message) : "Polygon options failed");
    }
  }

  if (!options.length && liveDataConfig.alphaVantageApiKey) {
    try {
      options = await fetchAlphaVantageOptions(
        liveDataConfig.alphaVantageApiKey,
        directOptionBatch.slice(0, liveDataConfig.alphaVantageFallbackSymbols)
      );
    } catch (error) {
      errors.push(error instanceof Error ? redactProviderMessage(error.message) : "Alpha Vantage options failed");
    }
  }

  if (!futures.length && liveDataConfig.futuresProxyUrl && liveDataConfig.futuresSymbols.length) {
    try {
      futures = await fetchFuturesProxy(liveDataConfig.futuresProxyUrl, liveDataConfig.futuresSymbols);
    } catch (error) {
      errors.push(error instanceof Error ? redactProviderMessage(error.message) : "Futures proxy failed");
    }
  }

  const configured = {
    polygon: Boolean(liveDataConfig.liveDataProxyUrl || liveDataConfig.alphaVantageApiKey || liveDataConfig.polygonApiKey),
    futuresProxy: Boolean(liveDataConfig.liveDataProxyUrl || liveDataConfig.futuresProxyUrl),
    catalystNews: Boolean(liveDataConfig.catalystProxyUrl || liveDataConfig.reutersNewsProxyUrl || liveDataConfig.dowJonesNewsProxyUrl || liveDataConfig.benzingaApiKey || liveDataConfig.polygonApiKey || liveDataConfig.alphaVantageApiKey || liveDataConfig.liveDataProxyUrl),
  };
  const hasAnyLive = options.length > 0 || futures.length > 0;
  const state: LiveConnectionState = hasAnyLive
    ? errors.length ? "degraded" : "live"
    : configured.polygon || configured.futuresProxy ? "error" : "not_configured";

  return {
    state,
    options,
    futures,
    catalysts,
    mergedPlans: mergeQuotesAndCatalystsIntoPlans(options, futures, catalysts),
    lastUpdated: new Date().toISOString(),
    errors: summarizeProviderErrors(errors),
    configured,
  };
}
