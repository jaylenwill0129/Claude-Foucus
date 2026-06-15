// Market regime detection — pure function operating on klines.
// Tags the current market state used by adaptive risk and sizing.

export type Regime =
  | "trending_up"
  | "trending_down"
  | "choppy"
  | "high_volatility"
  | "low_volatility"
  | "neutral";

export interface RegimeResult {
  regime: Regime;
  trendStrength: number; // -100..100 (negative = down)
  volatilityPct: number; // avg true range as % of price
  reasons: string[];
}

interface Kline {
  high: number;
  low: number;
  close: number;
  open?: number;
}

/** Detect the dominant regime from the most recent klines (default lookback 30). */
export function detectRegime(klines: Kline[], lookback = 30): RegimeResult {
  const reasons: string[] = [];
  if (!klines || klines.length < 5) {
    return { regime: "neutral", trendStrength: 0, volatilityPct: 0, reasons: ["insufficient data"] };
  }
  const slice = klines.slice(-lookback);
  const closes = slice.map((k) => k.close);
  const first = closes[0];
  const last = closes[closes.length - 1];
  const totalMovePct = first > 0 ? ((last - first) / first) * 100 : 0;

  // True range over window → volatility %
  let trSum = 0;
  for (let i = 1; i < slice.length; i++) {
    const k = slice[i], prev = slice[i - 1];
    const tr = Math.max(
      k.high - k.low,
      Math.abs(k.high - prev.close),
      Math.abs(k.low - prev.close),
    );
    trSum += tr;
  }
  const avgTR = trSum / Math.max(1, slice.length - 1);
  const volatilityPct = last > 0 ? (avgTR / last) * 100 : 0;

  // Directional consistency: fraction of up vs down candles
  let ups = 0, downs = 0;
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[i - 1]) ups++;
    else if (closes[i] < closes[i - 1]) downs++;
  }
  const total = ups + downs || 1;
  const directionScore = ((ups - downs) / total) * 100; // -100..100
  const trendStrength = Math.round((directionScore + Math.sign(totalMovePct) * Math.min(100, Math.abs(totalMovePct) * 5)) / 2);

  // Classification
  if (volatilityPct > 4) {
    reasons.push(`ATR ${volatilityPct.toFixed(2)}% — high volatility`);
    return { regime: "high_volatility", trendStrength, volatilityPct, reasons };
  }
  if (volatilityPct < 0.6) {
    reasons.push(`ATR ${volatilityPct.toFixed(2)}% — low volatility`);
    return { regime: "low_volatility", trendStrength, volatilityPct, reasons };
  }
  if (Math.abs(trendStrength) >= 40 && Math.abs(totalMovePct) >= 1) {
    const regime: Regime = trendStrength > 0 ? "trending_up" : "trending_down";
    reasons.push(`Trend ${trendStrength} over ${slice.length} bars (${totalMovePct.toFixed(2)}%)`);
    return { regime, trendStrength, volatilityPct, reasons };
  }
  if (Math.abs(trendStrength) < 20) {
    reasons.push(`Trend ${trendStrength} — choppy/no direction`);
    return { regime: "choppy", trendStrength, volatilityPct, reasons };
  }
  return { regime: "neutral", trendStrength, volatilityPct, reasons: ["neutral conditions"] };
}