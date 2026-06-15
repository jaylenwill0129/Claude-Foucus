import { PreBoomAlert } from "@/hooks/usePreBoomScanner";
import { ArrowRight, CheckCircle2, Clock, Rocket, ShieldAlert, X } from "lucide-react";

interface PreBoomAlertsProps {
  alerts: PreBoomAlert[];
  onDismiss: (symbol: string) => void;
  onSelect: (symbol: string) => void;
  totalScanned: number;
  totalEvaluated?: number;
  lastScanAt?: number;
  activeSpikeWindow?: string;
  nextSpikeWindow?: string;
}

export function PreBoomAlerts({
  alerts,
  onDismiss,
  onSelect,
  totalScanned,
  totalEvaluated = 0,
  lastScanAt,
  activeSpikeWindow,
  nextSpikeWindow,
}: PreBoomAlertsProps) {
  const readyLabel = totalScanned > 0 ? `${totalEvaluated}/${totalScanned} ready` : "idle";
  const ageSeconds = lastScanAt ? Math.max(0, Math.floor((Date.now() - lastScanAt) / 1000)) : undefined;
  const windowLabel = activeSpikeWindow ? `${activeSpikeWindow} active` : nextSpikeWindow ? `next ${nextSpikeWindow}` : "no timing edge";

  if (alerts.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-xs font-bold text-foreground">
            <Rocket className="h-3.5 w-3.5 text-primary" />
            Pre-Boom Options
          </h3>
          <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[8px] text-muted-foreground">
            {totalScanned} scanned
          </span>
        </div>
        <div className="mt-2 flex items-center justify-between rounded-md border border-border bg-secondary px-2 py-1 text-[9px] text-muted-foreground">
          <span className="font-mono">{readyLabel}</span>
          <span className="font-mono">{ageSeconds === undefined ? "warming up" : `${ageSeconds}s ago`}</span>
        </div>
        <div className={`mt-2 rounded-md border px-2 py-1 text-[9px] ${
          activeSpikeWindow ? "border-primary/30 bg-primary/10 text-primary" : "border-border bg-secondary text-muted-foreground"
        }`}>
          Timing: <span className="font-mono">{windowLabel}</span>
        </div>
        <div className="mt-2 rounded-md bg-secondary p-2 text-[10px] text-muted-foreground">
          No active pre-boom alert. Scanner is waiting for acceleration, range strength, volume expansion, catalyst support, and contract-cost fit.
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-lg border border-primary/30 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold text-foreground flex items-center gap-1.5">
          <Rocket className="w-3.5 h-3.5 text-primary" />
          Pre-Boom Options
          <span className="text-[8px] px-1 py-0.5 rounded bg-primary/10 text-primary font-mono">
            {totalScanned} scanned
          </span>
        </h3>
        <span className="text-[8px] font-mono text-muted-foreground/50">
          {alerts.length} alert{alerts.length !== 1 ? "s" : ""}
        </span>
      </div>

      <div className="space-y-1.5">
        {alerts.map((alert) => {
          const ageSeconds = Math.floor((Date.now() - alert.detectedAt) / 1000);
          return (
            <div
              key={alert.symbol}
              className={`flex items-center gap-2 rounded-md p-2 border cursor-pointer transition-all hover:scale-[1.01] active:scale-[0.99] ${
                alert.urgency === "IMMINENT"
                  ? "bg-gain/5 border-gain/30 animate-pulse"
                  : alert.urgency === "BUILDING"
                  ? "bg-primary/5 border-primary/20"
                  : "bg-secondary/30 border-border/30"
              }`}
              onClick={() => onSelect(alert.symbol)}
            >
              {/* Score badge */}
              <div className={`w-9 h-9 rounded-md flex flex-col items-center justify-center shrink-0 ${
                alert.score >= 70 ? "bg-gain/15 text-gain" :
                alert.score >= 55 ? "bg-primary/15 text-primary" :
                "bg-warning/15 text-warning"
              }`}>
                <span className="text-[11px] font-bold font-mono leading-none">{alert.score}</span>
                <span className="text-[6px] uppercase">score</span>
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-foreground">{alert.symbol}</span>
                  <span className={`text-[8px] px-1 py-0.5 rounded font-bold font-mono ${
                    alert.urgency === "IMMINENT" ? "bg-gain/20 text-gain" :
                    alert.urgency === "BUILDING" ? "bg-primary/15 text-primary" :
                    "bg-secondary text-muted-foreground"
                  }`}>
                    {alert.urgency}
                  </span>
                  <span className="text-[9px] font-mono text-gain">+{alert.changePct.toFixed(1)}%</span>
                </div>
                <div className="text-[8px] text-muted-foreground truncate">
                  {alert.reasons[0]}
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  <span className={`rounded border px-1.5 py-0.5 text-[8px] font-mono ${
                    alert.optionBudgetFit ? "border-gain/30 bg-gain/10 text-gain" : "border-warning/30 bg-warning/10 text-warning"
                  }`}>
                    {alert.contractCost ? `$${alert.contractCost} contract` : "chain check"}
                  </span>
                  <span className="rounded border border-border bg-card px-1.5 py-0.5 text-[8px] font-mono text-muted-foreground">
                    {alert.sourceCount ?? 1} src
                  </span>
                  {alert.gateStatus && (
                    <span className={`rounded border px-1.5 py-0.5 text-[8px] font-mono ${
                      alert.gateStatus === "approved"
                        ? "border-gain/30 bg-gain/10 text-gain"
                        : alert.gateStatus === "blocked"
                          ? "border-loss/30 bg-loss/10 text-loss"
                          : "border-warning/30 bg-warning/10 text-warning"
                    }`}>
                      {alert.gateStatus}
                    </span>
                  )}
                  {alert.timeWindow && (
                    <span className="rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[8px] font-mono text-primary">
                      {alert.timeWindow}
                    </span>
                  )}
                </div>
                <div className="mt-1 flex items-start gap-1 text-[8px] text-muted-foreground">
                  {alert.gateStatus === "blocked" ? <ShieldAlert className="mt-0.5 h-2.5 w-2.5 shrink-0 text-loss" /> : <CheckCircle2 className="mt-0.5 h-2.5 w-2.5 shrink-0 text-gain" />}
                  <span className="line-clamp-2">{alert.action}</span>
                </div>
              </div>

              {/* Price + age */}
              <div className="text-right shrink-0">
                <div className="text-[10px] font-mono font-bold text-foreground">${alert.price.toFixed(2)}</div>
                <div className="text-[7px] font-mono text-muted-foreground/50 flex items-center gap-0.5 justify-end">
                  <Clock className="w-2 h-2" />
                  {ageSeconds}s ago
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-col gap-0.5 shrink-0">
                <button
                  onClick={(e) => { e.stopPropagation(); onSelect(alert.symbol); }}
                  className="p-1 rounded bg-primary/10 text-primary hover:bg-primary/20"
                  title="View signal"
                >
                  <ArrowRight className="w-2.5 h-2.5" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onDismiss(alert.symbol); }}
                  className="p-1 rounded bg-secondary text-muted-foreground hover:text-foreground"
                  title="Dismiss"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
