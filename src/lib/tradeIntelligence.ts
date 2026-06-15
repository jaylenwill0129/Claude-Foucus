// Trade Intelligence Engine
// Edge analytics, slippage tracking, time-based exits, momentum fade detection,
// multi-TF micro-prediction alignment, and VWAP reclaim confirmation.

import { type ShortTermPrediction } from "@/lib/microPredictions";

// ─── Edge Analytics: Track performance by dimension ───

export interface EdgeBucket {
  wins: number;
  losses: number;
  totalPnl: number;
  avgPnlPct: number;
  count: number;
}

export interface EdgeAnalytics {
  byHour: Record<number, EdgeBucket>;
  bySector: Record<string, EdgeBucket>;
  byFloatTier: Record<string, EdgeBucket>;
  byPETier: Record<string, EdgeBucket>;
  byRiskTier: Record<string, EdgeBucket>;
  byDayOfWeek: Record<number, EdgeBucket>;
  byEntryQuality: Record<string, EdgeBucket>;
  bySignalType: Record<string, EdgeBucket>;
  slippage: SlippageStats;
  bestHours: number[];
  worstHours: number[];
  bestSectors: string[];
  autoRestrictions: AutoRestriction[];
}

export interface SlippageStats {
  totalSlippage: number;
  avgSlippagePct: number;
  slippageByTier: Record<string, { avgPct: number; count: number; totalCost: number }>;
  worstSlippage: { symbol: string; pct: number; cost: number } | null;
}

export interface AutoRestriction {
  type: "hour" | "sector" | "float" | "pe" | "entry_quality";
  value: string;
  reason: string;
  winRate: number;
  sampleSize: number;
}

export interface TradeRecord {
  symbol: string;
  side: "long" | "short";
  entryPrice: number;
  exitPrice: number;
  signalPrice: number; // price at signal generation
  filledPrice: number; // actual fill price
  pnl: number;
  pnlPct: number;
  holdTimeMs: number;
  timestamp: number;
  hour: number;
  dayOfWeek: number;
  sector?: string;
  floatTier?: string;
  peScore?: number;
  riskTier?: string;
  entryQuality?: string;
  signalType?: string;
  confidence?: number;
}

const STORAGE_KEY = "neuraltrade_edge_analytics";
const MAX_RECORDS = 500;

let tradeRecords: TradeRecord[] = [];
let edgeCache: EdgeAnalytics | null = null;

// Load from localStorage
export function loadTradeRecords(): TradeRecord[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      tradeRecords = JSON.parse(stored);
    }
  } catch { /* ignore */ }
  return tradeRecords;
}

// Save to localStorage
function saveTradeRecords() {
  try {
    // Keep only recent records
    if (tradeRecords.length > MAX_RECORDS) {
      tradeRecords = tradeRecords.slice(-MAX_RECORDS);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tradeRecords));
    edgeCache = null; // Invalidate cache
  } catch { /* ignore */ }
}

// Record a completed trade
export function recordTrade(trade: TradeRecord) {
  tradeRecords.push(trade);
  saveTradeRecords();
}

// Get float tier label
export function getFloatTier(floatM: number): string {
  if (floatM < 5) return "ultra_low";
  if (floatM < 20) return "low";
  if (floatM < 100) return "mid";
  if (floatM < 500) return "normal";
  return "high";
}

// Get PE tier label
export function getPETier(pe: number): string {
  if (pe >= 80) return "elite";
  if (pe >= 60) return "strong";
  if (pe >= 40) return "moderate";
  if (pe >= 20) return "weak";
  return "poor";
}

function emptyBucket(): EdgeBucket {
  return { wins: 0, losses: 0, totalPnl: 0, avgPnlPct: 0, count: 0 };
}

function addToBucket(bucket: EdgeBucket, pnl: number, pnlPct: number): EdgeBucket {
  const b = { ...bucket };
  b.count++;
  b.totalPnl += pnl;
  if (pnl > 0) b.wins++;
  else b.losses++;
  b.avgPnlPct = ((b.avgPnlPct * (b.count - 1)) + pnlPct) / b.count;
  return b;
}

