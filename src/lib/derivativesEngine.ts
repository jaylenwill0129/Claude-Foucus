export type AssetClass = "option" | "future" | "stock";
export type Bias = "bullish" | "bearish" | "neutral";
export type SessionWindow = "pre-market" | "open-drive" | "midday" | "power-hour" | "overnight";

export interface MarketSetup {
  symbol: string;
  name: string;
  assetClass: AssetClass;
  bias: Bias;
  price: number;
  week52High: number;
  support: number;
  resistance: number;
  higherTimeframeTrend: "uptrend" | "downtrend" | "range";
  retestStatus: "waiting" | "retesting" | "confirmed" | "failed";
  qualityCompanyScore: number;
  changePct: number;
  atrPct: number;
  ivRank?: number;
  volumeScore: number;
  spreadBps: number;
  catalystScore: number;
  trendScore: number;
  flowScore: number;
  eventRisk: number;
  marginImpact: number;
  thetaDrag?: number;
  delta?: number;
  dte?: number;
  preferredStructure: string;
  trigger: string;
  invalidation: string;
  target: string;
  session: SessionWindow;
}

export interface OpportunityPlan extends MarketSetup {
  opportunityScore: number;
  riskScore: number;
  efficiencyScore: number;
  positionRiskPct: number;
  maxNotionalPct: number;
  minRewardRisk: number;
  quality: "A" | "B" | "C" | "Avoid";
  notes: string[];
}

export type CatalystType = "takeover" | "earnings" | "guidance" | "regulatory" | "product" | "unusual_options" | "macro";

export interface CatalystEvent {
  symbol: string;
  type: CatalystType;
  headline: string;
  detectedAt: string;
  movePct: number;
  stockPrice: number;
  dealPrice?: number;
  optionVolume?: number;
  urgencyScore: number;
  chaseRisk: "low" | "medium" | "high";
  sources?: string[];
  corroborationScore?: number;
  credibilityScore?: number;
  freshnessMinutes?: number;
  qualityFlags?: string[];
  contractSignal: string;
  action: string;
}

export interface StrategyPlaybook {
  name: string;
  marketUse: string;
  assetClass: AssetClass;
  stance: Bias;
  setup: string;
  whyItCanWork: string;
  riskControl: string;
  avoidWhen: string;
  evidenceLevel: "core" | "situational" | "advanced";
}

export interface LabTrade {
  id: number;
  regime: "trend" | "range" | "volatile" | "event";
  resultR: number;
  duration: string;
}

export interface StrategyLabResult {
  sampleSize: number;
  winRate: number;
  avgWinR: number;
  avgLossR: number;
  expectancyR: number;
  profitFactor: number;
  maxDrawdownR: number;
  edgeScore: number;
  equityCurve: { trade: number; equityR: number; drawdownR: number }[];
  regimeStats: { regime: LabTrade["regime"]; trades: number; winRate: number; expectancyR: number }[];
  recentTrades: LabTrade[];
  verdict: string;
}

export interface ScenarioPoint {
  movePct: number;
  optionReturn: number;
  futuresReturn: number;
  stockReturn: number;
}

export interface RiskSettings {
  accountSize: number;
  maxDailyLossPct: number;
  maxTradeRiskPct: number;
  maxOptionsSpreadBps: number;
  maxFuturesMarginPct: number;
  minEdgeScore: number;
  minRewardRisk: number;
  blockEventRiskAbove: number;
  minUnderlyingPrice: number;
  maxUnderlyingPrice: number;
  minVolumeScore: number;
  minDte: number;
  maxPremiumRiskPct: number;
  minOptionPremium: number;
  maxOptionPremium: number;
}

export interface StrategyRuleSet {
  requireQuality: "A" | "B" | "C";
  requireTrendConfirmation: boolean;
  requireFlowConfirmation: boolean;
  requireLiquidity: boolean;
  requireRiskReward: boolean;
  requireNoEventRisk: boolean;
  require52WeekContext: boolean;
}

export interface TradeGateCheck {
  label: string;
  passed: boolean;
  detail: string;
}

export interface TradeGateResult {
  status: "approved" | "wait" | "blocked";
  score: number;
  suggestedDollarRisk: number;
  maxDailyLoss: number;
  checks: TradeGateCheck[];
}

export interface PassHitVerification {
  passRate: number;
  hitRate: number;
  expectancyR: number;
  sampleSize: number;
  confidence: "verified" | "watch" | "unverified";
  readiness: "trade_ready" | "wait_for_open" | "do_not_trade";
  summary: string;
  requiredAction: string;
}

export interface OptionContractCandidate {
  label: string;
  dte: number;
  strike: number;
  delta: number;
  estimatedPremium: number;
  maxLoss: number;
  estimatedSpreadDebit?: number;
  spreadMaxLoss?: number;
  spreadWidth?: number;
  maxLongCallContracts: number;
  maxSpreadContracts: number;
  capitalEfficiencyScore: number;
  profitTargetPct: number;
  stopLossPct: number;
  verdict: "long_call_ok" | "spread_only" | "too_expensive" | "skip";
  reasons: string[];
  skipReasons: string[];
}

export interface ProfitEfficiencyPlan {
  score: number;
  style: "day_trade" | "swing_call" | "six_month_call" | "debit_spread" | "skip";
  primarySkipReason: string;
  exitRules: string[];
  capitalRule: string;
}

export interface SmallAccountFilterResult {
  passed: boolean;
  checks: TradeGateCheck[];
}

export interface OptionReasonScore {
  label: "Underlying" | "Catalyst" | "Contract" | "Pattern" | "Risk";
  score: number;
  detail: string;
}

export interface OptionReasoningReport {
  verdict: "trade_candidate" | "watch_only" | "skip";
  confidence: "high" | "medium" | "low";
  score: number;
  summary: string;
  bestContract?: OptionContractCandidate;
  scores: OptionReasonScore[];
  strengths: string[];
  risks: string[];
  nextAction: string;
}

export interface LearnedWinnerPattern {
  symbol: string;
  theme: "ai_infrastructure" | "semiconductor" | "space_contracts" | "energy_transition" | "quantum" | "squeeze_repricing";
  patternScore: number;
  moveReason: string;
  searchSignal: string;
}

export interface TomorrowSimilarityCandidate {
  symbol: string;
  similarityScore: number;
  theme: LearnedWinnerPattern["theme"] | "cybersecurity_ai";
  source: "provided_winner" | "new_discovery";
  catalystWindow: string;
  whySimilar: string;
  confirmationNeeded: string;
  budgetNote: string;
}

export const defaultRiskSettings: RiskSettings = {
  accountSize: 5000,
  maxDailyLossPct: 2,
  maxTradeRiskPct: 2,
  maxOptionsSpreadBps: 12,
  maxFuturesMarginPct: 70,
  minEdgeScore: 58,
  minRewardRisk: 1.8,
  blockEventRiskAbove: 70,
  minUnderlyingPrice: 50,
  maxUnderlyingPrice: 100,
  minVolumeScore: 70,
  minDte: 30,
  maxPremiumRiskPct: 2,
  minOptionPremium: 0.5,
  maxOptionPremium: 1,
};

