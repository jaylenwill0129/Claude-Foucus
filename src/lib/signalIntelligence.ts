// Signal Intelligence Engine
// Multi-timeframe confluence, volume profile, signal expiration, signal replay/grading,
// regime-specific strategy selection, and correlation-aware portfolio limits.

import { type ShortTermPrediction } from "@/lib/microPredictions";

// ─── Volume Profile Integration ───
// Weight signals near high-volume nodes (POC/VAH/VAL)

export interface VolumeProfile {
  poc: number;       // Point of Control — price with most volume
  vah: number;       // Value Area High (70th percentile)
  val: number;       // Value Area Low (30th percentile)
  totalVolume: number;
}

export function computeVolumeProfile(
  klines: Array<{ high: number; low: number; close: number; volume: number }>
): VolumeProfile | null {
  if (klines.length < 10) return null;
  
  const recent = klines.slice(-30);
  const priceMin = Math.min(...recent.map(k => k.low));
  const priceMax = Math.max(...recent.map(k => k.high));
  const range = priceMax - priceMin;
  if (range <= 0) return null;
  
  // Create 20 price buckets
  const buckets = 20;
  const bucketSize = range / buckets;
  const volumeByBucket: number[] = new Array(buckets).fill(0);
  let totalVolume = 0;
  
  for (const k of recent) {
    const midPrice = (k.high + k.low + k.close) / 3;
    const bucketIdx = Math.min(buckets - 1, Math.floor((midPrice - priceMin) / bucketSize));
    volumeByBucket[bucketIdx] += k.volume;
    totalVolume += k.volume;
  }
  
  // POC = bucket with most volume
  let pocIdx = 0;
  for (let i = 1; i < buckets; i++) {
    if (volumeByBucket[i] > volumeByBucket[pocIdx]) pocIdx = i;
  }
  const poc = priceMin + (pocIdx + 0.5) * bucketSize;
  
  // Value Area: 70% of volume centered on POC
  const targetVol = totalVolume * 0.7;
  let areaVol = volumeByBucket[pocIdx];
  let lo = pocIdx, hi = pocIdx;
  
  while (areaVol < targetVol && (lo > 0 || hi < buckets - 1)) {
    const addLo = lo > 0 ? volumeByBucket[lo - 1] : 0;
    const addHi = hi < buckets - 1 ? volumeByBucket[hi + 1] : 0;
    if (addLo >= addHi && lo > 0) { lo--; areaVol += addLo; }
    else if (hi < buckets - 1) { hi++; areaVol += addHi; }
    else { lo--; areaVol += addLo; }
  }
  
  return {
    poc,
    val: priceMin + lo * bucketSize,
    vah: priceMin + (hi + 1) * bucketSize,
    totalVolume,
  };
}

export function getVolumeProfileWeight(
  currentPrice: number,
  profile: VolumeProfile
): { weight: number; zone: string; reason: string } {
  const pocDist = Math.abs(currentPrice - profile.poc) / profile.poc * 100;
  
  // Near POC (highest volume node) — strong support/resistance
  if (pocDist < 0.3) {
    return { weight: 1.3, zone: "POC", reason: `At Point of Control $${profile.poc.toFixed(2)} — high conviction zone` };
  }
  // Near Value Area edges — good reversal zones
  if (Math.abs(currentPrice - profile.vah) / profile.vah * 100 < 0.5) {
    return { weight: 1.2, zone: "VAH", reason: `At Value Area High $${profile.vah.toFixed(2)} — resistance zone` };
  }
  if (Math.abs(currentPrice - profile.val) / profile.val * 100 < 0.5) {
    return { weight: 1.2, zone: "VAL", reason: `At Value Area Low $${profile.val.toFixed(2)} — support zone` };
  }
  // Inside value area — normal
  if (currentPrice >= profile.val && currentPrice <= profile.vah) {
    return { weight: 1.0, zone: "VA", reason: "Inside value area" };
  }
  // Outside value area — lower weight (price discovery, less predictable)
  return { weight: 0.8, zone: "Outside", reason: "Outside value area — lower predictability" };
}

// ─── Signal Expiration & Staleness Detection ───

export interface SignalExpiry {
  isExpired: boolean;
  isStalening: boolean;
  freshness: number; // 0-100, 100 = fresh
  reason: string;
}

