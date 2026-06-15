import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ═══════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════

type Kline = { time: number; open: number; high: number; low: number; close: number; volume: number };

function sma(arr: number[], period: number): number {
  if (arr.length === 0) return 0;
  const slice = arr.slice(-Math.min(period, arr.length));
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

function ema(arr: number[], period: number): number {
  if (arr.length === 0) return 0;
  const k = 2 / (period + 1);
  let e = arr[0];
  for (let i = 1; i < arr.length; i++) e = arr[i] * k + e * (1 - k);
  return e;
}

function calcRSI(closes: number[], period = 14): number {
  const n = closes.length;
  const p = Math.min(period, n - 1);
  if (p < 2) return 50;
  let gains = 0, losses = 0;
  for (let i = n - p; i < n; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  const rs = losses > 0 ? (gains / p) / (losses / p) : 100;
  return 100 - (100 / (1 + rs));
}

function calcATR(klines: Kline[], period = 14): number {
  const n = klines.length;
  const p = Math.min(period, n - 1);
  if (p < 1) return 0;
  let sum = 0;
  for (let i = n - p; i < n; i++) {
    const prev = klines[i - 1]?.close || klines[i].open;
    sum += Math.max(klines[i].high - klines[i].low, Math.abs(klines[i].high - prev), Math.abs(klines[i].low - prev));
  }
  return sum / p;
}

function calcStochRSI(closes: number[], period = 14, stochPeriod = 14): number {
  if (closes.length < period + stochPeriod) return 50;
  const rsiValues: number[] = [];
  for (let i = period; i <= closes.length; i++) {
    rsiValues.push(calcRSI(closes.slice(0, i), period));
  }
  const recent = rsiValues.slice(-stochPeriod);
  const min = Math.min(...recent);
  const max = Math.max(...recent);
  const range = max - min;
  return range > 0 ? ((recent[recent.length - 1] - min) / range) * 100 : 50;
}

// ═══════════════════════════════════════════════════════════════
// FIBONACCI LEVELS
// ═══════════════════════════════════════════════════════════════

function calcFibLevels(high: number, low: number, isBullish: boolean): Record<string, number> {
  const diff = high - low;
  if (isBullish) {
    return {
      "0%": low,
      "23.6%": low + diff * 0.236,
      "38.2%": low + diff * 0.382,
      "50%": low + diff * 0.5,
      "61.8%": low + diff * 0.618,
      "78.6%": low + diff * 0.786,
      "100%": high,
      "127.2%": low + diff * 1.272,
      "161.8%": low + diff * 1.618,
    };
  } else {
    return {
      "0%": high,
      "23.6%": high - diff * 0.236,
      "38.2%": high - diff * 0.382,
      "50%": high - diff * 0.5,
      "61.8%": high - diff * 0.618,
      "78.6%": high - diff * 0.786,
      "100%": low,
      "127.2%": high - diff * 1.272,
      "161.8%": high - diff * 1.618,
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// MARKET REGIME DETECTION
// ═══════════════════════════════════════════════════════════════

interface MarketRegime {
  type: "trending_up" | "trending_down" | "ranging" | "choppy" | "volatile_expansion";
  strength: number; // 0-100
  description: string;
  adjustments: { confidenceMultiplier: number; stopMultiplier: number; tpMultiplier: number };
}

function detectMarketRegime(klines: Kline[], closes: number[], atr: number): MarketRegime {
  const n = closes.length;
  if (n < 20) return { type: "ranging", strength: 50, description: "Insufficient data", adjustments: { confidenceMultiplier: 1, stopMultiplier: 1, tpMultiplier: 1 } };

  const price = closes[n - 1];
  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);
  const sma50Val = sma(closes, 50);

  // ADX approximation via directional movement
  let plusDM = 0, minusDM = 0;
  const lookback = Math.min(14, n - 1);
  for (let i = n - lookback; i < n; i++) {
    const upMove = klines[i].high - klines[i - 1].high;
    const downMove = klines[i - 1].low - klines[i].low;
    if (upMove > downMove && upMove > 0) plusDM += upMove;
    if (downMove > upMove && downMove > 0) minusDM += downMove;
  }
  const adxProxy = Math.abs(plusDM - minusDM) / Math.max(plusDM + minusDM, 0.001) * 100;

  // Choppiness index (simplified)
  const atrSum = klines.slice(-14).reduce((s, k, i, arr) => {
    if (i === 0) return s;
    const prev = arr[i - 1].close;
    return s + Math.max(k.high - k.low, Math.abs(k.high - prev), Math.abs(k.low - prev));
  }, 0);
  const range14 = Math.max(...klines.slice(-14).map(k => k.high)) - Math.min(...klines.slice(-14).map(k => k.low));
  const choppiness = range14 > 0 ? (atrSum / range14) * 10 : 50;

  // Volatility expansion check
  const recentATR = calcATR(klines, 5);
  const historicalATR = calcATR(klines, 20);
  const volExpansion = historicalATR > 0 ? recentATR / historicalATR : 1;

  if (volExpansion > 2) {
    return {
      type: "volatile_expansion",
      strength: Math.min(100, volExpansion * 30),
      description: `Volatility expanding ${volExpansion.toFixed(1)}x — widen stops, reduce size`,
      adjustments: { confidenceMultiplier: 0.8, stopMultiplier: 1.5, tpMultiplier: 1.3 },
    };
  }

  if (adxProxy > 40 && price > ema9 && ema9 > ema21) {
    return {
      type: "trending_up",
      strength: Math.min(100, adxProxy),
      description: `Strong uptrend (ADX-proxy ${adxProxy.toFixed(0)}) — trend following preferred`,
      adjustments: { confidenceMultiplier: 1.15, stopMultiplier: 0.9, tpMultiplier: 1.2 },
    };
  }

  if (adxProxy > 40 && price < ema9 && ema9 < ema21) {
    return {
      type: "trending_down",
      strength: Math.min(100, adxProxy),
      description: `Strong downtrend (ADX-proxy ${adxProxy.toFixed(0)}) — short bias preferred`,
      adjustments: { confidenceMultiplier: 1.15, stopMultiplier: 0.9, tpMultiplier: 1.2 },
    };
  }

  if (choppiness > 7) {
    return {
      type: "choppy",
      strength: Math.min(100, choppiness * 10),
      description: `Choppy market (CI ${choppiness.toFixed(1)}) — avoid breakouts, use mean reversion`,
      adjustments: { confidenceMultiplier: 0.7, stopMultiplier: 1.2, tpMultiplier: 0.8 },
    };
  }

  return {
    type: "ranging",
    strength: 50,
    description: "Range-bound — support/resistance plays",
    adjustments: { confidenceMultiplier: 0.9, stopMultiplier: 1, tpMultiplier: 0.9 },
  };
}

// ═══════════════════════════════════════════════════════════════
// MULTI-TIMEFRAME ANALYSIS
// ═══════════════════════════════════════════════════════════════

interface TimeframeSignal {
  timeframe: string;
  bias: "bullish" | "bearish" | "neutral";
  strength: number; // 0-100
}

function analyzeTimeframe(klines: Kline[]): TimeframeSignal {
  const closes = klines.map(k => k.close);
  const n = closes.length;
  if (n < 5) return { timeframe: "unknown", bias: "neutral", strength: 0 };

  const ema9Val = ema(closes, Math.min(9, n));
  const ema21Val = ema(closes, Math.min(21, n));
  const rsi = calcRSI(closes);
  const price = closes[n - 1];
  const roc = n >= 6 ? ((price - closes[n - 6]) / closes[n - 6]) * 100 : 0;

  let score = 0;
  if (price > ema9Val) score += 1;
  if (ema9Val > ema21Val) score += 1;
  if (rsi > 55) score += 1;
  if (rsi < 45) score -= 1;
  if (roc > 0.5) score += 1;
  if (roc < -0.5) score -= 1;

  const bias = score >= 2 ? "bullish" : score <= -2 ? "bearish" : "neutral";
  return { timeframe: "", bias, strength: Math.min(100, Math.abs(score) * 25) };
}

function multiTimeframeAnalysis(klines: Kline[]): { signals: TimeframeSignal[]; consensus: "bullish" | "bearish" | "neutral" | "conflicting"; confidenceBoost: number } {
  const n = klines.length;

  // Simulate different timeframes by resampling
  // "5m" = raw data, "15m" = every 3rd bar, "1h" = every 12th bar
  const tf5m = analyzeTimeframe(klines);
  tf5m.timeframe = "5m";

  const tf15m = analyzeTimeframe(klines.filter((_, i) => i % 3 === 0));
  tf15m.timeframe = "15m";

  const hourlyBars = klines.filter((_, i) => i % 12 === 0);
  const tf1h = analyzeTimeframe(hourlyBars.length >= 5 ? hourlyBars : klines.filter((_, i) => i % 6 === 0));
  tf1h.timeframe = "1h";

  const signals = [tf5m, tf15m, tf1h];

  // Check consensus
  const bullish = signals.filter(s => s.bias === "bullish").length;
  const bearish = signals.filter(s => s.bias === "bearish").length;

  let consensus: "bullish" | "bearish" | "neutral" | "conflicting";
  let confidenceBoost = 0;

  if (bullish >= 2 && bearish === 0) {
    consensus = "bullish";
    confidenceBoost = bullish === 3 ? 12 : 6;
  } else if (bearish >= 2 && bullish === 0) {
    consensus = "bearish";
    confidenceBoost = bearish === 3 ? 12 : 6;
  } else if (bullish > 0 && bearish > 0) {
    consensus = "conflicting";
    confidenceBoost = -5;
  } else {
    consensus = "neutral";
    confidenceBoost = 0;
  }

  return { signals, consensus, confidenceBoost };
}

// ═══════════════════════════════════════════════════════════════
// ENHANCED LOCAL STRATEGY BUILDER (v3)
// ═══════════════════════════════════════════════════════════════

function buildFallbackStrategy(
  symbol: string,
  klines: Kline[],
  riskParams: any,
  reason: string,
  profitExpectancy?: number,
  historicalAccuracy?: { winRate: number; avgPnl: number; total: number; entryHitRate: number },
  microPredDirection?: string,
  microPredConfidence?: number,
  sector?: string,
) {
  const closes = klines.map(k => k.close);
  const highs = klines.map(k => k.high);
  const lows = klines.map(k => k.low);
  const volumes = klines.map(k => k.volume);
  const currentPrice = closes[closes.length - 1];
  const n = closes.length;

  // ── Core Indicators ──
  const sma10 = sma(closes, 10);
  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);
  const rsi = calcRSI(closes);
  const stochRsi = calcStochRSI(closes);
  const macdLine = ema(closes, 12) - ema(closes, 26);
  const signalLine = ema(closes.slice(-9), 9);
  const macdHist = macdLine - signalLine;
  const atr = calcATR(klines);
  const atrPct = (atr / currentPrice) * 100;

  // ── Bollinger Bands ──
  const bb20 = sma(closes, 20);
  const bbStdDev = Math.sqrt(closes.slice(-20).reduce((sum, c) => sum + (c - bb20) ** 2, 0) / Math.min(20, n));
  const bbUpper = bb20 + 2 * bbStdDev;
  const bbLower = bb20 - 2 * bbStdDev;
  const bbPosition = bbStdDev > 0 ? (currentPrice - bbLower) / (bbUpper - bbLower) * 100 : 50;
  const bbWidth = bbStdDev > 0 ? (bbUpper - bbLower) / bb20 : 0;
  const isBBSqueeze = bbWidth < 0.02; // Tight squeeze

  // ── VWAP ──
  let vwapNum = 0, vwapDen = 0;
  for (const k of klines.slice(-30)) {
    const tp = (k.high + k.low + k.close) / 3;
    vwapNum += tp * k.volume;
    vwapDen += k.volume;
  }
  const vwap = vwapDen > 0 ? vwapNum / vwapDen : currentPrice;

  // ── Volume Analysis ──
  const recentVol = sma(volumes, 5);
  const avgVol = sma(volumes, Math.min(20, n));
  const relVol = avgVol > 0 ? recentVol / avgVol : 1;

  // ── Momentum ──
  const roc5 = n >= 6 ? ((currentPrice - closes[n - 6]) / closes[n - 6]) * 100 : 0;
  const roc10 = n >= 11 ? ((currentPrice - closes[n - 11]) / closes[n - 11]) * 100 : 0;
  const roc5prev = n >= 7 ? ((closes[n - 2] - closes[n - 7]) / closes[n - 7]) * 100 : 0;
  const momentumAccelerating = roc5 > roc5prev && roc5 > 0;
  const momentumDecelerating = roc5 < roc5prev && roc5 > 0;

  // ── Trend Detection ──
  const trendUp = currentPrice > ema9 && ema9 > ema21 && currentPrice > sma20;
  const trendDown = currentPrice < ema9 && ema9 < ema21 && currentPrice < sma20;

  // ── Market Regime ──
  const regime = detectMarketRegime(klines, closes, atr);

  // ── Multi-Timeframe ──
  const mtf = multiTimeframeAnalysis(klines);

  // ── Fibonacci Levels ──
  const swingHigh = Math.max(...highs.slice(-30));
  const swingLow = Math.min(...lows.slice(-30));
  const fibLevels = calcFibLevels(swingHigh, swingLow, currentPrice > (swingHigh + swingLow) / 2);

  // ── Candlestick Patterns ──
  const last = klines[n - 1];
  const prev = klines[n - 2];
  const bodySize = Math.abs(last.close - last.open);
  const candleRange = last.high - last.low;
  const isHammer = candleRange > 0 && bodySize / candleRange < 0.3 && (last.close > last.open) && (last.open - last.low) > bodySize * 2;
  const isShootingStar = candleRange > 0 && bodySize / candleRange < 0.3 && (last.close < last.open) && (last.high - last.open) > bodySize * 2;
  const isBullEngulf = prev && prev.close < prev.open && last.close > last.open && last.close > prev.open && last.open < prev.close;
  const isBearEngulf = prev && prev.close > prev.open && last.close < last.open && last.close < prev.open && last.open > prev.close;

  // Doji detection
  const isDoji = candleRange > 0 && bodySize / candleRange < 0.1;

  // Morning/Evening star (3-bar patterns)
  const prev2 = n >= 3 ? klines[n - 3] : null;
  const isMorningStar = prev2 && prev2.close < prev2.open && isDoji && last.close > last.open && last.close > (prev2.open + prev2.close) / 2;
  const isEveningStar = prev2 && prev2.close > prev2.open && isDoji && last.close < last.open && last.close < (prev2.open + prev2.close) / 2;

  // ── Support / Resistance from pivot clusters ──
  const pivotHighs: number[] = [];
  const pivotLows: number[] = [];
  for (let i = 2; i < n - 2; i++) {
    if (highs[i] > highs[i - 1] && highs[i] > highs[i - 2] && highs[i] > highs[i + 1] && highs[i] > highs[i + 2]) pivotHighs.push(highs[i]);
    if (lows[i] < lows[i - 1] && lows[i] < lows[i - 2] && lows[i] < lows[i + 1] && lows[i] < lows[i + 2]) pivotLows.push(lows[i]);
  }
  const clusterLevels = (levels: number[], threshold: number) => {
    const sorted = [...levels].sort((a, b) => a - b);
    const clusters: number[] = [];
    let i = 0;
    while (i < sorted.length) {
      let sum = sorted[i], count = 1;
      while (i + 1 < sorted.length && sorted[i + 1] - sorted[i] < threshold) { i++; sum += sorted[i]; count++; }
      clusters.push(parseFloat((sum / count).toFixed(2)));
      i++;
    }
    return clusters;
  };
  const clusterThreshold = atr * 0.5;
  const resistance = clusterLevels(pivotHighs, clusterThreshold).filter(r => r > currentPrice).slice(0, 3);
  const support = clusterLevels(pivotLows, clusterThreshold).filter(s => s < currentPrice).slice(-3).reverse();
  if (resistance.length === 0) resistance.push(parseFloat((currentPrice + atr * 1.5).toFixed(2)));
  if (support.length === 0) support.push(parseFloat((currentPrice - atr * 1.5).toFixed(2)));

  // ═══════════════════════════════════════════════
  // MULTI-FACTOR SCORING (v3 — 18 factors)
  // ═══════════════════════════════════════════════
  let score = 0;
  const reasoning: string[] = [`Engine v3 fallback: ${reason}`];

  // 1. Trend (±2.5)
  if (trendUp) { score += 2.5; reasoning.push(`Uptrend: price > EMA9 ($${ema9.toFixed(2)}) > EMA21 ($${ema21.toFixed(2)})`); }
  else if (trendDown) { score -= 2.5; reasoning.push(`Downtrend: price < EMA9 < EMA21`); }

  // 2. VWAP (±1)
  if (currentPrice > vwap * 1.002) { score += 1; reasoning.push(`Above VWAP ($${vwap.toFixed(2)}) — institutional buying`); }
  else if (currentPrice < vwap * 0.998) { score -= 1; reasoning.push(`Below VWAP — selling pressure`); }

  // 3. RSI (±1.5)
  if (rsi > 75) { score -= 1.5; reasoning.push(`RSI overbought ${rsi.toFixed(0)} — reversal risk`); }
  else if (rsi > 60) { score += 0.5; reasoning.push(`RSI bullish ${rsi.toFixed(0)}`); }
  else if (rsi < 25) { score += 1.5; reasoning.push(`RSI deeply oversold ${rsi.toFixed(0)} — bounce likely`); }
  else if (rsi < 40) { score -= 0.5; reasoning.push(`RSI bearish ${rsi.toFixed(0)}`); }

  // 4. Stochastic RSI (±1)
  if (stochRsi > 85 && rsi > 65) { score -= 1; reasoning.push(`StochRSI overbought ${stochRsi.toFixed(0)} with elevated RSI`); }
  else if (stochRsi < 15 && rsi < 35) { score += 1; reasoning.push(`StochRSI oversold ${stochRsi.toFixed(0)} — reversal zone`); }

  // 5. Bollinger position (±1)
  if (bbPosition < 10) { score += 1; reasoning.push(`At lower BB — mean reversion buy zone`); }
  else if (bbPosition > 90) { score -= 1; reasoning.push(`At upper BB — overextended`); }

  // 6. BB Squeeze detection (±0.5)
  if (isBBSqueeze) { score += Math.sign(roc5 || 1) * 0.5; reasoning.push(`BB squeeze detected — expansion imminent (${roc5 > 0 ? "bullish" : "bearish"} bias)`); }

  // 7. Momentum ROC (±1)
  if (roc5 > 3) { score += 1; reasoning.push(`Strong 5-bar momentum: +${roc5.toFixed(1)}%`); }
  else if (roc5 < -3) { score -= 1; reasoning.push(`Weak 5-bar momentum: ${roc5.toFixed(1)}%`); }

  // 8. Momentum acceleration (±0.5)
  if (momentumAccelerating) { score += 0.5; reasoning.push("Momentum accelerating — ROC increasing"); }
  else if (momentumDecelerating) { score -= 0.3; reasoning.push("Momentum decelerating"); }

  // 9. Volume confirmation (±1.5)
  if (relVol > 2) { score += Math.sign(score || 1) * 1.5; reasoning.push(`Volume spike: ${relVol.toFixed(1)}x avg — confirms`); }
  else if (relVol > 1.3) { score += Math.sign(score || 1) * 0.5; reasoning.push(`Above-avg vol: ${relVol.toFixed(1)}x`); }
  else if (relVol < 0.5) { score -= 0.5; reasoning.push("Very low volume — weak conviction"); }

  // 10. Candlestick patterns (±2)
  if (isHammer) { score += 1.5; reasoning.push("Hammer candle — bullish reversal"); }
  if (isShootingStar) { score -= 1.5; reasoning.push("Shooting star — bearish reversal"); }
  if (isBullEngulf) { score += 2; reasoning.push("Bullish engulfing — strong buy"); }
  if (isBearEngulf) { score -= 2; reasoning.push("Bearish engulfing — strong sell"); }
  if (isMorningStar) { score += 2; reasoning.push("Morning star pattern — bullish reversal"); }
  if (isEveningStar) { score -= 2; reasoning.push("Evening star pattern — bearish reversal"); }

  // 11. MACD (±0.5)
  if (macdHist > 0 && macdLine > 0) { score += 0.5; reasoning.push("MACD bullish: histogram positive"); }
  else if (macdHist < 0 && macdLine < 0) { score -= 0.5; reasoning.push("MACD bearish: histogram negative"); }
  // MACD crossover bonus
  if (macdLine > 0 && macdHist > 0 && macdHist < atr * 0.1) { score += 0.5; reasoning.push("MACD just crossed bullish — fresh signal"); }

  // 12. Profit Expectancy (±1.5)
  const pe = profitExpectancy ?? 0;
  if (pe >= 75) { score += 1.5; reasoning.push(`High PE (${pe}) — strong composite signal`); }
  else if (pe >= 55) { score += 0.5; reasoning.push(`Moderate PE (${pe})`); }
  else if (pe < 25 && pe > 0) { score -= 1; reasoning.push(`Low PE (${pe}) — caution`); }

  // 13. Multi-Timeframe Consensus (±2)
  if (mtf.consensus === "bullish") { score += 2; reasoning.push(`MTF consensus BULLISH: ${mtf.signals.map(s => `${s.timeframe}=${s.bias}`).join(", ")}`); }
  else if (mtf.consensus === "bearish") { score -= 2; reasoning.push(`MTF consensus BEARISH: ${mtf.signals.map(s => `${s.timeframe}=${s.bias}`).join(", ")}`); }
  else if (mtf.consensus === "conflicting") { score *= 0.7; reasoning.push(`MTF CONFLICTING — reduced confidence: ${mtf.signals.map(s => `${s.timeframe}=${s.bias}`).join(", ")}`); }

  // 14. Market Regime Adjustment
  score *= regime.adjustments.confidenceMultiplier;
  reasoning.push(`Regime: ${regime.description}`);

  // 15. Historical Accuracy Feedback
  if (historicalAccuracy && historicalAccuracy.total >= 5) {
    const wr = historicalAccuracy.winRate;
    if (wr > 65) { score += 1; reasoning.push(`Historical win rate ${wr.toFixed(0)}% — strategy working well`); }
    else if (wr < 35 && historicalAccuracy.total >= 10) { score *= 0.8; reasoning.push(`Historical win rate only ${wr.toFixed(0)}% — strategy underperforming, reducing confidence`); }

    if (historicalAccuracy.entryHitRate > 70) { reasoning.push(`Entry hit rate ${historicalAccuracy.entryHitRate.toFixed(0)}% — entries well-calibrated`); }
    else if (historicalAccuracy.entryHitRate < 30 && historicalAccuracy.total >= 10) { reasoning.push(`Entry hit rate only ${historicalAccuracy.entryHitRate.toFixed(0)}% — consider wider entry zones`); }
  }

  // 16. Micro-Prediction Confluence
  if (microPredDirection && microPredConfidence) {
    const microAligned = (microPredDirection === "up" && score > 0) || (microPredDirection === "down" && score < 0);
    if (microAligned && microPredConfidence > 60) {
      score += Math.sign(score) * 1;
      reasoning.push(`Micro-prediction ${microPredDirection} (${microPredConfidence}% conf) CONFIRMS direction`);
    } else if (!microAligned && microPredConfidence > 70) {
      score *= 0.85;
      reasoning.push(`Micro-prediction DIVERGES (${microPredDirection} ${microPredConfidence}%) — caution`);
    }
  }

  // 17. Fibonacci proximity for smarter levels
  const nearestFibAbove = Object.entries(fibLevels).filter(([_, v]) => v > currentPrice).sort((a, b) => a[1] - b[1])[0];
  const nearestFibBelow = Object.entries(fibLevels).filter(([_, v]) => v < currentPrice).sort((a, b) => b[1] - a[1])[0];

  if (nearestFibBelow) {
    const distPct = ((currentPrice - nearestFibBelow[1]) / currentPrice) * 100;
    if (distPct < 0.5) { score += 0.5; reasoning.push(`Price at Fibonacci ${nearestFibBelow[0]} ($${nearestFibBelow[1].toFixed(2)}) — strong support`); }
  }
  if (nearestFibAbove) {
    const distPct = ((nearestFibAbove[1] - currentPrice) / currentPrice) * 100;
    if (distPct < 0.5) { score -= 0.3; reasoning.push(`Price near Fibonacci ${nearestFibAbove[0]} ($${nearestFibAbove[1].toFixed(2)}) — resistance`); }
  }

  // 18. Sector context
  if (sector) { reasoning.push(`Sector: ${sector}`); }

  // ═══════════════════════════════════════════════
  // SIGNAL GENERATION with Fibonacci TP/SL
  // ═══════════════════════════════════════════════
  const slPct = riskParams?.stopLossPct || 2;
  const tpPct = riskParams?.takeProfitPct || 5;
  const signals: any[] = [];
  const nearestSupport = support[0] || currentPrice * 0.97;
  const nearestResistance = resistance[0] || currentPrice * 1.03;

  // Use Fibonacci for TP/SL when available
  const fibTP = nearestFibAbove ? nearestFibAbove[1] : null;
  const fibSL = nearestFibBelow ? nearestFibBelow[1] : null;

  const stopMult = regime.adjustments.stopMultiplier;
  const tpMult = regime.adjustments.tpMultiplier;

  if (score >= 2) {
    // Aggressive entry
    const entry1 = parseFloat((currentPrice * 0.999).toFixed(2));
    const sl1 = parseFloat(Math.max(
      fibSL ? fibSL * 0.998 : entry1 - atr * 1.5 * stopMult,
      entry1 * (1 - slPct / 100)
    ).toFixed(2));
    const tp1 = parseFloat(Math.min(
      fibTP ? fibTP * 0.998 : entry1 + atr * 3 * tpMult,
      nearestResistance,
      entry1 * (1 + tpPct / 100)
    ).toFixed(2));
    const rr1 = (tp1 - entry1) / Math.max(entry1 - sl1, 0.01);
    signals.push({
      action: "buy", entry_price: entry1, stop_loss: sl1, take_profit: tp1,
      position_size_pct: riskParams?.maxPositionPct || 10,
      reason: `Aggressive entry: ${reasoning.filter(r => !r.startsWith("Engine")).slice(0, 3).join("; ")}. R:R ${rr1.toFixed(1)}:1`,
      timeframe: "Intraday (1-4h)",
    });

    // Pullback entry at EMA9 / Fib 38.2%
    const fibPullback = fibLevels["38.2%"];
    const pullbackTarget = fibPullback && fibPullback < currentPrice ? Math.max(ema9, fibPullback) : ema9;
    const entry2 = parseFloat(Math.max(pullbackTarget * 1.001, nearestSupport * 1.005).toFixed(2));
    if (entry2 < currentPrice * 0.998) {
      const sl2 = parseFloat((entry2 - atr * 1.5 * stopMult).toFixed(2));
      const tp2 = parseFloat(Math.min(entry2 + atr * 3.5 * tpMult, nearestResistance).toFixed(2));
      signals.push({
        action: "buy", entry_price: entry2, stop_loss: sl2, take_profit: tp2,
        position_size_pct: Math.round((riskParams?.maxPositionPct || 10) * 0.6),
        reason: `Pullback entry at Fib 38.2%/EMA9 ($${entry2}) — higher R:R`,
        timeframe: "Swing (1-3d)",
      });
    }

    // Breakout above resistance / Fib 100%
    const breakoutLevel = resistance[0] || fibLevels["100%"];
    if (breakoutLevel) {
      const entry3 = parseFloat((breakoutLevel * 1.003).toFixed(2));
      const sl3 = parseFloat((breakoutLevel * 0.99).toFixed(2));
      const fibExt = fibLevels["127.2%"] || entry3 * 1.03;
      const tp3 = parseFloat(Math.min(fibExt, entry3 + (entry3 - sl3) * 2.5).toFixed(2));
      signals.push({
        action: "buy", entry_price: entry3, stop_loss: sl3, take_profit: tp3,
        position_size_pct: Math.round((riskParams?.maxPositionPct || 10) * 0.5),
        reason: `Breakout entry above $${breakoutLevel.toFixed(2)} — Fib 127.2% target $${fibExt.toFixed(2)}`,
        timeframe: "Breakout (1-2d)",
      });
    }
  } else if (score <= -2) {
    const entry = parseFloat((currentPrice * 1.001).toFixed(2));
    const sl = parseFloat(Math.min(
      fibTP ? fibTP * 1.002 : entry + atr * 1.5 * stopMult,
      entry * (1 + slPct / 100)
    ).toFixed(2));
    const tp = parseFloat(Math.max(
      fibSL ? fibSL * 1.002 : entry - atr * 3 * tpMult,
      nearestSupport,
      entry * (1 - tpPct / 100)
    ).toFixed(2));
    signals.push({
      action: "sell", entry_price: entry, stop_loss: sl, take_profit: tp,
      position_size_pct: riskParams?.maxPositionPct || 10,
      reason: `Bearish: ${reasoning.filter(r => !r.startsWith("Engine")).slice(0, 3).join("; ")}`,
      timeframe: "Intraday (1-4h)",
    });

    if (support[0]) {
      const entry2 = parseFloat((support[0] * 0.997).toFixed(2));
      const sl2 = parseFloat((support[0] * 1.01).toFixed(2));
      const fibExtDown = fibLevels["127.2%"] || entry2 * 0.97;
      const tp2 = parseFloat(Math.max(fibExtDown, entry2 - (sl2 - entry2) * 2).toFixed(2));
      signals.push({
        action: "sell", entry_price: entry2, stop_loss: sl2, take_profit: tp2,
        position_size_pct: Math.round((riskParams?.maxPositionPct || 10) * 0.5),
        reason: `Breakdown short below S1 $${support[0]} — Fib ext target`,
        timeframe: "Breakdown (1-2d)",
      });
    }
  } else {
    // Neutral — range plays anchored to Fib levels
    const rangeBuyEntry = fibLevels["61.8%"] && fibLevels["61.8%"] < currentPrice ? fibLevels["61.8%"] : nearestSupport;
    const rangeSellEntry = fibLevels["38.2%"] && fibLevels["38.2%"] > currentPrice ? fibLevels["38.2%"] : nearestResistance;

    signals.push({
      action: "buy", entry_price: parseFloat(rangeBuyEntry.toFixed(2)),
      stop_loss: parseFloat((rangeBuyEntry - atr * stopMult).toFixed(2)),
      take_profit: parseFloat(rangeSellEntry.toFixed(2)),
      position_size_pct: Math.round((riskParams?.maxPositionPct || 10) * 0.4),
      reason: `Range buy at Fib 61.8%/support $${rangeBuyEntry.toFixed(2)}`,
      timeframe: "Swing (1-5d)",
    });
    signals.push({
      action: "sell", entry_price: parseFloat(rangeSellEntry.toFixed(2)),
      stop_loss: parseFloat((rangeSellEntry + atr * stopMult).toFixed(2)),
      take_profit: parseFloat(rangeBuyEntry.toFixed(2)),
      position_size_pct: Math.round((riskParams?.maxPositionPct || 10) * 0.4),
      reason: `Range sell at Fib 38.2%/resistance $${rangeSellEntry.toFixed(2)}`,
      timeframe: "Swing (1-5d)",
    });
  }

  const bias = score >= 5 ? "strong_bullish" : score >= 2 ? "bullish" : score <= -5 ? "strong_bearish" : score <= -2 ? "bearish" : "neutral";
  const baseConfidence = Math.min(90, Math.max(20, 38 + Math.abs(score) * 5.5));
  const confidence = Math.min(95, Math.max(15, baseConfidence + mtf.confidenceBoost));
  const rrRatio = signals[0] ? Math.abs(signals[0].take_profit - signals[0].entry_price) / Math.max(Math.abs(signals[0].entry_price - signals[0].stop_loss), 0.01) : 1;
  const volRegime = atrPct > 6 ? "extreme" : atrPct > 4 ? "high" : atrPct > 2 ? "medium" : "low";

  return {
    strategy_name: `Local TA v3: ${regime.type === "trending_up" ? "Trend Follow" : regime.type === "trending_down" ? "Bearish Momentum" : regime.type === "choppy" ? "Mean Reversion" : regime.type === "volatile_expansion" ? "Volatility Play" : score > 0 ? "Bullish Setup" : score < 0 ? "Bearish Setup" : "Range Trading"}`,
    overall_bias: bias,
    confidence: Math.round(confidence),
    signals,
    indicators: {
      trend_strength: Math.min(100, Math.abs(score) * 12),
      momentum_score: Math.max(-100, Math.min(100, roc10 * 5)),
      volatility_regime: volRegime,
      support_levels: support.slice(0, 3),
      resistance_levels: resistance.slice(0, 3),
      rsi: parseFloat(rsi.toFixed(1)),
      stoch_rsi: parseFloat(stochRsi.toFixed(1)),
      sma10: parseFloat(sma10.toFixed(2)),
      sma20: parseFloat(sma20.toFixed(2)),
      sma50: parseFloat(sma50.toFixed(2)),
      atr: parseFloat(atr.toFixed(4)),
      relative_volume: parseFloat(relVol.toFixed(2)),
      vwap: parseFloat(vwap.toFixed(2)),
      ema9: parseFloat(ema9.toFixed(2)),
      ema21: parseFloat(ema21.toFixed(2)),
      bb_upper: parseFloat(bbUpper.toFixed(2)),
      bb_lower: parseFloat(bbLower.toFixed(2)),
      bb_position: parseFloat(bbPosition.toFixed(1)),
      bb_squeeze: isBBSqueeze,
      macd_histogram: parseFloat(macdHist.toFixed(4)),
      market_regime: regime.type,
      regime_strength: regime.strength,
      mtf_consensus: mtf.consensus,
      fibonacci_levels: Object.fromEntries(Object.entries(fibLevels).map(([k, v]) => [k, parseFloat(v.toFixed(2))])),
    },
    risk_assessment: {
      risk_reward_ratio: parseFloat(rrRatio.toFixed(2)),
      max_drawdown_estimate: parseFloat((atrPct * 2.5 * regime.adjustments.stopMultiplier).toFixed(1)),
      win_probability: Math.round(Math.min(85, Math.max(15, 50 + score * 3.5))),
    },
    reasoning: reasoning.slice(0, 12),
    analysis_mode: "fallback",
  };
}

// ═══════════════════════════════════════════════════════════════
// AI CONSENSUS MODE
// ═══════════════════════════════════════════════════════════════

function mergeAIAndLocal(aiStrategy: any, localStrategy: any): any {
  // If both agree on direction, boost confidence
  const aiDir = aiStrategy.overall_bias?.includes("bullish") ? 1 : aiStrategy.overall_bias?.includes("bearish") ? -1 : 0;
  const localDir = localStrategy.overall_bias?.includes("bullish") ? 1 : localStrategy.overall_bias?.includes("bearish") ? -1 : 0;

  const consensus = aiDir === localDir && aiDir !== 0;
  const conflicting = aiDir !== 0 && localDir !== 0 && aiDir !== localDir;

  // Merge confidence
  let mergedConfidence = Math.round((aiStrategy.confidence * 0.6 + localStrategy.confidence * 0.4));
  if (consensus) mergedConfidence = Math.min(95, mergedConfidence + 10);
  if (conflicting) mergedConfidence = Math.max(15, mergedConfidence - 15);

  // Use AI signals if consensus, local if conflicting (local is more conservative)
  const signals = consensus ? aiStrategy.signals : conflicting ? localStrategy.signals : aiStrategy.signals;

  // Merge reasoning
  const reasoning = [
    ...(aiStrategy.reasoning || []).slice(0, 5),
    `--- Local TA v3 Analysis ---`,
    ...(localStrategy.reasoning || []).filter((r: string) => !r.startsWith("Engine")).slice(0, 5),
    consensus ? "✅ AI + Local TA AGREE — high conviction" : conflicting ? "⚠️ AI vs Local TA DIVERGE — reduced confidence" : "AI primary, local secondary",
  ];

  // Merge indicators (prefer local for computed values)
  const indicators = { ...localStrategy.indicators, ...aiStrategy.indicators };
  indicators.market_regime = localStrategy.indicators?.market_regime;
  indicators.mtf_consensus = localStrategy.indicators?.mtf_consensus;
  indicators.fibonacci_levels = localStrategy.indicators?.fibonacci_levels;
  indicators.bb_squeeze = localStrategy.indicators?.bb_squeeze;
  indicators.stoch_rsi = localStrategy.indicators?.stoch_rsi;
  indicators.regime_strength = localStrategy.indicators?.regime_strength;

  return {
    ...aiStrategy,
    strategy_name: consensus ? `Consensus: ${aiStrategy.strategy_name}` : conflicting ? `Contested: ${localStrategy.strategy_name}` : aiStrategy.strategy_name,
    confidence: mergedConfidence,
    signals,
    indicators,
    risk_assessment: {
      ...aiStrategy.risk_assessment,
      win_probability: consensus
        ? Math.min(90, Math.round((aiStrategy.risk_assessment?.win_probability || 50) * 0.6 + (localStrategy.risk_assessment?.win_probability || 50) * 0.4) + 5)
        : Math.round((aiStrategy.risk_assessment?.win_probability || 50) * 0.5 + (localStrategy.risk_assessment?.win_probability || 50) * 0.5),
    },
    reasoning,
    analysis_mode: consensus ? "consensus" : conflicting ? "contested" : "ai",
  };
}

// ═══════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const {
      klines, symbol, riskParams, profitExpectancy,
      historicalAccuracy, microPredDirection, microPredConfidence, sector,
    } = await req.json();

    if (!klines || !Array.isArray(klines) || klines.length < 10) {
      return new Response(JSON.stringify({ error: "Need at least 10 kline data points" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    // Always compute local strategy for consensus mode
    const localStrategy = buildFallbackStrategy(
      symbol, klines, riskParams, "consensus baseline",
      profitExpectancy, historicalAccuracy, microPredDirection, microPredConfidence, sector,
    );

    // Compress kline data for the prompt
    const closes = klines.map((k: any) => k.close);
    const highs = klines.map((k: any) => k.high);
    const lows = klines.map((k: any) => k.low);
    const volumes = klines.map((k: any) => k.volume);

    const recentKlines = klines.slice(-20).map((k: any) => ({
      o: k.open.toFixed(2), h: k.high.toFixed(2), l: k.low.toFixed(2), c: k.close.toFixed(2), v: k.volume.toFixed(0),
    }));

    const avgVolume = volumes.reduce((a: number, b: number) => a + b, 0) / volumes.length;
    const currentPrice = closes[closes.length - 1];
    const priceChange = ((currentPrice - closes[0]) / closes[0] * 100).toFixed(2);
    const sma10Val = closes.slice(-10).reduce((a: number, b: number) => a + b, 0) / 10;
    const sma20Val = closes.length >= 20 ? closes.slice(-20).reduce((a: number, b: number) => a + b, 0) / 20 : sma10Val;

    const returns: number[] = [];
    for (let i = 1; i < closes.length; i++) returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const volatility = Math.sqrt(returns.reduce((sum, r) => sum + (r - avgReturn) ** 2, 0) / returns.length) * 100;

    // Build enriched prompt with all context
    const pe = profitExpectancy;
    const contextLines: string[] = [];
    if (pe !== undefined && pe > 0) contextLines.push(`Profit Expectancy Score: ${pe}/100`);
    if (historicalAccuracy && historicalAccuracy.total >= 3) {
      contextLines.push(`Historical Accuracy: ${historicalAccuracy.winRate.toFixed(0)}% win rate over ${historicalAccuracy.total} strategies, entry hit rate ${historicalAccuracy.entryHitRate.toFixed(0)}%`);
    }
    if (microPredDirection) contextLines.push(`Micro-Prediction: ${microPredDirection} with ${microPredConfidence}% confidence`);
    if (sector) contextLines.push(`Sector: ${sector}`);
    if (localStrategy.indicators?.market_regime) contextLines.push(`Market Regime: ${localStrategy.indicators.market_regime} (strength ${localStrategy.indicators.regime_strength})`);
    if (localStrategy.indicators?.mtf_consensus) contextLines.push(`Multi-Timeframe Consensus: ${localStrategy.indicators.mtf_consensus}`);
    if (localStrategy.indicators?.bb_squeeze) contextLines.push("⚡ Bollinger Band SQUEEZE detected — volatility expansion imminent");
    if (localStrategy.indicators?.fibonacci_levels) {
      const fib = localStrategy.indicators.fibonacci_levels;
      contextLines.push(`Key Fibonacci: 38.2%=$${fib["38.2%"]}, 50%=$${fib["50%"]}, 61.8%=$${fib["61.8%"]}`);
    }
    const enrichedContext = contextLines.length > 0 ? `\n\nAdditional Intelligence:\n${contextLines.join("\n")}` : "";

    const prompt = `You are an elite quantitative trading strategy engine. Analyze this data and generate PRECISE, EXACT buy/sell levels with dollar amounts.

Symbol: ${symbol}
Data Points: ${klines.length} candles
Period Change: ${priceChange}%
Current Price: $${currentPrice.toFixed(2)}
SMA10: $${sma10Val.toFixed(2)}
SMA20: $${sma20Val.toFixed(2)}
Volatility: ${volatility.toFixed(3)}%
Avg Volume: ${avgVolume.toFixed(0)}
Price Range: $${Math.min(...lows).toFixed(2)} - $${Math.max(...highs).toFixed(2)}

Risk Parameters:
- Max Position Size: ${riskParams?.maxPositionPct || 10}% of portfolio
- Stop Loss: ${riskParams?.stopLossPct || 2}%
- Take Profit: ${riskParams?.takeProfitPct || 5}%
- Risk Tolerance: ${riskParams?.riskTolerance || "medium"}
- Required Risk/Reward: 2:1 minimum

Recent 20 candles (OHLCV): ${JSON.stringify(recentKlines)}
${enrichedContext}

CRITICAL INSTRUCTIONS:
1. Provide EXACT dollar prices for entry, stop loss, and take profit — NOT percentages
2. Calculate Risk:Reward ratio for each signal (must be >= 2.0)
3. Give 2-3 trade signals at different price zones (aggressive entry, conservative entry, breakout entry)
4. Support/resistance levels must be EXACT prices derived from the data
5. Each signal must include the expected timeframe and position size
6. Use Fibonacci retracement/extension levels for precision TP/SL placement
7. Account for the market regime and multi-timeframe consensus in your analysis
8. If no good setup exists, return neutral with explanation`;

    let response: Response | null = null;
    let aiFailureReason = "AI unreachable";

    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      try {
        response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [
              { role: "system", content: "You are an elite quantitative trading strategist. Generate precise, actionable trade signals with exact dollar prices. Use Fibonacci levels for TP/SL placement. Consider multi-timeframe analysis and market regime in every recommendation." },
              { role: "user", content: prompt },
            ],
            tools: [
              {
                type: "function",
                function: {
                  name: "strategy_signals",
                  description: "Generate trading strategy signals with exact price levels",
                  parameters: {
                    type: "object",
                    properties: {
                      strategy_name: { type: "string" },
                      overall_bias: { type: "string", enum: ["strong_bullish", "bullish", "neutral", "bearish", "strong_bearish"] },
                      confidence: { type: "number", description: "0-100" },
                      signals: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            action: { type: "string", enum: ["buy", "sell", "hold"] },
                            entry_price: { type: "number" },
                            stop_loss: { type: "number" },
                            take_profit: { type: "number" },
                            position_size_pct: { type: "number" },
                            reason: { type: "string" },
                            timeframe: { type: "string" },
                          },
                          required: ["action", "entry_price", "stop_loss", "take_profit", "position_size_pct", "reason", "timeframe"],
                          additionalProperties: false,
                        },
                      },
                      indicators: {
                        type: "object",
                        properties: {
                          trend_strength: { type: "number" },
                          momentum_score: { type: "number" },
                          volatility_regime: { type: "string", enum: ["low", "medium", "high", "extreme"] },
                          support_levels: { type: "array", items: { type: "number" } },
                          resistance_levels: { type: "array", items: { type: "number" } },
                        },
                        required: ["trend_strength", "momentum_score", "volatility_regime", "support_levels", "resistance_levels"],
                        additionalProperties: false,
                      },
                      risk_assessment: {
                        type: "object",
                        properties: {
                          risk_reward_ratio: { type: "number" },
                          max_drawdown_estimate: { type: "number" },
                          win_probability: { type: "number" },
                        },
                        required: ["risk_reward_ratio", "max_drawdown_estimate", "win_probability"],
                        additionalProperties: false,
                      },
                      reasoning: { type: "array", items: { type: "string" } },
                    },
                    required: ["strategy_name", "overall_bias", "confidence", "signals", "indicators", "risk_assessment", "reasoning"],
                    additionalProperties: false,
                  },
                },
              },
            ],
            tool_choice: { type: "function", function: { name: "strategy_signals" } },
          }),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        break;
      } catch (fetchErr) {
        clearTimeout(timeout);
        aiFailureReason = fetchErr instanceof Error ? fetchErr.message : "AI request failed";
        if (attempt === 1) break;
        await new Promise(r => setTimeout(r, 750));
      }
    }

    // No AI response — return enhanced local strategy
    if (!response) {
      return new Response(JSON.stringify(localStrategy), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited, please try again later" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Fallback on errors
      return new Response(JSON.stringify(localStrategy), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let aiStrategy;
    try {
      const data = await response.json();
      const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
      if (!toolCall) throw new Error("No tool call");
      aiStrategy = { ...JSON.parse(toolCall.function.arguments), analysis_mode: "ai" };
    } catch (parseErr) {
      console.error("AI parse failed:", parseErr);
      return new Response(JSON.stringify(localStrategy), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // CONSENSUS MODE: merge AI + local TA
    const merged = mergeAIAndLocal(aiStrategy, localStrategy);

    return new Response(JSON.stringify(merged), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("strategy-engine error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
