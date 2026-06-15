import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { invokeAlpacaTrade } from "@/lib/alpacaAccount";
import { toast } from "sonner";
import { TickerData, isCryptoSymbol } from "@/hooks/useWebullData";
import { useAuth } from "@/contexts/AuthContext";
import { minTimeExitEdgePct } from "@/lib/tradeCosts";
import { isTradingAllowed, getMarketSession, isLunchHour, isPowerHour, isOpeningBell, getTimeOfDayContext, type MarketSession } from "@/lib/marketHours";
import { estimateFloat, detectCandlestickPatterns, patternEntryScore, formatPatternsForPrompt, type DetectedPattern } from "@/lib/stockAnalysis";
import { type Kline } from "@/hooks/useStockKlines";
import { getMicroPredictionScore } from "@/lib/microPredictions";
import { computeAdaptiveRisk, type AdaptiveRiskProfile, type StockContext } from "@/lib/adaptiveRisk";
import { 
  checkSmartExit, checkMicroAlignment, checkVWAPReclaim, checkEdgeRestrictions,
  recordTrade, loadTradeRecords, computeEdgeAnalytics, getFloatTier,
  type EdgeAnalytics, type TradeRecord,
} from "@/lib/tradeIntelligence";
import { recordOutcome, recordFillOutcome, extractActiveIndicators } from "@/lib/predictionIntelligence";
import {
  computeVolumeProfile, getVolumeProfileWeight, checkSignalExpiry,
  recordSignalForReplay, resolveSignalReplay, selectStrategyForRegime,
  computeMTFConfluence, checkCorrelationLimit, applyNewsSentimentWeight,
  getCachedAnalysis, setCachedAnalysis, computeCompositeQuality,
} from "@/lib/signalIntelligence";
import { logTradeEvent } from "@/lib/tradeEvents";
import { useMarketRegime, applyRegimeGate, type MarketRegime } from "@/hooks/useMarketRegime";

export interface AutoTradeConfig {
  enabled: boolean;
  confidenceThreshold: number;
  positionSizePct: number;
  stopLossPct: number;
  takeProfitPct: number;
  maxOpenPositions: number;
  cooldownSeconds: number;
  queueDelaySeconds: number;
  profitOnlyMode: boolean;
  trailingStopPct: number;
  minPrice: number;
  maxPrice: number;
  maxDailyLossPct: number;
  maxPortfolioRiskPct: number;
  requireMinRR: number;
  allHoursTrading: boolean;
  statEdgeEnabled: boolean;
  statEdgeThresholdReduction: number;
  // Intelligence features
  newsSentimentGating: boolean;
  multiTimeframeConfirmation: boolean;
  correlationFiltering: boolean;
  partialProfitTaking: boolean;
  partialProfitPct: number;
  fractionalShares: boolean;
  // Warrior Trading screening criteria
  warriorScreening: boolean;
  minRelativeVolume: number;
  minGainerPct: number;
  requireCatalyst: boolean;
  maxFloat: number;
  sweetSpotPricing: boolean;
  // Alpaca live trading
  alpacaEnabled: boolean;
  alpacaMode: "paper" | "live";
  // NEW: Market regime & smart features
  regimeDetection: boolean;
  avoidLunchHour: boolean;
  atrBasedStops: boolean;
  atrMultiplier: number;
  tieredScaleOut: boolean;
  performanceFeedback: boolean;
  feedbackLookback: number;
  // Adaptive risk
  adaptiveRisk: boolean;
  // Smart entry/exit intelligence
  smartExits: boolean;
  microAlignmentRequired: boolean;
  vwapReclaim: boolean;
  edgeRestrictions: boolean;
  slippageTracking: boolean;
  // === v3 Edge Improvements (data-driven) ===
  hardConfidenceFloor: number; // never trade below this conf, even with stat-edge boost
  bearishCryptoBlock: boolean; // block sell signals on crypto (Alpaca can't short)
  bearishStockWeight: number; // multiply confidence on bearish stock signals (0-1)
  tieredSizingByConfidence: boolean; // scale position size by confidence bucket
  blockCryptoMeanReversion: boolean; // disable mean-revert preset on crypto (proven 0% WR in our data)
  afterHoursCryptoOnlyMode: boolean; // outside US market hours, only trade crypto
  // === Passive-Income Tier Improvements ===
  dynamicSizingEnabled: boolean;     // grade-based size multipliers
  gradeASizeMult: number;            // multiplier for A/A+ grade entries
  gradeBSizeMult: number;            // multiplier for B/C grade entries
  trailingTpEnabled: boolean;        // lock partial profits + trail remainder
  trailingTpLockPct: number;         // % of position to lock at 1R
  primeWindowOnly: boolean;          // only trade open + power hour
  sectorRotationFilter: boolean;     // only trade top-performing sectors today
  newsSentimentGate: boolean;        // block entries on stocks with recent negative news
  vwapReclaimRequired: boolean;      // require VWAP reclaim before entering
  profitLockEnabled: boolean;        // tighten kill-switch after daily profit target
  profitLockTargetPct: number;       // daily profit % that triggers profit-lock
  profitLockGivebackPct: number;     // max giveback from peak daily P&L
  autoScaleEnabled: boolean;         // grow position size as equity grows
  autoScaleBaselineEquity: number | null;
  mondayRule: "normal" | "reduce_50" | "skip";
}

export interface StatEdge {
  volumeSpike: boolean;
  momentumAnomaly: boolean;
  rangeBreakout: boolean;
  sectorDivergence: boolean;
  score: number; // 0-100
  triggers: string[];
}

export interface AutoTradeLog {
  id: string;
  timestamp: number;
  symbol: string;
  action: "open" | "close" | "skip" | "alert";
  side?: "long" | "short";
  price: number;
  reason: string;
  confidence?: number;
  pnl?: number;
}

export interface AutoTradeStats {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  totalPnl: number;
  bestTrade: number;
  worstTrade: number;
  avgConfidence: number;
  sessionStart: number;
  dailyPnl: number;
  maxDrawdown: number;
  sharpeEstimate: number;
  profitFactor: number;
  consecutiveLosses: number;
  kellyFraction: number;
  avgHoldTime: number;
  tradesSkipped: number;
  statEdgeTrades: number;
  // NEW
  marketRegime: string;
  feedbackAdjustment: number;
  atrStopDistance: number;
  tierExits: { tier1: number; tier2: number; tier3: number };
  activeRiskProfile: AdaptiveRiskProfile | null;
}

// === Kill-switch (passive trading safety) ===
export interface KillSwitchState {
  active: boolean;
  reason: string;
  trippedAt: number | null;
  tradesToday: number;
  dayStartTs: number;
  dayStartEquity: number;
  peakDailyPnl: number;          // running peak daily P&L %
  profitLockArmed: boolean;      // true once profit-lock target hit
  lastEvaluatedTradeCount: number;
}

export const KILL_SWITCH_LIMITS = {
  maxDailyDrawdownPct: 3,        // 3% daily drawdown
  maxConsecutiveLosses: 3,       // 3 losses in a row
  maxSingleTradeLossPct: 1.5,    // 1.5% single-trade loss
  maxTradesPerDay: 5,            // focus on 5 best trades
} as const;

export type LossLimitCallback = (message: string, severity: "warning" | "error") => void;

const DEFAULT_CONFIG: AutoTradeConfig = {
  enabled: false,
  confidenceThreshold: 70, // raised 55→70 (sub-70 had 28% WR in review)
  positionSizePct: 5,
  stopLossPct: 2,
  takeProfitPct: 5,
  maxOpenPositions: 3,
  cooldownSeconds: 60,
  queueDelaySeconds: 10,
  profitOnlyMode: false,
  trailingStopPct: 1,
  minPrice: 1,
  maxPrice: 10000,
  maxDailyLossPct: 5,
  maxPortfolioRiskPct: 20,
  requireMinRR: 2.0,
  allHoursTrading: true,
  statEdgeEnabled: true,
  statEdgeThresholdReduction: 15,
  newsSentimentGating: true,
  multiTimeframeConfirmation: true,
  correlationFiltering: true,
  partialProfitTaking: true,
  partialProfitPct: 50,
  fractionalShares: true,
  warriorScreening: false,
  minRelativeVolume: 5,
  minGainerPct: 10,
  requireCatalyst: true,
  maxFloat: 10,
  sweetSpotPricing: true,
  alpacaEnabled: false,
  alpacaMode: "paper",
  // New smart features
  regimeDetection: true,
  avoidLunchHour: true,
  atrBasedStops: true,
  atrMultiplier: 2.0,
  tieredScaleOut: true,
  performanceFeedback: true,
  feedbackLookback: 20,
  adaptiveRisk: true,
  smartExits: true,
  microAlignmentRequired: true,
  vwapReclaim: true,
  edgeRestrictions: true,
  slippageTracking: true,
  // v3 edge improvements
  hardConfidenceFloor: 65,
  bearishCryptoBlock: true,
  bearishStockWeight: 0.7,
  tieredSizingByConfidence: true,
  blockCryptoMeanReversion: true,
  afterHoursCryptoOnlyMode: true,
  // Passive-Income Tier — smart defaults: safety ON, aggressive OFF
  dynamicSizingEnabled: true,
  gradeASizeMult: 2.0,
  gradeBSizeMult: 0.5,
  trailingTpEnabled: true,
  trailingTpLockPct: 33,
  primeWindowOnly: true,
  sectorRotationFilter: false,
  newsSentimentGate: true,
  vwapReclaimRequired: false,
  profitLockEnabled: true,
  profitLockTargetPct: 2.0,
  profitLockGivebackPct: 0.5,
  autoScaleEnabled: false,
  autoScaleBaselineEquity: null,
  mondayRule: "reduce_50",
};

// Track rolling averages for statistical anomaly detection
const rollingVolumeMap: Record<string, number[]> = {};
const rollingChangeMap: Record<string, number[]> = {};
const ROLLING_WINDOW = 20;
let aiCreditsExhausted = false;
let aiCreditsExhaustedAt = 0;

function updateRolling(map: Record<string, number[]>, symbol: string, value: number) {
  if (!map[symbol]) map[symbol] = [];
  map[symbol].push(value);
  if (map[symbol].length > ROLLING_WINDOW) map[symbol].shift();
}

