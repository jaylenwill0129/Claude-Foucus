import { useMemo } from "react";
import { AreaChart, Area, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid, ComposedChart, Bar, ReferenceLine } from "recharts";
import { Portfolio } from "@/hooks/usePaperTrading";
import { TickerData } from "@/hooks/useWebullData";
import { TrendingUp, TrendingDown } from "lucide-react";

interface EquityCurveProps {
  portfolio: Portfolio;
  tickers: Record<string, TickerData>;
}

export function EquityCurve({ portfolio, tickers }: EquityCurveProps) {
  const data = useMemo(() => {
    let balance = 100000;
    let peakEquity = balance;
    const points = [{ time: "Start", equity: balance, pnl: 0, drawdown: 0, label: "Initial", tradePnl: 0 }];

    (portfolio.trades ?? []).forEach((trade) => {
      const tradePnl = (trade.pnl !== undefined && isFinite(trade.pnl)) ? trade.pnl : 0;
      balance += tradePnl;
      if (balance > peakEquity) peakEquity = balance;
      const drawdown = ((peakEquity - balance) / peakEquity) * 100;

      points.push({
        time: new Date(trade.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        equity: Math.round(balance),
        pnl: Math.round(balance - 100000),
        drawdown: -Math.round(drawdown * 100) / 100,
        label: `${trade.side === "buy" ? "Buy" : "Sell"} ${trade.symbol}`,
        tradePnl: Math.round(tradePnl * 100) / 100,
      });
    });

    const unrealized = (portfolio.positions ?? []).reduce((total, pos) => {
      try {
        const cp = tickers[pos.symbol] ? parseFloat(tickers[pos.symbol].price) : pos.entryPrice;
        if (!isFinite(cp)) return total;
        const pnl = pos.side === "long" ? (cp - pos.entryPrice) * pos.quantity : (pos.entryPrice - cp) * pos.quantity;
        return total + (isFinite(pnl) ? pnl : 0);
      } catch { return total; }
    }, 0);

    if (portfolio.trades.length > 0) {
      const currentEquity = Math.round(balance + unrealized);
      if (currentEquity > peakEquity) peakEquity = currentEquity;
      const drawdown = ((peakEquity - currentEquity) / peakEquity) * 100;
      points.push({
        time: "Now",
        equity: currentEquity,
        pnl: currentEquity - 100000,
        drawdown: -Math.round(drawdown * 100) / 100,
        label: "Current (incl. unrealized)",
        tradePnl: 0,
      });
    }

    return points;
  }, [portfolio.trades, portfolio.positions, tickers]);

  if (data.length < 2) {
    return (
      <div className="bg-card rounded-lg border border-border p-3">
        <div className="flex items-center gap-1.5 mb-2">
          <TrendingUp className="w-3 h-3 text-accent" />
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">P&L Curve</span>
        </div>
        <div className="h-[80px] flex items-center justify-center text-[10px] text-muted-foreground">
          Make some trades to see your P&L curve
        </div>
      </div>
    );
  }

  const isPositive = data[data.length - 1].pnl >= 0;
  const pnlColor = isPositive ? "hsl(145, 80%, 42%)" : "hsl(0, 72%, 51%)";
  const change = data[data.length - 1].pnl;
  const changePct = ((change / 100000) * 100);
  const maxDrawdown = Math.min(...data.map(d => d.drawdown));
  const winTrades = data.filter(d => d.tradePnl > 0).length;
  const lossTrades = data.filter(d => d.tradePnl < 0).length;

  return (
    <div className="bg-card rounded-lg border border-border p-3">
      {/* Header with stats */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          {isPositive ? <TrendingUp className="w-3 h-3 text-gain" /> : <TrendingDown className="w-3 h-3 text-loss" />}
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">P&L Curve</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-mono font-semibold ${isPositive ? "text-gain" : "text-loss"}`}>
            {isPositive ? "+" : ""}${Math.abs(change).toLocaleString()}
          </span>
          <span className={`text-[9px] font-mono ${isPositive ? "text-gain" : "text-loss"} opacity-70`}>
            ({changePct >= 0 ? "+" : ""}{changePct.toFixed(2)}%)
          </span>
        </div>
      </div>

      {/* Mini stats row */}
      <div className="flex items-center gap-3 mb-2 text-[9px] font-mono text-muted-foreground">
        <span>W: <span className="text-gain">{winTrades}</span></span>
        <span>L: <span className="text-loss">{lossTrades}</span></span>
        <span>Max DD: <span className="text-loss">{maxDrawdown.toFixed(2)}%</span></span>
      </div>

      {/* P&L Chart */}
      <div className="h-[120px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="pnlGradGain" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(145, 80%, 42%)" stopOpacity={0.3} />
                <stop offset="100%" stopColor="hsl(145, 80%, 42%)" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="pnlGradLoss" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(0, 72%, 51%)" stopOpacity={0} />
                <stop offset="100%" stopColor="hsl(0, 72%, 51%)" stopOpacity={0.3} />
              </linearGradient>
              <linearGradient id="ddGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(0, 72%, 51%)" stopOpacity={0} />
                <stop offset="100%" stopColor="hsl(0, 72%, 51%)" stopOpacity={0.15} />
              </linearGradient>
            </defs>
            <ReferenceLine y={0} stroke="hsl(215, 15%, 25%)" strokeDasharray="3 3" yAxisId="pnl" />
            <YAxis yAxisId="pnl" hide domain={["auto", "auto"]} />
            <YAxis yAxisId="dd" hide orientation="right" domain={["auto", 0]} />
            <Tooltip
              contentStyle={{
                background: "hsl(225, 22%, 9%)",
                border: "1px solid hsl(225, 16%, 15%)",
                borderRadius: "6px",
                fontSize: "10px",
                fontFamily: "monospace",
                padding: "6px 10px",
              }}
              formatter={(value: number, name: string) => {
                if (name === "pnl") return [`${value >= 0 ? "+" : ""}$${value.toLocaleString()}`, "P&L"];
                if (name === "drawdown") return [`${value.toFixed(2)}%`, "Drawdown"];
                if (name === "tradePnl") return [`${value >= 0 ? "+" : ""}$${value.toFixed(2)}`, "Trade"];
                return [value, name];
              }}
              labelStyle={{ color: "hsl(215, 15%, 50%)" }}
            />
            {/* Drawdown area (background) */}
            <Area
              yAxisId="dd"
              type="monotone"
              dataKey="drawdown"
              stroke="none"
              fill="url(#ddGrad)"
              dot={false}
            />
            {/* Trade P&L bars */}
            <Bar
              yAxisId="pnl"
              dataKey="tradePnl"
              fill="hsl(215, 15%, 30%)"
              opacity={0.3}
              barSize={3}
            />
            {/* P&L line */}
            <Area
              yAxisId="pnl"
              type="monotone"
              dataKey="pnl"
              stroke={pnlColor}
              strokeWidth={1.5}
              fill={isPositive ? "url(#pnlGradGain)" : "url(#pnlGradLoss)"}
              dot={false}
              activeDot={{ r: 3, fill: pnlColor, stroke: "hsl(225, 22%, 9%)", strokeWidth: 2 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