export function checkSignalExpiry(
  generatedAt: number,
  timeframeMs: number,
  confidence: number
): SignalExpiry {
  const ageMs = Date.now() - generatedAt;
  const ageFraction = ageMs / timeframeMs;
  
  if (ageFraction >= 1.0) {
    return { isExpired: true, isStalening: false, freshness: 0, reason: "Signal expired — past timeframe window" };
  }
  if (ageFraction >= 0.75) {
    const freshness = Math.round((1 - ageFraction) * 100 * 4);
    return { isExpired: false, isStalening: true, freshness, reason: `Signal aging (${freshness}% fresh) — reduce weight` };
  }
  if (ageFraction >= 0.5 && confidence < 60) {
    const freshness = Math.round((1 - ageFraction * 0.5) * 100);
    return { isExpired: false, isStalening: true, freshness, reason: "Low confidence signal aging — consider refresh" };
  }
  
  const freshness = Math.round((1 - ageFraction * 0.3) * 100);
  return { isExpired: false, isStalening: false, freshness: Math.min(100, freshness), reason: "Signal fresh" };
}

// ─── Signal Replay & Grading ───
// Score every past signal's actual outcome and feed accuracy back

const SIGNAL_REPLAY_KEY = "neuraltrade_signal_replay";
const MAX_REPLAY = 300;

export interface SignalReplayRecord {
  id: string;
  symbol: string;
  signalType: string; // "strong_buy", "buy", "sell", etc.
  confidence: number;
  entryPrice: number;
  exitPrice?: number;
  targetPrice?: number;
  stopPrice?: number;
  pnlPct?: number;
  grade?: "A" | "B" | "C" | "D" | "F";
  timestamp: number;
  resolvedAt?: number;
  hitTarget: boolean | null;
  hitStop: boolean | null;
  maxFavorable?: number; // Max favorable excursion %
  maxAdverse?: number;   // Max adverse excursion %
  regime?: string;
  sector?: string;
  indicators?: string[];
}