function getRollingAvg(map: Record<string, number[]>, symbol: string): number {
  const arr = map[symbol];
  if (!arr || arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function getRollingStdDev(map: Record<string, number[]>, symbol: string): number {
  const arr = map[symbol];
  if (!arr || arr.length < 3) return 0;
  const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = arr.reduce((sum, v) => sum + (v - avg) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}

function detectStatEdge(ticker: TickerData, allTickers: Record<string, TickerData>): StatEdge {
  const symbol = ticker.symbol?.replace("USDT", "") || "";
  const price = parseFloat(ticker.price) || 0;
  const volume = parseFloat(ticker.volume?.replace(/[^\d.]/g, '') || '0') || 0;
  const changePct = parseFloat(ticker.priceChangePercent) || 0;
  const high = parseFloat(ticker.high) || price;
  const low = parseFloat(ticker.low) || price;
  const range = high - low;
  const rangePos = range > 0 ? ((price - low) / range) * 100 : 50;

  // Update rolling data
  updateRolling(rollingVolumeMap, symbol, volume);
  updateRolling(rollingChangeMap, symbol, Math.abs(changePct));

  const triggers: string[] = [];
  let score = 0;

  // 1. Volume spike: current volume > 2x rolling average
  const avgVol = getRollingAvg(rollingVolumeMap, symbol);
  const volStdDev = getRollingStdDev(rollingVolumeMap, symbol);
  const volumeSpike = avgVol > 0 && volume > avgVol + 2 * Math.max(volStdDev, avgVol * 0.3);
  if (volumeSpike) {
    const ratio = (volume / avgVol).toFixed(1);
    triggers.push(`Volume spike: ${ratio}x avg`);
    score += 30;
  }

  // 2. Momentum anomaly: change significantly exceeds rolling average
  const avgChange = getRollingAvg(rollingChangeMap, symbol);
  const changeStdDev = getRollingStdDev(rollingChangeMap, symbol);
  const momentumAnomaly = avgChange > 0 && Math.abs(changePct) > avgChange + 1.5 * Math.max(changeStdDev, 0.5);
  if (momentumAnomaly) {
    triggers.push(`Momentum anomaly: ${changePct.toFixed(2)}% vs avg ${avgChange.toFixed(2)}%`);
    score += 25;
  }

  // 3. Range breakout: price at extreme of daily range with momentum
  const rangeBreakout = (rangePos > 95 && changePct > 1) || (rangePos < 5 && changePct < -1);
  if (rangeBreakout) {
    triggers.push(`Range breakout: ${rangePos.toFixed(0)}% position, ${changePct > 0 ? "bullish" : "bearish"} momentum`);
    score += 20;
  }

  // 4. Sector divergence: stock moves opposite to sector average
  const sector = SECTOR_MAP[symbol] || "unknown";
  if (sector !== "unknown") {
    const sectorChanges: number[] = [];
    for (const [sym, t] of Object.entries(allTickers)) {
      const s = sym.replace("USDT", "");
      if (SECTOR_MAP[s] === sector && s !== symbol) {
        sectorChanges.push(parseFloat(t.priceChangePercent) || 0);
      }
    }
    if (sectorChanges.length >= 2) {
      const sectorAvg = sectorChanges.reduce((a, b) => a + b, 0) / sectorChanges.length;
      const divergence = Math.abs(changePct - sectorAvg);
      const sectorDivergence = divergence > 2 && Math.sign(changePct) !== Math.sign(sectorAvg);
      if (sectorDivergence) {
        triggers.push(`Sector divergence: ${changePct.toFixed(1)}% vs ${sector} avg ${sectorAvg.toFixed(1)}%`);
        score += 25;
      }
    }
  }

  return {
    volumeSpike,
    momentumAnomaly,
    rangeBreakout,
    sectorDivergence: triggers.some(t => t.includes("Sector")),
    score: Math.min(score, 100),
    triggers,
  };
}

// Sector mapping for anti-correlation
const SECTOR_MAP: Record<string, string> = {
  // Tech
  AAPL: "tech", MSFT: "tech", NVDA: "tech", GOOGL: "tech", META: "tech", AMZN: "tech", TSLA: "tech",
  AVGO: "tech", ADBE: "tech", CRM: "tech", AMD: "tech", INTC: "tech", ORCL: "tech", NFLX: "tech",
  CSCO: "tech", QCOM: "tech", INTU: "tech", AMAT: "tech", NOW: "tech", UBER: "tech", SQ: "tech",
  SHOP: "tech", SNOW: "tech", PANW: "tech", CRWD: "tech", MRVL: "tech", MU: "tech", LRCX: "tech",
  IBM: "tech", TXN: "tech", KLAC: "tech", SNPS: "tech", CDNS: "tech", ADSK: "tech", WDAY: "tech",
  ZS: "tech", DDOG: "tech", NET: "tech", FTNT: "tech", TEAM: "tech", DOCN: "tech", TTD: "tech",
  SPOT: "tech", ROKU: "tech", TWLO: "tech", OKTA: "tech", MDB: "tech", ABNB: "tech", DASH: "tech",
  PINS: "tech", SNAP: "tech", U: "tech", PATH: "tech", BILL: "tech", HUBS: "tech", ZM: "tech",
  DELL: "tech", HPE: "tech", GDDY: "tech", PLTR: "tech", ARM: "tech", SMCI: "tech", MSTR: "tech",
  RKLB: "tech", IONQ: "tech", HOOD: "tech", APP: "tech", TOST: "tech",
  ON: "tech", MPWR: "tech", SWKS: "tech", MCHP: "tech", GFS: "tech", WOLF: "tech", CRUS: "tech", MTSI: "tech",
  VEEV: "tech", PAYC: "tech", PCOR: "tech", ESTC: "tech", CFLT: "tech", S: "tech", GTLB: "tech",
  MNDY: "tech", AI: "tech", BIGC: "tech", CYBR: "tech", VRNS: "tech", RPD: "tech", TENB: "tech",
  ANET: "tech", VRT: "tech", AMBA: "tech", TWST: "tech",
  // AI / Quantum / Space
  SOUN: "tech", RGTI: "tech", QUBT: "tech", BBAI: "tech", APLD: "tech",
  LUNR: "industrial", ASTS: "tech", JOBY: "industrial", RCAT: "industrial", KTOS: "industrial",
  DNA: "healthcare", AEHR: "tech", KULR: "tech", GSAT: "telecom",
  // Finance
  JPM: "finance", GS: "finance", BAC: "finance", MS: "finance", WFC: "finance", V: "finance", MA: "finance",
  AXP: "finance", BLK: "finance", SCHW: "finance", C: "finance", COIN: "finance", PYPL: "finance",
  USB: "finance", PNC: "finance", TFC: "finance", CME: "finance", ICE: "finance", SPGI: "finance",
  MCO: "finance", MMC: "finance", AON: "finance", FIS: "finance", AFRM: "finance",
  UPST: "finance", NU: "finance", FOUR: "finance", RELY: "finance", GLBE: "finance",
  PGR: "finance", TRV: "finance", ALL: "finance", MET: "finance", AFL: "finance",
  // Healthcare
  JNJ: "healthcare", UNH: "healthcare", LLY: "healthcare", PFE: "healthcare", ABBV: "healthcare",
  MRK: "healthcare", TMO: "healthcare", ABT: "healthcare", BMY: "healthcare", AMGN: "healthcare",
  ISRG: "healthcare", GILD: "healthcare", NVO: "healthcare", DHR: "healthcare", SYK: "healthcare",
  BSX: "healthcare", MDT: "healthcare", ELV: "healthcare", HUM: "healthcare", CI: "healthcare",
  ZTS: "healthcare", REGN: "healthcare", VRTX: "healthcare", MRNA: "healthcare", DXCM: "healthcare",
  BIIB: "healthcare", ALNY: "healthcare", EXAS: "healthcare", NBIX: "healthcare", HALO: "healthcare",
  SRPT: "healthcare", PCVX: "healthcare", LEGN: "healthcare", ARGX: "healthcare", UTHR: "healthcare",
  // Energy
  XOM: "energy", CVX: "energy", COP: "energy", SLB: "energy", EOG: "energy",
  OXY: "energy", PSX: "energy", VLO: "energy", MPC: "energy", HAL: "energy",
  DVN: "energy", FANG: "energy", KMI: "energy", WMB: "energy", VST: "energy", CEG: "energy",
  // Nuclear
  NNE: "energy", OKLO: "energy", SMR: "energy", LEU: "energy", CCJ: "energy", UEC: "energy",
  // Consumer
  WMT: "consumer", KO: "consumer", PEP: "consumer", COST: "consumer", MCD: "consumer",
  SBUX: "consumer", NKE: "consumer", DIS: "consumer", PG: "consumer", HD: "consumer",
  TGT: "consumer", LOW: "consumer", CMCSA: "consumer", CL: "consumer", EL: "consumer",
  MNST: "consumer", STZ: "consumer", GIS: "consumer", KHC: "consumer", SYY: "consumer",
  ROST: "consumer", TJX: "consumer", LULU: "consumer", YUM: "consumer", CMG: "consumer",
  DHI: "consumer", LEN: "consumer", CELH: "consumer", CAVA: "consumer", DECK: "consumer", CVNA: "consumer",
  ETSY: "consumer", W: "consumer", CHWY: "consumer", DKNG: "consumer", PENN: "consumer",
  MGM: "consumer", WYNN: "consumer", RCL: "consumer", CCL: "consumer", MAR: "consumer", HLT: "consumer",
  ULTA: "consumer", DG: "consumer", DLTR: "consumer", BBY: "consumer", AZO: "consumer", ORLY: "consumer", GPS: "consumer",
  ADM: "consumer", BG: "consumer", TSN: "consumer", HRL: "consumer", MKC: "consumer",
  // Automotive
  F: "consumer", GM: "consumer", STLA: "consumer", TM: "consumer", HMC: "consumer", RACE: "consumer",
  // Media / Entertainment
  WBD: "consumer", PARA: "consumer", RBLX: "tech", TTWO: "tech", EA: "tech", ATVI: "tech",
  // Industrial
  BA: "industrial", GE: "industrial", CAT: "industrial", HON: "industrial", UNP: "industrial",
  RTX: "industrial", LMT: "industrial", GD: "industrial", NOC: "industrial", DE: "industrial",
  UPS: "industrial", MMM: "industrial", EMR: "industrial", ITW: "industrial", ROK: "industrial",
  ETN: "industrial", PH: "industrial", WM: "industrial", FDX: "industrial", GEV: "industrial",
  DAL: "industrial", UAL: "industrial", LUV: "industrial", AXON: "industrial",
  // Materials & Mining
  LIN: "materials", APD: "materials", SHW: "materials", ECL: "materials",
  NUE: "materials", FCX: "materials", AA: "materials",
  TMC: "materials", MP: "materials", LAC: "materials", VALE: "materials",
  RIO: "materials", BHP: "materials", CLF: "materials", X: "materials", SCCO: "materials",
  // Telecom/Utilities
  T: "telecom", VZ: "telecom", NEE: "utilities",
  DUK: "utilities", SO: "utilities", D: "utilities", AEP: "utilities", EXC: "utilities",
  XEL: "utilities", AES: "utilities",
  // REITs
  AMT: "realestate", PLD: "realestate", CCI: "realestate", EQIX: "realestate", O: "realestate",
  // Crypto Mining
  WULF: "tech", BTBT: "tech", CLSK: "tech", CIFR: "tech", MARA: "tech", RIOT: "tech", HUT: "tech", BITF: "tech", IREN: "tech",
  // Clean Energy / EV
  FSLR: "energy", ENPH: "energy", SEDG: "energy", PLUG: "energy", CHPT: "energy",
  QS: "tech", NIO: "consumer", XPEV: "consumer", LI: "consumer",
  // Cannabis
  TLRY: "consumer", CGC: "consumer", SNDL: "consumer",
  // International ADRs
  BABA: "tech", PDD: "consumer", JD: "consumer", BIDU: "tech", SE: "tech", GRAB: "tech", MELI: "consumer", TSM: "tech",
  // Other
  SOFI: "finance", RIVN: "consumer", LCID: "consumer", DUOL: "tech", FICO: "tech",
  OPEN: "realestate", IRDM: "telecom",
};

function simulateSlippage(price: number, side: "long" | "short", volatilityPct: number): number {
  const spreadPct = Math.max(0.02, Math.min(0.1, volatilityPct * 0.02));
  const randomSlip = Math.random() * 0.05;
  const totalSlipPct = (spreadPct + randomSlip) / 100;
  if (side === "long") return price * (1 + totalSlipPct);
  return price * (1 - totalSlipPct);
}

// === ENHANCED LOCAL TECHNICAL ANALYSIS SIGNAL GENERATOR ===
// Uses multi-indicator confluence scoring like the strategy engine
function generateLocalTASignal(
  ticker: TickerData,
  allTickers: Record<string, TickerData>,
  candlePatterns: DetectedPattern[],
  patternScore: number,
  statEdge: StatEdge,
  floatEst: { floatM: number; source: string; isLowFloat: boolean; turnoverRatio: number },
  klineData?: Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }>
): { signal: string; confidence: number; risk_reward_ratio: number; entry_quality: string; reasoning: string; volatility_warning?: boolean; strategy_entry?: number; strategy_sl?: number; strategy_tp?: number } | null {
  const price = parseFloat(ticker.price) || 0;
  const changePct = parseFloat(ticker.priceChangePercent) || 0;
  const high = parseFloat(ticker.high) || price;
  const low = parseFloat(ticker.low) || price;
  const range = high - low;
  const rangePos = range > 0 ? ((price - low) / range) * 100 : 50;
  const volume = parseFloat(ticker.volume?.replace(/[^\d.]/g, '') || '0') || 0;
  const symbol = ticker.symbol?.replace("USDT", "") || "";

  let score = 0; // -100 to +100
  let reasons: string[] = [];
  let rr = 1.0;
  let stratEntry: number | undefined;
  let stratSL: number | undefined;
  let stratTP: number | undefined;

  // === STRATEGY ENGINE INDICATORS (when kline data available) ===
  if (klineData && klineData.length >= 20) {
    const closes = klineData.map(k => k.close);
    const volumes = klineData.map(k => k.volume);
    const n = closes.length;

    // EMA 9 & 21
    const emaCalc = (arr: number[], period: number) => {
      const k = 2 / (period + 1);
      let e = arr[0];
      for (let i = 1; i < arr.length; i++) e = arr[i] * k + e * (1 - k);
      return e;
    };
    const ema9 = emaCalc(closes, 9);
    const ema21 = emaCalc(closes, 21);

    // RSI
    let gains = 0, losses = 0;
    const rsiPeriod = Math.min(14, n - 1);
    for (let i = n - rsiPeriod; i < n; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff > 0) gains += diff; else losses -= diff;
    }
    const rs = losses > 0 ? (gains / rsiPeriod) / (losses / rsiPeriod) : 100;
    const rsi = 100 - (100 / (1 + rs));

    // MACD
    const macdLine = emaCalc(closes, 12) - emaCalc(closes, 26);

    // ATR
    const atrPeriod = Math.min(14, n - 1);
    let atrSum = 0;
    for (let i = n - atrPeriod; i < n; i++) {
      const prev = klineData[i - 1]?.close || klineData[i].open;
      const tr = Math.max(klineData[i].high - klineData[i].low, Math.abs(klineData[i].high - prev), Math.abs(klineData[i].low - prev));
      atrSum += tr;
    }
    const atr = atrSum / atrPeriod;

    // VWAP
    let vwapNum = 0, vwapDen = 0;
    for (const k of klineData.slice(-30)) {
      const tp = (k.high + k.low + k.close) / 3;
      vwapNum += tp * k.volume;
      vwapDen += k.volume;
    }
    const vwap = vwapDen > 0 ? vwapNum / vwapDen : price;

    // Bollinger Bands
    const sma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, n);
    const bbStdDev = Math.sqrt(closes.slice(-20).reduce((sum, c) => sum + (c - sma20) ** 2, 0) / Math.min(20, n));
    const bbUpper = sma20 + 2 * bbStdDev;
    const bbLower = sma20 - 2 * bbStdDev;
    const bbPosition = bbStdDev > 0 ? (price - bbLower) / (bbUpper - bbLower) * 100 : 50;

    // Volume Analysis
    const recentVol = volumes.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const avgVol20 = volumes.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, volumes.length);
    const relVol = avgVol20 > 0 ? recentVol / avgVol20 : 1;

    // Momentum acceleration (ROC of ROC)
    const roc5 = n >= 6 ? ((price - closes[n - 6]) / closes[n - 6]) * 100 : 0;
    const roc10 = n >= 11 ? ((price - closes[n - 11]) / closes[n - 11]) * 100 : 0;
    const roc5prev = n >= 7 ? ((closes[n - 2] - closes[n - 7]) / closes[n - 7]) * 100 : 0;
    const momentumAccelerating = roc5 > roc5prev && roc5 > 0;
    const momentumDecelerating = roc5 < roc5prev && roc5 > 0;

    // Trend alignment (EMA crossover)
    const trendUp = price > ema9 && ema9 > ema21 && price > sma20;
    const trendDown = price < ema9 && ema9 < ema21 && price < sma20;

    // === Multi-factor confluence scoring ===
    // Trend (+/- 3)
    if (trendUp) { score += 25; reasons.push(`Uptrend: EMA9 > EMA21, price above`); }
    else if (trendDown) { score -= 25; reasons.push(`Downtrend: EMA9 < EMA21`); }

    // VWAP (+/- 1.5)
    if (price > vwap * 1.003) { score += 12; reasons.push(`Above VWAP $${vwap.toFixed(2)}`); }
    else if (price < vwap * 0.997) { score -= 12; reasons.push(`Below VWAP`); }

    // RSI
    if (rsi > 75) { score -= 15; reasons.push(`RSI overbought ${rsi.toFixed(0)}`); }
    else if (rsi > 55 && rsi < 70) { score += 8; reasons.push(`RSI bullish ${rsi.toFixed(0)}`); }
    else if (rsi < 25) { score += 15; reasons.push(`RSI oversold ${rsi.toFixed(0)} bounce`); }
    else if (rsi < 45) { score -= 8; reasons.push(`RSI bearish ${rsi.toFixed(0)}`); }

    // Bollinger
    if (bbPosition < 15) { score += 10; reasons.push("Lower BB bounce zone"); rr += 0.3; }
    else if (bbPosition > 85) { score -= 10; reasons.push("Upper BB overextended"); }

    // MACD
    if (macdLine > 0) { score += 5; reasons.push("MACD bullish"); }
    else { score -= 5; reasons.push("MACD bearish"); }

    // Momentum acceleration
    if (momentumAccelerating) { score += 8; reasons.push("Momentum accelerating"); rr += 0.2; }
    else if (momentumDecelerating) { score -= 5; reasons.push("Momentum fading"); rr -= 0.2; }

    // Volume confirmation (stronger weight)
    if (relVol > 2.5) { score += Math.sign(score) * 15; reasons.push(`Volume spike ${relVol.toFixed(1)}x confirms`); rr += 0.3; }
    else if (relVol > 1.5) { score += Math.sign(score) * 8; reasons.push(`Above-avg vol ${relVol.toFixed(1)}x`); }
    else if (relVol < 0.6) { score -= 5; reasons.push("Low volume — weak"); }

    // Strategy-level entry/exit prices
    const nearestSupport = Math.min(...klineData.slice(-20).map(k => k.low));
    const nearestResistance = Math.max(...klineData.slice(-20).map(k => k.high));

    if (score > 0) {
      stratEntry = parseFloat((price * 0.999).toFixed(2));
      stratSL = parseFloat(Math.max(stratEntry - atr * 1.5, stratEntry * 0.97).toFixed(2));
      stratTP = parseFloat(Math.min(stratEntry + atr * 3, nearestResistance).toFixed(2));
      const calcRR = (stratTP - stratEntry) / Math.max(stratEntry - stratSL, 0.01);
      rr = Math.max(rr, calcRR);
    } else if (score < 0) {
      stratEntry = parseFloat((price * 1.001).toFixed(2));
      stratSL = parseFloat(Math.min(stratEntry + atr * 1.5, stratEntry * 1.03).toFixed(2));
      stratTP = parseFloat(Math.max(stratEntry - atr * 3, nearestSupport).toFixed(2));
      const calcRR = (stratEntry - stratTP) / Math.max(stratSL - stratEntry, 0.01);
      rr = Math.max(rr, calcRR);
    }
  } else {
    // Fallback to original simpler scoring when no kline data
    // 1. Momentum direction
    if (changePct > 2) { score += 20; reasons.push(`Strong momentum +${changePct.toFixed(1)}%`); }
    else if (changePct > 0.5) { score += 10; reasons.push(`Positive momentum +${changePct.toFixed(1)}%`); }
    else if (changePct < -2) { score -= 20; reasons.push(`Bearish momentum ${changePct.toFixed(1)}%`); }
    else if (changePct < -0.5) { score -= 10; reasons.push(`Negative drift ${changePct.toFixed(1)}%`); }

    // 2. Range position
    if (rangePos > 80 && changePct > 1) { score += 15; reasons.push("Breaking out of range"); rr += 0.5; }
    else if (rangePos < 30 && changePct > 0) { score += 10; reasons.push("Bouncing from lows"); rr += 0.3; }
    else if (rangePos > 90 && changePct < 0) { score -= 10; reasons.push("Failing at highs"); }

    // 6. Volume confirmation (original)
    const avgVol = getRollingAvg(rollingVolumeMap, symbol);
    if (avgVol > 0 && volume > avgVol * 2) {
      score += 15; reasons.push(`Volume ${(volume / avgVol).toFixed(1)}x average`);
    } else if (avgVol > 0 && volume < avgVol * 0.5) {
      score -= 10; reasons.push("Low volume — weak conviction");
    }
  }

  // 3. Candlestick pattern signals (always apply)
  if (patternScore > 30) { score += 25; reasons.push(`Strong bullish patterns (score ${patternScore})`); rr += 0.5; }
  else if (patternScore > 10) { score += 15; reasons.push(`Bullish patterns (score ${patternScore})`); rr += 0.3; }
  else if (patternScore < -30) { score -= 25; reasons.push(`Strong bearish patterns (score ${patternScore})`); }
  else if (patternScore < -10) { score -= 15; reasons.push(`Bearish patterns (score ${patternScore})`); }

  // 4. Warrior-quality pattern bonus
  const warriorPatterns = candlePatterns.filter(p =>
    p.type === "new_high_breakout" || p.type === "flat_top_breakout" || p.type === "bull_flag"
  );
  if (warriorPatterns.length > 0) {
    score += 20; rr += 0.5;
    reasons.push(`Warrior pattern: ${warriorPatterns[0].label}`);
  }

  // 5. Statistical edge
  if (statEdge.score >= 30) {
    score += Math.min(20, statEdge.score * 0.4);
    reasons.push(`Stat edge: ${statEdge.triggers.join(", ")}`);
    rr += 0.3;
  }

  // 7. Float-based scoring
  if (floatEst.isLowFloat && floatEst.turnoverRatio > 0.5) {
    score += 10;
    reasons.push(`Low float ${floatEst.floatM.toFixed(0)}M, turnover ${(floatEst.turnoverRatio * 100).toFixed(0)}%`);
  }

  // 8. Sector relative strength
  const sector = SECTOR_MAP[symbol];
  if (sector) {
    const sectorChanges: number[] = [];
    for (const [sym, t] of Object.entries(allTickers)) {
      const s = sym.replace("USDT", "");
      if (SECTOR_MAP[s] === sector && s !== symbol) {
        sectorChanges.push(parseFloat(t.priceChangePercent) || 0);
      }
    }
    if (sectorChanges.length >= 2) {
      const sectorAvg = sectorChanges.reduce((a, b) => a + b, 0) / sectorChanges.length;
      if (changePct > sectorAvg + 1) { score += 10; reasons.push(`Outperforming sector by ${(changePct - sectorAvg).toFixed(1)}%`); }
    }
  }

  // 9. Time-of-day bonus (power hour & opening bell get boost)
  if (isPowerHour()) { score += Math.sign(score || 1) * 5; reasons.push("Power hour volume boost"); }
  if (isOpeningBell()) { score += Math.sign(score || 1) * 3; reasons.push("Opening bell momentum"); }

  // 10. Micro-prediction confluence (short-term momentum from multi-indicator engine)
  if (klineData && klineData.length >= 20) {
    const microPred = getMicroPredictionScore(klineData, price);
    if (Math.abs(microPred.score) > 15) {
      const microBoost = Math.sign(microPred.score) * Math.min(15, Math.abs(microPred.score) * 0.2);
      // Only boost if prediction aligns with existing score direction (or score is near zero)
      if (Math.sign(microPred.score) === Math.sign(score) || Math.abs(score) < 10) {
        score += microBoost;
        rr += 0.2;
        reasons.push(`Micro-pred ${microPred.direction} (${microPred.confidence}% conf, ${microPred.reasoning.slice(0, 2).join(", ")})`);
      }
    }
  }

  // 11. Profit Expectancy score boost — leverages market-wide composite scoring
  const pe = ticker.profitExpectancy ?? 0;
  if (pe >= 75) {
    score += 12;
    rr += 0.3;
    reasons.push(`High PE score ${pe} — strong profit expectancy`);
  } else if (pe >= 55) {
    score += 6;
    rr += 0.15;
    reasons.push(`Moderate PE score ${pe}`);
  } else if (pe < 25) {
    score -= 8;
    reasons.push(`Low PE score ${pe} — weak expectancy`);
  }
  if (Math.abs(changePct) > 8) {
    return { signal: "hold", confidence: 30, risk_reward_ratio: 0.5, entry_quality: "D", reasoning: "Extreme volatility — standing aside", volatility_warning: true };
  }

  // Convert score to signal with improved confidence curve
  const absScore = Math.abs(score);
  // More granular confidence: base 35 + score*0.65 gives better spread
  const confidence = Math.min(95, 35 + absScore * 0.65);

  if (score >= 35) {
    return { signal: "strong_buy", confidence, risk_reward_ratio: Math.min(rr, 5), entry_quality: absScore > 60 ? "A" : absScore > 45 ? "B" : "C", reasoning: reasons.join("; "), strategy_entry: stratEntry, strategy_sl: stratSL, strategy_tp: stratTP };
  } else if (score >= 18) {
    return { signal: "buy", confidence, risk_reward_ratio: Math.min(rr, 3.5), entry_quality: absScore > 40 ? "B" : "C", reasoning: reasons.join("; "), strategy_entry: stratEntry, strategy_sl: stratSL, strategy_tp: stratTP };
  } else if (score <= -35) {
    return { signal: "strong_sell", confidence, risk_reward_ratio: Math.min(rr, 5), entry_quality: absScore > 60 ? "A" : absScore > 45 ? "B" : "C", reasoning: reasons.join("; "), strategy_entry: stratEntry, strategy_sl: stratSL, strategy_tp: stratTP };
  } else if (score <= -18) {
    return { signal: "sell", confidence, risk_reward_ratio: Math.min(rr, 3.5), entry_quality: absScore > 40 ? "B" : "C", reasoning: reasons.join("; "), strategy_entry: stratEntry, strategy_sl: stratSL, strategy_tp: stratTP };
  }

  // Not enough conviction
  return null;
}


