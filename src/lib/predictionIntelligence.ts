// Prediction Intelligence Engine
// Outcome-weighted scoring, prediction decay, volatility-regime filtering,
// sector momentum context, and fill-rate calibration.

const OUTCOME_KEY = "neuraltrade_outcome_weights";
const FILLRATE_KEY = "neuraltrade_fillrate_cal";
const MAX_OUTCOMES = 300;

// ─── Outcome-Weighted Scoring ───
// Tracks which indicator combinations produce profitable trades

export interface IndicatorOutcome {
  indicators: string[]; // e.g. ["ema_golden", "rsi_oversold", "vol_surge"]
  profitable: boolean;
  pnlPct: number;
  timestamp: number;
}

interface IndicatorWeight {
  name: string;
  profitRate: number;   // 0-1
  avgPnlPct: number;
  sampleSize: number;
  weight: number;       // Dynamic weight multiplier (0.5 - 2.0)
}

let outcomeCache: IndicatorOutcome[] | null = null;

function loadOutcomes(): IndicatorOutcome[] {
  if (outcomeCache) return outcomeCache;
  try {
    const raw = localStorage.getItem(OUTCOME_KEY);
    outcomeCache = raw ? JSON.parse(raw) : [];
  } catch { outcomeCache = []; }
  return outcomeCache!;
}

function saveOutcomes(outcomes: IndicatorOutcome[]) {
  outcomeCache = outcomes.slice(-MAX_OUTCOMES);
  try { localStorage.setItem(OUTCOME_KEY, JSON.stringify(outcomeCache)); } catch {}
}

export function recordOutcome(activeIndicators: string[], profitable: boolean, pnlPct: number) {
  const outcomes = loadOutcomes();
  outcomes.push({ indicators: activeIndicators, profitable, pnlPct, timestamp: Date.now() });
  saveOutcomes(outcomes);
}

export function getIndicatorWeights(): Record<string, IndicatorWeight> {
  const outcomes = loadOutcomes();
  if (outcomes.length < 5) return {};
  
  const stats: Record<string, { wins: number; total: number; totalPnl: number }> = {};
  
  for (const o of outcomes) {
    for (const ind of o.indicators) {
      if (!stats[ind]) stats[ind] = { wins: 0, total: 0, totalPnl: 0 };
      stats[ind].total++;
      if (o.profitable) stats[ind].wins++;
      stats[ind].totalPnl += o.pnlPct;
    }
  }
  
  const weights: Record<string, IndicatorWeight> = {};
  for (const [name, s] of Object.entries(stats)) {
    if (s.total < 3) continue;
    const profitRate = s.wins / s.total;
    const avgPnl = s.totalPnl / s.total;
    // Weight: 0.5 for <30% WR, 1.0 for 50%, 2.0 for >70% WR
    const weight = Math.max(0.5, Math.min(2.0, 0.5 + profitRate * 2));
    weights[name] = { name, profitRate, avgPnlPct: avgPnl, sampleSize: s.total, weight };
  }
  
  return weights;
}

// Extract active indicator names from a prediction context
export function extractActiveIndicators(context: {
  ema3vs8: string; ema9vs21: string; macdSignal: string;
  bbPosition: string; volumeProfile: string; obvTrend: string;
  vwapPosition: string; candlePattern: string | null;
  microRsi: number; stochRsi: number;
}): string[] {
  const active: string[] = [];
  if (context.ema3vs8 === "golden") active.push("ema_golden");
  if (context.ema3vs8 === "death") active.push("ema_death");
  if (context.ema9vs21 === "golden") active.push("ema9_golden");
  if (context.ema9vs21 === "death") active.push("ema9_death");
  if (context.macdSignal === "bullish") active.push("macd_bull");
  if (context.macdSignal === "bearish") active.push("macd_bear");
  if (context.bbPosition === "lower") active.push("bb_lower");
  if (context.bbPosition === "upper") active.push("bb_upper");
  if (context.volumeProfile === "surge") active.push("vol_surge");
  if (context.volumeProfile === "dry") active.push("vol_dry");
  if (context.obvTrend === "rising") active.push("obv_rising");
  if (context.obvTrend === "falling") active.push("obv_falling");
  if (context.vwapPosition === "above") active.push("vwap_above");
  if (context.vwapPosition === "below") active.push("vwap_below");
  if (context.microRsi > 70) active.push("rsi_overbought");
  if (context.microRsi < 30) active.push("rsi_oversold");
  if (context.stochRsi > 80) active.push("stoch_overbought");
  if (context.stochRsi < 20) active.push("stoch_oversold");
  if (context.candlePattern?.includes("Bullish")) active.push("candle_bullish");
  if (context.candlePattern?.includes("Bearish")) active.push("candle_bearish");
  if (context.candlePattern === "Hammer") active.push("candle_hammer");
  if (context.candlePattern === "Doji") active.push("candle_doji");
  return active;
}

