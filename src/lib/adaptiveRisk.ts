// Adaptive Risk Engine v2
// Auto-tunes risk parameters based on stock characteristics, volatility, market regime,
// time-of-day, liquidity, drawdown state, and performance streaks.

import { KNOWN_FLOAT_DATA } from "@/lib/stockAnalysis";

export interface AdaptiveRiskProfile {
  stopLossPct: number;
  takeProfitPct: number;
  positionSizePct: number;
  requireMinRR: number;
  confidenceThreshold: number;
  trailingStopPct: number;
  // Metadata
  label: string;
  tier: "ultra_safe" | "conservative" | "balanced" | "aggressive" | "speculative";
  reasons: string[];
  riskScore: number; // raw composite risk score for external use
}

export interface StockContext {
  symbol: string;
  price: number;
  changePct: number;
  high: number;
  low: number;
  volume: number;
  avgVolume?: number;
  sector?: string;
  floatM?: number;
  atr?: number;
  // Strategy engine output
  strategyConfidence?: number;
  strategyBias?: string;
  strategyRR?: number;
  strategySL?: number;
  strategyTP?: number;
  // Market regime
  regime?: string;
  // PE score
  peScore?: number;
  // v2 additions
  spreadPct?: number;         // bid-ask spread as % of price
  recentDrawdownPct?: number; // current drawdown from peak equity
  winStreak?: number;         // consecutive wins (positive = wins, negative = losses)
  avgDailyRange?: number;     // average daily range in % over last N days
  klineCount?: number;        // number of available candles (data quality proxy)
}

// Sector volatility profiles (empirical averages)
const SECTOR_VOLATILITY: Record<string, { avgDailyMove: number; riskBucket: number }> = {
  tech:       { avgDailyMove: 2.2, riskBucket: 3 },
  finance:    { avgDailyMove: 1.5, riskBucket: 2 },
  healthcare: { avgDailyMove: 1.8, riskBucket: 2 },
  energy:     { avgDailyMove: 2.5, riskBucket: 3 },
  consumer:   { avgDailyMove: 1.2, riskBucket: 1 },
  industrial: { avgDailyMove: 1.4, riskBucket: 2 },
  materials:  { avgDailyMove: 1.9, riskBucket: 2 },
  telecom:    { avgDailyMove: 1.0, riskBucket: 1 },
  utilities:  { avgDailyMove: 0.8, riskBucket: 1 },
  realestate: { avgDailyMove: 1.3, riskBucket: 1 },
};

// Price tier risk adjustments
function getPriceTierMultiplier(price: number): { sizeMultiplier: number; stopMultiplier: number; label: string } {
  if (price < 2) return { sizeMultiplier: 0.4, stopMultiplier: 2.5, label: "Penny" };
  if (price < 5) return { sizeMultiplier: 0.5, stopMultiplier: 2.0, label: "Micro" };
  if (price < 10) return { sizeMultiplier: 0.6, stopMultiplier: 1.8, label: "Small" };
  if (price < 20) return { sizeMultiplier: 0.8, stopMultiplier: 1.5, label: "Warrior Zone" };
  if (price < 50) return { sizeMultiplier: 0.9, stopMultiplier: 1.2, label: "Mid" };
  if (price < 200) return { sizeMultiplier: 1.0, stopMultiplier: 1.0, label: "Standard" };
  if (price < 500) return { sizeMultiplier: 0.9, stopMultiplier: 0.8, label: "Large" };
  return { sizeMultiplier: 0.7, stopMultiplier: 0.6, label: "Mega" };
}

// Float-based risk adjustment
function getFloatRiskFactor(floatM: number | undefined): { factor: number; label: string } {
  if (!floatM) return { factor: 1.0, label: "Unknown float" };
  if (floatM < 5) return { factor: 2.0, label: "Ultra-low float" };
  if (floatM < 20) return { factor: 1.6, label: "Low float" };
  if (floatM < 100) return { factor: 1.2, label: "Mid float" };
  if (floatM < 500) return { factor: 1.0, label: "Normal float" };
  return { factor: 0.8, label: "High float" };
}