const CORRELATION_GROUPS: Record<string, string[]> = {
  "mega_tech": ["AAPL", "MSFT", "GOOGL", "META", "AMZN"],
  "semiconductors": ["NVDA", "AMD", "AVGO", "QCOM", "MRVL", "MU", "INTC", "AMAT", "LRCX", "KLAC"],
  "ev_auto": ["TSLA", "RIVN", "LCID"],
  "banks": ["JPM", "BAC", "WFC", "C", "GS", "MS"],
  "payments": ["V", "MA", "PYPL", "SQ", "AFRM"],
  "cloud_saas": ["CRM", "NOW", "SNOW", "WDAY", "TEAM"],
  "cybersecurity": ["PANW", "CRWD", "ZS", "FTNT"],
  "streaming_social": ["NFLX", "DIS", "ROKU", "SNAP", "PINS"],
  "oil_gas": ["XOM", "CVX", "COP", "SLB", "EOG", "OXY"],
  "pharma": ["JNJ", "PFE", "MRK", "ABBV", "BMY", "LLY"],
  "defense": ["RTX", "LMT", "GD", "NOC", "BA"],
  "retail": ["WMT", "TGT", "COST", "HD", "LOW"],
  "food_bev": ["KO", "PEP", "MCD", "SBUX", "YUM"],
  "crypto_adjacent": ["COIN", "MSTR", "HOOD"],
};

function getCorrelationGroup(symbol: string): string | null {
  for (const [group, members] of Object.entries(CORRELATION_GROUPS)) {
    if (members.includes(symbol)) return group;
  }
  return null;
}

// Check if adding this position would violate correlation limits
function checkCorrelation(symbol: string, existingPositions: Array<{ symbol: string }>): { allowed: boolean; reason: string } {
  const group = getCorrelationGroup(symbol);
  if (!group) return { allowed: true, reason: "" };
  
  const groupPositions = existingPositions.filter(p => {
    const sym = p.symbol.replace("USDT", "");
    return CORRELATION_GROUPS[group]?.includes(sym);
  });
  
  // Max 1 position per correlation group
  if (groupPositions.length >= 1) {
    return { 
      allowed: false, 
      reason: `Correlation block: ${symbol} correlates with ${groupPositions[0].symbol} (${group} group)` 
    };
  }
  return { allowed: true, reason: "" };
}

// Multi-timeframe trend analysis using price data
function analyzeMultiTimeframe(ticker: TickerData, allTickers: Record<string, TickerData>): { aligned: boolean; direction: "bullish" | "bearish" | "mixed"; details: string } {
  const changePct = parseFloat(ticker.priceChangePercent) || 0;
  const price = parseFloat(ticker.price) || 0;
  const high = parseFloat(ticker.high) || price;
  const low = parseFloat(ticker.low) || price;
  const range = high - low;
  const rangePos = range > 0 ? ((price - low) / range) * 100 : 50;
  
  // Intraday trend (current range position)
  const intradayBullish = rangePos > 60;
  const intradayBearish = rangePos < 40;
  
  // Daily momentum (% change direction)
  const dailyBullish = changePct > 0.3;
  const dailyBearish = changePct < -0.3;
  
  // Sector momentum (proxy for weekly trend)
  const symbolClean = ticker.symbol?.replace("USDT", "") || "";
  const sector = SECTOR_MAP[symbolClean] || "unknown";
  const sectorChanges: number[] = [];
  for (const [sym, t] of Object.entries(allTickers)) {
    const s = sym.replace("USDT", "");
    if (SECTOR_MAP[s] === sector && s !== symbolClean) {
      sectorChanges.push(parseFloat(t.priceChangePercent) || 0);
    }
  }
  const sectorAvg = sectorChanges.length > 0 ? sectorChanges.reduce((a, b) => a + b, 0) / sectorChanges.length : 0;
  const sectorBullish = sectorAvg > 0.2;
  const sectorBearish = sectorAvg < -0.2;
  
  const bullishSignals = [intradayBullish, dailyBullish, sectorBullish].filter(Boolean).length;
  const bearishSignals = [intradayBearish, dailyBearish, sectorBearish].filter(Boolean).length;
  
  if (bullishSignals >= 2 && bearishSignals === 0) {
    return { aligned: true, direction: "bullish", details: `${bullishSignals}/3 bullish (intra=${rangePos.toFixed(0)}%, daily=${changePct.toFixed(1)}%, sector=${sectorAvg.toFixed(1)}%)` };
  }
  if (bearishSignals >= 2 && bullishSignals === 0) {
    return { aligned: true, direction: "bearish", details: `${bearishSignals}/3 bearish (intra=${rangePos.toFixed(0)}%, daily=${changePct.toFixed(1)}%, sector=${sectorAvg.toFixed(1)}%)` };
  }
  return { aligned: false, direction: "mixed", details: `Mixed signals: bull=${bullishSignals} bear=${bearishSignals} (intra=${rangePos.toFixed(0)}%, daily=${changePct.toFixed(1)}%, sector=${sectorAvg.toFixed(1)}%)` };
}

// Simple news sentiment scoring from recent news data
const newsSentimentCache: Record<string, { score: number; timestamp: number; reason: string }> = {};
const NEWS_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

async function checkNewsSentiment(symbol: string): Promise<{ sentiment: "positive" | "negative" | "neutral"; score: number; reason: string }> {
  // Check cache first
  const cached = newsSentimentCache[symbol];
  if (cached && Date.now() - cached.timestamp < NEWS_CACHE_TTL) {
    return { 
      sentiment: cached.score > 0.2 ? "positive" : cached.score < -0.2 ? "negative" : "neutral",
      score: cached.score,
      reason: cached.reason,
    };
  }
  
  try {
    const { data, error } = await supabase.functions.invoke("webull-scraper", {
      body: { type: "stock_news", symbol },
    });
    
    if (error || data?.error || !data?.news?.length) {
      return { sentiment: "neutral", score: 0, reason: "No recent news" };
    }
    
    const news = data.news as Array<{ title: string; category?: string }>;
    let score = 0;
    const reasons: string[] = [];
    
    for (const item of news.slice(0, 5)) {
      const title = item.title.toLowerCase();
      // Positive signals
      if (/beat|surge|record|upgrade|rally|strong|outperform|buy|bullish|growth|profit/.test(title)) {
        score += 0.2;
        reasons.push("+" + item.title.slice(0, 40));
      }
      // Negative signals
      if (/miss|plunge|downgrade|crash|sell|bearish|warning|layoff|lawsuit|fraud|decline|cut|weak/.test(title)) {
        score -= 0.3; // Negative news weighs more
        reasons.push("-" + item.title.slice(0, 40));
      }
    }
    
    const clamped = Math.max(-1, Math.min(1, score));
    const reason = reasons.length > 0 ? reasons.slice(0, 2).join("; ") : "Neutral news";
    
    newsSentimentCache[symbol] = { score: clamped, timestamp: Date.now(), reason };
    
    return { 
      sentiment: clamped > 0.2 ? "positive" : clamped < -0.2 ? "negative" : "neutral",
      score: clamped,
      reason,
    };
  } catch {
    return { sentiment: "neutral", score: 0, reason: "News check failed" };
  }
}

function scoreStock(ticker: TickerData): number {
  let score = 0;
  const price = parseFloat(ticker.price) || 0;
  const changePct = Math.abs(parseFloat(ticker.priceChangePercent) || 0);
  const volumeStr = ticker.volume?.replace(/[^\d.]/g, '') || '0';
  const volume = parseFloat(volumeStr) || 0;

  // === WARRIOR TRADING PRICE SWEET SPOT ($1-$20 most popular for retail) ===
  if (price >= 1 && price <= 20) score += 6;       // Warrior sweet spot
  else if (price >= 20 && price <= 300) score += 3;
  else if (price >= 5 && price <= 500) score += 2;
  else if (price > 500) score += 1;

  // === RELATIVE VOLUME: Higher is better (5x+ is ideal per Warrior Trading) ===
  const avgVol = getRollingAvg(rollingVolumeMap, ticker.symbol?.replace("USDT", "") || "");
  const relativeVolume = avgVol > 0 ? volume / avgVol : 1;
  if (relativeVolume >= 10) score += 8;    // Extreme volume = highest priority
  else if (relativeVolume >= 5) score += 6; // Warrior 5x threshold
  else if (relativeVolume >= 3) score += 3;
  else if (relativeVolume >= 1.5) score += 1;
  else score -= 1;

  // === ALREADY MOVING: Stocks already up 10%+ show strength (Warrior criteria) ===
  if (changePct >= 10) score += 6;          // Warrior 10% threshold
  else if (changePct >= 5) score += 3;
  else if (changePct >= 2) score += 2;
  else if (changePct >= 0.5 && changePct <= 3) score += 1;
  else if (changePct > 8 && changePct < 10) score += 0;

  // Volume absolute floor
  if (volume >= 10) score += 2;
  else if (volume >= 1) score += 1;
  else score -= 2;

  if (ticker.category === "gainer") score += 2;  // Gainers preferred
  if (ticker.category === "active") score += 1;
  if (price < 1) score -= 5;  // Penny stock penalty (under $1)

  // === TIME-OF-DAY BONUS ===
  if (isPowerHour()) score += 2;      // Last hour of trading: more volume, cleaner moves
  if (isOpeningBell()) score += 2;    // First 30 min: momentum plays

  return score;
}

// Warrior Trading screening gate — checks all 5 criteria including float
function passesWarriorScreen(ticker: TickerData, config: AutoTradeConfig, allTickers: Record<string, TickerData>): { pass: boolean; reason: string; floatInfo?: string } {
  if (!config.warriorScreening) return { pass: true, reason: "" };

  const price = parseFloat(ticker.price) || 0;
  const changePct = parseFloat(ticker.priceChangePercent) || 0;
  const symbol = ticker.symbol?.replace("USDT", "") || "";
  const volumeStr = ticker.volume?.replace(/[^\d.]/g, '') || '0';
  const volume = parseFloat(volumeStr) || 0;

  // 1. Relative Volume >= minRelativeVolume (default 5x)
  const avgVol = getRollingAvg(rollingVolumeMap, symbol);
  const relVol = avgVol > 0 ? volume / avgVol : 0;
  if (avgVol > 0 && relVol < config.minRelativeVolume) {
    return { pass: false, reason: `RelVol ${relVol.toFixed(1)}x < ${config.minRelativeVolume}x required` };
  }

  // 2. Already up minGainerPct% on the day
  if (changePct < config.minGainerPct) {
    return { pass: false, reason: `Only +${changePct.toFixed(1)}% (need +${config.minGainerPct}%)` };
  }

  // 3. Sweet spot pricing ($1-$20 preferred)
  if (config.sweetSpotPricing && (price < 1 || price > 20)) {
    return { pass: false, reason: `Price $${price.toFixed(2)} outside $1-$20 sweet spot` };
  }

  // 4. Float/supply check using estimation
  const floatEst = estimateFloat(symbol, price, ticker.volume || "0");
  const floatInfo = `Float: ${floatEst.floatM.toFixed(1)}M (${floatEst.source}), Turnover: ${(floatEst.turnoverRatio * 100).toFixed(0)}%`;
  
  if (config.maxFloat > 0 && floatEst.floatM > config.maxFloat) {
    return { pass: false, reason: `Float ${floatEst.floatM.toFixed(1)}M > ${config.maxFloat}M max`, floatInfo };
  }

  // Bonus: high turnover ratio (volume > float) = extreme demand
  const turnoverNote = floatEst.turnoverRatio > 1 
    ? ` 🔥 ${(floatEst.turnoverRatio * 100).toFixed(0)}% turnover!` 
    : "";

  return { 
    pass: true, 
    reason: `✅ Warrior screen: RelVol ${relVol.toFixed(1)}x, +${changePct.toFixed(1)}%, $${price.toFixed(2)}, ${floatInfo}${turnoverNote}`,
    floatInfo,
  };
}

// === ATR (Average True Range) estimation from rolling data ===
const rollingATR: Record<string, number[]> = {};

function estimateATR(symbol: string, price: number, high: number, low: number): number {
  const tr = high - low; // Simplified true range from daily H/L
  const key = symbol.replace("USDT", "");
  if (!rollingATR[key]) rollingATR[key] = [];
  rollingATR[key].push(tr);
  if (rollingATR[key].length > 14) rollingATR[key].shift();
  if (rollingATR[key].length === 0) return tr;
  return rollingATR[key].reduce((a, b) => a + b, 0) / rollingATR[key].length;
}

function getATRStopPct(atr: number, price: number, multiplier: number): number {
  if (price <= 0) return 2; // fallback
  return Math.max(0.5, Math.min(10, (atr * multiplier / price) * 100));
}

// === Market Regime Detection ===
function detectMarketRegime(tickers: Record<string, TickerData>): { regime: string; description: string; confidence: number } {
  const changes = Object.values(tickers).map(t => parseFloat(t.priceChangePercent) || 0);
  if (changes.length < 5) return { regime: "unknown", description: "Insufficient data", confidence: 0 };

  const avgChange = changes.reduce((a, b) => a + b, 0) / changes.length;
  const variance = changes.reduce((s, c) => s + (c - avgChange) ** 2, 0) / changes.length;
  const stdDev = Math.sqrt(variance);
  const positiveCount = changes.filter(c => c > 0.5).length;
  const negativeCount = changes.filter(c => c < -0.5).length;
  const totalMag = changes.reduce((s, c) => s + Math.abs(c), 0) / changes.length;

  // Trending up: most stocks positive with moderate dispersion
  if (positiveCount > changes.length * 0.65 && avgChange > 0.5) {
    return { regime: "trending_up", description: `Bullish trend (${positiveCount}/${changes.length} up, avg +${avgChange.toFixed(1)}%)`, confidence: 80 };
  }
  // Trending down
  if (negativeCount > changes.length * 0.65 && avgChange < -0.5) {
    return { regime: "trending_down", description: `Bearish trend (${negativeCount}/${changes.length} down, avg ${avgChange.toFixed(1)}%)`, confidence: 80 };
  }
  // Choppy: high dispersion, no clear direction
  if (stdDev > 3 && Math.abs(avgChange) < 1) {
    return { regime: "choppy", description: `Choppy (σ=${stdDev.toFixed(1)}%, avg ${avgChange.toFixed(1)}%)`, confidence: 70 };
  }
  // Low volatility
  if (totalMag < 0.5) {
    return { regime: "low_volatility", description: `Low volatility (avg move ${totalMag.toFixed(2)}%)`, confidence: 60 };
  }
  // High volatility
  if (stdDev > 5) {
    return { regime: "high_volatility", description: `High volatility (σ=${stdDev.toFixed(1)}%)`, confidence: 75 };
  }
  return { regime: "normal", description: `Normal (avg ${avgChange.toFixed(1)}%, σ=${stdDev.toFixed(1)}%)`, confidence: 50 };
}

// === Performance Feedback: Auto-adjust thresholds ===
function calculateFeedbackAdjustment(
  tradeReturns: number[], 
  lookback: number
): { adjustment: number; winRate: number; reason: string } {
  const recent = tradeReturns.slice(-lookback);
  if (recent.length < 5) return { adjustment: 0, winRate: 0, reason: "Not enough trades for feedback" };

  const wins = recent.filter(r => r > 0).length;
  const winRate = wins / recent.length;

  // If winning > 60%, lower threshold slightly (more aggressive)
  if (winRate > 0.6) {
    const adj = -Math.round((winRate - 0.5) * 20);
    return { adjustment: Math.max(adj, -10), winRate, reason: `Hot streak ${(winRate * 100).toFixed(0)}% WR → threshold -${Math.abs(adj)}%` };
  }
  // If winning < 40%, raise threshold (more conservative)
  if (winRate < 0.4) {
    const adj = Math.round((0.5 - winRate) * 30);
    return { adjustment: Math.min(adj, 15), winRate, reason: `Cold streak ${(winRate * 100).toFixed(0)}% WR → threshold +${adj}%` };
  }
  return { adjustment: 0, winRate, reason: `Stable ${(winRate * 100).toFixed(0)}% WR` };
}

function kellyFraction(winRate: number, avgWin: number, avgLoss: number): number {
  if (avgLoss === 0 || winRate === 0) return 0;
  const b = avgWin / avgLoss;
  const p = winRate;
  const q = 1 - p;
  const kelly = (b * p - q) / b;
  return Math.max(0, Math.min(kelly * 0.25, 0.1));
}

function confirmMomentum(ticker: TickerData, side: "long" | "short"): boolean {
  const changePct = parseFloat(ticker.priceChangePercent) || 0;
  const price = parseFloat(ticker.price) || 0;
  const high = parseFloat(ticker.high) || price;
  const low = parseFloat(ticker.low) || price;
  const range = high - low;
  const rangePos = range > 0 ? ((price - low) / range) * 100 : 50;

  if (side === "long") {
    return changePct > -1 && rangePos > 25;
  } else {
    return changePct < 1 && rangePos < 75;
  }
}