// Apply outcome-weighted adjustments to a raw score
export function applyOutcomeWeights(rawScore: number, activeIndicators: string[]): number {
  const weights = getIndicatorWeights();
  if (Object.keys(weights).length === 0) return rawScore;
  
  let weightedMultiplier = 0;
  let weightCount = 0;
  
  for (const ind of activeIndicators) {
    const w = weights[ind];
    if (w) {
      weightedMultiplier += w.weight;
      weightCount++;
    }
  }
  
  if (weightCount === 0) return rawScore;
  const avgWeight = weightedMultiplier / weightCount;
  return rawScore * avgWeight;
}

// ─── Prediction Decay ───
// Older predictions lose weight over time

export function applyPredictionDecay(
  confidence: number,
  generatedAt: number,
  timeframeSec: number
): number {
  const ageSec = (Date.now() - generatedAt) / 1000;
  const lifeFraction = ageSec / timeframeSec;
  
  // Linear decay: full confidence at 0%, 50% at 80% life, 0% at 100%+
  if (lifeFraction >= 1.0) return 0;
  if (lifeFraction >= 0.8) return confidence * (1 - lifeFraction) * 5; // Fast decay in last 20%
  if (lifeFraction >= 0.5) return confidence * (1 - lifeFraction * 0.3); // Moderate decay
  return confidence; // First 50% of lifetime: full confidence
}

// ─── Volatility-Regime Filtering ───
// Require higher confidence in choppy/low-volume regimes

export type VolatilityRegime = "trending" | "choppy" | "volatile" | "calm";

export function detectVolatilityRegime(
  klines: Array<{ high: number; low: number; close: number; open: number; volume: number }>
): VolatilityRegime {
  if (klines.length < 10) return "calm";
  const recent = klines.slice(-20);
  
  // ATR as % of price
  const closes = recent.map(k => k.close);
  let atrSum = 0;
  for (let i = 1; i < recent.length; i++) {
    const tr = Math.max(
      recent[i].high - recent[i].low,
      Math.abs(recent[i].high - recent[i - 1].close),
      Math.abs(recent[i].low - recent[i - 1].close)
    );
    atrSum += tr;
  }
  const atrPct = (atrSum / (recent.length - 1)) / closes[closes.length - 1] * 100;
  
  // Directional consistency
  let sameDir = 0;
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1];
    const curr = closes[i];
    const prevDir = i >= 2 ? Math.sign(closes[i - 1] - closes[i - 2]) : 0;
    const currDir = Math.sign(curr - prev);
    if (currDir === prevDir && currDir !== 0) sameDir++;
  }
  const consistency = sameDir / (closes.length - 1);
  
  if (atrPct > 2.0) return "volatile";
  if (consistency > 0.6 && atrPct > 0.3) return "trending";
  if (consistency < 0.35) return "choppy";
  return "calm";
}

export function getRegimeConfidenceAdjustment(regime: VolatilityRegime): number {
  switch (regime) {
    case "trending": return -5;   // Easier to predict, lower threshold OK
    case "calm": return 0;
    case "choppy": return +12;    // Much harder to predict, need high confidence
    case "volatile": return +8;   // Risky, need higher confidence
  }
}