export const defaultStrategyRules: StrategyRuleSet = {
  requireQuality: "B",
  requireTrendConfirmation: true,
  requireFlowConfirmation: true,
  requireLiquidity: true,
  requireRiskReward: true,
  requireNoEventRisk: true,
  require52WeekContext: true,
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const learnedWinnerPatterns: LearnedWinnerPattern[] = [
  {
    symbol: "CIFR",
    theme: "ai_infrastructure",
    patternScore: 88,
    moveReason: "Bitcoin-miner-to-AI/HPC data-center repricing after hyperscale leases, Google-backed lease support, and large contracted revenue.",
    searchSignal: "Former crypto miner converting power/data-center assets into AI infrastructure contracts.",
  },
  {
    symbol: "GFS",
    theme: "semiconductor",
    patternScore: 78,
    moveReason: "Semiconductor and domestic foundry momentum tied to AI, CHIPS funding, investor-day growth targets, and 52-week-high strength.",
    searchSignal: "Foundry or power-semi name making new highs with AI/CHIPS funding sympathy.",
  },
  {
    symbol: "LUNR",
    theme: "space_contracts",
    patternScore: 84,
    moveReason: "Space-contract repricing driven by NASA contract/backlog sensitivity and small-float momentum.",
    searchSignal: "Space or defense contractor with fresh awards, backlog expansion, or contract rumor sensitivity.",
  },
  {
    symbol: "WOLF",
    theme: "squeeze_repricing",
    patternScore: 90,
    moveReason: "AI power-infrastructure sympathy plus restructuring/turnaround narrative and heavy short-interest squeeze conditions.",
    searchSignal: "Heavily shorted turnaround tied to AI infrastructure bottlenecks or power semiconductors.",
  },
  {
    symbol: "PLUG",
    theme: "energy_transition",
    patternScore: 75,
    moveReason: "Hydrogen/AI-power sympathy and improving-margin narrative created sector rotation into cheap energy-transition calls.",
    searchSignal: "Beaten-down hydrogen/energy-transition name with peer catalyst, margin improvement, or high-volume reclaim.",
  },
  {
    symbol: "KULR",
    theme: "energy_transition",
    patternScore: 79,
    moveReason: "Battery/thermal-management theme tied to space, defense, AI data centers, and reduced dilution concern.",
    searchSignal: "Battery safety or thermal-management supplier with defense/space/AI infrastructure linkage and dilution relief.",
  },
  {
    symbol: "IONQ",
    theme: "quantum",
    patternScore: 86,
    moveReason: "Quantum basket strength from government funding speculation, SkyWater acquisition angle, strong revenue growth, and high-volatility call demand.",
    searchSignal: "Quantum computing name moving with funding, government contract, acquisition, or sector-basket strength.",
  },
  {
    symbol: "CHPT",
    theme: "energy_transition",
    patternScore: 70,
    moveReason: "EV charging rebound/speculation ahead of earnings and high short-interest small-account option demand.",
    searchSignal: "Beaten-down EV infrastructure name with earnings setup, policy/sector sympathy, and heavy retail volume.",
  },
];

export const tomorrowSimilarityCandidates: TomorrowSimilarityCandidate[] = [
  {
    symbol: "WOLF",
    similarityScore: 91,
    theme: "squeeze_repricing",
    source: "provided_winner",
    catalystWindow: "Continuation watch for Jun 3, 2026 open",
    whySimilar: "Still matches the strongest winner anatomy: AI power-infrastructure narrative, squeeze behavior, high ATR, and heavy volume.",
    confirmationNeeded: "Needs VWAP reclaim or opening-range pullback hold; skip if it gaps and fades.",
    budgetNote: "Fits the $50-$100 underlying filter, but options can be wide because IV is extreme.",
  },
  {
    symbol: "GFS",
    similarityScore: 83,
    theme: "semiconductor",
    source: "provided_winner",
    catalystWindow: "Continuation watch for Jun 3, 2026 open",
    whySimilar: "Foundry/semiconductor name inside the preferred price band with AI/CHIPS sympathy and 52-week-high pressure.",
    confirmationNeeded: "Needs semiconductor breadth positive and a clean hold above prior high/VWAP.",
    budgetNote: "Best fit for the current $50-$100 stock filter; use only tight-spread contracts.",
  },
  {
    symbol: "CIFR",
    similarityScore: 86,
    theme: "ai_infrastructure",
    source: "provided_winner",
    catalystWindow: "Continuation watch if AI/HPC crypto-miner basket stays strong",
    whySimilar: "Crypto-miner-to-AI-data-center repricing is one of the best repeatable winner patterns from today.",
    confirmationNeeded: "Needs peers like IREN/WULF/MARA/RIOT green and volume above the open pace.",
    budgetNote: "Below the current $50 stock filter; lower the min price only if you intentionally want higher-risk cheap underlyings.",
  },
  {
    symbol: "LUNR",
    similarityScore: 82,
    theme: "space_contracts",
    source: "provided_winner",
    catalystWindow: "Continuation watch if space/defense headlines persist",
    whySimilar: "Space-contract names can reprice fast on NASA/backlog rumors and sympathy moves.",
    confirmationNeeded: "Needs RKLB/ASTS/RDW/LUNR breadth plus an opening range high break.",
    budgetNote: "Below the current $50 stock filter; contracts may be affordable but IV can be punishing.",
  },
  {
    symbol: "CHPT",
    similarityScore: 72,
    theme: "energy_transition",
    source: "provided_winner",
    catalystWindow: "Earnings-adjacent watch around Jun 3, 2026",
    whySimilar: "Beaten-down EV infrastructure name with high retail interest and event-risk setup.",
    confirmationNeeded: "Needs real volume, EV infrastructure sympathy, and no bid/ask spread blowout.",
    budgetNote: "Very low-priced stock; only tiny defined-risk trades if you lower the filter.",
  },
  {
    symbol: "CRWD",
    similarityScore: 79,
    theme: "cybersecurity_ai",
    source: "new_discovery",
    catalystWindow: "Confirmed earnings after close Jun 3, 2026",
    whySimilar: "AI cybersecurity earnings can move the whole cyber basket, similar to how AI infrastructure lifted today’s winners.",
    confirmationNeeded: "For small accounts, watch cyber sympathy instead of chasing expensive CRWD contracts.",
    budgetNote: "Likely outside small-account contract budget unless using carefully priced spreads.",
  },
  {
    symbol: "WULF",
    similarityScore: 88,
    theme: "ai_infrastructure",
    source: "new_discovery",
    catalystWindow: "AI/HPC miner continuation watch for Jun 3, 2026",
    whySimilar: "TeraWulf is the cleanest non-provided cousin to CIFR: bitcoin-miner power assets being repriced as AI/HPC infrastructure.",
    confirmationNeeded: "Needs CIFR/IREN/WULF basket strength, high relative volume, and a VWAP hold after the first pullback.",
    budgetNote: "Usually below the $50 stock filter; useful only if you intentionally enable cheaper high-beta underlyings.",
  },
  {
    symbol: "IREN",
    similarityScore: 86,
    theme: "ai_infrastructure",
    source: "new_discovery",
    catalystWindow: "AI/HPC miner continuation watch for Jun 3, 2026",
    whySimilar: "IREN fits the same AI data-center revaluation pattern after investors began valuing miner power capacity as compute infrastructure.",
    confirmationNeeded: "Needs miner/HPC peers green and option contracts staying liquid after the open.",
    budgetNote: "High-beta and likely below the default price filter; spreads preferred if IV spikes.",
  },
  {
    symbol: "QBTS",
    similarityScore: 84,
    theme: "quantum",
    source: "new_discovery",
    catalystWindow: "Quantum-basket watch for Jun 3, 2026",
    whySimilar: "D-Wave is a direct non-provided peer to IONQ with the same government-funding/retail-volatility setup.",
    confirmationNeeded: "Needs IONQ/QBTS/RGTI/QUBT breadth and opening range high break.",
    budgetNote: "Usually cheaper underlying; only use tight contracts because quantum IV can collapse fast.",
  },
  {
    symbol: "RGTI",
    similarityScore: 81,
    theme: "quantum",
    source: "new_discovery",
    catalystWindow: "Quantum-basket watch for Jun 3, 2026",
    whySimilar: "Rigetti often moves as a higher-risk beta version of the IONQ quantum trade.",
    confirmationNeeded: "Needs quantum basket confirmation and volume above prior open pace.",
    budgetNote: "Already in the app; below strict $50 stock filter but can offer cheap contracts.",
  },
  {
    symbol: "RKLB",
    similarityScore: 80,
    theme: "space_contracts",
    source: "new_discovery",
    catalystWindow: "Space/defense continuation watch for Jun 3, 2026",
    whySimilar: "Rocket Lab is the cleanest non-provided space peer to LUNR, often moving with NASA, defense, and SpaceX/sector sentiment.",
    confirmationNeeded: "Needs LUNR/RKLB/ASTS/RDW breadth and a clean opening range break.",
    budgetNote: "Below default $50 stock filter; more useful when scanning lower-priced contract opportunities.",
  },
  {
    symbol: "ASTS",
    similarityScore: 78,
    theme: "space_contracts",
    source: "new_discovery",
    catalystWindow: "Space/telecom continuation watch for Jun 3, 2026",
    whySimilar: "AST SpaceMobile gives satellite/space beta similar to LUNR but with telecom and direct-to-cell narrative.",
    confirmationNeeded: "Needs space basket strength and no gap-fade below VWAP.",
    budgetNote: "May be above or near the preferred stock range depending on live price; verify broker chain.",
  },
  {
    symbol: "RDW",
    similarityScore: 75,
    theme: "space_contracts",
    source: "new_discovery",
    catalystWindow: "Space-infrastructure watch for Jun 3, 2026",
    whySimilar: "Redwire is a picks-and-shovels space infrastructure name that can follow LUNR/RKLB sector strength.",
    confirmationNeeded: "Needs sector breadth and option liquidity; skip if contracts are thin.",
    budgetNote: "Often cheaper underlying; liquidity may be the limiting factor.",
  },
  {
    symbol: "BE",
    similarityScore: 73,
    theme: "energy_transition",
    source: "new_discovery",
    catalystWindow: "Hydrogen/AI-power sympathy watch for Jun 3, 2026",
    whySimilar: "Bloom Energy can follow PLUG-style hydrogen and AI-power infrastructure rotations, but usually with better institutional liquidity.",
    confirmationNeeded: "Needs PLUG/BE/FCEL/BLDP breadth and contracts that do not widen after open.",
    budgetNote: "Often below the strict $50 filter; spreads or smaller size only.",
  },
];

export const marketSetups: MarketSetup[] = [
  {
    symbol: "SPY 0DTE",
    name: "S&P 500 ETF options",
    assetClass: "option",
    bias: "bullish",
    price: 632.18,
    week52High: 638.55,
    support: 625.4,
    resistance: 636.2,
    higherTimeframeTrend: "uptrend",
    retestStatus: "retesting",
    qualityCompanyScore: 88,
    changePct: 0.42,
    atrPct: 0.91,
    ivRank: 38,
    volumeScore: 94,
    spreadBps: 4,
    catalystScore: 74,
    trendScore: 82,
    flowScore: 88,
    eventRisk: 42,
    marginImpact: 18,
    thetaDrag: 72,
    delta: 0.39,
    dte: 0,
    preferredStructure: "Call debit spread above VWAP reclaim",
    trigger: "Enter only after 5m close above prior high with breadth positive",
    invalidation: "Exit below VWAP or if premium loses 28%",
    target: "Scale at 45% premium gain, trail runner by 8 EMA",
    session: "open-drive",
  },
  {
    symbol: "QQQ",
    name: "Nasdaq 100 options",
    assetClass: "option",
    bias: "bullish",
    price: 548.77,
    week52High: 555.92,
    support: 541.2,
    resistance: 552.4,
    higherTimeframeTrend: "uptrend",
    retestStatus: "confirmed",
    qualityCompanyScore: 90,
    changePct: 0.73,
    atrPct: 1.22,
    ivRank: 44,
    volumeScore: 91,
    spreadBps: 5,
    catalystScore: 68,
    trendScore: 86,
    flowScore: 84,
    eventRisk: 48,
    marginImpact: 20,
    thetaDrag: 56,
    delta: 0.42,
    dte: 3,
    preferredStructure: "Weekly 40 delta call spread",
    trigger: "Break and hold over morning value area high",
    invalidation: "Close below anchored VWAP from cash open",
    target: "First trim at 1.8R, second trim near expected move high",
    session: "open-drive",
  },
  {
    symbol: "ES",
    name: "E-mini S&P futures",
    assetClass: "future",
    bias: "neutral",
    price: 6418.25,
    week52High: 6484.0,
    support: 6380.0,
    resistance: 6452.0,
    higherTimeframeTrend: "range",
    retestStatus: "waiting",
    qualityCompanyScore: 70,
    changePct: 0.31,
    atrPct: 0.78,
    volumeScore: 89,
    spreadBps: 2,
    catalystScore: 62,
    trendScore: 58,
    flowScore: 64,
    eventRisk: 36,
    marginImpact: 54,
    preferredStructure: "Two-contract bracket around overnight range",
    trigger: "Trade range break only after retest accepts",
    invalidation: "Back inside range for two 3m candles",
    target: "Half at measured move, half at next volume node",
    session: "pre-market",
  },
  {
    symbol: "NQ",
    name: "Nasdaq futures",
    assetClass: "future",
    bias: "bullish",
    price: 23014.5,
    week52High: 23360.75,
    support: 22840.0,
    resistance: 23220.0,
    higherTimeframeTrend: "uptrend",
    retestStatus: "confirmed",
    qualityCompanyScore: 76,
    changePct: 0.86,
    atrPct: 1.36,
    volumeScore: 86,
    spreadBps: 3,
    catalystScore: 79,
    trendScore: 88,
    flowScore: 81,
    eventRisk: 57,
    marginImpact: 68,
    preferredStructure: "Micro NQ starter, add only after pullback holds",
    trigger: "Higher low above opening range midpoint",
    invalidation: "Loss of prior 15m pivot",
    target: "Take 60% at 2R, trail remainder below 13 EMA",
    session: "power-hour",
  },
  {
    symbol: "CL",
    name: "Crude oil futures",
    assetClass: "future",
    bias: "bearish",
    price: 78.42,
    week52High: 84.52,
    support: 76.9,
    resistance: 80.1,
    higherTimeframeTrend: "downtrend",
    retestStatus: "failed",
    qualityCompanyScore: 52,
    changePct: -0.94,
    atrPct: 2.06,
    volumeScore: 73,
    spreadBps: 6,
    catalystScore: 66,
    trendScore: 71,
    flowScore: 62,
    eventRisk: 61,
    marginImpact: 72,
    preferredStructure: "Micro crude short below supply rejection",
    trigger: "Failed auction above prior settlement",
    invalidation: "Acceptance back above supply shelf",
    target: "Cover into prior demand, avoid inventory release window",
    session: "midday",
  },
  {
    symbol: "NVDA",
    name: "Momentum stock and options",
    assetClass: "stock",
    bias: "bullish",
    price: 186.91,
    week52High: 195.95,
    support: 181.4,
    resistance: 191.7,
    higherTimeframeTrend: "uptrend",
    retestStatus: "retesting",
    qualityCompanyScore: 96,
    changePct: 1.18,
    atrPct: 2.48,
    ivRank: 53,
    volumeScore: 88,
    spreadBps: 8,
    catalystScore: 84,
    trendScore: 91,
    flowScore: 86,
    eventRisk: 54,
    marginImpact: 32,
    thetaDrag: 42,
    delta: 0.52,
    dte: 10,
    preferredStructure: "Stock starter plus call spread confirmation",
    trigger: "Relative strength versus QQQ while above prior day high",
    invalidation: "Close below 20 EMA or sector loses leadership",
    target: "Scale stock at 2 ATR extension, hold spread into trend day",
    session: "open-drive",
  },
  {
    symbol: "AAPL",
    name: "Mega-cap options",
    assetClass: "option",
    bias: "neutral",
    price: 201.14,
    week52High: 237.49,
    support: 196.8,
    resistance: 214.6,
    higherTimeframeTrend: "range",
    retestStatus: "waiting",
    qualityCompanyScore: 92,
    changePct: -0.18,
    atrPct: 1.12,
    ivRank: 31,
    volumeScore: 83,
    spreadBps: 5,
    catalystScore: 45,
    trendScore: 49,
    flowScore: 52,
    eventRisk: 38,
    marginImpact: 19,
    thetaDrag: 34,
    delta: 0.26,
    dte: 17,
    preferredStructure: "Iron condor only if range compression persists",
    trigger: "Sell premium after first hour range stays inside expected move",
    invalidation: "Exit tested side at 1.7x credit",
    target: "Buy back at 45-55% max profit",
    session: "midday",
  },
  {
    symbol: "SOFI",
    name: "Affordable growth options",
    assetClass: "option",
    bias: "bullish",
    price: 18.42,
    week52High: 24.10,
    support: 17.2,
    resistance: 19.8,
    higherTimeframeTrend: "uptrend",
    retestStatus: "retesting",
    qualityCompanyScore: 74,
    changePct: 1.05,
    atrPct: 4.1,
    ivRank: 58,
    volumeScore: 82,
    spreadBps: 14,
    catalystScore: 68,
    trendScore: 72,
    flowScore: 70,
    eventRisk: 46,
    marginImpact: 12,
    thetaDrag: 44,
    delta: 0.42,
    dte: 45,
    preferredStructure: "Small debit spread or 60-180 DTE call after support retest",
    trigger: "Enter only if price reclaims resistance with volume above 20-day average",
    invalidation: "Exit below support or if option loses 35% of premium",
    target: "Scale near prior swing high, hold runner toward 52-week high",
    session: "open-drive",
  },
  {
    symbol: "PLTR",
    name: "Liquid mid-price momentum options",
    assetClass: "option",
    bias: "bullish",
    price: 74.35,
    week52High: 89.90,
    support: 70.5,
    resistance: 78.2,
    higherTimeframeTrend: "uptrend",
    retestStatus: "confirmed",
    qualityCompanyScore: 83,
    changePct: 0.88,
    atrPct: 3.2,
    ivRank: 49,
    volumeScore: 86,
    spreadBps: 10,
    catalystScore: 72,
    trendScore: 78,
    flowScore: 76,
    eventRisk: 50,
    marginImpact: 16,
    thetaDrag: 38,
    delta: 0.45,
    dte: 90,
    preferredStructure: "90-180 DTE call spread after breakout retest",
    trigger: "Break above resistance, retest holds, then enter with defined premium risk",
    invalidation: "Close below retest level or trend score drops under 65",
    target: "Trim into 1.8R, leave runner toward 52-week high gap close",
    session: "open-drive",
  },
  {
    symbol: "HOOD",
    name: "Liquid fintech options",
    assetClass: "option",
    bias: "bullish",
    price: 62.8,
    week52High: 76.7,
    support: 59.4,
    resistance: 65.1,
    higherTimeframeTrend: "uptrend",
    retestStatus: "waiting",
    qualityCompanyScore: 72,
    changePct: -0.22,
    atrPct: 3.8,
    ivRank: 61,
    volumeScore: 79,
    spreadBps: 16,
    catalystScore: 64,
    trendScore: 69,
    flowScore: 66,
    eventRisk: 55,
    marginImpact: 15,
    thetaDrag: 48,
    delta: 0.38,
    dte: 120,
    preferredStructure: "Wait for retest, then use call debit spread instead of naked calls",
    trigger: "Resistance reclaim plus confirmed retest",
    invalidation: "Failed retest or option spread widens beyond plan",
    target: "Take partial at prior high zone, avoid holding through event risk",
    session: "midday",
  },
  {
    symbol: "TMHC",
    name: "Takeover repricing options",
    assetClass: "option",
    bias: "neutral",
    price: 71.57,
    week52High: 72.5,
    support: 70.8,
    resistance: 72.5,
    higherTimeframeTrend: "uptrend",
    retestStatus: "confirmed",
    qualityCompanyScore: 77,
    changePct: 22.3,
    atrPct: 2.9,
    ivRank: 82,
    volumeScore: 76,
    spreadBps: 22,
    catalystScore: 98,
    trendScore: 88,
    flowScore: 84,
    eventRisk: 88,
    marginImpact: 12,
    thetaDrag: 68,
    delta: 0.22,
    dte: 18,
    preferredStructure: "Merger-news watch only; avoid chasing calls near cash deal price",
    trigger: "Only consider contracts before repricing or if a confirmed higher competing bid appears",
    invalidation: "Stock trades pinned near cash offer or option spread stays wide",
    target: "Take fast event profits; do not hold lottery calls after the gap is priced",
    session: "pre-market",
  },
  {
    symbol: "MGM",
    name: "Premarket casino momentum options",
    assetClass: "option",
    bias: "bullish",
    price: 49.12,
    week52High: 54.8,
    support: 46.4,
    resistance: 50.6,
    higherTimeframeTrend: "uptrend",
    retestStatus: "retesting",
    qualityCompanyScore: 69,
    changePct: 12.48,
    atrPct: 4.8,
    ivRank: 63,
    volumeScore: 78,
    spreadBps: 18,
    catalystScore: 76,
    trendScore: 82,
    flowScore: 74,
    eventRisk: 64,
    marginImpact: 14,
    thetaDrag: 52,
    delta: 0.32,
    dte: 45,
    preferredStructure: "Small call debit spread only after opening range holds",
    trigger: "Do not chase the gap; enter only after reclaim and hold above opening VWAP",
    invalidation: "Opening range low breaks or spread widens beyond plan",
    target: "Take profit quickly into 35-60% spread gain",
    session: "open-drive",
  },
  {
    symbol: "HPE",
    name: "AI infrastructure mover options",
    assetClass: "option",
    bias: "bullish",
    price: 45.05,
    week52High: 48.9,
    support: 42.8,
    resistance: 46.6,
    higherTimeframeTrend: "uptrend",
    retestStatus: "confirmed",
    qualityCompanyScore: 71,
    changePct: 4.67,
    atrPct: 3.6,
    ivRank: 55,
    volumeScore: 76,
    spreadBps: 14,
    catalystScore: 78,
    trendScore: 77,
    flowScore: 72,
    eventRisk: 58,
    marginImpact: 13,
    thetaDrag: 45,
    delta: 0.34,
    dte: 45,
    preferredStructure: "Low-debit call spread while AI infrastructure bid holds",
    trigger: "Break above premarket high or retest of VWAP with volume expansion",
    invalidation: "Lose VWAP and fail to reclaim within two 5m candles",
    target: "Trim at 40-55% spread gain, avoid holding through earnings risk",
    session: "open-drive",
  },
  {
    symbol: "SMCI",
    name: "AI server volatility options",
    assetClass: "option",
    bias: "bullish",
    price: 46.2,
    week52High: 66.4,
    support: 43.0,
    resistance: 47.0,
    higherTimeframeTrend: "range",
    retestStatus: "retesting",
    qualityCompanyScore: 62,
    changePct: 2.4,
    atrPct: 6.2,
    ivRank: 88,
    volumeScore: 84,
    spreadBps: 20,
    catalystScore: 83,
    trendScore: 64,
    flowScore: 82,
    eventRisk: 72,
    marginImpact: 19,
    thetaDrag: 63,
    delta: 0.3,
    dte: 45,
    preferredStructure: "Defined-risk call spread only; avoid naked premium",
    trigger: "Clear and hold above resistance with bid/ask spread tightening",
    invalidation: "Reject resistance or event-risk headline reverses the move",
    target: "Take fast profits into volatility spike; do not average down",
    session: "open-drive",
  },
  {
    symbol: "IONQ",
    name: "Quantum volatility options",
    assetClass: "option",
    bias: "bullish",
    price: 70.0,
    week52High: 84.5,
    support: 66.2,
    resistance: 73.0,
    higherTimeframeTrend: "uptrend",
    retestStatus: "waiting",
    qualityCompanyScore: 66,
    changePct: 1.9,
    atrPct: 7.4,
    ivRank: 92,
    volumeScore: 73,
    spreadBps: 24,
    catalystScore: 80,
    trendScore: 70,
    flowScore: 69,
    eventRisk: 76,
    marginImpact: 18,
    thetaDrag: 70,
    delta: 0.25,
    dte: 45,
    preferredStructure: "Tiny debit spread only after quantum basket confirms",
    trigger: "Reclaim resistance with sector breadth positive",
    invalidation: "Fail below support or options spread stays wide",
    target: "Scale fast; high IV means profits can fade quickly",
    session: "open-drive",
  },
  {
    symbol: "RGTI",
    name: "Speculative quantum mover options",
    assetClass: "option",
    bias: "bullish",
    price: 25.54,
    week52High: 31.8,
    support: 23.8,
    resistance: 27.0,
    higherTimeframeTrend: "range",
    retestStatus: "waiting",
    qualityCompanyScore: 54,
    changePct: -2.8,
    atrPct: 8.6,
    ivRank: 96,
    volumeScore: 68,
    spreadBps: 28,
    catalystScore: 75,
    trendScore: 58,
    flowScore: 62,
    eventRisk: 82,
    marginImpact: 16,
    thetaDrag: 74,
    delta: 0.22,
    dte: 45,
    preferredStructure: "Only use very small defined-risk contracts after reclaim",
    trigger: "Reclaim $26.50-$27 with volume; otherwise skip",
    invalidation: "Lose support or fail reclaim after first 30 minutes",
    target: "Treat as high-risk scalp; take partials quickly",
    session: "open-drive",
  },
  {
    symbol: "CIFR",
    name: "AI data-center repricing options",
    assetClass: "option",
    bias: "bullish",
    price: 25.4,
    week52High: 25.9,
    support: 23.2,
    resistance: 26.4,
    higherTimeframeTrend: "uptrend",
    retestStatus: "confirmed",
    qualityCompanyScore: 61,
    changePct: 6.9,
    atrPct: 8.1,
    ivRank: 86,
    volumeScore: 86,
    spreadBps: 22,
    catalystScore: 92,
    trendScore: 84,
    flowScore: 82,
    eventRisk: 74,
    marginImpact: 15,
    thetaDrag: 68,
    delta: 0.28,
    dte: 45,
    preferredStructure: "Low-debit call spread only after AI/HPC data-center bid confirms.",
    trigger: "Break and hold above premarket high with crypto-miner/HPC peers green.",
    invalidation: "Lose VWAP or catalyst basket fades for two 5m candles.",
    target: "Scale quickly into volatility expansion; do not hold through failed breakout.",
    session: "open-drive",
  },
  {
    symbol: "GFS",
    name: "Domestic foundry momentum options",
    assetClass: "option",
    bias: "bullish",
    price: 52.8,
    week52High: 54.2,
    support: 50.4,
    resistance: 54.6,
    higherTimeframeTrend: "uptrend",
    retestStatus: "retesting",
    qualityCompanyScore: 78,
    changePct: 2.4,
    atrPct: 3.5,
    ivRank: 54,
    volumeScore: 74,
    spreadBps: 13,
    catalystScore: 76,
    trendScore: 80,
    flowScore: 70,
    eventRisk: 52,
    marginImpact: 14,
    thetaDrag: 44,
    delta: 0.34,
    dte: 45,
    preferredStructure: "45-90 DTE call spread near 52-week-high reclaim.",
    trigger: "Hold above prior high while semiconductor breadth stays positive.",
    invalidation: "Close below reclaim level or chip basket loses leadership.",
    target: "Trim into 1.8R or 52-week extension.",
    session: "open-drive",
  },
  {
    symbol: "LUNR",
    name: "Space-contract catalyst options",
    assetClass: "option",
    bias: "bullish",
    price: 24.0,
    week52High: 29.5,
    support: 22.4,
    resistance: 25.6,
    higherTimeframeTrend: "uptrend",
    retestStatus: "waiting",
    qualityCompanyScore: 64,
    changePct: 6.1,
    atrPct: 9.4,
    ivRank: 91,
    volumeScore: 82,
    spreadBps: 24,
    catalystScore: 88,
    trendScore: 72,
    flowScore: 78,
    eventRisk: 78,
    marginImpact: 15,
    thetaDrag: 70,
    delta: 0.25,
    dte: 45,
    preferredStructure: "Tiny call spread only after NASA/space basket confirms.",
    trigger: "Opening range high break with RKLB/ASTS/LUNR sympathy still green.",
    invalidation: "Break below VWAP or contract headline is denied.",
    target: "Fast partials into 40-70% spread gain; avoid chasing high IV.",
    session: "open-drive",
  },
  {
    symbol: "WOLF",
    name: "AI power-semiconductor squeeze options",
    assetClass: "option",
    bias: "bullish",
    price: 65.1,
    week52High: 68.0,
    support: 58.4,
    resistance: 67.5,
    higherTimeframeTrend: "uptrend",
    retestStatus: "confirmed",
    qualityCompanyScore: 48,
    changePct: 12.2,
    atrPct: 12.0,
    ivRank: 98,
    volumeScore: 88,
    spreadBps: 30,
    catalystScore: 90,
    trendScore: 86,
    flowScore: 85,
    eventRisk: 92,
    marginImpact: 19,
    thetaDrag: 82,
    delta: 0.22,
    dte: 30,
    preferredStructure: "Squeeze watch only; use defined-risk spread after pullback holds.",
    trigger: "VWAP reclaim after first flush with shorts still trapped above prior high.",
    invalidation: "Lose opening range low or option spread stays wide.",
    target: "Take profits quickly; high squeeze risk can reverse violently.",
    session: "open-drive",
  },
  {
    symbol: "PLUG",
    name: "Hydrogen sympathy momentum options",
    assetClass: "option",
    bias: "bullish",
    price: 3.9,
    week52High: 5.2,
    support: 3.4,
    resistance: 4.15,
    higherTimeframeTrend: "range",
    retestStatus: "retesting",
    qualityCompanyScore: 42,
    changePct: 11.8,
    atrPct: 10.6,
    ivRank: 96,
    volumeScore: 92,
    spreadBps: 32,
    catalystScore: 74,
    trendScore: 68,
    flowScore: 80,
    eventRisk: 86,
    marginImpact: 10,
    thetaDrag: 78,
    delta: 0.2,
    dte: 30,
    preferredStructure: "Speculative micro-premium call only after volume confirms.",
    trigger: "Break above resistance with hydrogen/energy-transition peers green.",
    invalidation: "Failed reclaim or bid disappears from option chain.",
    target: "Take fast gains; do not average down low-priced contracts.",
    session: "open-drive",
  },
  {
    symbol: "KULR",
    name: "Battery and defense-energy options",
    assetClass: "option",
    bias: "bullish",
    price: 3.2,
    week52High: 6.7,
    support: 2.9,
    resistance: 3.55,
    higherTimeframeTrend: "range",
    retestStatus: "waiting",
    qualityCompanyScore: 46,
    changePct: 8.4,
    atrPct: 11.2,
    ivRank: 94,
    volumeScore: 84,
    spreadBps: 34,
    catalystScore: 79,
    trendScore: 66,
    flowScore: 74,
    eventRisk: 82,
    marginImpact: 10,
    thetaDrag: 76,
    delta: 0.2,
    dte: 45,
    preferredStructure: "Very small defined-risk contract after dilution-risk headlines stay quiet.",
    trigger: "Resistance reclaim with defense/space/AI infrastructure theme bid.",
    invalidation: "Lose reclaim or volume fades below opening pace.",
    target: "Scale quickly; keep risk tiny.",
    session: "open-drive",
  },
  {
    symbol: "CHPT",
    name: "EV charging rebound options",
    assetClass: "option",
    bias: "bullish",
    price: 4.8,
    week52High: 8.4,
    support: 4.35,
    resistance: 5.15,
    higherTimeframeTrend: "range",
    retestStatus: "waiting",
    qualityCompanyScore: 44,
    changePct: 6.4,
    atrPct: 9.8,
    ivRank: 90,
    volumeScore: 80,
    spreadBps: 30,
    catalystScore: 70,
    trendScore: 62,
    flowScore: 70,
    eventRisk: 84,
    marginImpact: 10,
    thetaDrag: 74,
    delta: 0.2,
    dte: 30,
    preferredStructure: "Earnings-adjacent watch only; avoid holding through binary report.",
    trigger: "Only after EV infrastructure basket confirms and spread is tight.",
    invalidation: "Reject resistance or earnings-risk premium inflates too far.",
    target: "Fast scalp; avoid overnight event risk.",
    session: "open-drive",
  },
];

export function scoreSetup(setup: MarketSetup): OpportunityPlan {
  const learnedPattern = learnedWinnerPatterns.find((pattern) => pattern.symbol === setup.symbol);
  const learnedBoost = learnedPattern ? clamp(learnedPattern.patternScore / 10, 0, 9) : 0;
  const affordabilityFit = setup.assetClass === "option"
    ? setup.price >= 10 && setup.price <= 100
      ? 16
      : setup.price < 10
        ? -10
        : -6
    : 0;
  const liquidity = clamp(100 - setup.spreadBps * 5 + setup.volumeScore * 0.35, 0, 100);
  const directionalEdge = setup.bias === "neutral"
    ? (100 - Math.abs(setup.trendScore - 50)) * 0.55 + setup.flowScore * 0.25
    : setup.trendScore * 0.45 + setup.flowScore * 0.35 + setup.catalystScore * 0.2;
  const volatilityFit = setup.assetClass === "option"
    ? clamp(100 - Math.abs((setup.ivRank ?? 45) - 45) * 1.4 - (setup.thetaDrag ?? 0) * 0.22, 0, 100)
    : clamp(100 - setup.atrPct * 12, 0, 100);
  const riskScore = clamp(
    setup.eventRisk * 0.3 + setup.marginImpact * 0.24 + setup.spreadBps * 1.9 + setup.atrPct * 6.5 + (setup.thetaDrag ?? 0) * 0.1,
    0,
    100
  );
  const opportunityScore = clamp(directionalEdge * 0.42 + liquidity * 0.24 + volatilityFit * 0.18 + setup.catalystScore * 0.08 + affordabilityFit + learnedBoost, 0, 100);
  const efficiencyScore = clamp(opportunityScore - riskScore * 0.48 + liquidity * 0.16, 0, 100);
  const positionRiskPct = setup.assetClass === "future"
    ? clamp(0.18 + efficiencyScore / 500, 0.2, 0.45)
    : setup.assetClass === "option"
      ? clamp(0.25 + efficiencyScore / 350, 0.3, 0.75)
      : clamp(0.35 + efficiencyScore / 300, 0.45, 0.95);
  const maxNotionalPct = setup.assetClass === "future"
    ? clamp(3.5 + efficiencyScore / 10 - setup.marginImpact / 12, 2, 8)
    : setup.assetClass === "option"
      ? clamp(2 + efficiencyScore / 14, 2, 8)
      : clamp(6 + efficiencyScore / 7, 8, 18);
  const minRewardRisk = riskScore > 65 ? 2.4 : riskScore > 45 ? 2.0 : 1.6;
  const quality = efficiencyScore >= 78 ? "A" : efficiencyScore >= 64 ? "B" : efficiencyScore >= 50 ? "C" : "Avoid";
  const notes = [
    liquidity > 80 ? "Liquid enough for fast entry and exit." : "Reduce size until spread improves.",
    riskScore > 60 ? "Needs smaller sizing and hard invalidation." : "Risk load is acceptable for planned bracket.",
    setup.assetClass === "option" && (setup.thetaDrag ?? 0) > 55 ? "Avoid holding through slow tape; theta drag is elevated." : "Structure fits current volatility profile.",
    setup.assetClass === "option" && setup.price >= 10 && setup.price <= 100 ? "Affordable underlying range for smaller accounts." : "Underlying may require spreads or smaller sizing.",
    learnedPattern ? `Learned winner pattern: ${learnedPattern.searchSignal}` : "No learned-winner boost applied.",
  ];

  return {
    ...setup,
    opportunityScore: Math.round(opportunityScore),
    riskScore: Math.round(riskScore),
    efficiencyScore: Math.round(efficiencyScore),
    positionRiskPct: Number(positionRiskPct.toFixed(2)),
    maxNotionalPct: Number(maxNotionalPct.toFixed(1)),
    minRewardRisk,
    quality,
    notes,
  };
}

export const rankedPlans = marketSetups
  .map(scoreSetup)
  .sort((a, b) => b.efficiencyScore - a.efficiencyScore);

export const catalystEvents: CatalystEvent[] = [
  {
    symbol: "TMHC",
    type: "takeover",
    headline: "Berkshire Hathaway cash takeover offer at $72.50 per share",
    detectedAt: "2026-06-01 09:30 ET",
    movePct: 22.3,
    stockPrice: 71.57,
    dealPrice: 72.5,
    optionVolume: 2854,
    urgencyScore: 98,
    chaseRisk: "high",
    contractSignal: "Calls already repriced near cash deal cap; cheap contracts can lose edge after the gap.",
    action: "Flag immediately, then avoid chasing unless a higher bid rumor or real volume confirms new upside.",
  },
  {
    symbol: "MGM",
    type: "unusual_options",
    headline: "Large premarket gap with event-style momentum",
    detectedAt: "2026-06-01 09:05 ET",
    movePct: 12.48,
    stockPrice: 49.12,
    optionVolume: 0,
    urgencyScore: 86,
    chaseRisk: "medium",
    contractSignal: "Use only low-debit contracts after opening range confirmation.",
    action: "Watch first 15-30 minutes; skip if the gap fades below VWAP.",
  },
  {
    symbol: "SMCI",
    type: "product",
    headline: "AI server news volatility with elevated option demand",
    detectedAt: "2026-06-01 09:05 ET",
    movePct: 2.4,
    stockPrice: 46.2,
    optionVolume: 0,
    urgencyScore: 78,
    chaseRisk: "high",
    contractSignal: "High IV; spreads preferred over naked calls.",
    action: "Require tight bid/ask and clear resistance break before considering.",
  },
];

export const equityCurve = [
  { label: "Mon", equity: 100000, target: 100000 },
  { label: "Tue", equity: 100420, target: 100250 },
  { label: "Wed", equity: 100180, target: 100500 },
  { label: "Thu", equity: 101060, target: 100750 },
  { label: "Fri", equity: 101740, target: 101000 },
  { label: "Next", equity: 102120, target: 101250 },
];

export const optionsFlow = [
  { time: "09:42", symbol: "SPY", side: "Call sweep", premium: "$1.8M", strike: "635C", expiry: "0DTE", signal: "aggressive ask" },
  { time: "10:08", symbol: "NVDA", side: "Call spread", premium: "$920K", strike: "190/195C", expiry: "10DTE", signal: "repeat buyer" },
  { time: "11:16", symbol: "QQQ", side: "Put hedge", premium: "$1.1M", strike: "540P", expiry: "3DTE", signal: "risk offset" },
  { time: "14:31", symbol: "ES", side: "Futures block", premium: "238 lots", strike: "6415", expiry: "Jun", signal: "range defense" },
];

export const strategyPlaybook: StrategyPlaybook[] = [
  {
    name: "52-week pullback LEAPS",
    marketUse: "High-quality company trading well below its 52-week high but still holding higher-timeframe structure",
    assetClass: "option",
    stance: "bullish",
    setup: "Use six-month call options after a meaningful pullback, ideally near support or after a resistance reclaim retest.",
    whyItCanWork: "Longer-dated calls reduce short-term timing pressure and use historical high-water marks as a realistic upside reference.",
    riskControl: "Avoid near-expiration contracts, cap premium risk, and require the stock to hold support before entry.",
    avoidWhen: "Avoid if the company is low quality, the higher timeframe is in a downtrend, or the option spread is too wide.",
    evidenceLevel: "core",
  },
  {
    name: "Defined-risk momentum spread",
    marketUse: "Bullish trend day, strong breadth, liquid index or mega-cap options",
    assetClass: "option",
    stance: "bullish",
    setup: "Use call debit spreads or call butterflies near expected-move targets instead of naked long calls.",
    whyItCanWork: "Caps premium at risk, reduces volatility overpayment, and fits directional momentum without requiring a huge move.",
    riskControl: "Risk 0.30-0.75% of equity, take partials at 45-60% premium gain, exit on VWAP loss.",
    avoidWhen: "Avoid if spread is wide, IV rank is stretched, or the setup needs a late chase.",
    evidenceLevel: "core",
  },
  {
    name: "Micro futures trend continuation",
    marketUse: "ES/NQ accepting above value with clear higher lows and active volume",
    assetClass: "future",
    stance: "bullish",
    setup: "Start with micro contracts, bracket the entry, and add only after a retest confirms acceptance.",
    whyItCanWork: "Trend-following futures approaches have long empirical support, but only when losses are cut quickly.",
    riskControl: "Pre-place stop and target, keep initial risk near 0.20-0.45% of equity, stop trading at daily loss lock.",
    avoidWhen: "Avoid chop, major news windows, and entries that require oversized margin.",
    evidenceLevel: "core",
  },
  {
    name: "Volatility premium range trade",
    marketUse: "Neutral tape, compressed realized range, elevated option premium",
    assetClass: "option",
    stance: "neutral",
    setup: "Use iron condors or credit spreads only after the first-hour range confirms containment.",
    whyItCanWork: "Defined-risk premium selling can benefit when implied volatility exceeds realized movement.",
    riskControl: "Enter for enough credit to justify assignment/gap risk; exit tested side around 1.5-1.7x credit.",
    avoidWhen: "Avoid earnings, FOMC/CPI windows, low liquidity, and trend days.",
    evidenceLevel: "situational",
  },
  {
    name: "Stock-led options confirmation",
    marketUse: "Single-name relative strength with sector leadership",
    assetClass: "stock",
    stance: "bullish",
    setup: "Use stock position as the primary signal and add options only when flow confirms the move.",
    whyItCanWork: "The stock entry provides cleaner invalidation while options add convexity only after confirmation.",
    riskControl: "Keep stock stop at technical invalidation; keep option premium small enough to lose completely.",
    avoidWhen: "Avoid if the options chain is illiquid or the move is only premium-driven without stock confirmation.",
    evidenceLevel: "core",
  },
  {
    name: "Bearish supply rejection",
    marketUse: "Failed breakout, negative market internals, or commodity supply rejection",
    assetClass: "future",
    stance: "bearish",
    setup: "Short micro futures or use put debit spreads after a failed auction back below resistance.",
    whyItCanWork: "Failed breakouts can unwind quickly because breakout buyers become forced sellers.",
    riskControl: "Stop above failed-auction high; require at least 2R target before entry.",
    avoidWhen: "Avoid if the rejection happens into strong higher-timeframe support.",
    evidenceLevel: "situational",
  },
];

function pseudoRandom(seed: number) {
  const value = Math.sin(seed) * 10000;
  return value - Math.floor(value);
}

export function runModeledBacktest(plan: OpportunityPlan, sampleSize = 80): StrategyLabResult {
  const trades: LabTrade[] = [];
  const equityCurve: StrategyLabResult["equityCurve"] = [];
  let equityR = 0;
  let peakR = 0;
  let maxDrawdownR = 0;
  const regimes: LabTrade["regime"][] = ["trend", "range", "volatile", "event"];
  const baseWinRate = clamp(42 + plan.efficiencyScore * 0.28 - plan.riskScore * 0.08, 34, 68);
  const avgWinRBase = clamp(plan.minRewardRisk * 0.86 + plan.opportunityScore / 180, 1.15, 2.6);
  const avgLossRBase = clamp(0.72 + plan.riskScore / 260, 0.72, 1.15);

  for (let i = 1; i <= sampleSize; i += 1) {
    const regime = regimes[(i + plan.symbol.length) % regimes.length];
    const regimeModifier = regime === "trend"
      ? plan.bias === "neutral" ? -4 : 8
      : regime === "range"
        ? plan.bias === "neutral" ? 8 : -3
        : regime === "volatile"
          ? plan.assetClass === "future" ? -6 : -2
          : -10;
    const random = pseudoRandom(i * 17 + plan.symbol.charCodeAt(0) * 13 + plan.efficiencyScore);
    const wins = random * 100 < baseWinRate + regimeModifier;
    const amplitude = 0.75 + pseudoRandom(i * 31 + plan.riskScore) * 0.65;
    const resultR = wins
      ? Number((avgWinRBase * amplitude).toFixed(2))
      : Number((-avgLossRBase * (0.8 + pseudoRandom(i * 43) * 0.45)).toFixed(2));

    equityR = Number((equityR + resultR).toFixed(2));
    peakR = Math.max(peakR, equityR);
    const drawdownR = Number((peakR - equityR).toFixed(2));
    maxDrawdownR = Math.max(maxDrawdownR, drawdownR);
    equityCurve.push({ trade: i, equityR, drawdownR });
    trades.push({
      id: i,
      regime,
      resultR,
      duration: plan.assetClass === "option" ? `${plan.dte ?? 1}DTE model` : plan.assetClass === "future" ? "intraday" : "swing",
    });
  }

  const wins = trades.filter((trade) => trade.resultR > 0);
  const losses = trades.filter((trade) => trade.resultR <= 0);
  const grossWin = wins.reduce((sum, trade) => sum + trade.resultR, 0);
  const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + trade.resultR, 0));
  const winRate = (wins.length / trades.length) * 100;
  const avgWinR = wins.length ? grossWin / wins.length : 0;
  const avgLossR = losses.length ? grossLoss / losses.length : 0;
  const expectancyR = (grossWin - grossLoss) / trades.length;
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin;
  const rawEdgeScore = expectancyR * 28 + profitFactor * 12 + winRate * 0.28 - maxDrawdownR * 2.6;
  const edgeScore = clamp(rawEdgeScore, 0, 94);
  const regimeStats = regimes.map((regime) => {
    const group = trades.filter((trade) => trade.regime === regime);
    const groupWins = group.filter((trade) => trade.resultR > 0);
    return {
      regime,
      trades: group.length,
      winRate: Number(((groupWins.length / group.length) * 100).toFixed(1)),
      expectancyR: Number((group.reduce((sum, trade) => sum + trade.resultR, 0) / group.length).toFixed(2)),
    };
  });
  const verdict = edgeScore >= 74
    ? "Promising edge in modeled conditions. Still require live confirmation."
    : edgeScore >= 58
      ? "Tradable only with strict filters and reduced size."
      : "No clean edge yet. Improve conditions or skip.";

  return {
    sampleSize,
    winRate: Number(winRate.toFixed(1)),
    avgWinR: Number(avgWinR.toFixed(2)),
    avgLossR: Number(avgLossR.toFixed(2)),
    expectancyR: Number(expectancyR.toFixed(2)),
    profitFactor: Number(profitFactor.toFixed(2)),
    maxDrawdownR: Number(maxDrawdownR.toFixed(2)),
    edgeScore: Math.round(edgeScore),
    equityCurve,
    regimeStats,
    recentTrades: trades.slice(-8).reverse(),
    verdict,
  };
}