// Compute full edge analytics
export function computeEdgeAnalytics(): EdgeAnalytics {
  if (edgeCache) return edgeCache;

  const analytics: EdgeAnalytics = {
    byHour: {},
    bySector: {},
    byFloatTier: {},
    byPETier: {},
    byRiskTier: {},
    byDayOfWeek: {},
    byEntryQuality: {},
    bySignalType: {},
    slippage: { totalSlippage: 0, avgSlippagePct: 0, slippageByTier: {}, worstSlippage: null },
    bestHours: [],
    worstHours: [],
    bestSectors: [],
    autoRestrictions: [],
  };

  if (tradeRecords.length === 0) {
    edgeCache = analytics;
    return analytics;
  }

  let totalSlippage = 0;
  let slippageCount = 0;

  for (const trade of tradeRecords) {
    // By hour
    if (!analytics.byHour[trade.hour]) analytics.byHour[trade.hour] = emptyBucket();
    analytics.byHour[trade.hour] = addToBucket(analytics.byHour[trade.hour], trade.pnl, trade.pnlPct);

    // By day of week
    if (!analytics.byDayOfWeek[trade.dayOfWeek]) analytics.byDayOfWeek[trade.dayOfWeek] = emptyBucket();
    analytics.byDayOfWeek[trade.dayOfWeek] = addToBucket(analytics.byDayOfWeek[trade.dayOfWeek], trade.pnl, trade.pnlPct);

    // By sector
    const sec = trade.sector || "unknown";
    if (!analytics.bySector[sec]) analytics.bySector[sec] = emptyBucket();
    analytics.bySector[sec] = addToBucket(analytics.bySector[sec], trade.pnl, trade.pnlPct);

    // By float tier
    const ft = trade.floatTier || "unknown";
    if (!analytics.byFloatTier[ft]) analytics.byFloatTier[ft] = emptyBucket();
    analytics.byFloatTier[ft] = addToBucket(analytics.byFloatTier[ft], trade.pnl, trade.pnlPct);

    // By PE tier
    const pt = trade.peScore !== undefined ? getPETier(trade.peScore) : "unknown";
    if (!analytics.byPETier[pt]) analytics.byPETier[pt] = emptyBucket();
    analytics.byPETier[pt] = addToBucket(analytics.byPETier[pt], trade.pnl, trade.pnlPct);

    // By risk tier
    const rt = trade.riskTier || "unknown";
    if (!analytics.byRiskTier[rt]) analytics.byRiskTier[rt] = emptyBucket();
    analytics.byRiskTier[rt] = addToBucket(analytics.byRiskTier[rt], trade.pnl, trade.pnlPct);

    // By entry quality
    const eq = trade.entryQuality || "unknown";
    if (!analytics.byEntryQuality[eq]) analytics.byEntryQuality[eq] = emptyBucket();
    analytics.byEntryQuality[eq] = addToBucket(analytics.byEntryQuality[eq], trade.pnl, trade.pnlPct);

    // By signal type
    const st = trade.signalType || "unknown";
    if (!analytics.bySignalType[st]) analytics.bySignalType[st] = emptyBucket();
    analytics.bySignalType[st] = addToBucket(analytics.bySignalType[st], trade.pnl, trade.pnlPct);

    // Slippage
    const slippagePct = Math.abs(trade.filledPrice - trade.signalPrice) / trade.signalPrice * 100;
    const slippageCost = Math.abs(trade.filledPrice - trade.signalPrice) * (trade.pnl !== 0 ? Math.abs(trade.pnl / trade.pnlPct * 100 / trade.filledPrice) : 1);
    totalSlippage += slippageCost;
    slippageCount++;

    // Slippage by float tier
    if (!analytics.slippage.slippageByTier[ft]) analytics.slippage.slippageByTier[ft] = { avgPct: 0, count: 0, totalCost: 0 };
    const st2 = analytics.slippage.slippageByTier[ft];
    st2.count++;
    st2.totalCost += slippageCost;
    st2.avgPct = ((st2.avgPct * (st2.count - 1)) + slippagePct) / st2.count;

    if (!analytics.slippage.worstSlippage || slippagePct > analytics.slippage.worstSlippage.pct) {
      analytics.slippage.worstSlippage = { symbol: trade.symbol, pct: slippagePct, cost: slippageCost };
    }
  }

  analytics.slippage.totalSlippage = totalSlippage;
  analytics.slippage.avgSlippagePct = slippageCount > 0 ? totalSlippage / slippageCount : 0;

  // Find best/worst hours (min 3 trades)
  const hourEntries = Object.entries(analytics.byHour)
    .filter(([, b]) => b.count >= 3)
    .map(([h, b]) => ({ hour: parseInt(h), winRate: b.wins / b.count, avgPnl: b.avgPnlPct, count: b.count }));
  
  hourEntries.sort((a, b) => b.avgPnl - a.avgPnl);
  analytics.bestHours = hourEntries.filter(h => h.winRate > 0.5).slice(0, 3).map(h => h.hour);
  analytics.worstHours = hourEntries.filter(h => h.winRate < 0.4).slice(-3).map(h => h.hour);

  // Best sectors
  const sectorEntries = Object.entries(analytics.bySector)
    .filter(([, b]) => b.count >= 3)
    .map(([s, b]) => ({ sector: s, winRate: b.wins / b.count, avgPnl: b.avgPnlPct }));
  sectorEntries.sort((a, b) => b.avgPnl - a.avgPnl);
  analytics.bestSectors = sectorEntries.filter(s => s.winRate > 0.5).slice(0, 3).map(s => s.sector);

  // Auto-restrictions (ban dimensions with <35% win rate and 5+ trades)
  for (const [hour, bucket] of Object.entries(analytics.byHour)) {
    const wr = bucket.count > 0 ? bucket.wins / bucket.count : 0;
    if (bucket.count >= 5 && wr < 0.35) {
      analytics.autoRestrictions.push({
        type: "hour", value: hour, reason: `${(wr * 100).toFixed(0)}% win rate at hour ${hour}`,
        winRate: wr, sampleSize: bucket.count,
      });
    }
  }
  for (const [sector, bucket] of Object.entries(analytics.bySector)) {
    const wr = bucket.count > 0 ? bucket.wins / bucket.count : 0;
    if (bucket.count >= 5 && wr < 0.35) {
      analytics.autoRestrictions.push({
        type: "sector", value: sector, reason: `${(wr * 100).toFixed(0)}% win rate in ${sector}`,
        winRate: wr, sampleSize: bucket.count,
      });
    }
  }
  for (const [ft, tier] of Object.entries(analytics.slippage.slippageByTier)) {
    if (tier.count >= 5 && tier.avgPct > 0.5) {
      analytics.autoRestrictions.push({
        type: "float", value: ft, reason: `High slippage ${tier.avgPct.toFixed(2)}% on ${ft} float stocks`,
        winRate: 0, sampleSize: tier.count,
      });
    }
  }

  edgeCache = analytics;
  return analytics;
}