// ─── Sector Momentum Context ───
// Penalize predictions that go against sector trend

export function getSectorMomentumPenalty(
  direction: "up" | "down" | "flat",
  sectorChangePct: number
): number {
  if (direction === "flat") return 0;
  
  const stockBullish = direction === "up";
  const sectorBullish = sectorChangePct > 0.5;
  const sectorBearish = sectorChangePct < -0.5;
  
  // Going against a strong sector trend
  if (stockBullish && sectorBearish && Math.abs(sectorChangePct) > 1) {
    return -Math.min(15, Math.abs(sectorChangePct) * 3); // Penalize up to -15
  }
  if (!stockBullish && sectorBullish && Math.abs(sectorChangePct) > 1) {
    return -Math.min(15, Math.abs(sectorChangePct) * 3);
  }
  
  // Aligned with sector (bonus)
  if (stockBullish && sectorBullish) {
    return Math.min(8, Math.abs(sectorChangePct) * 2);
  }
  if (!stockBullish && sectorBearish) {
    return Math.min(8, Math.abs(sectorChangePct) * 2);
  }
  
  return 0;
}

// ─── Fill-Rate Calibration ───
// Track how often each confidence level produces profitable fills

interface FillRateBucket {
  confRange: string; // e.g. "60-69"
  totalFills: number;
  profitableFills: number;
  avgPnlPct: number;
}