export function buildScenarioCurve(plan: OpportunityPlan): ScenarioPoint[] {
  return [-3, -2, -1, 0, 1, 2, 3].map((movePct) => {
    const directional = plan.bias === "bearish" ? -movePct : plan.bias === "neutral" ? -Math.abs(movePct) + 1.25 : movePct;
    const optionLeverage = plan.assetClass === "option" ? 18 : 10;
    const thetaPenalty = (plan.thetaDrag ?? 20) / 18;
    const volBonus = Math.max(0, (plan.ivRank ?? 45) - 45) / 10;
    const optionReturn = clamp(directional * optionLeverage - thetaPenalty + volBonus, -100, 180);
    const futuresReturn = clamp(directional * 7.5 - plan.marginImpact * 0.05, -55, 80);
    const stockReturn = clamp(directional * 1.05, -12, 12);

    return {
      movePct,
      optionReturn: Number(optionReturn.toFixed(1)),
      futuresReturn: Number(futuresReturn.toFixed(1)),
      stockReturn: Number(stockReturn.toFixed(1)),
    };
  });
}

const qualityRank: Record<OpportunityPlan["quality"], number> = {
  Avoid: 0,
  C: 1,
  B: 2,
  A: 3,
};

export function evaluateTradeGate(
  plan: OpportunityPlan,
  backtest: StrategyLabResult,
  settings: RiskSettings,
  rules: StrategyRuleSet
): TradeGateResult {
  const requiredQuality = qualityRank[rules.requireQuality];
  const distance52WeekHigh = plan.week52High > 0 ? ((plan.week52High - plan.price) / plan.week52High) * 100 : 0;
  const smallAccountFilters = evaluateSmallAccountFilters(plan, settings);
  const checks: TradeGateCheck[] = [
    {
      label: "Setup quality",
      passed: qualityRank[plan.quality] >= requiredQuality,
      detail: `${plan.quality} setup, requires ${rules.requireQuality} or better`,
    },
    {
      label: "Modeled edge",
      passed: backtest.edgeScore >= settings.minEdgeScore,
      detail: `${backtest.edgeScore}/100 edge score, minimum ${settings.minEdgeScore}`,
    },
    {
      label: "Reward/risk",
      passed: !rules.requireRiskReward || plan.minRewardRisk >= settings.minRewardRisk,
      detail: `${plan.minRewardRisk.toFixed(1)}R setup, minimum ${settings.minRewardRisk.toFixed(1)}R`,
    },
    {
      label: "Trend confirmation",
      passed: !rules.requireTrendConfirmation || plan.bias === "neutral" || plan.trendScore >= 70,
      detail: `${plan.trendScore}/100 trend score`,
    },
    {
      label: "Flow confirmation",
      passed: !rules.requireFlowConfirmation || plan.flowScore >= 70,
      detail: `${plan.flowScore}/100 flow score`,
    },
    {
      label: "Liquidity",
      passed: !rules.requireLiquidity || (plan.volumeScore >= 75 && plan.spreadBps <= settings.maxOptionsSpreadBps),
      detail: `${plan.volumeScore}/100 volume, ${plan.spreadBps} bps spread`,
    },
    {
      label: "Small-account filters",
      passed: smallAccountFilters.passed,
      detail: `${settings.minUnderlyingPrice}-${settings.maxUnderlyingPrice} price range, ${settings.minVolumeScore}+ volume, ${settings.minDte}+ DTE`,
    },
    {
      label: "Event risk",
      passed: !rules.requireNoEventRisk || plan.eventRisk <= settings.blockEventRiskAbove,
      detail: `${plan.eventRisk}/100 event risk, block above ${settings.blockEventRiskAbove}`,
    },
    {
      label: "52-week context",
      passed: !rules.require52WeekContext || (distance52WeekHigh >= 1.0 && distance52WeekHigh <= 25.0 && plan.qualityCompanyScore >= 70),
      detail: `${distance52WeekHigh.toFixed(1)}% below 52-week high`,
    },
    {
      label: "Breakout/retest",
      passed: plan.retestStatus === "confirmed" || plan.retestStatus === "retesting",
      detail: `${plan.retestStatus} near ${plan.support.toFixed(2)} support / ${plan.resistance.toFixed(2)} resistance`,
    },
    {
      label: "Futures margin",
      passed: plan.assetClass !== "future" || plan.marginImpact <= settings.maxFuturesMarginPct,
      detail: `${plan.marginImpact}/100 margin impact`,
    },
  ];

  const failed = checks.filter((check) => !check.passed);
  const hardBlock = failed.some((check) => ["Setup quality", "Modeled edge", "Small-account filters", "Event risk", "Futures margin"].includes(check.label));
  const score = Math.round((checks.filter((check) => check.passed).length / checks.length) * 100);
  const allowedRiskPct = Math.min(settings.maxTradeRiskPct, plan.positionRiskPct);
  const suggestedDollarRisk = Math.round(settings.accountSize * (allowedRiskPct / 100));
  const maxDailyLoss = Math.round(settings.accountSize * (settings.maxDailyLossPct / 100));

  return {
    status: failed.length === 0 ? "approved" : hardBlock ? "blocked" : "wait",
    score,
    suggestedDollarRisk,
    maxDailyLoss,
    checks,
  };
}

