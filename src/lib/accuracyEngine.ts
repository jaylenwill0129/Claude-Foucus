import type { CatalystEvent } from "@/lib/derivativesEngine";
import type { LiveQuote } from "@/lib/liveData";

export type AccuracyOutcome = "tracking" | "hit" | "miss" | "flat";

export interface AccuracyRecord {
  symbol: string;
  type: string;
  source: string;
  outcome: AccuracyOutcome;
  score: number;
  startedAt: number;
}

export interface ChainVerification {
  verified: boolean;
  score: number;
  checks: { label: string; passed: boolean; detail: string }[];
}

const SOURCE_BASE_TRUST: Record<string, number> = {
  "Polygon News": 78,
  Polygon: 82,
  Benzinga: 76,
  "Alpha Vantage": 68,
  Proxy: 62,
  Model: 35,
  Unknown: 30,
};

export function verifyLiveOptionChain(
  quote: LiveQuote | undefined,
  maxSpreadBps: number,
  now = Date.now(),
): ChainVerification {
  const live = Boolean(quote && quote.source !== "fallback" && quote.assetClass === "option");
  const bid = quote?.bid ?? 0;
  const ask = quote?.ask ?? 0;
  const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : 0;
  const spreadBps = mid > 0 ? ((ask - bid) / mid) * 10000 : undefined;
  const ageMinutes = quote?.updatedAt ? Math.max(0, (now - Date.parse(quote.updatedAt)) / 60000) : undefined;
  const volume = quote?.volume ?? 0;
  const openInterest = quote?.openInterest ?? 0;
  const checks = [
    { label: "Live provider", passed: live, detail: live ? quote!.source : "Fallback or missing option quote" },
    { label: "Two-sided NBBO", passed: bid > 0 && ask > 0 && ask >= bid, detail: bid > 0 && ask > 0 ? `$${bid.toFixed(2)} / $${ask.toFixed(2)}` : "Bid/ask missing" },
    { label: "Spread", passed: spreadBps !== undefined && spreadBps <= maxSpreadBps, detail: spreadBps === undefined ? "Unknown" : `${(spreadBps / 100).toFixed(1)}%` },
    { label: "Liquidity", passed: volume >= 25 || openInterest >= 100, detail: `Vol ${volume.toLocaleString()} / OI ${openInterest.toLocaleString()}` },
    { label: "Freshness", passed: ageMinutes !== undefined && ageMinutes <= 3, detail: ageMinutes === undefined ? "Unknown" : `${ageMinutes.toFixed(1)}m old` },
    { label: "Contract identity", passed: Boolean(quote?.expiration && quote?.strike && quote?.contractType), detail: quote?.expiration ? `${quote.contractType ?? "?"} $${quote.strike ?? "?"} ${quote.expiration}` : "Missing expiration/strike/type" },
  ];
  const passed = checks.filter((check) => check.passed).length;
  return { verified: passed === checks.length, score: Math.round((passed / checks.length) * 100), checks };
}

export function sourceTrustScore(event?: CatalystEvent, records: AccuracyRecord[] = []) {
  if (!event) return 0;
  const sources = event.sources?.length ? event.sources : ["Unknown"];
  const historical = records.filter((record) =>
    record.outcome !== "tracking" &&
    sources.some((source) => record.source.toLowerCase().includes(source.toLowerCase()))
  );
  const hitRate = historical.length
    ? historical.filter((record) => record.outcome === "hit").length / historical.length
    : undefined;
  const base = sources.reduce((sum, source) => {
    const match = Object.entries(SOURCE_BASE_TRUST).find(([name]) => source.toLowerCase().includes(name.toLowerCase()));
    return sum + (match?.[1] ?? 50);
  }, 0) / sources.length;
  const corroborationBoost = Math.min(16, Math.max(0, sources.length - 1) * 8);
  const historicalAdjustment = hitRate === undefined ? 0 : (hitRate - 0.5) * 30;
  return Math.max(0, Math.min(100, Math.round(base + corroborationBoost + historicalAdjustment)));
}

export function falsePositivePenalty(symbol: string, records: AccuracyRecord[]) {
  const completed = records.filter((record) => record.symbol === symbol && record.outcome !== "tracking").slice(0, 12);
  if (completed.length < 3) return 0;
  const hits = completed.filter((record) => record.outcome === "hit").length;
  const misses = completed.filter((record) => record.outcome === "miss").length;
  const flats = completed.filter((record) => record.outcome === "flat").length;
  return Math.min(24, Math.max(0, misses * 6 + flats * 2 - hits * 4));
}

export function calibrationSummary(records: AccuracyRecord[]) {
  const completed = records.filter((record) => record.outcome !== "tracking");
  const buckets = [
    { label: "High 75+", min: 75, max: 101 },
    { label: "Medium 55-74", min: 55, max: 75 },
    { label: "Low <55", min: 0, max: 55 },
  ].map((bucket) => {
    const rows = completed.filter((record) => record.score >= bucket.min && record.score < bucket.max);
    const hits = rows.filter((record) => record.outcome === "hit").length;
    return {
      ...bucket,
      count: rows.length,
      hitRate: rows.length ? Math.round((hits / rows.length) * 100) : 0,
    };
  });
  const high = buckets[0];
  const low = buckets[2];
  const calibrationGap = high.count && low.count ? high.hitRate - low.hitRate : undefined;
  return {
    buckets,
    calibrationGap,
    trustworthy: completed.length >= 20 && high.count >= 5 && (calibrationGap ?? 0) >= 15,
  };
}
