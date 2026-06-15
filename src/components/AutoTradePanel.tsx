import { Bot, Power, PowerOff, Settings2, Shield, Clock, Activity, Loader2, TrendingUp, TrendingDown, BarChart3, Filter, AlertCircle, Zap, Target, Award, Gauge, Timer, DollarSign, ChevronDown, ChevronUp, CircleCheck, CircleX, Flame, Landmark, Crosshair, Ban } from "lucide-react";
import { getTierColor, getTierBgColor, type AdaptiveRiskProfile } from "@/lib/adaptiveRisk";
import { AutoTradeConfig, AutoTradeLog, AutoTradeStats, KillSwitchState, KILL_SWITCH_LIMITS } from "@/hooks/useAutoTrading";
import { type MarketSession } from "@/lib/marketHours";
import { getMarketStatusLabel } from "@/lib/marketHours";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useState, useMemo } from "react";
import { getAutoDisableConfig, saveAutoDisableConfig, getDisabledConditions, type AutoDisableConfig } from "@/lib/predictionFeedback";
import { KillSwitchBanner } from "@/components/KillSwitchBanner";
import { AutoTraderRegimeBadge } from "@/components/AutoTraderRegimeBadge";
import { PerformancePanel } from "@/components/PerformancePanel";

interface AutoTradePanelProps {
  config: AutoTradeConfig;
  onConfigChange: (config: AutoTradeConfig) => void;
  logs: AutoTradeLog[];
  isAnalyzing: boolean;
  positionCount: number;
  stats: AutoTradeStats;
  marketSession: MarketSession;
  killSwitch?: KillSwitchState;
}

function PerformanceGrade({ stats }: { stats: AutoTradeStats }) {
  const winRate = stats.totalTrades > 0 ? (stats.winningTrades / stats.totalTrades) * 100 : 0;
  const pf = stats.profitFactor;
  const sharpe = stats.sharpeEstimate;

  let grade = "F";
  let gradeColor = "text-loss";
  let gradeBg = "bg-loss/10";

  if (stats.totalTrades < 3) {
    grade = "—";
    gradeColor = "text-muted-foreground";
    gradeBg = "bg-secondary";
  } else if (winRate >= 65 && pf > 2 && sharpe > 1.5) {
    grade = "A+";
    gradeColor = "text-gain";
    gradeBg = "bg-gain/15";
  } else if (winRate >= 55 && pf > 1.5 && sharpe > 1) {
    grade = "A";
    gradeColor = "text-gain";
    gradeBg = "bg-gain/10";
  } else if (winRate >= 50 && pf > 1.2 && sharpe > 0.5) {
    grade = "B";
    gradeColor = "text-accent";
    gradeBg = "bg-accent/10";
  } else if (winRate >= 45 && pf > 1) {
    grade = "C";
    gradeColor = "text-warning";
    gradeBg = "bg-warning/10";
  } else if (pf > 0.8) {
    grade = "D";
    gradeColor = "text-warning";
    gradeBg = "bg-warning/10";
  }

  return (
    <div className={`flex items-center justify-center w-10 h-10 rounded-lg ${gradeBg} ${gradeColor} text-lg font-bold font-mono`}>
      {grade}
    </div>
  );
}

function MiniSparkline({ logs }: { logs: AutoTradeLog[] }) {
  const pnlPoints = useMemo(() => {
    const closeTrades = logs.filter(l => l.action === "close" && l.pnl !== undefined).reverse();
    if (closeTrades.length < 2) return null;

    let cumPnl = 0;
    return closeTrades.map(t => {
      cumPnl += t.pnl!;
      return cumPnl;
    });
  }, [logs]);

  if (!pnlPoints || pnlPoints.length < 2) return null;

  const min = Math.min(...pnlPoints);
  const max = Math.max(...pnlPoints);
  const range = max - min || 1;
  const w = 120;
  const h = 28;
  const step = w / (pnlPoints.length - 1);

  const points = pnlPoints.map((v, i) => `${i * step},${h - ((v - min) / range) * h}`).join(" ");
  const isPositive = pnlPoints[pnlPoints.length - 1] >= 0;

  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline
        points={points}
        fill="none"
        stroke={isPositive ? "hsl(145, 80%, 42%)" : "hsl(0, 72%, 51%)"}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <line x1="0" y1={h - ((0 - min) / range) * h} x2={w} y2={h - ((0 - min) / range) * h}
        stroke="hsl(215, 15%, 25%)" strokeWidth="0.5" strokeDasharray="2 2" />
    </svg>
  );
}