export function evaluateSmallAccountFilters(plan: OpportunityPlan, settings: RiskSettings): SmallAccountFilterResult {
  if (plan.assetClass !== "option") {
    return { passed: true, checks: [] };
  }

  const checks: TradeGateCheck[] = [
    {
      label: "Underlying price",
      passed: plan.price >= settings.minUnderlyingPrice && plan.price <= settings.maxUnderlyingPrice,
      detail: `$${plan.price.toFixed(2)} within $${settings.minUnderlyingPrice}-$${settings.maxUnderlyingPrice}`,
    },
    {
      label: "Option liquidity",
      passed: plan.volumeScore >= settings.minVolumeScore && plan.spreadBps <= settings.maxOptionsSpreadBps,
      detail: `${plan.volumeScore}/100 volume and ${plan.spreadBps} bps spread`,
    },
    {
      label: "Expiration room",
      passed: (plan.dte ?? 0) >= settings.minDte || plan.preferredStructure.toLowerCase().includes("180 dte") || plan.preferredStructure.toLowerCase().includes("six-month"),
      detail: `${plan.dte ?? 0} DTE model, minimum ${settings.minDte}`,
    },
    {
      label: "Event risk",
      passed: plan.eventRisk <= settings.blockEventRiskAbove,
      detail: `${plan.eventRisk}/100 event risk`,
    },
  ];

  return {
    passed: checks.every((check) => check.passed),
    checks,
  };
}

