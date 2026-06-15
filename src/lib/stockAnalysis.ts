// Float estimation and candlestick pattern detection utilities
// Used by auto-trading engine and strategy analysis

import { Kline } from "@/hooks/useStockKlines";

// ============================================
// FLOAT ESTIMATION
// ============================================

// Known approximate float data (in millions of shares) for major stocks
// Source: Public filings, approximated for screening purposes
export const KNOWN_FLOAT_DATA: Record<string, number> = {
  // Mega caps (very high float — usually NOT warrior candidates)
  AAPL: 15200, MSFT: 7430, GOOGL: 5900, AMZN: 10300, META: 2540,
  NVDA: 24400, TSLA: 3190, BRK_B: 1300, JPM: 2800, V: 1650,
  JNJ: 2410, WMT: 2700, PG: 2360, UNH: 930, HD: 990,
  MA: 830, BAC: 7950, XOM: 4100, KO: 4310, PEP: 1370,
  AVGO: 4650, CRM: 970, NFLX: 430, COST: 443, TMO: 380,
  LLY: 900, MRK: 2530, ABBV: 1770, CVX: 1860, ORCL: 2750,
  
  // Large caps
  AMD: 1620, INTC: 4250, QCOM: 1110, ADBE: 440, NOW: 205,
  UBER: 2000, SQ: 600, SHOP: 1280, COIN: 196, PYPL: 1060,
  SNAP: 1580, PINS: 640, ROKU: 140, DIS: 1830, BA: 600,
  GS: 325, MS: 1630, WFC: 3600, C: 1900,
  
  // Mid/small caps (lower float = more volatile = warrior territory)
  SOFI: 950, PLTR: 2100, HOOD: 850, MARA: 280, RIVN: 910,
  LCID: 1850, IONQ: 210, RKLB: 450, SMCI: 58, MSTR: 14,
  AFRM: 290, CELH: 230, CAVA: 120, CVNA: 200, DECK: 25,
  
  // Common day-trading small caps (very low float)
  FFIE: 350, MULN: 800, BBIG: 150, ATER: 15, PROG: 120,
};

export interface FloatEstimate {
  floatM: number;         // Float in millions of shares
  source: "known" | "estimated";
  isLowFloat: boolean;    // < 10M shares
  turnoverRatio: number;  // Volume / float — measures how "traded through" the float is
}

/**
 * Estimate the float (shares available to trade) for a stock.
 * Uses known data when available, otherwise estimates from market cap proxy.
 * 
 * Estimation method: Market Cap / Price = total shares outstanding.
 * Float is typically 70-95% of shares outstanding for most companies.
 * We use 80% as a conservative estimate.
 */
export function estimateFloat(symbol: string, price: number, volumeStr: string, marketCapProxy?: number): FloatEstimate {
  const cleanSym = symbol.replace("USDT", "").replace(/[^A-Z]/g, "");
  
  // Parse volume
  const rawVol = volumeStr.replace(/[^\d.]/g, "");
  let volumeM = parseFloat(rawVol) || 0;
  if (volumeStr.includes("B")) volumeM *= 1000;
  else if (volumeStr.includes("K")) volumeM /= 1000;
  
  // Check known float data first
  if (KNOWN_FLOAT_DATA[cleanSym]) {
    const floatM = KNOWN_FLOAT_DATA[cleanSym];
    return {
      floatM,
      source: "known",
      isLowFloat: floatM < 10,
      turnoverRatio: floatM > 0 ? volumeM / floatM : 0,
    };
  }
  
  // Estimate from market cap proxy or price heuristics
  // For unknown stocks, use price range to guess market cap tier
  let estimatedSharesM: number;
  if (marketCapProxy && marketCapProxy > 0) {
    // Market cap given in millions, divide by price
    estimatedSharesM = marketCapProxy / price;
  } else {
    // Heuristic: stocks under $5 typically have smaller caps
    // This is a rough proxy — real data would be better
    if (price < 1) estimatedSharesM = 50 + Math.random() * 200;       // Penny: 50-250M shares
    else if (price < 5) estimatedSharesM = 30 + Math.random() * 150;  // Micro: 30-180M
    else if (price < 20) estimatedSharesM = 20 + Math.random() * 100; // Small: 20-120M
    else if (price < 100) estimatedSharesM = 100 + Math.random() * 500;
    else estimatedSharesM = 300 + Math.random() * 2000;
  }
  
  // Float is ~80% of outstanding shares for most companies
  const floatM = estimatedSharesM * 0.8;
  
  return {
    floatM,
    source: "estimated",
    isLowFloat: floatM < 10,
    turnoverRatio: floatM > 0 ? volumeM / floatM : 0,
  };
}