export type JournalLogger = (entry: {
  symbol: string; side: string; qty: number; filled_price: number;
  entry_price?: number; exit_price?: number; pnl?: number; pnl_pct?: number;
  alpaca_order_id?: string; order_type?: string; order_class?: string;
  trade_type: string; mode: string; confidence?: number; risk_reward?: number;
  entry_quality?: string; signal_type?: string; stat_edge_score?: number;
  chart_snapshot?: any; market_session?: string; sector?: string; holding_time_ms?: number;
  signal_price?: number; slippage_bps?: number;
}) => void;

export function useAutoTrading(
  tickers: Record<string, TickerData>,
  openPosition: (symbol: string, side: "long" | "short", price: number, quantity: number) => void,
  closePosition: (positionId: string, currentPrice: number) => void,
  portfolio: { balance: number; positions: Array<{ id: string; symbol: string; side: "long" | "short"; entryPrice: number; quantity: number; timestamp?: number }> },
  onLossLimitHit?: LossLimitCallback,
  journalLogger?: JournalLogger,
  klineData?: Record<string, Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }>>,
) {
  // Alpaca account data for real balance/position awareness
  const [alpacaBuyingPower, setAlpacaBuyingPower] = useState<number | null>(null);
  const [alpacaPositionCount, setAlpacaPositionCount] = useState<number>(0);
  const alpacaFetchRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { user } = useAuth();
  const [config, setConfig] = useState<AutoTradeConfig>(DEFAULT_CONFIG);
  const [logs, setLogs] = useState<AutoTradeLog[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [marketSession, setMarketSession] = useState<MarketSession>(getMarketSession());
  const [stats, setStats] = useState<AutoTradeStats>({
    totalTrades: 0, winningTrades: 0, losingTrades: 0, totalPnl: 0,
    bestTrade: 0, worstTrade: 0, avgConfidence: 0, sessionStart: Date.now(),
    dailyPnl: 0, maxDrawdown: 0, sharpeEstimate: 0, profitFactor: 0, consecutiveLosses: 0,
    kellyFraction: 0, avgHoldTime: 0, tradesSkipped: 0, statEdgeTrades: 0,
    marketRegime: "unknown", feedbackAdjustment: 0, atrStopDistance: 0,
    tierExits: { tier1: 0, tier2: 0, tier3: 0 }, activeRiskProfile: null,
  });
  const lastTradeTimeRef = useRef<Record<string, number>>({});
  const lastAnalysisTimeRef = useRef<number>(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const peakPricesRef = useRef<Record<string, number>>({});
  const confidenceSumRef = useRef(0);
  const confidenceCountRef = useRef(0);
  const marketCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tradeReturnsRef = useRef<number[]>([]);
  const grossProfitRef = useRef(0);
  const grossLossRef = useRef(0);
  const peakEquityRef = useRef(0);
  const consecutiveLossesRef = useRef(0);
  const dailyLossNotifiedRef = useRef(false);
  const consecutiveLossNotifiedRef = useRef(false);
  const holdTimesRef = useRef<number[]>([]);
  const skippedCountRef = useRef(0);
  const breakEvenMovedRef = useRef<Set<string>>(new Set());
  const partialTakenRef = useRef<Set<string>>(new Set());
  const tier1TakenRef = useRef<Set<string>>(new Set());
  const tier2TakenRef = useRef<Set<string>>(new Set());
  const posATRStopRef = useRef<Record<string, number>>({});
  // Regime cache — kept in a ref so synchronous code (placeOrder) can read it.
  const regimeRef = useRef<MarketRegime | null>(null);
  const { data: regimeData } = useMarketRegime();
  useEffect(() => { regimeRef.current = regimeData ?? null; }, [regimeData]);
  // Phase 5: per-position exit lock — prevents the tick loop from re-closing
  // a position that's already in flight (root cause of ETHUSD churn).
  const exitingRef = useRef<Set<string>>(new Set());
  // Phase 5: closed-position graveyard — position ids are uuid so once closed
  // they should never be re-evaluated even if a stale snapshot resurfaces.
  const closedPosRef = useRef<Set<string>>(new Set());
  // Phase 5: global checkExits re-entry guard — prevents two concurrent sweeps
  // from racing on the same portfolio snapshot.
  const checkExitsRunningRef = useRef<boolean>(false);

  // Kill-switch state
  const [killSwitch, setKillSwitch] = useState<KillSwitchState>(() => ({
    active: false,
    reason: "",
    trippedAt: null,
    tradesToday: 0,
    dayStartTs: new Date().setHours(0, 0, 0, 0),
    dayStartEquity: 0,
    peakDailyPnl: 0,
    profitLockArmed: false,
    lastEvaluatedTradeCount: 0,
  }));
  const killSwitchRef = useRef<KillSwitchState>(killSwitch);
  useEffect(() => { killSwitchRef.current = killSwitch; }, [killSwitch]);

  // Auto-set baseline equity when auto-scale is first enabled
  useEffect(() => {
    if (config.autoScaleEnabled && !config.autoScaleBaselineEquity && portfolio.balance > 0) {
      setConfig(prev => ({ ...prev, autoScaleBaselineEquity: portfolio.balance }));
    }
  }, [config.autoScaleEnabled, config.autoScaleBaselineEquity, portfolio.balance]);

  useEffect(() => {
    const checkSession = () => setMarketSession(getMarketSession());
    checkSession();
    marketCheckRef.current = setInterval(checkSession, 60_000);
    return () => { if (marketCheckRef.current) clearInterval(marketCheckRef.current); };
  }, []);

  // Fetch Alpaca account data when enabled for real balance/position awareness
  useEffect(() => {
    if (!config.alpacaEnabled) {
      setAlpacaBuyingPower(null);
      setAlpacaPositionCount(0);
      if (alpacaFetchRef.current) clearInterval(alpacaFetchRef.current);
      return;
    }

    const fetchAlpacaData = async () => {
      try {
        const [accRes, posRes] = await Promise.all([
          invokeAlpacaTrade({ body: { action: "account", mode: config.alpacaMode } }),
          invokeAlpacaTrade({ body: { action: "positions", mode: config.alpacaMode } }),
        ]);
        if (!accRes.error && accRes.data?.buying_power) {
          setAlpacaBuyingPower(parseFloat(accRes.data.buying_power));
        }
        if (!posRes.error && Array.isArray(posRes.data)) {
          setAlpacaPositionCount(posRes.data.length);
        }
      } catch {
        // Silent fail — will use paper balance as fallback
      }
    };

    fetchAlpacaData();
    alpacaFetchRef.current = setInterval(fetchAlpacaData, 30_000); // Refresh every 30s
    return () => { if (alpacaFetchRef.current) clearInterval(alpacaFetchRef.current); };
  }, [config.alpacaEnabled, config.alpacaMode]);

  // Load settings from DB
  useEffect(() => {
    if (!user) return;
    supabase.from("auto_trade_settings").select("*").eq("user_id", user.id).maybeSingle().then(({ data }) => {
      if (data) {
        setConfig({
          enabled: data.enabled,
          confidenceThreshold: data.confidence_threshold,
          positionSizePct: Number(data.position_size_pct),
          stopLossPct: Number(data.stop_loss_pct),
          takeProfitPct: Number(data.take_profit_pct),
          maxOpenPositions: data.max_open_positions,
          cooldownSeconds: data.cooldown_seconds,
          queueDelaySeconds: data.queue_delay_seconds,
          profitOnlyMode: data.profit_only_mode,
          trailingStopPct: Number(data.trailing_stop_pct),
          minPrice: Number((data as any).min_price ?? 1),
          maxPrice: Number((data as any).max_price ?? 10000),
          maxDailyLossPct: 5,
          maxPortfolioRiskPct: 20,
          requireMinRR: 2.0,
          allHoursTrading: Boolean((data as any).all_hours_trading ?? true),
          statEdgeEnabled: true,
          statEdgeThresholdReduction: 15,
          newsSentimentGating: true,
          multiTimeframeConfirmation: true,
          correlationFiltering: true,
          partialProfitTaking: true,
          partialProfitPct: 50,
          fractionalShares: true,
          warriorScreening: false,
          minRelativeVolume: 5,
          minGainerPct: 10,
          requireCatalyst: true,
          maxFloat: 10,
          sweetSpotPricing: true,
          alpacaEnabled: false,
          alpacaMode: "paper" as const,
          regimeDetection: true,
          avoidLunchHour: true,
          atrBasedStops: true,
          atrMultiplier: 2.0,
          tieredScaleOut: true,
          performanceFeedback: true,
          feedbackLookback: 20,
          adaptiveRisk: true,
          smartExits: true,
          microAlignmentRequired: true,
          vwapReclaim: true,
          edgeRestrictions: true,
          slippageTracking: true,
          hardConfidenceFloor: 65,
          bearishCryptoBlock: true,
          bearishStockWeight: 0.7,
          tieredSizingByConfidence: true,
          blockCryptoMeanReversion: true,
          afterHoursCryptoOnlyMode: true,
          dynamicSizingEnabled: Boolean((data as any).dynamic_sizing_enabled ?? true),
          gradeASizeMult: Number((data as any).grade_a_size_mult ?? 2.0),
          gradeBSizeMult: Number((data as any).grade_b_size_mult ?? 0.5),
          trailingTpEnabled: Boolean((data as any).trailing_tp_enabled ?? true),
          trailingTpLockPct: Number((data as any).trailing_tp_lock_pct ?? 33),
          primeWindowOnly: Boolean((data as any).prime_window_only ?? true),
          sectorRotationFilter: Boolean((data as any).sector_rotation_filter ?? false),
          newsSentimentGate: Boolean((data as any).news_sentiment_gate ?? true),
          vwapReclaimRequired: Boolean((data as any).vwap_reclaim_required ?? false),
          profitLockEnabled: Boolean((data as any).profit_lock_enabled ?? true),
          profitLockTargetPct: Number((data as any).profit_lock_target_pct ?? 2.0),
          profitLockGivebackPct: Number((data as any).profit_lock_giveback_pct ?? 0.5),
          autoScaleEnabled: Boolean((data as any).auto_scale_enabled ?? false),
          autoScaleBaselineEquity: (data as any).auto_scale_baseline_equity != null ? Number((data as any).auto_scale_baseline_equity) : null,
          mondayRule: ((data as any).monday_rule ?? "reduce_50") as "normal" | "reduce_50" | "skip",
        });
      }
    });
  }, [user]);

  const saveConfig = useCallback((newConfig: AutoTradeConfig) => {
    setConfig(newConfig);
    if (!user) return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      const row = {
        user_id: user.id,
        enabled: newConfig.enabled,
        confidence_threshold: newConfig.confidenceThreshold,
        position_size_pct: newConfig.positionSizePct,
        stop_loss_pct: newConfig.stopLossPct,
        take_profit_pct: newConfig.takeProfitPct,
        max_open_positions: newConfig.maxOpenPositions,
        cooldown_seconds: newConfig.cooldownSeconds,
        queue_delay_seconds: newConfig.queueDelaySeconds,
        profit_only_mode: newConfig.profitOnlyMode,
        trailing_stop_pct: newConfig.trailingStopPct,
        min_price: newConfig.minPrice,
        max_price: newConfig.maxPrice,
        dynamic_sizing_enabled: newConfig.dynamicSizingEnabled,
        grade_a_size_mult: newConfig.gradeASizeMult,
        grade_b_size_mult: newConfig.gradeBSizeMult,
        trailing_tp_enabled: newConfig.trailingTpEnabled,
        trailing_tp_lock_pct: newConfig.trailingTpLockPct,
        prime_window_only: newConfig.primeWindowOnly,
        sector_rotation_filter: newConfig.sectorRotationFilter,
        news_sentiment_gate: newConfig.newsSentimentGate,
        vwap_reclaim_required: newConfig.vwapReclaimRequired,
        profit_lock_enabled: newConfig.profitLockEnabled,
        profit_lock_target_pct: newConfig.profitLockTargetPct,
        profit_lock_giveback_pct: newConfig.profitLockGivebackPct,
        auto_scale_enabled: newConfig.autoScaleEnabled,
        auto_scale_baseline_equity: newConfig.autoScaleBaselineEquity,
        monday_rule: newConfig.mondayRule,
        updated_at: new Date().toISOString(),
      };
      const { data: existing } = await supabase.from("auto_trade_settings").select("id").eq("user_id", user.id).maybeSingle();
      if (existing) {
        await supabase.from("auto_trade_settings").update(row).eq("user_id", user.id);
      } else {
        await supabase.from("auto_trade_settings").insert(row);
      }
    }, 500);
  }, [user]);

  const addLog = useCallback((log: Omit<AutoTradeLog, "id" | "timestamp">) => {
    setLogs(prev => [{
      ...log,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
    }, ...prev].slice(0, 200));
  }, []);

  const updateStats = useCallback((pnl?: number, confidence?: number, holdTimeMs?: number) => {
    if (confidence) {
      confidenceSumRef.current += confidence;
      confidenceCountRef.current += 1;
    }
    if (pnl !== undefined) {
      tradeReturnsRef.current.push(pnl);
      if (pnl > 0) grossProfitRef.current += pnl;
      else grossLossRef.current += Math.abs(pnl);
      
      if (pnl < 0) consecutiveLossesRef.current++;
      else consecutiveLossesRef.current = 0;

      // Record fill-rate calibration data
      if (confidence) {
        recordFillOutcome(confidence, pnl > 0, pnl);
      }
    }
    if (holdTimeMs !== undefined) {
      holdTimesRef.current.push(holdTimeMs);
    }
    
    setStats(prev => {
      const updated = { ...prev };
      if (pnl !== undefined) {
        updated.totalTrades += 1;
        updated.totalPnl += pnl;
        updated.dailyPnl += pnl;
        if (pnl > 0) updated.winningTrades += 1;
        else if (pnl < 0) updated.losingTrades += 1;
        if (pnl > updated.bestTrade) updated.bestTrade = pnl;
        if (pnl < updated.worstTrade) updated.worstTrade = pnl;
        updated.consecutiveLosses = consecutiveLossesRef.current;
        
        if (updated.totalPnl > peakEquityRef.current) {
          peakEquityRef.current = updated.totalPnl;
        }
        const drawdown = peakEquityRef.current - updated.totalPnl;
        if (drawdown > updated.maxDrawdown) updated.maxDrawdown = drawdown;
        
        updated.profitFactor = grossLossRef.current > 0 
          ? grossProfitRef.current / grossLossRef.current 
          : grossProfitRef.current > 0 ? Infinity : 0;
        
        const returns = tradeReturnsRef.current;
        if (returns.length >= 3) {
          const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
          const variance = returns.reduce((sum, r) => sum + (r - avgReturn) ** 2, 0) / returns.length;
          const stdDev = Math.sqrt(variance);
          updated.sharpeEstimate = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0;
        }

        // Kelly fraction
        if (updated.totalTrades >= 5) {
          const winRate = updated.winningTrades / updated.totalTrades;
          const avgWin = updated.winningTrades > 0 ? grossProfitRef.current / updated.winningTrades : 0;
          const avgLoss = updated.losingTrades > 0 ? grossLossRef.current / updated.losingTrades : 1;
          updated.kellyFraction = kellyFraction(winRate, avgWin, avgLoss);
        }
      }
      if (confidenceCountRef.current > 0) {
        updated.avgConfidence = Math.round(confidenceSumRef.current / confidenceCountRef.current);
      }
      if (holdTimesRef.current.length > 0) {
        updated.avgHoldTime = holdTimesRef.current.reduce((a, b) => a + b, 0) / holdTimesRef.current.length;
      }
      updated.tradesSkipped = skippedCountRef.current;
      return updated;
    });
  }, []);

  // Trip kill-switch when limits hit. Idempotent.
  const tripKillSwitch = useCallback((reason: string) => {
    if (killSwitchRef.current.active) return;
    setKillSwitch(prev => ({ ...prev, active: true, reason, trippedAt: Date.now() }));
    setConfig(prev => ({ ...prev, enabled: false })); // disable engine
    addLog({ symbol: "SYSTEM", action: "alert", price: 0, reason: `🛑 KILL-SWITCH TRIPPED: ${reason}` });
    toast.error(`🛑 Kill-switch tripped: ${reason}`, { duration: 10000 });
  }, [addLog]);

  // Evaluate kill-switch after each closed trade.
  const evalKillSwitchOnClose = useCallback((pnlPct: number) => {
    // 1. Single trade loss ≥ 1.5%
    if (pnlPct <= -KILL_SWITCH_LIMITS.maxSingleTradeLossPct) {
      tripKillSwitch(`Single-trade loss ${pnlPct.toFixed(2)}% exceeds ${KILL_SWITCH_LIMITS.maxSingleTradeLossPct}% limit`);
      return;
    }
    // 2. 3 consecutive losses
    if (consecutiveLossesRef.current >= KILL_SWITCH_LIMITS.maxConsecutiveLosses) {
      tripKillSwitch(`${consecutiveLossesRef.current} consecutive losses (limit ${KILL_SWITCH_LIMITS.maxConsecutiveLosses})`);
      return;
    }
    // 3. Daily drawdown ≥ 3% (vs start-of-day equity baseline = balance at session start)
    const ks = killSwitchRef.current;
    const baseline = ks.dayStartEquity || portfolio.balance;
    if (baseline > 0) {
      const dailyPnlNow = tradeReturnsRef.current
        .filter((_, i, arr) => i >= arr.length - ks.tradesToday) // last N=tradesToday closes today
        .reduce((s, v) => s + v, 0);
      const ddPct = (-dailyPnlNow / baseline) * 100;
      if (ddPct >= KILL_SWITCH_LIMITS.maxDailyDrawdownPct) {
        tripKillSwitch(`Daily drawdown ${ddPct.toFixed(2)}% exceeds ${KILL_SWITCH_LIMITS.maxDailyDrawdownPct}% limit`);
        return;
      }

      // 4. PROFIT-LOCK — protect daily gains once target hit
      if (config.profitLockEnabled) {
        const dailyPnlPct = (dailyPnlNow / baseline) * 100;
        if (dailyPnlPct > ks.peakDailyPnl) {
          const justArmed = !ks.profitLockArmed && dailyPnlPct >= config.profitLockTargetPct;
          setKillSwitch(prev => ({
            ...prev,
            peakDailyPnl: dailyPnlPct,
            profitLockArmed: prev.profitLockArmed || dailyPnlPct >= config.profitLockTargetPct,
          }));
          if (justArmed) {
            addLog({ symbol: "SYSTEM", action: "alert", price: 0, reason: `🔒 Profit-lock armed at +${dailyPnlPct.toFixed(2)}% (max giveback ${config.profitLockGivebackPct}%)` });
            toast.success(`🔒 Profit-lock armed at +${dailyPnlPct.toFixed(2)}% — gains protected`, { duration: 6000 });
          }
        }
        if (ks.profitLockArmed) {
          const giveback = ks.peakDailyPnl - dailyPnlPct;
          if (giveback >= config.profitLockGivebackPct) {
            tripKillSwitch(`Profit-lock: gave back ${giveback.toFixed(2)}% from peak +${ks.peakDailyPnl.toFixed(2)}%`);
            return;
          }
        }
      }

      // 5. AUTO-SCALE — bump position size when equity grows ≥10% from baseline
      if (config.autoScaleEnabled && config.autoScaleBaselineEquity && config.autoScaleBaselineEquity > 0) {
        const growthPct = ((portfolio.balance - config.autoScaleBaselineEquity) / config.autoScaleBaselineEquity) * 100;
        if (growthPct >= 10) {
          const scaleFactor = portfolio.balance / config.autoScaleBaselineEquity;
          const newSize = Math.min(20, config.positionSizePct * scaleFactor);
          addLog({ symbol: "SYSTEM", action: "alert", price: 0, reason: `📈 Auto-scale: equity +${growthPct.toFixed(1)}% → size ${config.positionSizePct.toFixed(1)}% → ${newSize.toFixed(1)}%` });
          toast.success(`📈 Auto-scaled position size to ${newSize.toFixed(1)}% (equity +${growthPct.toFixed(1)}%)`, { duration: 5000 });
          setConfig(prev => ({ ...prev, positionSizePct: newSize, autoScaleBaselineEquity: portfolio.balance }));
        }
      }
    }
  }, [tripKillSwitch, portfolio.balance, config.profitLockEnabled, config.profitLockTargetPct, config.profitLockGivebackPct, config.autoScaleEnabled, config.autoScaleBaselineEquity, config.positionSizePct, addLog]);

  // === Loss limit notifications ===
  useEffect(() => {
    if (!config.enabled || !onLossLimitHit) return;

    const maxDailyLoss = portfolio.balance * (config.maxDailyLossPct / 100);
    
    if (stats.dailyPnl < -maxDailyLoss && !dailyLossNotifiedRef.current) {
      dailyLossNotifiedRef.current = true;
      onLossLimitHit(
        `⚠️ Daily loss limit hit: $${Math.abs(stats.dailyPnl).toFixed(0)} lost (${config.maxDailyLossPct}% limit). Auto-trading paused.`,
        "error"
      );
      addLog({ symbol: "SYSTEM", action: "alert", price: 0, reason: `DAILY LOSS LIMIT — Trading paused ($${Math.abs(stats.dailyPnl).toFixed(0)} lost)` });
    }
    
    if (stats.dailyPnl < -(maxDailyLoss * 0.75) && stats.dailyPnl > -maxDailyLoss && !dailyLossNotifiedRef.current) {
      onLossLimitHit(`⚠️ Approaching daily loss limit: $${Math.abs(stats.dailyPnl).toFixed(0)} / $${maxDailyLoss.toFixed(0)}`, "warning");
    }

    if (stats.consecutiveLosses >= 3 && !consecutiveLossNotifiedRef.current) {
      consecutiveLossNotifiedRef.current = true;
      onLossLimitHit(`🛑 ${stats.consecutiveLosses} consecutive losses — Auto-trading paused.`, "error");
      addLog({ symbol: "SYSTEM", action: "alert", price: 0, reason: `CONSECUTIVE LOSS LIMIT — ${stats.consecutiveLosses} losses in a row` });
    }
  }, [config.enabled, stats.dailyPnl, stats.consecutiveLosses, config.maxDailyLossPct, portfolio.balance, onLossLimitHit, addLog]);

  const analyzeAndTrade = useCallback(async (symbol: string) => {
    try {
      const ticker = tickers[symbol];
      if (!ticker || isAnalyzing) return;
      if (!config.allHoursTrading && !isTradingAllowed(false)) return;

      // === KILL-SWITCH GATE ===
      if (killSwitchRef.current.active) return;
      // Roll over day if midnight passed
      const todayStart = new Date().setHours(0, 0, 0, 0);
      if (killSwitchRef.current.dayStartTs !== todayStart) {
        setKillSwitch(prev => ({ ...prev, dayStartTs: todayStart, tradesToday: 0, dayStartEquity: portfolio.balance, peakDailyPnl: 0, profitLockArmed: false }));
      }
      if (killSwitchRef.current.tradesToday >= KILL_SWITCH_LIMITS.maxTradesPerDay) {
        skippedCountRef.current++;
        return; // silent — frequent
      }

      const isCrypto = isCryptoSymbol(symbol);

      // === IMPROVEMENT #5: After-hours crypto-only mode ===
      // When US market is closed and the toggle is on, only trade crypto.
      if (config.afterHoursCryptoOnlyMode && !isTradingAllowed(false) && !isCrypto) {
        skippedCountRef.current++;
        return; // silent — high frequency
      }

      // === PRIME-WINDOW GATE — only trade highest-edge hours (stocks only) ===
      // Open burst: 9:30-11:00 ET. Power hour: 15:00-16:00 ET. Crypto exempt.
      if (config.primeWindowOnly && !isCrypto) {
        const nowET = new Date();
        const utcH = nowET.getUTCHours();
        const utcM = nowET.getUTCMinutes();
        // ET = UTC-4 (DST) — close enough for window logic; covers EST too with 1h slip.
        const etMinutes = ((utcH - 4 + 24) % 24) * 60 + utcM;
        const openStart = 9 * 60 + 30, openEnd = 11 * 60;       // 9:30-11:00
        const powerStart = 15 * 60, powerEnd = 16 * 60;          // 15:00-16:00
        const inPrime = (etMinutes >= openStart && etMinutes < openEnd) ||
                        (etMinutes >= powerStart && etMinutes < powerEnd);
        if (!inPrime) {
          skippedCountRef.current++;
          return; // silent — high frequency
        }
      }

      // === MONDAY RULE — statistically worst day, reduce or skip ===
      if (!isCrypto && config.mondayRule !== "normal") {
        const dayET = new Date(Date.now() - 4 * 3600_000).getUTCDay(); // 1 = Monday
        if (dayET === 1) {
          if (config.mondayRule === "skip") {
            skippedCountRef.current++;
            return;
          }
          // reduce_50 handled in sizing block below via mondayReduce flag
        }
      }

      // === LUNCH HOUR AVOIDANCE (stocks only — crypto trades 24/7) ===
      if (config.avoidLunchHour && !isCrypto && isLunchHour()) {
        skippedCountRef.current++;
        return; // Silent skip during lunch — too noisy to log every time
      }

      const price = parseFloat(ticker.price);
      if (!isFinite(price) || price <= 0) return;
      if (price < config.minPrice || price > config.maxPrice) return;

      const volume = parseFloat(ticker.volume?.replace(/[^\d.]/g, '') || '0');
      if ((!isFinite(volume) || volume <= 0) && ticker.category !== "active") return;

      // === MARKET REGIME DETECTION ===
      if (config.regimeDetection) {
        const regime = detectMarketRegime(tickers);
        setStats(prev => ({ ...prev, marketRegime: regime.regime }));
        
        // In choppy markets, raise the bar significantly
        if (regime.regime === "choppy") {
          // Only log regime change occasionally
          if (Math.random() < 0.05) {
            addLog({ symbol: "SYSTEM", action: "alert", price: 0, reason: `🌊 ${regime.description} — raising thresholds` });
          }
        }
      }

      const qualityScore = scoreStock(ticker);
      if (qualityScore < 4) {
        skippedCountRef.current++;
        return;
      }

      // === WARRIOR TRADING SCREENING ===
      const warriorCheck = passesWarriorScreen(ticker, config, tickers);
      if (!warriorCheck.pass) {
        skippedCountRef.current++;
        addLog({ symbol, action: "skip", price, reason: `⚔️ Warrior screen: ${warriorCheck.reason}` });
        return;
      }
      if (config.warriorScreening && warriorCheck.pass) {
        addLog({ symbol, action: "alert", price, reason: warriorCheck.reason });
      }

      const timeSinceLastAnalysis = Date.now() - lastAnalysisTimeRef.current;
      if (timeSinceLastAnalysis < config.queueDelaySeconds * 1000) return;

      const lastTrade = lastTradeTimeRef.current[symbol] || 0;
      if (Date.now() - lastTrade < config.cooldownSeconds * 1000) return;

      // Position limit check — use Alpaca count when connected
      const effectivePositions = config.alpacaEnabled ? Math.max(portfolio.positions.length, alpacaPositionCount) : portfolio.positions.length;
      if (effectivePositions >= config.maxOpenPositions) return;
      if (portfolio.positions.some(p => p.symbol === symbol)) return;

      const maxDailyLoss = portfolio.balance * (config.maxDailyLossPct / 100);
      if (stats.dailyPnl < -maxDailyLoss) return;
      if (consecutiveLossesRef.current >= 3) return;

      // Portfolio risk check
      const totalInvested = portfolio.positions.reduce((t, p) => t + p.entryPrice * p.quantity, 0);
      const totalEquity = portfolio.balance + totalInvested;
      const currentRiskPct = (totalInvested / totalEquity) * 100;
      if (currentRiskPct >= config.maxPortfolioRiskPct) return;

      // Anti-correlation: max 2 positions per sector
      const symbolClean = symbol.replace("USDT", "");
      const sector = SECTOR_MAP[symbolClean] || "unknown";
      const sectorPositions = portfolio.positions.filter(p => {
        const s = p.symbol.replace("USDT", "");
        return (SECTOR_MAP[s] || "unknown") === sector;
      });
      if (sectorPositions.length >= 2) {
        skippedCountRef.current++;
        addLog({ symbol, action: "skip", price, reason: `Sector concentration: ${sectorPositions.length} ${sector} positions` });
        return;
      }

      // === SECTOR ROTATION FILTER — only trade top-2 performing sectors today ===
      if (config.sectorRotationFilter && !isCrypto && sector !== "unknown") {
        const sectorPerf: Record<string, { sum: number; n: number }> = {};
        for (const t of Object.values(tickers)) {
          const s = (t.symbol || "").replace("USDT", "");
          const sec = SECTOR_MAP[s];
          if (!sec) continue;
          const ch = parseFloat(t.priceChangePercent) || 0;
          if (!sectorPerf[sec]) sectorPerf[sec] = { sum: 0, n: 0 };
          sectorPerf[sec].sum += ch;
          sectorPerf[sec].n += 1;
        }
        const ranked = Object.entries(sectorPerf)
          .filter(([, v]) => v.n >= 2)
          .map(([sec, v]) => ({ sec, avg: v.sum / v.n }))
          .sort((a, b) => b.avg - a.avg);
        const top2 = ranked.slice(0, 2).map(r => r.sec);
        if (top2.length >= 2 && !top2.includes(sector)) {
          skippedCountRef.current++;
          addLog({ symbol, action: "skip", price, reason: `🔄 Sector rotation: ${sector} not in top 2 (${top2.join(", ")})` });
          return;
        }
      }

        // === CORRELATION FILTERING (enhanced with correlation matrix) ===
        if (config.correlationFiltering) {
          const corrCheck = checkCorrelationLimit(symbolClean, portfolio.positions.map(p => ({ symbol: p.symbol, side: p.side })));
          if (!corrCheck.allowed) {
            skippedCountRef.current++;
            addLog({ symbol, action: "skip", price, reason: corrCheck.reason });
            return;
          }
        }

      // === EDGE-BASED RESTRICTIONS (learned from past trades) ===
      if (config.edgeRestrictions) {
        const floatEst2 = estimateFloat(symbolClean, price, ticker.volume || "0");
        const etHour = new Date().getUTCHours() - 4;
        const edgeCheck = checkEdgeRestrictions(symbolClean, SECTOR_MAP[symbolClean], getFloatTier(floatEst2.floatM), etHour);
        if (!edgeCheck.allowed) {
          skippedCountRef.current++;
          addLog({ symbol, action: "skip", price, reason: edgeCheck.reason });
          return;
        }
      }

      // === MULTI-TIMEFRAME CONFIRMATION ===
      if (config.multiTimeframeConfirmation) {
        const mtf = analyzeMultiTimeframe(ticker, tickers);
        if (!mtf.aligned) {
          skippedCountRef.current++;
          addLog({ symbol, action: "skip", price, reason: `Multi-TF misaligned: ${mtf.details}` });
          return;
        }
        addLog({ symbol, action: "alert", price, reason: `✅ Multi-TF aligned ${mtf.direction}: ${mtf.details}` });
      }

      // Detect statistical edge
      const statEdge = detectStatEdge(ticker, tickers);
      const hasStatEdge = config.statEdgeEnabled && statEdge.score >= 30;
      
      if (hasStatEdge) {
        addLog({ symbol, action: "alert", price, reason: `📊 Stat edge detected (score ${statEdge.score}): ${statEdge.triggers.join(", ")}` });
      }

      // === NEWS SENTIMENT GATING ===
      if (config.newsSentimentGating || config.newsSentimentGate || (config.warriorScreening && config.requireCatalyst)) {
        const sentiment = await checkNewsSentiment(symbolClean);
        if (sentiment.sentiment === "negative") {
          skippedCountRef.current++;
          addLog({ symbol, action: "skip", price, reason: `🚫 Negative news sentiment (${sentiment.score.toFixed(2)}): ${sentiment.reason}` });
          return;
        }
        // Warrior mode: require POSITIVE catalyst, not just neutral
        if (config.warriorScreening && config.requireCatalyst && sentiment.sentiment !== "positive") {
          skippedCountRef.current++;
          addLog({ symbol, action: "skip", price, reason: `⚔️ No catalyst found — Warrior screen requires positive news` });
          return;
        }
        if (sentiment.sentiment === "positive") {
          addLog({ symbol, action: "alert", price, reason: `📰 Positive news catalyst: ${sentiment.reason}` });
        }
      }

      // === CANDLESTICK PATTERN DETECTION ===
      // Build mini-kline history from rolling data for pattern detection
      const symbolClean2 = symbol.replace("USDT", "");
      const rollingPrices = rollingChangeMap[symbolClean2] || [];
      let candlePatterns: DetectedPattern[] = [];
      let patternScore = 0;
      
      if (rollingPrices.length >= 5) {
        // Synthesize klines from rolling price data
        const syntheticKlines: Kline[] = rollingPrices.map((changePct, i) => {
          const basePrice = price * (1 - (rollingPrices.length - i) * 0.001);
          const spread = basePrice * 0.01;
          return {
            time: Date.now() - (rollingPrices.length - i) * 60000,
            open: basePrice - spread * 0.5,
            high: basePrice + spread,
            low: basePrice - spread,
            close: basePrice + spread * (changePct > 0 ? 0.5 : -0.5),
            volume: parseFloat(ticker.volume?.replace(/[^\d.]/g, '') || '0') * 1e6,
          };
        });
        // Add current candle
        syntheticKlines.push({
          time: Date.now(),
          open: price * 0.998,
          high: parseFloat(ticker.high) || price * 1.02,
          low: parseFloat(ticker.low) || price * 0.98,
          close: price,
          volume: parseFloat(ticker.volume?.replace(/[^\d.]/g, '') || '0') * 1e6,
        });
        
        candlePatterns = detectCandlestickPatterns(syntheticKlines);
        patternScore = patternEntryScore(candlePatterns);
        
        if (candlePatterns.length > 0) {
          const topPattern = candlePatterns[0];
          addLog({ symbol, action: "alert", price, reason: `🕯️ Pattern: ${topPattern.label} (${topPattern.confidence}% conf, ${topPattern.direction})${candlePatterns.length > 1 ? ` +${candlePatterns.length - 1} more` : ""}` });
        }
      }

      setIsAnalyzing(true);
      lastAnalysisTimeRef.current = Date.now();

      try {
        const MAX_RETRIES = 3;
        let data: any = null;
        let lastError = "";

        // Send portfolio context for anti-correlation
        const existingPositions = portfolio.positions.map(p => p.symbol.replace("USDT", ""));
        
        // Float estimation for context
        const floatEst = estimateFloat(symbolClean, price, ticker.volume || "0");

        // === VOLUME PROFILE WEIGHTING ===
        const symbolKlinesVP = klineData?.[symbol] || klineData?.[symbolClean];
        let volumeProfileWeight = 1.0;
        if (symbolKlinesVP && symbolKlinesVP.length >= 10) {
          const vp = computeVolumeProfile(symbolKlinesVP);
          if (vp) {
            const vpResult = getVolumeProfileWeight(price, vp);
            volumeProfileWeight = vpResult.weight;
            if (vpResult.zone !== "VA") {
              addLog({ symbol, action: "alert", price, reason: `📊 Vol Profile: ${vpResult.zone} — ${vpResult.reason}` });
            }
          }
        }

        // === REGIME-SPECIFIC STRATEGY SELECTION ===
        let regimeStratAdj = { confAdj: 0, rrAdj: 0, sizeAdj: 1.0 };
        if (config.regimeDetection) {
          const regime = detectMarketRegime(tickers);
          const changePctAbs = Math.abs(parseFloat(ticker.priceChangePercent) || 0);
          const strat = selectStrategyForRegime(regime.regime, changePctAbs, regime.confidence);
          regimeStratAdj = strat.adjustments;
          if (strat.mode !== "momentum") {
            addLog({ symbol, action: "alert", price, reason: `🎯 Strategy: ${strat.mode} — ${strat.reason}` });
          }
        }

        // === MTF CONFLUENCE CHECK (enhanced) ===
        let mtfBoost = 0;
        if (config.multiTimeframeConfirmation && symbolKlinesVP && symbolKlinesVP.length >= 20) {
          const mtf = computeMTFConfluence(symbolKlinesVP);
          mtfBoost = mtf.confidenceBoost;
          if (!mtf.isValid && mtf.confidenceBoost < 0) {
            addLog({ symbol, action: "alert", price, reason: `⚠️ MTF conflicting: ${mtf.timeframes.map(t => `${t.tf}=${t.bias}`).join(", ")}` });
          }
        }

        // === AI ANALYSIS WITH CACHING ===
        const aiExhaustedRecently = aiCreditsExhausted && (Date.now() - aiCreditsExhaustedAt < 5 * 60 * 1000);
        
        // Check cache first
        const cached = getCachedAnalysis(symbol);
        if (cached) {
          data = cached;
          addLog({ symbol, action: "alert", price, reason: `⚡ Using cached AI analysis (${Math.round((Date.now() - cached._cachedAt) / 1000)}s old)` });
        } else if (!aiExhaustedRecently) {
          for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            if (attempt > 0) {
              const delay = Math.min(2000 * Math.pow(2, attempt - 1), 16000);
              addLog({ symbol, action: "skip", price, reason: `Retry ${attempt}/${MAX_RETRIES} in ${delay / 1000}s...` });
              await new Promise(r => setTimeout(r, delay));
            }

            const result = await supabase.functions.invoke("analyze-market", {
              body: {
                marketData: {
                  symbol: ticker.symbol,
                  price: ticker.price,
                  priceChangePercent: ticker.priceChangePercent,
                  high: ticker.high,
                  low: ticker.low,
                  quoteVolume: (parseFloat(ticker.quoteVolume) / 1e6).toFixed(1) + "M",
                  rangePosition: ((price - parseFloat(ticker.low)) / (parseFloat(ticker.high) - parseFloat(ticker.low)) * 100).toFixed(1),
                  floatM: floatEst.floatM.toFixed(1),
                  floatSource: floatEst.source,
                  turnoverRatio: (floatEst.turnoverRatio * 100).toFixed(0) + "%",
                  candlePatterns: candlePatterns.length > 0 ? formatPatternsForPrompt(candlePatterns) : undefined,
                  patternBias: patternScore,
                },
                portfolioContext: { existingPositions },
                statEdge: hasStatEdge ? {
                  score: statEdge.score,
                  triggers: statEdge.triggers,
                  volumeSpike: statEdge.volumeSpike,
                  momentumAnomaly: statEdge.momentumAnomaly,
                  rangeBreakout: statEdge.rangeBreakout,
                  sectorDivergence: statEdge.sectorDivergence,
                } : undefined,
              },
            });

            if (!result.error && !result.data?.error) {
              data = result.data;
              // Cache the result
              setCachedAnalysis(symbol, { ...data, _cachedAt: Date.now() });
              aiCreditsExhausted = false;
              break;
            }
            lastError = result.data?.error || result.error?.message || "Unknown error";
            if (lastError.includes("credits exhausted") || lastError.includes("402")) {
              aiCreditsExhausted = true;
              aiCreditsExhaustedAt = Date.now();
              break;
            }
          }
        }

        // === LOCAL TECHNICAL ANALYSIS FALLBACK (with strategy engine indicators) ===
        if (!data) {
          const symbolKlines = klineData?.[symbol] || klineData?.[symbolClean];
          const localSignal = generateLocalTASignal(ticker, tickers, candlePatterns, patternScore, statEdge, floatEst, symbolKlines);
          if (localSignal) {
            data = localSignal;
            const mode = symbolKlines ? "strategy-engine TA" : "basic TA";
            addLog({ symbol, action: "alert", price, reason: `🔧 Using ${mode} (AI unavailable): ${localSignal.signal} @ ${localSignal.confidence}%${localSignal.strategy_entry ? ` | Entry $${localSignal.strategy_entry}` : ""}` });
          } else {
            addLog({ symbol, action: "skip", price, reason: `No AI + no local TA signal for ${symbol}` });
            return;
          }
        }

        // Resolve any pending signal replays for this symbol
        resolveSignalReplay(symbolClean, price);

        const signal = data;
        let confidence = signal.confidence || 0;
        
        // Boost confidence for strong Warrior-style candlestick patterns
        if (candlePatterns.length > 0) {
          const warriorPatterns = candlePatterns.filter(p => 
            p.type === "new_high_breakout" || p.type === "flat_top_breakout" || p.type === "bull_flag"
          );
          if (warriorPatterns.length > 0) {
            const boost = Math.min(15, warriorPatterns[0].confidence * 0.15);
            confidence = Math.min(100, confidence + boost);
            addLog({ symbol, action: "alert", price, confidence, reason: `⚔️🕯️ Warrior pattern boost +${boost.toFixed(0)}%: ${warriorPatterns[0].label}` });
          }
          // Reduce confidence for bearish patterns
          const bearishPatterns = candlePatterns.filter(p => p.direction === "bearish");
          if (bearishPatterns.length > 0 && patternScore < -30) {
            confidence = Math.max(0, confidence - 10);
            addLog({ symbol, action: "alert", price, confidence, reason: `🕯️ Bearish pattern penalty: ${bearishPatterns[0].label}` });
          }
        }
        
        // === VOLUME PROFILE & MTF CONFIDENCE ADJUSTMENTS ===
        confidence = Math.min(100, confidence * volumeProfileWeight + mtfBoost + regimeStratAdj.confAdj);
        confidence = Math.max(10, confidence);

        updateStats(undefined, confidence);

        // === PERFORMANCE FEEDBACK ADJUSTMENT ===
        let feedbackAdj = 0;
        if (config.performanceFeedback) {
          const feedback = calculateFeedbackAdjustment(tradeReturnsRef.current, config.feedbackLookback);
          feedbackAdj = feedback.adjustment;
          if (feedbackAdj !== 0) {
            setStats(prev => ({ ...prev, feedbackAdjustment: feedbackAdj }));
          }
        }

        // === REGIME-BASED THRESHOLD ADJUSTMENT ===
        let regimeAdj = 0;
        if (config.regimeDetection) {
          const regime = detectMarketRegime(tickers);
          if (regime.regime === "choppy") regimeAdj = 10;       // Be more selective in choppy
          else if (regime.regime === "high_volatility") regimeAdj = 5;
          else if (regime.regime === "trending_up" || regime.regime === "trending_down") regimeAdj = -5; // Be more aggressive in trends
        }

        // === IMPROVEMENT #3: Bearish-stock confidence weighting (data shows 25% WR on bearish) ===
        const isSellSignalRaw = signal.signal === "strong_sell" || signal.signal === "sell";
        if (isSellSignalRaw && !isCrypto && config.bearishStockWeight < 1) {
          const original = confidence;
          confidence = Math.round(confidence * config.bearishStockWeight);
          if (original !== confidence) {
            addLog({ symbol, action: "alert", price, confidence, reason: `Bearish stock signal weighted ${original}%→${confidence}% (×${config.bearishStockWeight})` });
          }
        }

        // Apply stat edge threshold reduction + feedback + regime
        let effectiveThreshold = config.confidenceThreshold + feedbackAdj + regimeAdj;
        if (hasStatEdge) {
          effectiveThreshold -= config.statEdgeThresholdReduction;
        }
        // === IMPROVEMENT #1: Hard confidence floor — never trade below this, even with stat-edge boost ===
        effectiveThreshold = Math.max(effectiveThreshold, config.hardConfidenceFloor);

        if (confidence < effectiveThreshold) {
          skippedCountRef.current++;
          const edgeNote = hasStatEdge ? ` (stat-edge reduced from ${config.confidenceThreshold}%)` : "";
          addLog({ symbol, action: "skip", price, confidence, reason: `Confidence ${confidence}% < floor ${effectiveThreshold}%${edgeNote}` });
          return;
        }

        // === IMPROVEMENT #2: Block bearish/short signals on crypto (Alpaca crypto can't short; data shows poor WR) ===
        if (isSellSignalRaw && isCrypto && config.bearishCryptoBlock) {
          skippedCountRef.current++;
          addLog({ symbol, action: "skip", price, confidence, reason: `Bearish crypto blocked (no shorting + low edge)` });
          return;
        }

        if (signal.volatility_warning) {
          skippedCountRef.current++;
          addLog({ symbol, action: "skip", price, confidence, reason: `Volatility warning — skipping` });
          return;
        }

        const rr = signal.risk_reward_ratio || 0;
        if (rr < config.requireMinRR) {
          skippedCountRef.current++;
          addLog({ symbol, action: "skip", price, confidence, reason: `R:R ${rr.toFixed(1)} < required ${config.requireMinRR}` });
          return;
        }

        // Entry quality gate
        if (signal.entry_quality === "D" || signal.entry_quality === "F") {
          skippedCountRef.current++;
          addLog({ symbol, action: "skip", price, confidence, reason: `Entry quality "${signal.entry_quality}" — skipping marginal setup` });
          return;
        }

        const isBuy = signal.signal === "strong_buy" || signal.signal === "buy";
        const isSell = signal.signal === "strong_sell" || signal.signal === "sell";

        if (!isBuy && !isSell) {
          skippedCountRef.current++;
          addLog({ symbol, action: "skip", price, confidence, reason: `Neutral signal` });
          return;
        }

        const side: "long" | "short" = isBuy ? "long" : "short";

        // Momentum confirmation
        if (!confirmMomentum(ticker, side)) {
          skippedCountRef.current++;
          addLog({ symbol, action: "skip", price, confidence, reason: `Momentum not confirmed for ${side} entry` });
          return;
        }

        // === VWAP RECLAIM CONFIRMATION ===
        if (config.vwapReclaim || config.vwapReclaimRequired) {
          const symbolKlines = klineData?.[symbol] || klineData?.[symbolClean];
          const vwapCheck = checkVWAPReclaim(side, price, symbolKlines);
          if (!vwapCheck.confirmed) {
            skippedCountRef.current++;
            addLog({ symbol, action: "skip", price, confidence, reason: `VWAP: ${vwapCheck.reason}` });
            return;
          }
        }

        // === MICRO-PREDICTION ALIGNMENT ===
        if (config.microAlignmentRequired) {
          const symbolKlines = klineData?.[symbol] || klineData?.[symbolClean];
          if (symbolKlines && symbolKlines.length >= 20) {
            const microScore = getMicroPredictionScore(symbolKlines, price);
            // Check alignment: micro prediction should agree with trade direction
            const microAgrees = (side === "long" && microScore.direction === "up" && microScore.confidence > 55) ||
                               (side === "short" && microScore.direction === "down" && microScore.confidence > 55);
            if (!microAgrees && microScore.confidence > 50) {
              skippedCountRef.current++;
              addLog({ symbol, action: "skip", price, confidence, reason: `Micro-pred misaligned: ${microScore.direction} ${microScore.confidence}% vs ${side}` });
              return;
            }
          }
        }

        // === ADAPTIVE RISK: Compute stock-specific risk parameters ===
        const changePct = Math.abs(parseFloat(ticker.priceChangePercent) || 0);
        let effectiveStopLossPct = config.stopLossPct;
        let effectiveTakeProfitPct = config.takeProfitPct;
        let effectiveTrailingPct = config.trailingStopPct;
        let adaptiveSizePct = config.positionSizePct;

        if (config.adaptiveRisk) {
          // Compute drawdown from peak equity
          const currentEquity = portfolio.balance + portfolio.positions.reduce((s, p) => {
            const t = tickers[p.symbol] || tickers[p.symbol + "USDT"];
            const cp = t ? parseFloat(t.price) : p.entryPrice;
            return s + p.quantity * cp;
          }, 0);
          if (currentEquity > peakEquityRef.current) peakEquityRef.current = currentEquity;
          const drawdownPct = peakEquityRef.current > 0 ? ((peakEquityRef.current - currentEquity) / peakEquityRef.current) * 100 : 0;

          // Calculate win streak
          const recentReturns = tradeReturnsRef.current.slice(-10);
          let streak = 0;
          for (let i = recentReturns.length - 1; i >= 0; i--) {
            if (recentReturns[i] > 0) { if (streak >= 0) streak++; else break; }
            else if (recentReturns[i] < 0) { if (streak <= 0) streak--; else break; }
            else break;
          }

          const stockCtx: StockContext = {
            symbol: symbolClean,
            price,
            changePct: parseFloat(ticker.priceChangePercent) || 0,
            high: parseFloat(ticker.high) || price,
            low: parseFloat(ticker.low) || price,
            volume: parseFloat(ticker.volume?.replace(/[^\d.]/g, '') || '0') || 0,
            sector: SECTOR_MAP[symbolClean],
            floatM: floatEst.floatM,
            atr: (config.atrBasedStops && posATRStopRef.current[symbol])
              ? (posATRStopRef.current[symbol] / 100) * price / config.atrMultiplier
              : undefined,
            regime: config.regimeDetection ? detectMarketRegime(tickers).regime : undefined,
            strategyConfidence: signal.confidence,
            strategyBias: signal.signal,
            strategyRR: rr,
            strategySL: signal.strategy_sl,
            strategyTP: signal.strategy_tp,
            peScore: ticker.profitExpectancy,
            // v2 fields
            recentDrawdownPct: drawdownPct,
            winStreak: streak,
            klineCount: klineData?.[symbol]?.length,
          };

          const riskProfile = computeAdaptiveRisk(stockCtx, {
            stopLossPct: config.stopLossPct,
            takeProfitPct: config.takeProfitPct,
            positionSizePct: config.positionSizePct,
            requireMinRR: config.requireMinRR,
            confidenceThreshold: config.confidenceThreshold,
            trailingStopPct: config.trailingStopPct,
          });

          effectiveStopLossPct = riskProfile.stopLossPct;
          effectiveTakeProfitPct = riskProfile.takeProfitPct;
          effectiveTrailingPct = riskProfile.trailingStopPct;
          adaptiveSizePct = riskProfile.positionSizePct;

          setStats(prev => ({ ...prev, activeRiskProfile: riskProfile }));
          addLog({ symbol, action: "alert", price, reason: `🎯 Adaptive risk [${riskProfile.tier}]: SL ${riskProfile.stopLossPct}% TP ${riskProfile.takeProfitPct}% Size ${riskProfile.positionSizePct.toFixed(1)}% (${riskProfile.reasons.slice(0, 3).join(", ")})` });
        }

        // Dynamic position sizing using Kelly criterion (if enough data)
        const volatilityFactor = changePct > 5 ? 0.5 : changePct > 3 ? 0.75 : 1.0;
        const confidenceMultiplier = Math.min(confidence / 100, 1);
        
        let sizePct = config.adaptiveRisk ? adaptiveSizePct : config.positionSizePct;
        if (stats.totalTrades >= 10 && stats.kellyFraction > 0) {
          const kellyPct = stats.kellyFraction * 100;
          sizePct = Math.min(sizePct, kellyPct);
          sizePct = Math.max(sizePct, 1);
        }
        
        // === IMPROVEMENT #4: Tiered position sizing by confidence bucket ===
        // Data: 80%+ → 86% WR, 70-79% → 78% WR, <70% → 29% WR (already gated above).
        let confidenceTierMultiplier = 1.0;
        if (config.tieredSizingByConfidence) {
          if (confidence >= 80) confidenceTierMultiplier = 1.4;       // load up on best signals
          else if (confidence >= 70) confidenceTierMultiplier = 1.0;  // standard
          else confidenceTierMultiplier = 0.5;                        // shouldn't reach here, but safety net
        }

        // === DYNAMIC SIZING BY ENTRY GRADE — A/A+ get larger, B/C smaller ===
        let gradeMultiplier = 1.0;
        if (config.dynamicSizingEnabled) {
          const grade = (signal.entry_quality || "").toUpperCase();
          if (grade.startsWith("A")) gradeMultiplier = config.gradeASizeMult;
          else if (grade.startsWith("B") || grade.startsWith("C")) gradeMultiplier = config.gradeBSizeMult;
        }

        // === MONDAY REDUCE — cut size in half on statistically worst day ===
        let mondayMultiplier = 1.0;
        if (!isCrypto && config.mondayRule === "reduce_50") {
          const dayET = new Date(Date.now() - 4 * 3600_000).getUTCDay();
          if (dayET === 1) mondayMultiplier = 0.5;
        }

        // === REGIME GATE — scale size and block trades that don't pass current regime ===
        const regimeGate = applyRegimeGate(
          regimeRef.current,
          isBuy ? "buy" : "sell",
          (signal.entry_quality || "B").toUpperCase().charAt(0),
          signal.strategy_name,
        );
        if (!regimeGate.allowed) {
          addLog({ symbol, action: "skip", price, confidence, reason: `🌐 Regime gate (${regimeRef.current?.regime ?? "?"}): ${regimeGate.reason}` });
          void logTradeEvent({ type: "regime_blocked", symbol: symbolClean, payload: { regime: regimeRef.current?.regime, reason: regimeGate.reason } });
          return;
        }
        const adjustedSizePct = sizePct * (0.5 + 0.5 * confidenceMultiplier) * volatilityFactor * confidenceTierMultiplier * gradeMultiplier * mondayMultiplier * regimeGate.sizeMult;
        // Use real Alpaca buying power when connected, otherwise paper balance
        const effectiveBalance = (config.alpacaEnabled && alpacaBuyingPower !== null) ? alpacaBuyingPower : portfolio.balance;
        const positionValue = effectiveBalance * (adjustedSizePct / 100);

        const executionPrice = simulateSlippage(price, side, changePct);
        let quantity = positionValue / executionPrice;
        // Auto-enable fractional shares when the position size can't afford a full share.
        // Lets small accounts still participate (Alpaca min notional = $1).
        const useFractional = config.fractionalShares || quantity < 1;
        if (!useFractional) {
          quantity = Math.floor(quantity);
        } else {
          // Round to 6 decimals (Alpaca fractional precision)
          quantity = Math.floor(quantity * 1e6) / 1e6;
        }

        // Check against Alpaca position count if connected
        const effectivePositionCount = config.alpacaEnabled ? Math.max(portfolio.positions.length, alpacaPositionCount) : portfolio.positions.length;
        if (effectivePositionCount >= config.maxOpenPositions) {
          addLog({ symbol, action: "skip", price, confidence, reason: `Max positions reached (${effectivePositionCount}/${config.maxOpenPositions})${config.alpacaEnabled ? " [Alpaca]" : ""}` });
          return;
        }

        // Alpaca requires ≥ $1 notional for fractional orders
        if (quantity <= 0 || positionValue < 1 || positionValue > effectiveBalance) {
          addLog({ symbol, action: "skip", price, confidence, reason: `Insufficient ${config.alpacaEnabled ? "Alpaca buying power" : "balance"} for ${useFractional ? quantity.toFixed(6) : quantity} shares (need ≥ $1)` });
          return;
        }

        openPosition(symbol, side, executionPrice, quantity);
        lastTradeTimeRef.current[symbol] = Date.now();
        peakPricesRef.current[symbol] = executionPrice;

        // === Kill-switch: increment trades-today counter ===
        setKillSwitch(prev => {
          const newCount = prev.tradesToday + 1;
          if (newCount >= KILL_SWITCH_LIMITS.maxTradesPerDay) {
            // last trade of the day — show informational toast
            toast.info(`📊 Daily trade cap reached (${newCount}/${KILL_SWITCH_LIMITS.maxTradesPerDay}). Auto-trading paused until tomorrow.`);
          }
          return { ...prev, tradesToday: newCount, dayStartEquity: prev.dayStartEquity || portfolio.balance };
        });

        // Per-fill confirmation toast (in-app alert)
        toast.success(`🟢 FILLED: ${side.toUpperCase()} ${quantity.toFixed(4)} ${symbol.replace("USDT","")} @ $${executionPrice.toFixed(2)} • Conf ${confidence}% • ${signal.entry_quality || "?"}-grade`, { duration: 6000 });

        // Store adaptive stop/tp for exit logic
        if (config.adaptiveRisk) {
          posATRStopRef.current[symbol] = effectiveStopLossPct;
        }

        // === ATR-BASED DYNAMIC STOP CALCULATION ===
        if (config.atrBasedStops && !config.adaptiveRisk) {
          const high = parseFloat(ticker.high) || executionPrice * 1.02;
          const low = parseFloat(ticker.low) || executionPrice * 0.98;
          const atr = estimateATR(symbolClean, executionPrice, high, low);
          const atrStopPct = getATRStopPct(atr, executionPrice, config.atrMultiplier);
          posATRStopRef.current[symbol] = atrStopPct;
          setStats(prev => ({ ...prev, atrStopDistance: atrStopPct }));
          addLog({ symbol, action: "alert", price: executionPrice, reason: `📐 ATR stop: ${atrStopPct.toFixed(1)}% (ATR=$${atr.toFixed(2)}, ${config.atrMultiplier}x mult)` });
        }

        // === ALPACA BROKERAGE ORDER (BRACKET with TP/SL) ===
        // Use strategy-derived levels when available, otherwise fall back to fixed %
        if (config.alpacaEnabled) {
          // === KILL-SWITCH + DRAWDOWN BREAKER ===
          // Server-stored flags take precedence over local config.
          try {
            const { data: srv } = await supabase
              .from("auto_trade_settings")
              .select("trading_halted, halt_reason, weekly_pause_until")
              .eq("user_id", user!.id)
              .maybeSingle();
            if (srv?.trading_halted) {
              addLog({ symbol, action: "alert", price: executionPrice, reason: `🛑 KILL-SWITCH active: ${srv.halt_reason || "manual halt"} — order blocked` });
              void logTradeEvent({ type: "killswitch_blocked", symbol: symbolClean, payload: { reason: srv.halt_reason } });
              return;
            }
            if (srv?.weekly_pause_until && new Date(srv.weekly_pause_until) > new Date()) {
              addLog({ symbol, action: "alert", price: executionPrice, reason: `⏸️ Weekly drawdown pause active until ${new Date(srv.weekly_pause_until).toLocaleString()} — order blocked` });
              void logTradeEvent({ type: "drawdown_paused", symbol: symbolClean, payload: { until: srv.weekly_pause_until } });
              return;
            }
          } catch (e) {
            console.warn("kill-switch check failed", e);
          }

          try {
            const orderStart = performance.now();
            const hasStrategyLevels = signal.strategy_tp && signal.strategy_sl;
            const useAdaptive = config.adaptiveRisk && !hasStrategyLevels;
            const takeProfitPrice = hasStrategyLevels
              ? signal.strategy_tp
              : side === "long"
                ? executionPrice * (1 + (useAdaptive ? effectiveTakeProfitPct : config.takeProfitPct) / 100)
                : executionPrice * (1 - (useAdaptive ? effectiveTakeProfitPct : config.takeProfitPct) / 100);
            const stopLossPrice = hasStrategyLevels
              ? signal.strategy_sl
              : side === "long"
                ? executionPrice * (1 - (useAdaptive ? effectiveStopLossPct : config.stopLossPct) / 100)
                : executionPrice * (1 + (useAdaptive ? effectiveStopLossPct : config.stopLossPct) / 100);

            // Alpaca rejects bracket orders combined with notional / fractional qty.
            // For fractional fills we skip the bracket and rely on the app's
            // in-memory TP/SL monitor (closeWithAlpaca) to manage exits.
            const orderBody: any = {
              action: "order",
              symbol: symbolClean,
              side: isBuy ? "buy" : "sell",
              type: "market",
              time_in_force: useFractional ? "day" : "gtc",
              mode: config.alpacaMode,
            };
            if (useFractional) {
              orderBody.notional = positionValue.toFixed(2);
            } else {
              orderBody.qty = Math.floor(quantity);
              orderBody.order_class = "bracket";
              orderBody.take_profit = parseFloat(takeProfitPrice.toFixed(2));
              orderBody.stop_loss = parseFloat(stopLossPrice.toFixed(2));
            }

            const alpacaResult = await invokeAlpacaTrade({ body: orderBody });
            if (alpacaResult.data?.skipped) {
              skippedCountRef.current++;
              addLog({ symbol, action: "skip", price: executionPrice, confidence, reason: `Alpaca skipped: ${alpacaResult.data.message || alpacaResult.data.reason || "order not supported"}` });
              return;
            }
            if (alpacaResult.error || alpacaResult.data?.error) {
              const errMsg = alpacaResult.data?.error || alpacaResult.error?.message || "Unknown";
              void logTradeEvent({ type: "order_failed", symbol: symbolClean, latencyMs: Math.round(performance.now() - orderStart), payload: { error: errMsg, mode: config.alpacaMode } });
              // Fallback to simple market order if bracket fails (e.g. for fractional shares)
              if (errMsg.includes("bracket") || errMsg.includes("notional")) {
                const fallbackBody: any = {
                  action: "order",
                  symbol: symbolClean,
                  side: isBuy ? "buy" : "sell",
                  type: "market",
                  time_in_force: "day",
                  mode: config.alpacaMode,
                };
                if (useFractional) fallbackBody.notional = positionValue.toFixed(2);
                else fallbackBody.qty = Math.floor(quantity);

                const fallback = await invokeAlpacaTrade({ body: fallbackBody });
                if (fallback.data?.skipped) {
                  skippedCountRef.current++;
                  addLog({ symbol, action: "skip", price: executionPrice, confidence, reason: `Alpaca skipped: ${fallback.data.message || fallback.data.reason || "order not supported"}` });
                  return;
                }
                if (fallback.error || fallback.data?.error) {
                  addLog({ symbol, action: "alert", price: executionPrice, reason: `⚠️ Alpaca order failed: ${fallback.data?.error || fallback.error?.message}` });
                  toast.error(`Alpaca order failed`);
                } else {
                  addLog({ symbol, action: "alert", price: executionPrice, reason: `🏦 Alpaca ${config.alpacaMode} market order: ${fallback.data?.id} (bracket unsupported, using manual TP/SL)` });
                  toast.success(`Alpaca ${config.alpacaMode}: ${side.toUpperCase()} ${symbolClean}`);
                }
              } else {
                addLog({ symbol, action: "alert", price: executionPrice, reason: `⚠️ Alpaca order failed: ${errMsg}` });
                toast.error(`Alpaca order failed: ${errMsg}`);
              }
            } else {
              const orderId = alpacaResult.data?.id || "unknown";
              void logTradeEvent({ type: "order_placed", symbol: symbolClean, orderId, latencyMs: Math.round(performance.now() - orderStart), payload: { tp: takeProfitPrice, sl: stopLossPrice, side, mode: config.alpacaMode, confidence } });
              addLog({ symbol, action: "alert", price: executionPrice, reason: `🏦 Alpaca ${config.alpacaMode} BRACKET order: ${orderId} (TP: $${takeProfitPrice.toFixed(2)}, SL: $${stopLossPrice.toFixed(2)})` });
              toast.success(`Alpaca bracket: ${side.toUpperCase()} ${symbolClean} (TP/SL attached)`);
            }
          } catch (alpacaErr) {
            addLog({ symbol, action: "alert", price: executionPrice, reason: `⚠️ Alpaca error: ${alpacaErr instanceof Error ? alpacaErr.message : "Unknown"}` });
          }
        }

        const session = getMarketSession();
        const sessionTag = session === "regular" ? "" : ` [${session}]`;
        const slippageCost = Math.abs(executionPrice - price) * quantity;
        const entryQuality = signal.entry_quality || "?";
        const statEdgeTag = hasStatEdge ? ` 📊 STAT-EDGE(${statEdge.score})` : "";
        const alpacaTag = config.alpacaEnabled ? ` 🏦 ${config.alpacaMode.toUpperCase()}` : "";
        addLog({
          symbol, action: "open", side, price: executionPrice, confidence,
          reason: `${signal.signal.toUpperCase()} @ ${confidence}% conf, R:R ${rr.toFixed(1)}, entry ${entryQuality}, size ${adjustedSizePct.toFixed(1)}%, slip $${slippageCost.toFixed(2)}${sessionTag}${statEdgeTag}${alpacaTag}`,
        });

        // === JOURNAL: Log entry ===
        if (journalLogger) {
          const chartPrices = (rollingChangeMap[symbolClean2] || []).map((_, i, arr) => {
            return price * (1 + (i - arr.length) * 0.001);
          });
          chartPrices.push(price);
          // Slippage in basis points: how far the actual fill drifted from the
          // signal price. Used by the adaptive sizer to down-weight chronically
          // high-slippage symbols and to rank execution quality over time.
          const slippageBps = price > 0
            ? Math.abs(executionPrice - price) / price * 10000
            : 0;
          journalLogger({
            symbol: symbolClean, side: isBuy ? "buy" : "sell", qty: quantity,
            filled_price: executionPrice, entry_price: executionPrice,
            trade_type: "entry", mode: config.alpacaMode,
            confidence, risk_reward: rr, entry_quality: entryQuality,
            signal_type: signal.signal, stat_edge_score: hasStatEdge ? statEdge.score : undefined,
            chart_snapshot: { prices: chartPrices, tradePrice: executionPrice, high: parseFloat(ticker.high), low: parseFloat(ticker.low) },
            market_session: session, sector: SECTOR_MAP[symbolClean] || undefined,
            signal_price: price, slippage_bps: slippageBps,
          });
        }

        if (hasStatEdge) {
          setStats(prev => ({ ...prev, statEdgeTrades: prev.statEdgeTrades + 1 }));
        }

        toast.success(`Auto-trade: ${side.toUpperCase()} ${symbol} @ $${executionPrice.toFixed(2)} (${entryQuality}-grade)${hasStatEdge ? " 📊" : ""}${config.alpacaEnabled ? " 🏦" : ""}`);
      } catch (err) {
        console.error("Auto-trade error:", err);
        addLog({ symbol, action: "skip", price: isFinite(price) ? price : 0, reason: `Error: ${err instanceof Error ? err.message : "Unknown"}` });
      } finally {
        setIsAnalyzing(false);
      }
    } catch (outerErr) {
      console.error("Auto-trade outer error:", outerErr);
      setIsAnalyzing(false);
    }
  }, [tickers, config, portfolio, isAnalyzing, stats.dailyPnl, stats.totalTrades, stats.kellyFraction, openPosition, addLog, updateStats]);

  const closeWithAlpaca = useCallback(async (posId: string, symbol: string, exitPrice: number, exitMeta?: { entryPrice: number; qty: number; pnl: number; pnlPct: number; holdTimeMs: number; side: string; tradeType?: string; signalPrice?: number; confidence?: number; entryQuality?: string; riskReward?: number }) => {
    // Phase 5: exit lock — drop duplicate close requests for the same position
    if (exitingRef.current.has(posId) || closedPosRef.current.has(posId)) {
      return;
    }
    exitingRef.current.add(posId);
    closedPosRef.current.add(posId);
    closePosition(posId, exitPrice);
    if (config.alpacaEnabled) {
      try {
        const symbolClean = symbol.replace("USDT", "");
        const res = await invokeAlpacaTrade({
          body: { action: "close_position", symbol: symbolClean, mode: config.alpacaMode },
        });
        if (res.error || res.data?.error) {
          addLog({ symbol, action: "alert", price: exitPrice, reason: `⚠️ Alpaca close failed: ${res.data?.error || res.error?.message}` });
        } else {
          addLog({ symbol, action: "alert", price: exitPrice, reason: `🏦 Alpaca ${config.alpacaMode} position closed: ${symbolClean}` });
        }
      } catch (err) {
        addLog({ symbol, action: "alert", price: exitPrice, reason: `⚠️ Alpaca close error: ${err instanceof Error ? err.message : "Unknown"}` });
      }
    }
    // Journal exit log
    if (journalLogger && exitMeta) {
      const symbolClean = symbol.replace("USDT", "");
      const ticker = tickers[symbol];
      const chartPrices: number[] = [];
      if (ticker) {
        const rolling = rollingChangeMap[symbolClean] || [];
        rolling.forEach((_, i, arr) => chartPrices.push(exitPrice * (1 + (i - arr.length) * 0.001)));
        chartPrices.push(exitPrice);
      }
      // Phase 5: recompute pnl_pct from actual fill — previous bug copied
      // unrealized pnl_pct from the position state, hiding real slippage.
      const recomputedPnlPct = exitMeta.entryPrice > 0
        ? ((exitMeta.side === "long"
            ? exitPrice - exitMeta.entryPrice
            : exitMeta.entryPrice - exitPrice) / exitMeta.entryPrice) * 100
        : exitMeta.pnlPct;
      const signalP = exitMeta.signalPrice ?? exitMeta.entryPrice;
      const slippageBps = signalP > 0
        ? Math.round(((exitPrice - signalP) / signalP) * 10000)
        : null;
      journalLogger({
        symbol: symbolClean, side: exitMeta.side === "long" ? "sell" : "buy", qty: exitMeta.qty,
        filled_price: exitPrice, entry_price: exitMeta.entryPrice, exit_price: exitPrice,
        signal_price: signalP,
        pnl: exitMeta.pnl, pnl_pct: recomputedPnlPct,
        slippage_bps: slippageBps ?? undefined,
        confidence: exitMeta.confidence,
        entry_quality: exitMeta.entryQuality,
        risk_reward: exitMeta.riskReward,
        trade_type: exitMeta.tradeType || "exit", mode: config.alpacaMode,
        chart_snapshot: chartPrices.length > 1 ? { prices: chartPrices, tradePrice: exitPrice } : undefined,
        market_session: getMarketSession(), sector: SECTOR_MAP[symbolClean] || undefined,
        holding_time_ms: exitMeta.holdTimeMs,
      });
    }
    // Keep the position id in the graveyard permanently (uuid is unique).
    // Release the in-flight flag after a generous cooldown so any retry/
    // reconcile that races with us can still no-op via the graveyard check.
    setTimeout(() => { exitingRef.current.delete(posId); }, 30000);
    // Cap memory: keep last 500 closed ids.
    if (closedPosRef.current.size > 500) {
      const arr = Array.from(closedPosRef.current);
      closedPosRef.current = new Set(arr.slice(-500));
    }
  }, [closePosition, config.alpacaEnabled, config.alpacaMode, addLog, journalLogger, tickers]);

  const checkExits = useCallback(async () => {
    try {
      if (!config.enabled) return;
      // Phase 5: prevent concurrent sweeps from racing on the same snapshot.
      if (checkExitsRunningRef.current) return;
      checkExitsRunningRef.current = true;

      for (const pos of portfolio.positions) {
        try {
          // Skip anything already being closed or already closed this session.
          if (exitingRef.current.has(pos.id) || closedPosRef.current.has(pos.id)) continue;
          const ticker = tickers[pos?.symbol];
          if (!ticker) continue;

          const currentPrice = parseFloat(ticker.price);
          if (!isFinite(currentPrice) || currentPrice <= 0) continue;
          if (!isFinite(pos.entryPrice) || pos.entryPrice <= 0) continue;
          if (!isFinite(pos.quantity) || pos.quantity <= 0) continue;

          const peakKey = pos.id;
          const currentPeak = peakPricesRef.current[peakKey] || pos.entryPrice;
          if (pos.side === "long" && currentPrice > currentPeak) {
            peakPricesRef.current[peakKey] = currentPrice;
          } else if (pos.side === "short" && currentPrice < currentPeak) {
            peakPricesRef.current[peakKey] = currentPrice;
          }
          const peakPrice = peakPricesRef.current[peakKey] || pos.entryPrice;

          const pnlPct = pos.side === "long"
            ? ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100
            : ((pos.entryPrice - currentPrice) / pos.entryPrice) * 100;

          const changePct = Math.abs(parseFloat(ticker.priceChangePercent) || 0);
          const exitPrice = simulateSlippage(currentPrice, pos.side === "long" ? "short" : "long", changePct);
          
          const pnlDollar = pos.side === "long"
            ? (exitPrice - pos.entryPrice) * pos.quantity
            : (pos.entryPrice - exitPrice) * pos.quantity;

          if (!isFinite(pnlPct) || !isFinite(pnlDollar)) continue;

          const dropFromPeak = pos.side === "long"
            ? ((peakPrice - currentPrice) / peakPrice) * 100
            : ((currentPrice - peakPrice) / peakPrice) * 100;

          const holdTimeMs = Date.now() - (pos.timestamp || Date.now());
          const holdMinutes = holdTimeMs / 60000;

          // === SMART EXIT INTELLIGENCE ===
          if (config.smartExits) {
            const symbolClean = pos.symbol.replace("USDT", "");
            const symbolKlines = klineData?.[pos.symbol] || klineData?.[symbolClean];
            const smartExit = checkSmartExit(
              pos.side, pos.entryPrice, currentPrice, holdTimeMs,
              config.stopLossPct, config.takeProfitPct,
              undefined, // micro predictions handled below
              symbolKlines,
            );
            if (smartExit) {
              if (smartExit.action === "close") {
                closeWithAlpaca(pos.id, pos.symbol, exitPrice, { entryPrice: pos.entryPrice, qty: pos.quantity, pnl: pnlDollar, pnlPct, holdTimeMs, side: pos.side, tradeType: smartExit.type });
                updateStats(pnlDollar, undefined, holdTimeMs);
                // Record for edge analytics
                if (config.slippageTracking) {
                  const now = new Date();
                  recordTrade({
                    symbol: symbolClean, side: pos.side, entryPrice: pos.entryPrice, exitPrice,
                    signalPrice: pos.entryPrice, filledPrice: exitPrice, pnl: pnlDollar, pnlPct, holdTimeMs,
                    timestamp: Date.now(), hour: now.getUTCHours() - 4, dayOfWeek: now.getDay(),
                    sector: SECTOR_MAP[symbolClean], riskTier: stats.activeRiskProfile?.tier,
                  });
                }
                breakEvenMovedRef.current.delete(pos.id);
                partialTakenRef.current.delete(pos.id);
                addLog({ symbol: pos.symbol, action: "close", side: pos.side, price: exitPrice, pnl: pnlDollar,
                  reason: `🧠 Smart exit (${smartExit.type}): ${smartExit.reason}` });
                toast.info(`Smart exit: ${pos.symbol} ${smartExit.type}`);
                delete peakPricesRef.current[peakKey];
                continue;
              } else if (smartExit.action === "tighten_trail" && smartExit.newTrailingPct) {
                // Dynamically tighten trailing stop
                addLog({ symbol: pos.symbol, action: "alert", price: currentPrice,
                  reason: `🧠 ${smartExit.reason} — tightening trail to ${smartExit.newTrailingPct}%` });
                // Apply tighter trailing check immediately
                if (pnlPct > 0 && dropFromPeak >= smartExit.newTrailingPct) {
                  closeWithAlpaca(pos.id, pos.symbol, exitPrice, { entryPrice: pos.entryPrice, qty: pos.quantity, pnl: pnlDollar, pnlPct, holdTimeMs, side: pos.side, tradeType: "smart_trail" });
                  updateStats(pnlDollar, undefined, holdTimeMs);
                  breakEvenMovedRef.current.delete(pos.id);
                  partialTakenRef.current.delete(pos.id);
                  addLog({ symbol: pos.symbol, action: "close", side: pos.side, price: exitPrice, pnl: pnlDollar,
                    reason: `Tightened trailing stop hit (${dropFromPeak.toFixed(1)}% > ${smartExit.newTrailingPct}%)` });
                  toast.info(`Smart trail: ${pos.symbol} $${pnlDollar.toFixed(2)}`);
                  delete peakPricesRef.current[peakKey];
                  continue;
                }
              }
            }
          }

          // === BREAK-EVEN STOP: Move stop to break-even after 50% of TP reached ===
          if (pnlPct >= config.takeProfitPct * 0.5 && !breakEvenMovedRef.current.has(pos.id)) {
            breakEvenMovedRef.current.add(pos.id);
            addLog({
              symbol: pos.symbol, action: "alert", price: currentPrice,
              reason: `Break-even stop activated (+${pnlPct.toFixed(1)}% reached 50% of TP)`,
            });
          }

          // If break-even stop is active and price drops back to entry
          const breakEvenActive = breakEvenMovedRef.current.has(pos.id);
          if (breakEvenActive && pnlPct <= 0.1) {
            closeWithAlpaca(pos.id, pos.symbol, exitPrice, { entryPrice: pos.entryPrice, qty: pos.quantity, pnl: pnlDollar, pnlPct: pnlPct, holdTimeMs: holdTimeMs, side: pos.side });
            updateStats(pnlDollar, undefined, holdTimeMs);
            breakEvenMovedRef.current.delete(pos.id);
            partialTakenRef.current.delete(pos.id);
            addLog({
              symbol: pos.symbol, action: "close", side: pos.side, price: exitPrice, pnl: pnlDollar,
              reason: `Break-even stop hit (protected from loss after +${(config.takeProfitPct * 0.5).toFixed(1)}% peak)`,
            });
            toast.info(`Break-even exit: ${pos.symbol} $${pnlDollar.toFixed(2)}`);
            delete peakPricesRef.current[peakKey];
            continue;
          }

          // === TIME-BASED EXIT: Close stale positions after 2 hours with minimal movement ===
          if (holdMinutes > 120 && Math.abs(pnlPct) < 0.5) {
            // Phase 5: min-edge gate — skip if the move can't even pay round-trip costs.
            const minEdge = minTimeExitEdgePct({
              symbol: pos.symbol,
              price: currentPrice,
              volatilityPct: changePct,
            });
            if (Math.abs(pnlPct) < minEdge) {
              addLog({
                symbol: pos.symbol, action: "skip", price: currentPrice,
                reason: `Time-exit skipped: edge ${pnlPct.toFixed(2)}% < cost ${minEdge.toFixed(2)}%`,
              });
              continue;
            }
            closeWithAlpaca(pos.id, pos.symbol, exitPrice, { entryPrice: pos.entryPrice, qty: pos.quantity, pnl: pnlDollar, pnlPct: pnlPct, holdTimeMs: holdTimeMs, side: pos.side, tradeType: "time_exit" });
            updateStats(pnlDollar, undefined, holdTimeMs);
            breakEvenMovedRef.current.delete(pos.id);
            partialTakenRef.current.delete(pos.id);
            addLog({
              symbol: pos.symbol, action: "close", side: pos.side, price: exitPrice, pnl: pnlDollar,
              reason: `Time exit: ${Math.floor(holdMinutes)}min held, only ${pnlPct.toFixed(2)}% move — freeing capital`,
            });
            toast.info(`Time exit: ${pos.symbol} — freeing capital`);
            delete peakPricesRef.current[peakKey];
            continue;
          }

          if (config.profitOnlyMode) {
            if (pnlPct > config.trailingStopPct && dropFromPeak >= config.trailingStopPct) {
              closeWithAlpaca(pos.id, pos.symbol, exitPrice, { entryPrice: pos.entryPrice, qty: pos.quantity, pnl: pnlDollar, pnlPct: pnlPct, holdTimeMs: holdTimeMs, side: pos.side });
              updateStats(pnlDollar, undefined, holdTimeMs);
              breakEvenMovedRef.current.delete(pos.id);
              partialTakenRef.current.delete(pos.id);
              addLog({
                symbol: pos.symbol, action: "close", side: pos.side, price: exitPrice, pnl: pnlDollar,
                reason: `Trailing stop from peak (+${pnlPct.toFixed(2)}%, dropped ${dropFromPeak.toFixed(1)}%)`,
              });
              toast.success(`Profit locked: ${pos.symbol} +$${pnlDollar.toFixed(2)}`);
              delete peakPricesRef.current[peakKey];
            }
          } else {
            // === ATR-BASED or FIXED STOP-LOSS ===
            const effectiveStopPct = (config.atrBasedStops && posATRStopRef.current[pos.symbol])
              ? posATRStopRef.current[pos.symbol]
              : config.stopLossPct;

            if (pnlPct <= -effectiveStopPct) {
              closeWithAlpaca(pos.id, pos.symbol, exitPrice, { entryPrice: pos.entryPrice, qty: pos.quantity, pnl: pnlDollar, pnlPct: pnlPct, holdTimeMs: holdTimeMs, side: pos.side });
              updateStats(pnlDollar, undefined, holdTimeMs);
              breakEvenMovedRef.current.delete(pos.id);
              partialTakenRef.current.delete(pos.id);
              tier1TakenRef.current.delete(pos.id);
              tier2TakenRef.current.delete(pos.id);
              delete posATRStopRef.current[pos.symbol];
              addLog({
                symbol: pos.symbol, action: "close", side: pos.side, price: exitPrice, pnl: pnlDollar,
                reason: `Stop-loss triggered (${pnlPct.toFixed(2)}%${config.atrBasedStops ? " ATR-based" : ""})`,
              });
              toast.error(`Stop-loss: ${pos.symbol} $${pnlDollar.toFixed(2)}`);
              delete peakPricesRef.current[peakKey];
            }
            // === 3-TIER SCALE-OUT or SINGLE PARTIAL ===
            else if (config.tieredScaleOut || config.trailingTpEnabled) {
              // Tier 1: Close 33% at 1x risk (stopLossPct equivalent gain)
              const effectiveStop = (config.atrBasedStops && posATRStopRef.current[pos.symbol]) ? posATRStopRef.current[pos.symbol] : config.stopLossPct;
              if (!tier1TakenRef.current.has(pos.id) && pnlPct >= effectiveStop) {
                tier1TakenRef.current.add(pos.id);
                const t1Pnl = pnlDollar * 0.33;
                setStats(prev => ({ ...prev, tierExits: { ...prev.tierExits, tier1: prev.tierExits.tier1 + 1 } }));
                addLog({ symbol: pos.symbol, action: "alert", side: pos.side, price: exitPrice, pnl: t1Pnl,
                  reason: `🎯 Tier 1: closed 33% at +${pnlPct.toFixed(1)}% (1R), locked $${t1Pnl.toFixed(2)}` });
                toast.success(`Tier 1: ${pos.symbol} +$${t1Pnl.toFixed(2)}`);
                if (config.alpacaEnabled) {
                  invokeAlpacaTrade({ body: { action: "close_position", symbol: pos.symbol.replace("USDT", ""), percentage: 33, mode: config.alpacaMode } }).catch(() => {});
                }
              }
              // Tier 2: Close another 33% at 2x risk
              else if (tier1TakenRef.current.has(pos.id) && !tier2TakenRef.current.has(pos.id) && pnlPct >= effectiveStop * 2) {
                tier2TakenRef.current.add(pos.id);
                breakEvenMovedRef.current.add(pos.id); // Move stop to break-even
                const t2Pnl = pnlDollar * 0.33;
                setStats(prev => ({ ...prev, tierExits: { ...prev.tierExits, tier2: prev.tierExits.tier2 + 1 } }));
                addLog({ symbol: pos.symbol, action: "alert", side: pos.side, price: exitPrice, pnl: t2Pnl,
                  reason: `🎯 Tier 2: closed 33% at +${pnlPct.toFixed(1)}% (2R), locked $${t2Pnl.toFixed(2)}. Remainder trails.` });
                toast.success(`Tier 2: ${pos.symbol} +$${t2Pnl.toFixed(2)}`);
                if (config.alpacaEnabled) {
                  invokeAlpacaTrade({ body: { action: "close_position", symbol: pos.symbol.replace("USDT", ""), percentage: 50, mode: config.alpacaMode } }).catch(() => {});
                }
              }
            }
            // Legacy single partial
            else if (config.partialProfitTaking && !partialTakenRef.current.has(pos.id) && pnlPct >= config.takeProfitPct * 0.5) {
              const partialPnl = pnlDollar * (config.partialProfitPct / 100);
              partialTakenRef.current.add(pos.id);
              addLog({ symbol: pos.symbol, action: "alert", side: pos.side, price: exitPrice, pnl: partialPnl,
                reason: `💰 Partial: closed ${config.partialProfitPct}% at +${pnlPct.toFixed(2)}%, locking $${partialPnl.toFixed(2)}` });
              toast.success(`Partial: ${pos.symbol} +$${partialPnl.toFixed(2)}`);
              if (config.alpacaEnabled) {
                invokeAlpacaTrade({ body: { action: "close_position", symbol: pos.symbol.replace("USDT", ""), percentage: config.partialProfitPct, mode: config.alpacaMode } }).catch(() => {});
              }
            }
            // Take-profit — full exit
            else if (pnlPct >= config.takeProfitPct) {
              closeWithAlpaca(pos.id, pos.symbol, exitPrice, { entryPrice: pos.entryPrice, qty: pos.quantity, pnl: pnlDollar, pnlPct: pnlPct, holdTimeMs: holdTimeMs, side: pos.side });
              updateStats(pnlDollar, undefined, holdTimeMs);
              breakEvenMovedRef.current.delete(pos.id);
              partialTakenRef.current.delete(pos.id);
              addLog({
                symbol: pos.symbol, action: "close", side: pos.side, price: exitPrice, pnl: pnlDollar,
                reason: `Take-profit triggered (+${pnlPct.toFixed(2)}%)${partialTakenRef.current.has(pos.id) ? " [remaining after partial]" : ""}`,
              });
              toast.success(`Take-profit: ${pos.symbol} +$${pnlDollar.toFixed(2)}`);
              delete peakPricesRef.current[peakKey];
            }
            // Trailing stop from profit
            else if (pnlPct > 0 && dropFromPeak >= config.trailingStopPct) {
              closeWithAlpaca(pos.id, pos.symbol, exitPrice, { entryPrice: pos.entryPrice, qty: pos.quantity, pnl: pnlDollar, pnlPct: pnlPct, holdTimeMs: holdTimeMs, side: pos.side });
              updateStats(pnlDollar, undefined, holdTimeMs);
              breakEvenMovedRef.current.delete(pos.id);
              partialTakenRef.current.delete(pos.id);
              addLog({
                symbol: pos.symbol, action: "close", side: pos.side, price: exitPrice, pnl: pnlDollar,
                reason: `Trailing stop (+${pnlPct.toFixed(2)}%, ${dropFromPeak.toFixed(1)}% from peak)`,
              });
              toast.success(`Trailing stop: ${pos.symbol} +$${pnlDollar.toFixed(2)}`);
              delete peakPricesRef.current[peakKey];
            }
          }
        } catch (posErr) {
          console.error("checkExits position error:", posErr);
        }
      }
    } catch (err) {
      console.error("checkExits error:", err);
    } finally {
      checkExitsRunningRef.current = false;
    }
  }, [config, portfolio.positions, tickers, closeWithAlpaca, addLog, updateStats]);

  // Auto-trading loop
  useEffect(() => {
    if (!config.enabled) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    const symbols = Object.keys(tickers);
    let symbolIndex = 0;

    intervalRef.current = setInterval(() => {
      checkExits();
      if (!config.allHoursTrading && !isTradingAllowed(false)) return;

      if (symbols.length > 0 && !isAnalyzing) {
        const validSymbols = symbols.filter(s => {
          const t = tickers[s];
          const p = t ? parseFloat(t.price) : 0;
          return t && p > 0 && p >= config.minPrice && p <= config.maxPrice;
        });
        validSymbols.sort((a, b) => scoreStock(tickers[b]) - scoreStock(tickers[a]));
        if (validSymbols.length > 0) {
          const symbol = validSymbols[symbolIndex % validSymbols.length];
          analyzeAndTrade(symbol);
          symbolIndex++;
        }
      }
    }, config.cooldownSeconds * 1000 / Math.max(symbols.length, 1));

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [config.enabled, config.cooldownSeconds, Object.keys(tickers).length]);

  useEffect(() => {
    if (!config.enabled) return;
    const exitInterval = setInterval(checkExits, 5000);
    return () => clearInterval(exitInterval);
  }, [config.enabled, checkExits]);

  useEffect(() => {
    if (config.enabled) {
      setStats(prev => ({
        ...prev, sessionStart: Date.now(), dailyPnl: 0,
        kellyFraction: 0, avgHoldTime: 0, tradesSkipped: 0, statEdgeTrades: 0,
        marketRegime: "unknown", feedbackAdjustment: 0, atrStopDistance: 0,
        tierExits: { tier1: 0, tier2: 0, tier3: 0 }, activeRiskProfile: null,
      }));
      confidenceSumRef.current = 0;
      confidenceCountRef.current = 0;
      tradeReturnsRef.current = [];
      grossProfitRef.current = 0;
      grossLossRef.current = 0;
      peakEquityRef.current = 0;
      consecutiveLossesRef.current = 0;
      dailyLossNotifiedRef.current = false;
      consecutiveLossNotifiedRef.current = false;
      holdTimesRef.current = [];
      skippedCountRef.current = 0;
      breakEvenMovedRef.current.clear();
      partialTakenRef.current.clear();
      tier1TakenRef.current.clear();
      tier2TakenRef.current.clear();
      // Reset kill-switch on user re-enable; preserve tradesToday across same day
      setKillSwitch(prev => {
        const today = new Date().setHours(0, 0, 0, 0);
        const sameDay = prev.dayStartTs === today;
        return {
          active: false,
          reason: "",
          trippedAt: null,
          tradesToday: sameDay ? prev.tradesToday : 0,
          dayStartTs: today,
          dayStartEquity: portfolio.balance,
          peakDailyPnl: sameDay ? prev.peakDailyPnl : 0,
          profitLockArmed: sameDay ? prev.profitLockArmed : false,
          lastEvaluatedTradeCount: 0,
        };
      });
    }
  }, [config.enabled]);

  // Watch totalTrades for new closes → evaluate kill-switch
  useEffect(() => {
    if (stats.totalTrades <= killSwitch.lastEvaluatedTradeCount) return;
    const lastPnl = tradeReturnsRef.current[tradeReturnsRef.current.length - 1] ?? 0;
    const baseline = killSwitchRef.current.dayStartEquity || portfolio.balance || 1;
    const pnlPctOfAccount = (lastPnl / baseline) * 100;
    evalKillSwitchOnClose(pnlPctOfAccount);
    setKillSwitch(prev => ({ ...prev, lastEvaluatedTradeCount: stats.totalTrades }));
  }, [stats.totalTrades, killSwitch.lastEvaluatedTradeCount, evalKillSwitchOnClose, portfolio.balance]);

  return { config, setConfig: saveConfig, logs, isAnalyzing, stats, marketSession, killSwitch };
}