export function buildOptionContractCandidates(plan: OpportunityPlan, settings: RiskSettings): OptionContractCandidate[] {
  if (plan.assetClass !== "option") return [];

  const allowedRisk = settings.accountSize * (Math.min(settings.maxTradeRiskPct, settings.maxPremiumRiskPct) / 100);
  const maxAffordablePremium = Math.min(settings.maxOptionPremium, allowedRisk / 100);
  const distanceToResistance = plan.resistance > plan.price ? (plan.resistance - plan.price) / plan.price : 0.02;
  const baseStrike = plan.bias === "bearish"
    ? plan.price * 0.96
    : plan.price * (1 + Math.max(0.02, Math.min(0.12, distanceToResistance + 0.02)));
  const dteSet = [30, 45, 90, 180];
  const deltaSet = [0.18, 0.25, 0.35, 0.45];

  return dteSet.map((dte, index) => {
    const delta = deltaSet[index];
    const timeValue = Math.sqrt(dte / 365);
    const ivFactor = Math.max(0.18, (plan.ivRank ?? 45) / 100);
    const rawPremium = plan.price * delta * timeValue * ivFactor * 0.52;
    const estimatedPremium = Number(Math.max(settings.minOptionPremium, rawPremium).toFixed(2));
    const maxLoss = Math.round(estimatedPremium * 100);
    const spreadWidth = plan.price < 35 ? 1 : plan.price < 80 ? 2.5 : 5;
    const estimatedSpreadDebit = Number(Math.max(settings.minOptionPremium, Math.min(estimatedPremium * 0.35, spreadWidth * 0.42, maxAffordablePremium)).toFixed(2));
    const spreadMaxLoss = Math.round(estimatedSpreadDebit * 100);
    const maxLongCallContracts = Math.floor(allowedRisk / maxLoss);
    const maxSpreadContracts = Math.floor(allowedRisk / spreadMaxLoss);
    const strike = Number((Math.round(baseStrike / (plan.price < 30 ? 1 : 5)) * (plan.price < 30 ? 1 : 5)).toFixed(2));
    const reasons: string[] = [];
    const skipReasons: string[] = [];

    if (plan.price < settings.minUnderlyingPrice || plan.price > settings.maxUnderlyingPrice) skipReasons.push("Underlying outside small-account price filter.");
    if (plan.spreadBps > settings.maxOptionsSpreadBps) skipReasons.push("Spread is wider than your filter.");
    if (dte < settings.minDte) skipReasons.push("Expiration is too close for the current rules.");
    if (plan.eventRisk > settings.blockEventRiskAbove) skipReasons.push("Event risk is too high.");
    if (plan.retestStatus === "failed" || plan.higherTimeframeTrend === "downtrend") skipReasons.push("Chart structure is not supportive.");
    if (estimatedPremium < settings.minOptionPremium) skipReasons.push("Premium is below the minimum quality band.");
    if (estimatedPremium > maxAffordablePremium) skipReasons.push("Long option premium is above the account cap.");
    if (estimatedPremium <= 0.15) reasons.push("Very cheap premium: treat as lottery risk unless the stock confirms strongly.");
    if (maxLongCallContracts < 1 && maxSpreadContracts >= 1) reasons.push("Long call exceeds risk budget; spread fits better.");
    if (maxLongCallContracts >= 1 && estimatedPremium <= maxAffordablePremium) reasons.push("Long option fits the low-premium budget.");
    if (maxSpreadContracts < 1) skipReasons.push("Even the spread is too large for current risk budget.");

    const verdict: OptionContractCandidate["verdict"] =
      plan.quality === "Avoid" || skipReasons.some((reason) => ["Event risk is too high.", "Chart structure is not supportive."].includes(reason))
        ? "skip"
        : maxLongCallContracts >= 1 && estimatedPremium <= maxAffordablePremium && plan.spreadBps <= settings.maxOptionsSpreadBps
          ? "long_call_ok"
        : maxSpreadContracts >= 1
            ? "spread_only"
            : "too_expensive";
    const profitTargetPct = dte >= 120 ? 65 : dte >= 90 ? 50 : 35;
    const stopLossPct = dte >= 120 ? 35 : 30;
    const riskUnit = verdict === "long_call_ok" ? maxLoss : spreadMaxLoss;
    const capitalEfficiencyScore = Math.round(clamp(
      plan.efficiencyScore * 0.4 +
      (profitTargetPct / Math.max(10, stopLossPct)) * 18 +
      (allowedRisk / Math.max(1, riskUnit)) * 10 -
      plan.spreadBps * 0.8 -
      (plan.thetaDrag ?? 40) * 0.12,
      0,
      100
    ));

    return {
      label: `${dte}D ${plan.bias === "bearish" ? "put" : "call"} ${strike}`,
      dte,
      strike,
      delta,
      estimatedPremium,
      maxLoss,
      estimatedSpreadDebit,
      spreadMaxLoss,
      spreadWidth,
      maxLongCallContracts,
      maxSpreadContracts,
      capitalEfficiencyScore,
      profitTargetPct,
      stopLossPct,
      verdict,
      reasons,
      skipReasons,
    };
  });
}