function loadSignalReplays(): SignalReplayRecord[] {
  try {
    const raw = localStorage.getItem(SIGNAL_REPLAY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveSignalReplays(records: SignalReplayRecord[]) {
  try {
    localStorage.setItem(SIGNAL_REPLAY_KEY, JSON.stringify(records.slice(-MAX_REPLAY)));
  } catch { }
}

export function recordSignalForReplay(
  symbol: string, signalType: string, confidence: number,
  entryPrice: number, targetPrice?: number, stopPrice?: number,
  regime?: string, sector?: string, indicators?: string[]
) {
  const records = loadSignalReplays();
  records.push({
    id: `${Date.now()}-${symbol}`,
    symbol, signalType, confidence, entryPrice, targetPrice, stopPrice,
    timestamp: Date.now(), hitTarget: null, hitStop: null,
    regime, sector, indicators,
  });
  saveSignalReplays(records);
}

export function resolveSignalReplay(
  symbol: string, currentPrice: number, highSincEntry?: number, lowSinceEntry?: number
) {
  const records = loadSignalReplays();
  let changed = false;
  
  for (const rec of records) {
    if (rec.resolvedAt || rec.symbol !== symbol) continue;
    const ageMs = Date.now() - rec.timestamp;
    
    // Only resolve after at least 5 minutes
    if (ageMs < 5 * 60 * 1000) continue;
    // Auto-resolve after 2 hours
    if (ageMs > 2 * 60 * 60 * 1000 || rec.hitTarget !== null || rec.hitStop !== null) {
      rec.exitPrice = currentPrice;
      rec.resolvedAt = Date.now();
      
      const pnlPct = rec.signalType.includes("buy")
        ? ((currentPrice - rec.entryPrice) / rec.entryPrice) * 100
        : ((rec.entryPrice - currentPrice) / rec.entryPrice) * 100;
      rec.pnlPct = pnlPct;
      
      // Max excursions
      if (highSincEntry && lowSinceEntry) {
        rec.maxFavorable = rec.signalType.includes("buy")
          ? ((highSincEntry - rec.entryPrice) / rec.entryPrice) * 100
          : ((rec.entryPrice - lowSinceEntry) / rec.entryPrice) * 100;
        rec.maxAdverse = rec.signalType.includes("buy")
          ? ((rec.entryPrice - lowSinceEntry) / rec.entryPrice) * 100
          : ((highSincEntry - rec.entryPrice) / rec.entryPrice) * 100;
      }
      
      // Check target/stop
      if (rec.targetPrice) {
        rec.hitTarget = rec.signalType.includes("buy")
          ? currentPrice >= rec.targetPrice
          : currentPrice <= rec.targetPrice;
      }
      if (rec.stopPrice) {
        rec.hitStop = rec.signalType.includes("buy")
          ? currentPrice <= rec.stopPrice
          : currentPrice >= rec.stopPrice;
      }
      
      // Grade
      if (pnlPct > 3) rec.grade = "A";
      else if (pnlPct > 1) rec.grade = "B";
      else if (pnlPct > 0) rec.grade = "C";
      else if (pnlPct > -1) rec.grade = "D";
      else rec.grade = "F";
      
      changed = true;
    }
  }
  
  if (changed) saveSignalReplays(records);
}

export function getSignalReplayStats(): {
  totalSignals: number;
  avgGrade: string;
  gradeDistribution: Record<string, number>;
  avgPnlPct: number;
  bestSetup: string;
  worstSetup: string;
  byRegime: Record<string, { count: number; avgPnl: number; winRate: number }>;
  bySignalType: Record<string, { count: number; avgPnl: number; winRate: number }>;
} {
  const records = loadSignalReplays().filter(r => r.resolvedAt);
  const gradeDistribution: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, F: 0 };
  const byRegime: Record<string, { count: number; totalPnl: number; wins: number }> = {};
  const bySignalType: Record<string, { count: number; totalPnl: number; wins: number }> = {};
  
  let totalPnl = 0;
  let bestPnl = -Infinity, worstPnl = Infinity;
  let bestSetup = "", worstSetup = "";
  
  for (const rec of records) {
    if (rec.grade) gradeDistribution[rec.grade] = (gradeDistribution[rec.grade] || 0) + 1;
    const pnl = rec.pnlPct || 0;
    totalPnl += pnl;
    
    if (pnl > bestPnl) { bestPnl = pnl; bestSetup = `${rec.signalType} ${rec.symbol} +${pnl.toFixed(1)}%`; }
    if (pnl < worstPnl) { worstPnl = pnl; worstSetup = `${rec.signalType} ${rec.symbol} ${pnl.toFixed(1)}%`; }
    
    // By regime
    const regime = rec.regime || "unknown";
    if (!byRegime[regime]) byRegime[regime] = { count: 0, totalPnl: 0, wins: 0 };
    byRegime[regime].count++;
    byRegime[regime].totalPnl += pnl;
    if (pnl > 0) byRegime[regime].wins++;
    
    // By signal type
    if (!bySignalType[rec.signalType]) bySignalType[rec.signalType] = { count: 0, totalPnl: 0, wins: 0 };
    bySignalType[rec.signalType].count++;
    bySignalType[rec.signalType].totalPnl += pnl;
    if (pnl > 0) bySignalType[rec.signalType].wins++;
  }
  
  // Compute avg grade
  const gradeValues: Record<string, number> = { A: 4, B: 3, C: 2, D: 1, F: 0 };
  let gradeSum = 0, gradeCount = 0;
  for (const [g, count] of Object.entries(gradeDistribution)) {
    gradeSum += (gradeValues[g] || 0) * count;
    gradeCount += count;
  }
  const avgGradeVal = gradeCount > 0 ? gradeSum / gradeCount : 2;
  const avgGrade = avgGradeVal >= 3.5 ? "A" : avgGradeVal >= 2.5 ? "B" : avgGradeVal >= 1.5 ? "C" : avgGradeVal >= 0.5 ? "D" : "F";
  
  const formatRegime = (data: Record<string, { count: number; totalPnl: number; wins: number }>) => {
    const result: Record<string, { count: number; avgPnl: number; winRate: number }> = {};
    for (const [key, v] of Object.entries(data)) {
      result[key] = { count: v.count, avgPnl: v.count > 0 ? v.totalPnl / v.count : 0, winRate: v.count > 0 ? v.wins / v.count : 0 };
    }
    return result;
  };
  
  return {
    totalSignals: records.length,
    avgGrade,
    gradeDistribution,
    avgPnlPct: records.length > 0 ? totalPnl / records.length : 0,
    bestSetup: bestSetup || "N/A",
    worstSetup: worstSetup || "N/A",
    byRegime: formatRegime(byRegime),
    bySignalType: formatRegime(bySignalType),
  };
}

// ─── Regime-Specific Strategy Selection ───
// Automatically switch between mean-reversion and momentum based on detected regime

export type StrategyMode = "momentum" | "mean_reversion" | "breakout" | "conservative";

export function selectStrategyForRegime(
  regime: string,
  volatility: number,
  trendStrength: number
): { mode: StrategyMode; reason: string; adjustments: { confAdj: number; rrAdj: number; sizeAdj: number } } {
  // Trending market → momentum/breakout
  if (regime === "trending_up" || regime === "trending_down") {
    if (trendStrength > 70) {
      return {
        mode: "breakout",
        reason: `Strong ${regime} (${trendStrength}%) — breakout strategy with trend`,
        adjustments: { confAdj: -5, rrAdj: 0.5, sizeAdj: 1.15 },
      };
    }
    return {
      mode: "momentum",
      reason: `${regime} detected — momentum following`,
      adjustments: { confAdj: -3, rrAdj: 0.3, sizeAdj: 1.1 },
    };
  }
  
  // Choppy/ranging → mean reversion
  if (regime === "choppy" || regime === "ranging") {
    return {
      mode: "mean_reversion",
      reason: `${regime} market — switching to mean reversion at extremes`,
      adjustments: { confAdj: 8, rrAdj: -0.3, sizeAdj: 0.7 },
    };
  }
  
  // High volatility → conservative
  if (regime === "high_volatility" || regime === "volatile_expansion") {
    return {
      mode: "conservative",
      reason: "High volatility — conservative positioning with wider stops",
      adjustments: { confAdj: 12, rrAdj: 0, sizeAdj: 0.5 },
    };
  }
  
  // Default
  return {
    mode: "momentum",
    reason: "Normal conditions — standard momentum strategy",
    adjustments: { confAdj: 0, rrAdj: 0, sizeAdj: 1.0 },
  };
}

// ─── Multi-Timeframe Confluence Scoring (Enhanced) ───
// Requires 2+ timeframes to agree for a valid signal

export interface MTFConfluence {
  score: number;           // -100 to 100
  agreementLevel: number;  // 0-100 %
  dominantBias: "bullish" | "bearish" | "neutral";
  timeframes: Array<{ tf: string; bias: string; strength: number }>;
  isValid: boolean;        // At least 2 TFs agree
  confidenceBoost: number;
}

export function computeMTFConfluence(
  klines: Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }>
): MTFConfluence {
  if (klines.length < 20) {
    return { score: 0, agreementLevel: 0, dominantBias: "neutral", timeframes: [], isValid: false, confidenceBoost: 0 };
  }
  
  const closes = klines.map(k => k.close);
  const emaCalc = (data: number[], period: number) => {
    const k = 2 / (period + 1);
    let e = data[0];
    for (let i = 1; i < data.length; i++) e = data[i] * k + e * (1 - k);
    return e;
  };
  
  const analyzeTF = (data: number[], label: string) => {
    if (data.length < 5) return { tf: label, bias: "neutral" as const, strength: 0 };
    const ema9 = emaCalc(data, Math.min(9, data.length));
    const ema21 = emaCalc(data, Math.min(21, data.length));
    const price = data[data.length - 1];
    const roc = data.length >= 5 ? ((price - data[data.length - 5]) / data[data.length - 5]) * 100 : 0;
    
    let score = 0;
    if (price > ema9) score += 1;
    if (ema9 > ema21) score += 1;
    if (roc > 0.3) score += 1;
    if (roc < -0.3) score -= 1;
    if (price < ema9) score -= 1;
    if (ema9 < ema21) score -= 1;
    
    const bias = score >= 2 ? "bullish" : score <= -2 ? "bearish" : "neutral";
    return { tf: label, bias, strength: Math.min(100, Math.abs(score) * 30) };
  };
  
  // Resample to different timeframes
  const tf5m = analyzeTF(closes, "5m");
  const tf15m = analyzeTF(closes.filter((_, i) => i % 3 === 0), "15m");
  const hourly = closes.filter((_, i) => i % 12 === 0);
  const tf1h = analyzeTF(hourly.length >= 5 ? hourly : closes.filter((_, i) => i % 6 === 0), "1h");
  
  const timeframes = [tf5m, tf15m, tf1h];
  const bullish = timeframes.filter(t => t.bias === "bullish").length;
  const bearish = timeframes.filter(t => t.bias === "bearish").length;
  
  let score = 0;
  let dominantBias: "bullish" | "bearish" | "neutral" = "neutral";
  let confidenceBoost = 0;
  let isValid = false;
  
  if (bullish >= 2 && bearish === 0) {
    dominantBias = "bullish";
    score = bullish === 3 ? 80 : 55;
    confidenceBoost = bullish === 3 ? 12 : 6;
    isValid = true;
  } else if (bearish >= 2 && bullish === 0) {
    dominantBias = "bearish";
    score = -(bearish === 3 ? 80 : 55);
    confidenceBoost = bearish === 3 ? 12 : 6;
    isValid = true;
  } else if (bullish > 0 && bearish > 0) {
    confidenceBoost = -8; // Conflicting — penalize
  }
  
  const agreementLevel = Math.max(bullish, bearish) / timeframes.length * 100;
  
  return { score, agreementLevel, dominantBias, timeframes, isValid, confidenceBoost };
}

// ─── Correlation-Aware Portfolio Limits ───

const CORRELATION_MATRIX: Record<string, string[]> = {
  mega_tech: ["AAPL", "MSFT", "GOOGL", "META", "AMZN"],
  semiconductors: ["NVDA", "AMD", "AVGO", "QCOM", "MRVL", "MU", "INTC", "AMAT", "LRCX", "KLAC", "ARM", "SMCI"],
  ev_auto: ["TSLA", "RIVN", "LCID"],
  banks: ["JPM", "BAC", "WFC", "C", "GS", "MS"],
  payments: ["V", "MA", "PYPL", "SQ", "AFRM"],
  cloud_saas: ["CRM", "NOW", "SNOW", "WDAY", "TEAM"],
  cybersecurity: ["PANW", "CRWD", "ZS", "FTNT"],
  oil_gas: ["XOM", "CVX", "COP", "SLB", "EOG", "OXY"],
  pharma: ["JNJ", "PFE", "MRK", "ABBV", "BMY", "LLY"],
  defense: ["RTX", "LMT", "GD", "NOC", "BA"],
  retail: ["WMT", "TGT", "COST", "HD", "LOW"],
  crypto_adj: ["COIN", "MSTR", "HOOD"],
  airlines: ["DAL", "UAL", "LUV"],
};

export function checkCorrelationLimit(
  symbol: string,
  existingPositions: Array<{ symbol: string; side: string }>,
  maxPerGroup: number = 1
): { allowed: boolean; group: string | null; reason: string; conflictingSymbols: string[] } {
  const cleanSym = symbol.replace("USDT", "");
  
  for (const [group, members] of Object.entries(CORRELATION_MATRIX)) {
    if (!members.includes(cleanSym)) continue;
    
    const conflicting = existingPositions.filter(p => {
      const s = p.symbol.replace("USDT", "");
      return members.includes(s) && s !== cleanSym;
    });
    
    if (conflicting.length >= maxPerGroup) {
      return {
        allowed: false,
        group,
        reason: `Correlation limit: ${cleanSym} blocked — already holding ${conflicting.map(c => c.symbol.replace("USDT", "")).join(", ")} in ${group} group`,
        conflictingSymbols: conflicting.map(c => c.symbol),
      };
    }
  }
  
  return { allowed: true, group: null, reason: "", conflictingSymbols: [] };
}

// ─── News Sentiment Signal Weight ───

export function applyNewsSentimentWeight(
  confidence: number,
  signalDirection: "buy" | "sell",
  sentimentScore: number // -1 to 1
): { adjustedConfidence: number; reason: string } {
  // Strong disagreement: signal says buy but news is very negative (or vice versa)
  if (signalDirection === "buy" && sentimentScore < -0.3) {
    const penalty = Math.abs(sentimentScore) * 15;
    return {
      adjustedConfidence: Math.max(20, confidence - penalty),
      reason: `News conflicts with buy signal (-${penalty.toFixed(0)}% conf)`,
    };
  }
  if (signalDirection === "sell" && sentimentScore > 0.3) {
    const penalty = Math.abs(sentimentScore) * 15;
    return {
      adjustedConfidence: Math.max(20, confidence - penalty),
      reason: `News conflicts with sell signal (-${penalty.toFixed(0)}% conf)`,
    };
  }
  // Agreement: boost
  if ((signalDirection === "buy" && sentimentScore > 0.3) ||
      (signalDirection === "sell" && sentimentScore < -0.3)) {
    const boost = Math.abs(sentimentScore) * 8;
    return {
      adjustedConfidence: Math.min(95, confidence + boost),
      reason: `News confirms ${signalDirection} signal (+${boost.toFixed(0)}% conf)`,
    };
  }
  return { adjustedConfidence: confidence, reason: "" };
}

// ─── Edge Function Cache Layer ───
// Client-side cache for AI analysis results

const AI_CACHE_KEY = "neuraltrade_ai_cache";
const AI_CACHE_TTL = 60_000; // 60 seconds

interface CachedAnalysis {
  symbol: string;
  data: any;
  timestamp: number;
}

export function getCachedAnalysis(symbol: string): any | null {
  try {
    const raw = localStorage.getItem(AI_CACHE_KEY);
    if (!raw) return null;
    const cache: CachedAnalysis[] = JSON.parse(raw);
    const entry = cache.find(c => c.symbol === symbol && Date.now() - c.timestamp < AI_CACHE_TTL);
    return entry?.data || null;
  } catch { return null; }
}

export function setCachedAnalysis(symbol: string, data: any) {
  try {
    const raw = localStorage.getItem(AI_CACHE_KEY);
    let cache: CachedAnalysis[] = raw ? JSON.parse(raw) : [];
    // Remove old entries for this symbol and expired entries
    cache = cache.filter(c => c.symbol !== symbol && Date.now() - c.timestamp < AI_CACHE_TTL);
    cache.push({ symbol, data, timestamp: Date.now() });
    // Keep max 50 entries
    if (cache.length > 50) cache = cache.slice(-50);
    localStorage.setItem(AI_CACHE_KEY, JSON.stringify(cache));
  } catch { }
}

// ─── Composite Signal Quality Score ───

export interface CompositeSignalQuality {
  overallScore: number;       // 0-100
  grade: "A+" | "A" | "B" | "C" | "D" | "F";
  components: {
    mtfConfluence: number;
    volumeProfile: number;
    signalFreshness: number;
    regimeFit: number;
    newsSentiment: number;
  };
  recommendation: string;
}

export function computeCompositeQuality(
  mtfScore: number,
  volumeWeight: number,
  freshness: number,
  regimeConfAdj: number,
  newsWeight: number
): CompositeSignalQuality {
  const mtfNorm = Math.min(100, Math.abs(mtfScore));
  const volNorm = volumeWeight * 100;
  const regimeNorm = Math.max(0, 100 - Math.abs(regimeConfAdj) * 5);
  const newsNorm = (newsWeight + 1) * 50; // -1 to 1 → 0 to 100
  
  const overall = (mtfNorm * 0.3 + volNorm * 0.2 + freshness * 0.2 + regimeNorm * 0.15 + newsNorm * 0.15);
  
  let grade: CompositeSignalQuality["grade"];
  if (overall >= 85) grade = "A+";
  else if (overall >= 70) grade = "A";
  else if (overall >= 55) grade = "B";
  else if (overall >= 40) grade = "C";
  else if (overall >= 25) grade = "D";
  else grade = "F";
  
  const recommendation = grade === "A+" || grade === "A"
    ? "High conviction — full size"
    : grade === "B"
    ? "Moderate conviction — standard size"
    : grade === "C"
    ? "Low conviction — reduced size"
    : "Weak signal — skip or paper trade only";
  
  return {
    overallScore: Math.round(overall),
    grade,
    components: {
      mtfConfluence: Math.round(mtfNorm),
      volumeProfile: Math.round(volNorm),
      signalFreshness: Math.round(freshness),
      regimeFit: Math.round(regimeNorm),
      newsSentiment: Math.round(newsNorm),
    },
    recommendation,
  };
}
