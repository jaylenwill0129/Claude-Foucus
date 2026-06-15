import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { invokeAlpacaTrade } from "@/lib/alpacaAccount";
import { TrendingUp, TrendingDown, BarChart3, Calendar, DollarSign } from "lucide-react";

interface PortfolioHistoryData {
  timestamp: number[];
  equity: number[];
  profit_loss: number[];
  profit_loss_pct: number[];
}

interface AlpacaPnlChartProps {
  mode: "paper" | "live";
}

export const AlpacaPnlChart = ({ mode }: AlpacaPnlChartProps) => {
  const [history, setHistory] = useState<PortfolioHistoryData | null>(null);
  const [period, setPeriod] = useState<string>("1M");
  const [loading, setLoading] = useState(false);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    try {
      const timeframe = period === "1D" ? "15Min" : period === "1W" ? "1D" : "1D";
      const res = await invokeAlpacaTrade({
        body: { action: "portfolio_history", mode, period, timeframe },
      });
      if (!res.error && res.data && !res.data.error) {
        setHistory(res.data);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [mode, period]);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  const chartData = useMemo(() => {
    if (!history?.equity?.length) return null;
    const { equity, profit_loss_pct, timestamp } = history;
    const min = Math.min(...equity);
    const max = Math.max(...equity);
    const range = max - min || 1;
    const w = 100;
    const h = 100;
    
    const points = equity.map((v, i) => {
      const x = (i / (equity.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x},${y}`;
    }).join(" ");

    const totalPl = equity[equity.length - 1] - equity[0];
    const totalPlPct = profit_loss_pct?.length ? profit_loss_pct[profit_loss_pct.length - 1] : 0;
    const isPositive = totalPl >= 0;

    // Area fill
    const areaPoints = `0,${h} ${points} ${w},${h}`;

    return { points, areaPoints, totalPl, totalPlPct, isPositive, 
      startEquity: equity[0], endEquity: equity[equity.length - 1],
      maxEquity: max, minEquity: min,
      startDate: timestamp?.[0] ? new Date(timestamp[0] * 1000).toLocaleDateString() : "",
      endDate: timestamp?.length ? new Date(timestamp[timestamp.length - 1] * 1000).toLocaleDateString() : "",
    };
  }, [history]);

  const periods = ["1D", "1W", "1M", "3M", "1A"];

  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      <div className="px-4 py-3 flex items-center justify-between border-b border-border/50">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-bold text-foreground">Brokerage Performance</h3>
        </div>
        <div className="flex gap-0.5 bg-secondary/30 rounded-md p-0.5">
          {periods.map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`text-[9px] px-2 py-1 rounded font-mono transition-colors ${
                period === p
                  ? "bg-card text-foreground shadow-sm border border-border/50"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {loading && !chartData ? (
        <div className="h-40 flex items-center justify-center text-muted-foreground text-xs">Loading...</div>
      ) : chartData ? (
        <div className="p-4 space-y-3">
          {/* Summary stats */}
          <div className="grid grid-cols-4 gap-2">
            <div>
              <div className="text-[8px] text-muted-foreground uppercase">Start</div>
              <div className="text-xs font-mono text-foreground">${chartData.startEquity.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
            </div>
            <div>
              <div className="text-[8px] text-muted-foreground uppercase">Current</div>
              <div className="text-xs font-mono font-bold text-foreground">${chartData.endEquity.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
            </div>
            <div>
              <div className="text-[8px] text-muted-foreground uppercase">P&L</div>
              <div className={`text-xs font-mono font-bold ${chartData.isPositive ? "text-gain" : "text-loss"}`}>
                {chartData.isPositive ? "+" : ""}${chartData.totalPl.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </div>
            </div>
            <div>
              <div className="text-[8px] text-muted-foreground uppercase">Return</div>
              <div className={`text-xs font-mono font-bold ${chartData.isPositive ? "text-gain" : "text-loss"}`}>
                {chartData.totalPlPct >= 0 ? "+" : ""}{(chartData.totalPlPct * 100).toFixed(2)}%
              </div>
            </div>
          </div>

          {/* SVG Chart */}
          <svg viewBox={`-2 -2 104 104`} className="w-full h-32" preserveAspectRatio="none">
            <defs>
              <linearGradient id={`pnlGrad-${mode}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={chartData.isPositive ? "hsl(145, 80%, 42%)" : "hsl(0, 72%, 51%)"} stopOpacity="0.3" />
                <stop offset="100%" stopColor={chartData.isPositive ? "hsl(145, 80%, 42%)" : "hsl(0, 72%, 51%)"} stopOpacity="0" />
              </linearGradient>
            </defs>
            <polygon points={chartData.areaPoints} fill={`url(#pnlGrad-${mode})`} />
            <polyline
              points={chartData.points}
              fill="none"
              stroke={chartData.isPositive ? "hsl(145, 80%, 42%)" : "hsl(0, 72%, 51%)"}
              strokeWidth="1.5"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
            {/* Zero line */}
            <line x1="0" y1="50" x2="100" y2="50" stroke="hsl(215, 15%, 25%)" strokeWidth="0.5" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
          </svg>

          <div className="flex justify-between text-[8px] text-muted-foreground font-mono">
            <span>{chartData.startDate}</span>
            <span>High: ${chartData.maxEquity.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
            <span>{chartData.endDate}</span>
          </div>
        </div>
      ) : (
        <div className="h-40 flex items-center justify-center text-muted-foreground text-xs">
          No portfolio history available
        </div>
      )}
    </div>
  );
};

export default AlpacaPnlChart;