function TradeHeatmap({ logs }: { logs: AutoTradeLog[] }) {
  const symbolMap = useMemo(() => {
    const map: Record<string, { wins: number; losses: number; total: number; pnl: number }> = {};
    for (const log of logs) {
      if (log.action !== "close" || log.pnl === undefined) continue;
      if (!map[log.symbol]) map[log.symbol] = { wins: 0, losses: 0, total: 0, pnl: 0 };
      map[log.symbol].total++;
      map[log.symbol].pnl += log.pnl;
      if (log.pnl >= 0) map[log.symbol].wins++;
      else map[log.symbol].losses++;
    }
    return Object.entries(map).sort((a, b) => Math.abs(b[1].pnl) - Math.abs(a[1].pnl)).slice(0, 8);
  }, [logs]);

  if (symbolMap.length === 0) return null;

  return (
    <div className="space-y-1">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
        <Flame className="w-3 h-3" /> Symbol Performance
      </div>
      <div className="grid grid-cols-4 gap-1">
        {symbolMap.map(([sym, data]) => {
          const isPositive = data.pnl >= 0;
          const winRate = data.total > 0 ? (data.wins / data.total) * 100 : 0;
          return (
            <div key={sym} className={`p-1.5 rounded text-center border ${isPositive ? "bg-gain/5 border-gain/15" : "bg-loss/5 border-loss/15"}`}>
              <div className="text-[9px] font-mono font-semibold text-foreground">{sym}</div>
              <div className={`text-[10px] font-mono font-bold ${isPositive ? "text-gain" : "text-loss"}`}>
                {isPositive ? "+" : ""}${data.pnl.toFixed(0)}
              </div>
              <div className="text-[7px] text-muted-foreground">{data.total}T • {winRate.toFixed(0)}%W</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AutoDisableToggle() {
  const [config, setConfig] = useState<AutoDisableConfig>(getAutoDisableConfig);
  const disabled = useMemo(() => getDisabledConditions(), [config]);

  const updateConfig = (updates: Partial<AutoDisableConfig>) => {
    const newConfig = { ...config, ...updates };
    setConfig(newConfig);
    saveAutoDisableConfig(newConfig);
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between p-2 rounded bg-secondary/30 border border-border/50">
        <div>
          <div className="text-[11px] text-foreground font-medium flex items-center gap-1">
            <Ban className="w-3 h-3 text-loss" /> Auto-Disable Weak Indicators
          </div>
          <div className="text-[8px] text-muted-foreground">
            Disable conditions below {Math.round(config.minWinRate * 100)}% WR after {config.minSamples}+ samples
          </div>
        </div>
        <Switch checked={config.enabled} onCheckedChange={(v) => updateConfig({ enabled: v })} />
      </div>
      {config.enabled && (
        <div className="space-y-1.5 p-2 rounded bg-loss/5 border border-loss/10">
          <div className="flex justify-between text-[11px]">
            <span className="text-muted-foreground">Min Win Rate</span>
            <span className="font-mono text-loss">{Math.round(config.minWinRate * 100)}%</span>
          </div>
          <Slider value={[config.minWinRate * 100]} min={20} max={50} step={5}
            onValueChange={([v]) => updateConfig({ minWinRate: v / 100 })} className="py-1" />
          <div className="flex justify-between text-[11px]">
            <span className="text-muted-foreground">Min Samples</span>
            <span className="font-mono text-foreground">{config.minSamples}</span>
          </div>
          <Slider value={[config.minSamples]} min={5} max={30} step={5}
            onValueChange={([v]) => updateConfig({ minSamples: v })} className="py-1" />
          {disabled.size > 0 && (
            <div className="space-y-0.5">
              <div className="text-[8px] text-loss uppercase tracking-wider">Disabled ({disabled.size}):</div>
              <div className="flex flex-wrap gap-0.5">
                {Array.from(disabled).slice(0, 8).map(c => (
                  <span key={c} className="text-[8px] px-1.5 py-0.5 rounded bg-loss/10 text-loss font-mono">
                    {c.replace(":", "→").replace(/_/g, " ")}
                  </span>
                ))}
                {disabled.size > 8 && <span className="text-[8px] text-muted-foreground">+{disabled.size - 8} more</span>}
              </div>
            </div>
          )}
          {disabled.size === 0 && (
            <div className="text-[9px] text-muted-foreground">No conditions disabled yet — need {config.minSamples}+ samples to evaluate</div>
          )}
        </div>
      )}
    </div>
  );
}

export function AutoTradePanel({ config, onConfigChange, logs, isAnalyzing, positionCount, stats, marketSession, killSwitch }: AutoTradePanelProps) {
  const [showSettings, setShowSettings] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [logFilter, setLogFilter] = useState<"all" | "open" | "close" | "skip" | "alert">("all");
  const marketStatus = getMarketStatusLabel();

  const filteredLogs = logFilter === "all" ? logs : logs.filter(l => l.action === logFilter);
  const winRate = stats.totalTrades > 0 ? ((stats.winningTrades / stats.totalTrades) * 100).toFixed(1) : "--";
  const sessionMinutes = Math.floor((Date.now() - stats.sessionStart) / 60000);
  const sessionHours = Math.floor(sessionMinutes / 60);
  const sessionMins = sessionMinutes % 60;

  const recentWinStreak = useMemo(() => {
    const closeTrades = logs.filter(l => l.action === "close" && l.pnl !== undefined);
    let streak = 0;
    for (const t of closeTrades) {
      if (t.pnl! >= 0) streak++;
      else break;
    }
    return streak;
  }, [logs]);

  return (
    <div className="bg-card rounded-lg border border-border p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Bot className="w-4 h-4 text-accent" />
          Auto-Trade
          {config.enabled && (
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-gain/15 text-gain font-mono flex items-center gap-1 animate-pulse">
              {isAnalyzing ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Activity className="w-2.5 h-2.5" />}
              LIVE
            </span>
          )}
          {config.alpacaEnabled && (
            <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono flex items-center gap-1 ${
              config.alpacaMode === "live" 
                ? "bg-loss/15 text-loss border border-loss/20" 
                : "bg-accent/15 text-accent border border-accent/20"
            }`}>
              <Landmark className="w-2.5 h-2.5" />
              {config.alpacaMode === "live" ? "LIVE $" : "PAPER"}
            </span>
          )}
        </h3>
        <div className="flex items-center gap-2">
          <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono ${marketStatus.color} bg-secondary`}>
            {config.allHoursTrading ? "24/7" : marketStatus.label}
          </span>
          <button onClick={() => setShowSettings(!showSettings)}
            className="p-1 rounded hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground">
            <Settings2 className="w-3.5 h-3.5" />
          </button>
          <Switch checked={config.enabled} onCheckedChange={(enabled) => onConfigChange({ ...config, enabled })} />
        </div>
      </div>

      {/* Status Banners */}
      <KillSwitchBanner />
      <div className="mb-3 flex items-center justify-end">
        <AutoTraderRegimeBadge />
      </div>
      <div className="mb-3">
        <PerformancePanel />
      </div>
      {config.enabled && !config.allHoursTrading && marketSession !== "regular" && (
        <div className="p-2 rounded bg-warning/10 border border-warning/20 text-[10px] text-warning flex items-start gap-1.5 mb-3">
          <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
          <span>Market {marketSession === "closed" ? "closed" : `in ${marketSession}`}. Trades paused until regular hours.</span>
        </div>
      )}
      {config.enabled && config.allHoursTrading && (
        <div className="p-2 rounded bg-accent/10 border border-accent/20 text-[10px] text-accent flex items-start gap-1.5 mb-3">
          <Zap className="w-3 h-3 mt-0.5 shrink-0" />
          <span>24/7 mode — executing regardless of market hours.</span>
        </div>
      )}
      {config.enabled && stats.consecutiveLosses >= 2 && (
        <div className="p-2 rounded bg-loss/10 border border-loss/20 text-[10px] text-loss flex items-start gap-1.5 mb-3">
          <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
          <span>{stats.consecutiveLosses} consecutive losses. {stats.consecutiveLosses >= 3 ? "Trading paused." : "Approaching pause."}</span>
        </div>
      )}

      {/* === DAILY P&L SUMMARY + KILL-SWITCH STATUS === */}
      {killSwitch && (
        <div className="mb-3 p-3 rounded-lg border bg-secondary/40 border-border/60 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              <Shield className="w-3 h-3" /> Daily P&L Summary
            </div>
            <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono font-bold ${killSwitch.active ? "bg-loss/20 text-loss border border-loss/30" : "bg-gain/15 text-gain border border-gain/20"}`}>
              {killSwitch.active ? "🛑 STOPPED" : "✅ ACTIVE"}
            </span>
          </div>

          {killSwitch.active && (
            <div className="p-2 rounded bg-loss/10 border border-loss/20 text-[10px] text-loss flex items-start gap-1.5">
              <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
              <div>
                <div className="font-semibold">Kill-switch tripped</div>
                <div className="text-[9px] opacity-90">{killSwitch.reason}</div>
                <div className="text-[8px] opacity-70 mt-0.5">Re-enable Auto-Trade switch to resume.</div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-4 gap-1.5">
            <div className="p-2 rounded bg-secondary/50 text-center">
              <div className="text-[8px] text-muted-foreground uppercase">Today P&L</div>
              <div className={`text-sm font-mono font-bold ${stats.dailyPnl >= 0 ? "text-gain" : "text-loss"}`}>
                {stats.dailyPnl >= 0 ? "+" : ""}${stats.dailyPnl.toFixed(2)}
              </div>
            </div>
            <div className="p-2 rounded bg-secondary/50 text-center">
              <div className="text-[8px] text-muted-foreground uppercase">Trades Today</div>
              <div className={`text-sm font-mono font-bold ${killSwitch.tradesToday >= KILL_SWITCH_LIMITS.maxTradesPerDay ? "text-warning" : "text-foreground"}`}>
                {killSwitch.tradesToday}/{KILL_SWITCH_LIMITS.maxTradesPerDay}
              </div>
            </div>
            <div className="p-2 rounded bg-secondary/50 text-center">
              <div className="text-[8px] text-muted-foreground uppercase">Loss Streak</div>
              <div className={`text-sm font-mono font-bold ${stats.consecutiveLosses >= 2 ? "text-loss" : "text-foreground"}`}>
                {stats.consecutiveLosses}/{KILL_SWITCH_LIMITS.maxConsecutiveLosses}
              </div>
            </div>
            <div className="p-2 rounded bg-secondary/50 text-center">
              <div className="text-[8px] text-muted-foreground uppercase">Worst Trade</div>
              <div className="text-sm font-mono font-bold text-loss">
                ${stats.worstTrade.toFixed(2)}
              </div>
            </div>
          </div>

          <div className="text-[8px] text-muted-foreground leading-relaxed">
            <span className="font-semibold text-foreground">Kill-switches:</span> Daily DD ≥{KILL_SWITCH_LIMITS.maxDailyDrawdownPct}% • {KILL_SWITCH_LIMITS.maxConsecutiveLosses} consecutive losses • Single loss ≥{KILL_SWITCH_LIMITS.maxSingleTradeLossPct}% • Max {KILL_SWITCH_LIMITS.maxTradesPerDay} trades/day
          </div>
        </div>
      )}

      {/* Performance Overview */}
      {config.enabled && (
        <div className="mb-3 space-y-2">
          {/* Main stats with grade */}
          <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary/30 border border-border/50">
            <PerformanceGrade stats={stats} />
            <div className="flex-1 grid grid-cols-3 gap-2">
              <div>
                <div className="text-[8px] text-muted-foreground uppercase">Session P&L</div>
                <div className={`text-sm font-mono font-bold ${stats.totalPnl >= 0 ? "text-gain" : "text-loss"}`}>
                  {stats.totalPnl >= 0 ? "+" : ""}${stats.totalPnl.toFixed(0)}
                </div>
              </div>
              <div>
                <div className="text-[8px] text-muted-foreground uppercase">Win Rate</div>
                <div className={`text-sm font-mono font-bold ${parseFloat(winRate) >= 50 ? "text-gain" : "text-loss"}`}>{winRate}%</div>
              </div>
              <div>
                <div className="text-[8px] text-muted-foreground uppercase">Trades</div>
                <div className="text-sm font-mono font-bold text-foreground">{stats.totalTrades}</div>
              </div>
            </div>
            <MiniSparkline logs={logs} />
          </div>

          {/* Detailed stats grid */}
          <div className="grid grid-cols-4 gap-1.5">
            {[
              { label: "Day P&L", value: `${stats.dailyPnl >= 0 ? "+" : ""}$${stats.dailyPnl.toFixed(0)}`, color: stats.dailyPnl >= 0 ? "text-gain" : "text-loss" },
              { label: "Sharpe", value: stats.sharpeEstimate ? stats.sharpeEstimate.toFixed(2) : "--", color: stats.sharpeEstimate > 1 ? "text-gain" : stats.sharpeEstimate > 0 ? "text-warning" : "text-loss" },
              { label: "Profit F.", value: stats.profitFactor ? (stats.profitFactor === Infinity ? "∞" : stats.profitFactor.toFixed(2)) : "--", color: stats.profitFactor > 1 ? "text-gain" : "text-loss" },
              { label: "Max DD", value: `$${stats.maxDrawdown.toFixed(0)}`, color: "text-loss" },
              { label: "Avg Conf", value: `${stats.avgConfidence || "--"}%`, color: "text-accent" },
              { label: "Kelly %", value: stats.kellyFraction ? `${(stats.kellyFraction * 100).toFixed(1)}%` : "--", color: stats.kellyFraction > 0.03 ? "text-gain" : "text-muted-foreground" },
              { label: "Avg Hold", value: stats.avgHoldTime ? `${Math.floor(stats.avgHoldTime / 60000)}m` : "--", color: "text-foreground" },
              { label: "Skipped", value: `${stats.tradesSkipped}`, color: "text-muted-foreground" },
              { label: "📊 Edge", value: `${stats.statEdgeTrades}`, color: stats.statEdgeTrades > 0 ? "text-accent" : "text-muted-foreground" },
            ].map(stat => (
              <div key={stat.label} className="p-1.5 rounded bg-secondary/40 text-center">
                <div className="text-[7px] text-muted-foreground uppercase">{stat.label}</div>
                <div className={`text-[11px] font-mono font-semibold ${stat.color}`}>{stat.value}</div>
              </div>
            ))}
          </div>

          {/* Session info & streaks */}
          <div className="flex items-center justify-between text-[9px] font-mono text-muted-foreground px-1">
            <span className="flex items-center gap-1">
              <Timer className="w-3 h-3" />
              {sessionHours > 0 ? `${sessionHours}h ${sessionMins}m` : `${sessionMins}m`} session
            </span>
            <span className="flex items-center gap-1">
              <Award className="w-3 h-3" />
              {positionCount}/{config.maxOpenPositions} positions
            </span>
            {recentWinStreak >= 2 && (
              <span className="flex items-center gap-1 text-gain">
                <Flame className="w-3 h-3" />
                {recentWinStreak} win streak 🔥
              </span>
            )}
          </div>

          {/* Best/Worst */}
          {stats.totalTrades > 0 && (
            <div className="grid grid-cols-2 gap-1.5">
              <div className="p-2 rounded bg-gain/5 border border-gain/10 flex items-center gap-2">
                <CircleCheck className="w-3.5 h-3.5 text-gain" />
                <div>
                  <div className="text-[7px] text-muted-foreground uppercase">Best Trade</div>
                  <div className="text-[11px] font-mono text-gain font-bold">+${stats.bestTrade.toFixed(2)}</div>
                </div>
              </div>
              <div className="p-2 rounded bg-loss/5 border border-loss/10 flex items-center gap-2">
                <CircleX className="w-3.5 h-3.5 text-loss" />
                <div>
                  <div className="text-[7px] text-muted-foreground uppercase">Worst Trade</div>
                  <div className="text-[11px] font-mono text-loss font-bold">${stats.worstTrade.toFixed(2)}</div>
                </div>
              </div>
            </div>
          )}

          {/* Symbol Heatmap */}
          <TradeHeatmap logs={logs} />

          {/* Adaptive Risk Profile */}
          {stats.activeRiskProfile && config.adaptiveRisk && (
            <div className={`p-2.5 rounded-lg border ${getTierBgColor(stats.activeRiskProfile.tier)}`}>
              <div className="flex items-center justify-between mb-1.5">
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  <Crosshair className="w-3 h-3" /> Adaptive Risk Profile
                </div>
                <span className={`text-[10px] font-mono font-bold ${getTierColor(stats.activeRiskProfile.tier)}`}>
                  {stats.activeRiskProfile.tier.replace("_", " ").toUpperCase()}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1.5 mb-1.5">
                <div className="text-center p-1 rounded bg-background/30">
                  <div className="text-[7px] text-muted-foreground">SL</div>
                  <div className="text-[10px] font-mono font-bold text-loss">{stats.activeRiskProfile.stopLossPct}%</div>
                </div>
                <div className="text-center p-1 rounded bg-background/30">
                  <div className="text-[7px] text-muted-foreground">TP</div>
                  <div className="text-[10px] font-mono font-bold text-gain">{stats.activeRiskProfile.takeProfitPct}%</div>
                </div>
                <div className="text-center p-1 rounded bg-background/30">
                  <div className="text-[7px] text-muted-foreground">Size</div>
                  <div className="text-[10px] font-mono font-bold text-foreground">{stats.activeRiskProfile.positionSizePct.toFixed(1)}%</div>
                </div>
              </div>
              <div className="text-[8px] text-muted-foreground leading-relaxed">
                {stats.activeRiskProfile.reasons.slice(0, 4).join(" · ")}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Quick Config (always visible) */}
      <div className="grid grid-cols-4 gap-1.5 mb-3 text-center">
        <div className="p-1.5 rounded bg-secondary/50">
          <div className="text-[7px] text-muted-foreground uppercase">Threshold</div>
          <div className="text-[11px] font-mono text-foreground">{config.confidenceThreshold}%</div>
        </div>
        <div className="p-1.5 rounded bg-secondary/50">
          <div className="text-[7px] text-muted-foreground uppercase">Size</div>
          <div className="text-[11px] font-mono text-foreground">{config.positionSizePct}%</div>
        </div>
        <div className="p-1.5 rounded bg-secondary/50">
          <div className="text-[7px] text-muted-foreground uppercase">SL / TP</div>
          <div className="text-[11px] font-mono">
            <span className="text-loss">{config.stopLossPct}</span>
            <span className="text-muted-foreground">/</span>
            <span className="text-gain">{config.takeProfitPct}</span>
          </div>
        </div>
        <div className="p-1.5 rounded bg-secondary/50">
          <div className="text-[7px] text-muted-foreground uppercase">Min R:R</div>
          <div className="text-[11px] font-mono text-accent">{config.requireMinRR}x</div>
        </div>
      </div>

      {/* Settings Panel */}
      {showSettings && (
        <div className="mb-3 p-3 rounded-md bg-secondary/50 border border-border space-y-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
            <Shield className="w-3 h-3" /> Configuration
          </div>

          {/* Trading Hours */}
          <div className="flex items-center justify-between text-[11px] p-2 rounded bg-secondary/30 border border-border/50">
            <span className="text-muted-foreground flex items-center gap-1">
              <Clock className="w-3 h-3" /> 24/7 Trading
            </span>
            <Switch checked={config.allHoursTrading} onCheckedChange={(v) => onConfigChange({ ...config, allHoursTrading: v })} />
          </div>

          {/* Alpaca Brokerage */}
          <div className="p-2 rounded bg-secondary/30 border border-border/50 space-y-2">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-muted-foreground flex items-center gap-1">
                <Landmark className="w-3 h-3" /> Alpaca Brokerage
              </span>
              <Switch checked={config.alpacaEnabled} onCheckedChange={(v) => onConfigChange({ ...config, alpacaEnabled: v })} />
            </div>
            {config.alpacaEnabled && (
              <div className="space-y-1.5">
                <div className="flex gap-1">
                  <button
                    onClick={() => onConfigChange({ ...config, alpacaMode: "paper" })}
                    className={`flex-1 text-[10px] py-1 px-2 rounded font-mono transition-colors ${
                      config.alpacaMode === "paper"
                        ? "bg-accent/15 text-accent border border-accent/30"
                        : "bg-secondary/50 text-muted-foreground border border-border/50 hover:text-foreground"
                    }`}
                  >
                    📝 Paper
                  </button>
                  <button
                    onClick={() => onConfigChange({ ...config, alpacaMode: "live" })}
                    className={`flex-1 text-[10px] py-1 px-2 rounded font-mono transition-colors ${
                      config.alpacaMode === "live"
                        ? "bg-loss/15 text-loss border border-loss/30"
                        : "bg-secondary/50 text-muted-foreground border border-border/50 hover:text-foreground"
                    }`}
                  >
                    🔴 Live
                  </button>
                </div>
                {config.alpacaMode === "live" && (
                  <div className="p-1.5 rounded bg-loss/10 border border-loss/20 text-[9px] text-loss">
                    ⚠️ LIVE MODE — Real money will be used. Orders execute on your Alpaca account.
                  </div>
                )}
                <div className="text-[9px] text-muted-foreground">
                  Orders are sent to Alpaca {config.alpacaMode === "paper" ? "paper" : "live"} trading alongside the internal paper engine.
                </div>
              </div>
            )}
          </div>

          {/* Statistical Edge */}
          <div className="flex items-center justify-between text-[11px] p-2 rounded bg-secondary/30 border border-border/50">
            <span className="text-muted-foreground flex items-center gap-1">
              <BarChart3 className="w-3 h-3" /> Statistical Edge Trades
            </span>
            <Switch checked={config.statEdgeEnabled} onCheckedChange={(v) => onConfigChange({ ...config, statEdgeEnabled: v })} />
          </div>
          {config.statEdgeEnabled && (
            <div className="p-2 rounded bg-accent/5 border border-accent/10 text-[10px] text-muted-foreground space-y-1">
              <p>When volume spikes, momentum anomalies, or sector divergence are detected, the confidence threshold is reduced by <span className="text-accent font-mono font-bold">{config.statEdgeThresholdReduction}%</span> to capture high-probability moves.</p>
              <div className="flex justify-between text-[11px] mt-1">
                <span>Threshold Reduction</span>
                <span className="font-mono text-accent">{config.statEdgeThresholdReduction}%</span>
              </div>
              <Slider value={[config.statEdgeThresholdReduction]} min={5} max={30} step={5} onValueChange={([v]) => onConfigChange({ ...config, statEdgeThresholdReduction: v })} className="py-1" />
            </div>
          )}

          <div className="space-y-2">
            {/* Core settings */}
            {[
              { label: "Confidence Threshold", value: config.confidenceThreshold, suffix: "%", color: "text-accent", min: 50, max: 95, step: 5, key: "confidenceThreshold" as const },
              { label: "Position Size", value: config.positionSizePct, suffix: "%", color: "text-foreground", min: 1, max: 25, step: 1, key: "positionSizePct" as const },
              { label: "Stop Loss", value: config.stopLossPct, suffix: "%", color: "text-loss", min: 0.5, max: 10, step: 0.5, key: "stopLossPct" as const },
              { label: "Take Profit", value: config.takeProfitPct, suffix: "%", color: "text-gain", min: 1, max: 20, step: 0.5, key: "takeProfitPct" as const },
              { label: "Max Positions", value: config.maxOpenPositions, suffix: "", color: "text-foreground", min: 1, max: 8, step: 1, key: "maxOpenPositions" as const },
              { label: "Trailing Stop", value: config.trailingStopPct, suffix: "%", color: "text-accent", min: 0.5, max: 5, step: 0.5, key: "trailingStopPct" as const },
            ].map(s => (
              <div key={s.key}>
                <div className="flex justify-between text-[11px]">
                  <span className="text-muted-foreground">{s.label}</span>
                  <span className={`font-mono ${s.color}`}>{s.value}{s.suffix}</span>
                </div>
                <Slider value={[s.value]} min={s.min} max={s.max} step={s.step} onValueChange={([v]) => onConfigChange({ ...config, [s.key]: v })} className="py-1" />
              </div>
            ))}

            {/* Timing */}
            <div className="flex justify-between text-[11px]">
              <span className="text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3" /> Cooldown</span>
              <span className="font-mono text-foreground">{config.cooldownSeconds}s</span>
            </div>
            <Slider value={[config.cooldownSeconds]} min={30} max={300} step={15} onValueChange={([v]) => onConfigChange({ ...config, cooldownSeconds: v })} className="py-1" />

            <div className="flex justify-between text-[11px]">
              <span className="text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3" /> Queue Delay</span>
              <span className="font-mono text-foreground">{config.queueDelaySeconds}s</span>
            </div>
            <Slider value={[config.queueDelaySeconds]} min={5} max={60} step={5} onValueChange={([v]) => onConfigChange({ ...config, queueDelaySeconds: v })} className="py-1" />
          </div>

          {/* Advanced settings (collapsible) */}
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center justify-between w-full pt-2 border-t border-border text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
          >
            <span className="flex items-center gap-1"><Target className="w-3 h-3" /> Advanced Risk & Filters</span>
            {showAdvanced ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>

          {showAdvanced && (
            <div className="space-y-2 pl-1">
              <div className="flex justify-between text-[11px]">
                <span className="text-muted-foreground">Min R:R Ratio</span>
                <span className="font-mono text-accent">{config.requireMinRR}x</span>
              </div>
              <Slider value={[config.requireMinRR]} min={1} max={4} step={0.25} onValueChange={([v]) => onConfigChange({ ...config, requireMinRR: v })} className="py-1" />
              <div className="text-[8px] text-muted-foreground">Reject trades below this risk:reward</div>

              <div className="flex justify-between text-[11px] mt-1">
                <span className="text-muted-foreground">Max Daily Loss</span>
                <span className="font-mono text-loss">{config.maxDailyLossPct}%</span>
              </div>
              <Slider value={[config.maxDailyLossPct]} min={1} max={15} step={1} onValueChange={([v]) => onConfigChange({ ...config, maxDailyLossPct: v })} className="py-1" />

              <div className="flex justify-between text-[11px] mt-1">
                <span className="text-muted-foreground">Max Exposure</span>
                <span className="font-mono text-foreground">{config.maxPortfolioRiskPct}%</span>
              </div>
              <Slider value={[config.maxPortfolioRiskPct]} min={10} max={80} step={5} onValueChange={([v]) => onConfigChange({ ...config, maxPortfolioRiskPct: v })} className="py-1" />

              {/* Price Filters */}
              <div className="text-[9px] uppercase tracking-wider text-muted-foreground flex items-center gap-1 mt-2">
                <Filter className="w-3 h-3" /> Price Range
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <div className="text-[9px] text-muted-foreground mb-0.5">Min: ${config.minPrice}</div>
                  <Slider value={[config.minPrice]} min={0.01} max={50} step={0.5} onValueChange={([v]) => onConfigChange({ ...config, minPrice: v })} className="py-1" />
                </div>
                <div className="flex-1">
                  <div className="text-[9px] text-muted-foreground mb-0.5">Max: ${config.maxPrice}</div>
                  <Slider value={[config.maxPrice]} min={50} max={10000} step={50} onValueChange={([v]) => onConfigChange({ ...config, maxPrice: v })} className="py-1" />
                </div>
              </div>

              {/* Profit-Only Mode */}
              <div className="flex items-center justify-between p-2 rounded bg-secondary/30 border border-border/50 mt-1">
                <div>
                  <div className="text-[11px] text-foreground font-medium flex items-center gap-1">
                    <Shield className="w-3 h-3 text-gain" /> Profit-Only Mode
                  </div>
                  <div className="text-[8px] text-muted-foreground">Only exit when trailing from profit</div>
                </div>
                <Switch checked={config.profitOnlyMode} onCheckedChange={(v) => onConfigChange({ ...config, profitOnlyMode: v })} />
              </div>

              {/* === NEW INTELLIGENCE FEATURES === */}
              <div className="text-[9px] uppercase tracking-wider text-muted-foreground flex items-center gap-1 mt-3 mb-1">
                <Zap className="w-3 h-3" /> Intelligence Features
              </div>

              {/* News Sentiment Gating */}
              <div className="flex items-center justify-between p-2 rounded bg-secondary/30 border border-border/50">
                <div>
                  <div className="text-[11px] text-foreground font-medium flex items-center gap-1">
                    📰 News Sentiment Gate
                  </div>
                  <div className="text-[8px] text-muted-foreground">Block trades on stocks with negative news</div>
                </div>
                <Switch checked={config.newsSentimentGating} onCheckedChange={(v) => onConfigChange({ ...config, newsSentimentGating: v })} />
              </div>

              {/* Multi-Timeframe Confirmation */}
              <div className="flex items-center justify-between p-2 rounded bg-secondary/30 border border-border/50">
                <div>
                  <div className="text-[11px] text-foreground font-medium flex items-center gap-1">
                    📊 Multi-Timeframe
                  </div>
                  <div className="text-[8px] text-muted-foreground">Require intraday + daily + sector alignment</div>
                </div>
                <Switch checked={config.multiTimeframeConfirmation} onCheckedChange={(v) => onConfigChange({ ...config, multiTimeframeConfirmation: v })} />
              </div>

              {/* Correlation Filtering */}
              <div className="flex items-center justify-between p-2 rounded bg-secondary/30 border border-border/50">
                <div>
                  <div className="text-[11px] text-foreground font-medium flex items-center gap-1">
                    🔗 Correlation Filter
                  </div>
                  <div className="text-[8px] text-muted-foreground">Block correlated positions (e.g. AAPL+MSFT)</div>
                </div>
                <Switch checked={config.correlationFiltering} onCheckedChange={(v) => onConfigChange({ ...config, correlationFiltering: v })} />
              </div>

              {/* Partial Profit Taking */}
              <div className="flex items-center justify-between p-2 rounded bg-secondary/30 border border-border/50">
                <div>
                  <div className="text-[11px] text-foreground font-medium flex items-center gap-1">
                    💰 Partial Profit
                  </div>
                  <div className="text-[8px] text-muted-foreground">Close {config.partialProfitPct}% at 50% of TP, trail the rest</div>
                </div>
                <Switch checked={config.partialProfitTaking} onCheckedChange={(v) => onConfigChange({ ...config, partialProfitTaking: v })} />
              </div>
              {config.partialProfitTaking && (
                <div>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-muted-foreground">Partial Close %</span>
                    <span className="font-mono text-gain">{config.partialProfitPct}%</span>
                  </div>
                  <Slider value={[config.partialProfitPct]} min={25} max={75} step={5} onValueChange={([v]) => onConfigChange({ ...config, partialProfitPct: v })} className="py-1" />
                </div>
              )}

              {/* Fractional Shares */}
              <div className="flex items-center justify-between p-2 rounded bg-secondary/30 border border-border/50">
                <div>
                  <div className="text-[11px] text-foreground font-medium flex items-center gap-1">
                    <DollarSign className="w-3 h-3 text-accent" /> Fractional Shares
                  </div>
                  <div className="text-[8px] text-muted-foreground">Allow decimal quantities for any stock price</div>
                </div>
                <Switch checked={config.fractionalShares} onCheckedChange={(v) => onConfigChange({ ...config, fractionalShares: v })} />
              </div>

              {/* === WARRIOR TRADING SCREENING === */}
              <div className="text-[9px] uppercase tracking-wider text-muted-foreground flex items-center gap-1 mt-3 mb-1">
                ⚔️ Warrior Trading Screen
              </div>

              <div className="flex items-center justify-between p-2 rounded bg-secondary/30 border border-border/50">
                <div>
                  <div className="text-[11px] text-foreground font-medium flex items-center gap-1">
                    ⚔️ Warrior Screening
                  </div>
                  <div className="text-[8px] text-muted-foreground">5x RelVol, 10%+ gainer, $1-$20, low float, catalyst</div>
                </div>
                <Switch checked={config.warriorScreening} onCheckedChange={(v) => onConfigChange({ ...config, warriorScreening: v })} />
              </div>

              {config.warriorScreening && (
                <div className="space-y-2 p-2 rounded bg-accent/5 border border-accent/10">
                  <div className="text-[9px] text-muted-foreground mb-1">
                    Based on Warrior Trading's proprietary stock selection: high demand (volume + momentum + catalyst) with low supply (float).
                  </div>
                  <div>
                    <div className="flex justify-between text-[11px]">
                      <span className="text-muted-foreground">Min Relative Volume</span>
                      <span className="font-mono text-accent">{config.minRelativeVolume}x</span>
                    </div>
                    <Slider value={[config.minRelativeVolume]} min={2} max={15} step={1} onValueChange={([v]) => onConfigChange({ ...config, minRelativeVolume: v })} className="py-1" />
                    <div className="text-[8px] text-muted-foreground">Volume today vs 30-day average</div>
                  </div>
                  <div>
                    <div className="flex justify-between text-[11px]">
                      <span className="text-muted-foreground">Min Day Gain</span>
                      <span className="font-mono text-gain">{config.minGainerPct}%</span>
                    </div>
                    <Slider value={[config.minGainerPct]} min={3} max={25} step={1} onValueChange={([v]) => onConfigChange({ ...config, minGainerPct: v })} className="py-1" />
                    <div className="text-[8px] text-muted-foreground">Stock must already be up this much</div>
                  </div>
                  <div className="flex items-center justify-between p-1.5 rounded bg-secondary/30">
                    <span className="text-[10px] text-muted-foreground">$1-$20 Sweet Spot</span>
                    <Switch checked={config.sweetSpotPricing} onCheckedChange={(v) => onConfigChange({ ...config, sweetSpotPricing: v })} />
                  </div>
                  <div className="flex items-center justify-between p-1.5 rounded bg-secondary/30">
                    <span className="text-[10px] text-muted-foreground">Require News Catalyst</span>
                    <Switch checked={config.requireCatalyst} onCheckedChange={(v) => onConfigChange({ ...config, requireCatalyst: v })} />
                  </div>
                </div>
              )}

              {/* === SMART FEATURES === */}
              <div className="text-[9px] uppercase tracking-wider text-muted-foreground flex items-center gap-1 mt-3 mb-1">
                <Gauge className="w-3 h-3" /> Smart Features
              </div>

              {/* Adaptive Risk (per-stock) */}
              <div className="flex items-center justify-between p-2 rounded bg-secondary/30 border border-border/50">
                <div>
                  <div className="text-[11px] text-foreground font-medium flex items-center gap-1">
                    <Crosshair className="w-3 h-3 text-primary" /> Adaptive Risk
                  </div>
                  <div className="text-[8px] text-muted-foreground">Auto-tune SL/TP/size per stock (volatility, float, sector, regime)</div>
                </div>
                <Switch checked={config.adaptiveRisk} onCheckedChange={(v) => onConfigChange({ ...config, adaptiveRisk: v })} />
              </div>

              {/* Market Regime Detection */}
              <div className="flex items-center justify-between p-2 rounded bg-secondary/30 border border-border/50">
                <div>
                  <div className="text-[11px] text-foreground font-medium flex items-center gap-1">
                    🌊 Regime Detection
                  </div>
                  <div className="text-[8px] text-muted-foreground">Auto-adjust strategy for trending vs choppy markets</div>
                </div>
                <Switch checked={config.regimeDetection} onCheckedChange={(v) => onConfigChange({ ...config, regimeDetection: v })} />
              </div>
              {config.regimeDetection && stats.marketRegime !== "unknown" && (
                <div className={`p-2 rounded border text-[10px] font-mono ${
                  stats.marketRegime.includes("up") ? "bg-gain/5 border-gain/15 text-gain" :
                  stats.marketRegime.includes("down") ? "bg-loss/5 border-loss/15 text-loss" :
                  stats.marketRegime === "choppy" ? "bg-warning/5 border-warning/15 text-warning" :
                  "bg-secondary/50 border-border/50 text-muted-foreground"
                }`}>
                  🌊 Regime: <span className="font-bold">{stats.marketRegime.replace("_", " ").toUpperCase()}</span>
                  {stats.marketRegime === "choppy" && <span className="ml-1 text-[8px]">(+10% threshold)</span>}
                  {stats.marketRegime.includes("up") && <span className="ml-1 text-[8px]">(-5% threshold)</span>}
                </div>
              )}

              {/* Avoid Lunch Hour */}
              <div className="flex items-center justify-between p-2 rounded bg-secondary/30 border border-border/50">
                <div>
                  <div className="text-[11px] text-foreground font-medium flex items-center gap-1">
                    🍽️ Avoid Lunch Hour
                  </div>
                  <div className="text-[8px] text-muted-foreground">Pause entries 11:30 AM – 2:00 PM ET (low volume)</div>
                </div>
                <Switch checked={config.avoidLunchHour} onCheckedChange={(v) => onConfigChange({ ...config, avoidLunchHour: v })} />
              </div>

              {/* ATR-Based Dynamic Stops */}
              <div className="flex items-center justify-between p-2 rounded bg-secondary/30 border border-border/50">
                <div>
                  <div className="text-[11px] text-foreground font-medium flex items-center gap-1">
                    📏 ATR Dynamic Stops
                  </div>
                  <div className="text-[8px] text-muted-foreground">Volatility-adjusted stop-loss using ATR</div>
                </div>
                <Switch checked={config.atrBasedStops} onCheckedChange={(v) => onConfigChange({ ...config, atrBasedStops: v })} />
              </div>
              {config.atrBasedStops && (
                <div className="space-y-1 p-2 rounded bg-accent/5 border border-accent/10">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-muted-foreground">ATR Multiplier</span>
                    <span className="font-mono text-accent">{config.atrMultiplier}x</span>
                  </div>
                  <Slider value={[config.atrMultiplier]} min={1} max={4} step={0.25} onValueChange={([v]) => onConfigChange({ ...config, atrMultiplier: v })} className="py-1" />
                  <div className="text-[8px] text-muted-foreground">Higher = wider stops (less whipsaw, more risk per trade)</div>
                  {stats.atrStopDistance > 0 && (
                    <div className="text-[9px] font-mono text-accent mt-1">Current avg ATR stop: {stats.atrStopDistance.toFixed(2)}%</div>
                  )}
                </div>
              )}

              {/* 3-Tier Scale-Out */}
              <div className="flex items-center justify-between p-2 rounded bg-secondary/30 border border-border/50">
                <div>
                  <div className="text-[11px] text-foreground font-medium flex items-center gap-1">
                    📐 3-Tier Scale-Out
                  </div>
                  <div className="text-[8px] text-muted-foreground">33% at 1R, 33% at 2R, trail remaining 34%</div>
                </div>
                <Switch checked={config.tieredScaleOut} onCheckedChange={(v) => onConfigChange({ ...config, tieredScaleOut: v })} />
              </div>
              {config.tieredScaleOut && (stats.tierExits.tier1 > 0 || stats.tierExits.tier2 > 0 || stats.tierExits.tier3 > 0) && (
                <div className="grid grid-cols-3 gap-1 text-center">
                  <div className="p-1.5 rounded bg-gain/5 border border-gain/10">
                    <div className="text-[7px] text-muted-foreground">Tier 1 (1R)</div>
                    <div className="text-[11px] font-mono font-bold text-gain">{stats.tierExits.tier1}</div>
                  </div>
                  <div className="p-1.5 rounded bg-gain/5 border border-gain/10">
                    <div className="text-[7px] text-muted-foreground">Tier 2 (2R)</div>
                    <div className="text-[11px] font-mono font-bold text-gain">{stats.tierExits.tier2}</div>
                  </div>
                  <div className="p-1.5 rounded bg-accent/5 border border-accent/10">
                    <div className="text-[7px] text-muted-foreground">Tier 3 (Trail)</div>
                    <div className="text-[11px] font-mono font-bold text-accent">{stats.tierExits.tier3}</div>
                  </div>
                </div>
              )}

              {/* === TRADE INTELLIGENCE === */}
              <div className="text-[9px] uppercase tracking-wider text-muted-foreground flex items-center gap-1 mt-3 mb-1">
                <Crosshair className="w-3 h-3" /> Trade Intelligence
              </div>

              <div className="flex items-center justify-between p-2 rounded bg-secondary/30 border border-border/50">
                <div>
                  <div className="text-[11px] text-foreground font-medium flex items-center gap-1">⏱️ Smart Exits</div>
                  <div className="text-[8px] text-muted-foreground">Time-based exits, momentum fade & stale position cleanup</div>
                </div>
                <Switch checked={config.smartExits} onCheckedChange={(v) => onConfigChange({ ...config, smartExits: v })} />
              </div>

              <div className="flex items-center justify-between p-2 rounded bg-secondary/30 border border-border/50">
                <div>
                  <div className="text-[11px] text-foreground font-medium flex items-center gap-1">🎯 Micro Alignment</div>
                  <div className="text-[8px] text-muted-foreground">Require 2+ micro-prediction TFs to agree before entry</div>
                </div>
                <Switch checked={config.microAlignmentRequired} onCheckedChange={(v) => onConfigChange({ ...config, microAlignmentRequired: v })} />
              </div>

              <div className="flex items-center justify-between p-2 rounded bg-secondary/30 border border-border/50">
                <div>
                  <div className="text-[11px] text-foreground font-medium flex items-center gap-1">📈 VWAP Reclaim</div>
                  <div className="text-[8px] text-muted-foreground">Only enter longs above VWAP, shorts below VWAP</div>
                </div>
                <Switch checked={config.vwapReclaim} onCheckedChange={(v) => onConfigChange({ ...config, vwapReclaim: v })} />
              </div>

              <div className="flex items-center justify-between p-2 rounded bg-secondary/30 border border-border/50">
                <div>
                  <div className="text-[11px] text-foreground font-medium flex items-center gap-1">🚫 Edge Restrictions</div>
                  <div className="text-[8px] text-muted-foreground">Auto-ban losing hours, sectors & float tiers (&lt;35% WR)</div>
                </div>
                <Switch checked={config.edgeRestrictions} onCheckedChange={(v) => onConfigChange({ ...config, edgeRestrictions: v })} />
              </div>

              <div className="flex items-center justify-between p-2 rounded bg-secondary/30 border border-border/50">
                <div>
                  <div className="text-[11px] text-foreground font-medium flex items-center gap-1">📊 Slippage Tracking</div>
                  <div className="text-[8px] text-muted-foreground">Log signal vs fill price to measure execution quality</div>
                </div>
                <Switch checked={config.slippageTracking} onCheckedChange={(v) => onConfigChange({ ...config, slippageTracking: v })} />
              </div>

              {/* Performance Feedback Loop */}
              <div className="flex items-center justify-between p-2 rounded bg-secondary/30 border border-border/50">
                <div>
                  <div className="text-[11px] text-foreground font-medium flex items-center gap-1">
                    🧠 Performance Feedback
                  </div>
                  <div className="text-[8px] text-muted-foreground">Auto-adjust threshold based on recent win/loss rate</div>
                </div>
                <Switch checked={config.performanceFeedback} onCheckedChange={(v) => onConfigChange({ ...config, performanceFeedback: v })} />
              </div>
              {config.performanceFeedback && (
                <div className="space-y-1 p-2 rounded bg-accent/5 border border-accent/10">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-muted-foreground">Lookback Trades</span>
                    <span className="font-mono text-foreground">{config.feedbackLookback}</span>
                  </div>
                  <Slider value={[config.feedbackLookback]} min={5} max={50} step={5} onValueChange={([v]) => onConfigChange({ ...config, feedbackLookback: v })} className="py-1" />
                  {stats.feedbackAdjustment !== 0 && (
                    <div className={`text-[9px] font-mono mt-1 ${stats.feedbackAdjustment < 0 ? "text-gain" : "text-loss"}`}>
                      🧠 Threshold {stats.feedbackAdjustment > 0 ? "+" : ""}{stats.feedbackAdjustment}% (auto-adjusted)
                    </div>
                  )}
                </div>
              )}

              {/* Auto-Disable Weak Indicators */}
              <AutoDisableToggle />
            </div>
          )}
        </div>
      )}

      {/* Activity Log */}
      <div className="border-t border-border pt-2">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
            <BarChart3 className="w-3 h-3" /> Activity Log
            <span className="text-[8px] font-mono opacity-60">({filteredLogs.length})</span>
          </div>
          <div className="flex gap-0.5">
            {(["all", "open", "close", "skip", "alert"] as const).map(f => (
              <button key={f} onClick={() => setLogFilter(f)}
                className={`text-[9px] px-1.5 py-0.5 rounded font-medium transition-colors ${logFilter === f ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"}`}>
                {f === "all" ? "All" : f === "open" ? "Opens" : f === "close" ? "Closes" : f === "alert" ? "Alerts" : "Skips"}
              </button>
            ))}
          </div>
        </div>
        <div className="max-h-52 overflow-y-auto scrollbar-thin space-y-0.5">
          {filteredLogs.length === 0 ? (
            <div className="text-[11px] text-muted-foreground text-center py-4">
              {config.enabled ? (
                <div className="flex flex-col items-center gap-1">
                  <Loader2 className="w-4 h-4 animate-spin text-accent" />
                  <span>Scanning for opportunities...</span>
                </div>
              ) : (
                "Enable auto-trading to start"
              )}
            </div>
          ) : (
            filteredLogs.map(log => (
              <div key={log.id} className={`flex items-start justify-between text-[10px] font-mono py-1.5 px-1.5 rounded transition-colors ${
                log.action === "open" ? "bg-gain/5 hover:bg-gain/10" :
                log.action === "close" ? "bg-loss/5 hover:bg-loss/10" :
                log.action === "alert" ? "bg-warning/5 hover:bg-warning/10" :
                "hover:bg-secondary/50"
              }`}>
                <div className="flex items-start gap-1.5 flex-1 min-w-0">
                  <span className={`shrink-0 mt-1 w-2 h-2 rounded-full ${
                    log.action === "open" ? "bg-gain" : log.action === "close" ? "bg-loss" : log.action === "alert" ? "bg-warning" : "bg-muted-foreground"
                  }`} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1 flex-wrap">
                      <span className={`font-semibold ${
                        log.action === "open" ? "text-gain" : log.action === "close" ? "text-loss" : log.action === "alert" ? "text-warning" : "text-muted-foreground"
                      }`}>
                        {log.action.toUpperCase()}
                      </span>
                      <span className="text-foreground">{log.symbol}</span>
                      {log.side && <span className="text-[8px] px-1 py-0.5 rounded bg-secondary text-muted-foreground">{log.side}</span>}
                      {log.confidence !== undefined && <span className="text-muted-foreground">{log.confidence}%</span>}
                      {log.pnl !== undefined && (
                        <span className={`font-bold ${log.pnl >= 0 ? "text-gain" : "text-loss"}`}>
                          {log.pnl >= 0 ? "+" : ""}${log.pnl.toFixed(2)}
                        </span>
                      )}
                    </div>
                    <div className="text-muted-foreground truncate text-[9px]">{log.reason}</div>
                  </div>
                </div>
                <span className="text-muted-foreground/50 shrink-0 ml-2 text-[9px]">
                  {new Date(log.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