export function buildProfitEfficiencyPlan(plan: OpportunityPlan, settings: RiskSettings): ProfitEfficiencyPlan {
  if (plan.assetClass !== "option") {
    return {
      score: 0,
      style: "skip",
      primarySkipReason: "This workflow is currently optimized for options only.",
      exitRules: ["Skip non-options until futures/stocks workflow is re-enabled."],
      capitalRule: "Keep capital reserved for options setups that fit the account rules.",
    };
  }

  const candidates = buildOptionContractCandidates(plan, settings);
  const best = candidates.find((candidate) => candidate.verdict === "long_call_ok") ?? candidates.find((candidate) => candidate.verdict === "spread_only") ?? candidates[0];
  const distancePct = plan.week52High > 0 ? ((plan.week52High - plan.price) / plan.week52High) * 100 : 0;
  const style: ProfitEfficiencyPlan["style"] =
    !best || best.verdict === "skip" || best.verdict === "too_expensive"
      ? "skip"
      : best.verdict === "spread_only"
        ? "debit_spread"
        : distancePct >= 8 && best.dte >= 120
          ? "six_month_call"
          : best.dte >= 45
            ? "swing_call"
            : "day_trade";
  const primarySkipReason = best?.skipReasons[0]
    ?? (best?.verdict === "too_expensive" ? "Premium exceeds risk budget." : "")
    ?? "";
  const exitRules = style === "six_month_call"
    ? ["Take partial profit at +50-65%.", "Cut if premium loses 35% or support breaks.", "Exit before earnings if IV/event risk is elevated."]
    : style === "debit_spread"
      ? ["Target 45-60% of max spread value.", "Cut if spread loses 30% or retest fails.", "Do not add to losing spreads."]
      : style === "swing_call"
        ? ["Take partial at +35-50%.", "Cut at -30% premium loss.", "Exit if price loses support or volume fades."]
        : ["No trade unless all filters pass."];
  const capitalRule = best
    ? best.verdict === "long_call_ok"
      ? `Risk at most ${Math.max(1, best.maxLongCallContracts)} contract(s); no averaging down.`
      : best.verdict === "spread_only"
        ? `Use defined-risk spread only; max ${Math.max(1, best.maxSpreadContracts)} spread(s).`
        : "Do not trade this contract with current account risk settings."
    : "No viable contract candidate.";

  return {
    score: best?.capitalEfficiencyScore ?? 0,
    style,
    primarySkipReason: primarySkipReason || "No primary skip reason under current rules.",
    exitRules,
    capitalRule,
  };
}

