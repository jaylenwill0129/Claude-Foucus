import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Bell,
  Beaker,
  CheckCircle2,
  CircleDollarSign,
  Gauge,
  Layers3,
  LineChart,
  ListChecks,
  PauseCircle,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  Zap,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PreBoomAlerts } from "@/components/PreBoomAlerts";
import { useLiveMarketData } from "@/hooks/useLiveMarketData";
import { usePreBoomScanner, type PreBoomSymbolContext, type PreBoomTickerData } from "@/hooks/usePreBoomScanner";
import {
  buildOptionContractCandidates,
  buildOptionReasoningReport,
  buildProfitEfficiencyPlan,
  buildScenarioCurve,
  calculatePassHitVerification,
  defaultRiskSettings,
  defaultStrategyRules,
  equityCurve,
  evaluateTradeGate,
  evaluateSmallAccountFilters,
  learnedWinnerPatterns,
  optionsFlow,
  rankedPlans,
  runModeledBacktest,
  strategyPlaybook,
  tomorrowSimilarityCandidates,
  type AssetClass,
  type OpportunityPlan,
  type OptionContractCandidate,
  type OptionReasoningReport,
  type PassHitVerification,
  type RiskSettings,
  type StrategyRuleSet,
  type StrategyPlaybook,
  type CatalystEvent,
  type TradeGateResult,
} from "@/lib/derivativesEngine";
import type { LiveDataSnapshot, LiveQuote } from "@/lib/liveData";
import {
  calibrationSummary,
  falsePositivePenalty,
  sourceTrustScore,
  verifyLiveOptionChain,
} from "@/lib/accuracyEngine";

const tabs: { id: AssetClass | "all"; label: string }[] = [
  { id: "option", label: "Options" },
  { id: "stock", label: "Stocks" },
  { id: "all", label: "All" },
];

const sessionRules = [
  "Trade only A/B setups before expanding size.",
  "Max daily loss: 1.6% equity, then lock execution.",
  "Options must clear spread, IV rank, and theta filters.",
  "Favor $50-$100 liquid underlyings with $50-$100 contract cost.",
  "No new risk 10 minutes before major scheduled news.",
];

const EMPTY_PLANS: OpportunityPlan[] = [];
const EMPTY_CATALYSTS: CatalystEvent[] = [];
const EMPTY_QUOTES: LiveQuote[] = [];

const formatPct = (value: number) => `${value.toFixed(2)}%`;
const EVENT_RADAR_ALERT_KEY = "market_muse_event_radar_alerts_v1";
const INTELLIGENCE_MEMORY_KEY = "market_muse_intelligence_memory_v1";

const themePeerMap: Record<string, string[]> = {
  "AI power / energy": ["XOS", "PLUG", "KULR", "WOLF", "CHPT", "BE", "RIVN", "LEV"],
  "biotech catalyst": ["MMED", "MNMD", "CMPS", "ATAI", "CYBN", "GHRS", "SAVA"],
  quantum: ["IONQ", "QBTS", "RGTI", "QUBT", "ARQQ"],
  "space / defense": ["LUNR", "RKLB", "RDW", "ASTS", "PL"],
  "crypto / HPC": ["CIFR", "IREN", "WULF", "MARA", "RIOT", "HUT"],
  "earnings repricing": ["GFS", "CRWD", "SOFI", "HOOD", "PLTR"],
  "deal watch": ["VRNA", "MLTX", "TERN"],
  "microcap volatility": ["WCT", "TJGC", "SDOT", "STAK", "STI", "SBEV", "ASTC"],
  "momentum catalyst": ["GFS", "WOLF", "CHPT", "PLUG", "KULR"],
};

type OptionMoverRow = {
  plan: OpportunityPlan;
  quote?: LiveQuote;
  movePct: number;
  score: number;
  optionQuote: number;
  contractCost: number;
  source: LiveQuote["source"] | "modeled";
};

type DipReboundRow = OptionMoverRow & {
  reboundScore: number;
  supportGapPct: number;
  reclaimTrigger: string;
  riskNote: string;
};

type MarketWideRadarRow = {
  symbol: string;
  plan?: OpportunityPlan;
  event?: CatalystEvent;
  stage: "discovery" | "confirmation" | "trade_candidate";
  theme: string;
  score: number;
  movePct: number;
  contractCost?: number;
  optionQuote?: number;
  sources: number;
  sourceTrust: number;
  themeBreadth: number;
  freshMinutes?: number;
  sympathyPeers: string[];
  reasons: string[];
  blocker: string;
  action: string;
};

type MissedRunnerRow = {
  symbol: string;
  movePct: number;
  theme: string;
  missRisk: number;
  cause: string;
  fix: string;
  status: "caught" | "at_risk" | "missed";
};

type ExactOptionsSignal = {
  signal: "call_now" | "call_watch" | "put_now" | "put_watch" | "wait" | "skip";
  direction: "up" | "down" | "flat";
  structure: "long_option" | "debit_spread" | "skip";
  confidence: number;
  setupScore: number;
  executionScore: number;
  chainScore: number;
  timingScore: number;
  catalystScore: number;
  grade: "A+" | "A" | "B" | "C" | "D";
  urgency: "NOW" | "SOON" | "WATCH" | "WAIT";
  contractLabel: string;
  entryDebit: number;
  stopDebit: number;
  targetDebit: number;
  partialDebit: number;
  trailingStopDebit: number;
  underlyingEntry: number;
  underlyingStop: number;
  underlyingTarget: number;
  underlyingPartial: number;
  maxContracts: number;
  maxLoss: number;
  rewardRisk: number;
  quoteSpreadPct?: number;
  liveBid?: number;
  liveAsk?: number;
  liveVolume?: number;
  openInterest?: number;
  expiration?: string;
  strike?: number;
  contractType?: "call" | "put";
  timeStop: string;
  readiness: "ready_after_trigger" | "watch_only" | "blocked";
  action: string;
  exactTrigger: string;
  nextCheck: string;
  invalidation: string;
  reasons: string[];
  blockers: string[];
  confirmations: string[];
  brokerChecks: { label: string; passed: boolean; detail: string }[];
  brokerVerified: boolean;
};

type SignalCommandRow = {
  plan: OpportunityPlan;
  signal: ExactOptionsSignal;
  source: "selected" | "mover" | "event" | "dip";
  rankScore: number;
};

type DefenseRow = {
  blocker: string;
  count: number;
  symbols: string[];
  fix: string;
};

type AutomationQueueRow = {
  label: string;
  symbol?: string;
  priority: number;
  mode: "auto_monitor" | "stage_ticket" | "human_review" | "blocked";
  reason: string;
  nextAction: string;
};

type WeeklyPredictionAuditRow = {
  symbol: string;
  predictionDate: string;
  prediction: string;
  entryOpen: number;
  maxHigh: number;
  finalClose: number;
  maxFavorablePct: number;
  finalMovePct: number;
  outcome: "hit" | "miss" | "partial";
  lesson: string;
};

type IntelligenceMemoryProfile = {
  theme: string;
  symbols: string[];
  wins: number;
  misses: number;
  flats: number;
  alerts: number;
  bestMovePct: number;
  lastUpdated: number;
  seenKeys: string[];
  falsePositiveReasons: string[];
};

type IntelligenceSummary = {
  profiles: IntelligenceMemoryProfile[];
  strongestTheme?: IntelligenceMemoryProfile;
  weakestTheme?: IntelligenceMemoryProfile;
  recommendations: string[];
};

type RuntimeSignalType = "mover" | "dip_rebound" | "preboom" | "event_radar" | "reasoning";

type RuntimeSignalCandidate = {
  type: RuntimeSignalType;
  symbol: string;
  price: number;
  score: number;
  label: string;
  source: string;
  direction: "up" | "down";
  trackingBasis: "option_premium" | "underlying";
};

type RuntimeSignalRecord = RuntimeSignalCandidate & {
  id: string;
  startedAt: number;
  lastSeenAt: number;
  entryPrice: number;
  latestPrice: number;
  bestPrice: number;
  worstPrice: number;
  observations: number;
  outcome: "tracking" | "hit" | "miss" | "flat";
  move10mPct?: number;
  move30mPct?: number;
  moveClosePct?: number;
};

const clampScore = (value: number) => Math.min(100, Math.max(0, Math.round(value)));
const RUNTIME_SIGNAL_KEY = "market_muse_derivatives_runtime_signals_v5";
const RUNTIME_SIGNAL_BUCKET_MS = 30 * 60 * 1000;
const RUNTIME_SIGNAL_MAX_AGE_MS = 8 * 24 * 60 * 60 * 1000;
const RUNTIME_SIGNAL_HIT_PCT = 12;
const RUNTIME_SIGNAL_MISS_PCT = -8;
const WEEKLY_PREDICTION_AUDIT: WeeklyPredictionAuditRow[] = [
  { symbol: "WOLF", predictionDate: "2026-06-03", prediction: "Continuation watch", entryOpen: 65.9, maxHigh: 70, finalClose: 55.06, maxFavorablePct: 6.2, finalMovePct: -16.4, outcome: "miss", lesson: "Volatile, but the continuation failed. Require post-open acceptance instead of chasing the prior winner." },
  { symbol: "GFS", predictionDate: "2026-06-03", prediction: "Continuation watch", entryOpen: 86.5, maxHigh: 88.5, finalClose: 75.53, maxFavorablePct: 2.3, finalMovePct: -12.7, outcome: "miss", lesson: "Theme strength did not produce follow-through. Require semiconductor breadth and a confirmed hold." },
  { symbol: "CIFR", predictionDate: "2026-06-03", prediction: "AI/HPC continuation watch", entryOpen: 27.169, maxHigh: 28.62, finalClose: 22.45, maxFavorablePct: 5.3, finalMovePct: -17.4, outcome: "miss", lesson: "The runner offered a small early push, then faded. Fresh catalyst and volume renewal must be mandatory." },
  { symbol: "LUNR", predictionDate: "2026-06-03", prediction: "Space-contract continuation watch", entryOpen: 37.05, maxHigh: 38.79, finalClose: 29.36, maxFavorablePct: 4.7, finalMovePct: -20.8, outcome: "miss", lesson: "Prior momentum was mistaken for continuation edge. Require a new award/headline plus opening-range confirmation." },
  { symbol: "CHPT", predictionDate: "2026-06-03", prediction: "Earnings-adjacent continuation watch", entryOpen: 8.1, maxHigh: 8.43, finalClose: 7.22, maxFavorablePct: 4.1, finalMovePct: -10.9, outcome: "miss", lesson: "Event-adjacent speculation did not hold. Avoid cheap-option bias without strong chain and price confirmation." },
];