// ============================================
// CANDLESTICK PATTERN DETECTION
// ============================================

export type PatternType = 
  | "new_high_breakout"    // First candle making a new high (Warrior entry #1)
  | "flat_top_breakout"    // Breaking through a flat top resistance (Warrior entry #2)
  | "bullish_engulfing"    // Large green candle fully engulfs previous red
  | "hammer"               // Long lower wick, small body near top (reversal)
  | "morning_star"         // 3-candle bottom reversal: big red, small, big green
  | "shooting_star"        // Long upper wick, small body near bottom (top reversal)
  | "doji"                 // Open ≈ Close, indecision
  | "three_white_soldiers" // 3 consecutive green candles with higher closes
  | "bearish_engulfing"    // Large red candle fully engulfs previous green
  | "double_bottom"        // W-pattern reversal
  | "bull_flag"            // Strong move up, then tight consolidation
  | "vwap_reclaim";        // Price reclaims VWAP from below

export interface DetectedPattern {
  type: PatternType;
  label: string;
  description: string;
  confidence: number;     // 0-100
  direction: "bullish" | "bearish" | "neutral";
  entryPrice?: number;
  stopPrice?: number;
  targetPrice?: number;
  candleIndex: number;    // Index where pattern was detected
}

/**
 * Detect candlestick patterns from kline data.
 * Returns all patterns found in the most recent candles.
 */
