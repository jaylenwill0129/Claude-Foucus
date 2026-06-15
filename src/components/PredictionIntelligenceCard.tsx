import { Brain, Clock, Activity, Gauge, Shield, TrendingUp, TrendingDown, BarChart3 } from "lucide-react";
import type { ShortTermPrediction } from "@/lib/microPredictions";
import { getIndicatorWeights, type VolatilityRegime } from "@/lib/predictionIntelligence";
import { useMemo } from "react";

interface Props {
  predictions: ShortTermPrediction[];
  symbol: string;
}

const regimeConfig: Record<VolatilityRegime, { label: string; color: string; icon: string }> = {
  trending: { label: "Trending", color: "text-gain", icon: "📈" },
  choppy: { label: "Choppy", color: "text-loss", icon: "🔀" },
  volatile: { label: "Volatile", color: "text-warning", icon: "⚡" },
  calm: { label: "Calm", color: "text-muted-foreground", icon: "😴" },
};

export function PredictionIntelligenceCard({ predictions, symbol }: Props) {
  const intel = predictions[0]?.intelligence;
  const weights = useMemo(() => getIndicatorWeights(), [predictions]);
  const topWeights = useMemo(() => {
    return Object.values(weights)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 5);
  }, [weights]);
  const worstWeights = useMemo(() => {
    return Object.values(weights)
      .sort((a, b) => a.weight - b.weight)
      .slice(0, 3);
  }, [weights]);

  if (!intel) return null;

  const regime = regimeConfig[intel.regime];

  return (
    <div className="p-3 rounded-lg bg-gradient-to-br from-accent/5 via-primary/3 to-secondary/5 border border-accent/20 space-y-2.5">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-wider text-accent flex items-center gap-1.5">
          <Brain className="w-3.5 h-3.5" /> Prediction Intelligence
        </div>
        <span className="text-[8px] font-mono text-muted-foreground">{symbol}</span>
      </div>

      {/* Top row: Regime, Time Reliability, Calibration */}
      <div className="grid grid-cols-3 gap-1.5">
        <div className="p-2 rounded border bg-secondary/30 border-border/30 text-center">
          <div className="text-[6px] text-muted-foreground uppercase">Regime</div>
          <div className={`text-[11px] font-bold font-mono ${regime.color}`}>
            {regime.icon} {regime.label}
          </div>
          <div className="text-[7px] text-muted-foreground">
            {intel.regimeAdjustment > 0 ? "+" : ""}{intel.regimeAdjustment}% threshold
          </div>
        </div>
        <div className="p-2 rounded border bg-secondary/30 border-border/30 text-center">
          <div className="text-[6px] text-muted-foreground uppercase">Time Reliability</div>
          <div className={`text-[11px] font-bold font-mono ${intel.timeReliability >= 0.9 ? "text-gain" : intel.timeReliability >= 0.7 ? "text-warning" : "text-loss"}`}>
            {(intel.timeReliability * 100).toFixed(0)}%
          </div>
          <div className="text-[7px] text-muted-foreground">
            {intel.timeReliability >= 0.9 ? "Prime hours" : intel.timeReliability >= 0.7 ? "Moderate" : "Low reliability"}
          </div>
        </div>
        <div className="p-2 rounded border bg-secondary/30 border-border/30 text-center">
          <div className="text-[6px] text-muted-foreground uppercase">Calibration</div>
          <div className={`text-[11px] font-bold font-mono ${Math.abs(intel.calibrationDelta) < 3 ? "text-gain" : Math.abs(intel.calibrationDelta) < 8 ? "text-warning" : "text-loss"}`}>
            {intel.calibrationDelta > 0 ? "+" : ""}{intel.calibrationDelta.toFixed(1)}%
          </div>
          <div className="text-[7px] text-muted-foreground">
            {Math.abs(intel.calibrationDelta) < 3 ? "Well calibrated" : "Drifting"}
          </div>
        </div>
      </div>

      {/* Decay & Sector */}
      <div className="grid grid-cols-2 gap-1.5">
        <div className="p-1.5 rounded border bg-secondary/20 border-border/20 flex items-center justify-between">
          <div className="flex items-center gap-1">
            <Clock className="w-3 h-3 text-muted-foreground" />
            <span className="text-[8px] text-muted-foreground">Signal Decay</span>
          </div>
          <span className={`text-[9px] font-mono font-bold ${intel.decayFactor >= 0.9 ? "text-gain" : intel.decayFactor >= 0.5 ? "text-warning" : "text-loss"}`}>
            {(intel.decayFactor * 100).toFixed(0)}%
          </span>
        </div>
        <div className="p-1.5 rounded border bg-secondary/20 border-border/20 flex items-center justify-between">
          <div className="flex items-center gap-1">
            <Activity className="w-3 h-3 text-muted-foreground" />
            <span className="text-[8px] text-muted-foreground">Sector Context</span>
          </div>
          <span className={`text-[9px] font-mono font-bold ${intel.sectorPenalty > 3 ? "text-gain" : intel.sectorPenalty < -3 ? "text-loss" : "text-muted-foreground"}`}>
            {intel.sectorPenalty > 0 ? "+" : ""}{intel.sectorPenalty.toFixed(0)}
          </span>
        </div>
      </div>

      {/* Outcome Weight Factor */}
      <div className="p-1.5 rounded border bg-secondary/20 border-border/20 flex items-center justify-between">
        <div className="flex items-center gap-1">
          <Gauge className="w-3 h-3 text-muted-foreground" />
          <span className="text-[8px] text-muted-foreground">Outcome Weight</span>
        </div>
        <span className={`text-[9px] font-mono font-bold ${intel.outcomeWeightFactor > 1.1 ? "text-gain" : intel.outcomeWeightFactor < 0.9 ? "text-loss" : "text-foreground"}`}>
          {intel.outcomeWeightFactor.toFixed(2)}x
        </span>
      </div>

      {/* Top & Worst Indicator Weights */}
      {topWeights.length > 0 && (
        <div className="space-y-1">
          <div className="text-[7px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <BarChart3 className="w-2.5 h-2.5" /> Indicator Performance
          </div>
          <div className="flex gap-1 flex-wrap">
            {topWeights.map(w => (
              <span key={w.name} className={`text-[7px] px-1.5 py-0.5 rounded font-mono border ${w.profitRate >= 0.6 ? "bg-gain/10 border-gain/20 text-gain" : w.profitRate >= 0.45 ? "bg-warning/10 border-warning/20 text-warning" : "bg-loss/10 border-loss/20 text-loss"}`}>
                {w.name.replace("_", " ")} {(w.profitRate * 100).toFixed(0)}% ({w.sampleSize})
              </span>
            ))}
          </div>
          {worstWeights.length > 0 && worstWeights[0].profitRate < 0.4 && (
            <div className="flex gap-1 flex-wrap">
              {worstWeights.filter(w => w.profitRate < 0.4).map(w => (
                <span key={w.name} className="text-[7px] px-1.5 py-0.5 rounded font-mono border bg-loss/5 border-loss/15 text-loss/70">
                  ⚠ {w.name.replace("_", " ")} {(w.profitRate * 100).toFixed(0)}%
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Intelligence Reasons */}
      {intel.reasons.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {intel.reasons.map((r, i) => (
            <span key={i} className="text-[6px] px-1 py-0.5 rounded bg-accent/10 border border-accent/15 text-accent/80 font-mono">
              {r}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
