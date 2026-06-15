// Prediction Feedback Engine
// Analyzes all historical predictions to learn which indicators, conditions,
// timeframes, and market regimes produced correct vs incorrect predictions.
// Feeds learned adjustments back into the scoring system.

const FEEDBACK_KEY = "neuraltrade_pred_feedback";
const PRED_HISTORY_KEY = "micro_pred_accuracy";
const OUTCOME_KEY = "neuraltrade_outcome_weights";
const SIGNAL_REPLAY_KEY = "neuraltrade_signal_replay";

// ─── Types ───

export interface IndicatorSnapshot {
  microRsi: number;
  stochRsi: number;
  macdSignal: string;
  bbPosition: string;
  bbWidth: number;
  volumeProfile: string;
  volumeRatio: number;
  ema3vs8: string;
  ema9vs21: string;
  priceAccel: number;
  obvTrend: string;
  trendPersistence: number;
  fibLevel: string;
  fibDistance: number;
  vwapPosition: string;
  orderFlowBias: number;
  candlePattern: string | null;
}

export interface EnrichedPredRecord {
  id: string;
  timeframe: string;
  direction: "up" | "down" | "flat";
  predictedPrice: number;
  startPrice: number;
  targetHigh: number;
  targetLow: number;
  confidence: number;
  actualPrice?: number;
  createdAt: number;
  resolvedAt?: number;
  hit: boolean | null;
  directionHit: boolean | null;
  targetHit: boolean | null;
  indicators?: IndicatorSnapshot;
  regime?: string;
  score?: number;
}

interface IndicatorCondition {
  name: string;
  value: string;
}

interface ConditionStats {
  total: number;
  wins: number;
  losses: number;
  avgConfidence: number;
  avgPnlBps: number; // basis points
  winRate: number;
}

export interface FeedbackAnalysis {
  totalResolved: number;
  overallWinRate: number;
  // Per-indicator condition stats
  conditionStats: Record<string, ConditionStats>;
  // Best/worst performing conditions
  bestConditions: Array<{ condition: string; winRate: number; n: number }>;
  worstConditions: Array<{ condition: string; winRate: number; n: number }>;
  // Indicator pair confluence accuracy
  pairStats: Record<string, ConditionStats>;
  bestPairs: Array<{ pair: string; winRate: number; n: number }>;
  worstPairs: Array<{ pair: string; winRate: number; n: number }>;
  // Timeframe accuracy
  byTimeframe: Record<string, { winRate: number; n: number }>;
  // Regime accuracy
  byRegime: Record<string, { winRate: number; n: number }>;
  // Confidence calibration buckets
  calibrationBuckets: Array<{ range: string; predicted: number; actual: number; n: number }>;
  // Score weight adjustments (the key output - feeds back into scoring)
  weightAdjustments: Record<string, number>;
  // Recommendations
  recommendations: string[];
}

// ─── Load enriched prediction history ───