// ─── Smart Exit Signals ───

export interface SmartExitSignal {
  type: "time_exit" | "momentum_fade" | "vwap_reject" | "micro_flip" | "stale_position";
  action: "close" | "tighten_trail" | "move_to_breakeven";
  reason: string;
  urgency: number; // 0-100
  newTrailingPct?: number;
}

/**
 * Check if a position should be exited early based on smart signals.
 * Returns null if no exit needed.
 */
export function checkSmartExit(
  side: "long" | "short",
  entryPrice: number,
  currentPrice: number,
  holdTimeMs: number,
  stopLossPct: number,
  takeProfitPct: number,
  microPredictions?: ShortTermPrediction[],
  klineData?: Array<{ close: number; volume: number; high: number; low: number }>,
): SmartExitSignal | null {
  const holdMinutes = holdTimeMs / 60000;
  const pnlPct = side === "long"
    ? ((currentPrice - entryPrice) / entryPrice) * 100
    : ((entryPrice - currentPrice) / entryPrice) * 100;

  // 1. Time-based exit: hasn't hit 1R within 10 minutes → close at breakeven
  if (holdMinutes >= 10 && holdMinutes < 15 && pnlPct < stopLossPct * 0.3 && pnlPct > -stopLossPct * 0.5) {
    return {
      type: "time_exit",
      action: pnlPct > 0 ? "close" : "tighten_trail",
      reason: `10min elapsed, only ${pnlPct.toFixed(2)}% move (need ${stopLossPct.toFixed(1)}% for 1R)`,
      urgency: 60,
      newTrailingPct: 0.3,
    };
  }

  // 2. Stale position: 30+ min with <0.5% move
  if (holdMinutes >= 30 && Math.abs(pnlPct) < 0.5) {
    return {
      type: "stale_position",
      action: "close",
      reason: `${Math.floor(holdMinutes)}min held, only ${pnlPct.toFixed(2)}% move — dead money`,
      urgency: 70,
    };
  }

  // 3. Momentum fade: micro-predictions flip against position while profitable
  if (microPredictions && microPredictions.length >= 2 && pnlPct > 0.5) {
    const bearishCount = microPredictions.filter(p => 
      (side === "long" && p.direction === "down" && p.confidence > 60) ||
      (side === "short" && p.direction === "up" && p.confidence > 60)
    ).length;
    
    if (bearishCount >= 2) {
      return {
        type: "momentum_fade",
        action: "tighten_trail",
        reason: `${bearishCount}/${microPredictions.length} micro-preds flipped against ${side} position`,
        urgency: 75,
        newTrailingPct: 0.3,
      };
    }
  }

  // 4. VWAP rejection detection from kline data
  if (klineData && klineData.length >= 20) {
    let vwapNum = 0, vwapDen = 0;
    for (const k of klineData.slice(-20)) {
      const tp = (k.high + k.low + k.close) / 3;
      vwapNum += tp * k.volume;
      vwapDen += k.volume;
    }
    const vwap = vwapDen > 0 ? vwapNum / vwapDen : currentPrice;
    
    // Long position rejected at VWAP (price fell through)
    if (side === "long" && currentPrice < vwap * 0.997 && pnlPct < 0) {
      return {
        type: "vwap_reject",
        action: "tighten_trail",
        reason: `Price rejected below VWAP ($${vwap.toFixed(2)}) — bearish for long`,
        urgency: 65,
        newTrailingPct: 0.5,
      };
    }
    // Short position rejected at VWAP (price bounced above)
    if (side === "short" && currentPrice > vwap * 1.003 && pnlPct < 0) {
      return {
        type: "vwap_reject",
        action: "tighten_trail",
        reason: `Price bounced above VWAP ($${vwap.toFixed(2)}) — bullish for short`,
        urgency: 65,
        newTrailingPct: 0.5,
      };
    }
  }

  return null;
}