function loadFillRates(): FillRateBucket[] {
  try {
    const raw = localStorage.getItem(FILLRATE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveFillRates(buckets: FillRateBucket[]) {
  try { localStorage.setItem(FILLRATE_KEY, JSON.stringify(buckets)); } catch {}
}

export function recordFillOutcome(confidence: number, profitable: boolean, pnlPct: number) {
  const buckets = loadFillRates();
  const rangeStart = Math.floor(confidence / 10) * 10;
  const rangeKey = `${rangeStart}-${rangeStart + 9}`;
  
  let bucket = buckets.find(b => b.confRange === rangeKey);
  if (!bucket) {
    bucket = { confRange: rangeKey, totalFills: 0, profitableFills: 0, avgPnlPct: 0 };
    buckets.push(bucket);
  }
  
  bucket.totalFills++;
  if (profitable) bucket.profitableFills++;
  bucket.avgPnlPct = ((bucket.avgPnlPct * (bucket.totalFills - 1)) + pnlPct) / bucket.totalFills;
  
  saveFillRates(buckets);
}

export function getCalibratedConfidence(rawConfidence: number): number {
  const buckets = loadFillRates();
  const rangeStart = Math.floor(rawConfidence / 10) * 10;
  const rangeKey = `${rangeStart}-${rangeStart + 9}`;
  
  const bucket = buckets.find(b => b.confRange === rangeKey);
  if (!bucket || bucket.totalFills < 5) return rawConfidence; // Not enough data
  
  const actualWinRate = bucket.profitableFills / bucket.totalFills;
  const impliedConfidence = rawConfidence / 100;
  
  // If actual win rate is much lower than implied confidence, reduce
  // If actual win rate is higher, boost slightly
  const calibrationFactor = actualWinRate / Math.max(0.3, impliedConfidence);
  const adjustment = (calibrationFactor - 1) * 15; // Scale adjustment
  
  return Math.max(20, Math.min(95, rawConfidence + adjustment));
}

// ─── Time-of-Day Prediction Reliability ───

export function getTimeOfDayReliability(): number {
  const hour = new Date().getHours();
  const minute = new Date().getMinutes();
  const etHour = hour; // Simplified; in production convert to ET
  
  // Pre-market (4-9:30): low reliability
  if (etHour < 9 || (etHour === 9 && minute < 30)) return 0.7;
  // Opening 30min (9:30-10): moderate (volatile but predictable patterns)
  if (etHour === 9 || (etHour === 10 && minute === 0)) return 0.85;
  // Morning (10-11:30): highest reliability
  if (etHour >= 10 && etHour < 12) return 1.0;
  // Lunch (11:30-2): low volume, choppy
  if (etHour >= 12 && etHour < 14) return 0.65;
  // Afternoon (2-3:30): moderate
  if (etHour >= 14 && (etHour < 15 || (etHour === 15 && minute < 30))) return 0.9;
  // Power hour (3:30-4): good but fast
  if (etHour === 15 && minute >= 30) return 0.85;
  // After hours
  return 0.6;
}

// ─── Composite Intelligence Adjustment ───

export interface PredictionIntelligenceResult {
  adjustedConfidence: number;
  adjustedScore: number;
  regime: VolatilityRegime;
  regimeAdjustment: number;
  sectorPenalty: number;
  decayFactor: number;
  outcomeWeightFactor: number;
  calibrationDelta: number;
  timeReliability: number;
  reasons: string[];
}

export function applyPredictionIntelligence(
  rawScore: number,
  rawConfidence: number,
  direction: "up" | "down" | "flat",
  generatedAt: number,
  timeframeSec: number,
  activeIndicators: string[],
  klines: Array<{ high: number; low: number; close: number; open: number; volume: number }>,
  sectorChangePct?: number,
): PredictionIntelligenceResult {
  const reasons: string[] = [];
  
  // 1. Outcome-weighted scoring
  const weightedScore = applyOutcomeWeights(rawScore, activeIndicators);
  const outcomeWeightFactor = rawScore !== 0 ? weightedScore / rawScore : 1;
  if (Math.abs(outcomeWeightFactor - 1) > 0.1) {
    reasons.push(`Outcome weight: ${outcomeWeightFactor.toFixed(2)}x`);
  }
  
  // 2. Prediction decay
  const decayedConf = applyPredictionDecay(rawConfidence, generatedAt, timeframeSec);
  const decayFactor = rawConfidence > 0 ? decayedConf / rawConfidence : 1;
  if (decayFactor < 0.9) {
    reasons.push(`Decay: ${(decayFactor * 100).toFixed(0)}% remaining`);
  }
  
  // 3. Volatility regime
  const regime = detectVolatilityRegime(klines);
  const regimeAdj = getRegimeConfidenceAdjustment(regime);
  if (regimeAdj !== 0) {
    reasons.push(`${regime} regime: ${regimeAdj > 0 ? "+" : ""}${regimeAdj}% threshold`);
  }
  
  // 4. Sector momentum
  const sectorPenalty = sectorChangePct !== undefined
    ? getSectorMomentumPenalty(direction, sectorChangePct)
    : 0;
  if (Math.abs(sectorPenalty) > 3) {
    reasons.push(`Sector ${sectorPenalty > 0 ? "aligned" : "against"}: ${sectorPenalty > 0 ? "+" : ""}${sectorPenalty.toFixed(0)}`);
  }
  
  // 5. Fill-rate calibration
  const calibrated = getCalibratedConfidence(rawConfidence);
  const calibrationDelta = calibrated - rawConfidence;
  if (Math.abs(calibrationDelta) > 2) {
    reasons.push(`Calibration: ${calibrationDelta > 0 ? "+" : ""}${calibrationDelta.toFixed(0)}%`);
  }
  
  // 6. Time-of-day reliability
  const timeReliability = getTimeOfDayReliability();
  if (timeReliability < 0.8) {
    reasons.push(`Time reliability: ${(timeReliability * 100).toFixed(0)}%`);
  }
  
  // Compose final values
  let adjustedConfidence = decayedConf + sectorPenalty + calibrationDelta - regimeAdj;
  adjustedConfidence *= timeReliability;
  adjustedConfidence = Math.max(10, Math.min(95, adjustedConfidence));
  
  const adjustedScore = weightedScore * timeReliability;
  
  return {
    adjustedConfidence: Math.round(adjustedConfidence),
    adjustedScore: Math.round(adjustedScore),
    regime,
    regimeAdjustment: regimeAdj,
    sectorPenalty,
    decayFactor,
    outcomeWeightFactor,
    calibrationDelta,
    timeReliability,
    reasons,
  };
}
