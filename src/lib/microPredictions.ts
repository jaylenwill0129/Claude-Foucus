// Advanced Short-Term Micro Prediction Engine v3
// Multi-indicator confluence with Stochastic RSI, OBV, Fibonacci, VWAP proxy,
// trend persistence, order flow imbalance, prediction accuracy tracking,
// and intelligent confidence calibration.

import {
  applyPredictionIntelligence, extractActiveIndicators,
  type PredictionIntelligenceResult,
} from "@/lib/predictionIntelligence";
import {
  getLearnedScoreAdjustment, getLearnedConfidenceAdjustment,
  invalidateFeedbackCache, type IndicatorSnapshot,
} from "@/lib/predictionFeedback";

export interface MicroIndicators {
  microRsi: number;
  stochRsi: number;          // Stochastic RSI (0-100)
  macdSignal: "bullish" | "bearish" | "neutral";
  macdHistogram: number;     // Raw histogram value
  bbPosition: "upper" | "middle" | "lower";
  bbWidth: number;           // BB squeeze detection (0-1 normalized)
  volumeProfile: "surge" | "normal" | "dry";
  volumeRatio: number;       // Raw ratio
  ema3vs8: "golden" | "death" | "flat";
  ema9vs21: "golden" | "death" | "flat";
  priceAccel: number;
  obvTrend: "rising" | "falling" | "flat"; // On-Balance Volume
  trendPersistence: number;  // Consecutive same-direction candles
  fibLevel: string;          // Nearest fib level name
  fibDistance: number;       // % distance to nearest fib
  vwapPosition: "above" | "below" | "at"; // Price vs VWAP proxy
  orderFlowBias: number;     // -100 to 100, buy vs sell pressure
  candlePattern: string | null; // Detected pattern name
}

export interface ShortTermPrediction {
  timeframe: string;
  seconds: number;
  direction: "up" | "down" | "flat";
  target_price: number;
  target_high: number;
  target_low: number;
  confidence: number;
  strength: number; // -100 to 100
  indicators: MicroIndicators;
  reasoning: string[];
  generatedAt: number;
  signalQuality: "A+" | "A" | "B" | "C" | "D"; // Grade
  intelligence?: PredictionIntelligenceResult;
}

// ─── Indicator Computation Functions ───

function computeRSI(closes: number[], period: number): number {
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function computeStochRSI(closes: number[], rsiPeriod: number = 14, stochPeriod: number = 14): number {
  if (closes.length < rsiPeriod + stochPeriod + 1) return 50;
  // Calculate RSI series
  const rsiSeries: number[] = [];
  for (let end = rsiPeriod + 1; end <= closes.length; end++) {
    rsiSeries.push(computeRSI(closes.slice(0, end), rsiPeriod));
  }
  if (rsiSeries.length < stochPeriod) return 50;
  const recent = rsiSeries.slice(-stochPeriod);
  const minRsi = Math.min(...recent);
  const maxRsi = Math.max(...recent);
  if (maxRsi - minRsi === 0) return 50;
  return ((rsiSeries[rsiSeries.length - 1] - minRsi) / (maxRsi - minRsi)) * 100;
}

function computeMACD(closes: number[]): { macd: number; signal: number; histogram: number } {
  const emaCalc = (data: number[], period: number) => {
    const k = 2 / (period + 1);
    let ema = data[0];
    for (let i = 1; i < data.length; i++) ema = data[i] * k + ema * (1 - k);
    return ema;
  };
  const ema12 = emaCalc(closes, 12);
  const ema26 = emaCalc(closes, 26);
  const macdLine = ema12 - ema26;
  const recentMacds: number[] = [];
  let e12 = closes[0], e26 = closes[0];
  const k12 = 2 / 13, k26 = 2 / 27;
  for (const c of closes) {
    e12 = c * k12 + e12 * (1 - k12);
    e26 = c * k26 + e26 * (1 - k26);
    recentMacds.push(e12 - e26);
  }
  const signalLine = emaCalc(recentMacds.slice(-9), 9);
  return { macd: macdLine, signal: signalLine, histogram: macdLine - signalLine };
}

function computeEMA(data: number[], period: number): number {
  const k = 2 / (period + 1);
  let ema = data[0];
  for (const d of data) ema = d * k + ema * (1 - k);
  return ema;
}

function computeOBVTrend(klines: Array<{ close: number; volume: number }>): "rising" | "falling" | "flat" {
  if (klines.length < 5) return "flat";
  const recent = klines.slice(-10);
  let obv = 0;
  const obvSeries: number[] = [0];
  for (let i = 1; i < recent.length; i++) {
    if (recent[i].close > recent[i - 1].close) obv += recent[i].volume;
    else if (recent[i].close < recent[i - 1].close) obv -= recent[i].volume;
    obvSeries.push(obv);
  }
  // Simple linear regression slope on OBV
  const n = obvSeries.length;
  const xMean = (n - 1) / 2;
  const yMean = obvSeries.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (obvSeries[i] - yMean);
    den += (i - xMean) ** 2;
  }
  const slope = den !== 0 ? num / den : 0;
  const normalized = slope / (Math.abs(yMean) + 1);
  if (normalized > 0.05) return "rising";
  if (normalized < -0.05) return "falling";
  return "flat";
}