// Volatility bucket from intraday range
function getVolatilityBucket(changePct: number, high: number, low: number, price: number): { bucket: string; multiplier: number } {
  const rangePct = price > 0 ? ((high - low) / price) * 100 : 0;
  const combinedVol = (Math.abs(changePct) + rangePct) / 2;

  if (combinedVol > 8) return { bucket: "extreme", multiplier: 2.5 };
  if (combinedVol > 5) return { bucket: "high", multiplier: 1.8 };
  if (combinedVol > 3) return { bucket: "elevated", multiplier: 1.4 };
  if (combinedVol > 1.5) return { bucket: "normal", multiplier: 1.0 };
  return { bucket: "low", multiplier: 0.7 };
}

// Time-of-day risk factor
function getTimeOfDayFactor(): { factor: number; label: string } {
  const now = new Date();
  const etHour = now.getUTCHours() - 4; // approximate ET
  const etMin = now.getUTCMinutes();
  const etTime = etHour + etMin / 60;

  // Pre-market (4:00-9:30): wider stops, smaller size
  if (etTime < 9.5) return { factor: 1.4, label: "Pre-market" };
  // Opening bell (9:30-10:00): high volatility
  if (etTime < 10) return { factor: 1.3, label: "Opening bell" };
  // Morning momentum (10:00-11:30): best setups
  if (etTime < 11.5) return { factor: 0.9, label: "AM momentum" };
  // Lunch chop (11:30-14:00): low quality
  if (etTime < 14) return { factor: 1.2, label: "Lunch chop" };
  // Afternoon (14:00-15:30): improving
  if (etTime < 15.5) return { factor: 1.0, label: "Afternoon" };
  // Power hour (15:30-16:00): strong volume
  if (etTime < 16) return { factor: 0.85, label: "Power hour" };
  // After hours
  return { factor: 1.5, label: "After hours" };
}

// Liquidity/spread risk factor
function getSpreadFactor(spreadPct?: number): { factor: number; label: string } {
  if (!spreadPct || spreadPct <= 0) return { factor: 1.0, label: "" };
  if (spreadPct > 1.0) return { factor: 1.8, label: "Wide spread" };
  if (spreadPct > 0.5) return { factor: 1.4, label: "Moderate spread" };
  if (spreadPct > 0.2) return { factor: 1.1, label: "Normal spread" };
  return { factor: 0.95, label: "Tight spread" };
}

// Drawdown-aware sizing
function getDrawdownFactor(drawdownPct?: number): { factor: number; label: string } {
  if (!drawdownPct || drawdownPct <= 0) return { factor: 1.0, label: "" };
  if (drawdownPct > 15) return { factor: 0.3, label: "Severe DD" };
  if (drawdownPct > 10) return { factor: 0.5, label: "Heavy DD" };
  if (drawdownPct > 5) return { factor: 0.7, label: "Moderate DD" };
  if (drawdownPct > 2) return { factor: 0.85, label: "Minor DD" };
  return { factor: 1.0, label: "" };
}

// Win/loss streak factor
function getStreakFactor(streak?: number): { sizeAdj: number; confAdj: number; label: string } {
  if (!streak) return { sizeAdj: 1.0, confAdj: 0, label: "" };
  if (streak >= 5) return { sizeAdj: 0.8, confAdj: 5, label: "Hot streak (caution)" };
  if (streak >= 3) return { sizeAdj: 1.1, confAdj: -3, label: "Winning run" };
  if (streak <= -4) return { sizeAdj: 0.5, confAdj: 15, label: "Cold streak (reduce)" };
  if (streak <= -2) return { sizeAdj: 0.7, confAdj: 8, label: "Losing run" };
  return { sizeAdj: 1.0, confAdj: 0, label: "" };
}

// Data quality factor
function getDataQualityFactor(klineCount?: number): { factor: number; label: string } {
  if (!klineCount) return { factor: 1.0, label: "" };
  if (klineCount < 10) return { factor: 1.5, label: "Low data" };
  if (klineCount < 30) return { factor: 1.2, label: "Limited data" };
  if (klineCount >= 100) return { factor: 0.95, label: "Rich data" };
  return { factor: 1.0, label: "" };
}

/**
 * Compute adaptive risk parameters for a stock based on its characteristics.
 * Returns optimized SL, TP, position size, and R:R requirements.
 */
