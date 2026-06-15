import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";

export interface PreBoomTickerData {
  symbol: string;
  name: string;
  price: string;
  priceChangePercent: string;
  high: string;
  low: string;
  volume: string;
}

export interface PreBoomSymbolContext {
  optionBudgetFit?: boolean;
  optionQuote?: number;
  contractCost?: number;
  catalystUrgency?: number;
  sourceCount?: number;
  gateStatus?: "approved" | "wait" | "blocked";
  learnedPatternScore?: number;
  learnedPattern?: string;
}

export interface PreBoomScannerConfig {
  minPrice?: number;
  maxPrice?: number;
  minOptionPremium?: number;
  maxOptionPremium?: number;
  requireOptionBudgetFit?: boolean;
  minScoreRegular?: number;
  minScorePremarket?: number;
  contextBySymbol?: Record<string, PreBoomSymbolContext>;
}

export interface PreBoomAlert {
  symbol: string;
  score: number; // 0-100 boom likelihood
  price: number;
  changePct: number;
  reasons: string[];
  detectedAt: number;
  direction: "up" | "down";
  estimatedMoveSize: number; // % expected move
  urgency: "IMMINENT" | "BUILDING" | "WATCH";
  dismissed: boolean;
  optionBudgetFit?: boolean;
  optionQuote?: number;
  contractCost?: number;
  catalystUrgency?: number;
  sourceCount?: number;
  gateStatus?: "approved" | "wait" | "blocked";
  timeWindow?: string;
  action: string;
}

export interface PriceSnapshot {
  price: number;
  changePct: number;
  volume: string;
  high: number;
  low: number;
  time: number;
}

interface ScannerStats {
  watched: number;
  evaluated: number;
  lastScanAt?: number;
  activeSpikeWindow?: string;
  nextSpikeWindow?: string;
}

interface IntradaySpikeWindow {
  label: string;
  startMins: number;
  endMins: number;
  rationale: string;
}

const SCAN_INTERVAL_MS = 10_000; // Scan every 10s
const ALERT_COOLDOWN_MS = 120_000; // Don't re-alert same stock within 2 min
const IMMINENT_COOLDOWN_MS = 45_000; // Faster re-alert for IMMINENT
const MAX_ALERTS = 10;
const MIN_SCORE_REGULAR = 40;
const MIN_SCORE_PREMARKET = 28; // Lower bar so pre-market threshold actually fires
const URGENCY_RANK: Record<PreBoomAlert["urgency"], number> = { WATCH: 0, BUILDING: 1, IMMINENT: 2 };
const INTRADAY_SPIKE_WINDOWS: IntradaySpikeWindow[] = [
  {
    label: "10:00 ET",
    startMins: 9 * 60 + 55,
    endMins: 10 * 60 + 10,
    rationale: "first-hour decision point / scheduled-news reaction",
  },
  {
    label: "12:00 ET",
    startMins: 11 * 60 + 55,
    endMins: 12 * 60 + 10,
    rationale: "lunch transition / liquidity reset",
  },
  {
    label: "1:00 ET",
    startMins: 12 * 60 + 55,
    endMins: 13 * 60 + 10,
    rationale: "post-lunch continuation check",
  },
];

function classifyPreBoomVolume(volumeStr: string) {
  const raw = volumeStr.replace(/[^\d.]/g, "");
  let vol = parseFloat(raw) || 0;
  if (volumeStr.includes("B")) vol *= 1000;
  else if (volumeStr.includes("K")) vol /= 1000;
  if (vol >= 100) return "ultra";
  if (vol >= 30) return "high";
  if (vol >= 5) return "moderate";
  if (vol >= 1) return "low";
  return "thin";
}

// Pre-market positioning window: 9:00–9:28 ET (just before US open).
// During this window we lower the alert threshold so you can stage limit
// orders BEFORE the bell, instead of chasing price after 9:33 ET.
function isPreMarketWindow(): boolean {
  const mins = getEasternMinutes();
  return mins >= 9 * 60 && mins <= 9 * 60 + 28;
}