export function detectCandlestickPatterns(klines: Kline[]): DetectedPattern[] {
  if (klines.length < 5) return [];
  
  const patterns: DetectedPattern[] = [];
  const len = klines.length;
  const recent = klines.slice(-20); // Focus on last 20 candles
  
  // Helper functions
  const bodySize = (k: Kline) => Math.abs(k.close - k.open);
  const upperWick = (k: Kline) => k.high - Math.max(k.open, k.close);
  const lowerWick = (k: Kline) => Math.min(k.open, k.close) - k.low;
  const isGreen = (k: Kline) => k.close > k.open;
  const isRed = (k: Kline) => k.close < k.open;
  const range = (k: Kline) => k.high - k.low;
  
  const last = klines[len - 1];
  const prev = klines[len - 2];
  const prev2 = klines[len - 3];
  
  // Average body size for context
  const avgBody = recent.reduce((sum, k) => sum + bodySize(k), 0) / recent.length;
  const avgRange = recent.reduce((sum, k) => sum + range(k), 0) / recent.length;
  
  // ===== 1. NEW HIGH BREAKOUT (Warrior Entry #1) =====
  // Current candle makes a new high above recent high cluster
  const recentHighs = klines.slice(-10, -1).map(k => k.high);
  const recentHighMax = Math.max(...recentHighs);
  if (last.high > recentHighMax && isGreen(last) && bodySize(last) > avgBody * 0.5) {
    patterns.push({
      type: "new_high_breakout",
      label: "New High Breakout ⚔️",
      description: "First candle to make a new high — Warrior primary entry",
      confidence: Math.min(90, 60 + (last.volume / (recent.reduce((s, k) => s + k.volume, 0) / recent.length)) * 10),
      direction: "bullish",
      entryPrice: last.close,
      stopPrice: last.low,
      targetPrice: last.close + (last.close - last.low) * 2, // 2:1 R:R
      candleIndex: len - 1,
    });
  }
  
  // ===== 2. FLAT TOP BREAKOUT (Warrior Entry #2) =====
  // Price consolidates at a level (multiple highs within 0.5%), then breaks above
  const flatTopWindow = klines.slice(-8, -1);
  const flatHighs = flatTopWindow.map(k => k.high);
  const flatMax = Math.max(...flatHighs);
  const flatMin = Math.min(...flatHighs);
  const flatRange = flatMax > 0 ? (flatMax - flatMin) / flatMax : 1;
  
  if (flatRange < 0.015 && last.close > flatMax && isGreen(last) && last.volume > prev.volume * 1.3) {
    patterns.push({
      type: "flat_top_breakout",
      label: "Flat Top Breakout ⚔️",
      description: "Price broke through flat resistance — Warrior breakout entry",
      confidence: Math.min(95, 70 + (1 - flatRange * 100) * 5),
      direction: "bullish",
      entryPrice: flatMax,
      stopPrice: Math.min(...flatTopWindow.map(k => k.low)),
      targetPrice: flatMax + (flatMax - Math.min(...flatTopWindow.map(k => k.low))) * 2,
      candleIndex: len - 1,
    });
  }
  
  // ===== 3. BULLISH ENGULFING =====
  if (isRed(prev) && isGreen(last) && 
      last.open <= prev.close && last.close >= prev.open &&
      bodySize(last) > bodySize(prev) * 1.2) {
    patterns.push({
      type: "bullish_engulfing",
      label: "Bullish Engulfing",
      description: "Strong green candle fully engulfs previous red — reversal signal",
      confidence: Math.min(85, 55 + (bodySize(last) / avgBody) * 10),
      direction: "bullish",
      entryPrice: last.close,
      stopPrice: last.low,
      targetPrice: last.close + bodySize(last) * 2,
      candleIndex: len - 1,
    });
  }
  
  // ===== 4. BEARISH ENGULFING =====
  if (isGreen(prev) && isRed(last) &&
      last.open >= prev.close && last.close <= prev.open &&
      bodySize(last) > bodySize(prev) * 1.2) {
    patterns.push({
      type: "bearish_engulfing",
      label: "Bearish Engulfing",
      description: "Strong red candle fully engulfs previous green — sell signal",
      confidence: Math.min(85, 55 + (bodySize(last) / avgBody) * 10),
      direction: "bearish",
      candleIndex: len - 1,
    });
  }
  
  // ===== 5. HAMMER (bottom reversal) =====
  if (lowerWick(last) > bodySize(last) * 2 && 
      upperWick(last) < bodySize(last) * 0.5 &&
      bodySize(last) > 0) {
    // Confirm it's near a low
    const recent5Lows = klines.slice(-6, -1).map(k => k.low);
    const isNearLow = last.low <= Math.min(...recent5Lows) * 1.01;
    if (isNearLow) {
      patterns.push({
        type: "hammer",
        label: "Hammer",
        description: "Long lower wick near support — potential reversal",
        confidence: Math.min(80, 50 + (lowerWick(last) / bodySize(last)) * 5),
        direction: "bullish",
        entryPrice: last.close,
        stopPrice: last.low,
        targetPrice: last.close + (last.close - last.low),
        candleIndex: len - 1,
      });
    }
  }
  
  // ===== 6. SHOOTING STAR (top reversal) =====
  if (upperWick(last) > bodySize(last) * 2 &&
      lowerWick(last) < bodySize(last) * 0.5 &&
      bodySize(last) > 0) {
    const recent5Highs = klines.slice(-6, -1).map(k => k.high);
    const isNearHigh = last.high >= Math.max(...recent5Highs) * 0.99;
    if (isNearHigh) {
      patterns.push({
        type: "shooting_star",
        label: "Shooting Star",
        description: "Long upper wick near resistance — potential reversal down",
        confidence: Math.min(75, 45 + (upperWick(last) / bodySize(last)) * 5),
        direction: "bearish",
        candleIndex: len - 1,
      });
    }
  }
  
  // ===== 7. MORNING STAR (3-candle reversal) =====
  if (len >= 3 && isRed(prev2) && bodySize(prev2) > avgBody &&
      bodySize(prev) < avgBody * 0.4 && // Small middle candle
      isGreen(last) && bodySize(last) > avgBody &&
      last.close > (prev2.open + prev2.close) / 2) {
    patterns.push({
      type: "morning_star",
      label: "Morning Star",
      description: "3-candle bottom reversal — strong buy signal",
      confidence: 75,
      direction: "bullish",
      entryPrice: last.close,
      stopPrice: prev.low,
      targetPrice: last.close + bodySize(last) * 2.5,
      candleIndex: len - 1,
    });
  }
  
  // ===== 8. DOJI =====
  if (bodySize(last) < avgBody * 0.1 && range(last) > avgRange * 0.5) {
    patterns.push({
      type: "doji",
      label: "Doji",
      description: "Indecision candle — potential trend change",
      confidence: 40,
      direction: "neutral",
      candleIndex: len - 1,
    });
  }
  
  // ===== 9. THREE WHITE SOLDIERS =====
  if (len >= 3 && isGreen(prev2) && isGreen(prev) && isGreen(last) &&
      prev.close > prev2.close && last.close > prev.close &&
      bodySize(prev2) > avgBody * 0.5 && bodySize(prev) > avgBody * 0.5 && bodySize(last) > avgBody * 0.5) {
    patterns.push({
      type: "three_white_soldiers",
      label: "Three White Soldiers",
      description: "3 consecutive strong green candles — strong bullish momentum",
      confidence: 80,
      direction: "bullish",
      entryPrice: last.close,
      stopPrice: prev2.low,
      targetPrice: last.close + (last.close - prev2.low) * 0.5,
      candleIndex: len - 1,
    });
  }
  
  // ===== 10. BULL FLAG =====
  // Look for a strong move up (flagpole) followed by tight consolidation (flag)
  if (len >= 8) {
    const pole = klines.slice(-8, -3); // Flagpole: 5 candles
    const flag = klines.slice(-3);      // Flag: last 3 candles
    
    const poleGain = (pole[pole.length - 1].close - pole[0].open) / pole[0].open * 100;
    const flagRange = Math.max(...flag.map(k => k.high)) - Math.min(...flag.map(k => k.low));
    const avgFlagBody = flag.reduce((s, k) => s + bodySize(k), 0) / flag.length;
    
    if (poleGain > 5 && avgFlagBody < avgBody * 0.6 && 
        flagRange < (pole[pole.length - 1].close - pole[0].open) * 0.5) {
      patterns.push({
        type: "bull_flag",
        label: "Bull Flag",
        description: `Strong ${poleGain.toFixed(1)}% move up, then tight consolidation — continuation expected`,
        confidence: Math.min(85, 60 + poleGain * 2),
        direction: "bullish",
        entryPrice: Math.max(...flag.map(k => k.high)),
        stopPrice: Math.min(...flag.map(k => k.low)),
        targetPrice: Math.max(...flag.map(k => k.high)) + (pole[pole.length - 1].close - pole[0].open),
        candleIndex: len - 1,
      });
    }
  }
  
  // ===== 11. DOUBLE BOTTOM =====
  if (len >= 10) {
    const window = klines.slice(-10);
    const windowLows = window.map(k => k.low);
    const minLow = Math.min(...windowLows);
    
    // Find two lows within 1% of each other
    const lowIndices = windowLows
      .map((l, i) => ({ low: l, i }))
      .filter(x => x.low <= minLow * 1.01)
      .map(x => x.i);
    
    if (lowIndices.length >= 2 && (lowIndices[lowIndices.length - 1] - lowIndices[0]) >= 3 &&
        isGreen(last) && last.close > window[lowIndices[0]].high) {
      patterns.push({
        type: "double_bottom",
        label: "Double Bottom (W)",
        description: "W-pattern reversal — strong support confirmed",
        confidence: 70,
        direction: "bullish",
        entryPrice: last.close,
        stopPrice: minLow,
        targetPrice: last.close + (last.close - minLow),
        candleIndex: len - 1,
      });
    }
  }
  
  return patterns.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Get a summary string of detected patterns for the strategy engine prompt.
 */
export function formatPatternsForPrompt(patterns: DetectedPattern[]): string {
  if (patterns.length === 0) return "No significant candlestick patterns detected.";
  
  return patterns
    .slice(0, 5)
    .map(p => `${p.label} (${p.confidence}% confidence, ${p.direction})${p.entryPrice ? ` entry=$${p.entryPrice.toFixed(2)}` : ""}${p.stopPrice ? ` stop=$${p.stopPrice.toFixed(2)}` : ""}${p.targetPrice ? ` target=$${p.targetPrice.toFixed(2)}` : ""}`)
    .join("; ");
}

/**
 * Score how favorable the current candle patterns are for entry.
 * Returns -100 to +100 where positive = bullish patterns dominate.
 */
export function patternEntryScore(patterns: DetectedPattern[]): number {
  if (patterns.length === 0) return 0;
  
  let score = 0;
  for (const p of patterns) {
    const weight = p.confidence / 100;
    if (p.direction === "bullish") score += weight * 30;
    else if (p.direction === "bearish") score -= weight * 30;
  }
  
  return Math.max(-100, Math.min(100, score));
}