function computeTrendPersistence(closes: number[]): number {
  if (closes.length < 2) return 0;
  let count = 0;
  const lastDir = closes[closes.length - 1] >= closes[closes.length - 2] ? 1 : -1;
  for (let i = closes.length - 1; i >= 1; i--) {
    const dir = closes[i] >= closes[i - 1] ? 1 : -1;
    if (dir === lastDir) count++;
    else break;
  }
  return count * lastDir; // positive = consecutive up, negative = consecutive down
}

function computeVWAP(klines: Array<{ high: number; low: number; close: number; volume: number }>): number {
  let cumTPV = 0, cumVol = 0;
  for (const k of klines) {
    const tp = (k.high + k.low + k.close) / 3;
    cumTPV += tp * k.volume;
    cumVol += k.volume;
  }
  return cumVol > 0 ? cumTPV / cumVol : klines[klines.length - 1]?.close || 0;
}

function computeFibLevels(high: number, low: number): { name: string; price: number }[] {
  const range = high - low;
  return [
    { name: "0%", price: low },
    { name: "23.6%", price: low + range * 0.236 },
    { name: "38.2%", price: low + range * 0.382 },
    { name: "50%", price: low + range * 0.5 },
    { name: "61.8%", price: low + range * 0.618 },
    { name: "78.6%", price: low + range * 0.786 },
    { name: "100%", price: high },
  ];
}

function computeOrderFlowBias(klines: Array<{ open: number; high: number; low: number; close: number; volume: number }>): number {
  // Approximation using candle body vs wick ratios weighted by volume
  if (klines.length < 3) return 0;
  const recent = klines.slice(-5);
  let buyPressure = 0, sellPressure = 0;
  for (const k of recent) {
    const body = Math.abs(k.close - k.open);
    const totalRange = k.high - k.low;
    if (totalRange === 0) continue;
    const bodyRatio = body / totalRange;
    if (k.close >= k.open) {
      // Bullish: upper wick shows selling, lower wick shows buying
      const lowerWick = Math.min(k.open, k.close) - k.low;
      buyPressure += (bodyRatio * 0.6 + (lowerWick / totalRange) * 0.4) * k.volume;
      sellPressure += ((k.high - Math.max(k.open, k.close)) / totalRange) * k.volume;
    } else {
      const upperWick = k.high - Math.max(k.open, k.close);
      sellPressure += (bodyRatio * 0.6 + (upperWick / totalRange) * 0.4) * k.volume;
      buyPressure += ((Math.min(k.open, k.close) - k.low) / totalRange) * k.volume;
    }
  }
  const total = buyPressure + sellPressure;
  if (total === 0) return 0;
  return Math.round(((buyPressure - sellPressure) / total) * 100);
}