function loadEnrichedHistory(): EnrichedPredRecord[] {
  try {
    const raw = localStorage.getItem(PRED_HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveEnrichedHistory(records: EnrichedPredRecord[]) {
  try {
    localStorage.setItem(PRED_HISTORY_KEY, JSON.stringify(records.slice(-200)));
  } catch {}
}

// ─── Extract conditions from indicator snapshot ───

function extractConditions(ind: IndicatorSnapshot): IndicatorCondition[] {
  const conds: IndicatorCondition[] = [];

  // RSI zones
  if (ind.microRsi > 75) conds.push({ name: "rsi", value: "overbought_extreme" });
  else if (ind.microRsi > 65) conds.push({ name: "rsi", value: "overbought" });
  else if (ind.microRsi < 25) conds.push({ name: "rsi", value: "oversold_extreme" });
  else if (ind.microRsi < 35) conds.push({ name: "rsi", value: "oversold" });
  else conds.push({ name: "rsi", value: "neutral" });

  // StochRSI
  if (ind.stochRsi > 80) conds.push({ name: "stochRsi", value: "overbought" });
  else if (ind.stochRsi < 20) conds.push({ name: "stochRsi", value: "oversold" });

  // MACD
  conds.push({ name: "macd", value: ind.macdSignal });

  // BB
  conds.push({ name: "bb", value: ind.bbPosition });
  if (ind.bbWidth < 0.02) conds.push({ name: "bb_squeeze", value: "active" });

  // Volume
  conds.push({ name: "volume", value: ind.volumeProfile });

  // EMAs
  conds.push({ name: "ema3v8", value: ind.ema3vs8 });
  conds.push({ name: "ema9v21", value: ind.ema9vs21 });

  // OBV
  conds.push({ name: "obv", value: ind.obvTrend });

  // VWAP
  conds.push({ name: "vwap", value: ind.vwapPosition });

  // Candle patterns
  if (ind.candlePattern) conds.push({ name: "candle", value: ind.candlePattern });

  // Trend persistence
  if (ind.trendPersistence >= 3) conds.push({ name: "persistence", value: "strong_up" });
  else if (ind.trendPersistence <= -3) conds.push({ name: "persistence", value: "strong_down" });
  else if (ind.trendPersistence >= 2) conds.push({ name: "persistence", value: "up" });
  else if (ind.trendPersistence <= -2) conds.push({ name: "persistence", value: "down" });

  // Order flow
  if (ind.orderFlowBias > 30) conds.push({ name: "flow", value: "buy_pressure" });
  else if (ind.orderFlowBias < -30) conds.push({ name: "flow", value: "sell_pressure" });

  // Acceleration
  if (ind.priceAccel > 3) conds.push({ name: "accel", value: "accelerating_up" });
  else if (ind.priceAccel < -3) conds.push({ name: "accel", value: "accelerating_down" });

  // Fib proximity
  if (ind.fibDistance < 0.3) conds.push({ name: "fib", value: `near_${ind.fibLevel}` });

  return conds;
}

// ─── Core Analysis ───

export function analyzePredictionFeedback(): FeedbackAnalysis {
  const records = loadEnrichedHistory().filter(r => r.hit !== null);
  const resolved = records.filter(r => r.resolvedAt);

  const conditionStats: Record<string, ConditionStats> = {};
  const pairStats: Record<string, ConditionStats> = {};
  const byTimeframe: Record<string, { wins: number; total: number }> = {};
  const byRegime: Record<string, { wins: number; total: number }> = {};
  const calibrationRaw: Record<string, { totalConf: number; totalHits: number; n: number }> = {};

  for (const rec of resolved) {
    const isWin = rec.directionHit === true;
    const pnlBps = rec.actualPrice && rec.startPrice
      ? ((rec.actualPrice - rec.startPrice) / rec.startPrice) * 10000
      : 0;

    // Timeframe stats
    if (!byTimeframe[rec.timeframe]) byTimeframe[rec.timeframe] = { wins: 0, total: 0 };
    byTimeframe[rec.timeframe].total++;
    if (isWin) byTimeframe[rec.timeframe].wins++;

    // Regime stats
    const regime = rec.regime || "unknown";
    if (!byRegime[regime]) byRegime[regime] = { wins: 0, total: 0 };
    byRegime[regime].total++;
    if (isWin) byRegime[regime].wins++;

    // Calibration buckets
    const confBucket = `${Math.floor(rec.confidence / 10) * 10}-${Math.floor(rec.confidence / 10) * 10 + 9}`;
    if (!calibrationRaw[confBucket]) calibrationRaw[confBucket] = { totalConf: 0, totalHits: 0, n: 0 };
    calibrationRaw[confBucket].totalConf += rec.confidence;
    calibrationRaw[confBucket].totalHits += isWin ? 1 : 0;
    calibrationRaw[confBucket].n++;

    // Skip indicator analysis if no snapshot
    if (!rec.indicators) continue;

    const conditions = extractConditions(rec.indicators);

    // Per-condition stats
    for (const cond of conditions) {
      const key = `${cond.name}:${cond.value}`;
      if (!conditionStats[key]) conditionStats[key] = { total: 0, wins: 0, losses: 0, avgConfidence: 0, avgPnlBps: 0, winRate: 0 };
      const s = conditionStats[key];
      s.total++;
      if (isWin) s.wins++;
      else s.losses++;
      s.avgConfidence = ((s.avgConfidence * (s.total - 1)) + rec.confidence) / s.total;
      s.avgPnlBps = ((s.avgPnlBps * (s.total - 1)) + pnlBps) / s.total;
      s.winRate = s.total > 0 ? s.wins / s.total : 0;
    }

    // Pair confluence stats (top indicator pairs)
    for (let i = 0; i < conditions.length; i++) {
      for (let j = i + 1; j < conditions.length; j++) {
        // Skip same-category pairs
        if (conditions[i].name === conditions[j].name) continue;
        const pairKey = `${conditions[i].name}:${conditions[i].value}+${conditions[j].name}:${conditions[j].value}`;
        if (!pairStats[pairKey]) pairStats[pairKey] = { total: 0, wins: 0, losses: 0, avgConfidence: 0, avgPnlBps: 0, winRate: 0 };
        const ps = pairStats[pairKey];
        ps.total++;
        if (isWin) ps.wins++;
        else ps.losses++;
        ps.avgPnlBps = ((ps.avgPnlBps * (ps.total - 1)) + pnlBps) / ps.total;
        ps.winRate = ps.total > 0 ? ps.wins / ps.total : 0;
      }
    }
  }

  // Sort conditions by win rate (min 5 samples)
  const significantConditions = Object.entries(conditionStats)
    .filter(([, s]) => s.total >= 5)
    .sort((a, b) => b[1].winRate - a[1].winRate);

  const bestConditions = significantConditions.slice(0, 8).map(([c, s]) => ({ condition: c, winRate: Math.round(s.winRate * 100), n: s.total }));
  const worstConditions = significantConditions.slice(-8).reverse().map(([c, s]) => ({ condition: c, winRate: Math.round(s.winRate * 100), n: s.total }));

  // Sort pairs (min 3 samples)
  const significantPairs = Object.entries(pairStats)
    .filter(([, s]) => s.total >= 3)
    .sort((a, b) => b[1].winRate - a[1].winRate);

  const bestPairs = significantPairs.slice(0, 5).map(([p, s]) => ({ pair: p, winRate: Math.round(s.winRate * 100), n: s.total }));
  const worstPairs = significantPairs.slice(-5).reverse().map(([p, s]) => ({ pair: p, winRate: Math.round(s.winRate * 100), n: s.total }));

  // Calibration buckets
  const calibrationBuckets = Object.entries(calibrationRaw)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([range, d]) => ({
      range,
      predicted: Math.round(d.totalConf / d.n),
      actual: Math.round((d.totalHits / d.n) * 100),
      n: d.n,
    }));

  // ─── Compute weight adjustments ───
  // For each indicator scoring factor in microPredictions, compute a multiplier
  // based on historical accuracy when that indicator was in a directional state
  const weightAdjustments: Record<string, number> = {};
  const overallWR = resolved.length > 0 ? resolved.filter(r => r.directionHit).length / resolved.length : 0.5;

  for (const [key, stats] of Object.entries(conditionStats)) {
    if (stats.total < 5) continue;
    // Weight = (condition WR / overall WR), clamped to 0.5-2.0
    const raw = stats.winRate / Math.max(0.3, overallWR);
    weightAdjustments[key] = Math.max(0.5, Math.min(2.0, raw));
  }

  // ─── Generate recommendations ───
  const recommendations: string[] = [];

  // Check if any indicator is consistently wrong
  for (const [cond, stats] of Object.entries(conditionStats)) {
    if (stats.total >= 8 && stats.winRate < 0.35) {
      recommendations.push(`⚠️ ${formatCondition(cond)} has only ${Math.round(stats.winRate * 100)}% win rate (n=${stats.total}) — consider reducing its scoring weight`);
    }
    if (stats.total >= 8 && stats.winRate > 0.7) {
      recommendations.push(`✅ ${formatCondition(cond)} has ${Math.round(stats.winRate * 100)}% win rate (n=${stats.total}) — high-value signal`);
    }
  }

  // Check calibration drift
  for (const bucket of calibrationBuckets) {
    if (bucket.n >= 5 && Math.abs(bucket.predicted - bucket.actual) > 15) {
      const dir = bucket.actual < bucket.predicted ? "overconfident" : "underconfident";
      recommendations.push(`📊 ${dir} in ${bucket.range}% range: predicted ${bucket.predicted}% but actual ${bucket.actual}% (n=${bucket.n})`);
    }
  }

  // Regime-specific recommendations
  for (const [regime, stats] of Object.entries(byRegime)) {
    if (stats.total >= 5) {
      const wr = Math.round((stats.wins / stats.total) * 100);
      if (wr < 40) recommendations.push(`🔴 ${regime} regime: only ${wr}% accuracy — consider filtering out signals in this regime`);
      if (wr > 65) recommendations.push(`🟢 ${regime} regime: ${wr}% accuracy — strong signal environment`);
    }
  }

  // Timeframe recommendations
  for (const [tf, stats] of Object.entries(byTimeframe)) {
    const wr = Math.round((stats.wins / stats.total) * 100);
    if (stats.total >= 10 && wr < 40) {
      recommendations.push(`⏱️ ${tf} predictions only ${wr}% accurate — consider disabling or adjusting`);
    }
  }

  // Check best pairs
  if (bestPairs.length > 0 && bestPairs[0].winRate > 70) {
    recommendations.push(`🎯 Best combo: ${formatPair(bestPairs[0].pair)} at ${bestPairs[0].winRate}% WR — prioritize this setup`);
  }

  const tfFormatted: Record<string, { winRate: number; n: number }> = {};
  for (const [tf, s] of Object.entries(byTimeframe)) {
    tfFormatted[tf] = { winRate: Math.round((s.wins / s.total) * 100), n: s.total };
  }
  const regimeFormatted: Record<string, { winRate: number; n: number }> = {};
  for (const [r, s] of Object.entries(byRegime)) {
    regimeFormatted[r] = { winRate: Math.round((s.wins / s.total) * 100), n: s.total };
  }

  return {
    totalResolved: resolved.length,
    overallWinRate: Math.round(overallWR * 100),
    conditionStats,
    bestConditions,
    worstConditions,
    pairStats,
    bestPairs,
    worstPairs,
    byTimeframe: tfFormatted,
    byRegime: regimeFormatted,
    calibrationBuckets,
    weightAdjustments,
    recommendations,
  };
}

// ─── Apply learned weight adjustments to scoring ───

const AUTO_DISABLE_KEY = "neuraltrade_auto_disable_conditions";

export interface AutoDisableConfig {
  enabled: boolean;
  minWinRate: number; // default 0.35
  minSamples: number; // default 10
}

function loadAutoDisableConfig(): AutoDisableConfig {
  try {
    const raw = localStorage.getItem(AUTO_DISABLE_KEY + "_config");
    return raw ? JSON.parse(raw) : { enabled: true, minWinRate: 0.35, minSamples: 10 };
  } catch { return { enabled: true, minWinRate: 0.35, minSamples: 10 }; }
}

export function saveAutoDisableConfig(config: AutoDisableConfig) {
  try { localStorage.setItem(AUTO_DISABLE_KEY + "_config", JSON.stringify(config)); } catch {}
  invalidateFeedbackCache();
}

export function getAutoDisableConfig(): AutoDisableConfig {
  return loadAutoDisableConfig();
}

// Returns set of condition keys that are auto-disabled
export function getDisabledConditions(): Set<string> {
  const config = loadAutoDisableConfig();
  if (!config.enabled) return new Set();
  
  const feedback = getCachedFeedback();
  if (!feedback) return new Set();
  
  const disabled = new Set<string>();
  for (const [key, stats] of Object.entries(feedback.conditionStats)) {
    if (stats.total >= config.minSamples && stats.winRate < config.minWinRate) {
      disabled.add(key);
    }
  }
  return disabled;
}

export function getLearnedScoreAdjustment(indicators: IndicatorSnapshot): number {
  const feedback = getCachedFeedback();
  if (!feedback || Object.keys(feedback.weightAdjustments).length === 0) return 0;

  const conditions = extractConditions(indicators);
  const disabled = getDisabledConditions();
  let totalAdj = 0;
  let count = 0;

  for (const cond of conditions) {
    const key = `${cond.name}:${cond.value}`;
    
    // If condition is auto-disabled, apply heavy penalty
    if (disabled.has(key)) {
      totalAdj += -0.8; // Strong negative weight
      count++;
      continue;
    }
    
    const adj = feedback.weightAdjustments[key];
    if (adj !== undefined && adj !== 1.0) {
      totalAdj += (adj - 1.0); // deviation from 1.0
      count++;
    }
  }

  if (count === 0) return 0;
  // Average deviation, scaled to score adjustment (-15 to +15)
  return Math.max(-15, Math.min(15, (totalAdj / count) * 30));
}

// ─── Get learned confidence calibration ───

export function getLearnedConfidenceAdjustment(rawConfidence: number): number {
  const feedback = getCachedFeedback();
  if (!feedback || feedback.calibrationBuckets.length === 0) return 0;

  const bucket = feedback.calibrationBuckets.find(b => {
    const [lo] = b.range.split("-").map(Number);
    return rawConfidence >= lo && rawConfidence < lo + 10;
  });

  if (!bucket || bucket.n < 5) return 0;
  // If we predicted 70% but actual was 55%, we need to subtract ~15
  const drift = bucket.actual - bucket.predicted;
  return Math.max(-15, Math.min(15, drift * 0.5)); // Apply half the drift
}

// ─── Feedback cache (recompute every 60s max) ───

let feedbackCache: FeedbackAnalysis | null = null;
let feedbackCacheTime = 0;

function getCachedFeedback(): FeedbackAnalysis | null {
  if (feedbackCache && Date.now() - feedbackCacheTime < 60_000) return feedbackCache;
  try {
    feedbackCache = analyzePredictionFeedback();
    feedbackCacheTime = Date.now();
    return feedbackCache;
  } catch { return null; }
}

export function invalidateFeedbackCache() {
  feedbackCache = null;
  feedbackCacheTime = 0;
}

// ─── Formatting helpers ───

function formatCondition(key: string): string {
  return key.replace(":", " → ").replace(/_/g, " ");
}

function formatPair(pair: string): string {
  return pair.split("+").map(p => formatCondition(p)).join(" + ");
}