function getEasternMinutes(): number {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(new Date());
    const hour = parseInt(parts.find(p => p.type === "hour")?.value || "0", 10);
    const minute = parseInt(parts.find(p => p.type === "minute")?.value || "0", 10);
    return hour * 60 + minute;
  } catch {
    return 0;
  }
}

function getIntradaySpikeTiming(): { active?: IntradaySpikeWindow; next?: IntradaySpikeWindow } {
  const mins = getEasternMinutes();
  const active = INTRADAY_SPIKE_WINDOWS.find((window) => mins >= window.startMins && mins <= window.endMins);
  const next = INTRADAY_SPIKE_WINDOWS.find((window) => mins < window.startMins);
  return { active, next };
}

// Detect pre-boom patterns across all tickers
export function detectPreBoom(
  symbol: string,
  current: PreBoomTickerData,
  history: PriceSnapshot[],
  minScore: number,
  config: PreBoomScannerConfig = {},
): PreBoomAlert | null {
  const price = parseFloat(current.price);
  const changePct = parseFloat(current.priceChangePercent);
  const high = parseFloat(current.high);
  const low = parseFloat(current.low);
  const range = high - low;
  if (price <= 0 || range <= 0) return null;
  if (config.minPrice !== undefined && price < config.minPrice) return null;
  if (config.maxPrice !== undefined && price > config.maxPrice) return null;

  const context = config.contextBySymbol?.[symbol];
  if (config.requireOptionBudgetFit && context?.optionBudgetFit === false) return null;
  const spikeTiming = getIntradaySpikeTiming();

  const reasons: string[] = [];
  let score = 0;
  let marketEvidenceCount = 0;
  let dynamicEvidenceCount = 0;

  // 1. Price acceleration — is the stock gaining speed?
  let prevAccel: number | null = null;
  if (history.length >= 3) {
    const recent = history.slice(-3);
    const v1 = recent[1].price - recent[0].price;
    const v2 = recent[2].price - recent[1].price;
    const accel = v2 - v1;
    const accelPct = (accel / price) * 100;
    prevAccel = accel;

    if (accelPct > 0.05) {
      score += Math.min(25, accelPct * 100);
      reasons.push(`Price accelerating +${accelPct.toFixed(2)}%/tick`);
      marketEvidenceCount += 1;
      dynamicEvidenceCount += 1;
    }
  }

  // 1b. Jerk — acceleration of acceleration (ROC of ROC). Confirms a fresh impulse.
  if (history.length >= 4) {
    const r = history.slice(-4);
    const a1 = (r[2].price - r[1].price) - (r[1].price - r[0].price);
    const a2 = (r[3].price - r[2].price) - (r[2].price - r[1].price);
    const jerk = a2 - a1;
    const jerkPct = (jerk / price) * 100;
    if (jerkPct > 0.04) {
      score += Math.min(12, jerkPct * 60);
      reasons.push(`Impulse jerk +${jerkPct.toFixed(2)}%`);
      marketEvidenceCount += 1;
      dynamicEvidenceCount += 1;
    }
  }

  // 2. Range position — stock near day high = breakout potential
  const rangePos = (price - low) / range;
  if (rangePos > 0.85) {
    score += 15;
    reasons.push(`Near day high (${(rangePos * 100).toFixed(0)}% of range)`);
    marketEvidenceCount += 1;
  } else if (rangePos > 0.7) {
    score += 8;
    reasons.push(`Upper range (${(rangePos * 100).toFixed(0)}%)`);
    marketEvidenceCount += 1;
  }

  // 3. Strong positive momentum already building
  if (changePct > 3 && changePct < 10) {
    score += Math.min(20, changePct * 2);
    reasons.push(`Momentum building +${changePct.toFixed(1)}%`);
    marketEvidenceCount += 1;
  } else if (changePct >= 10) {
    // Already booming — reduced score (may be too late)
    score += 5;
    reasons.push(`Already running +${changePct.toFixed(1)}% — late entry risk`);
    marketEvidenceCount += 1;
  }

  // 4. Volume surge detection
  const volLevel = classifyPreBoomVolume(current.volume);
  if (volLevel === "ultra") {
    score += 15;
    reasons.push("Ultra volume — institutional activity");
    marketEvidenceCount += 1;
  } else if (volLevel === "high") {
    score += 10;
    reasons.push("High volume surge");
    marketEvidenceCount += 1;
  }

  // 4b. VWAP-proxy reclaim — price punching back above session typical price
  const typical = (high + low + price) / 3;
  if (price > typical && (price - typical) / typical > 0.002 && changePct > 0.5) {
    score += 8;
    reasons.push("Reclaimed session VWAP-proxy");
    marketEvidenceCount += 1;
  }

  // 5. Price compression then expansion (squeeze breakout)
  if (history.length >= 5) {
    const recentPrices = history.slice(-5).map(h => h.price);
    const priceRange = Math.max(...recentPrices) - Math.min(...recentPrices);
    const compressionRatio = (priceRange / price) * 100;
    
    if (compressionRatio < 0.3 && changePct > 2) {
      score += 15;
      reasons.push("Squeeze breakout — tight range expanding");
      marketEvidenceCount += 1;
      dynamicEvidenceCount += 1;
    }
  }

  // 6. Consecutive upticks
  if (history.length >= 4) {
    const last4 = history.slice(-4);
    let consecutiveUp = 0;
    for (let i = 1; i < last4.length; i++) {
      if (last4[i].price > last4[i - 1].price) consecutiveUp++;
    }
    if (consecutiveUp >= 3) {
      score += 10;
      reasons.push(`${consecutiveUp} consecutive upticks`);
      marketEvidenceCount += 1;
      dynamicEvidenceCount += 1;
    }
  }

  // 7. Volume acceleration (volume increasing over snapshots)
  if (history.length >= 3) {
    const volNums = history.slice(-3).map(h => {
      const raw = h.volume.replace(/[^\d.]/g, "");
      let v = parseFloat(raw) || 0;
      if (h.volume.includes("M")) v *= 1;
      if (h.volume.includes("K")) v /= 1000;
      if (h.volume.includes("B")) v *= 1000;
      return v;
    });
    if (volNums[2] > volNums[1] && volNums[1] > volNums[0] && volNums[0] > 0) {
      score += 10;
      reasons.push("Volume accelerating across ticks");
      marketEvidenceCount += 1;
      dynamicEvidenceCount += 1;
    }
  }

  if (context?.optionBudgetFit) {
    score += 12;
    reasons.push(`Option cost fits: $${Math.round(context.contractCost ?? (context.optionQuote ?? 0) * 100)}`);
  } else if (context?.optionQuote !== undefined) {
    score -= 10;
    reasons.push(`Option quote outside budget: $${context.optionQuote.toFixed(2)}`);
  }

  if ((context?.catalystUrgency ?? 0) >= 75) {
    score += 12;
    reasons.push(`Catalyst urgency ${context?.catalystUrgency}`);
  }

  if ((context?.sourceCount ?? 0) >= 2) {
    score += 8;
    reasons.push(`${context?.sourceCount} source confirmation`);
  }

  if ((context?.learnedPatternScore ?? 0) >= 75) {
    score += 10;
    reasons.push(`Learned winner profile: ${context?.learnedPattern ?? "high-beta catalyst"}`);
  }

  if (context?.gateStatus === "approved") {
    score += 6;
    reasons.push("Trade gate currently approved");
  } else if (context?.gateStatus === "blocked") {
    score -= 12;
    reasons.push("Trade gate blocked");
  }

  if (spikeTiming.active && (changePct > 0.5 || volLevel !== "thin" || (context?.catalystUrgency ?? 0) >= 60)) {
    score += spikeTiming.active.label === "10:00 ET" ? 8 : 5;
    reasons.push(`${spikeTiming.active.label} spike window: ${spikeTiming.active.rationale}`);
  }

  const hasStrongCurrentEvidence = rangePos > 0.7 && changePct > 0.5 && volLevel !== "thin";

  // Context can rank a setup, but it cannot manufacture a pre-boom alert.
  if (score < minScore || marketEvidenceCount < 2 || (dynamicEvidenceCount < 1 && !hasStrongCurrentEvidence)) return null;

  // Only surface upward booms — shorting alerts handled elsewhere
  if (changePct < 0) return null;
  const direction = "up" as const;
  const estimatedMoveSize = Math.min(10, changePct * 0.5 + score * 0.05);
  const urgency = score >= 70 ? "IMMINENT" as const : score >= 55 ? "BUILDING" as const : "WATCH" as const;
  const action = context?.gateStatus === "blocked"
    ? "Watch only. Do not enter until the trade gate clears."
    : context?.optionBudgetFit
      ? `Verify live chain, wait for open confirmation, then consider only the defined trigger${context?.learnedPattern ? ` for ${context.learnedPattern}` : ""}.`
      : "Find a broker-chain contract inside your budget before considering the setup.";

  return {
    symbol,
    score: Math.min(100, Math.round(score)),
    price,
    changePct,
    reasons,
    detectedAt: Date.now(),
    direction,
    estimatedMoveSize,
    urgency,
    dismissed: false,
    optionBudgetFit: context?.optionBudgetFit,
    optionQuote: context?.optionQuote,
    contractCost: context?.contractCost,
    catalystUrgency: context?.catalystUrgency,
    sourceCount: context?.sourceCount,
    gateStatus: context?.gateStatus,
    timeWindow: spikeTiming.active?.label,
    action,
  };
}

