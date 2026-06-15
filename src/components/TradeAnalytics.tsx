import { useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell, PieChart as RechartsPie, Pie } from "recharts";
import { Trade, Position } from "@/hooks/usePaperTrading";
import { TickerData } from "@/hooks/useWebullData";
import { BarChart3, Target, TrendingUp, TrendingDown, Clock } from "lucide-react";

interface TradeAnalyticsProps {
  trades: Trade[];
  positions: Position[];
  tickers: Record<string, TickerData>;
}

export function TradeAnalytics({ trades, positions, tickers }: TradeAnalyticsProps) {
  const analytics = useMemo(() => {
    const closedTrades = trades.filter(t => t.pnl !== undefined);
    const wins = closedTrades.filter(t => (t.pnl ?? 0) > 0);
    const losses = closedTrades.filter(t => (t.pnl ?? 0) < 0);

    const totalPnl = closedTrades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
    const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + (t.pnl ?? 0), 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + (t.pnl ?? 0), 0) / losses.length : 0;
    const profitFactor = Math.abs(avgLoss) > 0 ? avgWin / Math.abs(avgLoss) : avgWin > 0 ? Infinity : 0;
    const winRate = closedTrades.length > 0 ? (wins.length / closedTrades.length) * 100 : 0;

    // P&L by symbol
    const bySymbol: Record<string, number> = {};
    closedTrades.forEach(t => {
      bySymbol[t.symbol] = (bySymbol[t.symbol] || 0) + (t.pnl ?? 0);
    });
    const symbolData = Object.entries(bySymbol).map(([symbol, pnl]) => ({ symbol, pnl: Number(pnl.toFixed(2)) })).sort((a, b) => b.pnl - a.pnl);

    // Allocation pie
    const allocationData = positions.map(p => {
      const value = p.entryPrice * p.quantity;
      return { name: p.symbol, value: Number(value.toFixed(2)) };
    });

    // Recent P&L distribution
    const pnlBuckets = closedTrades.slice(-20).map((t, i) => ({
      trade: i + 1,
      pnl: Number((t.pnl ?? 0).toFixed(2)),
    }));

    return { closedTrades: closedTrades.length, wins: wins.length, losses: losses.length, totalPnl, avgWin, avgLoss, profitFactor, winRate, symbolData, allocationData, pnlBuckets };
  }, [trades, positions, tickers]);

  if (analytics.closedTrades === 0 && positions.length === 0) {
    return (
      <div className="bg-card rounded-lg border border-border p-4">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-3">
          <BarChart3 className="w-4 h-4 text-accent" />
          Trade Analytics
        </h3>
        <div className="text-center py-6 text-[11px] text-muted-foreground">
          Complete some trades to see analytics
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-lg border border-border p-4">
      <h3 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-3">
        <BarChart3 className="w-4 h-4 text-accent" />
        Trade Analytics
      </h3>

      {/* Key Metrics */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="p-2 rounded-md bg-secondary/50 text-center">
          <div className="text-[8px] text-muted-foreground uppercase tracking-wider">Win Rate</div>
          <div className={`text-sm font-mono font-bold ${analytics.winRate >= 50 ? "text-gain" : "text-loss"}`}>
            {analytics.winRate.toFixed(1)}%
          </div>
          <div className="text-[9px] text-muted-foreground font-mono">{analytics.wins}W / {analytics.losses}L</div>
        </div>
        <div className="p-2 rounded-md bg-secondary/50 text-center">
          <div className="text-[8px] text-muted-foreground uppercase tracking-wider">Profit Factor</div>
          <div className={`text-sm font-mono font-bold ${analytics.profitFactor >= 1 ? "text-gain" : "text-loss"}`}>
            {analytics.profitFactor === Infinity ? "∞" : analytics.profitFactor.toFixed(2)}
          </div>
          <div className="text-[9px] text-muted-foreground font-mono">avg W/L ratio</div>
        </div>
        <div className="p-2 rounded-md bg-secondary/50 text-center">
          <div className="text-[8px] text-muted-foreground uppercase tracking-wider">Avg Win</div>
          <div className="text-sm font-mono font-bold text-gain">+${analytics.avgWin.toFixed(0)}</div>
          <div className="text-[9px] font-mono text-loss">-${Math.abs(analytics.avgLoss).toFixed(0)}</div>
        </div>
      </div>

      {/* P&L by Symbol Bar Chart */}
      {analytics.symbolData.length > 0 && (
        <div className="mb-4">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">P&L by Symbol</div>
          <div className="h-[100px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={analytics.symbolData} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
                <XAxis dataKey="symbol" tick={{ fontSize: 9, fill: "hsl(215, 15%, 50%)" }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ background: "hsl(225, 22%, 9%)", border: "1px solid hsl(225, 16%, 15%)", borderRadius: "6px", fontSize: "10px", fontFamily: "monospace" }}
                  formatter={(value: number) => [`$${value.toFixed(2)}`, "P&L"]}
                />
                <Bar dataKey="pnl" radius={[3, 3, 0, 0]}>
                  {analytics.symbolData.map((entry, index) => (
                    <Cell key={index} fill={entry.pnl >= 0 ? "hsl(145, 80%, 42%)" : "hsl(0, 72%, 51%)"} fillOpacity={0.8} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Recent Trades P&L */}
      {analytics.pnlBuckets.length > 0 && (
        <div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">Recent Trade P&L</div>
          <div className="h-[60px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={analytics.pnlBuckets} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
                <Tooltip
                  contentStyle={{ background: "hsl(225, 22%, 9%)", border: "1px solid hsl(225, 16%, 15%)", borderRadius: "6px", fontSize: "10px", fontFamily: "monospace" }}
                  formatter={(value: number) => [`$${value.toFixed(2)}`, "P&L"]}
                />
                <Bar dataKey="pnl" radius={[2, 2, 0, 0]}>
                  {analytics.pnlBuckets.map((entry, index) => (
                    <Cell key={index} fill={entry.pnl >= 0 ? "hsl(145, 80%, 42%)" : "hsl(0, 72%, 51%)"} fillOpacity={0.7} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