function detectCandlePattern(klines: Array<{ open: number; high: number; low: number; close: number }>): string | null {
  if (klines.length < 3) return null;
  const last = klines[klines.length - 1];
  const prev = klines[klines.length - 2];
  const body = Math.abs(last.close - last.open);
  const range = last.high - last.low;
  if (range === 0) return null;
  const bodyRatio = body / range;
  const isGreen = last.close >= last.open;
  const lowerWick = Math.min(last.open, last.close) - last.low;
  const upperWick = last.high - Math.max(last.open, last.close);

  // Hammer / Inverted Hammer
  if (bodyRatio < 0.3 && lowerWick > body * 2 && upperWick < body * 0.5) {
    return prev.close > prev.open ? "Hammer" : "Hanging Man";
  }
  if (bodyRatio < 0.3 && upperWick > body * 2 && lowerWick < body * 0.5) {
    return "Inverted Hammer";
  }

  // Doji
  if (bodyRatio < 0.1) return "Doji";

  // Engulfing
  const prevBody = Math.abs(prev.close - prev.open);
  if (body > prevBody * 1.5) {
    if (isGreen && prev.close < prev.open) return "Bullish Engulfing";
    if (!isGreen && prev.close > prev.open) return "Bearish Engulfing";
  }

  // Marubozu (strong conviction)
  if (bodyRatio > 0.85) return isGreen ? "Bullish Marubozu" : "Bearish Marubozu";

  return null;
}

// ─── Prediction Accuracy Tracker (localStorage) ───

const PRED_HISTORY_KEY = "micro_pred_accuracy";
const MAX_HISTORY = 200;

