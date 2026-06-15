import { Target, TrendingUp, Award, BarChart3, CheckCircle2, AlertTriangle } from "lucide-react";
import { AutoTradeStats } from "@/hooks/useAutoTrading";
import { useMemo } from "react";

interface TradingPlanProps {
  stats: AutoTradeStats;
}

// Profit Trifecta from Warrior Trading plan
interface TrifectaGoals {
  level: "Novice" | "Beginner" | "Advanced" | "Pro";
  consistency: string;
  accuracy: string;
  plRatio: string;
}

const TRIFECTA_LEVELS: TrifectaGoals[] = [
  { level: "Novice", consistency: "1 week", accuracy: "40-50%", plRatio: "0.5-1.0" },
  { level: "Beginner", consistency: "2 weeks", accuracy: "50-60%", plRatio: "1.0-1.5" },
  { level: "Advanced", consistency: "3-5 weeks", accuracy: "60-70%", plRatio: "1.5-2.0" },
  { level: "Pro", consistency: "5+ weeks", accuracy: ">70%", plRatio: ">2.0" },
];

export function TradingPlan({ stats }: TradingPlanProps) {
  const metrics = useMemo(() => {
    const winRate = stats.totalTrades > 0 ? (stats.winningTrades / stats.totalTrades) * 100 : 0;
    const plRatio = stats.profitFactor || 0;

    // Determine current level
    let level: TrifectaGoals["level"] = "Novice";
    if (winRate >= 70 && plRatio > 2) level = "Pro";
    else if (winRate >= 60 && plRatio > 1.5) level = "Advanced";
    else if (winRate >= 50 && plRatio > 1) level = "Beginner";

    // Risk/reward check (target 2:1)
    const avgWin = stats.winningTrades > 0 ? stats.bestTrade : 0;
    const avgLoss = stats.losingTrades > 0 ? Math.abs(stats.worstTrade) : 1;
    const actualRR = avgLoss > 0 ? avgWin / avgLoss : 0;

    return { winRate, plRatio, level, actualRR };
  }, [stats]);

  const levelIndex = TRIFECTA_LEVELS.findIndex(l => l.level === metrics.level);

  return (
    <div className="bg-card rounded-lg border border-border p-4">
      <h3 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-3">
        <Target className="w-4 h-4 text-accent" />
        Trading Plan
        <span className="text-[9px] px-1.5 py-0.5 rounded bg-accent/15 text-accent font-mono">
          Warrior Method
        </span>
      </h3>

      {/* Current Level Badge */}
      <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary/30 border border-border/50 mb-3">
        <div className={`flex items-center justify-center w-10 h-10 rounded-lg font-bold text-lg ${
          metrics.level === "Pro" ? "bg-gain/15 text-gain" :
          metrics.level === "Advanced" ? "bg-accent/15 text-accent" :
          metrics.level === "Beginner" ? "bg-warning/15 text-warning" :
          "bg-secondary text-muted-foreground"
        }`}>
          {metrics.level === "Pro" ? "🏆" : metrics.level === "Advanced" ? "⚡" : metrics.level === "Beginner" ? "📈" : "🌱"}
        </div>
        <div className="flex-1">
          <div className="text-xs font-semibold text-foreground">{metrics.level} Trader</div>
          <div className="text-[9px] text-muted-foreground">
            {stats.totalTrades < 5 ? "Need more trades to evaluate" : `Based on ${stats.totalTrades} trades`}
          </div>
        </div>
      </div>

      {/* Profit Trifecta Goals */}
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground flex items-center gap-1 mb-2">
        <Award className="w-3 h-3" /> Profit Trifecta Goals
      </div>

      <div className="space-y-1.5 mb-3">
        {TRIFECTA_LEVELS.map((goal, i) => {
          const isCurrent = goal.level === metrics.level;
          const isPassed = i < levelIndex;
          return (
            <div key={goal.level} className={`flex items-center gap-2 p-2 rounded text-[10px] transition-all ${
              isCurrent ? "bg-accent/10 border border-accent/20" :
              isPassed ? "bg-gain/5 border border-gain/10" :
              "bg-secondary/20 border border-border/30"
            }`}>
              <div className="w-4 shrink-0">
                {isPassed ? <CheckCircle2 className="w-3.5 h-3.5 text-gain" /> :
                 isCurrent ? <TrendingUp className="w-3.5 h-3.5 text-accent" /> :
                 <div className="w-3.5 h-3.5 rounded-full border border-border" />}
              </div>
              <span className={`font-semibold w-16 ${isCurrent ? "text-accent" : isPassed ? "text-gain" : "text-muted-foreground"}`}>
                {goal.level}
              </span>
              <div className="flex-1 grid grid-cols-3 gap-1 text-[9px] font-mono">
                <span className="text-muted-foreground">{goal.consistency}</span>
                <span className="text-muted-foreground">{goal.accuracy}</span>
                <span className="text-muted-foreground">{goal.plRatio}</span>
              </div>
            </div>
          );
        })}
        <div className="grid grid-cols-3 gap-1 text-[7px] uppercase tracking-wider text-muted-foreground/50 pl-[72px]">
          <span>Consistency</span>
          <span>Accuracy</span>
          <span>P/L Ratio</span>
        </div>
      </div>

      {/* Your Current Metrics vs Goals */}
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground flex items-center gap-1 mb-2">
        <BarChart3 className="w-3 h-3" /> Your Metrics
      </div>
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="p-2 rounded bg-secondary/40 text-center">
          <div className="text-[7px] text-muted-foreground uppercase">Win Rate</div>
          <div className={`text-sm font-mono font-bold ${metrics.winRate >= 60 ? "text-gain" : metrics.winRate >= 50 ? "text-warning" : "text-loss"}`}>
            {stats.totalTrades > 0 ? `${metrics.winRate.toFixed(1)}%` : "--"}
          </div>
          <div className="text-[7px] text-muted-foreground">Target: 60%+</div>
        </div>
        <div className="p-2 rounded bg-secondary/40 text-center">
          <div className="text-[7px] text-muted-foreground uppercase">P/L Ratio</div>
          <div className={`text-sm font-mono font-bold ${metrics.plRatio >= 1.5 ? "text-gain" : metrics.plRatio >= 1 ? "text-warning" : "text-loss"}`}>
            {metrics.plRatio > 0 ? (metrics.plRatio === Infinity ? "∞" : metrics.plRatio.toFixed(2)) : "--"}
          </div>
          <div className="text-[7px] text-muted-foreground">Target: 2:1</div>
        </div>
        <div className="p-2 rounded bg-secondary/40 text-center">
          <div className="text-[7px] text-muted-foreground uppercase">R:R Actual</div>
          <div className={`text-sm font-mono font-bold ${metrics.actualRR >= 2 ? "text-gain" : metrics.actualRR >= 1 ? "text-warning" : "text-loss"}`}>
            {metrics.actualRR > 0 ? `${metrics.actualRR.toFixed(1)}:1` : "--"}
          </div>
          <div className="text-[7px] text-muted-foreground">Target: 2:1</div>
        </div>
      </div>

      {/* Key Rules Checklist */}
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground flex items-center gap-1 mb-2">
        <CheckCircle2 className="w-3 h-3" /> Trading Rules
      </div>
      <div className="space-y-1">
        {[
          { rule: "Get in, get green, get out", check: stats.avgHoldTime > 0 && stats.avgHoldTime < 120 * 60000 },
          { rule: "2:1 Profit/Loss ratio minimum", check: metrics.plRatio >= 2 },
          { rule: "Only trade stocks already moving", check: true },
          { rule: "Always check news catalyst", check: true },
          { rule: "Focus on top 2-3 leading gainers", check: true },
        ].map(item => (
          <div key={item.rule} className="flex items-center gap-2 text-[10px]">
            {item.check ?
              <CheckCircle2 className="w-3 h-3 text-gain shrink-0" /> :
              <AlertTriangle className="w-3 h-3 text-warning shrink-0" />
            }
            <span className={item.check ? "text-foreground" : "text-muted-foreground"}>{item.rule}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
