import { useState, useMemo } from "react";
import { BarChart3, Clock, TrendingUp, TrendingDown, Calendar, Activity, Brain, AlertTriangle, Target } from "lucide-react";
import { getIndicatorWeights } from "@/lib/predictionIntelligence";
import { getPredictionAccuracy } from "@/lib/microPredictions";
import { analyzePredictionFeedback, type FeedbackAnalysis } from "@/lib/predictionFeedback";

type Period = "daily" | "weekly";
type Tab = "overview" | "feedback";

export function PerformanceReports() {
  const [period, setPeriod] = useState<Period>("daily");
  const [tab, setTab] = useState<Tab>("overview");

  const weights = useMemo(() => getIndicatorWeights(), []);
  const accuracy = useMemo(() => getPredictionAccuracy(), []);
  const feedback = useMemo(() => analyzePredictionFeedback(), []);

  const sortedWeights = useMemo(() => {
    return Object.values(weights).sort((a, b) => b.weight - a.weight);
  }, [weights]);

  const improved = sortedWeights.filter(w => w.weight > 1.2);
  const degraded = sortedWeights.filter(w => w.weight < 0.8);

  const hourPerformance = useMemo(() => [
    { hour: "9:30-10:00", label: "Open", reliability: 85, note: "Volatile patterns" },
    { hour: "10:00-11:30", label: "Morning", reliability: 100, note: "Highest reliability" },
    { hour: "11:30-14:00", label: "Lunch", reliability: 65, note: "Low volume, choppy" },
    { hour: "14:00-15:30", label: "Afternoon", reliability: 90, note: "Moderate" },
    { hour: "15:30-16:00", label: "Power Hour", reliability: 85, note: "Fast but predictable" },
  ], []);

  const calibrationStatus = useMemo(() => {
    const { rate, targetRate, total } = accuracy;
    if (total < 10) return { status: "insufficient", label: "Need more data", color: "text-muted-foreground" };
    if (Math.abs(rate - 50) < 10 && targetRate < 30) return { status: "poor", label: "Under-calibrated", color: "text-loss" };
    if (rate >= 55 && targetRate >= 35) return { status: "good", label: "Well calibrated", color: "text-gain" };
    return { status: "moderate", label: "Moderate drift", color: "text-warning" };
  }, [accuracy]);

  return (
    <div className="p-3 rounded-lg bg-card border border-border space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-wider text-foreground flex items-center gap-1.5">
          <BarChart3 className="w-3.5 h-3.5 text-accent" /> Performance Report
        </div>
        <div className="flex gap-0.5">
          <button onClick={() => setTab("overview")}
            className={`text-[7px] font-mono px-1.5 py-0.5 rounded border transition-colors ${tab === "overview" ? "bg-primary/10 border-primary/30 text-primary" : "bg-secondary/50 border-border/30 text-muted-foreground"}`}>
            Overview
          </button>
          <button onClick={() => setTab("feedback")}
            className={`text-[7px] font-mono px-1.5 py-0.5 rounded border transition-colors ${tab === "feedback" ? "bg-primary/10 border-primary/30 text-primary" : "bg-secondary/50 border-border/30 text-muted-foreground"}`}>
            🧠 Feedback
          </button>
          {(["daily", "weekly"] as Period[]).map(p => (
            <button key={p} onClick={() => setPeriod(p)}
              className={`text-[7px] font-mono px-1.5 py-0.5 rounded border transition-colors ${period === p ? "bg-primary/10 border-primary/30 text-primary" : "bg-secondary/50 border-border/30 text-muted-foreground"}`}>
              {p === "daily" ? "Daily" : "Weekly"}
            </button>
          ))}
        </div>
      </div>

      {tab === "overview" && (
        <>
          {/* Calibration Status */}
          <div className="p-2 rounded border bg-secondary/30 border-border/30">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[8px] text-muted-foreground uppercase">Calibration Status</span>
              <span className={`text-[9px] font-mono font-bold ${calibrationStatus.color}`}>
                {calibrationStatus.label}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-[8px] font-mono">
              <div>
                <div className="text-muted-foreground">Direction</div>
                <div className={accuracy.rate >= 55 ? "text-gain font-bold" : "text-loss font-bold"}>{accuracy.rate}%</div>
              </div>
              <div>
                <div className="text-muted-foreground">Target Hit</div>
                <div className={accuracy.targetRate >= 35 ? "text-gain font-bold" : "text-loss font-bold"}>{accuracy.targetRate}%</div>
              </div>
              <div>
                <div className="text-muted-foreground">Recent 10</div>
                <div className={accuracy.recentTrend >= 55 ? "text-gain font-bold" : "text-loss font-bold"}>{accuracy.recentTrend}%</div>
              </div>
            </div>
          </div>

          {/* Best Performing Hours */}
          <div className="space-y-1">
            <div className="text-[7px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
              <Clock className="w-2.5 h-2.5" /> Best Trading Hours
            </div>
            <div className="space-y-0.5">
              {hourPerformance.map(h => (
                <div key={h.hour} className="flex items-center justify-between text-[8px] font-mono py-0.5">
                  <span className="text-muted-foreground">{h.hour}</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[7px] text-muted-foreground/60">{h.note}</span>
                    <div className="w-16 h-1.5 bg-secondary rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${h.reliability >= 90 ? "bg-gain" : h.reliability >= 75 ? "bg-warning" : "bg-loss"}`}
                        style={{ width: `${h.reliability}%` }} />
                    </div>
                    <span className={`w-8 text-right font-bold ${h.reliability >= 90 ? "text-gain" : h.reliability >= 75 ? "text-warning" : "text-loss"}`}>
                      {h.reliability}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Indicator Weight Shifts */}
          {sortedWeights.length > 0 && (
            <div className="space-y-1">
              <div className="text-[7px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                <Activity className="w-2.5 h-2.5" /> Indicator Weights ({period === "daily" ? "Today" : "This Week"})
              </div>
              {improved.length > 0 && (
                <div className="space-y-0.5">
                  <div className="text-[7px] text-gain/80 flex items-center gap-0.5"><TrendingUp className="w-2.5 h-2.5" /> Strengthened</div>
                  <div className="flex gap-1 flex-wrap">
                    {improved.map(w => (
                      <span key={w.name} className="text-[7px] px-1.5 py-0.5 rounded font-mono bg-gain/10 border border-gain/20 text-gain">
                        {w.name.replace("_", " ")} → {w.weight.toFixed(2)}x ({(w.profitRate * 100).toFixed(0)}% WR, n={w.sampleSize})
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {degraded.length > 0 && (
                <div className="space-y-0.5">
                  <div className="text-[7px] text-loss/80 flex items-center gap-0.5"><TrendingDown className="w-2.5 h-2.5" /> Weakened</div>
                  <div className="flex gap-1 flex-wrap">
                    {degraded.map(w => (
                      <span key={w.name} className="text-[7px] px-1.5 py-0.5 rounded font-mono bg-loss/10 border border-loss/20 text-loss">
                        {w.name.replace("_", " ")} → {w.weight.toFixed(2)}x ({(w.profitRate * 100).toFixed(0)}% WR, n={w.sampleSize})
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {sortedWeights.length > 0 && improved.length === 0 && degraded.length === 0 && (
                <div className="text-[8px] text-muted-foreground">All indicators within normal range (0.8x–1.2x)</div>
              )}
            </div>
          )}

          {/* Timeframe Breakdown */}
          {Object.keys(accuracy.byTimeframe).length > 0 && (
            <div className="space-y-1">
              <div className="text-[7px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                <Calendar className="w-2.5 h-2.5" /> Timeframe Accuracy
              </div>
              <div className="grid grid-cols-4 gap-1">
                {Object.entries(accuracy.byTimeframe).map(([tf, data]) => (
                  <div key={tf} className="p-1.5 rounded border bg-secondary/20 border-border/20 text-center">
                    <div className="text-[7px] text-muted-foreground">{tf}</div>
                    <div className={`text-[10px] font-mono font-bold ${data.rate >= 55 ? "text-gain" : data.rate >= 45 ? "text-warning" : "text-loss"}`}>
                      {data.rate}%
                    </div>
                    <div className="text-[6px] text-muted-foreground">n={data.total}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {tab === "feedback" && <FeedbackTab feedback={feedback} />}

      {accuracy.total < 10 && (
        <div className="text-[8px] text-muted-foreground text-center py-2">
          Need {10 - accuracy.total} more predictions for meaningful reports
        </div>
      )}
    </div>
  );
}

// ─── Feedback Analysis Tab ───

function FeedbackTab({ feedback }: { feedback: FeedbackAnalysis }) {
  if (feedback.totalResolved < 5) {
    return (
      <div className="text-[8px] text-muted-foreground text-center py-4">
        Need at least 5 resolved predictions for feedback analysis (have {feedback.totalResolved})
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Overall Stats */}
      <div className="p-2 rounded border bg-secondary/30 border-border/30">
        <div className="flex items-center gap-1 mb-1.5">
          <Brain className="w-3 h-3 text-accent" />
          <span className="text-[8px] text-muted-foreground uppercase">Learned from {feedback.totalResolved} predictions</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="text-[8px] font-mono">
            <span className="text-muted-foreground">Overall WR: </span>
            <span className={feedback.overallWinRate >= 55 ? "text-gain font-bold" : feedback.overallWinRate >= 45 ? "text-warning font-bold" : "text-loss font-bold"}>
              {feedback.overallWinRate}%
            </span>
          </div>
          <div className="text-[8px] font-mono">
            <span className="text-muted-foreground">Active Adjustments: </span>
            <span className="text-primary font-bold">{Object.keys(feedback.weightAdjustments).length}</span>
          </div>
        </div>
      </div>

      {/* Best Performing Conditions */}
      {feedback.bestConditions.length > 0 && (
        <div className="space-y-1">
          <div className="text-[7px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <Target className="w-2.5 h-2.5" /> Best Performing Conditions
          </div>
          <div className="flex gap-1 flex-wrap">
            {feedback.bestConditions.slice(0, 6).map(c => (
              <span key={c.condition} className="text-[7px] px-1.5 py-0.5 rounded font-mono bg-gain/10 border border-gain/20 text-gain">
                {formatConditionLabel(c.condition)} {c.winRate}% (n={c.n})
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Worst Performing Conditions */}
      {feedback.worstConditions.length > 0 && (
        <div className="space-y-1">
          <div className="text-[7px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <AlertTriangle className="w-2.5 h-2.5" /> Worst Performing Conditions
          </div>
          <div className="flex gap-1 flex-wrap">
            {feedback.worstConditions.slice(0, 6).map(c => (
              <span key={c.condition} className="text-[7px] px-1.5 py-0.5 rounded font-mono bg-loss/10 border border-loss/20 text-loss">
                {formatConditionLabel(c.condition)} {c.winRate}% (n={c.n})
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Best Indicator Pairs */}
      {feedback.bestPairs.length > 0 && (
        <div className="space-y-1">
          <div className="text-[7px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <TrendingUp className="w-2.5 h-2.5" /> Best Indicator Combos
          </div>
          <div className="space-y-0.5">
            {feedback.bestPairs.slice(0, 3).map(p => (
              <div key={p.pair} className="text-[7px] font-mono flex items-center justify-between">
                <span className="text-foreground/80">{formatPairLabel(p.pair)}</span>
                <span className="text-gain font-bold">{p.winRate}% (n={p.n})</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Calibration Drift */}
      {feedback.calibrationBuckets.length > 0 && (
        <div className="space-y-1">
          <div className="text-[7px] text-muted-foreground uppercase tracking-wider">Confidence Calibration</div>
          <div className="grid grid-cols-5 gap-1">
            {feedback.calibrationBuckets.map(b => {
              const drift = b.actual - b.predicted;
              return (
                <div key={b.range} className="p-1 rounded border bg-secondary/20 border-border/20 text-center">
                  <div className="text-[6px] text-muted-foreground">{b.range}%</div>
                  <div className={`text-[8px] font-mono font-bold ${Math.abs(drift) < 10 ? "text-gain" : "text-warning"}`}>
                    {drift > 0 ? "+" : ""}{drift}%
                  </div>
                  <div className="text-[5px] text-muted-foreground">n={b.n}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Regime Performance */}
      {Object.keys(feedback.byRegime).length > 0 && (
        <div className="space-y-1">
          <div className="text-[7px] text-muted-foreground uppercase tracking-wider">By Regime</div>
          <div className="flex gap-1 flex-wrap">
            {Object.entries(feedback.byRegime).map(([regime, stats]) => (
              <span key={regime} className={`text-[7px] px-1.5 py-0.5 rounded font-mono border ${stats.winRate >= 55 ? "bg-gain/10 border-gain/20 text-gain" : stats.winRate >= 45 ? "bg-warning/10 border-warning/20 text-warning" : "bg-loss/10 border-loss/20 text-loss"}`}>
                {regime} {stats.winRate}% (n={stats.n})
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Recommendations */}
      {feedback.recommendations.length > 0 && (
        <div className="space-y-1">
          <div className="text-[7px] text-muted-foreground uppercase tracking-wider">AI Recommendations</div>
          <div className="space-y-0.5">
            {feedback.recommendations.slice(0, 5).map((rec, i) => (
              <div key={i} className="text-[7px] font-mono text-foreground/80 py-0.5">
                {rec}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function formatConditionLabel(key: string): string {
  return key.replace(":", "→").replace(/_/g, " ");
}

function formatPairLabel(pair: string): string {
  return pair.split("+").map(p => formatConditionLabel(p)).join(" + ");
}