export function buildOptionReasoningReport(
  plan: OpportunityPlan,
  settings: RiskSettings,
  rules: StrategyRuleSet
): OptionReasoningReport {
  if (plan.assetClass !== "option") {
    return {
      verdict: "skip",
      confidence: "low",
      score: 0,
      summary: "This reasoning engine is focused on options setups. Select an option candidate for contract-level scoring.",
      scores: [],
      strengths: [],
      risks: ["Non-options setup selected."],
      nextAction: "Keep this on a separate stock/futures workflow.",
    };
  }

  const backtest = runModeledBacktest(plan, 80);
  const gate = evaluateTradeGate(plan, backtest, settings, rules);
  const candidates = buildOptionContractCandidates(plan, settings);
  const bestContract =
    candidates.find((candidate) => candidate.verdict === "long_call_ok") ??
    candidates.find((candidate) => candidate.verdict === "spread_only") ??
    candidates[0];
  const learnedPattern = learnedWinnerPatterns.find((pattern) => pattern.symbol === plan.symbol);
  const similarPattern = tomorrowSimilarityCandidates.find((candidate) => candidate.symbol === plan.symbol);
  const distance52WeekHigh = plan.week52High > 0 ? ((plan.week52High - plan.price) / plan.week52High) * 100 : 0;
  const supportGapPct = plan.price > 0 ? ((plan.price - plan.support) / plan.price) * 100 : 99;
  const dipReboundCandidate =
    plan.changePct < 0 &&
    plan.higherTimeframeTrend === "uptrend" &&
    plan.trendScore >= 70 &&
    plan.flowScore >= 65 &&
    plan.retestStatus !== "failed" &&
    supportGapPct <= 10;
  const contractFit = bestContract
    ? bestContract.verdict === "long_call_ok"
      ? bestContract.capitalEfficiencyScore
      : bestContract.verdict === "spread_only"
        ? Math.max(45, bestContract.capitalEfficiencyScore - 8)
        : Math.min(38, bestContract.capitalEfficiencyScore)
    : 0;
  const patternScore = learnedPattern?.patternScore ?? similarPattern?.similarityScore ?? 42;
  const underlyingScore = clamp(
    plan.trendScore * 0.27 +
    plan.flowScore * 0.23 +
    plan.volumeScore * 0.22 +
    plan.qualityCompanyScore * 0.16 +
    (distance52WeekHigh >= 1 && distance52WeekHigh <= 25 ? 10 : distance52WeekHigh < 1 ? 3 : -4) +
    (plan.retestStatus === "confirmed" ? 8 : plan.retestStatus === "retesting" ? 4 : plan.retestStatus === "failed" ? -12 : 0),
    0,
    100
  );
  const catalystScore = clamp(
    plan.catalystScore * 0.7 +
    Math.abs(plan.changePct) * 4 +
    (plan.session === "pre-market" || plan.session === "open-drive" ? 7 : 0) -
    (plan.eventRisk > settings.blockEventRiskAbove ? 12 : 0),
    0,
    100
  );
  const riskScore = clamp(
    100 -
    plan.riskScore * 0.36 -
    plan.eventRisk * 0.18 -
    plan.spreadBps * 1.5 -
    (plan.thetaDrag ?? 40) * 0.12 +
    gate.score * 0.18,
    0,
    100
  );
  const score = Math.round(clamp(
    underlyingScore * 0.25 +
    catalystScore * 0.18 +
    contractFit * 0.25 +
    patternScore * 0.14 +
    riskScore * 0.18,
    0,
    100
  ));
  const hardContractBlock = !bestContract || bestContract.verdict === "skip" || bestContract.verdict === "too_expensive";
  const hardGateBlock = gate.status === "blocked";
  const verdict: OptionReasoningReport["verdict"] =
    score >= 76 && gate.status === "approved" && !hardContractBlock
      ? "trade_candidate"
      : score >= 58 && !hardGateBlock && bestContract?.verdict !== "skip"
        ? "watch_only"
        : "skip";
  const confidence: OptionReasoningReport["confidence"] = score >= 78 && backtest.edgeScore >= 65
    ? "high"
    : score >= 60 && backtest.edgeScore >= 52
      ? "medium"
      : "low";

  const strengths = [
    underlyingScore >= 70 ? `Underlying confirms: ${plan.trendScore}/100 trend, ${plan.flowScore}/100 flow, ${plan.volumeScore}/100 volume.` : "",
    catalystScore >= 70 ? `Catalyst is active enough for options attention: ${plan.catalystScore}/100 catalyst score and ${plan.changePct >= 0 ? "+" : ""}${plan.changePct.toFixed(1)}% move.` : "",
    bestContract && bestContract.verdict === "long_call_ok" ? `${bestContract.label} fits the premium budget near $${bestContract.estimatedPremium.toFixed(2)}.` : "",
    bestContract && bestContract.verdict === "spread_only" ? `${bestContract.label} needs defined-risk spread structure, not a naked long call.` : "",
    learnedPattern ? `Matches learned winner pattern: ${learnedPattern.searchSignal}` : "",
    !learnedPattern && similarPattern ? `Matches new discovery theme: ${similarPattern.theme.replace(/_/g, " ")}.` : "",
    distance52WeekHigh >= 1 && distance52WeekHigh <= 25 ? `${distance52WeekHigh.toFixed(1)}% below 52-week high leaves upside context without being too extended.` : "",
    dipReboundCandidate ? `Dip-rebound setup: option/stock is red, but trend and flow remain bullish near support.` : "",
  ].filter(Boolean);

  const failedChecks = gate.checks.filter((check) => !check.passed).map((check) => `${check.label}: ${check.detail}`);
  const contractRisks = bestContract?.skipReasons ?? [];
  const risks = [
    plan.eventRisk > settings.blockEventRiskAbove ? `Event risk is above your block level: ${plan.eventRisk}/100.` : "",
    plan.spreadBps > settings.maxOptionsSpreadBps ? `Spread is too wide for the rule set: ${plan.spreadBps} bps.` : "",
    (plan.thetaDrag ?? 0) > 60 ? `Theta drag is elevated at ${plan.thetaDrag}/100; avoid slow holds.` : "",
    plan.changePct < 0 && !dipReboundCandidate ? "Red option is not a qualified rebound yet; wait for reclaim instead of catching the drop." : "",
    distance52WeekHigh > 25 ? `${distance52WeekHigh.toFixed(1)}% below 52-week high may mean a broken structure, not a clean pullback.` : "",
    distance52WeekHigh < 1 ? "Stock is already pressing the 52-week high; avoid chasing without a retest." : "",
    ...contractRisks,
    ...failedChecks.slice(0, 2),
  ].filter(Boolean).slice(0, 5);

  const nextAction = verdict === "trade_candidate"
    ? dipReboundCandidate
      ? `Dip-rebound watch: wait for VWAP/opening-range reclaim or hold above $${plan.support.toFixed(2)}. Use ${bestContract?.verdict === "spread_only" ? "a debit spread" : "the budget-fit long option"} only after confirmation.`
      : `Consider only after trigger confirms: ${plan.trigger}. Use ${bestContract?.verdict === "spread_only" ? "a debit spread" : "the budget-fit long option"} and invalidate at: ${plan.invalidation}.`
    : verdict === "watch_only"
      ? dipReboundCandidate
        ? `Watch the discount, do not chase it. Require a reclaim/hold above $${plan.support.toFixed(2)}, improving bid, and no new lower low.`
        : `Watch first. Wait for ${plan.trigger}; reject it if contracts widen, VWAP fails, or the option chain does not show volume/open interest.`
      : `Skip under current rules. Main blocker: ${risks[0] ?? "score, contract fit, or trade gate is too weak."}`;
  const summary = verdict === "trade_candidate"
    ? "Strong enough for a prepared trade plan after live broker confirmation."
    : verdict === "watch_only"
      ? "Interesting setup, but it needs confirmation before capital goes at risk."
      : "Not good enough for this account/risk filter right now.";

  return {
    verdict,
    confidence,
    score,
    summary,
    bestContract,
    scores: [
      { label: "Underlying", score: Math.round(underlyingScore), detail: `${plan.trendScore}/100 trend, ${plan.flowScore}/100 flow, ${plan.volumeScore}/100 volume` },
      { label: "Catalyst", score: Math.round(catalystScore), detail: `${plan.catalystScore}/100 catalyst, ${plan.eventRisk}/100 event risk` },
      { label: "Contract", score: Math.round(contractFit), detail: bestContract ? `${bestContract.verdict.replace(/_/g, " ")} / $${bestContract.estimatedPremium.toFixed(2)} quote model` : "No contract candidate" },
      { label: "Pattern", score: Math.round(patternScore), detail: learnedPattern?.theme.replace(/_/g, " ") ?? similarPattern?.theme.replace(/_/g, " ") ?? "No learned-winner match" },
      { label: "Risk", score: Math.round(riskScore), detail: `${gate.status} gate, ${gate.score}% rules passed` },
    ],
    strengths: strengths.slice(0, 5),
    risks,
    nextAction,
  };
}