function readRuntimeSignalRecords(): RuntimeSignalRecord[] {
  try {
    const raw = window.localStorage.getItem(RUNTIME_SIGNAL_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.map((record) => ({
          ...record,
          direction: record.direction === "down" ? "down" : "up",
          trackingBasis: record.trackingBasis === "underlying" ? "underlying" : "option_premium",
        })).filter(isValidAccuracyRecord)
      : [];
  } catch {
    return [];
  }
}

function accuracyRecords() {
  return readRuntimeSignalRecords().filter(isValidAccuracyRecord);
}

function isValidAccuracyRecord(record: RuntimeSignalRecord) {
  if (record.source === "modeled" || record.source === "event radar") return false;
  if (record.trackingBasis === "option_premium") {
    return ["polygon", "alpha_vantage", "live option"].includes(record.source);
  }
  return record.entryPrice > 0 && Number.isFinite(record.entryPrice);
}

function writeRuntimeSignalRecords(records: RuntimeSignalRecord[]) {
  try {
    window.localStorage.setItem(RUNTIME_SIGNAL_KEY, JSON.stringify(records.slice(-1200)));
  } catch {
    // Runtime analytics should never interrupt the trading workflow.
  }
}

function recentContinuationAudit(symbol: string) {
  return WEEKLY_PREDICTION_AUDIT.find((row) => row.symbol === planRoot(symbol));
}

function recentContinuationPenalty(symbol: string, hasFreshCatalyst: boolean) {
  const audit = recentContinuationAudit(symbol);
  if (!audit || hasFreshCatalyst) return 0;
  return Math.min(22, Math.round(Math.abs(audit.finalMovePct) * 0.8));
}

function signalBucketId(candidate: RuntimeSignalCandidate) {
  const bucket = Math.floor(Date.now() / RUNTIME_SIGNAL_BUCKET_MS);
  return `${candidate.type}:${candidate.symbol}:${candidate.trackingBasis}:${candidate.direction}:${bucket}`;
}

function directionalRecordMove(record: Pick<RuntimeSignalRecord, "entryPrice" | "direction" | "trackingBasis">, price: number) {
  const raw = ((price - record.entryPrice) / Math.max(0.01, record.entryPrice)) * 100;
  return record.trackingBasis === "underlying" && record.direction === "down" ? -raw : raw;
}

function outcomeFor(record: Pick<RuntimeSignalRecord, "entryPrice" | "direction" | "trackingBasis">, latestPrice: number, observations: number): RuntimeSignalRecord["outcome"] {
  const entryPrice = record.entryPrice;
  if (entryPrice <= 0) return "tracking";
  const changePct = directionalRecordMove(record, latestPrice);
  const hitPct = record.trackingBasis === "underlying" ? 4 : RUNTIME_SIGNAL_HIT_PCT;
  const missPct = record.trackingBasis === "underlying" ? -3 : RUNTIME_SIGNAL_MISS_PCT;
  if (changePct >= hitPct) return "hit";
  if (changePct <= missPct) return "miss";
  return observations >= 6 ? "flat" : "tracking";
}

function recordMovePct(record: RuntimeSignalRecord, field: "latestPrice" | "bestPrice" | "worstPrice" = "latestPrice") {
  return directionalRecordMove(record, record[field]);
}

function summarizeRuntimePerformance(records: RuntimeSignalRecord[]) {
  const completed = records.filter((record) => record.outcome !== "tracking");
  const hits = completed.filter((record) => record.outcome === "hit").length;
  const misses = completed.filter((record) => record.outcome === "miss").length;
  const flats = completed.filter((record) => record.outcome === "flat").length;
  const hitRate = completed.length ? Math.round((hits / completed.length) * 100) : 0;
  const avgMovePct = completed.length
    ? completed.reduce((sum, record) => sum + recordMovePct(record), 0) / completed.length
    : 0;
  const avgFavorablePct = completed.length
    ? completed.reduce((sum, record) => sum + recordMovePct(record, "bestPrice"), 0) / completed.length
    : 0;
  const avgAdversePct = completed.length
    ? completed.reduce((sum, record) => sum + recordMovePct(record, "worstPrice"), 0) / completed.length
    : 0;
  const byType = (["mover", "dip_rebound", "preboom", "event_radar", "reasoning"] as RuntimeSignalType[]).map((type) => {
    const group = completed.filter((record) => record.type === type);
    const groupHits = group.filter((record) => record.outcome === "hit").length;
    const groupAvgMove = group.length ? group.reduce((sum, record) => sum + recordMovePct(record), 0) / group.length : 0;
    const groupAvgFavorable = group.length ? group.reduce((sum, record) => sum + recordMovePct(record, "bestPrice"), 0) / group.length : 0;
    return {
      type,
      count: group.length,
      hitRate: group.length ? Math.round((groupHits / group.length) * 100) : 0,
      avgMovePct: groupAvgMove,
      avgFavorablePct: groupAvgFavorable,
    };
  });
  const bySource = Array.from(new Set(completed.map((record) => record.source))).map((source) => {
    const group = completed.filter((record) => record.source === source);
    const hits = group.filter((record) => record.outcome === "hit").length;
    return { source, count: group.length, hitRate: group.length ? Math.round((hits / group.length) * 100) : 0 };
  }).sort((a, b) => b.count - a.count || b.hitRate - a.hitRate).slice(0, 6);
  const recommendations = [
    completed.length < 5 ? "Collect at least 5 completed runtime signals before trusting performance claims." : "",
    completed.length >= 5 && hitRate < 45 ? "Bot is underperforming this session. Paper trade only or raise score thresholds." : "",
    completed.length >= 5 && misses > hits ? "Misses exceed hits. Reduce risk and require stronger live-chain confirmation." : "",
    avgFavorablePct >= 15 && hitRate < 55 ? "Signals are giving pops but not holding. Take quicker partials or tighten exits." : "",
    avgAdversePct <= -10 ? "Average adverse move is high. Avoid entries before reclaim/retest confirmation." : "",
    ...byType
      .filter((row) => row.count >= 3 && row.hitRate < 40)
      .map((row) => `${row.type.replace(/_/g, " ")} signals are weak (${row.hitRate}% hit rate). De-prioritize this type until it improves.`),
    ...byType
      .filter((row) => row.count >= 3 && row.hitRate >= 60)
      .map((row) => `${row.type.replace(/_/g, " ")} signals are currently strongest (${row.hitRate}% hit rate). Prioritize only with fresh data.`),
  ].filter(Boolean).slice(0, 4);

  return { completed, hits, misses, flats, hitRate, avgMovePct, avgFavorablePct, avgAdversePct, byType, bySource, recommendations };
}

function useRuntimeSignalPerformance(candidates: RuntimeSignalCandidate[]) {
  const [records, setRecords] = useState<RuntimeSignalRecord[]>(() => readRuntimeSignalRecords());
  const lastUpdateAt = useRef(0);
  const candidateKey = useMemo(
    () => candidates
      .map((candidate) => `${signalBucketId(candidate)}:${candidate.trackingBasis}:${candidate.direction}:${candidate.price.toFixed(3)}:${Math.round(candidate.score)}`)
      .join("|"),
    [candidates]
  );

  useEffect(() => {
    if (!candidates.length) return;
    const updateAt = Date.now();
    if (updateAt - lastUpdateAt.current < 5_000) return;
    lastUpdateAt.current = updateAt;
    setRecords((current) => {
      const now = updateAt;
      const byId = new Map(current.filter((record) => isValidAccuracyRecord(record) && now - record.startedAt <= RUNTIME_SIGNAL_MAX_AGE_MS).map((record) => [record.id, record]));

      candidates.forEach((candidate) => {
        if (!Number.isFinite(candidate.price) || candidate.price <= 0) return;
        const id = signalBucketId(candidate);
        const existing = byId.get(id);
        if (!existing) {
          byId.set(id, {
            ...candidate,
            id,
            startedAt: now,
            lastSeenAt: now,
            entryPrice: candidate.price,
            latestPrice: candidate.price,
            bestPrice: candidate.price,
            worstPrice: candidate.price,
            observations: 1,
            outcome: "tracking",
          });
          return;
        }

        const observations = existing.observations + (existing.latestPrice === candidate.price ? 0 : 1);
        const tracksBearishUnderlying = candidate.trackingBasis === "underlying" && candidate.direction === "down";
        const updated: RuntimeSignalRecord = {
          ...existing,
          ...candidate,
          lastSeenAt: now,
          latestPrice: candidate.price,
          bestPrice: tracksBearishUnderlying ? Math.min(existing.bestPrice, candidate.price) : Math.max(existing.bestPrice, candidate.price),
          worstPrice: tracksBearishUnderlying ? Math.max(existing.worstPrice, candidate.price) : Math.min(existing.worstPrice, candidate.price),
          observations,
          outcome: outcomeFor(existing, candidate.price, observations),
          move10mPct: existing.move10mPct ?? (now - existing.startedAt >= 10 * 60 * 1000 ? directionalRecordMove(existing, candidate.price) : undefined),
          move30mPct: existing.move30mPct ?? (now - existing.startedAt >= 30 * 60 * 1000 ? directionalRecordMove(existing, candidate.price) : undefined),
          moveClosePct: existing.moveClosePct ?? (now - existing.startedAt >= 6.5 * 60 * 60 * 1000 ? directionalRecordMove(existing, candidate.price) : undefined),
        };
        byId.set(id, updated);
      });

      const next = Array.from(byId.values()).sort((a, b) => b.startedAt - a.startedAt).slice(0, 1200);
      writeRuntimeSignalRecords(next);
      return next;
    });
  }, [candidateKey]);

  const clear = () => {
    writeRuntimeSignalRecords([]);
    setRecords([]);
  };

  return { records, summary: summarizeRuntimePerformance(records), clear };
}

function readEventRadarAlertIds() {
  try {
    const raw = window.localStorage.getItem(EVENT_RADAR_ALERT_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set<string>();
  }
}

function writeEventRadarAlertIds(ids: Set<string>) {
  try {
    window.localStorage.setItem(EVENT_RADAR_ALERT_KEY, JSON.stringify(Array.from(ids).slice(-120)));
  } catch {
    // Alert memory is helpful, but it should never block the app.
  }
}

function readIntelligenceMemory(): Record<string, IntelligenceMemoryProfile> {
  try {
    const raw = window.localStorage.getItem(INTELLIGENCE_MEMORY_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeIntelligenceMemory(memory: Record<string, IntelligenceMemoryProfile>) {
  try {
    window.localStorage.setItem(INTELLIGENCE_MEMORY_KEY, JSON.stringify(memory));
  } catch {
    // Intelligence memory is additive; losing it should not break live scanning.
  }
}

function emptyMemoryProfile(theme: string): IntelligenceMemoryProfile {
  return {
    theme,
    symbols: [],
    wins: 0,
    misses: 0,
    flats: 0,
    alerts: 0,
    bestMovePct: 0,
    lastUpdated: Date.now(),
    seenKeys: [],
    falsePositiveReasons: [],
  };
}

function pushUnique<T>(items: T[], value: T, limit = 8) {
  return Array.from(new Set([value, ...items])).slice(0, limit);
}

function memoryHasSeen(profile: IntelligenceMemoryProfile, key: string) {
  profile.seenKeys = Array.isArray(profile.seenKeys) ? profile.seenKeys : [];
  if (profile.seenKeys.includes(key)) return true;
  profile.seenKeys = pushUnique(profile.seenKeys, key, 80);
  return false;
}

function memoryScoreForTheme(theme: string) {
  const profile = readIntelligenceMemory()[theme];
  if (!profile) return 0;
  const total = profile.wins + profile.misses + profile.flats;
  if (!total) return Math.min(6, profile.alerts);
  const hitRate = profile.wins / total;
  return clampScore(hitRate * 24 + Math.min(12, profile.bestMovePct * 0.25) - profile.misses * 3 + profile.alerts * 0.5) - 12;
}

function summarizeIntelligenceMemory(memory: Record<string, IntelligenceMemoryProfile>): IntelligenceSummary {
  const profiles = Object.values(memory)
    .map((profile) => ({
      ...emptyMemoryProfile(profile.theme),
      ...profile,
      symbols: Array.isArray(profile.symbols) ? profile.symbols : [],
      falsePositiveReasons: Array.isArray(profile.falsePositiveReasons) ? profile.falsePositiveReasons : [],
      seenKeys: Array.isArray(profile.seenKeys) ? profile.seenKeys : [],
    }))
    .sort((a, b) => {
      const aScore = a.wins * 8 + a.bestMovePct * 0.4 - a.misses * 7 - a.flats * 2 + a.alerts;
      const bScore = b.wins * 8 + b.bestMovePct * 0.4 - b.misses * 7 - b.flats * 2 + b.alerts;
      return bScore - aScore;
    })
    .slice(0, 8);
  const strongestTheme = profiles.find((profile) => profile.wins > profile.misses || profile.bestMovePct >= 20);
  const weakestTheme = [...profiles].reverse().find((profile) => profile.misses > profile.wins && profile.falsePositiveReasons.length);
  const recommendations = [
    strongestTheme ? `Lean into ${strongestTheme.theme} only when fresh catalyst and liquid options confirm.` : "No strong learned theme yet. Keep collecting runtime outcomes.",
    weakestTheme ? `${weakestTheme.theme} has produced false positives: ${weakestTheme.falsePositiveReasons[0]}.` : "",
    profiles.some((profile) => profile.bestMovePct >= 50) ? "Extreme winners exist in memory. Keep alerting, but require pullback/VWAP reclaim before entry." : "",
  ].filter(Boolean).slice(0, 3);

  return { profiles, strongestTheme, weakestTheme, recommendations };
}

function useIntelligenceMemory(
  radarRows: MarketWideRadarRow[],
  missedRows: MissedRunnerRow[],
  runtimeRecords: RuntimeSignalRecord[],
) {
  const [summary, setSummary] = useState<IntelligenceSummary>(() => summarizeIntelligenceMemory(readIntelligenceMemory()));
  const radarRowsKey = radarRows.map((row) => `${row.symbol}:${row.stage}:${row.score}:${row.movePct.toFixed(2)}`).join("|");
  const missedRowsKey = missedRows.map((row) => `${row.symbol}:${row.status}:${row.movePct.toFixed(2)}:${row.cause}`).join("|");
  const runtimeRecordsKey = runtimeRecords.map((record) => `${record.id}:${record.outcome}:${record.latestPrice.toFixed(3)}`).join("|");

  useEffect(() => {
    const memory = readIntelligenceMemory();
    const now = Date.now();

    radarRows.forEach((row) => {
      if (row.stage === "discovery" && Math.abs(row.movePct) < 12 && row.score < 64) return;
      const profile = memory[row.theme] ?? emptyMemoryProfile(row.theme);
      const radarKey = `radar:${row.symbol}:${row.stage}:${Math.floor(now / (30 * 60 * 1000))}`;
      if (memoryHasSeen(profile, radarKey)) {
        memory[row.theme] = profile;
        return;
      }
      profile.alerts += 1;
      profile.symbols = pushUnique(profile.symbols ?? [], row.symbol);
      profile.bestMovePct = Math.max(profile.bestMovePct, Math.abs(row.movePct));
      profile.lastUpdated = now;
      memory[row.theme] = profile;
    });

    missedRows.forEach((row) => {
      if (row.status === "caught") return;
      const profile = memory[row.theme] ?? emptyMemoryProfile(row.theme);
      const missKey = `miss:${row.symbol}:${row.status}:${Math.floor(now / (2 * 60 * 60 * 1000))}`;
      if (memoryHasSeen(profile, missKey)) {
        memory[row.theme] = profile;
        return;
      }
      profile.misses += row.status === "missed" ? 1 : 0;
      profile.flats += row.status === "at_risk" ? 1 : 0;
      profile.symbols = pushUnique(profile.symbols ?? [], row.symbol);
      profile.bestMovePct = Math.max(profile.bestMovePct, Math.abs(row.movePct));
      profile.falsePositiveReasons = pushUnique(profile.falsePositiveReasons ?? [], row.cause, 5);
      profile.lastUpdated = now;
      memory[row.theme] = profile;
    });

    runtimeRecords
      .filter((record) => record.outcome !== "tracking")
      .slice(0, 60)
      .forEach((record) => {
        const row = radarRows.find((candidate) => candidate.symbol === record.symbol);
        const theme = row?.theme ?? "runtime signal";
        const profile = memory[theme] ?? emptyMemoryProfile(theme);
        const runtimeKey = `runtime:${record.id}:${record.outcome}`;
        if (memoryHasSeen(profile, runtimeKey)) {
          memory[theme] = profile;
          return;
        }
        if (record.outcome === "hit") profile.wins += 1;
        if (record.outcome === "miss") profile.misses += 1;
        if (record.outcome === "flat") profile.flats += 1;
        profile.symbols = pushUnique(profile.symbols ?? [], record.symbol);
        profile.bestMovePct = Math.max(profile.bestMovePct, Math.abs(recordMovePct(record, "bestPrice")));
        if (record.outcome === "miss") {
          profile.falsePositiveReasons = pushUnique(profile.falsePositiveReasons ?? [], `${record.label} failed after alert`, 5);
        }
        profile.lastUpdated = now;
        memory[theme] = profile;
      });

    writeIntelligenceMemory(memory);
    setSummary(summarizeIntelligenceMemory(memory));
  }, [missedRowsKey, radarRowsKey, runtimeRecordsKey]);

  const clear = () => {
    writeIntelligenceMemory({});
    setSummary(summarizeIntelligenceMemory({}));
  };

  return { summary, clear };
}

function useEventRadarAlerts(rows: MarketWideRadarRow[]) {
  const [lastAlert, setLastAlert] = useState<MarketWideRadarRow | null>(null);

  useEffect(() => {
    if (!rows.length) return;
    const alertIds = readEventRadarAlertIds();
    const bucket = Math.floor(Date.now() / (30 * 60 * 1000));
    const urgent = rows.find((row) =>
      row.score >= 74 &&
      row.stage !== "discovery" &&
      (row.freshMinutes === undefined || row.freshMinutes <= 180)
    );
    if (!urgent) return;

    const id = `${urgent.symbol}:${urgent.stage}:${bucket}`;
    if (alertIds.has(id)) return;

    alertIds.add(id);
    writeEventRadarAlertIds(alertIds);
    setLastAlert(urgent);

    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(`Market Muse: ${urgent.symbol} ${urgent.stage.replace("_", " ")}`, {
        body: `${urgent.theme} | score ${urgent.score} | ${urgent.action}`,
      });
    }
  }, [rows]);

  return lastAlert;
}

function planRoot(symbol: string) {
  return symbol.split(/[ .]/)[0].replace(/^O:/, "").toUpperCase();
}

function quoteMatchesPlan(quote: LiveQuote, plan: OpportunityPlan) {
  const root = planRoot(plan.symbol);
  return (
    quote.assetClass === "option" &&
    (quote.underlyingSymbol?.toUpperCase() === root ||
      planRoot(quote.symbol) === root ||
      quote.symbol.toUpperCase().includes(root))
  );
}

function findBestOptionQuote(snapshot: LiveDataSnapshot | null, plan: OpportunityPlan) {
  const expectedType = expectedContractType(plan);
  return (snapshot?.options ?? [])
    .filter((quote) => quoteMatchesPlan(quote, plan))
    .sort((a, b) => {
      const scoreQuote = (quote: LiveQuote) => {
        const spreadBps = optionQuoteSpreadBps(quote);
        return (
          Math.abs(quote.changePct) * 2 +
          (quote.contractType === expectedType ? 35 : quote.contractType ? -25 : 0) +
          (quote.bid && quote.ask ? 18 : -8) +
          (spreadBps !== undefined ? Math.max(-20, 18 - spreadBps / 100) : -4) +
          Math.min(18, (quote.volume ?? 0) / 100) +
          Math.min(12, (quote.openInterest ?? 0) / 500) +
          (quote.price > 0 ? 8 : -20)
        );
      };
      return scoreQuote(b) - scoreQuote(a);
    })[0];
}

function exactSignalLabel(signal: ExactOptionsSignal["signal"]) {
  if (signal === "call_now") return "CALL NOW";
  if (signal === "call_watch") return "CALL WATCH";
  if (signal === "put_now") return "PUT NOW";
  if (signal === "put_watch") return "PUT WATCH";
  if (signal === "skip") return "SKIP";
  return "WAIT";
}

function expectedContractType(plan: OpportunityPlan): "call" | "put" {
  return plan.bias === "bearish" ? "put" : "call";
}

function optionQuoteSpreadBps(quote?: LiveQuote) {
  if (!quote?.bid || !quote.ask || quote.bid <= 0 || quote.ask <= 0) return undefined;
  const mid = (quote.bid + quote.ask) / 2;
  return mid > 0 ? ((quote.ask - quote.bid) / mid) * 10000 : undefined;
}

function quoteAgeMinutes(quote?: LiveQuote) {
  if (!quote?.updatedAt) return undefined;
  const parsed = Date.parse(quote.updatedAt);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.max(0, Math.round((Date.now() - parsed) / 60000));
}

function daysUntilExpiration(expiration?: string) {
  if (!expiration) return undefined;
  const parsed = Date.parse(expiration);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.max(0, Math.ceil((parsed - Date.now()) / 86400000));
}

function quoteExecutionScore(quote: LiveQuote | undefined, plan: OpportunityPlan, settings: RiskSettings) {
  if (!quote || quote.source === "fallback" || quote.price <= 0) return 35;
  const spreadBps = optionQuoteSpreadBps(quote);
  const expectedType = expectedContractType(plan);
  const dte = daysUntilExpiration(quote.expiration);
  const directionMatch = !quote.contractType || quote.contractType === expectedType;
  const premiumFit = quote.price >= settings.minOptionPremium && quote.price <= settings.maxOptionPremium;
  const spreadFit = spreadBps !== undefined && spreadBps <= settings.maxOptionsSpreadBps;
  const volumeFit = (quote.volume ?? 0) >= 50 || (quote.openInterest ?? 0) >= 250;
  const deltaFit = quote.delta === undefined || Math.abs(quote.delta) >= 0.16 && Math.abs(quote.delta) <= 0.55;
  const dteFit = dte === undefined || dte >= settings.minDte;
  const age = quoteAgeMinutes(quote);
  const fresh = age === undefined || age <= 15;

  return clampScore(
    36 +
    (directionMatch ? 12 : -18) +
    (premiumFit ? 16 : -16) +
    (spreadFit ? 15 : spreadBps === undefined ? -4 : -18) +
    (volumeFit ? 10 : -8) +
    (deltaFit ? 7 : -8) +
    (dteFit ? 7 : -10) +
    (fresh ? 5 : -6) -
    Math.min(12, Math.abs(quote.changePct) * 0.25)
  );
}

function timingScoreForExactSignal() {
  const phase = getMarketPhase();
  const score =
    phase.label === "10:00 spike window" ? 84 :
    phase.label === "open drive" ? 78 :
    phase.label === "opening range" ? 72 :
    phase.label === "regular session" ? 66 :
    phase.label === "pre-open staging" ? 48 :
    phase.label === "opening print" ? 34 :
    phase.label === "off-hours" ? 28 : 42;
  return { phase, score };
}

function exactSignalGrade(confidence: number): ExactOptionsSignal["grade"] {
  if (confidence >= 90) return "A+";
  if (confidence >= 80) return "A";
  if (confidence >= 68) return "B";
  if (confidence >= 55) return "C";
  return "D";
}

function buildExactOptionsSignal(
  plan: OpportunityPlan,
  settings: RiskSettings,
  rules: StrategyRuleSet,
  snapshot: LiveDataSnapshot | null,
): ExactOptionsSignal {
  const baseTiming = timingScoreForExactSignal();

  if (plan.assetClass !== "option") {
    return {
      signal: "skip",
      direction: "flat",
      structure: "skip",
      confidence: 0,
      setupScore: 0,
      executionScore: 0,
      chainScore: 0,
      timingScore: baseTiming.score,
      catalystScore: 0,
      grade: "D",
      urgency: "WAIT",
      contractLabel: "No option contract",
      entryDebit: 0,
      stopDebit: 0,
      targetDebit: 0,
      partialDebit: 0,
      trailingStopDebit: 0,
      underlyingEntry: plan.price,
      underlyingStop: plan.support,
      underlyingTarget: plan.resistance,
      underlyingPartial: plan.price,
      maxContracts: 0,
      maxLoss: 0,
      rewardRisk: 0,
      timeStop: "No option time stop.",
      readiness: "blocked",
      action: "Skip non-options in this workflow.",
      exactTrigger: "Select an options setup.",
      nextCheck: "Select an options setup.",
      invalidation: "No option signal.",
      reasons: [],
      blockers: ["Non-options setup selected."],
      confirmations: [],
      brokerChecks: [],
      brokerVerified: false,
    };
  }

  const reasoning = buildOptionReasoningReport(plan, settings, rules);
  const backtest = runModeledBacktest(plan, 80);
  const gate = evaluateTradeGate(plan, backtest, settings, rules);
  const candidates = buildOptionContractCandidates(plan, settings);
  const tradableCandidates = candidates.filter((candidate) => candidate.verdict !== "skip" && candidate.verdict !== "too_expensive");
  const contract =
    reasoning.bestContract && reasoning.bestContract.verdict !== "skip" && reasoning.bestContract.verdict !== "too_expensive"
      ? reasoning.bestContract
      : tradableCandidates
          .sort((a, b) => b.capitalEfficiencyScore - a.capitalEfficiencyScore)[0] ??
        candidates.find((candidate) => candidate.verdict === "spread_only") ??
        candidates[0];
  const liveQuote = findBestOptionQuote(snapshot, plan);
  const hasLiveOption = Boolean(liveQuote && liveQuote.source !== "fallback" && liveQuote.price > 0);
  const chainAudit = verifyLiveOptionChain(liveQuote, settings.maxOptionsSpreadBps);
  const learnedFalsePositivePenalty = falsePositivePenalty(plan.symbol, accuracyRecords());
  const expectedType = expectedContractType(plan);
  const quoteSpreadBps = optionQuoteSpreadBps(liveQuote);
  const quoteAge = quoteAgeMinutes(liveQuote);
  const quoteDte = daysUntilExpiration(liveQuote?.expiration);
  const liveDirectionMatch = !liveQuote?.contractType || liveQuote.contractType === expectedType;
  const livePremiumFit = !liveQuote || liveQuote.price >= settings.minOptionPremium && liveQuote.price <= settings.maxOptionPremium;
  const liveSpreadFit = quoteSpreadBps !== undefined && quoteSpreadBps <= settings.maxOptionsSpreadBps;
  const liveThin = hasLiveOption && (liveQuote?.volume ?? 0) < 25 && (liveQuote?.openInterest ?? 0) < 100;
  const useSpread = contract?.verdict === "spread_only";
  const structure: ExactOptionsSignal["structure"] = !contract || contract.verdict === "skip" || contract.verdict === "too_expensive"
    ? "skip"
    : useSpread
      ? "debit_spread"
      : "long_option";
  const modeledDebit = useSpread
    ? contract?.estimatedSpreadDebit ?? contract?.estimatedPremium ?? 0
    : contract?.estimatedPremium ?? 0;
  const liveMid = liveQuote?.bid && liveQuote.ask ? (liveQuote.bid + liveQuote.ask) / 2 : liveQuote?.price;
  const entryBasis = hasLiveOption ? Math.max(0.01, liveMid ?? liveQuote!.price) : Math.max(0.01, modeledDebit);
  const entryDebit = Number(entryBasis.toFixed(2));
  const stopPct = contract?.stopLossPct ?? 30;
  const targetPct = contract?.profitTargetPct ?? 35;
  const stopDebit = Number(Math.max(0.01, entryDebit * (1 - stopPct / 100)).toFixed(2));
  const targetDebit = Number((entryDebit * (1 + targetPct / 100)).toFixed(2));
  const partialDebit = Number((entryDebit * (1 + Math.min(28, targetPct * 0.52) / 100)).toFixed(2));
  const trailingStopDebit = Number(Math.max(stopDebit, entryDebit * 0.92).toFixed(2));
  const maxContracts = structure === "long_option"
    ? Math.max(0, contract?.maxLongCallContracts ?? 0)
    : structure === "debit_spread"
      ? Math.max(0, contract?.maxSpreadContracts ?? 0)
      : 0;
  const maxLoss = maxContracts > 0
    ? Math.round(entryDebit * 100 * maxContracts)
    : 0;
  const direction: ExactOptionsSignal["direction"] = plan.bias === "bearish" ? "down" : plan.bias === "bullish" ? "up" : "flat";
  const underlyingEntry = plan.retestStatus === "confirmed"
    ? plan.price
    : direction === "down"
      ? Math.min(plan.price, plan.support)
      : Math.max(plan.price, plan.resistance);
  const underlyingStop = direction === "down"
    ? Number(Math.max(plan.resistance, plan.price * 1.015).toFixed(2))
    : Number(Math.min(plan.support, plan.price * 0.985).toFixed(2));
  const underlyingTarget = direction === "down"
    ? Number(Math.max(0.01, plan.support - (plan.resistance - plan.support) * 0.5).toFixed(2))
    : Number(Math.max(plan.resistance, plan.price * (1 + Math.max(0.02, plan.atrPct / 100))).toFixed(2));
  const underlyingPartial = Number((direction === "down"
    ? Math.max(0.01, underlyingEntry - Math.abs(underlyingEntry - underlyingTarget) * 0.45)
    : underlyingEntry + Math.abs(underlyingTarget - underlyingEntry) * 0.45
  ).toFixed(2));
  const rewardRisk = Number(((targetDebit - entryDebit) / Math.max(0.01, entryDebit - stopDebit)).toFixed(2));
  const root = planRoot(plan.symbol);
  const catalyst = (snapshot?.catalysts ?? [])
    .find((event) => event.symbol === root || event.symbol === plan.symbol);
  const freshMinutes = catalystAgeMinutes(catalyst);
  const catalystQuality = catalystQualityScore(catalyst, plan.name);
  const catalystTrust = sourceTrustScore(catalyst, accuracyRecords());
  const hasFreshCatalyst = Boolean(catalyst && freshMinutes !== undefined && freshMinutes <= 180 && catalystQuality >= 52);
  const continuationPenalty = recentContinuationPenalty(plan.symbol, hasFreshCatalyst);
  const catalystScore = clampScore(
    plan.catalystScore * 0.36 +
    (catalyst?.urgencyScore ?? 0) * 0.32 +
    catalystQuality * 0.18 +
    catalystTrust * 0.12 +
    (catalyst?.corroborationScore ?? catalyst?.sources?.length ?? 0) * 5 +
    freshnessBoostFor(freshMinutes) -
    (catalyst?.chaseRisk === "high" ? 12 : catalyst?.chaseRisk === "medium" ? 4 : 0)
  );
  const setupScore = clampScore(
    reasoning.score * 0.38 +
    gate.score * 0.18 +
    backtest.edgeScore * 0.12 +
    plan.trendScore * 0.1 +
    plan.flowScore * 0.1 +
    plan.volumeScore * 0.06 +
    (plan.retestStatus === "confirmed" ? 10 : plan.retestStatus === "retesting" ? 6 : plan.retestStatus === "waiting" ? -2 : -16) +
    (direction === "flat" ? -18 : 0) -
    continuationPenalty -
    learnedFalsePositivePenalty
  );
  const chainScore = quoteExecutionScore(liveQuote, plan, settings);
  const executionScore = clampScore(
    (contract?.capitalEfficiencyScore ?? 0) * 0.34 +
    chainScore * 0.26 +
    Math.min(100, rewardRisk * 38) * 0.16 +
    (maxContracts >= 2 ? 12 : maxContracts === 1 ? 6 : -18) +
    (structure === "long_option" ? 8 : structure === "debit_spread" ? 3 : -20) +
    (entryDebit >= settings.minOptionPremium && entryDebit <= settings.maxOptionPremium ? 12 : -14) -
    Math.min(16, plan.spreadBps * 0.65) -
    Math.min(10, plan.thetaDrag ?? 40) * 0.12
  );
  const timingScore = baseTiming.score;
  const confidence = clampScore(
    setupScore * 0.34 +
    executionScore * 0.28 +
    chainScore * 0.18 +
    timingScore * 0.1 +
    catalystScore * 0.1
  );
  const grade = exactSignalGrade(confidence);
  const timingOpen = ["opening range", "10:00 spike window", "open drive", "regular session"].includes(baseTiming.phase.label);
  const openingDanger = baseTiming.phase.label === "opening print";
  const preOrOffHours = baseTiming.phase.label === "pre-open staging" || baseTiming.phase.label === "off-hours";
  const blockers = [
    gate.status === "blocked" ? `Trade gate blocked: ${gate.checks.find((check) => !check.passed)?.label ?? "failed rule"}.` : "",
    structure === "skip" ? contract?.skipReasons[0] ?? "No usable contract structure." : "",
    direction === "flat" ? "No directional edge; exact option signal needs bullish or bearish bias." : "",
    maxContracts < 1 ? "Risk budget cannot support one contract/spread." : "",
    !hasLiveOption ? "Live option chain not verified yet; no exact entry without broker quote." : "",
    hasLiveOption && !chainAudit.verified ? `Live chain audit is ${chainAudit.score}/100; all broker checks must pass.` : "",
    hasLiveOption && !liveDirectionMatch ? `Live quote is not a ${expectedType}; contract direction mismatch.` : "",
    hasLiveOption && !livePremiumFit ? `Live debit $${liveQuote!.price.toFixed(2)} is outside your $${settings.minOptionPremium}-$${settings.maxOptionPremium} premium range.` : "",
    hasLiveOption && !liveSpreadFit ? `Live bid/ask spread is ${quoteSpreadBps ? (quoteSpreadBps / 100).toFixed(1) : "unknown"}%, too wide for an exact fill.` : "",
    liveThin ? "Live chain is thin; volume/open interest does not support a clean fill." : "",
    plan.spreadBps > settings.maxOptionsSpreadBps ? "Option spread is above your max spread rule." : "",
    plan.eventRisk > settings.blockEventRiskAbove ? "Event risk is above your block level." : "",
    rewardRisk < 1.45 ? "Premium reward/risk is not strong enough." : "",
    plan.retestStatus === "failed" ? "Retest failed; wait for a new base." : "",
    plan.higherTimeframeTrend === "downtrend" && direction === "up" ? "Bullish call is fighting a higher-timeframe downtrend." : "",
    openingDanger ? "Opening print window: wait for the first 5-minute range." : "",
    preOrOffHours ? `${baseTiming.phase.label}: options entries should be staged, not fired.` : "",
  ].filter(Boolean);
  const softWarnings = [
    gate.status === "wait" ? "Trade gate is close but not fully approved." : "",
    quoteAge !== undefined && quoteAge > 15 ? `Quote is ${quoteAge}m old; refresh chain before entry.` : "",
    quoteDte !== undefined && quoteDte < settings.minDte ? `${quoteDte} DTE is below your minimum.` : "",
    catalyst && freshMinutes !== undefined && freshMinutes > 360 ? "Catalyst is stale; require renewed volume." : "",
    catalyst?.chaseRisk === "high" ? "Catalyst chase risk is high; wait for pullback/reclaim." : "",
    continuationPenalty > 0 ? `Recent continuation audit failed; setup score reduced ${continuationPenalty} points until a fresh catalyst confirms.` : "",
    learnedFalsePositivePenalty > 0 ? `Runtime false-positive penalty: -${learnedFalsePositivePenalty}.` : "",
    confidence < 68 ? "Composite confidence is below B grade." : "",
  ].filter(Boolean);
  const blocked = blockers.length > 0 || confidence < 55;
  const ready = !blocked && chainAudit.verified && timingOpen && confidence >= 78 && gate.status === "approved" && rewardRisk >= 1.45 && setupScore >= 70 && executionScore >= 70 && chainScore >= 68;
  const signal: ExactOptionsSignal["signal"] = blocked
    ? "skip"
    : direction === "up"
      ? ready ? "call_now" : "call_watch"
      : direction === "down"
        ? ready ? "put_now" : "put_watch"
        : "wait";
  const urgency: ExactOptionsSignal["urgency"] =
    ready && confidence >= 86 ? "NOW" :
    ready ? "SOON" :
    confidence >= 62 && !blocked ? "WATCH" : "WAIT";
  const confirmations = [
    `${expectedType.toUpperCase()} bias: ${direction === "up" ? "underlying must hold/reclaim" : "underlying must reject/break"}.`,
    `Live chain: debit near $${entryDebit.toFixed(2)}, spread ${quoteSpreadBps ? (quoteSpreadBps / 100).toFixed(1) + "%" : "must be checked"}.`,
    `Risk: stop at $${stopDebit.toFixed(2)}, first scale at $${partialDebit.toFixed(2)}, target $${targetDebit.toFixed(2)}.`,
    `${baseTiming.phase.label}: ${baseTiming.phase.action}.`,
  ];
  const reasons = [
    `Composite ${confidence}/100: setup ${setupScore}, execution ${executionScore}, chain ${chainScore}, timing ${timingScore}.`,
    gate.status === "approved" ? `Trade gate approved at ${gate.score}%.` : `Trade gate ${gate.status} at ${gate.score}%.`,
    hasLiveOption ? `Live ${expectedType} quote from ${liveQuote!.source}.` : "Waiting for a live option quote before exact entry.",
    contract ? `${contract.label}: ${contract.verdict.replace(/_/g, " ")} (${contract.capitalEfficiencyScore}/100 contract efficiency).` : "",
    catalyst ? `${catalystQualityLabel(catalystQuality) || "catalyst"} ${freshMinutes !== undefined ? `${freshMinutes}m old` : "freshness unknown"}.` : "",
    catalyst ? `News-source trust ${catalystTrust}/100.` : "",
    continuationPenalty > 0 ? `Weekly audit penalty: -${continuationPenalty} for failed continuation.` : "",
    ...reasoning.strengths.slice(0, 2),
  ].filter(Boolean).slice(0, 6);
  const exactTrigger = direction === "down"
    ? `Entry trigger: break/reject below $${underlyingEntry.toFixed(2)} while ${expectedType} bid holds above $${entryDebit.toFixed(2)} and spread stays tight.`
    : `Entry trigger: reclaim/hold above $${underlyingEntry.toFixed(2)} while ${expectedType} bid holds above $${entryDebit.toFixed(2)} and spread stays tight.`;
  const nextCheck =
    blockers[0] ??
    softWarnings[0] ??
    (ready ? "Human approval, broker quote, and limit order review." : "Wait for trigger, fresh quote, and volume confirmation.");
  const action = blocked
    ? `Do not trade. ${blockers[0] ?? "Signal is too weak."}`
    : ready
      ? `Prepare ${structure === "debit_spread" ? "debit spread" : "long option"} ticket; human approval required.`
      : `Watch only. ${nextCheck}`;
  const timeStop = contract && contract.dte >= 90
    ? "Time stop: exit if trigger fails for 2 sessions or premium loses momentum after the first confirmed push."
    : "Time stop: exit if no continuation within 30-60 minutes after entry or if VWAP/range acceptance fails.";
  const brokerChecks = [
    ...chainAudit.checks,
    { label: "Trade gate", passed: gate.status === "approved", detail: `${gate.status} / ${gate.score}%` },
    { label: "Entry trigger", passed: plan.retestStatus === "confirmed" && timingOpen, detail: `${plan.retestStatus} / ${baseTiming.phase.label}` },
    { label: "Risk capacity", passed: maxContracts >= 1 && rewardRisk >= 1.45, detail: `${maxContracts} contract(s) / ${rewardRisk.toFixed(2)} R:R` },
  ];
  const brokerVerified = brokerChecks.every((check) => check.passed);

  return {
    signal,
    direction,
    structure,
    confidence,
    setupScore,
    executionScore,
    chainScore,
    timingScore,
    catalystScore,
    grade,
    urgency,
    contractLabel: contract?.label ?? "No contract",
    entryDebit,
    stopDebit,
    targetDebit,
    partialDebit,
    trailingStopDebit,
    underlyingEntry,
    underlyingStop,
    underlyingTarget,
    underlyingPartial,
    maxContracts,
    maxLoss,
    rewardRisk,
    quoteSpreadPct: quoteSpreadBps === undefined ? undefined : Number((quoteSpreadBps / 100).toFixed(2)),
    liveBid: liveQuote?.bid,
    liveAsk: liveQuote?.ask,
    liveVolume: liveQuote?.volume,
    openInterest: liveQuote?.openInterest,
    expiration: liveQuote?.expiration,
    strike: liveQuote?.strike,
    contractType: liveQuote?.contractType,
    timeStop,
    readiness: blocked ? "blocked" : ready ? "ready_after_trigger" : "watch_only",
    action,
    exactTrigger,
    nextCheck,
    invalidation: `Premium stop $${stopDebit.toFixed(2)} or underlying below/above $${underlyingStop.toFixed(2)}. ${plan.invalidation}`,
    reasons,
    blockers: [...blockers, ...softWarnings].slice(0, 7),
    confirmations,
    brokerChecks,
    brokerVerified,
  };
}

function signalReadinessWeight(signal: ExactOptionsSignal) {
  if (signal.readiness === "ready_after_trigger") return 46;
  if (signal.readiness === "watch_only") return 22;
  return 0;
}

function buildSignalCommandRows({
  selected,
  movers,
  radarRows,
  dipRows,
  settings,
  rules,
  snapshot,
}: {
  selected: OpportunityPlan;
  movers: OptionMoverRow[];
  radarRows: MarketWideRadarRow[];
  dipRows: DipReboundRow[];
  settings: RiskSettings;
  rules: StrategyRuleSet;
  snapshot: LiveDataSnapshot | null;
}): SignalCommandRow[] {
  const bySymbol = new Map<string, { plan: OpportunityPlan; source: SignalCommandRow["source"]; sourceScore: number }>();
  const add = (plan: OpportunityPlan | undefined, source: SignalCommandRow["source"], sourceScore: number) => {
    if (!plan || plan.assetClass !== "option") return;
    const existing = bySymbol.get(plan.symbol);
    if (!existing || sourceScore > existing.sourceScore) {
      bySymbol.set(plan.symbol, { plan, source, sourceScore });
    }
  };

  add(selected, "selected", 18);
  movers.slice(0, 10).forEach((mover) => add(mover.plan, "mover", mover.score));
  radarRows
    .filter((row) => row.plan && row.stage !== "discovery")
    .slice(0, 8)
    .forEach((row) => add(row.plan, "event", row.score + (row.stage === "trade_candidate" ? 12 : 0)));
  dipRows.slice(0, 5).forEach((row) => add(row.plan, "dip", row.reboundScore));

  return Array.from(bySymbol.values())
    .map(({ plan, source, sourceScore }) => {
      const signal = buildExactOptionsSignal(plan, settings, rules, snapshot);
      const blockerPenalty = Math.min(22, signal.blockers.length * 4);
      const rankScore = clampScore(
        signal.confidence * 0.56 +
        signal.executionScore * 0.14 +
        signal.chainScore * 0.12 +
        signal.timingScore * 0.08 +
        signalReadinessWeight(signal) +
        Math.min(16, sourceScore * 0.12) -
        blockerPenalty
      );
      return { plan, signal, source, rankScore };
    })
    .sort((a, b) => b.rankScore - a.rankScore)
    .slice(0, 7);
}

function blockerFix(blocker: string) {
  const lower = blocker.toLowerCase();
  if (lower.includes("live option chain") || lower.includes("quote")) return "Refresh live data, then verify bid/ask in broker before considering an entry.";
  if (lower.includes("spread")) return "Wait for the spread to tighten or skip the contract; do not market order wide chains.";
  if (lower.includes("risk budget") || lower.includes("premium")) return "Use a cheaper contract, a debit spread, or reduce position size.";
  if (lower.includes("event") || lower.includes("chase")) return "Wait for pullback, halt risk to clear, and VWAP/range reclaim.";
  if (lower.includes("setup quality") || lower.includes("trade gate")) return "Require stronger setup quality, edge score, and confirmation before promoting.";
  if (lower.includes("opening") || lower.includes("pre-open") || lower.includes("off-hours")) return "Stage only until the market window confirms liquidity and direction.";
  if (lower.includes("retest") || lower.includes("trend")) return "Wait for a new base, reclaim, or higher-timeframe alignment.";
  return "Keep on watch only and require a fresh catalyst plus live-chain confirmation.";
}

function buildDefenseRows(commandRows: SignalCommandRow[]): DefenseRow[] {
  const grouped = new Map<string, DefenseRow>();
  commandRows.forEach((row) => {
    row.signal.blockers.slice(0, 2).forEach((blocker) => {
      const key = blocker
        .replace(/\$[0-9.]+/g, "$")
        .replace(/\d+(\.\d+)?/g, "#")
        .slice(0, 120);
      const existing = grouped.get(key) ?? {
        blocker,
        count: 0,
        symbols: [],
        fix: blockerFix(blocker),
      };
      existing.count += 1;
      existing.symbols = pushUnique(existing.symbols, row.plan.symbol, 5);
      grouped.set(key, existing);
    });
  });

  return Array.from(grouped.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
}

function buildAutomationQueue({
  commandRows,
  preBoomAlerts,
  radarRows,
  snapshot,
}: {
  commandRows: SignalCommandRow[];
  preBoomAlerts: ReturnType<typeof usePreBoomScanner>["alerts"];
  radarRows: MarketWideRadarRow[];
  snapshot: LiveDataSnapshot | null;
}): AutomationQueueRow[] {
  const liveReady = snapshot?.state === "live" || snapshot?.state === "degraded";
  const rows: AutomationQueueRow[] = [];

  commandRows.slice(0, 5).forEach((row) => {
    const mode: AutomationQueueRow["mode"] =
      row.signal.readiness === "ready_after_trigger"
        ? "stage_ticket"
        : row.signal.readiness === "watch_only"
          ? "auto_monitor"
          : "blocked";
    rows.push({
      label: exactSignalLabel(row.signal.signal),
      symbol: row.plan.symbol,
      priority: row.rankScore,
      mode,
      reason: row.signal.nextCheck,
      nextAction: mode === "stage_ticket"
        ? "Prepare ticket, refresh broker quote, then require human approval."
        : mode === "auto_monitor"
          ? "Keep monitoring trigger, chain quality, and catalyst freshness."
          : "Do not promote until blocker clears.",
    });
  });

  preBoomAlerts.slice(0, 4).forEach((alert) => {
    rows.push({
      label: "Preboom monitor",
      symbol: alert.symbol,
      priority: alert.score,
      mode: liveReady ? "auto_monitor" : "human_review",
      reason: alert.reasons[0] ?? "Preboom alert fired.",
      nextAction: liveReady
        ? "Watch acceleration, range reclaim, and option budget fit."
        : "Refresh live data before trusting this alert.",
    });
  });

  radarRows
    .filter((row) => row.stage === "trade_candidate" || row.score >= 70)
    .slice(0, 4)
    .forEach((row) => {
      rows.push({
        label: row.stage.replace("_", " "),
        symbol: row.symbol,
        priority: row.score,
        mode: row.stage === "trade_candidate" ? "human_review" : "auto_monitor",
        reason: row.blocker,
        nextAction: row.action,
      });
    });

  return rows
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 8);
}

function buildOptionMoverRows(plans: OpportunityPlan[], snapshot: LiveDataSnapshot | null, settings: RiskSettings, events: CatalystEvent[] = []): OptionMoverRow[] {
  const urgentSymbols = new Set(
    events
      .filter((event) => event.urgencyScore >= 75 || Math.abs(event.movePct) >= 20)
      .map((event) => event.symbol)
  );

  return plans
    .filter((plan) => plan.assetClass === "option")
    .filter((plan) => {
      const root = planRoot(plan.symbol);
      const inPriceRange = plan.price >= settings.minUnderlyingPrice && plan.price <= settings.maxUnderlyingPrice;
      const promoted = urgentSymbols.has(root) || plan.name.includes("catalyst discovery") || plan.name.includes("extreme mover");
      return inPriceRange || promoted;
    })
    .map((plan) => {
      const quote = findBestOptionQuote(snapshot, plan);
      const liveContractQuote = quote && quote.source !== "fallback" ? quote : undefined;
      const candidates = buildOptionContractCandidates(plan, settings);
      const bestCandidate =
        candidates.find((candidate) => candidate.verdict === "long_call_ok") ??
        candidates.find((candidate) => candidate.verdict === "spread_only") ??
        candidates[0];
      const optionQuote = liveContractQuote?.price && liveContractQuote.price > 0 ? liveContractQuote.price : bestCandidate?.estimatedSpreadDebit ?? bestCandidate?.estimatedPremium ?? 0;
      const movePct = quote?.changePct || plan.changePct;
      const affordabilityBoost = optionQuote >= settings.minOptionPremium && optionQuote <= settings.maxOptionPremium ? 18 : -20;
      const source: OptionMoverRow["source"] = liveContractQuote?.source ?? "modeled";
      const score = clampScore(
        Math.abs(movePct) * 8 +
        plan.atrPct * 7 +
        plan.flowScore * 0.22 +
        plan.catalystScore * 0.2 +
        plan.volumeScore * 0.14 +
        (plan.ivRank ?? 45) * 0.12 -
        plan.spreadBps * 0.8 +
        affordabilityBoost
      );

      return {
        plan,
        quote: liveContractQuote,
        movePct,
        score,
        optionQuote,
        contractCost: Math.round(optionQuote * 100),
        source,
      };
    })
    .filter((row) => row.source !== "modeled")
    .sort((a, b) => b.score - a.score);
}

function buildDipReboundRows(movers: OptionMoverRow[], settings: RiskSettings): DipReboundRow[] {
  return movers
    .filter((mover) => mover.movePct < 0)
    .map((mover) => {
      const plan = mover.plan;
      const pullbackPct = Math.abs(mover.movePct);
      const supportGapPct = plan.price > 0 ? ((plan.price - plan.support) / plan.price) * 100 : 99;
      const trendUp = plan.higherTimeframeTrend === "uptrend" ? 16 : plan.higherTimeframeTrend === "range" ? 5 : -18;
      const retestFit = plan.retestStatus === "confirmed" ? 14 : plan.retestStatus === "retesting" ? 10 : plan.retestStatus === "waiting" ? 2 : -20;
      const pullbackFit = pullbackPct >= 2 && pullbackPct <= 18 ? 18 : pullbackPct > 18 && pullbackPct <= 35 ? 6 : -8;
      const supportFit = supportGapPct >= -1 && supportGapPct <= 8 ? 14 : supportGapPct > 8 && supportGapPct <= 15 ? 4 : -10;
      const contractFit = mover.optionQuote >= settings.minOptionPremium && mover.optionQuote <= settings.maxOptionPremium ? 14 : -14;
      const reboundScore = clampScore(
        plan.trendScore * 0.2 +
        plan.flowScore * 0.18 +
        plan.volumeScore * 0.13 +
        plan.catalystScore * 0.12 +
        trendUp +
        retestFit +
        pullbackFit +
        supportFit +
        contractFit -
        plan.spreadBps * 0.7 -
        (plan.thetaDrag ?? 40) * 0.08
      );
      return {
        ...mover,
        reboundScore,
        supportGapPct,
        reclaimTrigger: `Wait for VWAP/opening-range reclaim or hold above $${plan.support.toFixed(2)} support.`,
        riskNote: pullbackPct > 18 ? "Deep discount: require reversal candle and volume first." : "Discount is tradable only if price stops making lower lows.",
      };
    })
    .filter((row) => row.reboundScore >= 48 && row.plan.higherTimeframeTrend !== "downtrend" && row.plan.retestStatus !== "failed")
    .sort((a, b) => b.reboundScore - a.reboundScore)
    .slice(0, 6);
}

function formatPreBoomVolume(plan: OpportunityPlan) {
  if (plan.volumeScore >= 92) return "120M";
  if (plan.volumeScore >= 82) return "45M";
  if (plan.volumeScore >= 70) return "12M";
  return "3M";
}

function planToPreBoomTicker(plan: OpportunityPlan): PreBoomTickerData {
  const high = Math.max(plan.resistance, plan.price * (1 + Math.max(0.01, plan.atrPct / 100)));
  const low = Math.min(plan.support, plan.price * (1 - Math.max(0.01, plan.atrPct / 120)));
  const volume = formatPreBoomVolume(plan);

  return {
    symbol: plan.symbol,
    name: plan.name,
    price: plan.price.toFixed(2),
    priceChangePercent: plan.changePct.toFixed(2),
    high: high.toFixed(2),
    low: low.toFixed(2),
    volume,
  };
}

function buildPreBoomTickers(movers: OptionMoverRow[]) {
  return Object.fromEntries(movers.map((mover) => [mover.plan.symbol, planToPreBoomTicker(mover.plan)]));
}

function buildPreBoomContext(
  movers: OptionMoverRow[],
  radarEvents: CatalystEvent[],
  settings: RiskSettings,
  rules: StrategyRuleSet,
): Record<string, PreBoomSymbolContext> {
  return Object.fromEntries(
    movers.map((mover) => {
      const catalyst = radarEvents.find((event) => event.symbol === mover.plan.symbol || event.symbol === planRoot(mover.plan.symbol));
      const learnedPattern = learnedWinnerPatterns.find((pattern) => pattern.symbol === mover.plan.symbol || pattern.symbol === planRoot(mover.plan.symbol));
      const gate = evaluateTradeGate(mover.plan, runModeledBacktest(mover.plan, 80), settings, rules);
      return [
        mover.plan.symbol,
        {
          optionBudgetFit: mover.optionQuote >= settings.minOptionPremium && mover.optionQuote <= settings.maxOptionPremium,
          optionQuote: mover.optionQuote,
          contractCost: mover.contractCost,
          catalystUrgency: catalyst?.urgencyScore,
          sourceCount: catalyst?.corroborationScore ?? catalyst?.sources?.length ?? 1,
          gateStatus: gate.status,
          learnedPatternScore: learnedPattern?.patternScore,
          learnedPattern: learnedPattern?.theme.replace(/_/g, " "),
        },
      ];
    })
  );
}

function inferMarketTheme(symbol: string, text: string) {
  const lower = `${symbol} ${text}`.toLowerCase();
  if (/(data center|ai|power hub|energy storage|grid|battery|charging|ev)/.test(lower)) return "AI power / energy";
  if (/(fda|phase|trial|drug|therapy|regulatory|approval|psychedelic|biotech)/.test(lower)) return "biotech catalyst";
  if (/(quantum|qubit|ionq|qbts|rgti)/.test(lower)) return "quantum";
  if (/(space|launch|satellite|nasa|defense|contract)/.test(lower)) return "space / defense";
  if (/(bitcoin|crypto|miner|hash|hpc|compute)/.test(lower)) return "crypto / HPC";
  if (/(earnings|guidance|revenue|eps|outlook)/.test(lower)) return "earnings repricing";
  if (/(merger|acquisition|takeover|buyout|strategic alternative)/.test(lower)) return "deal watch";
  if (/(halt|resum|reverse split|low-float|low float|micro-cap|microcap|nasdaq compliance|tender offer|dilutive|convertible|offering)/.test(lower)) return "microcap volatility";
  return "momentum catalyst";
}

function catalystQualityScore(event?: CatalystEvent, text = "") {
  if (!event) return 0;
  const lower = `${event.headline} ${text}`.toLowerCase();
  let score = 36;
  if (event.type === "takeover") score += 30;
  if (event.type === "regulatory") score += 24;
  if (event.type === "earnings" || event.type === "guidance") score += 18;
  if (event.type === "product") score += 14;
  if (event.type === "unusual_options") score += 10;
  if (/(launch|contract|award|partnership|customer|order|approval|fda|merger|acquisition|buyout|strategic alternative|guidance|raises|beats|data center|ai|energy storage|power hub)/.test(lower)) score += 18;
  if (/(rumor|speculation|mentioned|watch|recap|reminder|opinion)/.test(lower)) score -= 14;
  if (/(reverse split|low-float|low float|micro-cap|microcap|dilutive|convertible|offering|no specific news|limited specific news)/.test(lower)) score -= 18;
  if (/(halt|resum|trading resume|additional information requested)/.test(lower)) score -= 10;
  if ((event.sources?.length ?? event.corroborationScore ?? 0) >= 2) score += 8;
  if (Math.abs(event.movePct) >= 20) score += 8;
  return clampScore(score);
}

function catalystQualityLabel(score: number) {
  if (score >= 82) return "major catalyst";
  if (score >= 68) return "strong catalyst";
  if (score >= 52) return "tradable news";
  if (score > 0) return "weak headline";
  return "";
}

function catalystAgeMinutes(event?: CatalystEvent) {
  if (!event?.detectedAt) return undefined;
  const parsed = Date.parse(event.detectedAt);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.max(0, Math.round((Date.now() - parsed) / 60000));
}

function freshnessBoostFor(minutes?: number) {
  if (minutes === undefined) return 0;
  if (minutes <= 15) return 12;
  if (minutes <= 60) return 8;
  if (minutes <= 180) return 3;
  if (minutes <= 360) return -4;
  return -10;
}

function peerSymbolsForTheme(theme: string, symbol: string, plans: OpportunityPlan[]) {
  const available = new Set(plans.map((plan) => planRoot(plan.symbol)));
  return (themePeerMap[theme] ?? [])
    .filter((peer) => peer !== symbol && (available.has(peer) || peer.length <= 5))
    .slice(0, 5);
}

function buildMarketWideRadarRows(
  plans: OpportunityPlan[],
  events: CatalystEvent[],
  movers: OptionMoverRow[],
  settings: RiskSettings,
): MarketWideRadarRow[] {
  const observedRecords = accuracyRecords();
  const planByRoot = new Map(plans.map((plan) => [planRoot(plan.symbol), plan]));
  const moverByRoot = new Map(movers.map((mover) => [planRoot(mover.plan.symbol), mover]));
  const themeBreadth = new Map<string, number>();
  events
    .filter((event) => event.urgencyScore >= 45 || Math.abs(event.movePct) >= 5)
    .forEach((event) => {
      const theme = inferMarketTheme(event.symbol, event.headline);
      themeBreadth.set(theme, (themeBreadth.get(theme) ?? 0) + 1);
    });
  const symbols = new Set<string>([
    ...events.map((event) => event.symbol),
    ...plans
      .filter((plan) => plan.name.includes("catalyst discovery") || plan.name.includes("extreme mover") || Math.abs(plan.changePct) >= 12)
      .map((plan) => planRoot(plan.symbol)),
  ]);

  return Array.from(symbols)
    .map((symbol): MarketWideRadarRow | null => {
      const event = events.find((candidate) => candidate.symbol === symbol);
      const plan = planByRoot.get(symbol);
      const mover = moverByRoot.get(symbol);
      const movePct = event?.movePct || mover?.movePct || plan?.changePct || 0;
      const sources = event?.corroborationScore ?? event?.sources?.length ?? 0;
      const sourceTrust = sourceTrustScore(event, observedRecords);
      const symbolPenalty = falsePositivePenalty(symbol, observedRecords);
      const optionQuote = mover?.optionQuote;
      const contractCost = mover?.contractCost;
      const hasLiveOptionCandidate = Boolean(plan && mover && optionQuote && optionQuote > 0);
      const budgetFit = hasLiveOptionCandidate && optionQuote! >= settings.minOptionPremium && optionQuote! <= settings.maxOptionPremium;
      const spreadOk = Boolean(plan && plan.spreadBps <= settings.maxOptionsSpreadBps);
      const extremeMove = Math.abs(movePct) >= 50;
      const highRisk = (plan?.eventRisk ?? 0) >= settings.blockEventRiskAbove || event?.chaseRisk === "high";
      const theme = inferMarketTheme(symbol, `${event?.headline ?? ""} ${plan?.name ?? ""}`);
      const catalystQuality = catalystQualityScore(event, plan?.name ?? "");
      const catalystCredibility = event?.credibilityScore ?? catalystQuality;
      const catalystQualityBoost = catalystQuality >= 82 ? 14 : catalystQuality >= 68 ? 9 : catalystQuality >= 52 ? 4 : catalystQuality > 0 ? -4 : 0;
      const breadth = themeBreadth.get(theme) ?? 0;
      const freshMinutes = catalystAgeMinutes(event);
      const freshnessBoost = freshnessBoostFor(freshMinutes);
      const breadthBoost = Math.min(14, Math.max(0, breadth - 1) * 5);
      const memoryBoost = memoryScoreForTheme(theme);
      const sympathyPeers = peerSymbolsForTheme(theme, symbol, plans);
      const score = clampScore(
        (event?.urgencyScore ?? 0) * 0.38 +
        Math.min(38, Math.abs(movePct) * 1.4) +
        (plan?.catalystScore ?? 0) * 0.18 +
        (plan?.volumeScore ?? 45) * 0.12 +
        sources * 7 +
        sourceTrust * 0.12 +
        catalystCredibility * 0.12 +
        catalystQualityBoost +
        freshnessBoost +
        breadthBoost +
        memoryBoost +
        (budgetFit ? 8 : -14) +
        (spreadOk ? 6 : -12) -
        (extremeMove ? 6 : 0) -
        (highRisk ? 8 : 0) -
        symbolPenalty
      );
      const stage: MarketWideRadarRow["stage"] =
        hasLiveOptionCandidate && catalystCredibility >= 55 && score >= 72 && budgetFit && spreadOk && !highRisk
          ? "trade_candidate"
          : score >= 52 || Math.abs(movePct) >= 12
            ? "confirmation"
            : "discovery";
      const reasons = [
        event ? `Catalyst ${event.urgencyScore}/100` : "",
        catalystQualityLabel(catalystQuality),
        event ? `credibility ${catalystCredibility}` : "",
        freshMinutes !== undefined && freshMinutes <= 360 ? `${freshMinutes}m fresh` : "",
        Math.abs(movePct) >= 8 ? `Move ${movePct >= 0 ? "+" : ""}${movePct.toFixed(1)}%` : "",
        extremeMove ? "halt/chase risk" : "",
        breadth >= 2 ? `${breadth} theme hits` : "",
        memoryBoost >= 6 ? "learned theme" : memoryBoost <= -6 ? "weak memory" : "",
        sources >= 2 ? `${sources} sources` : sources === 1 ? "1 source" : "",
        event ? `source trust ${sourceTrust}` : "",
        symbolPenalty ? `false-positive penalty -${symbolPenalty}` : "",
        budgetFit && contractCost ? `$${contractCost} contract fit` : "",
        theme,
      ].filter(Boolean).slice(0, 4);
      const blocker =
        !plan ? "No options plan yet. Keep in discovery until a chain can be checked." :
        catalystCredibility < 45 ? `Catalyst credibility is only ${catalystCredibility}/100. Require stronger confirmation.` :
        catalystQuality > 0 && catalystQuality < 52 ? "Headline quality is weak. Require stronger source confirmation before trade planning." :
        freshMinutes !== undefined && freshMinutes > 360 ? "Catalyst may be stale. Require a new headline or renewed volume." :
        extremeMove ? "Extreme move. Do not chase; wait for halt risk, pullback, and VWAP reclaim." :
        !budgetFit && optionQuote !== undefined ? "Contract is outside your premium range." :
        !spreadOk ? "Option spread is too wide for a clean fill." :
        highRisk ? "Event/chase risk is high. Wait for pullback and reclaim." :
        sources < 2 && Math.abs(movePct) < 20 ? "Needs stronger source or price confirmation." :
        "No major blocker, but still requires live bid/ask confirmation.";
      const action =
        stage === "trade_candidate"
          ? "Build a human-approved ticket only after VWAP/reclaim confirms."
          : stage === "confirmation"
            ? sympathyPeers.length
              ? `Watch first pullback, then scan sympathy peers: ${sympathyPeers.slice(0, 3).join(", ")}.`
              : "Watch first pullback. Promote only if volume holds and options stay liquid."
            : "Track headline, theme, and first price reaction before touching contracts.";

      return { symbol, plan, event, stage, theme, score, movePct, contractCost, optionQuote, sources, sourceTrust, themeBreadth: breadth, freshMinutes, sympathyPeers, reasons, blocker, action };
    })
    .filter(Boolean)
    .sort((a, b) => b!.score - a!.score) as MarketWideRadarRow[];
}

function buildMissedRunnerRows(
  events: CatalystEvent[],
  plans: OpportunityPlan[],
  movers: OptionMoverRow[],
  preBoomSymbols: Set<string>,
  settings: RiskSettings,
): MissedRunnerRow[] {
  const planByRoot = new Map(plans.map((plan) => [planRoot(plan.symbol), plan]));
  const moverByRoot = new Map(movers.map((mover) => [planRoot(mover.plan.symbol), mover]));
  const candidateEvents = events
    .filter((event) => Math.abs(event.movePct) >= 18 || event.urgencyScore >= 78)
    .slice(0, 12);

  return candidateEvents.map((event) => {
    const plan = planByRoot.get(event.symbol);
    const mover = moverByRoot.get(event.symbol);
    const contractCost = mover?.contractCost;
    const theme = inferMarketTheme(event.symbol, `${event.headline} ${plan?.name ?? ""}`);
    const inPriceRange = plan ? plan.price >= settings.minUnderlyingPrice && plan.price <= settings.maxUnderlyingPrice : false;
    const budgetFit = mover?.optionQuote === undefined || (mover.optionQuote >= settings.minOptionPremium && mover.optionQuote <= settings.maxOptionPremium);
    const caught = Boolean(mover || preBoomSymbols.has(event.symbol));
    const missRisk = clampScore(
      Math.abs(event.movePct) * 1.1 +
      event.urgencyScore * 0.35 +
      (!plan ? 24 : 0) +
      (plan && !inPriceRange ? 18 : 0) +
      (!mover ? 16 : 0) +
      (!budgetFit ? 12 : 0)
    );
    const cause =
      !plan ? "No generated options plan" :
      !inPriceRange ? "Outside the normal underlying range" :
      !mover ? "Not promoted into active scanner" :
      contractCost && !budgetFit ? "Contract cost outside budget" :
      (plan.spreadBps > settings.maxOptionsSpreadBps) ? "Spread/liquidity gate" :
      "Caught, but requires better timing discipline";
    const fix =
      !plan ? "Promote high-urgency news into a dynamic plan immediately." :
      !inPriceRange ? "Let extreme catalysts override the price filter, then mark chase risk." :
      !mover ? "Feed the symbol into pre-boom and event radar even before it clears account fit." :
      contractCost && !budgetFit ? "Search cheaper strikes/spreads; avoid dead illiquid contracts." :
      "Use VWAP reclaim, halt awareness, and partial-profit rules.";
    const status: MissedRunnerRow["status"] = caught ? "caught" : missRisk >= 70 ? "missed" : "at_risk";

    return { symbol: event.symbol, movePct: event.movePct, theme, missRisk, cause, fix, status };
  }).sort((a, b) => b.missRisk - a.missRisk);
}

function ScoreBar({ value, tone = "gain" }: { value: number; tone?: "gain" | "warning" | "loss" | "accent" }) {
  const color = tone === "gain" ? "bg-gain" : tone === "loss" ? "bg-loss" : tone === "warning" ? "bg-warning" : "bg-accent";
  return (
    <div className="h-1.5 w-full rounded-full bg-secondary">
      <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${value}%` }} />
    </div>
  );
}

function QualityBadge({ quality }: { quality: OpportunityPlan["quality"] }) {
  const cls = quality === "A"
    ? "bg-gain/15 text-gain border-gain/30"
    : quality === "B"
      ? "bg-accent/15 text-accent border-accent/30"
      : quality === "C"
        ? "bg-warning/15 text-warning border-warning/30"
        : "bg-loss/15 text-loss border-loss/30";
  return <span className={`rounded border px-2 py-0.5 text-[11px] font-bold ${cls}`}>{quality}</span>;
}

function Week52Distance({ plan, compact = false }: { plan: OpportunityPlan; compact?: boolean }) {
  const distancePct = plan.week52High > 0 ? Math.max(0, ((plan.week52High - plan.price) / plan.week52High) * 100) : 0;
  const progressPct = plan.week52High > 0 ? Math.min(100, (plan.price / plan.week52High) * 100) : 0;
  const tone = distancePct <= 2 ? "bg-gain" : distancePct <= 7 ? "bg-warning" : "bg-accent";

  return (
    <div className={compact ? "mt-2" : "rounded-md border border-border bg-secondary p-3"}>
      <div className="mb-1 flex items-center justify-between gap-2 text-[11px]">
        <span className="uppercase text-muted-foreground">52W high gap</span>
        <span className="font-mono text-foreground">{distancePct.toFixed(1)}% away</span>
      </div>
      <div className="h-1.5 rounded-full bg-background">
        <div className={`h-1.5 rounded-full ${tone}`} style={{ width: `${progressPct}%` }} />
      </div>
      {!compact && (
        <div className="mt-2 flex justify-between text-[11px] text-muted-foreground">
          <span className="font-mono">${plan.price.toLocaleString()}</span>
          <span className="font-mono">52W ${plan.week52High.toLocaleString()}</span>
        </div>
      )}
    </div>
  );
}

function TechnicalFramework({ plan }: { plan: OpportunityPlan }) {
  const distanceToResistance = plan.resistance > 0 ? ((plan.resistance - plan.price) / plan.price) * 100 : 0;
  const distanceToSupport = plan.price > 0 ? ((plan.price - plan.support) / plan.price) * 100 : 0;
  const trendTone = plan.higherTimeframeTrend === "uptrend" ? "text-gain" : plan.higherTimeframeTrend === "downtrend" ? "text-loss" : "text-warning";
  const retestTone = plan.retestStatus === "confirmed" ? "text-gain" : plan.retestStatus === "retesting" ? "text-warning" : plan.retestStatus === "failed" ? "text-loss" : "text-muted-foreground";

  return (
    <div className="mt-3 rounded-md border border-border bg-secondary p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="text-sm font-semibold">Support / Resistance Framework</div>
        <span className={`rounded bg-card px-2 py-0.5 text-[10px] uppercase ${trendTone}`}>{plan.higherTimeframeTrend}</span>
      </div>
      <div className="grid gap-2 text-xs sm:grid-cols-4">
        <div className="rounded bg-card p-2">
          <div className="text-muted-foreground">Support floor</div>
          <div className="font-mono text-foreground">${plan.support.toFixed(2)}</div>
          <div className="text-[10px] text-muted-foreground">{distanceToSupport.toFixed(1)}% below</div>
        </div>
        <div className="rounded bg-card p-2">
          <div className="text-muted-foreground">Resistance ceiling</div>
          <div className="font-mono text-foreground">${plan.resistance.toFixed(2)}</div>
          <div className="text-[10px] text-muted-foreground">{distanceToResistance.toFixed(1)}% above</div>
        </div>
        <div className="rounded bg-card p-2">
          <div className="text-muted-foreground">Retest status</div>
          <div className={`font-mono capitalize ${retestTone}`}>{plan.retestStatus}</div>
          <div className="text-[10px] text-muted-foreground">wait for confirmation</div>
        </div>
        <div className="rounded bg-card p-2">
          <div className="text-muted-foreground">Quality score</div>
          <div className="font-mono text-foreground">{plan.qualityCompanyScore}/100</div>
          <div className="text-[10px] text-muted-foreground">LEAPS filter</div>
        </div>
      </div>
    </div>
  );
}

function AffordabilityBadge({ plan }: { plan: OpportunityPlan }) {
  const inRange = plan.assetClass === "option" && plan.price >= 10 && plan.price <= 100;
  const tooCheap = plan.assetClass === "option" && plan.price < 10;
  const text = inRange ? "$10-$100 focus" : tooCheap ? "cheap but higher risk" : "use spreads for cost";
  const cls = inRange
    ? "border-gain/30 bg-gain/10 text-gain"
    : tooCheap
      ? "border-warning/30 bg-warning/10 text-warning"
      : "border-accent/30 bg-accent/10 text-accent";

  return (
    <span className={`rounded border px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      {text}
    </span>
  );
}

function OptionsPlaybookCard({ plan }: { plan: OpportunityPlan }) {
  const distancePct = plan.week52High > 0 ? ((plan.week52High - plan.price) / plan.week52High) * 100 : 0;
  const leapCandidate = plan.assetClass !== "future" && plan.qualityCompanyScore >= 85 && distancePct >= 5 && distancePct <= 25 && plan.higherTimeframeTrend !== "downtrend";
  const breakoutCandidate = plan.retestStatus === "confirmed" && plan.price >= plan.resistance * 0.995;
  const label = leapCandidate ? "6M Call Pullback" : breakoutCandidate ? "Breakout Retest" : "Wait For Setup";
  const tone = leapCandidate || breakoutCandidate ? "border-gain/30 bg-gain/10 text-gain" : "border-warning/30 bg-warning/10 text-warning";

  return (
    <div className={`rounded-lg border p-4 ${tone}`}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase opacity-80">Options playbook</div>
          <div className="text-lg font-bold">{label}</div>
        </div>
        <div className="font-mono text-sm">{distancePct.toFixed(1)}% off high</div>
      </div>
      <p className="text-xs opacity-90">
        {leapCandidate
          ? "Candidate for longer-dated calls: quality name, meaningful pullback, and structure has not broken."
          : breakoutCandidate
            ? "Candidate for breakout/retest entry: wait for acceptance above resistance, then define premium risk."
            : "No rush. Wait for support hold, resistance reclaim, or a cleaner pullback zone before considering calls."}
      </p>
    </div>
  );
}

function ContractVerdictBadge({ verdict }: { verdict: OptionContractCandidate["verdict"] }) {
  const config = {
    long_call_ok: "border-gain/30 bg-gain/10 text-gain",
    spread_only: "border-accent/30 bg-accent/10 text-accent",
    too_expensive: "border-warning/30 bg-warning/10 text-warning",
    skip: "border-loss/30 bg-loss/10 text-loss",
  }[verdict];
  const label = {
    long_call_ok: "Long call OK",
    spread_only: "Spread only",
    too_expensive: "Too expensive",
    skip: "Skip",
  }[verdict];

  return <span className={`rounded border px-2 py-0.5 text-[10px] font-bold uppercase ${config}`}>{label}</span>;
}

function VerificationBadge({ verification }: { verification: PassHitVerification }) {
  const cls = verification.readiness === "trade_ready"
    ? "border-gain/30 bg-gain/10 text-gain"
    : verification.readiness === "wait_for_open"
      ? "border-warning/30 bg-warning/10 text-warning"
      : "border-loss/30 bg-loss/10 text-loss";
  const label = verification.readiness === "trade_ready" ? "Ready after open" : verification.readiness === "wait_for_open" ? "Watch only" : "Do not trade";

  return <span className={`rounded border px-2 py-0.5 text-[10px] font-bold uppercase ${cls}`}>{label}</span>;
}

function ReasoningVerdictBadge({ verdict }: { verdict: OptionReasoningReport["verdict"] }) {
  const cls = verdict === "trade_candidate"
    ? "border-gain/30 bg-gain/10 text-gain"
    : verdict === "watch_only"
      ? "border-warning/30 bg-warning/10 text-warning"
      : "border-loss/30 bg-loss/10 text-loss";
  const label = verdict === "trade_candidate" ? "Trade candidate" : verdict === "watch_only" ? "Watch only" : "Skip";

  return <span className={`rounded border px-2 py-0.5 text-[10px] font-bold uppercase ${cls}`}>{label}</span>;
}

function OptionReasoningPanel({
  plan,
  settings,
  rules,
}: {
  plan: OpportunityPlan;
  settings: RiskSettings;
  rules: StrategyRuleSet;
}) {
  const report = useMemo(() => buildOptionReasoningReport(plan, settings, rules), [plan, settings, rules]);
  const scoreTone = report.verdict === "trade_candidate" ? "text-gain" : report.verdict === "watch_only" ? "text-warning" : "text-loss";
  const confidenceTone = report.confidence === "high" ? "text-gain" : report.confidence === "medium" ? "text-warning" : "text-loss";

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="h-4 w-4 text-primary" />
            Option Reasoning Engine
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Scores the stock, catalyst, contract, learned pattern, and risk gate before a trade is considered.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ReasoningVerdictBadge verdict={report.verdict} />
          <div className="rounded border border-border bg-secondary px-3 py-2 text-right">
            <div className="text-[10px] uppercase text-muted-foreground">Reason score</div>
            <div className={`font-mono text-xl font-bold ${scoreTone}`}>{report.score}/100</div>
          </div>
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="space-y-3">
          <div className="rounded-md border border-border bg-secondary p-3">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-[11px] uppercase text-muted-foreground">Bot read</span>
              <span className={`font-mono text-[11px] uppercase ${confidenceTone}`}>{report.confidence} confidence</span>
            </div>
            <div className="text-sm font-medium text-foreground">{report.summary}</div>
            <div className="mt-2 rounded border border-border bg-card p-2 text-xs text-muted-foreground">
              {report.nextAction}
            </div>
          </div>

          {report.bestContract && (
            <div className="rounded-md border border-border bg-secondary p-3">
              <div className="mb-2 flex items-start justify-between gap-2">
                <div>
                  <div className="text-[11px] uppercase text-muted-foreground">Best contract logic</div>
                  <div className="font-mono text-sm font-bold">{report.bestContract.label}</div>
                </div>
                <ContractVerdictBadge verdict={report.bestContract.verdict} />
              </div>
              <div className="grid grid-cols-3 gap-2 text-[11px]">
                <div className="rounded bg-card p-2">
                  <span className="block text-muted-foreground">Quote</span>
                  <span className="font-mono">${report.bestContract.estimatedPremium.toFixed(2)}</span>
                </div>
                <div className="rounded bg-card p-2">
                  <span className="block text-muted-foreground">Delta</span>
                  <span className="font-mono">{report.bestContract.delta.toFixed(2)}</span>
                </div>
                <div className="rounded bg-card p-2">
                  <span className="block text-muted-foreground">DTE</span>
                  <span className="font-mono">{report.bestContract.dte}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-5">
            {report.scores.map((item) => (
              <div key={item.label} className="rounded-md border border-border bg-secondary p-2">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-[10px] uppercase text-muted-foreground">{item.label}</span>
                  <span className="font-mono text-xs font-bold text-foreground">{item.score}</span>
                </div>
                <ScoreBar value={item.score} tone={item.score >= 70 ? "gain" : item.score >= 50 ? "warning" : "loss"} />
                <div className="mt-1 min-h-8 text-[10px] text-muted-foreground">{item.detail}</div>
              </div>
            ))}
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-md border border-gain/20 bg-gain/10 p-3">
              <div className="mb-2 text-[11px] uppercase text-gain">Why it can work</div>
              <div className="space-y-2">
                {(report.strengths.length ? report.strengths : ["No strong edge confirmed yet."]).map((reason) => (
                  <div key={reason} className="flex items-start gap-2 text-xs text-foreground">
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gain" />
                    <span>{reason}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-md border border-loss/20 bg-loss/10 p-3">
              <div className="mb-2 text-[11px] uppercase text-loss">Why it can fail</div>
              <div className="space-y-2">
                {(report.risks.length ? report.risks : ["No major blocker, but live broker chain confirmation is still required."]).map((reason) => (
                  <div key={reason} className="flex items-start gap-2 text-xs text-foreground">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-loss" />
                    <span>{reason}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function HumanApprovedTicketPanel({
  plan,
  settings,
  rules,
  liveState,
}: {
  plan: OpportunityPlan;
  settings: RiskSettings;
  rules: StrategyRuleSet;
  liveState?: LiveDataSnapshot["state"];
}) {
  const report = useMemo(() => buildOptionReasoningReport(plan, settings, rules), [plan, settings, rules]);
  const [confirmed, setConfirmed] = useState({
    liveChain: false,
    trigger: false,
    risk: false,
  });
  const [approvedAt, setApprovedAt] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  const contract = report.bestContract;
  const isLongCall = contract?.verdict === "long_call_ok";
  const riskQuote = contract
    ? isLongCall
      ? contract.estimatedPremium
      : contract.estimatedSpreadDebit ?? contract.estimatedPremium
    : 0;
  const riskCost = contract
    ? isLongCall
      ? contract.maxLoss
      : contract.spreadMaxLoss ?? contract.maxLoss
    : 0;
  const allowedRisk = Math.round(settings.accountSize * (Math.min(settings.maxTradeRiskPct, settings.maxPremiumRiskPct) / 100));
  const maxQty = riskCost > 0 ? Math.max(0, Math.floor(allowedRisk / riskCost)) : 0;
  const suggestedQty = Math.min(1, maxQty);
  const limitDebit = riskQuote > 0 ? Number(Math.min(riskQuote * 1.03, settings.maxOptionPremium).toFixed(2)) : 0;
  const stopDebit = riskQuote > 0 ? Number((riskQuote * (1 - (contract?.stopLossPct ?? 30) / 100)).toFixed(2)) : 0;
  const targetDebit = riskQuote > 0 ? Number((riskQuote * (1 + (contract?.profitTargetPct ?? 35) / 100)).toFixed(2)) : 0;
  const canApprove =
    report.verdict !== "skip" &&
    contract !== undefined &&
    contract.verdict !== "skip" &&
    contract.verdict !== "too_expensive" &&
    maxQty >= 1 &&
    confirmed.liveChain &&
    confirmed.trigger &&
    confirmed.risk;
  const liveWarn = liveState !== "live" && liveState !== "degraded";

  useEffect(() => {
    setConfirmed({ liveChain: false, trigger: false, risk: false });
    setApprovedAt(null);
    setCopyState("idle");
  }, [
    plan.symbol,
    settings.accountSize,
    settings.maxTradeRiskPct,
    settings.maxPremiumRiskPct,
    settings.maxOptionPremium,
    report.verdict,
    report.score,
    contract?.label,
    contract?.verdict,
  ]);
  const ticketText = [
    `MARKET MUSE MANUAL TICKET`,
    `Symbol: ${plan.symbol}`,
    `Bias: ${plan.bias.toUpperCase()}`,
    `Structure: ${contract?.verdict === "spread_only" ? "CALL DEBIT SPREAD" : "LONG CALL"}`,
    `Contract model: ${contract?.label ?? "No contract"}`,
    `Qty: ${suggestedQty}`,
    `Limit debit: $${limitDebit.toFixed(2)}`,
    `Stop debit: $${stopDebit.toFixed(2)}`,
    `Target debit: $${targetDebit.toFixed(2)}`,
    `Max risk: $${Math.round(riskCost * suggestedQty)}`,
    `Trigger: ${plan.trigger}`,
    `Invalidation: ${plan.invalidation}`,
    `Bot verdict: ${report.verdict} / ${report.score}/100`,
  ].join("\n");

  const copyTicket = async () => {
    try {
      await navigator.clipboard.writeText(ticketText);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <ListChecks className="h-4 w-4 text-primary" />
            Human-Approved Trade Ticket
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Generates a manual broker ticket. Approval only means you reviewed it; this app does not place the order.
          </p>
        </div>
        <span className={`rounded border px-2 py-1 font-mono text-[10px] uppercase ${
          approvedAt ? "border-gain/30 bg-gain/10 text-gain" : canApprove ? "border-primary/30 bg-primary/10 text-primary" : "border-warning/30 bg-warning/10 text-warning"
        }`}>
          {approvedAt ? "approved" : canApprove ? "ready to approve" : "needs checks"}
        </span>
      </div>

      <div className="grid gap-3 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-md border border-border bg-secondary p-3">
          <div className="mb-2 flex items-start justify-between gap-2">
            <div>
              <div className="text-[11px] uppercase text-muted-foreground">Broker entry draft</div>
              <div className="font-mono text-sm font-bold">{plan.symbol} {contract?.label ?? "No contract"}</div>
            </div>
            {contract ? <ContractVerdictBadge verdict={contract.verdict} /> : null}
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="rounded bg-card p-2"><span className="block text-muted-foreground">Order type</span><span className="font-mono">{contract?.verdict === "spread_only" ? "debit spread" : "limit buy"}</span></div>
            <div className="rounded bg-card p-2"><span className="block text-muted-foreground">Qty</span><span className="font-mono">{suggestedQty}/{maxQty}</span></div>
            <div className="rounded bg-card p-2"><span className="block text-muted-foreground">Limit debit</span><span className="font-mono">${limitDebit.toFixed(2)}</span></div>
            <div className="rounded bg-card p-2"><span className="block text-muted-foreground">Max risk</span><span className="font-mono">${Math.round(riskCost * suggestedQty)}</span></div>
            <div className="rounded bg-card p-2"><span className="block text-muted-foreground">Stop debit</span><span className="font-mono">${stopDebit.toFixed(2)}</span></div>
            <div className="rounded bg-card p-2"><span className="block text-muted-foreground">Target debit</span><span className="font-mono">${targetDebit.toFixed(2)}</span></div>
          </div>
          <div className="mt-2 rounded border border-border bg-card p-2 text-[11px] text-muted-foreground">
            {report.nextAction}
          </div>
        </div>

        <div className="space-y-3">
          <div className="grid gap-2">
            {[
              ["liveChain", liveWarn ? "Broker chain checked manually because app feed is not fully live" : "Live chain checked: bid/ask, volume, OI, and fill quality"],
              ["trigger", "Entry trigger confirmed on chart, not just predicted"],
              ["risk", `Risk accepted: max ${suggestedQty} contract(s), no averaging down`],
            ].map(([key, label]) => (
              <label key={key} className="flex items-center justify-between gap-3 rounded-md border border-border bg-secondary px-3 py-2 text-xs">
                <span>{label}</span>
                <input
                  type="checkbox"
                  checked={confirmed[key as keyof typeof confirmed]}
                  onChange={(event) => setConfirmed((current) => ({ ...current, [key]: event.target.checked }))}
                  className="h-4 w-4 accent-primary"
                />
              </label>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={copyTicket}
              disabled={!contract}
              className="rounded-md border border-border bg-secondary px-3 py-2 text-xs text-foreground transition-colors hover:bg-card disabled:cursor-not-allowed disabled:opacity-50"
            >
              {copyState === "copied" ? "Copied Ticket" : copyState === "failed" ? "Copy Failed" : "Copy Ticket"}
            </button>
            <button
              onClick={() => setApprovedAt(new Date().toLocaleTimeString())}
              disabled={!canApprove}
              className="rounded-md border border-primary/30 bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:border-border disabled:bg-secondary disabled:text-muted-foreground"
            >
              Approve For Manual Entry
            </button>
          </div>

          <div className={`rounded-md border p-2 text-xs ${
            approvedAt ? "border-gain/30 bg-gain/10 text-gain" : "border-warning/30 bg-warning/10 text-warning"
          }`}>
            {approvedAt
              ? `Approved at ${approvedAt}. Enter manually in your broker only if the live chain still matches this ticket.`
              : "Approval is locked until the chain, trigger, and risk checklist are confirmed."}
          </div>
        </div>
      </div>
    </div>
  );
}

function PassHitVerificationPanel({
  plan,
  settings,
  rules,
  liveState,
}: {
  plan: OpportunityPlan;
  settings: RiskSettings;
  rules: StrategyRuleSet;
  liveState?: LiveDataSnapshot["state"];
}) {
  const verification = useMemo(() => calculatePassHitVerification(plan, settings, rules), [plan, settings, rules]);
  const liveVerified = liveState === "live" || liveState === "degraded";
  const displayedVerification: PassHitVerification = liveVerified
    ? verification
    : {
      ...verification,
      readiness: verification.readiness === "do_not_trade" ? "do_not_trade" : "wait_for_open",
      requiredAction: "Live options feed is not verified. Use this as a watchlist signal only until bid/ask, volume, and contract data are current.",
    };
  const confidenceClass = verification.confidence === "verified"
    ? "text-gain"
    : verification.confidence === "watch"
      ? "text-warning"
      : "text-loss";

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <CheckCircle2 className="h-4 w-4 text-primary" />
            Pass / Hit Verification
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Uses the bot's rule checks plus modeled past outcomes. Treat as validation guidance, not live proof.
          </p>
        </div>
        <VerificationBadge verification={displayedVerification} />
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-md bg-secondary p-3">
          <div className="text-[11px] uppercase text-muted-foreground">Pass rate</div>
          <div className="mt-1 font-mono text-xl font-bold text-foreground">{verification.passRate}%</div>
        </div>
        <div className="rounded-md bg-secondary p-3">
          <div className="text-[11px] uppercase text-muted-foreground">Hit rate</div>
          <div className="mt-1 font-mono text-xl font-bold text-foreground">{verification.hitRate.toFixed(1)}%</div>
        </div>
        <div className="rounded-md bg-secondary p-3">
          <div className="text-[11px] uppercase text-muted-foreground">Expectancy</div>
          <div className="mt-1 font-mono text-xl font-bold text-foreground">{verification.expectancyR.toFixed(2)}R</div>
        </div>
        <div className="rounded-md bg-secondary p-3">
          <div className="text-[11px] uppercase text-muted-foreground">Confidence</div>
          <div className={`mt-1 font-mono text-xl font-bold uppercase ${confidenceClass}`}>{verification.confidence}</div>
        </div>
      </div>

      <div className="mt-3 rounded-md border border-border bg-secondary p-3 text-xs text-muted-foreground">
        <div className="text-foreground">{verification.summary}</div>
        <div className="mt-1">{displayedVerification.requiredAction}</div>
      </div>
    </div>
  );
}

function ProfitEfficiencyPanel({ plan, settings }: { plan: OpportunityPlan; settings: RiskSettings }) {
  const efficiency = useMemo(() => buildProfitEfficiencyPlan(plan, settings), [plan, settings]);
  const tone = efficiency.style === "skip"
    ? "border-loss/30 bg-loss/10 text-loss"
    : efficiency.score >= 70
      ? "border-gain/30 bg-gain/10 text-gain"
      : "border-warning/30 bg-warning/10 text-warning";

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Gauge className="h-4 w-4 text-primary" />
            Capital Efficiency
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Ranks potential return per dollar risked and leads with reasons to skip.
          </p>
        </div>
        <div className={`rounded border px-3 py-2 text-right ${tone}`}>
          <div className="text-[10px] uppercase">Efficiency</div>
          <div className="font-mono text-xl font-bold">{efficiency.score}/100</div>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-md border border-border bg-secondary p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[11px] uppercase text-muted-foreground">Trade style</span>
            <span className="rounded bg-card px-2 py-0.5 font-mono text-[10px] uppercase text-foreground">{efficiency.style.replace("_", " ")}</span>
          </div>
          <div className="text-sm font-medium">{efficiency.capitalRule}</div>
          <div className="mt-2 rounded border border-border bg-card p-2 text-xs text-muted-foreground">
            Skip reason: {efficiency.primarySkipReason}
          </div>
        </div>

        <div className="rounded-md border border-border bg-secondary p-3">
          <div className="mb-2 text-[11px] uppercase text-muted-foreground">Exit rules</div>
          <div className="grid gap-2">
            {efficiency.exitRules.map((rule) => (
              <div key={rule} className="flex items-start gap-2 text-xs">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                <span>{rule}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function OptionsAffordabilityPanel({ plan, settings }: { plan: OpportunityPlan; settings: RiskSettings }) {
  const candidates = useMemo(() => buildOptionContractCandidates(plan, settings), [plan, settings]);
  const filters = useMemo(() => evaluateSmallAccountFilters(plan, settings), [plan, settings]);
  const allowedRisk = Math.round(settings.accountSize * (Math.min(settings.maxTradeRiskPct, settings.maxPremiumRiskPct) / 100));
  const effectivePremiumCap = Math.min(settings.maxOptionPremium, allowedRisk / 100);
  const bestCandidate = candidates.find((candidate) => candidate.verdict === "long_call_ok") ?? candidates.find((candidate) => candidate.verdict === "spread_only") ?? candidates[0];
  const bestRiskQuote = bestCandidate?.verdict === "long_call_ok"
    ? bestCandidate.estimatedPremium
    : bestCandidate?.estimatedSpreadDebit ?? bestCandidate?.estimatedPremium ?? 0;
  const bestRiskCost = bestCandidate?.verdict === "long_call_ok"
    ? bestCandidate.maxLoss
    : bestCandidate?.spreadMaxLoss ?? bestCandidate?.maxLoss ?? 0;

  if (plan.assetClass !== "option") {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <CircleDollarSign className="h-4 w-4 text-accent" />
          Options Affordability
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Select an options setup to see contract affordability.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <CircleDollarSign className="h-4 w-4 text-accent" />
            Options Affordability
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Estimates premium risk against your account settings before any trade is considered.
          </p>
        </div>
        <div className="rounded border border-border bg-secondary px-3 py-2 text-right">
          <div className="text-[10px] uppercase text-muted-foreground">Max premium risk</div>
          <div className="font-mono text-lg font-bold">${allowedRisk.toLocaleString()}</div>
          <div className="font-mono text-[10px] text-muted-foreground">cap ${effectivePremiumCap.toFixed(2)} quote</div>
        </div>
      </div>

      {bestCandidate && (
        <div className="mb-4 rounded-md border border-primary/25 bg-primary/10 p-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] uppercase text-muted-foreground">Best fit</div>
              <div className="font-mono text-lg font-bold">{bestCandidate.label}</div>
            </div>
            <ContractVerdictBadge verdict={bestCandidate.verdict} />
          </div>
          <div className="grid gap-2 text-xs sm:grid-cols-4">
            <div className="rounded bg-card/70 p-2"><span className="block text-muted-foreground">Risk quote</span><span className="font-mono">${bestRiskQuote.toFixed(2)}</span></div>
            <div className="rounded bg-card/70 p-2"><span className="block text-muted-foreground">Risk cost</span><span className="font-mono">${bestRiskCost}</span></div>
            <div className="rounded bg-card/70 p-2"><span className="block text-muted-foreground">Long calls</span><span className="font-mono">{bestCandidate.maxLongCallContracts}</span></div>
            <div className="rounded bg-card/70 p-2"><span className="block text-muted-foreground">Spreads</span><span className="font-mono">{bestCandidate.maxSpreadContracts}</span></div>
          </div>
          <div className="mt-2 text-[11px] text-muted-foreground">
            Options are quoted per share. One contract costs about quote x 100 before fees.
          </div>
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-3">
        {candidates.map((candidate) => {
          const riskQuote = candidate.verdict === "long_call_ok"
            ? candidate.estimatedPremium
            : candidate.estimatedSpreadDebit ?? candidate.estimatedPremium;
          const riskCost = candidate.verdict === "long_call_ok"
            ? candidate.maxLoss
            : candidate.spreadMaxLoss ?? candidate.maxLoss;
          return (
            <div key={candidate.label} className="rounded-md border border-border bg-secondary p-3">
              <div className="mb-2 flex items-start justify-between gap-2">
                <div>
                  <div className="font-mono text-sm font-bold">{candidate.label}</div>
                  <div className="text-[11px] text-muted-foreground">{candidate.dte} DTE / {candidate.delta.toFixed(2)} delta</div>
                </div>
                <ContractVerdictBadge verdict={candidate.verdict} />
              </div>
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div><span className="text-muted-foreground">Risk quote</span><div className="font-mono">${riskQuote.toFixed(2)}</div></div>
                <div><span className="text-muted-foreground">Risk cost</span><div className="font-mono">${riskCost}</div></div>
                <div><span className="text-muted-foreground">Long quote</span><div className="font-mono">${candidate.estimatedPremium.toFixed(2)}</div></div>
                <div><span className="text-muted-foreground">Spread debit</span><div className="font-mono">${candidate.estimatedSpreadDebit?.toFixed(2)}</div></div>
              </div>
              <div className="mt-2 text-[11px] text-muted-foreground">
                {candidate.reasons[0] ?? candidate.skipReasons[0] ?? `Uses about a $${candidate.spreadWidth} wide spread.`}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-2">
        {filters.checks.map((check) => (
          <div key={check.label} className="flex items-start gap-2 rounded-md border border-border bg-secondary p-2 text-xs">
            {check.passed ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gain" /> : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />}
            <div>
              <div className="font-medium">{check.label}</div>
              <div className="text-muted-foreground">{check.detail}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Metric({ label, value, icon: Icon, tone = "default" }: { label: string; value: string; icon: typeof Activity; tone?: "default" | "gain" | "warning" | "loss" | "accent" }) {
  const color = tone === "gain" ? "text-gain" : tone === "loss" ? "text-loss" : tone === "warning" ? "text-warning" : tone === "accent" ? "text-accent" : "text-foreground";
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] uppercase text-muted-foreground">{label}</span>
        <Icon className={`h-4 w-4 ${color}`} />
      </div>
      <div className={`font-mono text-xl font-bold ${color}`}>{value}</div>
    </div>
  );
}

function ExactOptionsSignalPanel({ signal }: { signal: ExactOptionsSignal }) {
  const signalTone = signal.signal.includes("call")
    ? "border-gain/40 bg-gain/10 text-gain"
    : signal.signal.includes("put")
      ? "border-loss/40 bg-loss/10 text-loss"
      : signal.signal === "skip"
        ? "border-loss/40 bg-loss/10 text-loss"
        : "border-warning/40 bg-warning/10 text-warning";
  const readinessTone = signal.readiness === "ready_after_trigger"
    ? "text-gain"
    : signal.readiness === "watch_only"
      ? "text-warning"
      : "text-loss";
  const ticketText = [
    `${exactSignalLabel(signal.signal)} ${signal.contractLabel}`,
    `Structure: ${signal.structure.replace("_", " ")}`,
    `Grade: ${signal.grade} / ${signal.confidence}%`,
    `Entry debit: $${signal.entryDebit.toFixed(2)}`,
    `Stop debit: $${signal.stopDebit.toFixed(2)}`,
    `First scale: $${signal.partialDebit.toFixed(2)}`,
    `Target debit: $${signal.targetDebit.toFixed(2)}`,
    `Max contracts/spreads: ${signal.maxContracts}`,
    `Underlying trigger: $${signal.underlyingEntry.toFixed(2)}`,
    `Underlying stop: $${signal.underlyingStop.toFixed(2)}`,
    `Trigger: ${signal.exactTrigger}`,
    `Next check: ${signal.nextCheck}`,
    `Invalidation: ${signal.invalidation}`,
  ].join("\n");

  const copyTicket = () => {
    if (!navigator.clipboard) return;
    void navigator.clipboard.writeText(ticketText);
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4 text-primary" />
            <div className="text-sm font-semibold">Exact Options Signal</div>
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">Contract-aware entry, stop, target, trigger gate, and live-chain quality</div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded border px-2 py-1 text-[10px] font-bold ${signalTone}`}>{exactSignalLabel(signal.signal)}</span>
          <span className={`rounded border border-border bg-secondary px-2 py-1 font-mono text-[10px] ${readinessTone}`}>{signal.grade} {signal.confidence}%</span>
        </div>
      </div>

      <div className="mb-3 grid gap-2 sm:grid-cols-5">
        {[
          ["Setup", signal.setupScore],
          ["Execution", signal.executionScore],
          ["Chain", signal.chainScore],
          ["Timing", signal.timingScore],
          ["Catalyst", signal.catalystScore],
        ].map(([label, value]) => (
          <div key={label} className="rounded-md border border-border bg-secondary p-2">
            <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
            <div className={`mt-1 font-mono text-sm font-bold ${Number(value) >= 70 ? "text-gain" : Number(value) >= 55 ? "text-warning" : "text-loss"}`}>{value}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <div className="rounded-md border border-border bg-secondary p-3">
          <div className="text-[10px] uppercase text-muted-foreground">Entry debit</div>
          <div className="mt-1 font-mono text-lg font-bold text-foreground">${signal.entryDebit.toFixed(2)}</div>
          <div className="text-[10px] text-muted-foreground">{signal.contractLabel}</div>
        </div>
        <div className="rounded-md border border-border bg-secondary p-3">
          <div className="text-[10px] uppercase text-loss">Premium stop</div>
          <div className="mt-1 font-mono text-lg font-bold text-loss">${signal.stopDebit.toFixed(2)}</div>
          <div className="text-[10px] text-muted-foreground">No averaging down</div>
        </div>
        <div className="rounded-md border border-border bg-secondary p-3">
          <div className="text-[10px] uppercase text-gain">Premium target</div>
          <div className="mt-1 font-mono text-lg font-bold text-gain">${signal.targetDebit.toFixed(2)}</div>
          <div className="text-[10px] text-muted-foreground">Scale ${signal.partialDebit.toFixed(2)} / R:R {signal.rewardRisk.toFixed(2)}</div>
        </div>
        <div className="rounded-md border border-border bg-secondary p-3">
          <div className="text-[10px] uppercase text-muted-foreground">Max risk</div>
          <div className="mt-1 font-mono text-lg font-bold text-foreground">${signal.maxLoss}</div>
          <div className="text-[10px] text-muted-foreground">{signal.maxContracts} contract/spread cap</div>
        </div>
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-3">
        <div className="rounded-md bg-secondary p-3">
          <div className="text-[10px] uppercase text-muted-foreground">Underlying trigger</div>
          <div className="mt-1 font-mono text-sm text-foreground">${signal.underlyingEntry.toFixed(2)}</div>
        </div>
        <div className="rounded-md bg-secondary p-3">
          <div className="text-[10px] uppercase text-muted-foreground">Underlying stop</div>
          <div className="mt-1 font-mono text-sm text-loss">${signal.underlyingStop.toFixed(2)}</div>
        </div>
        <div className="rounded-md bg-secondary p-3">
          <div className="text-[10px] uppercase text-muted-foreground">Underlying target</div>
          <div className="mt-1 font-mono text-sm text-gain">${signal.underlyingTarget.toFixed(2)}</div>
          <div className="text-[10px] text-muted-foreground">Scale near ${signal.underlyingPartial.toFixed(2)}</div>
        </div>
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-4">
        <div className="rounded-md border border-border bg-secondary p-3">
          <div className="text-[10px] uppercase text-muted-foreground">Live bid / ask</div>
          <div className="mt-1 font-mono text-sm text-foreground">
            {signal.liveBid && signal.liveAsk ? `$${signal.liveBid.toFixed(2)} / $${signal.liveAsk.toFixed(2)}` : "Verify broker"}
          </div>
          <div className="text-[10px] text-muted-foreground">{signal.quoteSpreadPct !== undefined ? `${signal.quoteSpreadPct.toFixed(1)}% spread` : "spread unknown"}</div>
        </div>
        <div className="rounded-md border border-border bg-secondary p-3">
          <div className="text-[10px] uppercase text-muted-foreground">Chain depth</div>
          <div className="mt-1 font-mono text-sm text-foreground">{signal.liveVolume ?? 0} vol / {signal.openInterest ?? 0} OI</div>
          <div className="text-[10px] text-muted-foreground">{signal.contractType ? signal.contractType.toUpperCase() : "type unknown"} {signal.strike ? `$${signal.strike}` : ""}</div>
        </div>
        <div className="rounded-md border border-border bg-secondary p-3">
          <div className="text-[10px] uppercase text-muted-foreground">Expiration</div>
          <div className="mt-1 font-mono text-sm text-foreground">{signal.expiration ?? "Modeled DTE"}</div>
          <div className="text-[10px] text-muted-foreground">Refresh before order</div>
        </div>
        <div className="rounded-md border border-border bg-secondary p-3">
          <div className="text-[10px] uppercase text-muted-foreground">Time stop</div>
          <div className="mt-1 text-xs text-foreground">{signal.timeStop}</div>
        </div>
      </div>

      <div className={`mt-3 rounded-md border p-3 text-xs ${signal.readiness === "ready_after_trigger" ? "border-gain/30 bg-gain/10" : signal.readiness === "watch_only" ? "border-warning/30 bg-warning/10" : "border-loss/30 bg-loss/10"}`}>
        <div className="font-medium text-foreground">{signal.action}</div>
        <div className="mt-1 text-muted-foreground">{signal.exactTrigger}</div>
        <div className="mt-2 rounded border border-border bg-background p-2 text-foreground">Next check: {signal.nextCheck}</div>
        <div className="mt-1 text-muted-foreground">{signal.invalidation}</div>
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-2">
        <div className="space-y-1">
          {signal.reasons.slice(0, 4).map((reason) => (
            <div key={reason} className="flex items-start gap-2 text-[11px] text-muted-foreground">
              <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-gain" />
              <span>{reason}</span>
            </div>
          ))}
        </div>
        <div className="space-y-1">
          {(signal.blockers.length ? signal.blockers : ["No hard blocker after trigger; still verify live chain."]).slice(0, 4).map((blocker) => (
            <div key={blocker} className="flex items-start gap-2 text-[11px] text-muted-foreground">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-warning" />
              <span>{blocker}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3">
        <div className="text-[10px] uppercase text-muted-foreground">Required confirmations</div>
        <div className="mt-1 grid gap-1 md:grid-cols-2">
          {signal.confirmations.map((confirmation) => (
            <div key={confirmation} className="flex items-start gap-2 text-[11px] text-muted-foreground">
              <ListChecks className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
              <span>{confirmation}</span>
            </div>
          ))}
        </div>
      </div>

      <button onClick={copyTicket} className="mt-3 rounded-md border border-border bg-secondary px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground">
        Copy Ticket
      </button>
    </div>
  );
}

function BrokerVerificationPanel({ signal }: { signal: ExactOptionsSignal }) {
  const passed = signal.brokerChecks.filter((check) => check.passed).length;
  return (
    <div className={`rounded-lg border p-4 ${signal.brokerVerified ? "border-gain/40 bg-gain/5" : "border-warning/40 bg-warning/5"}`}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Broker-Confirmed Trade Gate
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">All checks must pass before a signal can become ready.</div>
        </div>
        <div className={`font-mono text-xs ${signal.brokerVerified ? "text-gain" : "text-warning"}`}>{passed}/{signal.brokerChecks.length}</div>
      </div>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {signal.brokerChecks.map((check) => (
          <div key={check.label} className="flex items-start gap-2 rounded border border-border bg-secondary p-2 text-[10px]">
            {check.passed ? <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-gain" /> : <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-warning" />}
            <div><div className="font-medium text-foreground">{check.label}</div><div className="text-muted-foreground">{check.detail}</div></div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SignalCommandCenter({
  rows,
  selected,
  onSelect,
}: {
  rows: SignalCommandRow[];
  selected: OpportunityPlan;
  onSelect: (plan: OpportunityPlan) => void;
}) {
  const readyCount = rows.filter((row) => row.signal.readiness === "ready_after_trigger").length;
  const watchCount = rows.filter((row) => row.signal.readiness === "watch_only").length;
  const best = rows[0];

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <ListChecks className="h-4 w-4 text-primary" />
            Signal Command Center
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">Exact-signal ranking across movers, radar, dips, and selected setup</div>
        </div>
        <div className="grid grid-cols-3 gap-2 text-right text-[10px]">
          <div className="rounded border border-border bg-secondary px-2 py-1">
            <div className="uppercase text-muted-foreground">Top</div>
            <div className="font-mono text-foreground">{best?.plan.symbol ?? "None"}</div>
          </div>
          <div className="rounded border border-border bg-secondary px-2 py-1">
            <div className="uppercase text-muted-foreground">Ready</div>
            <div className="font-mono text-gain">{readyCount}</div>
          </div>
          <div className="rounded border border-border bg-secondary px-2 py-1">
            <div className="uppercase text-muted-foreground">Watch</div>
            <div className="font-mono text-warning">{watchCount}</div>
          </div>
        </div>
      </div>

      <div className="divide-y divide-border">
        {rows.map((row) => {
          const active = selected.symbol === row.plan.symbol;
          const tone = row.signal.readiness === "ready_after_trigger"
            ? "text-gain"
            : row.signal.readiness === "watch_only"
              ? "text-warning"
              : "text-loss";
          const labelTone = row.signal.signal.includes("call")
            ? "border-gain/40 bg-gain/10 text-gain"
            : row.signal.signal.includes("put")
              ? "border-loss/40 bg-loss/10 text-loss"
              : row.signal.signal === "skip"
                ? "border-loss/40 bg-loss/10 text-loss"
                : "border-warning/40 bg-warning/10 text-warning";

          return (
            <button
              key={`${row.source}:${row.plan.symbol}`}
              type="button"
              onClick={() => onSelect(row.plan)}
              className={`w-full px-4 py-3 text-left transition-colors ${active ? "bg-secondary" : "hover:bg-secondary/60"}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-bold text-foreground">{row.plan.symbol}</span>
                    <span className={`rounded border px-2 py-0.5 text-[10px] font-bold ${labelTone}`}>{exactSignalLabel(row.signal.signal)}</span>
                    <span className="rounded border border-border bg-card px-2 py-0.5 text-[10px] uppercase text-muted-foreground">{row.source}</span>
                  </div>
                  <div className="mt-1 line-clamp-1 text-[11px] text-muted-foreground">{row.signal.nextCheck}</div>
                </div>
                <div className="text-right">
                  <div className={`font-mono text-sm font-bold ${tone}`}>{row.signal.grade} {row.signal.confidence}%</div>
                  <div className="font-mono text-[10px] text-muted-foreground">rank {row.rankScore}</div>
                </div>
              </div>
              <div className="mt-2 grid gap-2 text-[10px] text-muted-foreground sm:grid-cols-5">
                <div><span className="block uppercase">Entry</span><span className="font-mono text-foreground">${row.signal.entryDebit.toFixed(2)}</span></div>
                <div><span className="block uppercase">Stop</span><span className="font-mono text-loss">${row.signal.stopDebit.toFixed(2)}</span></div>
                <div><span className="block uppercase">Target</span><span className="font-mono text-gain">${row.signal.targetDebit.toFixed(2)}</span></div>
                <div><span className="block uppercase">Chain</span><span className={`font-mono ${row.signal.chainScore >= 70 ? "text-gain" : row.signal.chainScore >= 55 ? "text-warning" : "text-loss"}`}>{row.signal.chainScore}</span></div>
                <div><span className="block uppercase">Risk</span><span className="font-mono text-foreground">${row.signal.maxLoss}</span></div>
              </div>
            </button>
          );
        })}
        {!rows.length ? (
          <div className="px-4 py-5 text-sm text-muted-foreground">No option signals available yet. Refresh live data or widen filters.</div>
        ) : null}
      </div>
    </div>
  );
}

function MissPreventionPanel({ rows }: { rows: DefenseRow[] }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <ShieldCheck className="h-4 w-4 text-primary" />
        Miss Prevention
      </div>
      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.blocker} className="rounded-md border border-border bg-secondary p-3">
            <div className="mb-1 flex items-start justify-between gap-2">
              <div className="text-xs font-medium text-foreground">{row.blocker}</div>
              <span className="rounded border border-border bg-card px-2 py-0.5 font-mono text-[10px] text-muted-foreground">{row.count}x</span>
            </div>
            <div className="text-[11px] text-muted-foreground">{row.fix}</div>
            <div className="mt-2 font-mono text-[10px] text-muted-foreground">{row.symbols.join(", ")}</div>
          </div>
        ))}
        {!rows.length ? (
          <div className="rounded-md border border-gain/30 bg-gain/10 p-3 text-xs text-gain">
            No repeated blockers in the current command queue.
          </div>
        ) : null}
      </div>
    </div>
  );
}

function AutomationQueuePanel({ rows }: { rows: AutomationQueueRow[] }) {
  const modeClass: Record<AutomationQueueRow["mode"], string> = {
    auto_monitor: "border-primary/30 bg-primary/10 text-primary",
    stage_ticket: "border-gain/30 bg-gain/10 text-gain",
    human_review: "border-warning/30 bg-warning/10 text-warning",
    blocked: "border-loss/30 bg-loss/10 text-loss",
  };
  const counts = {
    stage: rows.filter((row) => row.mode === "stage_ticket").length,
    monitor: rows.filter((row) => row.mode === "auto_monitor").length,
    review: rows.filter((row) => row.mode === "human_review").length,
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Bell className="h-4 w-4 text-primary" />
            Automation Queue
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">Auto-monitoring and human-approved ticket staging</div>
        </div>
        <div className="grid grid-cols-3 gap-1 text-center text-[10px]">
          <div className="rounded border border-border bg-secondary px-2 py-1"><div className="text-muted-foreground">Stage</div><div className="font-mono text-gain">{counts.stage}</div></div>
          <div className="rounded border border-border bg-secondary px-2 py-1"><div className="text-muted-foreground">Watch</div><div className="font-mono text-primary">{counts.monitor}</div></div>
          <div className="rounded border border-border bg-secondary px-2 py-1"><div className="text-muted-foreground">Review</div><div className="font-mono text-warning">{counts.review}</div></div>
        </div>
      </div>

      <div className="space-y-2">
        {rows.map((row) => (
          <div key={`${row.label}:${row.symbol ?? "system"}:${row.mode}`} className="rounded-md border border-border bg-secondary p-3">
            <div className="mb-1 flex items-start justify-between gap-2">
              <div>
                <div className="font-mono text-xs font-bold text-foreground">{row.symbol ?? "SYSTEM"} <span className="font-sans font-medium text-muted-foreground">{row.label}</span></div>
                <div className="mt-1 text-[11px] text-muted-foreground">{row.reason}</div>
              </div>
              <span className={`rounded border px-2 py-0.5 text-[10px] font-bold ${modeClass[row.mode]}`}>{row.mode.replace("_", " ")}</span>
            </div>
            <div className="mt-2 rounded border border-border bg-card p-2 text-[11px] text-foreground">{row.nextAction}</div>
          </div>
        ))}
        {!rows.length ? (
          <div className="rounded-md border border-border bg-secondary p-3 text-xs text-muted-foreground">
            Queue is empty. Refresh live data or wait for the next scanner cycle.
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MarketWideRadarPanel({
  rows,
  selected,
  lastAlert,
  onSelect,
}: {
  rows: MarketWideRadarRow[];
  selected: OpportunityPlan;
  lastAlert: MarketWideRadarRow | null;
  onSelect: (plan: OpportunityPlan) => void;
}) {
  const topRows = rows.slice(0, 6);
  const urgentCount = rows.filter((row) => row.score >= 74 && row.stage !== "discovery").length;
  const stageClass = {
    discovery: "border-primary/30 bg-primary/10 text-primary",
    confirmation: "border-warning/30 bg-warning/10 text-warning",
    trade_candidate: "border-gain/30 bg-gain/10 text-gain",
  };

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Bell className="h-4 w-4 text-accent" />
          Market-Wide Radar
        </div>
        <span className="font-mono text-[10px] text-muted-foreground">{urgentCount ? `${urgentCount} urgent` : `${topRows.length} ranked`}</span>
      </div>
      {lastAlert && (
        <div className="border-b border-border bg-accent/10 px-3 py-2 text-[10px] text-accent">
          Last alert: <span className="font-mono font-bold">{lastAlert.symbol}</span> {lastAlert.stage.replace("_", " ")} at {lastAlert.score}
        </div>
      )}
      {topRows.length === 0 ? (
        <div className="p-3 text-[10px] text-muted-foreground">Waiting for live catalysts, top movers, or dynamic option plans.</div>
      ) : (
        <div className="divide-y divide-border">
          {topRows.map((row) => {
            const active = selected.symbol === row.plan?.symbol;
            return (
              <button
                key={`${row.symbol}-${row.stage}`}
                onClick={() => row.plan && onSelect(row.plan)}
                disabled={!row.plan}
                className={`w-full px-3 py-2.5 text-left transition-colors ${active ? "bg-secondary" : "hover:bg-secondary/60"} disabled:cursor-default disabled:opacity-100`}
              >
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-bold">{row.symbol}</span>
                      <span className={`rounded border px-1.5 py-0.5 text-[9px] ${stageClass[row.stage]}`}>
                        {row.stage.replace("_", " ")}
                      </span>
                    </div>
                    <div className="mt-1 text-[10px] text-muted-foreground">{row.theme}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-sm font-bold text-foreground">{row.score}</div>
                    <div className={`font-mono text-[10px] ${row.movePct >= 0 ? "text-gain" : "text-loss"}`}>
                      {row.movePct >= 0 ? "+" : ""}{row.movePct.toFixed(1)}%
                    </div>
                  </div>
                </div>
                <div className="mb-2 flex flex-wrap gap-1">
                  {row.reasons.map((reason) => (
                    <span key={reason} className="rounded bg-secondary px-1.5 py-0.5 text-[9px] text-muted-foreground">{reason}</span>
                  ))}
                </div>
                {row.sympathyPeers.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1 text-[9px]">
                    <span className="text-muted-foreground">Peers</span>
                    {row.sympathyPeers.slice(0, 4).map((peer) => (
                      <span key={peer} className="rounded border border-border bg-card px-1.5 py-0.5 font-mono text-muted-foreground">{peer}</span>
                    ))}
                  </div>
                )}
                <div className="text-[10px] text-muted-foreground">{row.blocker}</div>
                <div className="mt-1 text-[10px] text-foreground">{row.action}</div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MissedRunnerAutopsyPanel({ rows }: { rows: MissedRunnerRow[] }) {
  const topRows = rows.slice(0, 5);
  const statusClass = {
    caught: "border-gain/30 bg-gain/10 text-gain",
    at_risk: "border-warning/30 bg-warning/10 text-warning",
    missed: "border-loss/30 bg-loss/10 text-loss",
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <ListChecks className="h-4 w-4 text-warning" />
          Missed Runner Autopsy
        </div>
        <span className="font-mono text-[10px] text-muted-foreground">{topRows.length} gaps</span>
      </div>
      {topRows.length === 0 ? (
        <div className="text-[11px] text-muted-foreground">No high-move autopsy candidate yet. Keep the app running through premarket and the open.</div>
      ) : (
        <div className="space-y-2">
          {topRows.map((row) => (
            <div key={row.symbol} className="rounded-md border border-border bg-secondary p-2.5">
              <div className="mb-1 flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-bold">{row.symbol}</span>
                    <span className={`rounded border px-1.5 py-0.5 text-[9px] ${statusClass[row.status]}`}>{row.status.replace("_", " ")}</span>
                  </div>
                  <div className="mt-0.5 text-[10px] text-muted-foreground">{row.theme}</div>
                </div>
                <div className="text-right">
                  <div className={`font-mono text-xs ${row.movePct >= 0 ? "text-gain" : "text-loss"}`}>{row.movePct >= 0 ? "+" : ""}{row.movePct.toFixed(1)}%</div>
                  <div className="font-mono text-[10px] text-muted-foreground">{row.missRisk}</div>
                </div>
              </div>
              <div className="text-[10px] text-foreground">{row.cause}</div>
              <div className="mt-1 text-[10px] text-muted-foreground">{row.fix}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function IntelligenceMemoryPanel({ summary, onClear }: { summary: IntelligenceSummary; onClear: () => void }) {
  const topProfiles = summary.profiles.slice(0, 4);

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Beaker className="h-4 w-4 text-primary" />
          Learning Engine
        </div>
        <button onClick={onClear} className="rounded border border-border bg-secondary px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground">
          Reset
        </button>
      </div>
      {topProfiles.length === 0 ? (
        <div className="text-[11px] text-muted-foreground">Collecting winners, misses, and radar outcomes. Keep the dashboard running through live sessions.</div>
      ) : (
        <div className="space-y-2">
          {topProfiles.map((profile) => {
            const total = profile.wins + profile.misses + profile.flats;
            const hitRate = total ? Math.round((profile.wins / total) * 100) : 0;
            const tone = profile.wins > profile.misses || profile.bestMovePct >= 30 ? "text-gain" : profile.misses > profile.wins ? "text-warning" : "text-muted-foreground";
            return (
              <div key={profile.theme} className="rounded-md border border-border bg-secondary p-2.5">
                <div className="mb-1 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold text-foreground">{profile.theme}</div>
                    <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{profile.symbols.slice(0, 4).join(", ") || "watching"}</div>
                  </div>
                  <div className={`text-right font-mono text-xs ${tone}`}>{hitRate}%</div>
                </div>
                <div className="grid grid-cols-4 gap-1 text-[10px] text-muted-foreground">
                  <div><span className="block uppercase">W</span><span className="font-mono text-foreground">{profile.wins}</span></div>
                  <div><span className="block uppercase">M</span><span className="font-mono text-foreground">{profile.misses}</span></div>
                  <div><span className="block uppercase">Flat</span><span className="font-mono text-foreground">{profile.flats}</span></div>
                  <div><span className="block uppercase">Best</span><span className="font-mono text-foreground">{profile.bestMovePct.toFixed(0)}%</span></div>
                </div>
                {profile.falsePositiveReasons[0] && (
                  <div className="mt-1 text-[10px] text-warning">{profile.falsePositiveReasons[0]}</div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {summary.recommendations.length > 0 && (
        <div className="mt-3 space-y-1">
          {summary.recommendations.map((item) => (
            <div key={item} className="rounded bg-secondary p-2 text-[10px] text-muted-foreground">{item}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function OptionMoverList({ movers, selected, onSelect }: { movers: OptionMoverRow[]; selected: OpportunityPlan; onSelect: (plan: OpportunityPlan) => void }) {
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Zap className="h-4 w-4 text-warning" />
          Biggest Moving Options
        </div>
        <span className="font-mono text-[10px] text-muted-foreground">move + flow</span>
      </div>
      <div className="max-h-[440px] divide-y divide-border overflow-y-auto scrollbar-thin">
        {movers.map((mover) => {
          const plan = mover.plan;
          const active = selected.symbol === plan.symbol;
          const BiasIcon = plan.bias === "bullish" ? ArrowUpRight : plan.bias === "bearish" ? ArrowDownRight : PauseCircle;
          return (
            <button
              key={plan.symbol}
              onClick={() => onSelect(plan)}
              className={`w-full px-3 py-2.5 text-left transition-colors ${active ? "bg-secondary" : "hover:bg-secondary/60"}`}
            >
              <div className="mb-2 flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-bold">{plan.symbol}</span>
                    <QualityBadge quality={plan.quality} />
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">{plan.name}</div>
                </div>
                <div className={`text-right font-mono text-xs ${mover.movePct >= 0 ? "text-gain" : "text-loss"}`}>
                  {mover.movePct >= 0 ? "+" : ""}{formatPct(mover.movePct)}
                  <div className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-muted-foreground">
                    <BiasIcon className="h-3 w-3" />
                    {plan.bias}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-[1fr_auto] items-center gap-3">
                <ScoreBar value={mover.score} tone={mover.score >= 70 ? "gain" : "warning"} />
                <span className="font-mono text-xs text-foreground">{mover.score}</span>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-[10px] text-muted-foreground">
                <div>
                  <span className="block uppercase">Quote</span>
                  <span className="font-mono text-foreground">${mover.optionQuote.toFixed(2)}</span>
                </div>
                <div>
                  <span className="block uppercase">Cost</span>
                  <span className="font-mono text-foreground">${mover.contractCost}</span>
                </div>
                <div>
                  <span className="block uppercase">Source</span>
                  <span className="font-mono text-foreground">{mover.source}</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DipReboundList({ rows, selected, onSelect }: { rows: DipReboundRow[]; selected: OpportunityPlan; onSelect: (plan: OpportunityPlan) => void }) {
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <TrendingUp className="h-4 w-4 text-gain" />
          Dip Rebound Watch
        </div>
        <span className="font-mono text-[10px] text-muted-foreground">{rows.length} candidates</span>
      </div>
      {rows.length === 0 ? (
        <div className="p-3 text-[10px] text-muted-foreground">
          No down-option rebound candidate yet. Waiting for a red contract with bullish trend, support hold, affordable cost, and non-broken structure.
        </div>
      ) : (
        <div className="max-h-[330px] divide-y divide-border overflow-y-auto scrollbar-thin">
          {rows.map((row) => {
            const plan = row.plan;
            const active = selected.symbol === plan.symbol;
            return (
              <button
                key={plan.symbol}
                onClick={() => onSelect(plan)}
                className={`w-full px-3 py-2.5 text-left transition-colors ${active ? "bg-secondary" : "hover:bg-secondary/60"}`}
              >
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-bold">{plan.symbol}</span>
                      <span className="rounded border border-gain/30 bg-gain/10 px-1.5 py-0.5 text-[9px] text-gain">trend up</span>
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{plan.name}</div>
                  </div>
                  <div className="text-right font-mono text-xs text-loss">
                    {formatPct(row.movePct)}
                    <div className="mt-0.5 text-[10px] text-muted-foreground">${row.contractCost}</div>
                  </div>
                </div>
                <div className="grid grid-cols-[1fr_auto] items-center gap-3">
                  <ScoreBar value={row.reboundScore} tone={row.reboundScore >= 70 ? "gain" : "warning"} />
                  <span className="font-mono text-xs text-foreground">{row.reboundScore}</span>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-[10px] text-muted-foreground">
                  <div>
                    <span className="block uppercase">Support</span>
                    <span className="font-mono text-foreground">{row.supportGapPct.toFixed(1)}%</span>
                  </div>
                  <div>
                    <span className="block uppercase">Flow</span>
                    <span className="font-mono text-foreground">{plan.flowScore}</span>
                  </div>
                  <div>
                    <span className="block uppercase">Quote</span>
                    <span className="font-mono text-foreground">${row.optionQuote.toFixed(2)}</span>
                  </div>
                </div>
                <div className="mt-2 rounded bg-secondary p-2 text-[10px] text-muted-foreground">
                  {row.reclaimTrigger}
                </div>
                <div className="mt-1 text-[10px] text-warning">{row.riskNote}</div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CatalystRadarPanel({
  events,
  plans,
  liveCount,
  onSelect,
}: {
  events: CatalystEvent[];
  plans: OpportunityPlan[];
  liveCount: number;
  onSelect: (plan: OpportunityPlan) => void;
}) {
  const planBySymbol = new Map(plans.map((plan) => [plan.symbol, plan]));

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Bell className="h-4 w-4 text-warning" />
          Catalyst Radar
        </div>
        <span className="font-mono text-[10px] text-muted-foreground">{liveCount ? `${liveCount} live` : "none"}</span>
      </div>
      <div className="divide-y divide-border">
        {events.slice(0, 4).map((event) => {
          const plan = planBySymbol.get(event.symbol);
          const dealGap = event.dealPrice ? Math.max(0, ((event.dealPrice - event.stockPrice) / event.stockPrice) * 100) : undefined;
          const sourceLabel = event.sources?.length ? event.sources.join(" + ") : "Unverified source";
          const riskClass = event.chaseRisk === "high"
            ? "border-loss/30 bg-loss/10 text-loss"
            : event.chaseRisk === "medium"
              ? "border-warning/30 bg-warning/10 text-warning"
              : "border-gain/30 bg-gain/10 text-gain";

          return (
            <button
              key={`${event.symbol}-${event.detectedAt}`}
              onClick={() => plan && onSelect(plan)}
              disabled={!plan}
              className="w-full px-3 py-3 text-left transition-colors hover:bg-secondary/60 disabled:cursor-not-allowed disabled:opacity-70"
            >
              <div className="mb-2 flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-bold">{event.symbol}</span>
                    <span className={`rounded border px-2 py-0.5 text-[10px] uppercase ${riskClass}`}>{event.chaseRisk} chase</span>
                  </div>
                  <div className="mt-1 text-xs text-foreground">{event.headline}</div>
                </div>
                <div className={`font-mono text-xs ${event.movePct >= 0 ? "text-gain" : "text-loss"}`}>
                  {event.movePct >= 0 ? "+" : ""}{event.movePct.toFixed(1)}%
                </div>
              </div>
              <div className="grid grid-cols-4 gap-2 text-[10px] text-muted-foreground">
                <div>
                  <span className="block uppercase">Urgency</span>
                  <span className="font-mono text-foreground">{event.urgencyScore}</span>
                </div>
                <div>
                  <span className="block uppercase">Options</span>
                  <span className="font-mono text-foreground">{event.optionVolume ? event.optionVolume.toLocaleString() : "watch"}</span>
                </div>
                <div>
                  <span className="block uppercase">Sources</span>
                  <span className="font-mono text-foreground">{event.corroborationScore ?? event.sources?.length ?? 1}</span>
                </div>
                <div>
                  <span className="block uppercase">Credibility</span>
                  <span className="font-mono text-foreground">{event.credibilityScore ?? "N/A"}</span>
                </div>
              </div>
              <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                <span className="truncate">{sourceLabel}</span>
                <span className="font-mono">{dealGap === undefined ? "no deal gap" : `${dealGap.toFixed(1)}% deal gap`}</span>
              </div>
              <div className="mt-2 rounded bg-secondary p-2 text-[11px] text-muted-foreground">
                {event.action}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function NewsDiscoveryPanel({
  plans,
  events,
  selected,
  onSelect,
}: {
  plans: OpportunityPlan[];
  events: CatalystEvent[];
  selected: OpportunityPlan;
  onSelect: (plan: OpportunityPlan) => void;
}) {
  const eventBySymbol = new Map(events.map((event) => [event.symbol, event]));
  const discoveries = plans
    .filter((plan) => plan.name.includes("catalyst discovery") || plan.name.includes("extreme mover"))
    .sort((a, b) => b.catalystScore - a.catalystScore)
    .slice(0, 6);

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="h-4 w-4 text-primary" />
          News Discovery
        </div>
        <span className="font-mono text-[10px] text-muted-foreground">{discoveries.length} new</span>
      </div>
      {discoveries.length === 0 ? (
        <div className="p-3 text-[10px] text-muted-foreground">
          No outside-watchlist catalyst has been promoted yet. High-urgency news and top movers will appear here automatically.
        </div>
      ) : (
        <div className="max-h-[340px] divide-y divide-border overflow-y-auto scrollbar-thin">
          {discoveries.map((plan) => {
            const event = eventBySymbol.get(plan.symbol);
            const active = selected.symbol === plan.symbol;
            const cost = Math.round((buildOptionContractCandidates(plan, defaultRiskSettings)[0]?.estimatedPremium ?? 0) * 100);
            const extreme = plan.name.includes("extreme mover") || Math.abs(plan.changePct) >= 50;
            return (
              <button
                key={plan.symbol}
                onClick={() => onSelect(plan)}
                className={`w-full px-3 py-2.5 text-left transition-colors ${active ? "bg-secondary" : "hover:bg-secondary/60"}`}
              >
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-bold">{plan.symbol}</span>
                      <span className={`rounded border px-1.5 py-0.5 text-[9px] ${
                        extreme ? "border-loss/30 bg-loss/10 text-loss" : "border-primary/30 bg-primary/10 text-primary"
                      }`}>
                        {extreme ? "extreme" : "outside list"}
                      </span>
                    </div>
                    <div className="mt-1 line-clamp-2 text-[11px] text-foreground">{event?.headline ?? plan.name}</div>
                  </div>
                  <div className={`text-right font-mono text-xs ${plan.changePct >= 0 ? "text-gain" : "text-loss"}`}>
                    {plan.changePct >= 0 ? "+" : ""}{plan.changePct.toFixed(1)}%
                    <div className="mt-0.5 text-[10px] text-muted-foreground">{plan.catalystScore}</div>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-[10px] text-muted-foreground">
                  <div>
                    <span className="block uppercase">Est cost</span>
                    <span className="font-mono text-foreground">${cost}</span>
                  </div>
                  <div>
                    <span className="block uppercase">Risk</span>
                    <span className="font-mono text-foreground">{plan.eventRisk}</span>
                  </div>
                  <div>
                    <span className="block uppercase">Sources</span>
                    <span className="font-mono text-foreground">{event?.corroborationScore ?? event?.sources?.length ?? 1}</span>
                  </div>
                </div>
                <div className="mt-2 rounded bg-secondary p-2 text-[10px] text-muted-foreground">
                  {plan.trigger}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function WeeklyPredictionAuditPanel() {
  const hits = WEEKLY_PREDICTION_AUDIT.filter((row) => row.outcome === "hit").length;
  const avgFavorable = WEEKLY_PREDICTION_AUDIT.reduce((sum, row) => sum + row.maxFavorablePct, 0) / WEEKLY_PREDICTION_AUDIT.length;
  const avgFinal = WEEKLY_PREDICTION_AUDIT.reduce((sum, row) => sum + row.finalMovePct, 0) / WEEKLY_PREDICTION_AUDIT.length;

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Beaker className="h-4 w-4 text-primary" />
          Weekly Prediction Audit
        </div>
        <div className="mt-1 text-[11px] text-muted-foreground">June 3–5 continuation predictions versus Polygon underlying data</div>
      </div>
      <div className="grid grid-cols-3 gap-2 border-b border-border p-3 text-center text-[10px]">
        <div className="rounded bg-secondary p-2"><div className="uppercase text-muted-foreground">Hits</div><div className="font-mono text-loss">{hits}/{WEEKLY_PREDICTION_AUDIT.length}</div></div>
        <div className="rounded bg-secondary p-2"><div className="uppercase text-muted-foreground">Avg best</div><div className="font-mono text-warning">+{avgFavorable.toFixed(1)}%</div></div>
        <div className="rounded bg-secondary p-2"><div className="uppercase text-muted-foreground">Avg final</div><div className="font-mono text-loss">{avgFinal.toFixed(1)}%</div></div>
      </div>
      <div className="max-h-[420px] divide-y divide-border overflow-y-auto scrollbar-thin">
        {WEEKLY_PREDICTION_AUDIT.map((row) => (
          <div key={row.symbol} className="px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-mono text-sm font-bold text-foreground">{row.symbol}</div>
                <div className="text-[10px] text-muted-foreground">{row.prediction}</div>
              </div>
              <span className="rounded border border-loss/30 bg-loss/10 px-2 py-0.5 text-[10px] font-bold text-loss">MISS</span>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-[10px]">
              <div><span className="block uppercase text-muted-foreground">Jun 3 open</span><span className="font-mono text-foreground">${row.entryOpen.toFixed(2)}</span></div>
              <div><span className="block uppercase text-muted-foreground">Best</span><span className="font-mono text-warning">+{row.maxFavorablePct.toFixed(1)}%</span></div>
              <div><span className="block uppercase text-muted-foreground">Final</span><span className="font-mono text-loss">{row.finalMovePct.toFixed(1)}%</span></div>
            </div>
            <div className="mt-2 rounded bg-secondary p-2 text-[10px] text-muted-foreground">{row.lesson}</div>
          </div>
        ))}
      </div>
      <div className="border-t border-border px-4 py-3 text-[10px] text-muted-foreground">
        Underlying-stock audit only. Historical option-chain returns were not available, so no option-profit claim is made.
      </div>
    </div>
  );
}

function TomorrowPatternPanel({
  plans,
  onSelect,
}: {
  plans: OpportunityPlan[];
  onSelect: (plan: OpportunityPlan) => void;
}) {
  const planByRoot = new Map(plans.map((plan) => [planRoot(plan.symbol), plan]));
  const displayedCandidates = [...tomorrowSimilarityCandidates]
    .sort((a, b) => {
      const sourceRank = Number(b.source === "new_discovery") - Number(a.source === "new_discovery");
      const aScore = a.similarityScore - recentContinuationPenalty(a.symbol, false);
      const bScore = b.similarityScore - recentContinuationPenalty(b.symbol, false);
      return sourceRank || bScore - aScore;
    })
    .slice(0, 6);
  const newDiscoveryCount = tomorrowSimilarityCandidates.filter((candidate) => candidate.source === "new_discovery").length;

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Target className="h-4 w-4 text-accent" />
          New Pattern Matches
        </div>
        <span className="font-mono text-[10px] text-muted-foreground">{newDiscoveryCount} new</span>
      </div>
      <div className="divide-y divide-border">
        {displayedCandidates.map((candidate) => {
          const plan = planByRoot.get(candidate.symbol);
          const audit = recentContinuationAudit(candidate.symbol);
          const calibratedScore = clampScore(candidate.similarityScore - recentContinuationPenalty(candidate.symbol, false));
          const scoreTone = calibratedScore >= 85 ? "text-gain" : calibratedScore >= 75 ? "text-warning" : "text-muted-foreground";
          const sourceLabel = candidate.source === "new_discovery" ? "new match" : audit ? "audited miss" : "winner example";
          const sourceTone = candidate.source === "new_discovery"
            ? "border-gain/40 bg-gain/10 text-gain"
            : audit
              ? "border-loss/40 bg-loss/10 text-loss"
              : "border-border bg-secondary text-muted-foreground";
          return (
            <button
              key={candidate.symbol}
              onClick={() => plan && onSelect(plan)}
              disabled={!plan}
              className="w-full px-3 py-3 text-left transition-colors hover:bg-secondary/60 disabled:cursor-default disabled:opacity-100"
            >
              <div className="mb-1 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-bold">{candidate.symbol}</span>
                    <span className={`rounded border px-1.5 py-0.5 text-[9px] ${sourceTone}`}>
                      {sourceLabel}
                    </span>
                    <span className="rounded border border-border bg-secondary px-1.5 py-0.5 text-[9px] text-muted-foreground">
                      {candidate.theme.replace(/_/g, " ")}
                    </span>
                  </div>
                  <div className="mt-1 text-[10px] text-muted-foreground">{candidate.catalystWindow}</div>
                </div>
                <div className={`font-mono text-sm font-bold ${scoreTone}`}>{calibratedScore}</div>
              </div>
              <div className="mt-2 text-[11px] text-foreground">{candidate.whySimilar}</div>
              <div className="mt-2 rounded bg-secondary p-2 text-[10px] text-muted-foreground">
                {audit ? audit.lesson : candidate.confirmationNeeded}
              </div>
              <div className="mt-1 flex items-center justify-between gap-2 text-[10px]">
                <span className="text-warning">{candidate.budgetNote}</span>
                <span className="shrink-0 font-mono text-muted-foreground">{plan ? "plan ready" : "watchlist"}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PlanDetail({ plan }: { plan: OpportunityPlan }) {
  const structureRows = [
    ["Structure", plan.preferredStructure],
    ["Trigger", plan.trigger],
    ["Invalidation", plan.invalidation],
    ["Profit Plan", plan.target],
  ];

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold">{plan.symbol}</h2>
              <QualityBadge quality={plan.quality} />
              <span className="rounded border border-border bg-secondary px-2 py-0.5 text-[11px] capitalize text-muted-foreground">{plan.assetClass}</span>
              <AffordabilityBadge plan={plan} />
            </div>
            <div className="mt-1 text-sm text-muted-foreground">{plan.name}</div>
          </div>
          <div className="text-right">
            <div className="font-mono text-2xl font-bold">${plan.price.toLocaleString()}</div>
            <div className={`font-mono text-xs ${plan.changePct >= 0 ? "text-gain" : "text-loss"}`}>{plan.changePct >= 0 ? "+" : ""}{formatPct(plan.changePct)}</div>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <div>
            <div className="mb-1 flex justify-between text-[11px] text-muted-foreground">
              <span>Opportunity</span>
              <span className="font-mono">{plan.opportunityScore}</span>
            </div>
            <ScoreBar value={plan.opportunityScore} tone="gain" />
          </div>
          <div>
            <div className="mb-1 flex justify-between text-[11px] text-muted-foreground">
              <span>Risk Load</span>
              <span className="font-mono">{plan.riskScore}</span>
            </div>
            <ScoreBar value={plan.riskScore} tone={plan.riskScore > 60 ? "loss" : "warning"} />
          </div>
          <div>
            <div className="mb-1 flex justify-between text-[11px] text-muted-foreground">
              <span>Flow</span>
              <span className="font-mono">{plan.flowScore}</span>
            </div>
            <ScoreBar value={plan.flowScore} tone="accent" />
          </div>
          <div>
            <div className="mb-1 flex justify-between text-[11px] text-muted-foreground">
              <span>Liquidity</span>
              <span className="font-mono">{plan.volumeScore}</span>
            </div>
            <ScoreBar value={plan.volumeScore} tone="gain" />
          </div>
        </div>
        <div className="mt-4">
          <Week52Distance plan={plan} />
        </div>
        <TechnicalFramework plan={plan} />
      </div>

      <div className="grid gap-3 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <ListChecks className="h-4 w-4 text-primary" />
            Execution Plan
          </div>
          <div className="space-y-3">
            {structureRows.map(([label, value]) => (
              <div key={label} className="grid gap-1 border-b border-border/60 pb-3 last:border-b-0 last:pb-0 md:grid-cols-[120px_1fr]">
                <div className="text-[11px] uppercase text-muted-foreground">{label}</div>
                <div className="text-sm text-foreground">{value}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="h-4 w-4 text-gain" />
            Position Controls
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-md bg-secondary p-3">
              <div className="text-[11px] uppercase text-muted-foreground">Risk per trade</div>
              <div className="mt-1 font-mono text-lg font-bold">{formatPct(plan.positionRiskPct)}</div>
            </div>
            <div className="rounded-md bg-secondary p-3">
              <div className="text-[11px] uppercase text-muted-foreground">Max notional</div>
              <div className="mt-1 font-mono text-lg font-bold">{formatPct(plan.maxNotionalPct)}</div>
            </div>
            <div className="rounded-md bg-secondary p-3">
              <div className="text-[11px] uppercase text-muted-foreground">Min R:R</div>
              <div className="mt-1 font-mono text-lg font-bold">{plan.minRewardRisk.toFixed(1)}R</div>
            </div>
            <div className="rounded-md bg-secondary p-3">
              <div className="text-[11px] uppercase text-muted-foreground">Spread</div>
              <div className="mt-1 font-mono text-lg font-bold">{plan.spreadBps} bps</div>
            </div>
          </div>
          <div className="mt-3 space-y-2">
            {plan.notes.map((note) => (
              <div key={note} className="flex gap-2 text-xs text-muted-foreground">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                <span>{note}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function OptionsFlowPanel() {
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Zap className="h-4 w-4 text-warning" />
          Options & Futures Flow
        </div>
        <Bell className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="divide-y divide-border">
        {optionsFlow.map((row) => (
          <div key={`${row.time}-${row.symbol}`} className="grid grid-cols-[52px_52px_1fr] gap-2 px-3 py-2 text-xs">
            <span className="font-mono text-muted-foreground">{row.time}</span>
            <span className="font-mono font-bold">{row.symbol}</span>
            <div>
              <div className="flex items-center justify-between gap-2">
                <span>{row.side} {row.strike}</span>
                <span className="font-mono text-gain">{row.premium}</span>
              </div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">{row.expiry} / {row.signal}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RiskPanel() {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <SlidersHorizontal className="h-4 w-4 text-accent" />
        Efficiency Rules
      </div>
      <div className="space-y-2">
        {sessionRules.map((rule, idx) => (
          <div key={rule} className="flex items-start gap-2 text-xs text-muted-foreground">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-secondary font-mono text-[10px] text-foreground">{idx + 1}</span>
            <span>{rule}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 rounded-md border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
        This dashboard is a decision-support workspace, not financial advice. Use live data, broker risk checks, and your own trade plan before placing orders.
      </div>
    </div>
  );
}

function LiveDataPanel({
  snapshot,
  loading,
  onRefresh,
}: {
  snapshot: LiveDataSnapshot | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  const state = snapshot?.state ?? "connecting";
  const stateClass = state === "live"
    ? "border-gain/40 bg-gain/10 text-gain"
    : state === "degraded"
      ? "border-warning/40 bg-warning/10 text-warning"
      : state === "error"
        ? "border-loss/40 bg-loss/10 text-loss"
        : "border-border bg-secondary text-muted-foreground";
  const optionLiveCount = snapshot?.options.filter((quote) => quote.source !== "fallback").length ?? 0;
  const quoteRows: LiveQuote[] = [
    ...(snapshot?.options ?? []).slice(0, 4),
  ];

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Activity className="h-4 w-4 text-primary" />
            Live Options Feed
          </div>
          <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
            Polls configured options providers, then recalculates dashboard prices, spreads, IV, volume, and trade gates. Futures are paused for a later phase.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded border px-3 py-2 font-mono text-xs uppercase ${stateClass}`}>{loading ? "updating" : state.replace("_", " ")}</span>
          <button onClick={onRefresh} className="rounded-md border border-border bg-secondary p-2 text-muted-foreground hover:text-foreground" title="Refresh live data">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-md bg-secondary p-3">
          <div className="text-[11px] uppercase text-muted-foreground">Options source</div>
          <div className="mt-1 font-mono text-sm font-bold">{snapshot?.configured.polygon ? "Options provider configured" : "Not configured"}</div>
        </div>
        <div className="rounded-md bg-secondary p-3">
          <div className="text-[11px] uppercase text-muted-foreground">Futures phase</div>
          <div className="mt-1 font-mono text-sm font-bold">Paused</div>
        </div>
        <div className="rounded-md bg-secondary p-3">
          <div className="text-[11px] uppercase text-muted-foreground">Live contracts</div>
          <div className="mt-1 font-mono text-sm font-bold">{optionLiveCount} options</div>
        </div>
        <div className="rounded-md bg-secondary p-3">
          <div className="text-[11px] uppercase text-muted-foreground">Last update</div>
          <div className="mt-1 font-mono text-sm font-bold">{snapshot?.lastUpdated ? new Date(snapshot.lastUpdated).toLocaleTimeString() : "Pending"}</div>
        </div>
      </div>

      <div className="mt-4 grid gap-2 lg:grid-cols-2 xl:grid-cols-3">
        {quoteRows.map((quote) => (
          <div key={`${quote.source}-${quote.symbol}`} className="rounded-md border border-border bg-secondary p-3">
            <div className="mb-2 flex items-start justify-between gap-2">
              <div>
                <div className="font-mono text-sm font-bold">{quote.symbol}</div>
                <div className="text-[11px] uppercase text-muted-foreground">{quote.assetClass} / {quote.source}</div>
              </div>
              <div className={`font-mono text-xs ${quote.changePct >= 0 ? "text-gain" : "text-loss"}`}>{quote.changePct >= 0 ? "+" : ""}{quote.changePct.toFixed(2)}%</div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-[11px] text-muted-foreground">
              <div><span className="block uppercase">Price</span><span className="font-mono text-foreground">{quote.price ? quote.price.toFixed(2) : "N/A"}</span></div>
              <div><span className="block uppercase">Bid</span><span className="font-mono text-foreground">{quote.bid?.toFixed(2) ?? "N/A"}</span></div>
              <div><span className="block uppercase">Ask</span><span className="font-mono text-foreground">{quote.ask?.toFixed(2) ?? "N/A"}</span></div>
            </div>
          </div>
        ))}
      </div>

      {snapshot?.errors.length ? (
        <div className="mt-3 rounded-md border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
          {snapshot.errors.join(" | ")}
        </div>
      ) : null}

      {!snapshot?.configured.polygon && !snapshot?.configured.futuresProxy ? (
        <div className="mt-3 rounded-md border border-accent/25 bg-accent/10 p-3 text-xs text-accent">
          Add `VITE_ALPHA_VANTAGE_API_KEY` or `VITE_LIVE_DATA_PROXY_URL` for options snapshots.
        </div>
      ) : null}
    </div>
  );
}

function CompactLiveStatus({
  snapshot,
  loading,
  onRefresh,
}: {
  snapshot: LiveDataSnapshot | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  const state = snapshot?.state ?? "connecting";
  const stateClass = state === "live"
    ? "border-gain/40 bg-gain/10 text-gain"
    : state === "degraded"
      ? "border-warning/40 bg-warning/10 text-warning"
      : state === "error"
        ? "border-loss/40 bg-loss/10 text-loss"
        : "border-border bg-secondary text-muted-foreground";
  const optionLiveCount = snapshot?.options.filter((quote) => quote.source !== "fallback").length ?? 0;
  const errorCount = snapshot?.errors.length ?? 0;
  const catalystCount = snapshot?.catalysts.length ?? 0;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Activity className="h-4 w-4 text-primary" />
            Live Status
          </div>
          <div className={`mt-2 inline-flex rounded border px-2 py-1 font-mono text-[11px] uppercase ${stateClass}`}>
            {loading ? "updating" : state.replace("_", " ")}
          </div>
        </div>
        <button onClick={onRefresh} className="rounded-md border border-border bg-secondary p-2 text-muted-foreground hover:text-foreground" title="Refresh live data">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <div className="rounded bg-secondary p-2">
          <div className="text-muted-foreground">Contracts</div>
          <div className="font-mono text-foreground">{optionLiveCount} live</div>
        </div>
        <div className="rounded bg-secondary p-2">
          <div className="text-muted-foreground">Catalysts</div>
          <div className="font-mono text-foreground">{catalystCount ? `${catalystCount} live` : "none"}</div>
        </div>
        <div className="rounded bg-secondary p-2">
          <div className="text-muted-foreground">Updated</div>
          <div className="font-mono text-foreground">{snapshot?.lastUpdated ? new Date(snapshot.lastUpdated).toLocaleTimeString() : "Pending"}</div>
        </div>
      </div>

      {errorCount > 0 ? (
        <div className="mt-3 rounded-md border border-warning/30 bg-warning/10 p-2 text-xs text-warning">
          <div>Provider issue active. Use broker quotes before order entry.</div>
          <div className="mt-1 text-[11px] opacity-80">{snapshot?.errors[0]}</div>
        </div>
      ) : null}
    </div>
  );
}

function getMarketPhase() {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date());
    const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
    const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
    const mins = hour * 60 + minute;

    if (mins >= 8 * 60 + 30 && mins < 9 * 60 + 30) {
      return { label: "pre-open staging", detail: "Build watchlist, verify catalysts, do not place option entries yet.", action: "Stage only", tone: "warning" as const };
    }
    if (mins >= 9 * 60 + 30 && mins < 9 * 60 + 35) {
      return { label: "opening print", detail: "No chase. Let the first 5-minute range form and confirm spreads.", action: "Observe", tone: "warning" as const };
    }
    if (mins >= 9 * 60 + 35 && mins < 9 * 60 + 55) {
      return { label: "opening range", detail: "Only consider VWAP holds, opening-range breaks, and clean retests.", action: "Confirm trigger", tone: "accent" as const };
    }
    if (mins >= 9 * 60 + 55 && mins <= 10 * 60 + 10) {
      return { label: "10:00 spike window", detail: "High-probability decision window. Watch for continuation or reversal traps.", action: "Act only on confirmation", tone: "gain" as const };
    }
    if (mins > 10 * 60 + 10 && mins <= 10 * 60 + 30) {
      return { label: "open drive", detail: "Use live chain, VWAP, range acceptance, and spread checks before entry.", action: "Selective", tone: "gain" as const };
    }
    if (mins > 10 * 60 + 30 && mins <= 16 * 60) {
      return { label: "regular session", detail: "Favor confirmed setups and avoid late-chase premium expansion.", action: "Selective", tone: "accent" as const };
    }
    return { label: "off-hours", detail: "Prepare only. Regular-session option liquidity is not active.", action: "Prepare", tone: "default" as const };
  } catch {
    return { label: "market phase unknown", detail: "Verify the clock manually before trading.", action: "Manual clock check", tone: "warning" as const };
  }
}

function MarketOpenReadinessPanel({
  snapshot,
  movers,
  radarEvents,
  gate,
}: {
  snapshot: LiveDataSnapshot | null;
  movers: OptionMoverRow[];
  radarEvents: CatalystEvent[];
  gate: TradeGateResult;
}) {
  const liveContracts = snapshot?.options.filter((quote) => quote.source !== "fallback").length ?? 0;
  const liveCatalysts = snapshot?.catalysts.length ?? 0;
  const corroborated = radarEvents.filter((event) => (event.corroborationScore ?? event.sources?.length ?? 1) >= 2).length;
  const lowCostMovers = movers.filter((mover) => mover.contractCost >= 10 && mover.contractCost <= 50).length;
  const liveLowCostMovers = movers.filter((mover) => mover.source !== "modeled" && mover.contractCost >= 10 && mover.contractCost <= 50).length;
  const marketPhase = getMarketPhase();
  const snapshotAgeSeconds = snapshot?.lastUpdated ? Math.max(0, Math.round((Date.now() - new Date(snapshot.lastUpdated).getTime()) / 1000)) : undefined;
  const freshnessLimit = marketPhase.label === "pre-open staging" ? 180 : marketPhase.label === "off-hours" ? 600 : 90;
  const dataFresh = snapshotAgeSeconds !== undefined && snapshotAgeSeconds <= freshnessLimit;
  const phaseClass = marketPhase.tone === "gain"
    ? "border-gain/30 bg-gain/10 text-gain"
    : marketPhase.tone === "warning"
      ? "border-warning/30 bg-warning/10 text-warning"
      : marketPhase.tone === "accent"
        ? "border-accent/30 bg-accent/10 text-accent"
        : "border-border bg-secondary text-muted-foreground";
  const checks = [
    {
      label: "Data freshness",
      passed: dataFresh,
      detail: snapshotAgeSeconds === undefined ? "No data snapshot loaded yet" : `${snapshotAgeSeconds}s old, limit ${freshnessLimit}s for this phase`,
    },
    {
      label: "Catalyst feeds",
      passed: liveCatalysts > 0,
      detail: liveCatalysts ? `${liveCatalysts} live catalyst alerts loaded` : "No live catalyst feed yet",
    },
    {
      label: "Source confirmation",
      passed: corroborated > 0,
      detail: corroborated ? `${corroborated} alerts confirmed by 2+ sources` : "No multi-source confirmation yet",
    },
    {
      label: "$10-$50 candidates",
      passed: lowCostMovers > 0,
      detail: lowCostMovers ? `${lowCostMovers} live candidates in your cost band` : "No live candidates in the target contract-cost band",
    },
    {
      label: "Live option chain",
      passed: liveContracts > 0 && liveLowCostMovers > 0,
      detail: liveContracts ? `${liveContracts} live contracts, ${liveLowCostMovers} live low-cost candidates` : "No live option-chain contracts yet",
    },
    {
      label: "Selected trade gate",
      passed: gate.status !== "blocked",
      detail: gate.status === "blocked" ? "Selected setup is blocked by current rules" : `${gate.score}% gate score`,
    },
  ];
  const hardFails = checks.filter((check) => !check.passed).length;
  const status = hardFails === 0 ? "ready" : hardFails <= 2 ? "watch" : "not_ready";
  const statusClass = status === "ready"
    ? "border-gain/40 bg-gain/10 text-gain"
    : status === "watch"
      ? "border-warning/40 bg-warning/10 text-warning"
      : "border-loss/40 bg-loss/10 text-loss";
  const openProtocol = [
    { time: "8:30-9:29", label: "Stage", active: marketPhase.label === "pre-open staging" },
    { time: "9:30-9:34", label: "Observe", active: marketPhase.label === "opening print" },
    { time: "9:35-9:54", label: "Confirm", active: marketPhase.label === "opening range" },
    { time: "9:55-10:10", label: "Spike check", active: marketPhase.label === "10:00 spike window" },
  ];

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Open Readiness
          </div>
          <div className={`mt-2 inline-flex rounded border px-2 py-1 font-mono text-[11px] uppercase ${statusClass}`}>
            {status === "ready" ? "ready" : status === "watch" ? "watch only" : "not ready"}
          </div>
        </div>
        <div className="font-mono text-xs text-muted-foreground">{checks.length - hardFails}/{checks.length}</div>
      </div>

      <div className={`mb-3 rounded-md border px-2 py-2 text-xs ${phaseClass}`}>
        <div className="flex items-center justify-between gap-2">
          <div className="font-mono text-[10px] uppercase">{marketPhase.label}</div>
          <div className="font-mono text-[10px] uppercase">{marketPhase.action}</div>
        </div>
        <div className="mt-1 opacity-90">{marketPhase.detail}</div>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-1.5 text-[10px]">
        {openProtocol.map((step) => (
          <div
            key={step.time}
            className={`rounded border px-2 py-1 ${
              step.active ? "border-primary/30 bg-primary/10 text-primary" : "border-border bg-secondary text-muted-foreground"
            }`}
          >
            <div className="font-mono">{step.time}</div>
            <div className="uppercase">{step.label}</div>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        {checks.map((check) => (
          <div key={check.label} className="flex items-start gap-2 rounded-md border border-border bg-secondary p-2 text-xs">
            {check.passed ? (
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gain" />
            ) : (
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
            )}
            <div>
              <div className="font-medium">{check.label}</div>
              <div className="text-muted-foreground">{check.detail}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 rounded-md border border-warning/30 bg-warning/10 p-2 text-xs text-warning">
        Do not enter unless live prices are present. At the open, confirm bid/ask spread, volume, open interest, and fill quality in your broker first.
      </div>
    </div>
  );
}

function RuntimePerformanceReviewPanel({
  records,
  summary,
  onClear,
}: {
  records: RuntimeSignalRecord[];
  summary: ReturnType<typeof summarizeRuntimePerformance>;
  onClear: () => void;
}) {
  const status = summary.completed.length < 5
    ? "unverified"
    : summary.hitRate >= 55
      ? "effective"
      : summary.hitRate >= 45
        ? "mixed"
        : "weak";
  const statusClass = status === "effective"
    ? "border-gain/30 bg-gain/10 text-gain"
    : status === "mixed"
      ? "border-warning/30 bg-warning/10 text-warning"
      : status === "weak"
        ? "border-loss/30 bg-loss/10 text-loss"
        : "border-border bg-secondary text-muted-foreground";
  const recent = records.slice(0, 6);

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <BarChart3 className="h-4 w-4 text-primary" />
            Rolling 8-Day Bot Review
          </div>
          <div className={`mt-2 inline-flex rounded border px-2 py-1 font-mono text-[11px] uppercase ${statusClass}`}>
            {status}
          </div>
        </div>
        <button
          onClick={onClear}
          className="rounded-md border border-border bg-secondary px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground"
        >
          Reset
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded bg-secondary p-2">
          <div className="text-muted-foreground">Tracked</div>
          <div className="font-mono text-foreground">{records.length}</div>
        </div>
        <div className="rounded bg-secondary p-2">
          <div className="text-muted-foreground">Completed</div>
          <div className="font-mono text-foreground">{summary.completed.length}</div>
        </div>
        <div className="rounded bg-secondary p-2">
          <div className="text-muted-foreground">Hit rate</div>
          <div className={`font-mono ${summary.hitRate >= 55 ? "text-gain" : summary.completed.length ? "text-warning" : "text-muted-foreground"}`}>
            {summary.completed.length ? `${summary.hitRate}%` : "--"}
          </div>
        </div>
        <div className="rounded bg-secondary p-2">
          <div className="text-muted-foreground">Avg move</div>
          <div className={`font-mono ${summary.avgMovePct >= 0 ? "text-gain" : "text-loss"}`}>
            {summary.completed.length ? `${summary.avgMovePct >= 0 ? "+" : ""}${summary.avgMovePct.toFixed(1)}%` : "--"}
          </div>
        </div>
        <div className="rounded bg-secondary p-2">
          <div className="text-muted-foreground">Avg pop</div>
          <div className="font-mono text-gain">
            {summary.completed.length ? `+${Math.max(0, summary.avgFavorablePct).toFixed(1)}%` : "--"}
          </div>
        </div>
        <div className="rounded bg-secondary p-2">
          <div className="text-muted-foreground">Avg draw</div>
          <div className="font-mono text-loss">
            {summary.completed.length ? `${Math.min(0, summary.avgAdversePct).toFixed(1)}%` : "--"}
          </div>
        </div>
      </div>

      <div className="mt-3 space-y-1.5">
        {summary.byType.map((row) => (
          <div key={row.type} className="flex items-center justify-between rounded border border-border bg-secondary px-2 py-1 text-[10px]">
            <span className="capitalize text-muted-foreground">{row.type.replace(/_/g, " ")}</span>
            <span className="font-mono text-foreground">
              {row.count ? `${row.hitRate}% / ${row.count} / ${row.avgMovePct >= 0 ? "+" : ""}${row.avgMovePct.toFixed(1)}%` : "no results"}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-3 space-y-1.5">
        {summary.bySource.map((row) => (
          <div key={row.source} className="flex items-center justify-between rounded border border-border bg-secondary px-2 py-1 text-[10px]">
            <span className="truncate text-muted-foreground">{row.source}</span>
            <span className="font-mono text-foreground">{row.count ? `${row.hitRate}% / ${row.count}` : "no results"}</span>
          </div>
        ))}
      </div>

      <div className="mt-3 space-y-1.5">
        {(summary.recommendations.length ? summary.recommendations : ["No adaptive recommendation yet. Keep the app running until more signals complete."]).map((item) => (
          <div key={item} className="rounded-md border border-primary/20 bg-primary/10 p-2 text-[10px] text-primary">
            {item}
          </div>
        ))}
      </div>

      <div className="mt-3 rounded-md border border-border bg-secondary p-2 text-[10px] text-muted-foreground">
        {summary.completed.length < 5
          ? "Not enough completed runtime signals yet. Keep the app running through the open to verify accuracy."
          : summary.hitRate >= 55
            ? "Runtime evidence is positive so far, but still require live-chain and trigger confirmation."
            : "Runtime evidence is not strong enough yet. Reduce size, raise filters, or paper trade only."}
      </div>

      <div className="mt-3 space-y-1.5">
        {recent.length === 0 ? (
          <div className="rounded border border-border bg-secondary p-2 text-[10px] text-muted-foreground">
            No runtime records yet.
          </div>
        ) : recent.map((record) => {
          const movePct = recordMovePct(record);
          const favorablePct = recordMovePct(record, "bestPrice");
          const adversePct = recordMovePct(record, "worstPrice");
          const outcomeClass = record.outcome === "hit"
            ? "text-gain"
            : record.outcome === "miss"
              ? "text-loss"
              : record.outcome === "flat"
                ? "text-warning"
                : "text-muted-foreground";
          return (
            <div key={record.id} className="rounded border border-border bg-secondary p-2 text-[10px]">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-foreground">{record.symbol}</span>
                <span className={`font-mono uppercase ${outcomeClass}`}>{record.outcome}</span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-2 text-muted-foreground">
                <span>{record.label}</span>
                <span className={`font-mono ${movePct >= 0 ? "text-gain" : "text-loss"}`}>
                  {movePct >= 0 ? "+" : ""}{movePct.toFixed(1)}%
                </span>
              </div>
              <div className="mt-1 font-mono text-[9px] uppercase text-muted-foreground">
                {record.trackingBasis.replace("_", " ")} / {record.direction}
              </div>
              <div className="mt-1 flex items-center justify-between gap-2 font-mono text-[9px] text-muted-foreground">
                <span>best +{Math.max(0, favorablePct).toFixed(1)}%</span>
                <span>worst {Math.min(0, adversePct).toFixed(1)}%</span>
              </div>
              <div className="mt-1 font-mono text-[9px] text-muted-foreground">
                10m {record.move10mPct === undefined ? "--" : `${record.move10mPct >= 0 ? "+" : ""}${record.move10mPct.toFixed(1)}%`} / 30m {record.move30mPct === undefined ? "--" : `${record.move30mPct >= 0 ? "+" : ""}${record.move30mPct.toFixed(1)}%`} / close {record.moveClosePct === undefined ? "--" : `${record.moveClosePct >= 0 ? "+" : ""}${record.moveClosePct.toFixed(1)}%`}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AccuracyCalibrationPanel({ records, events }: { records: RuntimeSignalRecord[]; events: CatalystEvent[] }) {
  const calibration = calibrationSummary(records);
  const completed = records.filter((record) => record.outcome !== "tracking");
  const sourceRows = Array.from(new Set(events.flatMap((event) => event.sources?.length ? event.sources : ["Model"])))
    .map((source) => {
      const matching = events.filter((event) => source === "Model" ? !event.sources?.length : event.sources?.includes(source));
      const score = matching.length
        ? Math.round(matching.reduce((sum, event) => sum + sourceTrustScore(event, records), 0) / matching.length)
        : 0;
      return { source, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold"><Gauge className="h-4 w-4 text-primary" />Accuracy Calibration</div>
          <div className="mt-1 text-[10px] text-muted-foreground">Confidence must predict outcomes, not merely rank ideas.</div>
        </div>
        <span className={`rounded border px-2 py-1 font-mono text-[9px] uppercase ${calibration.trustworthy ? "border-gain/30 bg-gain/10 text-gain" : "border-warning/30 bg-warning/10 text-warning"}`}>
          {calibration.trustworthy ? "calibrated" : "collecting"}
        </span>
      </div>
      <div className="space-y-1.5">
        {calibration.buckets.map((bucket) => (
          <div key={bucket.label} className="flex items-center justify-between rounded border border-border bg-secondary px-2 py-1.5 text-[10px]">
            <span className="text-muted-foreground">{bucket.label}</span>
            <span className="font-mono">{bucket.count ? `${bucket.hitRate}% / ${bucket.count}` : "no outcomes"}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 rounded border border-border bg-secondary p-2 text-[10px] text-muted-foreground">
        {completed.length < 20
          ? `${completed.length}/20 completed signals. Keep accuracy claims unverified.`
          : calibration.calibrationGap !== undefined
            ? `High-confidence signals outperform low-confidence signals by ${calibration.calibrationGap} points.`
            : "Need outcomes in both high- and low-confidence buckets."}
      </div>
      <div className="mt-3 space-y-1">
        {sourceRows.map((row) => (
          <div key={row.source} className="flex items-center justify-between text-[10px]">
            <span className="truncate text-muted-foreground">{row.source}</span>
            <span className={`font-mono ${row.score >= 70 ? "text-gain" : row.score >= 50 ? "text-warning" : "text-loss"}`}>{row.score}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CompactRiskControls({
  settings,
  setSettings,
}: {
  settings: RiskSettings;
  setSettings: Dispatch<SetStateAction<RiskSettings>>;
}) {
  const update = (patch: Partial<RiskSettings>) => setSettings((current) => ({ ...current, ...patch }));

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <ShieldCheck className="h-4 w-4 text-gain" />
        Account Fit
      </div>
      <div className="grid gap-2 text-xs">
        <label className="grid gap-1">
          <span className="text-muted-foreground">Account size</span>
          <input
            type="number"
            min={500}
            step={100}
            value={settings.accountSize}
            onChange={(event) => update({ accountSize: Number(event.target.value) })}
            className="h-9 rounded-md border border-border bg-secondary px-2 font-mono text-foreground outline-none focus:border-primary"
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="grid gap-1">
            <span className="text-muted-foreground">Trade risk %</span>
            <input
              type="number"
              min={0.25}
              max={5}
              step={0.25}
              value={settings.maxTradeRiskPct}
              onChange={(event) => update({ maxTradeRiskPct: Number(event.target.value) })}
              className="h-9 rounded-md border border-border bg-secondary px-2 font-mono text-foreground outline-none focus:border-primary"
            />
          </label>
          <label className="grid gap-1">
            <span className="text-muted-foreground">Premium %</span>
            <input
              type="number"
              min={0.25}
              max={5}
              step={0.25}
              value={settings.maxPremiumRiskPct}
              onChange={(event) => update({ maxPremiumRiskPct: Number(event.target.value) })}
              className="h-9 rounded-md border border-border bg-secondary px-2 font-mono text-foreground outline-none focus:border-primary"
            />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="grid gap-1">
            <span className="text-muted-foreground">Min price</span>
            <input
              type="number"
              min={1}
              step={1}
              value={settings.minUnderlyingPrice}
              onChange={(event) => update({ minUnderlyingPrice: Number(event.target.value) })}
              className="h-9 rounded-md border border-border bg-secondary px-2 font-mono text-foreground outline-none focus:border-primary"
            />
          </label>
          <label className="grid gap-1">
            <span className="text-muted-foreground">Max price</span>
            <input
              type="number"
              min={5}
              step={5}
              value={settings.maxUnderlyingPrice}
              onChange={(event) => update({ maxUnderlyingPrice: Number(event.target.value) })}
              className="h-9 rounded-md border border-border bg-secondary px-2 font-mono text-foreground outline-none focus:border-primary"
            />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="grid gap-1">
            <span className="text-muted-foreground">Min quote</span>
            <input
              type="number"
              min={0.01}
              max={1}
              step={0.01}
              value={settings.minOptionPremium}
              onChange={(event) => update({ minOptionPremium: Number(event.target.value) })}
              className="h-9 rounded-md border border-border bg-secondary px-2 font-mono text-foreground outline-none focus:border-primary"
            />
          </label>
          <label className="grid gap-1">
            <span className="text-muted-foreground">Max quote</span>
            <input
              type="number"
              min={0.05}
              max={10}
              step={0.05}
              value={settings.maxOptionPremium}
              onChange={(event) => update({ maxOptionPremium: Number(event.target.value) })}
              className="h-9 rounded-md border border-border bg-secondary px-2 font-mono text-foreground outline-none focus:border-primary"
            />
          </label>
        </div>
      </div>
    </div>
  );
}

function StrategyAdvisorPanel({ selected }: { selected: OpportunityPlan }) {
  const matching = strategyPlaybook.filter((item) => item.assetClass === selected.assetClass || item.stance === selected.bias);
  const primary = matching[0] ?? strategyPlaybook[0];
  const supporting = strategyPlaybook.filter((item) => item.name !== primary.name).slice(0, 3);
  const advisorTone = selected.quality === "A"
    ? "Prioritize this setup only if trigger confirms."
    : selected.quality === "B"
      ? "Good candidate, but wait for confirmation before sizing."
      : selected.quality === "C"
        ? "Scout only or skip unless conditions improve."
        : "Avoid until risk and liquidity improve.";

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="h-4 w-4 text-primary" />
            Evidence-Based Strategy Advisor
          </div>
          <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
            Uses current dashboard conditions plus historical strategy research. It is decision support, not a promise of profit or individualized financial advice.
          </p>
        </div>
        <span className="rounded border border-primary/30 bg-primary/10 px-2 py-1 font-mono text-[10px] text-primary">
          current review: May 30, 2026
        </span>
      </div>

      <div className="grid gap-3 xl:grid-cols-[1fr_0.9fr]">
        <div className="rounded-lg border border-border bg-secondary p-4">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="rounded border border-border bg-card px-2 py-0.5 text-[11px] uppercase text-muted-foreground">{primary.assetClass}</span>
            <span className={`rounded border px-2 py-0.5 text-[11px] capitalize ${
              primary.stance === "bullish" ? "border-gain/30 bg-gain/10 text-gain" : primary.stance === "bearish" ? "border-loss/30 bg-loss/10 text-loss" : "border-warning/30 bg-warning/10 text-warning"
            }`}>
              {primary.stance}
            </span>
            <span className="rounded border border-accent/30 bg-accent/10 px-2 py-0.5 text-[11px] text-accent">{primary.evidenceLevel}</span>
          </div>
          <h3 className="text-lg font-bold">{primary.name}</h3>
          <div className="mt-3 grid gap-3 text-sm md:grid-cols-2">
            <div>
              <div className="text-[11px] uppercase text-muted-foreground">Use when</div>
              <p className="mt-1">{primary.marketUse}</p>
            </div>
            <div>
              <div className="text-[11px] uppercase text-muted-foreground">Setup</div>
              <p className="mt-1">{primary.setup}</p>
            </div>
            <div>
              <div className="text-[11px] uppercase text-muted-foreground">Why it can work</div>
              <p className="mt-1">{primary.whyItCanWork}</p>
            </div>
            <div>
              <div className="text-[11px] uppercase text-muted-foreground">Risk control</div>
              <p className="mt-1">{primary.riskControl}</p>
            </div>
          </div>
          <div className="mt-3 rounded-md border border-loss/25 bg-loss/10 p-3 text-xs text-loss">
            Avoid: {primary.avoidWhen}
          </div>
        </div>

        <div className="space-y-3">
          <div className="rounded-lg border border-border bg-secondary p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <Gauge className="h-4 w-4 text-accent" />
              Advisor Read
            </div>
            <div className="space-y-2 text-xs text-muted-foreground">
              <div className="flex justify-between gap-3"><span>Selected setup</span><span className="font-mono text-foreground">{selected.symbol} / {selected.quality}</span></div>
              <div className="flex justify-between gap-3"><span>Strategy posture</span><span className="font-mono text-foreground capitalize">{selected.bias}</span></div>
              <div className="flex justify-between gap-3"><span>Minimum R:R</span><span className="font-mono text-foreground">{selected.minRewardRisk.toFixed(1)}R</span></div>
              <div className="flex justify-between gap-3"><span>Risk suggestion</span><span className="font-mono text-foreground">{selected.positionRiskPct.toFixed(2)}%</span></div>
            </div>
            <div className="mt-3 rounded-md border border-primary/25 bg-primary/10 p-3 text-xs text-primary">{advisorTone}</div>
          </div>

          <div className="rounded-lg border border-border bg-secondary p-4">
            <div className="mb-2 text-sm font-semibold">Alternative Playbooks</div>
            <div className="space-y-2">
              {supporting.map((item: StrategyPlaybook) => (
                <div key={item.name} className="rounded-md border border-border bg-card p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{item.name}</span>
                    <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">{item.evidenceLevel}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{item.marketUse}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StrategyLabPanel({ selected }: { selected: OpportunityPlan }) {
  const backtest = useMemo(() => runModeledBacktest(selected, 80), [selected]);
  const scenario = useMemo(() => buildScenarioCurve(selected), [selected]);
  const edgeTone = backtest.edgeScore >= 74 ? "text-gain" : backtest.edgeScore >= 58 ? "text-warning" : "text-loss";

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Beaker className="h-4 w-4 text-accent" />
            Strategy Lab
          </div>
          <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
            Modeled historical test and scenario map for the selected setup. Use it to reject weak ideas before risking capital.
          </p>
        </div>
        <div className={`font-mono text-2xl font-bold ${edgeTone}`}>{backtest.edgeScore}/100</div>
      </div>

      <div className="mb-4 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Metric label="Sample" value={`${backtest.sampleSize}`} icon={BarChart3} tone="default" />
        <Metric label="Win rate" value={formatPct(backtest.winRate)} icon={Target} tone={backtest.winRate >= 52 ? "gain" : "warning"} />
        <Metric label="Expectancy" value={`${backtest.expectancyR.toFixed(2)}R`} icon={TrendingUp} tone={backtest.expectancyR > 0 ? "gain" : "loss"} />
        <Metric label="Profit factor" value={backtest.profitFactor.toFixed(2)} icon={Gauge} tone={backtest.profitFactor >= 1.35 ? "gain" : "warning"} />
        <Metric label="Max DD" value={`${backtest.maxDrawdownR.toFixed(2)}R`} icon={TrendingDown} tone={backtest.maxDrawdownR > 8 ? "loss" : "warning"} />
        <Metric label="Avg win/loss" value={`${backtest.avgWinR.toFixed(2)}R/${backtest.avgLossR.toFixed(2)}R`} icon={SlidersHorizontal} tone="accent" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-lg border border-border bg-secondary p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-semibold">Modeled Equity Curve</div>
            <span className="rounded border border-border bg-card px-2 py-0.5 text-[10px] text-muted-foreground">{backtest.verdict}</span>
          </div>
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={backtest.equityCurve} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="trade" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} axisLine={false} tickLine={false} width={42} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 12 }} />
                <Area type="monotone" dataKey="equityR" stroke="hsl(var(--gain))" fill="hsl(var(--gain) / 0.12)" strokeWidth={2} />
                <Line type="monotone" dataKey="drawdownR" stroke="hsl(var(--loss))" dot={false} strokeDasharray="4 4" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-secondary p-4">
          <div className="mb-3 text-sm font-semibold">Scenario Return Map</div>
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={scenario} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="movePct" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
                <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} axisLine={false} tickLine={false} width={42} tickFormatter={(v) => `${v}%`} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 12 }} formatter={(value: number) => `${value.toFixed(1)}%`} />
                <Line type="monotone" dataKey="optionReturn" stroke="hsl(var(--accent))" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="futuresReturn" stroke="hsl(var(--warning))" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="stockReturn" stroke="hsl(var(--gain))" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-muted-foreground">
            <span className="rounded bg-card px-2 py-1 text-accent">Options</span>
            <span className="rounded bg-card px-2 py-1 text-warning">Futures</span>
            <span className="rounded bg-card px-2 py-1 text-gain">Stock</span>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-lg border border-border bg-secondary p-4">
          <div className="mb-3 text-sm font-semibold">Regime Breakdown</div>
          <div className="space-y-3">
            {backtest.regimeStats.map((regime) => (
              <div key={regime.regime}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="capitalize text-muted-foreground">{regime.regime} / {regime.trades} trades</span>
                  <span className={`font-mono ${regime.expectancyR >= 0 ? "text-gain" : "text-loss"}`}>{regime.expectancyR.toFixed(2)}R</span>
                </div>
                <ScoreBar value={regime.winRate} tone={regime.expectancyR >= 0 ? "gain" : "loss"} />
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-secondary p-4">
          <div className="mb-3 text-sm font-semibold">Recent Modeled Trades</div>
          <div className="grid gap-2 md:grid-cols-2">
            {backtest.recentTrades.map((trade) => (
              <div key={trade.id} className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-xs">
                <div>
                  <div className="font-mono text-foreground">#{trade.id} {trade.regime}</div>
                  <div className="text-[11px] text-muted-foreground">{trade.duration}</div>
                </div>
                <span className={`font-mono font-bold ${trade.resultR >= 0 ? "text-gain" : "text-loss"}`}>
                  {trade.resultR >= 0 ? "+" : ""}{trade.resultR.toFixed(2)}R
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function SeriousTradingControls({
  selected,
  riskSettings,
  setRiskSettings,
  strategyRules,
  setStrategyRules,
}: {
  selected: OpportunityPlan;
  riskSettings: RiskSettings;
  setRiskSettings: (settings: RiskSettings) => void;
  strategyRules: StrategyRuleSet;
  setStrategyRules: (rules: StrategyRuleSet) => void;
}) {
  const backtest = useMemo(() => runModeledBacktest(selected, 80), [selected]);
  const gate = useMemo(
    () => evaluateTradeGate(selected, backtest, riskSettings, strategyRules),
    [selected, backtest, riskSettings, strategyRules]
  );
  const statusClass = gate.status === "approved"
    ? "border-gain/40 bg-gain/10 text-gain"
    : gate.status === "wait"
      ? "border-warning/40 bg-warning/10 text-warning"
      : "border-loss/40 bg-loss/10 text-loss";

  const updateRisk = (patch: Partial<RiskSettings>) => setRiskSettings({ ...riskSettings, ...patch });
  const updateRules = (patch: Partial<StrategyRuleSet>) => setStrategyRules({ ...strategyRules, ...patch });

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Serious Trading Controls
          </div>
          <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
            Hard risk settings, rule-based strategy filters, and a pre-trade gate for the selected setup.
          </p>
        </div>
        <div className={`rounded border px-3 py-2 text-right ${statusClass}`}>
          <div className="text-[10px] uppercase">Trade Gate</div>
          <div className="font-mono text-xl font-bold uppercase">{gate.status}</div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="space-y-3">
          <div className="rounded-lg border border-border bg-secondary p-4">
            <div className="mb-3 text-sm font-semibold">Account & Risk Settings</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs text-muted-foreground">
                Account size
                <input
                  type="number"
                  min={1000}
                  step={1000}
                  value={riskSettings.accountSize}
                  onChange={(event) => updateRisk({ accountSize: Number(event.target.value) || 0 })}
                  className="w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-sm text-foreground"
                />
              </label>
              <label className="space-y-1 text-xs text-muted-foreground">
                Max daily loss %
                <input
                  type="number"
                  min={0.1}
                  step={0.1}
                  value={riskSettings.maxDailyLossPct}
                  onChange={(event) => updateRisk({ maxDailyLossPct: Number(event.target.value) || 0 })}
                  className="w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-sm text-foreground"
                />
              </label>
              <label className="space-y-1 text-xs text-muted-foreground">
                Max risk/trade %
                <input
                  type="number"
                  min={0.1}
                  step={0.05}
                  value={riskSettings.maxTradeRiskPct}
                  onChange={(event) => updateRisk({ maxTradeRiskPct: Number(event.target.value) || 0 })}
                  className="w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-sm text-foreground"
                />
              </label>
              <label className="space-y-1 text-xs text-muted-foreground">
                Min edge score
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={riskSettings.minEdgeScore}
                  onChange={(event) => updateRisk({ minEdgeScore: Number(event.target.value) || 0 })}
                  className="w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-sm text-foreground"
                />
              </label>
              <label className="space-y-1 text-xs text-muted-foreground">
                Max option spread bps
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={riskSettings.maxOptionsSpreadBps}
                  onChange={(event) => updateRisk({ maxOptionsSpreadBps: Number(event.target.value) || 0 })}
                  className="w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-sm text-foreground"
                />
              </label>
              <label className="space-y-1 text-xs text-muted-foreground">
                Block event risk above
                <input
                  type="number"
                  min={1}
                  max={100}
                  step={1}
                  value={riskSettings.blockEventRiskAbove}
                  onChange={(event) => updateRisk({ blockEventRiskAbove: Number(event.target.value) || 0 })}
                  className="w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-sm text-foreground"
                />
              </label>
              <label className="space-y-1 text-xs text-muted-foreground">
                Min stock price
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={riskSettings.minUnderlyingPrice}
                  onChange={(event) => updateRisk({ minUnderlyingPrice: Number(event.target.value) || 0 })}
                  className="w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-sm text-foreground"
                />
              </label>
              <label className="space-y-1 text-xs text-muted-foreground">
                Max stock price
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={riskSettings.maxUnderlyingPrice}
                  onChange={(event) => updateRisk({ maxUnderlyingPrice: Number(event.target.value) || 0 })}
                  className="w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-sm text-foreground"
                />
              </label>
              <label className="space-y-1 text-xs text-muted-foreground">
                Min volume score
                <input
                  type="number"
                  min={1}
                  max={100}
                  step={1}
                  value={riskSettings.minVolumeScore}
                  onChange={(event) => updateRisk({ minVolumeScore: Number(event.target.value) || 0 })}
                  className="w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-sm text-foreground"
                />
              </label>
              <label className="space-y-1 text-xs text-muted-foreground">
                Min DTE
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={riskSettings.minDte}
                  onChange={(event) => updateRisk({ minDte: Number(event.target.value) || 0 })}
                  className="w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-sm text-foreground"
                />
              </label>
              <label className="space-y-1 text-xs text-muted-foreground">
                Max premium risk %
                <input
                  type="number"
                  min={0.1}
                  step={0.1}
                  value={riskSettings.maxPremiumRiskPct}
                  onChange={(event) => updateRisk({ maxPremiumRiskPct: Number(event.target.value) || 0 })}
                  className="w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-sm text-foreground"
                />
              </label>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-secondary p-4">
            <div className="mb-3 text-sm font-semibold">Strategy Rule Builder</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs text-muted-foreground">
                Minimum setup quality
                <select
                  value={strategyRules.requireQuality}
                  onChange={(event) => updateRules({ requireQuality: event.target.value as StrategyRuleSet["requireQuality"] })}
                  className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground"
                >
                  <option value="A">A only</option>
                  <option value="B">B or better</option>
                  <option value="C">C or better</option>
                </select>
              </label>
              {[
                ["requireTrendConfirmation", "Require trend confirmation"],
                ["requireFlowConfirmation", "Require flow confirmation"],
                ["requireLiquidity", "Require liquidity filter"],
                ["requireRiskReward", "Require reward/risk"],
                ["requireNoEventRisk", "Require event-risk pass"],
                ["require52WeekContext", "Require 52W context"],
              ].map(([key, label]) => (
                <label key={key} className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2 text-xs text-foreground">
                  <span>{label}</span>
                  <input
                    type="checkbox"
                    checked={Boolean(strategyRules[key as keyof StrategyRuleSet])}
                    onChange={(event) => updateRules({ [key]: event.target.checked } as Partial<StrategyRuleSet>)}
                    className="h-4 w-4 accent-primary"
                  />
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-secondary p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="text-sm font-semibold">Pre-Trade Execution Gate</div>
            <div className="font-mono text-xs text-muted-foreground">{gate.score}% passed</div>
          </div>
          <div className="mb-3 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-md bg-card p-3">
              <div className="text-[11px] uppercase text-muted-foreground">Suggested risk</div>
              <div className="mt-1 font-mono text-lg font-bold">${gate.suggestedDollarRisk.toLocaleString()}</div>
            </div>
            <div className="rounded-md bg-card p-3">
              <div className="text-[11px] uppercase text-muted-foreground">Daily loss lock</div>
              <div className="mt-1 font-mono text-lg font-bold">${gate.maxDailyLoss.toLocaleString()}</div>
            </div>
          </div>
          <div className="space-y-2">
            {gate.checks.map((check) => (
              <div key={check.label} className="flex items-start gap-3 rounded-md border border-border bg-card p-3">
                {check.passed ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-gain" />
                ) : (
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-loss" />
                )}
                <div className="min-w-0">
                  <div className="text-sm font-medium">{check.label}</div>
                  <div className="text-xs text-muted-foreground">{check.detail}</div>
                </div>
              </div>
            ))}
          </div>
          <div className={`mt-3 rounded-md border p-3 text-xs ${statusClass}`}>
            {gate.status === "approved"
              ? "Approved for consideration: trigger, bracket, and broker checks still required."
              : gate.status === "wait"
                ? "Wait: conditions are close, but one or more soft filters need confirmation."
                : "Blocked: do not take this setup under the current rules."}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DerivativesDashboard() {
  const [filter, setFilter] = useState<AssetClass | "all">("option");
  const [manualSelection, setManualSelection] = useState(false);
  const [riskSettings, setRiskSettings] = useState<RiskSettings>(defaultRiskSettings);
  const [strategyRules, setStrategyRules] = useState<StrategyRuleSet>(defaultStrategyRules);
  const { snapshot, loading: liveLoading, refresh: refreshLiveData } = useLiveMarketData();
  const allPlans = snapshot?.mergedPlans ?? EMPTY_PLANS;
  const filteredPlans = useMemo(() => {
    const base = allPlans.filter((plan) => filter === "all" || plan.assetClass === filter);
    if (filter !== "option") return base;
    const affordable = base.filter((plan) =>
      plan.price >= riskSettings.minUnderlyingPrice &&
      plan.price <= riskSettings.maxUnderlyingPrice
    );
    const screened = affordable.filter((plan) =>
      plan.volumeScore >= riskSettings.minVolumeScore &&
      plan.spreadBps <= riskSettings.maxOptionsSpreadBps
    );
    return screened.length >= 5 ? screened : affordable.length ? affordable : base;
  }, [allPlans, filter, riskSettings.maxOptionsSpreadBps, riskSettings.maxUnderlyingPrice, riskSettings.minUnderlyingPrice, riskSettings.minVolumeScore]);
  const [selected, setSelected] = useState<OpportunityPlan>(filteredPlans[0] ?? rankedPlans[0]);
  const radarEvents = snapshot?.catalysts ?? EMPTY_CATALYSTS;
  const optionMovers = useMemo(() => buildOptionMoverRows(allPlans, snapshot, riskSettings, radarEvents), [allPlans, snapshot, riskSettings, radarEvents]);
  const dipReboundRows = useMemo(() => buildDipReboundRows(optionMovers, riskSettings), [optionMovers, riskSettings]);
  const marketWideRadarRows = useMemo(() => buildMarketWideRadarRows(allPlans, radarEvents, optionMovers, riskSettings), [allPlans, radarEvents, optionMovers, riskSettings]);
  const lastEventRadarAlert = useEventRadarAlerts(marketWideRadarRows);
  const preBoomTickers = useMemo(() => buildPreBoomTickers(optionMovers), [optionMovers]);
  const preBoomContext = useMemo(
    () => buildPreBoomContext(optionMovers, radarEvents, riskSettings, strategyRules),
    [optionMovers, radarEvents, riskSettings, strategyRules]
  );
  const {
    alerts: preBoomAlerts,
    dismissAlert: dismissPreBoomAlert,
    totalScanned: preBoomTotalScanned,
    totalEvaluated: preBoomTotalEvaluated,
    lastScanAt: preBoomLastScanAt,
    activeSpikeWindow: preBoomActiveSpikeWindow,
    nextSpikeWindow: preBoomNextSpikeWindow,
  } = usePreBoomScanner(preBoomTickers, filter === "option", {
    minPrice: 0.5,
    maxPrice: 1000,
    minOptionPremium: riskSettings.minOptionPremium,
    maxOptionPremium: riskSettings.maxOptionPremium,
    requireOptionBudgetFit: true,
    minScoreRegular: 46,
    minScorePremarket: 30,
    contextBySymbol: preBoomContext,
  });
  const preBoomSymbols = useMemo(() => new Set(preBoomAlerts.map((alert) => alert.symbol)), [preBoomAlerts]);
  const missedRunnerRows = useMemo(
    () => buildMissedRunnerRows(radarEvents, allPlans, optionMovers, preBoomSymbols, riskSettings),
    [allPlans, optionMovers, preBoomSymbols, radarEvents, riskSettings]
  );
  const orderedPlans = filter === "option" ? optionMovers.map((mover) => mover.plan) : filteredPlans;
  const visibleSelected = orderedPlans.find((plan) => plan.symbol === selected.symbol) ?? orderedPlans[0] ?? filteredPlans[0] ?? allPlans[0] ?? rankedPlans[0];
  const hasLivePlans = allPlans.length > 0;
  const liveTape = useMemo(
    () => [...(snapshot?.options ?? EMPTY_QUOTES), ...(snapshot?.futures ?? EMPTY_QUOTES)]
      .filter((quote) => quote.price > 0)
      .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
      .slice(0, 8),
    [snapshot?.futures, snapshot?.options]
  );
  const exactOptionsSignal = useMemo(
    () => buildExactOptionsSignal(visibleSelected, riskSettings, strategyRules, snapshot),
    [riskSettings, snapshot, strategyRules, visibleSelected]
  );
  const signalCommandRows = useMemo(
    () => buildSignalCommandRows({
      selected: visibleSelected,
      movers: optionMovers,
      radarRows: marketWideRadarRows,
      dipRows: dipReboundRows,
      settings: riskSettings,
      rules: strategyRules,
      snapshot,
    }),
    [dipReboundRows, marketWideRadarRows, optionMovers, riskSettings, snapshot, strategyRules, visibleSelected]
  );
  const defenseRows = useMemo(() => buildDefenseRows(signalCommandRows), [signalCommandRows]);
  const automationQueueRows = useMemo(
    () => buildAutomationQueue({
      commandRows: signalCommandRows,
      preBoomAlerts,
      radarRows: marketWideRadarRows,
      snapshot,
    }),
    [marketWideRadarRows, preBoomAlerts, signalCommandRows, snapshot]
  );
  const runtimeSignalCandidates = useMemo<RuntimeSignalCandidate[]>(() => {
    const reasoning = buildOptionReasoningReport(visibleSelected, riskSettings, strategyRules);
    const reasoningPrice = reasoning.bestContract?.estimatedPremium ?? visibleSelected.price;
    return [
      ...optionMovers
        .filter((mover) => mover.score >= 60)
        .slice(0, 5)
        .map((mover): RuntimeSignalCandidate => ({
          type: "mover",
          symbol: mover.plan.symbol,
          price: mover.source === "modeled" ? mover.plan.price : mover.optionQuote,
          score: mover.score,
          label: "biggest mover",
          source: mover.source === "modeled" ? "underlying confirmation" : mover.source,
          direction: mover.source === "modeled" && mover.plan.bias === "bearish" ? "down" : "up",
          trackingBasis: mover.source === "modeled" ? "underlying" : "option_premium",
        })),
      ...dipReboundRows.map((row): RuntimeSignalCandidate => ({
        type: "dip_rebound",
        symbol: row.plan.symbol,
        price: row.source === "modeled" ? row.plan.price : row.optionQuote,
        score: row.reboundScore,
        label: "dip rebound",
        source: row.source === "modeled" ? "underlying confirmation" : row.source,
        direction: "up",
        trackingBasis: row.source === "modeled" ? "underlying" : "option_premium",
      })),
      ...preBoomAlerts.map((alert): RuntimeSignalCandidate => {
        const plan = allPlans.find((candidate) => candidate.symbol === alert.symbol || planRoot(candidate.symbol) === alert.symbol);
        const mover = optionMovers.find((candidate) => candidate.plan.symbol === alert.symbol || planRoot(candidate.plan.symbol) === alert.symbol);
        const hasLiveOptionQuote = Boolean(alert.optionQuote && mover?.source !== "modeled");
        return {
          type: "preboom",
          symbol: alert.symbol,
          price: hasLiveOptionQuote ? alert.optionQuote ?? alert.price : alert.price,
          score: alert.score,
          label: "pre-boom alert",
          source: hasLiveOptionQuote ? "live option" : "underlying confirmation",
          direction: hasLiveOptionQuote ? "up" : plan?.bias === "bearish" ? "down" : "up",
          trackingBasis: hasLiveOptionQuote ? "option_premium" : "underlying",
        };
      }),
      ...marketWideRadarRows
        .filter((row) => row.stage !== "discovery" && row.plan)
        .slice(0, 4)
        .map((row): RuntimeSignalCandidate => ({
          type: "event_radar",
          symbol: row.symbol,
          price: row.plan?.price ?? 0,
          score: row.score,
          label: row.stage.replace("_", " "),
          source: row.event?.sources?.join(" + ") || "event radar",
          direction: "up",
          trackingBasis: "underlying",
        })),
      ...(reasoning.verdict !== "skip" && reasoning.score >= 58 && exactOptionsSignal.brokerVerified
        ? [{
          type: "reasoning" as const,
          symbol: visibleSelected.symbol,
          price: reasoningPrice,
          score: reasoning.score,
          label: reasoning.verdict.replace(/_/g, " "),
          source: "reasoning",
          direction: "up" as const,
          trackingBasis: "option_premium" as const,
        }]
        : []),
      ...(exactOptionsSignal.brokerVerified && exactOptionsSignal.entryDebit > 0
        ? [{
          type: "reasoning" as const,
          symbol: visibleSelected.symbol,
          price: exactOptionsSignal.entryDebit,
          score: exactOptionsSignal.confidence,
          label: `exact ${exactSignalLabel(exactOptionsSignal.signal).toLowerCase()}`,
          source: "exact options signal",
          direction: "up" as const,
          trackingBasis: "option_premium" as const,
        }]
        : []),
      ...signalCommandRows
        .filter((row) => row.signal.brokerVerified && row.signal.entryDebit > 0)
        .slice(0, 4)
        .map((row): RuntimeSignalCandidate => ({
          type: "reasoning",
          symbol: row.plan.symbol,
          price: row.signal.entryDebit,
          score: row.rankScore,
          label: `command ${exactSignalLabel(row.signal.signal).toLowerCase()}`,
          source: row.source,
          direction: "up",
          trackingBasis: "option_premium",
        })),
    ];
  }, [allPlans, dipReboundRows, exactOptionsSignal, marketWideRadarRows, optionMovers, preBoomAlerts, riskSettings, signalCommandRows, strategyRules, visibleSelected]);
  const runtimePerformance = useRuntimeSignalPerformance(runtimeSignalCandidates);
  const intelligenceMemory = useIntelligenceMemory(marketWideRadarRows, missedRunnerRows, runtimePerformance.records);

  const averageEfficiency = filteredPlans.length
    ? Math.round(filteredPlans.reduce((sum, plan) => sum + plan.efficiencyScore, 0) / filteredPlans.length)
    : 0;
  const topMover = optionMovers[0];
  const compactGate = evaluateTradeGate(
    visibleSelected,
    runModeledBacktest(visibleSelected, 80),
    riskSettings,
    strategyRules
  );
  const selectPlan = (plan: OpportunityPlan) => {
    setManualSelection(true);
    setSelected(plan);
  };
  const selectPreBoomSymbol = (symbol: string) => {
    const plan = allPlans.find((candidate) => candidate.symbol === symbol || planRoot(candidate.symbol) === symbol);
    if (plan) selectPlan(plan);
  };

  useEffect(() => {
    if (filter === "option" && topMover && !manualSelection && selected.symbol !== topMover.plan.symbol) {
      setSelected(topMover.plan);
    }
  }, [filter, manualSelection, selected.symbol, topMover]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 px-3 py-2 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15">
              <Layers3 className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h1 className="text-base font-bold leading-tight">Market Muse Derivatives Focus</h1>
              <div className="text-[11px] text-muted-foreground">Affordable options, defined risk, and stock confirmation</div>
            </div>
          </div>
          <div className="flex max-w-full items-center gap-2 overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                aria-label={`${tab.label} filter`}
                onClick={() => {
                  setManualSelection(false);
                  setFilter(tab.id);
                }}
                className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                  filter === tab.id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-secondary text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.label}
              </button>
            ))}
            <button
              type="button"
              onClick={refreshLiveData}
              disabled={liveLoading}
              className="rounded-md border border-border bg-card p-1.5 text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
              title="Refresh live market data"
            >
              <RefreshCw className={`h-4 w-4 ${liveLoading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
          {liveTape.map((item) => (
            <div key={item.symbol} className="flex min-w-fit items-center gap-2 rounded border border-border bg-card px-2 py-1 text-xs">
              <span className="font-mono font-bold">{item.symbol}</span>
              <span className="font-mono text-foreground">{item.price.toFixed(2)}</span>
              <span className={`font-mono ${item.changePct >= 0 ? "text-gain" : "text-loss"}`}>{item.changePct >= 0 ? "+" : ""}{item.changePct.toFixed(2)}%</span>
            </div>
          ))}
          {!liveTape.length ? <div className="text-xs text-muted-foreground">No live contracts loaded</div> : null}
        </div>
      </header>

      <main className="grid gap-3 p-3 xl:grid-cols-[320px_1fr_300px]">
        <aside className="space-y-3 xl:sticky xl:top-[104px] xl:self-start">
          <div className="grid grid-cols-2 gap-2">
            <Metric label="Top Move" value={topMover ? `${topMover.plan.symbol} ${topMover.movePct >= 0 ? "+" : ""}${topMover.movePct.toFixed(1)}%` : "No live candidate"} icon={Zap} tone="warning" />
            <Metric label="Avg Edge" value={`${averageEfficiency}`} icon={Gauge} tone="accent" />
          </div>
          <PreBoomAlerts
            alerts={preBoomAlerts}
            onDismiss={dismissPreBoomAlert}
            onSelect={selectPreBoomSymbol}
            totalScanned={preBoomTotalScanned}
            totalEvaluated={preBoomTotalEvaluated}
            lastScanAt={preBoomLastScanAt}
            activeSpikeWindow={preBoomActiveSpikeWindow}
            nextSpikeWindow={preBoomNextSpikeWindow}
          />
          {hasLivePlans && filter === "option" && <MarketWideRadarPanel rows={marketWideRadarRows} selected={visibleSelected} lastAlert={lastEventRadarAlert} onSelect={selectPlan} />}
          {hasLivePlans && filter === "option" && <DipReboundList rows={dipReboundRows} selected={visibleSelected} onSelect={selectPlan} />}
          {hasLivePlans && filter === "option" && <NewsDiscoveryPanel plans={allPlans} events={radarEvents} selected={visibleSelected} onSelect={selectPlan} />}
          {hasLivePlans && (filter === "option" ? (
            <OptionMoverList movers={optionMovers} selected={visibleSelected} onSelect={selectPlan} />
          ) : (
            <OptionMoverList movers={buildOptionMoverRows(filteredPlans, snapshot, riskSettings, radarEvents)} selected={visibleSelected} onSelect={selectPlan} />
          ))}
          <CatalystRadarPanel events={radarEvents} plans={allPlans} liveCount={snapshot?.catalysts.length ?? 0} onSelect={selectPlan} />
        </aside>

        <section className="space-y-3">
          {hasLivePlans ? (
            <>
              {filter === "option" && <SignalCommandCenter rows={signalCommandRows} selected={visibleSelected} onSelect={selectPlan} />}
              <PlanDetail plan={visibleSelected} />
              <OptionReasoningPanel plan={visibleSelected} settings={riskSettings} rules={strategyRules} />
              <ExactOptionsSignalPanel signal={exactOptionsSignal} />
              <BrokerVerificationPanel signal={exactOptionsSignal} />
              <HumanApprovedTicketPanel plan={visibleSelected} settings={riskSettings} rules={strategyRules} liveState={snapshot?.state} />
              <ProfitEfficiencyPanel plan={visibleSelected} settings={riskSettings} />
              <OptionsAffordabilityPanel plan={visibleSelected} settings={riskSettings} />
            </>
          ) : (
            <div className="rounded-lg border border-warning/40 bg-warning/10 p-6">
              <div className="text-base font-semibold">No verified live option contracts</div>
              <div className="mt-2 text-sm text-muted-foreground">
                The scanner is intentionally showing no trade candidates until a live option-chain provider returns valid contracts.
              </div>
            </div>
          )}
        </section>

        <aside className="space-y-3 xl:sticky xl:top-[104px] xl:self-start">
          <CompactLiveStatus snapshot={snapshot} loading={liveLoading} onRefresh={refreshLiveData} />
          {hasLivePlans && <MarketOpenReadinessPanel snapshot={snapshot} movers={optionMovers} radarEvents={radarEvents} gate={compactGate} />}
          <WeeklyPredictionAuditPanel />
          <AutomationQueuePanel rows={automationQueueRows} />
          <MissPreventionPanel rows={defenseRows} />
          <MissedRunnerAutopsyPanel rows={missedRunnerRows} />
          <IntelligenceMemoryPanel summary={intelligenceMemory.summary} onClear={intelligenceMemory.clear} />
          <AccuracyCalibrationPanel records={runtimePerformance.records} events={radarEvents} />
          <RuntimePerformanceReviewPanel
            records={runtimePerformance.records}
            summary={runtimePerformance.summary}
            onClear={runtimePerformance.clear}
          />
          <div className={`rounded-lg border p-4 ${
            compactGate.status === "approved"
              ? "border-gain/40 bg-gain/10"
              : compactGate.status === "wait"
                ? "border-warning/40 bg-warning/10"
                : "border-loss/40 bg-loss/10"
          }`}>
            <div className="text-[11px] uppercase text-muted-foreground">Trade Gate</div>
            <div className="mt-1 flex items-end justify-between">
              <div className="font-mono text-2xl font-bold uppercase">{compactGate.status}</div>
              <div className="font-mono text-sm text-muted-foreground">{compactGate.score}%</div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded bg-card/70 p-2">
                <div className="text-muted-foreground">Risk</div>
                <div className="font-mono text-foreground">${compactGate.suggestedDollarRisk.toLocaleString()}</div>
              </div>
              <div className="rounded bg-card/70 p-2">
                <div className="text-muted-foreground">Daily lock</div>
                <div className="font-mono text-foreground">${compactGate.maxDailyLoss.toLocaleString()}</div>
              </div>
            </div>
          </div>

          <CompactLiveStatus snapshot={snapshot} loading={liveLoading} onRefresh={refreshLiveData} />
          <CompactRiskControls settings={riskSettings} setSettings={setRiskSettings} />
        </aside>
      </main>
    </div>
  );
}
