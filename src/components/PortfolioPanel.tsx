import { useState, useMemo } from "react";
import { Portfolio, Position, PendingOrder, TradingSettings } from "@/hooks/usePaperTrading";
import { TickerData } from "@/hooks/useWebullData";
import { DollarSign, Plus, Minus, RotateCcw, Clock, TrendingUp, TrendingDown, PieChart, Settings, X, Target, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

interface PortfolioPanelProps {
  portfolio: Portfolio;
  tickers: Record<string, TickerData>;
  onClosePosition: (positionId: string, currentPrice: number) => void;
  onAddFunds?: (amount: number) => void;
  onWithdrawFunds?: (amount: number) => void;
  onReset?: () => void;
  onCancelOrder?: (orderId: string) => void;
  onUpdateLevels?: (positionId: string, stopLoss?: number, takeProfit?: number) => void;
  settings?: TradingSettings;
  onSettingsChange?: (settings: TradingSettings) => void;
}

function formatAge(timestamp: number): string {
  const mins = Math.floor((Date.now() - timestamp) / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  return `${Math.floor(hrs / 24)}d ${hrs % 24}h`;
}

export function PortfolioPanel({
  portfolio, tickers, onClosePosition, onAddFunds, onWithdrawFunds, onReset,
  onCancelOrder, onUpdateLevels, settings, onSettingsChange,
}: PortfolioPanelProps) {
  const [fundAmount, setFundAmount] = useState("");
  const [showFunds, setShowFunds] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [tradeFilter, setTradeFilter] = useState<"all" | "wins" | "losses">("all");
  const [editingLevels, setEditingLevels] = useState<string | null>(null);
  const [editSL, setEditSL] = useState("");
  const [editTP, setEditTP] = useState("");

  const positionDetails = useMemo(() => {
    const totalInvested = portfolio.positions.reduce((t, p) => t + p.entryPrice * p.quantity, 0);
    return portfolio.positions.map(pos => {
      const currentPrice = tickers[pos.symbol] ? parseFloat(tickers[pos.symbol].price) : pos.entryPrice;
      const costBasis = pos.entryPrice * pos.quantity;
      const pnl = pos.side === "long"
        ? (currentPrice - pos.entryPrice) * pos.quantity
        : (pos.entryPrice - currentPrice) * pos.quantity;
      const pnlPct = costBasis > 0 ? (pnl / costBasis) * 100 : 0;
      const allocation = totalInvested > 0 ? (costBasis / totalInvested) * 100 : 0;
      return { ...pos, currentPrice, costBasis, pnl, pnlPct, allocation };
    });
  }, [portfolio.positions, tickers]);

  const unrealizedPnl = positionDetails.reduce((t, p) => t + p.pnl, 0);
  const totalInvested = positionDetails.reduce((t, p) => t + p.costBasis, 0);
  const totalEquity = portfolio.balance + totalInvested + unrealizedPnl;

  const winRate = useMemo(() => {
    const closed = portfolio.trades.filter(t => t.pnl !== undefined);
    if (closed.length === 0) return 0;
    return (closed.filter(t => (t.pnl || 0) > 0).length / closed.length) * 100;
  }, [portfolio.trades]);

  const filteredTrades = useMemo(() => {
    const trades = portfolio.trades.slice(-30).reverse();
    if (tradeFilter === "wins") return trades.filter(t => t.pnl != null && t.pnl > 0);
    if (tradeFilter === "losses") return trades.filter(t => t.pnl != null && t.pnl < 0);
    return trades;
  }, [portfolio.trades, tradeFilter]);

  return (
    <div className="bg-card rounded-lg border border-border p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <PieChart className="w-4 h-4 text-accent" /> Portfolio
        </h3>
        <div className="flex items-center gap-1">
          {settings && onSettingsChange && (
            <button onClick={() => setShowSettings(!showSettings)}
              className="p-1 rounded hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground" title="Trading Settings">
              <Settings className="w-3.5 h-3.5" />
            </button>
          )}
          <button onClick={() => setShowFunds(!showFunds)}
            className="p-1 rounded hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground" title="Add/Withdraw Funds">
            <DollarSign className="w-3.5 h-3.5" />
          </button>
          {onReset && (
            <button onClick={() => { onReset(); toast.success("Portfolio reset to $100,000"); }}
              className="p-1 rounded hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground" title="Reset Portfolio">
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Trading Settings */}
      {showSettings && settings && onSettingsChange && (
        <div className="mb-3 p-2.5 rounded-md bg-secondary/50 border border-border space-y-2">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Realism Settings</div>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex items-center gap-1.5 text-[10px] text-foreground cursor-pointer">
              <input type="checkbox" checked={settings.enableSlippage}
                onChange={e => onSettingsChange({ ...settings, enableSlippage: e.target.checked })}
                className="rounded border-border" />
              Slippage ({settings.slippageBps}bps)
            </label>
            <label className="flex items-center gap-1.5 text-[10px] text-foreground cursor-pointer">
              <input type="checkbox" checked={settings.enableCommissions}
                onChange={e => onSettingsChange({ ...settings, enableCommissions: e.target.checked })}
                className="rounded border-border" />
              Commission ({settings.commissionPct}%)
            </label>
            <label className="flex items-center gap-1.5 text-[10px] text-foreground cursor-pointer">
              <input type="checkbox" checked={settings.enableTrailingStop}
                onChange={e => onSettingsChange({ ...settings, enableTrailingStop: e.target.checked })}
                className="rounded border-border" />
              Trailing Stop ({settings.trailingStopPct}%)
            </label>
            <div>
              <span className="text-[9px] text-muted-foreground">Max Position %</span>
              <input type="number" value={settings.maxPositionPct}
                onChange={e => onSettingsChange({ ...settings, maxPositionPct: parseFloat(e.target.value) || 25 })}
                className="w-full px-1.5 py-0.5 text-[10px] font-mono bg-background border border-border rounded" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className="text-[9px] text-muted-foreground">Default SL %</span>
              <input type="number" step="0.5" value={settings.defaultStopLossPct}
                onChange={e => onSettingsChange({ ...settings, defaultStopLossPct: parseFloat(e.target.value) || 0 })}
                className="w-full px-1.5 py-0.5 text-[10px] font-mono bg-background border border-border rounded" />
            </div>
            <div>
              <span className="text-[9px] text-muted-foreground">Default TP %</span>
              <input type="number" step="0.5" value={settings.defaultTakeProfitPct}
                onChange={e => onSettingsChange({ ...settings, defaultTakeProfitPct: parseFloat(e.target.value) || 0 })}
                className="w-full px-1.5 py-0.5 text-[10px] font-mono bg-background border border-border rounded" />
            </div>
          </div>
        </div>
      )}

      {/* Fund management */}
      {showFunds && (
        <div className="mb-3 p-2.5 rounded-md bg-secondary/50 border border-border">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Manage Funds</div>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
              <input type="number" value={fundAmount} onChange={e => setFundAmount(e.target.value)} placeholder="Amount"
                className="w-full pl-5 pr-2 py-1.5 text-xs font-mono bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary" />
            </div>
            <button onClick={() => {
              const amt = parseFloat(fundAmount);
              if (amt > 0 && onAddFunds) { onAddFunds(amt); setFundAmount(""); toast.success(`Added $${amt.toLocaleString()}`); }
            }} className="px-2 py-1.5 rounded bg-gain/20 text-gain text-[10px] font-semibold hover:bg-gain/30 transition-colors flex items-center gap-1">
              <Plus className="w-3 h-3" /> Add
            </button>
            <button onClick={() => {
              const amt = parseFloat(fundAmount);
              if (amt > 0 && onWithdrawFunds) {
                if (amt > portfolio.balance) { toast.error("Insufficient balance"); return; }
                onWithdrawFunds(amt); setFundAmount(""); toast.success(`Withdrew $${amt.toLocaleString()}`);
              }
            }} className="px-2 py-1.5 rounded bg-loss/20 text-loss text-[10px] font-semibold hover:bg-loss/30 transition-colors flex items-center gap-1">
              <Minus className="w-3 h-3" /> Withdraw
            </button>
          </div>
          <div className="flex gap-1.5 mt-2">
            {[1000, 5000, 10000, 50000].map(amt => (
              <button key={amt} onClick={() => setFundAmount(String(amt))}
                className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground hover:text-foreground transition-colors font-mono">
                ${amt >= 1000 ? `${amt / 1000}K` : amt}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Equity</div>
          <div className="text-base font-mono font-bold text-foreground">
            ${totalEquity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Cash</div>
          <div className="text-base font-mono font-bold text-foreground">
            ${portfolio.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Win Rate</div>
          <div className={`text-base font-mono font-bold ${winRate >= 50 ? "text-gain" : "text-loss"}`}>
            {winRate.toFixed(1)}%
          </div>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Unrealized P&L</div>
          <div className={`text-sm font-mono font-semibold ${unrealizedPnl >= 0 ? "text-gain" : "text-loss"}`}>
            {unrealizedPnl >= 0 ? "+" : ""}${unrealizedPnl.toFixed(2)}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Realized P&L</div>
          <div className={`text-sm font-mono font-semibold ${portfolio.totalPnl >= 0 ? "text-gain" : "text-loss"}`}>
            {portfolio.totalPnl >= 0 ? "+" : ""}${portfolio.totalPnl.toFixed(2)}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Total Fees</div>
          <div className="text-sm font-mono font-semibold text-warning">
            -${portfolio.totalFees.toFixed(2)}
          </div>
        </div>
      </div>

      {/* Margin bar */}
      {portfolio.marginUsed > 0 && (
        <div className="mb-3">
          <div className="flex justify-between text-[9px] text-muted-foreground mb-1">
            <span>Margin Used</span>
            <span className="font-mono">${portfolio.marginUsed.toLocaleString(undefined, { maximumFractionDigits: 0 })} / ${totalEquity.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
          </div>
          <div className="w-full bg-secondary rounded-full h-1.5">
            <div className={`h-1.5 rounded-full transition-all ${(portfolio.marginUsed / totalEquity) > 0.8 ? "bg-loss" : (portfolio.marginUsed / totalEquity) > 0.5 ? "bg-warning" : "bg-accent"}`}
              style={{ width: `${Math.min((portfolio.marginUsed / totalEquity) * 100, 100)}%` }} />
          </div>
        </div>
      )}

      {/* Pending Orders */}
      {portfolio.pendingOrders.length > 0 && (
        <div className="mb-3">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">
            Pending Orders ({portfolio.pendingOrders.length})
          </div>
          <div className="space-y-1.5 max-h-[100px] overflow-y-auto scrollbar-thin">
            {portfolio.pendingOrders.map(order => (
              <div key={order.id} className="flex items-center justify-between bg-secondary rounded-md px-2.5 py-1.5">
                <div className="flex items-center gap-2 text-[10px]">
                  <span className={`font-semibold uppercase ${order.side === "long" ? "text-gain" : "text-loss"}`}>
                    {order.side}
                  </span>
                  <span className="text-foreground font-medium">{order.symbol}</span>
                  <span className="text-muted-foreground font-mono">
                    {order.type.toUpperCase()} {order.limitPrice ? `@$${order.limitPrice.toFixed(2)}` : ""} {order.stopPrice ? `↑$${order.stopPrice.toFixed(2)}` : ""}
                  </span>
                  <span className="text-muted-foreground font-mono">×{order.quantity.toFixed(4)}</span>
                </div>
                {onCancelOrder && (
                  <button onClick={() => { onCancelOrder(order.id); toast.info("Order cancelled"); }}
                    className="p-0.5 rounded hover:bg-loss/20 text-muted-foreground hover:text-loss transition-colors">
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Open Positions */}
      {positionDetails.length > 0 && (
        <div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">
            Open Positions ({positionDetails.length})
          </div>
          <div className="space-y-2 max-h-[260px] overflow-y-auto scrollbar-thin">
            {positionDetails.map(pos => (
              <div key={pos.id} className="bg-secondary rounded-md p-2.5">
                <div className="flex justify-between items-center mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-foreground">{pos.symbol}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${pos.side === "long" ? "bg-gain/20 text-gain" : "bg-loss/20 text-loss"}`}>
                      {pos.side === "long" ? <TrendingUp className="w-2.5 h-2.5 inline mr-0.5" /> : <TrendingDown className="w-2.5 h-2.5 inline mr-0.5" />}
                      {pos.side.toUpperCase()}
                    </span>
                    <span className="text-[9px] text-muted-foreground/60 flex items-center gap-0.5">
                      <Clock className="w-2.5 h-2.5" />{formatAge(pos.timestamp)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    {onUpdateLevels && (
                      <button onClick={() => {
                        if (editingLevels === pos.id) {
                          const sl = parseFloat(editSL) || undefined;
                          const tp = parseFloat(editTP) || undefined;
                          onUpdateLevels(pos.id, sl, tp);
                          setEditingLevels(null);
                          toast.success("SL/TP updated");
                        } else {
                          setEditingLevels(pos.id);
                          setEditSL(pos.stopLoss?.toFixed(2) || "");
                          setEditTP(pos.takeProfit?.toFixed(2) || "");
                        }
                      }}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-muted hover:bg-accent/20 hover:text-accent text-muted-foreground transition-colors font-medium">
                        <Target className="w-2.5 h-2.5 inline mr-0.5" />
                        {editingLevels === pos.id ? "Save" : "SL/TP"}
                      </button>
                    )}
                    <button onClick={() => onClosePosition(pos.id, pos.currentPrice)}
                      className="text-[10px] px-2 py-0.5 rounded bg-muted hover:bg-loss/20 hover:text-loss text-muted-foreground transition-colors font-medium">
                      Close
                    </button>
                  </div>
                </div>

                {/* SL/TP edit */}
                {editingLevels === pos.id && (
                  <div className="grid grid-cols-2 gap-1.5 mb-1.5 p-1.5 bg-background/50 rounded border border-border/50">
                    <div>
                      <span className="text-[8px] text-loss uppercase">Stop Loss</span>
                      <input type="number" value={editSL} onChange={e => setEditSL(e.target.value)}
                        className="w-full px-1 py-0.5 text-[10px] font-mono bg-background border border-border rounded" />
                    </div>
                    <div>
                      <span className="text-[8px] text-gain uppercase">Take Profit</span>
                      <input type="number" value={editTP} onChange={e => setEditTP(e.target.value)}
                        className="w-full px-1 py-0.5 text-[10px] font-mono bg-background border border-border rounded" />
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-4 gap-1 text-[9px] font-mono">
                  <div>
                    <span className="text-muted-foreground block">Entry</span>
                    <span className="text-foreground">${pos.entryPrice.toLocaleString()}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block">Current</span>
                    <span className="text-foreground">${pos.currentPrice.toLocaleString()}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block">P&L</span>
                    <span className={pos.pnl >= 0 ? "text-gain" : "text-loss"}>
                      {pos.pnl >= 0 ? "+" : ""}${pos.pnl.toFixed(2)}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block">Alloc</span>
                    <span className="text-accent">{pos.allocation.toFixed(1)}%</span>
                  </div>
                </div>

                {/* SL/TP levels indicator */}
                {(pos.stopLoss || pos.takeProfit) && (
                  <div className="flex gap-2 mt-1 text-[8px] font-mono">
                    {pos.stopLoss && <span className="text-loss flex items-center gap-0.5"><ShieldAlert className="w-2 h-2" />SL ${pos.stopLoss.toFixed(2)}</span>}
                    {pos.takeProfit && <span className="text-gain flex items-center gap-0.5"><Target className="w-2 h-2" />TP ${pos.takeProfit.toFixed(2)}</span>}
                  </div>
                )}

                {/* P&L bar */}
                <div className="mt-1.5 w-full bg-secondary rounded-full h-1">
                  <div className={`h-1 rounded-full transition-all ${pos.pnl >= 0 ? "bg-gain" : "bg-loss"}`}
                    style={{ width: `${Math.min(Math.abs(pos.pnlPct), 100)}%` }} />
                </div>
                <div className="text-right text-[9px] font-mono mt-0.5">
                  <span className={pos.pnlPct >= 0 ? "text-gain" : "text-loss"}>
                    {pos.pnlPct >= 0 ? "+" : ""}{pos.pnlPct.toFixed(2)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Trades */}
      {portfolio.trades.length > 0 && (
        <div className="mt-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Recent Trades</div>
            <div className="flex gap-0.5">
              {(["all", "wins", "losses"] as const).map(f => (
                <button key={f} onClick={() => setTradeFilter(f)}
                  className={`text-[9px] px-1.5 py-0.5 rounded font-medium transition-colors ${tradeFilter === f ? f === "wins" ? "bg-gain/15 text-gain" : f === "losses" ? "bg-loss/15 text-loss" : "bg-primary/15 text-primary" : "text-muted-foreground"}`}>
                  {f === "all" ? "All" : f === "wins" ? "Wins" : "Losses"}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1 max-h-[140px] overflow-y-auto scrollbar-thin">
            {filteredTrades.map(trade => (
              <div key={trade.id} className="flex justify-between text-[10px] font-mono py-1 border-b border-border/50">
                <div className="flex items-center gap-1.5">
                  <span className={trade.side === "buy" ? "text-gain" : "text-loss"}>
                    {trade.side.toUpperCase()}
                  </span>
                  <span className="text-foreground">{trade.symbol}</span>
                  {trade.orderType !== "market" && (
                    <span className="text-[8px] px-1 py-0 rounded bg-accent/10 text-accent uppercase">{trade.orderType}</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">
                    {trade.quantity.toFixed(4)} @ ${trade.price.toLocaleString()}
                  </span>
                  {trade.fees > 0 && (
                    <span className="text-warning text-[8px]">-${trade.fees.toFixed(2)}</span>
                  )}
                  {trade.pnl !== undefined && (
                    <span className={trade.pnl >= 0 ? "text-gain" : "text-loss"}>
                      {trade.pnl >= 0 ? "+" : ""}${trade.pnl.toFixed(2)}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
