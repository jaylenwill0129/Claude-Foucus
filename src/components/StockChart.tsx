import { useMemo } from "react";
import { AreaChart, Area, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine } from "recharts";
import { TickerData } from "@/hooks/useWebullData";
import { PricePoint } from "@/hooks/usePriceHistory";
import { TrendingUp, TrendingDown, BarChart3, Maximize2 } from "lucide-react";

interface StockChartProps {
  symbol: string;
  ticker: TickerData;
  priceHistory: PricePoint[];
  onExpand?: () => void;
}

export function StockChart({ symbol, ticker, priceHistory, onExpand }: StockChartProps) {
  const currentPrice = parseFloat(ticker.price) || 0;
  const isPositive = parseFloat(ticker.priceChangePercent) >= 0;

  const chartData = useMemo(() => {
    if (priceHistory.length >= 2) {
      return priceHistory.map(p => ({
        time: p.label,
        price: p.price,
      }));
    }

    // Generate synthetic intraday curve from high/low/current
    const high = parseFloat(ticker.high) || currentPrice * 1.02;
    const low = parseFloat(ticker.low) || currentPrice * 0.98;
    const points = 30;
    const data: { time: string; price: number }[] = [];

    for (let i = 0; i < points; i++) {
      const t = i / (points - 1);
      // Create a realistic intraday curve
      const noise = Math.sin(t * Math.PI * 3) * 0.3 + Math.sin(t * Math.PI * 7) * 0.1;
      const trend = isPositive
        ? low + (currentPrice - low) * t + noise * (high - low) * 0.2
        : high - (high - currentPrice) * t + noise * (high - low) * 0.2;
      const price = Math.max(low, Math.min(high, trend));

      const hour = 9 + Math.floor(t * 7);
      const min = Math.floor((t * 7 - Math.floor(t * 7)) * 60);
      data.push({
        time: `${hour}:${min.toString().padStart(2, "0")}`,
        price: Number(price.toFixed(2)),
      });
    }
    // Ensure last point matches current price
    data[data.length - 1].price = currentPrice;
    return data;
  }, [priceHistory, ticker, currentPrice, isPositive]);

  const priceMin = useMemo(() => Math.min(...chartData.map(d => d.price)) * 0.999, [chartData]);
  const priceMax = useMemo(() => Math.max(...chartData.map(d => d.price)) * 1.001, [chartData]);
  const color = isPositive ? "hsl(145, 80%, 42%)" : "hsl(0, 72%, 51%)";

  const change = chartData.length >= 2 ? chartData[chartData.length - 1].price - chartData[0].price : 0;

  return (
    <div className="bg-card rounded-lg border border-border p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-accent" />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-foreground">{symbol}</span>
              <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-mono ${
                priceHistory.length >= 2 ? "bg-gain/10 text-gain" : "bg-secondary text-muted-foreground"
              }`}>
                {priceHistory.length >= 2 ? "LIVE" : "SIMULATED"}
              </span>
            </div>
            <div className="text-[10px] text-muted-foreground">{ticker.name}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-right">
            <div className="text-lg font-mono font-bold text-foreground tabular-nums">
              ${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className={`text-[11px] font-mono flex items-center gap-0.5 justify-end ${isPositive ? "text-gain" : "text-loss"}`}>
              {isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              {isPositive ? "+" : ""}{ticker.priceChangePercent}%
              <span className="text-muted-foreground ml-1">
                ({change >= 0 ? "+" : ""}${Math.abs(change).toFixed(2)})
              </span>
            </div>
          </div>
          {onExpand && (
            <button onClick={onExpand} className="p-1.5 rounded-md hover:bg-secondary transition-colors text-muted-foreground hover:text-accent" title="Full-screen chart">
              <Maximize2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Price Details */}
      <div className="flex gap-4 mb-3 text-[10px] font-mono">
        <div>
          <span className="text-muted-foreground">High </span>
          <span className="text-foreground">${parseFloat(ticker.high).toLocaleString()}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Low </span>
          <span className="text-foreground">${parseFloat(ticker.low).toLocaleString()}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Vol </span>
          <span className="text-foreground">{ticker.volume || "N/A"}</span>
        </div>
      </div>

      {/* Chart */}
      <div className="h-[160px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
            <defs>
              <linearGradient id={`stockGrad-${symbol}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.25} />
                <stop offset="100%" stopColor={color} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="time"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "hsl(215, 15%, 40%)", fontSize: 9 }}
              interval="preserveStartEnd"
            />
            <YAxis
              domain={[priceMin, priceMax]}
              axisLine={false}
              tickLine={false}
              tick={{ fill: "hsl(215, 15%, 40%)", fontSize: 9 }}
              orientation="right"
              width={50}
              tickFormatter={(v) => `$${v.toLocaleString()}`}
            />
            <Tooltip
              contentStyle={{
                background: "hsl(225, 22%, 9%)",
                border: "1px solid hsl(225, 16%, 15%)",
                borderRadius: "6px",
                fontSize: "10px",
                fontFamily: "JetBrains Mono, monospace",
              }}
              formatter={(value: number) => [`$${value.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, "Price"]}
              labelStyle={{ color: "hsl(215, 15%, 50%)" }}
            />
            {/* Reference line at open price */}
            {chartData.length > 0 && (
              <ReferenceLine
                y={chartData[0].price}
                stroke="hsl(215, 15%, 30%)"
                strokeDasharray="4 4"
                strokeWidth={1}
              />
            )}
            <Area
              type="monotone"
              dataKey="price"
              stroke={color}
              strokeWidth={2}
              fill={`url(#stockGrad-${symbol})`}
              dot={false}
              activeDot={{ r: 3, fill: color, stroke: "hsl(225, 22%, 9%)", strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Mini stats bar */}
      <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/50">
        <div className="flex gap-3 text-[9px] font-mono text-muted-foreground">
          <span>Range: ${parseFloat(ticker.low).toFixed(2)} – ${parseFloat(ticker.high).toFixed(2)}</span>
        </div>
        <div className="text-[9px] font-mono text-muted-foreground/50">
          {priceHistory.length} data points
        </div>
      </div>
    </div>
  );
}