// ─── Multi-Timeframe Micro-Prediction Alignment ───

export interface MicroAlignment {
  aligned: boolean;
  direction: "bullish" | "bearish" | "mixed";
  agreementPct: number; // % of timeframes that agree
  avgConfidence: number;
  details: string;
}

/**
 * Checks if micro-predictions across multiple timeframes agree on direction.
 * Requires 2+ timeframes to agree for entry.
 */
export function checkMicroAlignment(predictions: ShortTermPrediction[]): MicroAlignment {
  if (!predictions || predictions.length < 2) {
    return { aligned: false, direction: "mixed", agreementPct: 0, avgConfidence: 0, details: "Insufficient predictions" };
  }

  const bullish = predictions.filter(p => p.direction === "up" && p.confidence > 55);
  const bearish = predictions.filter(p => p.direction === "down" && p.confidence > 55);
  const total = predictions.length;
  
  const bullPct = bullish.length / total;
  const bearPct = bearish.length / total;
  
  const avgConf = predictions.reduce((s, p) => s + p.confidence, 0) / total;

  if (bullPct >= 0.5 && bearish.length === 0) {
    return {
      aligned: true, direction: "bullish",
      agreementPct: bullPct * 100, avgConfidence: avgConf,
      details: `${bullish.length}/${total} TFs bullish (${bullish.map(p => p.timeframe).join(", ")})`,
    };
  }
  if (bearPct >= 0.5 && bullish.length === 0) {
    return {
      aligned: true, direction: "bearish",
      agreementPct: bearPct * 100, avgConfidence: avgConf,
      details: `${bearish.length}/${total} TFs bearish (${bearish.map(p => p.timeframe).join(", ")})`,
    };
  }
  
  return {
    aligned: false, direction: "mixed",
    agreementPct: Math.max(bullPct, bearPct) * 100, avgConfidence: avgConf,
    details: `Mixed: ${bullish.length} bull, ${bearish.length} bear, ${total - bullish.length - bearish.length} flat`,
  };
}