// Play distinctive pre-boom alert sound
function playBoomAlert() {
  try {
    const ctx = new AudioContext();
    // Rising three-tone alert
    [440, 660, 880].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.12);
      gain.gain.setValueAtTime(0.2, ctx.currentTime + i * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + i * 0.12 + 0.1);
      osc.start(ctx.currentTime + i * 0.12);
      osc.stop(ctx.currentTime + i * 0.12 + 0.1);
    });
    setTimeout(() => ctx.close(), 1000);
  } catch {}
}

function sendBoomNotification(alert: PreBoomAlert) {
  if (Notification.permission !== "granted") return;
  try {
    new Notification(`Pre-Boom: ${alert.symbol} ${alert.urgency}`, {
      body: `Score: ${alert.score} | +${alert.changePct.toFixed(1)}% | $${alert.price.toFixed(2)}\n${alert.reasons[0]}`,
      tag: `boom-${alert.symbol}`,
      requireInteraction: alert.urgency === "IMMINENT",
    });
  } catch {}
}

export function usePreBoomScanner(
  tickers: Record<string, PreBoomTickerData>,
  enabled: boolean = true,
  config: PreBoomScannerConfig = {},
) {
  const [alerts, setAlerts] = useState<PreBoomAlert[]>([]);
  const [scannerStats, setScannerStats] = useState<ScannerStats>({ watched: 0, evaluated: 0 });
  const historyRef = useRef<Record<string, PriceSnapshot[]>>({});
  const cooldownRef = useRef<Record<string, number>>({});
  const lastScoreRef = useRef<Record<string, { score: number; urgency: PreBoomAlert["urgency"] }>>({});
  const enabledRef = useRef(enabled);
  const configRef = useRef(config);
  enabledRef.current = enabled;
  configRef.current = config;

  const recordSnapshots = useCallback((force = false) => {
    const symbols = Object.keys(tickers);
    for (const sym of symbols) {
      const t = tickers[sym];
      if (!historyRef.current[sym]) historyRef.current[sym] = [];
      const hist = historyRef.current[sym];
      const snapshot = {
        price: parseFloat(t.price),
        changePct: parseFloat(t.priceChangePercent),
        volume: t.volume,
        high: parseFloat(t.high),
        low: parseFloat(t.low),
        time: Date.now(),
      };
      const last = hist[hist.length - 1];
      const changed =
        !last ||
        last.price !== snapshot.price ||
        last.changePct !== snapshot.changePct ||
        last.volume !== snapshot.volume ||
        last.high !== snapshot.high ||
        last.low !== snapshot.low;

      if (force || changed) {
        hist.push(snapshot);
        if (hist.length > 30) historyRef.current[sym] = hist.slice(-30);
      }
    }
  }, [tickers]);

  // Record price snapshots
  useEffect(() => {
    recordSnapshots(false);
    setScannerStats({
      watched: Object.keys(tickers).length,
      evaluated: Object.values(historyRef.current).filter((history) => history.length >= 3).length,
    });
  }, [recordSnapshots, tickers]);

  // Scan for pre-boom patterns
  useEffect(() => {
    if (!enabled) return;
    const interval = setInterval(() => {
      if (!enabledRef.current) return;
      const now = Date.now();
      const newAlerts: PreBoomAlert[] = [];
      const preMarket = isPreMarketWindow();
      const activeConfig = configRef.current;
      const spikeTiming = getIntradaySpikeTiming();
      const minScore = preMarket
        ? activeConfig.minScorePremarket ?? MIN_SCORE_PREMARKET
        : spikeTiming.active
          ? Math.max(24, (activeConfig.minScoreRegular ?? MIN_SCORE_REGULAR) - 4)
          : activeConfig.minScoreRegular ?? MIN_SCORE_REGULAR;
      let evaluated = 0;

      recordSnapshots(false);

      for (const [sym, ticker] of Object.entries(tickers)) {
        const history = historyRef.current[sym] || [];
        if (history.length < 3) continue; // Need at least 3 snapshots
        evaluated += 1;

        const alert = detectPreBoom(sym, ticker, history, minScore, activeConfig);
        if (!alert) continue;

        // Cooldown — bypass when urgency upgrades or score jumps ≥15 pts
        const last = lastScoreRef.current[sym];
        const cooldown = alert.urgency === "IMMINENT" ? IMMINENT_COOLDOWN_MS : ALERT_COOLDOWN_MS;
        const cooling = cooldownRef.current[sym] && now - cooldownRef.current[sym] < cooldown;
        const upgraded =
          last && (URGENCY_RANK[alert.urgency] > URGENCY_RANK[last.urgency] || alert.score - last.score >= 15);
        if (cooling && !upgraded) continue;

        newAlerts.push(alert);
        cooldownRef.current[sym] = now;
        lastScoreRef.current[sym] = { score: alert.score, urgency: alert.urgency };
      }

      if (newAlerts.length > 0) {
        // Sort by score descending, take top alerts
        newAlerts.sort((a, b) => b.score - a.score);
        const top = newAlerts.slice(0, 3);

        setAlerts(prev => {
          const merged = [...top, ...prev.filter(p => !top.find(n => n.symbol === p.symbol))];
          return merged.slice(0, MAX_ALERTS);
        });

        // Alert for the highest score one. During pre-market we drop the
        // threshold so you can pre-stage limit brackets before the open.
        const best = top[0];
        const threshold = preMarket ? 35 : 55;
        if (best.score >= threshold) {
          playBoomAlert();
          sendBoomNotification(best);
          toast(`${preMarket ? "PRE-MARKET" : "LIVE"} ${best.symbol} Pre-Boom Alert`, {
            description: `Score ${best.score} | +${best.changePct.toFixed(1)}% | ${best.reasons[0]}`,
            duration: preMarket ? 12000 : 8000,
          });
        }
      }

      setScannerStats({
        watched: Object.keys(tickers).length,
        evaluated,
        lastScanAt: now,
        activeSpikeWindow: spikeTiming.active?.label,
        nextSpikeWindow: spikeTiming.next?.label,
      });
    }, SCAN_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [enabled, recordSnapshots, tickers]);

  const dismissAlert = useCallback((symbol: string) => {
    setAlerts(prev => prev.map(a => a.symbol === symbol ? { ...a, dismissed: true } : a));
  }, []);

  const clearAlerts = useCallback(() => setAlerts([]), []);

  const activeAlerts = alerts.filter(a => !a.dismissed && Date.now() - a.detectedAt < 300_000); // 5 min max

  return {
    alerts: activeAlerts,
    dismissAlert,
    clearAlerts,
    totalScanned: scannerStats.watched || Object.keys(tickers).length,
    totalEvaluated: scannerStats.evaluated,
    lastScanAt: scannerStats.lastScanAt,
    activeSpikeWindow: scannerStats.activeSpikeWindow,
    nextSpikeWindow: scannerStats.nextSpikeWindow,
  };
}