function loadPredHistory(): PredictionRecord[] {
  try {
    const raw = localStorage.getItem(PRED_HISTORY_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as PredictionRecord[];
  } catch { return []; }
}

function savePredHistory(records: PredictionRecord[]) {
  try {
    localStorage.setItem(PRED_HISTORY_KEY, JSON.stringify(records.slice(-MAX_HISTORY)));
  } catch { /* quota */ }
}

interface PredictionRecord {
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

export function recordPrediction(pred: ShortTermPrediction, currentPrice: number) {
  const records = loadPredHistory();
  records.push({
    id: `${Date.now()}-${pred.timeframe}`,
    timeframe: pred.timeframe,
    direction: pred.direction,
    predictedPrice: pred.target_price,
    startPrice: currentPrice,
    targetHigh: pred.target_high,
    targetLow: pred.target_low,
    confidence: pred.confidence,
    createdAt: pred.generatedAt,
    hit: null,
    directionHit: null,
    targetHit: null,
    indicators: pred.indicators as IndicatorSnapshot,
    regime: pred.intelligence?.regime,
    score: pred.strength,
  });
  savePredHistory(records);
}

export function resolvePredictions(currentPrice: number) {
  const records = loadPredHistory();
  const now = Date.now();
  let changed = false;
  for (const rec of records) {
    if (rec.hit !== null) continue;
    const tfSeconds = rec.timeframe === "1 min" ? 60 : rec.timeframe === "2 min" ? 120 : rec.timeframe === "5 min" ? 300 : rec.timeframe === "10 min" ? 600 : 60;
    if (now - rec.createdAt > tfSeconds * 1000 + 10000) {
      rec.actualPrice = currentPrice;
      rec.resolvedAt = now;
      
      const startPrice = rec.startPrice || rec.predictedPrice;
      const actualMove = currentPrice - startPrice;
      const predictedMove = rec.predictedPrice - startPrice;
      
      // Direction hit: did price move in the predicted direction?
      if (rec.direction === "flat") {
        rec.directionHit = Math.abs(actualMove) / startPrice < 0.002;
      } else {
        rec.directionHit = rec.direction === "up" ? actualMove > 0 : actualMove < 0;
      }
      
      // Target hit: did price reach within the predicted range?
      const high = rec.targetHigh || rec.predictedPrice * 1.001;
      const low = rec.targetLow || rec.predictedPrice * 0.999;
      rec.targetHit = currentPrice >= low && currentPrice <= high;
      
      // Overall hit: direction correct (primary metric)
      rec.hit = rec.directionHit;
      changed = true;
    }
  }
  if (changed) {
    savePredHistory(records);
    invalidateFeedbackCache(); // Re-analyze with new outcomes
  }
}

export function getPredictionAccuracy(): { 
  total: number; hits: number; rate: number; 
  directionHits: number; directionRate: number;
  targetHits: number; targetRate: number;
  byTimeframe: Record<string, { total: number; hits: number; rate: number; directionRate: number; targetRate: number }>;
  recentTrend: number; // Last 10 predictions hit rate
} {
  const records = loadPredHistory().filter(r => r.hit !== null);
  const hits = records.filter(r => r.hit === true).length;
  const directionHits = records.filter(r => r.directionHit === true).length;
  const targetHits = records.filter(r => r.targetHit === true).length;
  const total = records.length;

  const byTimeframe: Record<string, { total: number; hits: number; rate: number; directionRate: number; targetRate: number }> = {};
  for (const r of records) {
    if (!byTimeframe[r.timeframe]) byTimeframe[r.timeframe] = { total: 0, hits: 0, rate: 0, directionRate: 0, targetRate: 0 };
    byTimeframe[r.timeframe].total++;
    if (r.hit) byTimeframe[r.timeframe].hits++;
  }
  // Count direction/target per timeframe
  for (const r of records) {
    if (r.directionHit) byTimeframe[r.timeframe].directionRate++;
    if (r.targetHit) byTimeframe[r.timeframe].targetRate++;
  }
  for (const tf of Object.keys(byTimeframe)) {
    const t = byTimeframe[tf];
    t.rate = t.total > 0 ? Math.round((t.hits / t.total) * 100) : 0;
    t.directionRate = t.total > 0 ? Math.round((t.directionRate / t.total) * 100) : 0;
    t.targetRate = t.total > 0 ? Math.round((t.targetRate / t.total) * 100) : 0;
  }

  // Recent trend (last 10)
  const recent10 = records.slice(-10);
  const recentHits = recent10.filter(r => r.hit).length;
  const recentTrend = recent10.length > 0 ? Math.round((recentHits / recent10.length) * 100) : 0;

  return {
    total,
    hits,
    rate: total > 0 ? Math.round((hits / total) * 100) : 0,
    directionHits,
    directionRate: total > 0 ? Math.round((directionHits / total) * 100) : 0,
    targetHits,
    targetRate: total > 0 ? Math.round((targetHits / total) * 100) : 0,
    byTimeframe,
    recentTrend,
  };
}

// ─── Main Prediction Generator ───

// Get accuracy-based weights for each indicator category from prediction history
function getIndicatorAccuracyWeights(): Record<string, number> {
  const records = loadPredHistory().filter(r => r.hit !== null && r.indicators);
  if (records.length < 15) return {}; // Not enough data
  const cats: Record<string, { wins: number; total: number }> = {};
  for (const r of records) {
    const ind = r.indicators as any;
    if (!ind) continue;
    const isWin = r.directionHit === true;
    const add = (cat: string, active: boolean) => {
      if (!active) return;
      if (!cats[cat]) cats[cat] = { wins: 0, total: 0 };
      cats[cat].total++;
      if (isWin) cats[cat].wins++;
    };
    add("ema", ind.ema3vs8 !== "flat" || ind.ema9vs21 !== "flat");
    add("rsi", ind.microRsi > 65 || ind.microRsi < 35);
    add("macd", ind.macdSignal !== "neutral");
    add("bb", ind.bbPosition !== "middle");
    add("volume", ind.volumeProfile !== "normal");
    add("obv", ind.obvTrend !== "flat");
    add("vwap", ind.vwapPosition !== "at");
    add("accel", Math.abs(ind.priceAccel) > 2);
    add("flow", Math.abs(ind.orderFlowBias) > 20);
    add("candle", !!ind.candlePattern);
    add("trend", true);
  }
  const weights: Record<string, number> = {};
  for (const [cat, s] of Object.entries(cats)) {
    if (s.total < 5) continue;
    const wr = s.wins / s.total;
    weights[cat] = Math.max(0.5, Math.min(1.8, 0.4 + wr * 2));
  }
  return weights;
}

export function generateShortTermPredictions(
  klines: Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }>,
  currentPrice: number,
  sectorChangePct?: number,
): ShortTermPrediction[] {
  if (klines.length < 20) return [];
  const recent = klines.slice(-30);
  const closes = recent.map(k => k.close);
  const volumes = recent.map(k => k.volume);
  const now = Date.now();

  // ─── Indicators ───
  const microRsi = computeRSI(closes, 7);
  const stochRsi = computeStochRSI(closes, 7, 7);

  const { macd, signal: macdSig, histogram: macdHist } = computeMACD(closes);
  const macdSignal: "bullish" | "bearish" | "neutral" =
    macdHist > 0 && macd > macdSig ? "bullish" :
    macdHist < 0 && macd < macdSig ? "bearish" : "neutral";

  // Bollinger Bands
  const bb20 = closes.slice(-20);
  const bbMean = bb20.reduce((a, b) => a + b, 0) / bb20.length;
  const bbStd = Math.sqrt(bb20.reduce((s, v) => s + (v - bbMean) ** 2, 0) / bb20.length);
  const bbUpper = bbMean + 2 * bbStd;
  const bbLower = bbMean - 2 * bbStd;
  const bbPosition: "upper" | "middle" | "lower" =
    currentPrice > bbUpper - bbStd * 0.5 ? "upper" :
    currentPrice < bbLower + bbStd * 0.5 ? "lower" : "middle";
  const bbWidth = bbStd > 0 ? (bbUpper - bbLower) / bbMean : 0; // Squeeze detection

  // Volume
  const avgVol = volumes.reduce((a, b) => a + b, 0) / volumes.length;
  const lastVol = volumes[volumes.length - 1];
  const volRatio = lastVol / avgVol;
  const volumeProfile: "surge" | "normal" | "dry" =
    volRatio > 1.8 ? "surge" : volRatio < 0.5 ? "dry" : "normal";

  // EMAs
  const ema3 = computeEMA(closes, 3);
  const ema8 = computeEMA(closes, 8);
  const ema9 = computeEMA(closes, 9);
  const ema21 = computeEMA(closes, 21);
  const ema3vs8: "golden" | "death" | "flat" =
    ema3 > ema8 * 1.001 ? "golden" : ema3 < ema8 * 0.999 ? "death" : "flat";
  const ema9vs21: "golden" | "death" | "flat" =
    ema9 > ema21 * 1.001 ? "golden" : ema9 < ema21 * 0.999 ? "death" : "flat";

  // Price acceleration
  const roc1 = closes.length >= 3 ? (closes[closes.length - 1] - closes[closes.length - 2]) / closes[closes.length - 2] : 0;
  const roc2 = closes.length >= 4 ? (closes[closes.length - 2] - closes[closes.length - 3]) / closes[closes.length - 3] : 0;
  const priceAccel = (roc1 - roc2) * 10000;

  // OBV
  const obvTrend = computeOBVTrend(recent);

  // Trend Persistence
  const trendPersistence = computeTrendPersistence(closes);

  // VWAP
  const vwap = computeVWAP(recent);
  const vwapPosition: "above" | "below" | "at" =
    currentPrice > vwap * 1.001 ? "above" : currentPrice < vwap * 0.999 ? "below" : "at";

  // Fibonacci
  const swingHigh = Math.max(...recent.slice(-15).map(k => k.high));
  const swingLow = Math.min(...recent.slice(-15).map(k => k.low));
  const fibs = computeFibLevels(swingHigh, swingLow);
  let nearestFib = fibs[0];
  let minFibDist = Infinity;
  for (const f of fibs) {
    const dist = Math.abs(currentPrice - f.price);
    if (dist < minFibDist) { minFibDist = dist; nearestFib = f; }
  }
  const fibDistance = (minFibDist / currentPrice) * 100;

  // Order Flow
  const orderFlowBias = computeOrderFlowBias(recent);

  // Candlestick Pattern
  const candlePattern = detectCandlePattern(recent);

  // Micro ATR
  let microAtr = 0;
  for (let i = recent.length - 5; i < recent.length; i++) {
    microAtr += recent[i].high - recent[i].low;
  }
  microAtr /= 5;

  // Micro trend
  const last5 = closes.slice(-5);
  const microTrend = (last5[last5.length - 1] - last5[0]) / last5[0] * 100;

  // ─── Confluence Scoring (v3 - accuracy-weighted multi-factor) ───
  let score = 0;

  // Get historical accuracy weights for dynamic scoring
  const accWeights = getIndicatorAccuracyWeights();

  // 1. Micro trend (weight: 3, adjusted by historical accuracy)
  const trendW = accWeights["trend"] || 1.0;
  score += microTrend * 3 * trendW;

  // 2. EMA crosses (weight: 12/8 each, accuracy-adjusted)
  const emaW = accWeights["ema"] || 1.0;
  if (ema3vs8 === "golden") score += 12 * emaW; else if (ema3vs8 === "death") score -= 12 * emaW;
  if (ema9vs21 === "golden") score += 8 * emaW; else if (ema9vs21 === "death") score -= 8 * emaW;

  // 3. RSI + Stoch RSI (combined) - accuracy-adjusted
  const rsiW = accWeights["rsi"] || 1.0;
  if (microRsi > 75 && stochRsi > 80) score -= 14 * rsiW; // Strong overbought
  else if (microRsi > 70) score -= 8 * rsiW;
  else if (microRsi < 25 && stochRsi < 20) score += 14 * rsiW; // Strong oversold
  else if (microRsi < 30) score += 8 * rsiW;
  else if (microRsi > 55) score += 4 * rsiW;
  else if (microRsi < 45) score -= 4 * rsiW;

  // 4. MACD (weight: 10, boosted by histogram strength)
  const macdW = accWeights["macd"] || 1.0;
  if (macdSignal === "bullish") score += (10 + Math.min(5, Math.abs(macdHist) * 500)) * macdW;
  else if (macdSignal === "bearish") score -= (10 + Math.min(5, Math.abs(macdHist) * 500)) * macdW;

  // 5. Bollinger Bands (mean reversion signal)
  const bbW = accWeights["bb"] || 1.0;
  if (bbPosition === "lower") score += 6 * bbW;
  else if (bbPosition === "upper") score -= 6 * bbW;
  if (bbWidth < 0.02) score += Math.sign(microTrend) * 5 * bbW;

  // 6. Volume (accuracy-adjusted)
  const volW = accWeights["volume"] || 1.0;
  if (volumeProfile === "surge") score += Math.sign(microTrend) * 10 * volW;
  if (volumeProfile === "dry") score -= Math.sign(score) * 3 * volW;

  // 7. OBV confirmation
  const obvW = accWeights["obv"] || 1.0;
  if (obvTrend === "rising" && score > 0) score += 6 * obvW;
  else if (obvTrend === "falling" && score < 0) score -= 6 * obvW;
  else if ((obvTrend === "rising" && score < 0) || (obvTrend === "falling" && score > 0)) {
    score *= 0.8; // Divergence reduces conviction
  }

  // 8. VWAP position
  const vwapW = accWeights["vwap"] || 1.0;
  if (vwapPosition === "above" && score > 0) score += 4 * vwapW;
  else if (vwapPosition === "below" && score < 0) score -= 4 * vwapW;

  // 9. Price above/below fast EMA
  if (currentPrice > ema3) score += 3; else score -= 3;

  // 10. Price acceleration (capped, accuracy-adjusted)
  const accelW = accWeights["accel"] || 1.0;
  score += Math.max(-12, Math.min(12, priceAccel * 2.5 * accelW));

  // 11. Order flow
  const flowW = accWeights["flow"] || 1.0;
  score += orderFlowBias * 0.15 * flowW;

  // 12. Trend persistence bonus
  if (Math.abs(trendPersistence) >= 3) score += Math.sign(trendPersistence) * 8;
  else if (Math.abs(trendPersistence) >= 2) score += Math.sign(trendPersistence) * 4;

  // 13. Candlestick pattern bonus
  const candleW = accWeights["candle"] || 1.0;
  if (candlePattern) {
    if (candlePattern.includes("Bullish")) score += 7 * candleW;
    else if (candlePattern.includes("Bearish") || candlePattern === "Hanging Man") score -= 7 * candleW;
    else if (candlePattern === "Doji") score *= 0.85;
    else if (candlePattern === "Hammer") score += 5 * candleW;
  }

  // 14. Fibonacci proximity (at key levels, mean reversion)
  if (fibDistance < 0.3) {
    if (nearestFib.name === "38.2%" || nearestFib.name === "61.8%") {
      score += Math.sign(-microTrend) * 4; // Reversal bias near golden ratios
    }
  }

  // 15. Price-to-VWAP distance as reversal signal
  if (vwap > 0) {
    const vwapDistPct = ((currentPrice - vwap) / vwap) * 100;
    if (Math.abs(vwapDistPct) > 1.5) {
      score -= Math.sign(vwapDistPct) * Math.min(6, Math.abs(vwapDistPct) * 2); // Mean reversion toward VWAP
    }
  }

  // 16. Volume-price divergence (price up but volume falling = weak)
  if (microTrend > 0.1 && volumeProfile === "dry") score -= 5;
  if (microTrend < -0.1 && volumeProfile === "dry") score += 3; // Selling on low vol = less conviction

  score = Math.max(-100, Math.min(100, score));

  const indicators: MicroIndicators = {
    microRsi, stochRsi, macdSignal, macdHistogram: macdHist,
    bbPosition, bbWidth, volumeProfile, volumeRatio: volRatio,
    ema3vs8, ema9vs21, priceAccel, obvTrend, trendPersistence,
    fibLevel: nearestFib.name, fibDistance,
    vwapPosition, orderFlowBias, candlePattern,
  };

  // 15. Learned feedback adjustment (from historical prediction analysis)
  const learnedAdj = getLearnedScoreAdjustment(indicators as IndicatorSnapshot);
  if (learnedAdj !== 0) {
    score = Math.max(-100, Math.min(100, score + learnedAdj));
  }

  // Extract active indicators for outcome weighting
  const activeInds = extractActiveIndicators(indicators);

  // ─── Generate predictions for multiple timeframes ───
  const timeframes = [
    { label: "1 min", seconds: 60, mult: 0.12 },
    { label: "2 min", seconds: 120, mult: 0.22 },
    { label: "5 min", seconds: 300, mult: 0.45 },
    { label: "10 min", seconds: 600, mult: 0.75 },
  ];

  return timeframes.map(tf => {
    const moveBase = microAtr * tf.mult * Math.sign(score);
    const volBoost = volumeProfile === "surge" ? 1.4 : volumeProfile === "dry" ? 0.65 : 1;
    const persistenceBoost = Math.abs(trendPersistence) >= 3 ? 1.15 : 1;
    const move = moveBase * volBoost * persistenceBoost;
    const target = parseFloat((currentPrice + move).toFixed(2));
    const uncertainty = microAtr * tf.mult * (0.5 + (1 - Math.abs(score) / 100) * 0.3);
    const targetHigh = parseFloat((target + uncertainty).toFixed(2));
    const targetLow = parseFloat((target - uncertainty).toFixed(2));
    const dir: "up" | "down" | "flat" = Math.abs(score) < 8 ? "flat" : score > 0 ? "up" : "down";

    // Confidence calculation (multi-factor)
    const absScore = Math.abs(score);
    let conf = 35 + absScore * 0.5;
    if (volumeProfile === "surge") conf += 8;
    if (macdSignal !== "neutral") conf += 5;
    if (obvTrend !== "flat" && ((obvTrend === "rising" && score > 0) || (obvTrend === "falling" && score < 0))) conf += 6;
    if (Math.abs(trendPersistence) >= 3) conf += 5;
    if (candlePattern && (candlePattern.includes("Engulfing") || candlePattern.includes("Marubozu"))) conf += 5;
    if (ema3vs8 === ema9vs21 && ema3vs8 !== "flat") conf += 4;
    // Apply learned confidence calibration
    const confCalAdj = getLearnedConfidenceAdjustment(conf);
    conf = Math.min(95, Math.max(20, conf + confCalAdj));

    // Apply prediction intelligence
    const intelligence = applyPredictionIntelligence(
      score, conf, dir, now, tf.seconds,
      activeInds, recent, sectorChangePct,
    );

    // Use intelligence-adjusted values
    const finalConf = intelligence.adjustedConfidence;
    const finalScore = intelligence.adjustedScore;

    // Signal quality grading (on adjusted confidence)
    const grade = finalConf >= 80 ? "A+" : finalConf >= 68 ? "A" : finalConf >= 55 ? "B" : finalConf >= 40 ? "C" : "D";

    // Build reasoning
    const reasons: string[] = [];
    if (Math.abs(microTrend) > 0.05) reasons.push(`Trend ${microTrend > 0 ? "+" : ""}${microTrend.toFixed(2)}%`);
    if (ema3vs8 !== "flat") reasons.push(`EMA3/8 ${ema3vs8}`);
    if (ema9vs21 !== "flat") reasons.push(`EMA9/21 ${ema9vs21}`);
    if (macdSignal !== "neutral") reasons.push(`MACD ${macdSignal} (${macdHist > 0 ? "+" : ""}${(macdHist * 1000).toFixed(1)})`);
    if (microRsi > 65 || microRsi < 35) reasons.push(`RSI ${microRsi.toFixed(0)}`);
    if (stochRsi > 80 || stochRsi < 20) reasons.push(`StochRSI ${stochRsi.toFixed(0)}`);
    if (bbPosition !== "middle") reasons.push(`BB ${bbPosition}`);
    if (bbWidth < 0.02) reasons.push("BB Squeeze");
    if (volumeProfile !== "normal") reasons.push(`Vol ${volumeProfile} (${volRatio.toFixed(1)}x)`);
    if (obvTrend !== "flat") reasons.push(`OBV ${obvTrend}`);
    if (Math.abs(trendPersistence) >= 2) reasons.push(`${Math.abs(trendPersistence)} candles ${trendPersistence > 0 ? "up" : "down"}`);
    if (vwapPosition !== "at") reasons.push(`${vwapPosition} VWAP`);
    if (candlePattern) reasons.push(candlePattern);
    if (fibDistance < 0.5) reasons.push(`Near Fib ${nearestFib.name}`);
    if (Math.abs(orderFlowBias) > 30) reasons.push(`Flow ${orderFlowBias > 0 ? "buy" : "sell"} ${Math.abs(orderFlowBias)}%`);
    if (Math.abs(priceAccel) > 2) reasons.push(`Accel ${priceAccel > 0 ? "+" : ""}${priceAccel.toFixed(1)}bp`);
    // Add intelligence reasons
    reasons.push(...intelligence.reasons);

    return {
      timeframe: tf.label,
      seconds: tf.seconds,
      direction: dir,
      target_price: target,
      target_high: targetHigh,
      target_low: targetLow,
      confidence: finalConf,
      strength: finalScore,
      indicators,
      reasoning: reasons,
      generatedAt: now,
      signalQuality: grade,
      intelligence,
    } as ShortTermPrediction;
  });
}

/**
 * Get the micro-prediction confluence score for auto-trader integration.
 */
export function getMicroPredictionScore(
  klines: Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }>,
  currentPrice: number,
  sectorChangePct?: number,
): { score: number; direction: "up" | "down" | "flat"; confidence: number; reasoning: string[]; regime?: string } {
  const predictions = generateShortTermPredictions(klines, currentPrice, sectorChangePct);
  if (predictions.length === 0) return { score: 0, direction: "flat", confidence: 0, reasoning: [] };
  const primary = predictions[1] || predictions[0];
  return {
    score: primary.strength,
    direction: primary.direction,
    confidence: primary.confidence,
    reasoning: primary.reasoning,
    regime: primary.intelligence?.regime,
  };
}
