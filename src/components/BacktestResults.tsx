import { BarChart3, TrendingUp, TrendingDown, Award, AlertTriangle } from "lucide-react";
import { BacktestResult } from "@/hooks/useBacktest";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

interface BacktestResultsProps {
  result: BacktestResult;
  symbol: string;
}

export function BacktestResults({ result, symbol }: BacktestResultsProps) {
  const isProfit = result.totalReturn >= 0;

  const equityData = result.equityCurve.map(p => ({
    time: new Date(p.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    equity: parseFloat(p.equity.toFixed(2)),
  }));

  return (
    <div className="bg-card rounded-lg border border-border p-4">
      <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
        <BarChart3 className="w-4 h-4 text-accent" />
        Backtest Results
        <span className="text-[9px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground font-mono">
          {symbol.replace("USDT", "")}/USDT
        </span>
      </h3>

      {/* Equity Curve */}
      {equityData.length > 1 && (
        <div className="h-32 mb-3">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={equityData}>
              <defs>
                <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={isProfit ? "hsl(160, 100%, 45%)" : "hsl(0, 85%, 55%)"} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={isProfit ? "hsl(160, 100%, 45%)" : "hsl(0, 85%, 55%)"} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="time" hide />
              <YAxis hide domain={["dataMin - 100", "dataMax + 100"]} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(220, 18%, 10%)",
                  border: "1px solid hsl(220, 15%, 18%)",
                  borderRadius: "6px",
                  fontSize: "11px",
                  fontFamily: "JetBrains Mono",
                }}
                formatter={(value: number) => [`$${value.toLocaleString()}`, "Equity"]}
              />
              <Area
                type="monotone"
                dataKey="equity"
                stroke={isProfit ? "hsl(160, 100%, 45%)" : "hsl(0, 85%, 55%)"}
                fill="url(#equityGradient)"
                strokeWidth={1.5}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Key Metrics */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[11px] font-mono mb-3">
        <div className="flex justify-between items-center">
          <span className="text-muted-foreground flex items-center gap-1">
            {isProfit ? <TrendingUp className="w-3 h-3 text-gain" /> : <TrendingDown className="w-3 h-3 text-loss" />}
            Return
          </span>
          <span className={isProfit ? "text-gain" : "text-loss"}>
            {isProfit ? "+" : ""}{result.totalReturnPct.toFixed(2)}%
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-muted-foreground flex items-center gap-1">
            <Award className="w-3 h-3" /> Win Rate
          </span>
          <span className={result.winRate >= 50 ? "text-gain" : "text-loss"}>
            {result.winRate.toFixed(1)}%
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Trades</span>
          <span className="text-foreground">{result.totalTrades}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Sharpe</span>
          <span className={result.sharpeRatio > 1 ? "text-gain" : result.sharpeRatio < 0 ? "text-loss" : "text-foreground"}>
            {result.sharpeRatio.toFixed(2)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground flex items-center gap-1">
            <AlertTriangle className="w-3 h-3 text-loss" /> Max DD
          </span>
          <span className="text-loss">{result.maxDrawdown.toFixed(2)}%</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Profit F.</span>
          <span className={result.profitFactor > 1 ? "text-gain" : "text-loss"}>
            {result.profitFactor === Infinity ? "∞" : result.profitFactor.toFixed(2)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Avg Win</span>
          <span className="text-gain">${result.avgWin.toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Avg Loss</span>
          <span className="text-loss">${result.avgLoss.toFixed(2)}</span>
        </div>
      </div>

      {/* Trade Log */}
      {result.trades.length > 0 && (
        <div className="border-t border-border pt-2">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Trade Log</div>
          <div className="max-h-36 overflow-y-auto scrollbar-thin space-y-1">
            {result.trades.map((t, i) => (
              <div key={i} className="flex items-center justify-between text-[10px] font-mono py-1 border-b border-border/50">
                <div className="flex items-center gap-2">
                  <span className={t.side === "long" ? "text-gain" : "text-loss"}>
                    {t.side.toUpperCase()}
                  </span>
                  <span className="text-muted-foreground">
                    ${t.entryPrice.toFixed(2)} → ${t.exitPrice.toFixed(2)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-1 py-0.5 rounded text-[9px] ${
                    t.exitReason === "take_profit" ? "bg-gain/10 text-gain" :
                    t.exitReason === "stop_loss" ? "bg-loss/10 text-loss" :
                    "bg-secondary text-muted-foreground"
                  }`}>
                    {t.exitReason === "take_profit" ? "TP" : t.exitReason === "stop_loss" ? "SL" : "END"}
                  </span>
                  <span className={t.pnl >= 0 ? "text-gain" : "text-loss"}>
                    {t.pnl >= 0 ? "+" : ""}{t.pnlPct.toFixed(2)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