export function computeAdaptiveRisk(
  ctx: StockContext,
  baseConfig: {
    stopLossPct: number;
    takeProfitPct: number;
    positionSizePct: number;
    requireMinRR: number;
    confidenceThreshold: number;
    trailingStopPct: number;
  }
): AdaptiveRiskProfile {
  const reasons: string[] = [];

  // --- 1. Price tier ---
  const priceTier = getPriceTierMultiplier(ctx.price);
  reasons.push(`Price: ${priceTier.label} ($${ctx.price.toFixed(2)})`);

  // --- 2. Float risk ---
  const floatFactor = getFloatRiskFactor(ctx.floatM);
  if (floatFactor.label !== "Unknown float") reasons.push(`Float: ${floatFactor.label}`);

  // --- 3. Volatility ---
  const volBucket = getVolatilityBucket(ctx.changePct, ctx.high, ctx.low, ctx.price);
  reasons.push(`Vol: ${volBucket.bucket}`);

  // --- 4. Sector ---
  const sectorData = ctx.sector ? SECTOR_VOLATILITY[ctx.sector] : undefined;
  const sectorMultiplier = sectorData ? (sectorData.riskBucket === 3 ? 1.3 : sectorData.riskBucket === 1 ? 0.8 : 1.0) : 1.0;
  if (ctx.sector) reasons.push(`Sector: ${ctx.sector}`);

  // --- 5. ATR-based stop if available ---
  let atrStopPct: number | undefined;
  if (ctx.atr && ctx.price > 0) {
    atrStopPct = (ctx.atr * 2 / ctx.price) * 100;
    reasons.push(`ATR SL: ${atrStopPct.toFixed(1)}%`);
  }

  // --- 6. Market regime ---
  let regimeMultiplier = 1.0;
  let regimeConfAdj = 0;
  if (ctx.regime === "choppy") {
    regimeMultiplier = 0.6;
    regimeConfAdj = 10;
    reasons.push("Regime: Choppy → cautious");
  } else if (ctx.regime === "high_volatility") {
    regimeMultiplier = 0.7;
    regimeConfAdj = 5;
    reasons.push("Regime: HiVol → reduced");
  } else if (ctx.regime === "trending_up" || ctx.regime === "trending_down") {
    regimeMultiplier = 1.2;
    regimeConfAdj = -5;
    reasons.push("Regime: Trending → aggressive");
  } else if (ctx.regime === "low_volatility") {
    regimeMultiplier = 1.1;
    reasons.push("Regime: LowVol → larger");
  }

  // --- 7. Strategy engine override ---
  let strategyStopOverride: number | undefined;
  let strategyTPOverride: number | undefined;
  if (ctx.strategySL && ctx.strategyTP && ctx.price > 0) {
    strategyStopOverride = Math.abs(ctx.price - ctx.strategySL) / ctx.price * 100;
    strategyTPOverride = Math.abs(ctx.strategyTP - ctx.price) / ctx.price * 100;
    reasons.push(`Strat SL ${strategyStopOverride.toFixed(1)}% TP ${strategyTPOverride.toFixed(1)}%`);
  }

  // --- 8. Time-of-day (v2) ---
  const todFactor = getTimeOfDayFactor();
  if (todFactor.label) reasons.push(`ToD: ${todFactor.label}`);

  // --- 9. Spread/liquidity (v2) ---
  const spreadFactor = getSpreadFactor(ctx.spreadPct);
  if (spreadFactor.label) reasons.push(`Spread: ${spreadFactor.label}`);

  // --- 10. Drawdown-aware sizing (v2) ---
  const ddFactor = getDrawdownFactor(ctx.recentDrawdownPct);
  if (ddFactor.label) reasons.push(`DD: ${ddFactor.label}`);

  // --- 11. Win/loss streak (v2) ---
  const streakFactor = getStreakFactor(ctx.winStreak);
  if (streakFactor.label) reasons.push(`Streak: ${streakFactor.label}`);

  // --- 12. Data quality (v2) ---
  const dataFactor = getDataQualityFactor(ctx.klineCount);
  if (dataFactor.label) reasons.push(`Data: ${dataFactor.label}`);

  // --- Compute final values ---

  // Stop Loss: ATR > Strategy > Adaptive formula
  const adaptiveStopBase = baseConfig.stopLossPct * priceTier.stopMultiplier * volBucket.multiplier * todFactor.factor;
  const clampedStop = Math.max(0.3, Math.min(10, adaptiveStopBase));
  const finalStop = atrStopPct
    ? Math.max(0.3, Math.min(10, atrStopPct * todFactor.factor))
    : strategyStopOverride
      ? Math.max(0.3, Math.min(10, strategyStopOverride))
      : clampedStop;

  // Take Profit: Strategy > Adaptive (at least 2x stop for good R:R)
  const adaptiveTPBase = Math.max(finalStop * 2, baseConfig.takeProfitPct * volBucket.multiplier * sectorMultiplier);
  const finalTP = strategyTPOverride
    ? Math.max(finalStop * 1.5, strategyTPOverride)
    : Math.max(0.5, Math.min(20, adaptiveTPBase));

  // Composite risk score — higher = riskier
  const riskScore = floatFactor.factor * volBucket.multiplier * priceTier.stopMultiplier * sectorMultiplier
    * todFactor.factor * spreadFactor.factor * dataFactor.factor;

  // Position size: inversely proportional to risk, modulated by drawdown & streak
  const sizeDivisor = Math.max(1, riskScore);
  const adaptiveSize = (baseConfig.positionSizePct / sizeDivisor)
    * regimeMultiplier * priceTier.sizeMultiplier
    * ddFactor.factor * streakFactor.sizeAdj;
  const finalSize = Math.max(0.5, Math.min(baseConfig.positionSizePct * 1.5, adaptiveSize));

  // R:R: higher for riskier stocks
  const adaptiveRR = riskScore > 1.5 ? Math.max(baseConfig.requireMinRR, 2.5) : baseConfig.requireMinRR;
  const finalRR = ctx.strategyRR ? Math.max(adaptiveRR, ctx.strategyRR * 0.8) : adaptiveRR;

  // Confidence threshold: higher for riskier stocks + streak adjustments
  const confAdj = (riskScore > 2 ? 10 : riskScore > 1.3 ? 5 : 0) + regimeConfAdj + streakFactor.confAdj;
  const finalConf = Math.min(90, Math.max(35, baseConfig.confidenceThreshold + confAdj));

  // Trailing stop: wider for volatile stocks
  const finalTrailing = Math.max(0.5, Math.min(5, baseConfig.trailingStopPct * volBucket.multiplier * todFactor.factor));

  // PE score adjustments
  if (ctx.peScore !== undefined) {
    if (ctx.peScore >= 75) reasons.push(`PE ${ctx.peScore}: boosted`);
    else if (ctx.peScore < 30) reasons.push(`PE ${ctx.peScore}: cautious`);
  }

  // Determine tier label
  let tier: AdaptiveRiskProfile["tier"] = "balanced";
  if (riskScore > 3) tier = "ultra_safe";
  else if (riskScore > 2) tier = "conservative";
  else if (riskScore > 1.3) tier = "balanced";
  else if (riskScore > 0.8) tier = "aggressive";
  else tier = "speculative";

  // Label
  const label = `${priceTier.label} ${volBucket.bucket} ${floatFactor.label}`.replace(/  +/g, " ").trim();

  return {
    stopLossPct: parseFloat(finalStop.toFixed(2)),
    takeProfitPct: parseFloat(finalTP.toFixed(2)),
    positionSizePct: parseFloat(finalSize.toFixed(2)),
    requireMinRR: parseFloat(finalRR.toFixed(1)),
    confidenceThreshold: Math.round(finalConf),
    trailingStopPct: parseFloat(finalTrailing.toFixed(2)),
    label,
    tier,
    reasons,
    riskScore: parseFloat(riskScore.toFixed(2)),
  };
}

// Quick helper to get a tier color class
export function getTierColor(tier: AdaptiveRiskProfile["tier"]): string {
  switch (tier) {
    case "ultra_safe": return "text-blue-400";
    case "conservative": return "text-cyan-400";
    case "balanced": return "text-accent";
    case "aggressive": return "text-warning";
    case "speculative": return "text-loss";
  }
}

export function getTierBgColor(tier: AdaptiveRiskProfile["tier"]): string {
  switch (tier) {
    case "ultra_safe": return "bg-blue-400/10 border-blue-400/20";
    case "conservative": return "bg-cyan-400/10 border-cyan-400/20";
    case "balanced": return "bg-accent/10 border-accent/20";
    case "aggressive": return "bg-warning/10 border-warning/20";
    case "speculative": return "bg-loss/10 border-loss/20";
  }
}

export function getTierIcon(tier: AdaptiveRiskProfile["tier"]): string {
  switch (tier) {
    case "ultra_safe": return "🛡️";
    case "conservative": return "🔵";
    case "balanced": return "⚖️";
    case "aggressive": return "⚡";
    case "speculative": return "🔥";
  }
}
