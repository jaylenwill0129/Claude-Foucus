import { useState } from "react";
import { Bell, BellRing, Plus, Trash2, Volume2, VolumeX, TrendingUp, TrendingDown, Zap, X } from "lucide-react";
import { Alert, AlertNotification } from "@/hooks/useAlerts";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { TickerData } from "@/hooks/useWebullData";

interface AlertsPanelProps {
  alerts: Alert[];
  notifications: AlertNotification[];
  unreadCount: number;
  soundEnabled: boolean;
  onSoundToggle: (v: boolean) => void;
  onAddPriceAlert: (symbol: string, price: number, direction: "above" | "below") => void;
  onAddPnlAlert: (type: "profit" | "loss", threshold: number) => void;
  onAddSignalAlert: (symbol: string, signalType: "buy" | "sell" | "any", minConfidence: number) => void;
  onRemoveAlert: (id: string) => void;
  onClearNotifications: () => void;
  symbols: string[];
  tickers: Record<string, TickerData>;
}

type NewAlertType = "price" | "pnl" | "signal";

export function AlertsPanel({
  alerts, notifications, unreadCount, soundEnabled,
  onSoundToggle, onAddPriceAlert, onAddPnlAlert, onAddSignalAlert,
  onRemoveAlert, onClearNotifications, symbols, tickers,
}: AlertsPanelProps) {
  const [showAdd, setShowAdd] = useState(false);
  const [alertType, setAlertType] = useState<NewAlertType>("price");
  const [priceSymbol, setPriceSymbol] = useState("");
  const [priceTarget, setPriceTarget] = useState("");
  const [priceDir, setPriceDir] = useState<"above" | "below">("above");
  const [pnlType, setPnlType] = useState<"profit" | "loss">("profit");
  const [pnlThreshold, setPnlThreshold] = useState("5");
  const [sigSymbol, setSigSymbol] = useState("");
  const [sigType, setSigType] = useState<"buy" | "sell" | "any">("any");
  const [sigConf, setSigConf] = useState("70");
  const [tab, setTab] = useState<"alerts" | "history">("alerts");

  const handleAdd = () => {
    if (alertType === "price" && priceSymbol && priceTarget) {
      onAddPriceAlert(priceSymbol, parseFloat(priceTarget), priceDir);
      setPriceTarget("");
      setShowAdd(false);
    } else if (alertType === "pnl" && pnlThreshold) {
      onAddPnlAlert(pnlType, parseFloat(pnlThreshold));
      setShowAdd(false);
    } else if (alertType === "signal" && sigSymbol) {
      onAddSignalAlert(sigSymbol, sigType, parseInt(sigConf));
      setShowAdd(false);
    }
  };

  const activeAlerts = alerts.filter(a => !a.triggered);
  const triggeredAlerts = alerts.filter(a => a.triggered);

  return (
    <div className="bg-card rounded-lg border border-border p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          {unreadCount > 0 ? <BellRing className="w-4 h-4 text-primary animate-pulse" /> : <Bell className="w-4 h-4 text-accent" />}
          Alerts
          {unreadCount > 0 && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary font-mono">{unreadCount}</span>
          )}
        </h3>
        <div className="flex items-center gap-2">
          <button onClick={() => onSoundToggle(!soundEnabled)} className="p-1 rounded hover:bg-secondary transition-colors text-muted-foreground">
            {soundEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
          </button>
          <button onClick={() => setShowAdd(!showAdd)} className="p-1 rounded hover:bg-secondary transition-colors text-muted-foreground hover:text-primary">
            {showAdd ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Add Alert Form */}
      {showAdd && (
        <div className="mb-3 p-3 rounded-md bg-secondary/50 border border-border space-y-2">
          <div className="flex gap-1">
            {(["price", "pnl", "signal"] as NewAlertType[]).map(t => (
              <button key={t} onClick={() => setAlertType(t)}
                className={`text-[10px] px-2 py-1 rounded font-medium transition-colors ${alertType === t ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"}`}>
                {t === "price" ? "Price" : t === "pnl" ? "P&L" : "Signal"}
              </button>
            ))}
          </div>

          {alertType === "price" && (
            <div className="space-y-2">
              <select value={priceSymbol} onChange={e => setPriceSymbol(e.target.value)} className="w-full text-[11px] bg-background border border-border rounded px-2 py-1.5 text-foreground">
                <option value="">Select symbol</option>
                {symbols.map(s => <option key={s} value={s}>{s} {tickers[s] ? `($${tickers[s].price})` : ""}</option>)}
              </select>
              <div className="flex gap-2">
                <select value={priceDir} onChange={e => setPriceDir(e.target.value as "above" | "below")} className="text-[11px] bg-background border border-border rounded px-2 py-1.5 text-foreground">
                  <option value="above">Above</option>
                  <option value="below">Below</option>
                </select>
                <Input type="number" placeholder="Target price" value={priceTarget} onChange={e => setPriceTarget(e.target.value)} className="h-7 text-[11px]" />
              </div>
            </div>
          )}

          {alertType === "pnl" && (
            <div className="flex gap-2">
              <select value={pnlType} onChange={e => setPnlType(e.target.value as "profit" | "loss")} className="text-[11px] bg-background border border-border rounded px-2 py-1.5 text-foreground">
                <option value="profit">Profit ≥</option>
                <option value="loss">Loss ≥</option>
              </select>
              <Input type="number" placeholder="%" value={pnlThreshold} onChange={e => setPnlThreshold(e.target.value)} className="h-7 text-[11px]" />
              <span className="text-[11px] text-muted-foreground self-center">%</span>
            </div>
          )}

          {alertType === "signal" && (
            <div className="space-y-2">
              <select value={sigSymbol} onChange={e => setSigSymbol(e.target.value)} className="w-full text-[11px] bg-background border border-border rounded px-2 py-1.5 text-foreground">
                <option value="">Select symbol</option>
                <option value="ALL">All symbols</option>
                {symbols.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <div className="flex gap-2">
                <select value={sigType} onChange={e => setSigType(e.target.value as "buy" | "sell" | "any")} className="text-[11px] bg-background border border-border rounded px-2 py-1.5 text-foreground">
                  <option value="any">Any signal</option>
                  <option value="buy">Buy signals</option>
                  <option value="sell">Sell signals</option>
                </select>
                <Input type="number" placeholder="Min %" value={sigConf} onChange={e => setSigConf(e.target.value)} className="h-7 text-[11px]" />
              </div>
            </div>
          )}

          <button onClick={handleAdd} className="w-full text-[11px] py-1.5 rounded bg-primary/15 text-primary hover:bg-primary/25 transition-colors font-medium">
            Add Alert
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-2">
        <button onClick={() => setTab("alerts")} className={`text-[10px] px-2 py-1 rounded font-medium ${tab === "alerts" ? "bg-secondary text-foreground" : "text-muted-foreground"}`}>
          Active ({activeAlerts.length})
        </button>
        <button onClick={() => setTab("history")} className={`text-[10px] px-2 py-1 rounded font-medium ${tab === "history" ? "bg-secondary text-foreground" : "text-muted-foreground"}`}>
          History ({notifications.length})
        </button>
      </div>

      {/* Active Alerts */}
      {tab === "alerts" && (
        <div className="space-y-1 max-h-48 overflow-y-auto scrollbar-thin">
          {activeAlerts.length === 0 ? (
            <div className="text-[11px] text-muted-foreground text-center py-4">No active alerts. Tap + to add one.</div>
          ) : activeAlerts.map(alert => (
            <div key={alert.id} className="flex items-center justify-between py-1.5 px-2 rounded bg-secondary/30 text-[10px] font-mono">
              <div className="flex items-center gap-2">
                {alert.alertType === "price" && (
                  <>
                    {alert.direction === "above" ? <TrendingUp className="w-3 h-3 text-gain" /> : <TrendingDown className="w-3 h-3 text-loss" />}
                    <span className="text-foreground">{alert.symbol}</span>
                    <span className="text-muted-foreground">{alert.direction} ${alert.targetPrice.toFixed(2)}</span>
                  </>
                )}
                {alert.alertType === "pnl" && (
                  <>
                    <Zap className={`w-3 h-3 ${alert.type === "profit" ? "text-gain" : "text-loss"}`} />
                    <span className="text-foreground">P&L {alert.type}</span>
                    <span className="text-muted-foreground">≥{alert.thresholdPct}%</span>
                  </>
                )}
                {alert.alertType === "signal" && (
                  <>
                    <Bell className="w-3 h-3 text-accent" />
                    <span className="text-foreground">{alert.symbol}</span>
                    <span className="text-muted-foreground">{alert.signalType} ≥{alert.minConfidence}%</span>
                  </>
                )}
              </div>
              <button onClick={() => onRemoveAlert(alert.id)} className="text-muted-foreground hover:text-loss transition-colors">
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Notification History */}
      {tab === "history" && (
        <div className="space-y-1 max-h-48 overflow-y-auto scrollbar-thin">
          {notifications.length === 0 ? (
            <div className="text-[11px] text-muted-foreground text-center py-4">No notifications yet</div>
          ) : (
            <>
              <button onClick={onClearNotifications} className="text-[9px] text-muted-foreground hover:text-foreground mb-1">Clear all</button>
              {notifications.map(n => (
                <div key={n.id} className={`flex items-start justify-between py-1.5 px-2 rounded text-[10px] ${n.read ? "bg-secondary/20" : "bg-secondary/40 border border-border/50"}`}>
                  <div className="flex items-start gap-1.5">
                    <span className={`mt-0.5 w-1.5 h-1.5 rounded-full shrink-0 ${
                      n.severity === "success" ? "bg-gain" : n.severity === "error" ? "bg-loss" : n.severity === "warning" ? "bg-accent" : "bg-primary"
                    }`} />
                    <span className="text-foreground">{n.message}</span>
                  </div>
                  <span className="text-muted-foreground/50 shrink-0 ml-2 font-mono">
                    {new Date(n.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