// ─── VWAP Reclaim Confirmation ───

/**
 * Check if price has reclaimed VWAP (for longs) or broken below (for shorts).
 * Returns true if entry is confirmed.
 */
export function checkVWAPReclaim(
  side: "long" | "short",
  currentPrice: number,
  klineData?: Array<{ close: number; volume: number; high: number; low: number }>,
): { confirmed: boolean; vwap: number; reason: string } {
  if (!klineData || klineData.length < 10) {
    return { confirmed: true, vwap: currentPrice, reason: "No kline data — VWAP check skipped" };
  }

  let vwapNum = 0, vwapDen = 0;
  for (const k of klineData.slice(-30)) {
    const tp = (k.high + k.low + k.close) / 3;
    vwapNum += tp * k.volume;
    vwapDen += k.volume;
  }
  const vwap = vwapDen > 0 ? vwapNum / vwapDen : currentPrice;
  
  if (side === "long") {
    const aboveVWAP = currentPrice > vwap * 1.001;
    return {
      confirmed: aboveVWAP,
      vwap,
      reason: aboveVWAP
        ? `Price $${currentPrice.toFixed(2)} above VWAP $${vwap.toFixed(2)} ✓`
        : `Price $${currentPrice.toFixed(2)} below VWAP $${vwap.toFixed(2)} — wait for reclaim`,
    };
  } else {
    const belowVWAP = currentPrice < vwap * 0.999;
    return {
      confirmed: belowVWAP,
      vwap,
      reason: belowVWAP
        ? `Price $${currentPrice.toFixed(2)} below VWAP $${vwap.toFixed(2)} ✓`
        : `Price $${currentPrice.toFixed(2)} above VWAP $${vwap.toFixed(2)} — wait for break`,
    };
  }
}

// ─── Edge-based auto-restriction check ───

/**
 * Check if the current trade context violates any learned edge restrictions.
 */
export function checkEdgeRestrictions(
  symbol: string,
  sector: string | undefined,
  floatTier: string | undefined,
  hour: number,
): { allowed: boolean; reason: string } {
  const analytics = computeEdgeAnalytics();
  
  for (const restriction of analytics.autoRestrictions) {
    if (restriction.type === "hour" && parseInt(restriction.value) === hour) {
      return { allowed: false, reason: `📊 Edge restriction: ${restriction.reason} (${restriction.sampleSize} trades)` };
    }
    if (restriction.type === "sector" && restriction.value === sector) {
      return { allowed: false, reason: `📊 Edge restriction: ${restriction.reason} (${restriction.sampleSize} trades)` };
    }
    if (restriction.type === "float" && restriction.value === floatTier) {
      return { allowed: false, reason: `📊 Edge restriction: ${restriction.reason} (${restriction.sampleSize} trades)` };
    }
  }
  
  return { allowed: true, reason: "" };
}