export function calculatePassHitVerification(
  plan: OpportunityPlan,
  settings: RiskSettings,
  rules: StrategyRuleSet
): PassHitVerification {
  const backtest = runModeledBacktest(plan, 80);
  const gate = evaluateTradeGate(plan, backtest, settings, rules);
  const smallFilters = evaluateSmallAccountFilters(plan, settings);
  const passRate = Math.round((gate.checks.filter((check) => check.passed).length / gate.checks.length) * 100);
  const hitRate = backtest.winRate;
  const confidence: PassHitVerification["confidence"] =
    passRate >= 85 && hitRate >= 55 && backtest.expectancyR > 0.35
      ? "verified"
      : passRate >= 70 && hitRate >= 50 && backtest.expectancyR > 0
        ? "watch"
        : "unverified";
  const readiness: PassHitVerification["readiness"] =
    gate.status === "approved" && smallFilters.passed && confidence !== "unverified"
      ? "trade_ready"
      : gate.status === "blocked" || confidence === "unverified"
        ? "do_not_trade"
        : "wait_for_open";
  const summary = `${passRate}% rule pass rate, ${hitRate.toFixed(1)}% modeled hit rate, ${backtest.expectancyR.toFixed(2)}R expectancy.`;
  const requiredAction = readiness === "trade_ready"
    ? "Use only after live spread, support/retest, and contract affordability confirm after the open."
    : readiness === "wait_for_open"
      ? "Watch at the open; do not enter until failed checks turn green."
      : "Skip until pass rate, hit rate, or small-account filters improve.";

  return {
    passRate,
    hitRate,
    expectancyR: backtest.expectancyR,
    sampleSize: backtest.sampleSize,
    confidence,
    readiness,
    summary,
    requiredAction,
  };
}
