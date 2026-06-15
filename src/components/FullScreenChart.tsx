import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import {
  ComposedChart, Bar, Line, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine, Cell, CartesianGrid, Brush,
} from "recharts";
import { TickerData } from "@/hooks/useWebullData";
import { PricePoint } from "@/hooks/usePriceHistory";
import {
  X, Maximize2, Minimize2, TrendingUp, TrendingDown, BarChart3,
  Minus, PenTool, Crosshair, Trash2, ArrowUpRight, ArrowDownRight,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────
type ChartView = "candles" | "area" | "line";
type Timeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "1D";
type Overlay = "bb" | "sma" | "ema" | "none";
type Indicator = "rsi" | "macd" | "volume" | "none";
type DrawingTool = "none" | "hline" | "trendline" | "crosshair";

interface DrawingLine {
  id: string;
  type: "hline" | "trendline";
  y1: number;
  y2?: number;
  x1?: number;
  x2?: number;
  color: string;
}

interface KlineData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface FullScreenChartProps {
  symbol: string;
  ticker: TickerData;
  priceHistory: PricePoint[];
  onClose: () => void;
}

// ─── Technical Calculations ─────────────────────────────────────────
function calcSMA(data: number[], period: number): (number | null)[] {
  return data.map((_, i) => {
    if (i < period - 1) return null;
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += data[j];
    return sum / period;
  });
}

function calcEMA(data: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const ema: number[] = [data[0]];
  for (let i = 1; i < data.length; i++) ema.push(data[i] * k + ema[i - 1] * (1 - k));
  return ema;
}

function calcRSI(closes: number[], period = 14): (number | null)[] {
  const rsi: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return rsi;
  let gainSum = 0, lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gainSum += diff; else lossSum -= diff;
  }
  let avgGain = gainSum / period, avgLoss = lossSum / period;
  rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
    rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return rsi;
}

function calcMACD(closes: number[]) {
  if (closes.length < 26) return { macd: closes.map(() => null), signal: closes.map(() => null), histogram: closes.map(() => null) };
  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);
  const macdLine: (number | null)[] = ema12.map((v, i) => i < 25 ? null : v - ema26[i]);
  const nonNullStart = macdLine.findIndex(v => v !== null);
  const macdNN = macdLine.slice(nonNullStart).map(v => v!);
  const sigEma = calcEMA(macdNN, 9);
  const signal: (number | null)[] = new Array(closes.length).fill(null);
  const histogram: (number | null)[] = new Array(closes.length).fill(null);
  for (let i = 0; i < macdNN.length; i++) {
    const idx = nonNullStart + i;
    if (i >= 8) { signal[idx] = sigEma[i]; histogram[idx] = macdNN[i] - sigEma[i]; }
  }
  return { macd: macdLine, signal, histogram };
}

function calcBollingerBands(closes: number[], period = 20, stdDev = 2) {
  const sma = calcSMA(closes, period);
  const upper: (number | null)[] = new Array(closes.length).fill(null);
  const lower: (number | null)[] = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    const slice = closes.slice(i - period + 1, i + 1);
    const mean = sma[i]!;
    const std = Math.sqrt(slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period);
    upper[i] = mean + stdDev * std;
    lower[i] = mean - stdDev * std;
  }
  return { upper, middle: sma, lower };
}

// ─── Generate synthetic OHLCV klines from price history or ticker ──
function generateKlines(priceHistory: PricePoint[], ticker: TickerData, timeframe: Timeframe): KlineData[] {
  const currentPrice = parseFloat(ticker.price) || 100;
  const high = parseFloat(ticker.high) || currentPrice * 1.02;
  const low = parseFloat(ticker.low) || currentPrice * 0.98;
  const isPositive = parseFloat(ticker.priceChangePercent) >= 0;
  const changePct = Math.abs(parseFloat(ticker.priceChangePercent) || 1);
  const volatility = (high - low) / currentPrice;

  const tfMinutes: Record<Timeframe, number> = { "1m": 1, "5m": 5, "15m": 15, "1h": 60, "4h": 240, "1D": 1440 };
  const tfMins = tfMinutes[timeframe];
  const totalBars = timeframe === "1D" ? 30 : timeframe === "4h" ? 30 : timeframe === "1h" ? 24 : 60;

  // If we have enough live data points, aggregate them
  if (priceHistory.length >= 5) {
    const intervalMs = tfMins * 60 * 1000;
    const buckets: Record<number, PricePoint[]> = {};
    for (const p of priceHistory) {
      const bucketKey = Math.floor(p.time / intervalMs) * intervalMs;
      if (!buckets[bucketKey]) buckets[bucketKey] = [];
      buckets[bucketKey].push(p);
    }
    const keys = Object.keys(buckets).map(Number).sort();
    if (keys.length >= 3) {
      return keys.map(k => {
        const pts = buckets[k];
        const prices = pts.map(p => p.price);
        return {
          time: k,
          open: prices[0],
          high: Math.max(...prices),
          low: Math.min(...prices),
          close: prices[prices.length - 1],
          volume: Math.round(Math.random() * 500000 + 100000),
        };
      });
    }
  }

  // Generate synthetic klines
  const klines: KlineData[] = [];
  const now = Date.now();
  let price = isPositive ? low + (currentPrice - low) * 0.1 : high - (high - currentPrice) * 0.1;

  // Use seeded random for consistency
  let seed = symbol2seed(ticker.symbol);
  const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

  for (let i = 0; i < totalBars; i++) {
    const t = i / (totalBars - 1);
    const trendBias = isPositive ? 0.001 : -0.001;
    const move = (rand() - 0.5 + trendBias) * volatility * price * (tfMins / 5);
    price = Math.max(low * 0.95, Math.min(high * 1.05, price + move));

    const candleRange = volatility * price * 0.3 * (rand() * 0.5 + 0.5);
    const open = price - candleRange * (rand() - 0.5);
    const close = price + candleRange * (rand() - 0.5);
    const h = Math.max(open, close) + Math.abs(candleRange) * rand() * 0.5;
    const l = Math.min(open, close) - Math.abs(candleRange) * rand() * 0.5;

    klines.push({
      time: now - (totalBars - i) * tfMins * 60 * 1000,
      open: Number(open.toFixed(2)),
      high: Number(h.toFixed(2)),
      low: Number(l.toFixed(2)),
      close: Number(close.toFixed(2)),
      volume: Math.round(rand() * 800000 + 200000),
    });
  }

  // Ensure last bar closes at current price
  if (klines.length > 0) {
    klines[klines.length - 1].close = currentPrice;
    klines[klines.length - 1].high = Math.max(klines[klines.length - 1].high, currentPrice);
    klines[klines.length - 1].low = Math.min(klines[klines.length - 1].low, currentPrice);
  }

  return klines;
}

function symbol2seed(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
  return Math.abs(hash) || 1;
}

// ─── Tooltip Style ─────────────────────────────────────────────────
const tooltipStyle = {
  background: "hsl(225, 22%, 9%)",
  border: "1px solid hsl(225, 16%, 15%)",
  borderRadius: "6px",
  fontSize: "10px",
  fontFamily: "JetBrains Mono, monospace",
  color: "hsl(210, 25%, 92%)",
};

// ─── Main Component ─────────────────────────────────────────────────
export function FullScreenChart({ symbol, ticker, priceHistory, onClose }: FullScreenChartProps) {
  const [chartView, setChartView] = useState<ChartView>("candles");
  const [timeframe, setTimeframe] = useState<Timeframe>("5m");
  const [overlay, setOverlay] = useState<Overlay>("bb");
  const [indicator, setIndicator] = useState<Indicator>("rsi");
  const [drawingTool, setDrawingTool] = useState<DrawingTool>("none");
  const [drawings, setDrawings] = useState<DrawingLine[]>([]);
  const [crosshairY, setCrosshairY] = useState<number | null>(null);
  const chartContainerRef = useRef<HTMLDivElement>(null);

  const currentPrice = parseFloat(ticker.price) || 0;
  const isPositive = parseFloat(ticker.priceChangePercent) >= 0;

  // Escape to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Generate kline data
  const klines = useMemo(() => generateKlines(priceHistory, ticker, timeframe), [priceHistory, ticker, timeframe]);

  // Calculate indicators
  const chartData = useMemo(() => {
    const closes = klines.map(k => k.close);
    const rsi = calcRSI(closes);
    const macd = calcMACD(closes);
    const bb = calcBollingerBands(closes);
    const sma20 = calcSMA(closes, 20);
    const sma50 = calcSMA(closes, 50);
    const ema12 = calcEMA(closes, 12);
    const ema26 = calcEMA(closes, 26);

    return klines.map((k, i) => {
      const tfLabel = timeframe === "1D"
        ? new Date(k.time).toLocaleDateString([], { month: "short", day: "numeric" })
        : new Date(k.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

      return {
        time: tfLabel,
        rawTime: k.time,
        open: k.open,
        high: k.high,
        low: k.low,
        close: k.close,
        volume: k.volume,
        rsi: rsi[i],
        macd: macd.macd[i],
        macdSignal: macd.signal[i],
        macdHist: macd.histogram[i],
        bbUpper: bb.upper[i],
        bbMiddle: bb.middle[i],
        bbLower: bb.lower[i],
        sma20: overlay === "sma" ? sma20[i] : null,
        sma50: overlay === "sma" ? (i < 50 ? null : sma50[i]) : null,
        ema12: overlay === "ema" ? (i >= 1 ? ema12[i] : null) : null,
        ema26: overlay === "ema" ? (i >= 1 ? ema26[i] : null) : null,
        isGreen: k.close >= k.open,
      };
    });
  }, [klines, overlay, timeframe]);

  const priceMin = useMemo(() => {
    const vals = chartData.flatMap(d => [d.low, d.bbLower].filter(Boolean) as number[]);
    return vals.length ? Math.min(...vals) * 0.998 : 0;
  }, [chartData]);

  const priceMax = useMemo(() => {
    const vals = chartData.flatMap(d => [d.high, d.bbUpper].filter(Boolean) as number[]);
    return vals.length ? Math.max(...vals) * 1.002 : 0;
  }, [chartData]);

  // Add horizontal line drawing
  const addHorizontalLine = useCallback(() => {
    if (!currentPrice) return;
    setDrawings(prev => [...prev, {
      id: crypto.randomUUID(),
      type: "hline",
      y1: currentPrice,
      color: "hsl(38, 92%, 50%)",
    }]);
    setDrawingTool("none");
  }, [currentPrice]);

  const clearDrawings = () => setDrawings([]);

  // Candlestick shape renderer
  const renderCandle = useCallback((props: any) => {
    const { x, y, width, payload, background } = props;
    if (!payload) return null;
    const { open, high, low, close } = payload;
    const isGreen = close >= open;
    const color = isGreen ? "hsl(145, 80%, 42%)" : "hsl(0, 72%, 51%)";
    const totalHeight = background?.height || 400;
    const yTop = background?.y || 0;
    const range = priceMax - priceMin;
    if (range === 0) return null;
    const yForVal = (v: number) => yTop + (1 - (v - priceMin) / range) * totalHeight;
    const yOpen = yForVal(open);
    const yClose = yForVal(close);
    const yHigh = yForVal(high);
    const yLow = yForVal(low);
    const bodyTop = Math.min(yOpen, yClose);
    const bodyH = Math.max(Math.abs(yOpen - yClose), 1);
    const wickX = x + width / 2;
    return (
      <g>
        <line x1={wickX} y1={yHigh} x2={wickX} y2={yLow} stroke={color} strokeWidth={1} />
        <rect x={x} y={bodyTop} width={width} height={bodyH} fill={color} stroke={color} strokeWidth={0.5} fillOpacity={isGreen ? 1 : 0.85} rx={0.5} />
      </g>
    );
  }, [priceMin, priceMax]);

  const mainChartColor = isPositive ? "hsl(145, 80%, 42%)" : "hsl(0, 72%, 51%)";
  const indicatorHeight = indicator !== "none" ? 120 : 0;

  return (
    <div className="fixed inset-0 z-[100] bg-background flex flex-col">
      {/* Top Bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border glass-strong">
        <div className="flex items-center gap-4">
          {/* Symbol Info */}
          <div className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-accent" />
            <span className="text-base font-bold text-foreground">{symbol}</span>
            <span className="text-[10px] text-muted-foreground">{ticker.name}</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-xl font-mono font-bold text-foreground tabular-nums">
              ${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className={`text-sm font-mono font-semibold flex items-center gap-0.5 ${isPositive ? "text-gain" : "text-loss"}`}>
              {isPositive ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
              {isPositive ? "+" : ""}{ticker.priceChangePercent}%
            </span>
          </div>
          <div className="flex gap-3 text-[10px] font-mono text-muted-foreground ml-2">
            <span>H <span className="text-foreground">${parseFloat(ticker.high).toLocaleString()}</span></span>
            <span>L <span className="text-foreground">${parseFloat(ticker.low).toLocaleString()}</span></span>
            <span>Vol <span className="text-foreground">{ticker.volume || "N/A"}</span></span>
          </div>
        </div>
        <button onClick={onClose} className="p-2 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground" title="Close (Esc)">
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Controls Bar */}
      <div className="flex items-center gap-2 px-4 py-1.5 border-b border-border/50 bg-card/50 flex-wrap">
        {/* Timeframes */}
        <div className="flex gap-0.5 bg-secondary/50 rounded-md p-0.5">
          {(["1m", "5m", "15m", "1h", "4h", "1D"] as Timeframe[]).map(tf => (
            <button key={tf} onClick={() => setTimeframe(tf)}
              className={`px-2.5 py-1 rounded text-[10px] font-mono font-medium transition-all ${
                timeframe === tf ? "bg-accent/20 text-accent shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}>
              {tf}
            </button>
          ))}
        </div>

        <div className="w-px h-5 bg-border" />

        {/* Chart Type */}
        <div className="flex gap-0.5 bg-secondary/50 rounded-md p-0.5">
          {([["candles", "Candles"], ["area", "Area"], ["line", "Line"]] as [ChartView, string][]).map(([v, l]) => (
            <button key={v} onClick={() => setChartView(v)}
              className={`px-2 py-1 rounded text-[10px] font-mono transition-all ${
                chartView === v ? "bg-accent/20 text-accent" : "text-muted-foreground hover:text-foreground"
              }`}>
              {l}
            </button>
          ))}
        </div>

        <div className="w-px h-5 bg-border" />

        {/* Overlays */}
        <div className="flex gap-0.5 bg-secondary/50 rounded-md p-0.5">
          {([["bb", "BB"], ["sma", "SMA"], ["ema", "EMA"], ["none", "—"]] as [Overlay, string][]).map(([v, l]) => (
            <button key={v} onClick={() => setOverlay(v)}
              className={`px-2 py-1 rounded text-[10px] font-mono transition-all ${
                overlay === v ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"
              }`}>
              {l}
            </button>
          ))}
        </div>

        <div className="w-px h-5 bg-border" />

        {/* Indicators */}
        <div className="flex gap-0.5 bg-secondary/50 rounded-md p-0.5">
          {([["rsi", "RSI"], ["macd", "MACD"], ["volume", "Vol"], ["none", "—"]] as [Indicator, string][]).map(([v, l]) => (
            <button key={v} onClick={() => setIndicator(v)}
              className={`px-2 py-1 rounded text-[10px] font-mono transition-all ${
                indicator === v ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"
              }`}>
              {l}
            </button>
          ))}
        </div>

        <div className="w-px h-5 bg-border" />

        {/* Drawing Tools */}
        <div className="flex gap-0.5 bg-secondary/50 rounded-md p-0.5">
          <button onClick={addHorizontalLine} title="Add H-Line at current price"
            className="px-2 py-1 rounded text-[10px] font-mono text-muted-foreground hover:text-warning transition-all">
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => setDrawingTool(drawingTool === "crosshair" ? "none" : "crosshair")} title="Crosshair"
            className={`px-2 py-1 rounded text-[10px] transition-all ${drawingTool === "crosshair" ? "bg-accent/20 text-accent" : "text-muted-foreground hover:text-foreground"}`}>
            <Crosshair className="w-3.5 h-3.5" />
          </button>
          {drawings.length > 0 && (
            <button onClick={clearDrawings} title="Clear drawings"
              className="px-2 py-1 rounded text-[10px] text-muted-foreground hover:text-loss transition-all">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <span className="ml-auto text-[9px] font-mono text-muted-foreground/50">
          {priceHistory.length >= 5 ? "LIVE DATA" : "SIMULATED"} · {chartData.length} bars
        </span>
      </div>

      {/* Chart Area */}
      <div className="flex-1 p-2 flex flex-col min-h-0" ref={chartContainerRef}>
        {/* Main Price Chart */}
        <div className="flex-1 min-h-0" style={{ minHeight: indicator !== "none" ? "calc(100% - 140px)" : "100%" }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 8, right: 60, left: 8, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(225, 16%, 12%)" />
              <XAxis
                dataKey="time"
                axisLine={false}
                tickLine={false}
                tick={{ fill: "hsl(215, 15%, 40%)", fontSize: 9 }}
                interval="preserveStartEnd"
                minTickGap={40}
              />
              <YAxis
                domain={[priceMin, priceMax]}
                axisLine={false}
                tickLine={false}
                tick={{ fill: "hsl(215, 15%, 40%)", fontSize: 9 }}
                orientation="right"
                width={55}
                tickFormatter={(v) => `$${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value: number, name: string) => {
                  const labels: Record<string, string> = { close: "Close", open: "Open", high: "High", low: "Low", bbUpper: "BB↑", bbLower: "BB↓", bbMiddle: "BB", sma20: "SMA20", sma50: "SMA50", ema12: "EMA12", ema26: "EMA26" };
                  return [`$${value?.toLocaleString(undefined, { maximumFractionDigits: 2 })}`, labels[name] || name];
                }}
              />

              {/* Drawing lines */}
              {drawings.map(d => (
                <ReferenceLine key={d.id} y={d.y1} stroke={d.color} strokeWidth={1.5} strokeDasharray="6 3"
                  label={{ value: `$${d.y1.toFixed(2)}`, position: "right", fill: d.color, fontSize: 10 }} />
              ))}

              {/* Bollinger Bands */}
              {overlay === "bb" && (
                <>
                  <Area type="monotone" dataKey="bbUpper" stroke="none" fill="hsl(200, 95%, 48%)" fillOpacity={0.04} />
                  <Line type="monotone" dataKey="bbUpper" stroke="hsl(200, 95%, 48%)" strokeWidth={1} dot={false} strokeDasharray="3 3" opacity={0.5} />
                  <Line type="monotone" dataKey="bbMiddle" stroke="hsl(200, 95%, 48%)" strokeWidth={1} dot={false} opacity={0.3} />
                  <Line type="monotone" dataKey="bbLower" stroke="hsl(200, 95%, 48%)" strokeWidth={1} dot={false} strokeDasharray="3 3" opacity={0.5} />
                </>
              )}

              {/* SMA */}
              {overlay === "sma" && (
                <>
                  <Line type="monotone" dataKey="sma20" stroke="hsl(38, 92%, 50%)" strokeWidth={1.5} dot={false} />
                  <Line type="monotone" dataKey="sma50" stroke="hsl(280, 80%, 60%)" strokeWidth={1.5} dot={false} />
                </>
              )}

              {/* EMA */}
              {overlay === "ema" && (
                <>
                  <Line type="monotone" dataKey="ema12" stroke="hsl(38, 92%, 50%)" strokeWidth={1.5} dot={false} />
                  <Line type="monotone" dataKey="ema26" stroke="hsl(280, 80%, 60%)" strokeWidth={1.5} dot={false} />
                </>
              )}

              {/* Current price line */}
              <ReferenceLine y={currentPrice} stroke={mainChartColor} strokeWidth={1} strokeDasharray="4 2"
                label={{ value: `$${currentPrice.toFixed(2)}`, position: "right", fill: mainChartColor, fontSize: 10, fontWeight: "bold" }} />

              {/* Price rendering */}
              {chartView === "candles" ? (
                <Bar dataKey="close" barSize={Math.max(3, Math.min(12, 600 / chartData.length))} shape={renderCandle} />
              ) : chartView === "area" ? (
                <>
                  <defs>
                    <linearGradient id="fullChartGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={mainChartColor} stopOpacity={0.2} />
                      <stop offset="100%" stopColor={mainChartColor} stopOpacity={0.01} />
                    </linearGradient>
                  </defs>
                  <Area type="monotone" dataKey="close" stroke={mainChartColor} strokeWidth={2} fill="url(#fullChartGrad)" dot={false}
                    activeDot={{ r: 4, fill: mainChartColor, stroke: "hsl(225, 22%, 9%)", strokeWidth: 2 }} />
                </>
              ) : (
                <Line type="monotone" dataKey="close" stroke={mainChartColor} strokeWidth={2} dot={false}
                  activeDot={{ r: 4, fill: mainChartColor, stroke: "hsl(225, 22%, 9%)", strokeWidth: 2 }} />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* RSI Sub-chart */}
        {indicator === "rsi" && (
          <div className="h-[120px] border-t border-border mt-1 pt-1 shrink-0">
            <div className="text-[9px] font-mono text-muted-foreground px-2 mb-0.5">RSI (14)</div>
            <ResponsiveContainer width="100%" height="90%">
              <ComposedChart data={chartData} margin={{ top: 2, right: 60, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(225, 16%, 10%)" />
                <XAxis dataKey="time" hide />
                <YAxis domain={[0, 100]} axisLine={false} tickLine={false}
                  tick={{ fill: "hsl(215, 15%, 40%)", fontSize: 8 }} orientation="right" ticks={[30, 50, 70]} width={55} />
                <ReferenceLine y={70} stroke="hsl(0, 72%, 51%)" strokeDasharray="3 3" strokeOpacity={0.5} />
                <ReferenceLine y={30} stroke="hsl(145, 80%, 42%)" strokeDasharray="3 3" strokeOpacity={0.5} />
                <ReferenceLine y={50} stroke="hsl(225, 16%, 20%)" strokeDasharray="2 4" />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [v?.toFixed(1), "RSI"]} />
                <Area type="monotone" dataKey="rsi" stroke="hsl(38, 92%, 50%)" strokeWidth={1.5} dot={false}
                  fill="hsl(38, 92%, 50%)" fillOpacity={0.05} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* MACD Sub-chart */}
        {indicator === "macd" && (
          <div className="h-[120px] border-t border-border mt-1 pt-1 shrink-0">
            <div className="text-[9px] font-mono text-muted-foreground px-2 mb-0.5">MACD (12, 26, 9)</div>
            <ResponsiveContainer width="100%" height="90%">
              <ComposedChart data={chartData} margin={{ top: 2, right: 60, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(225, 16%, 10%)" />
                <XAxis dataKey="time" hide />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: "hsl(215, 15%, 40%)", fontSize: 8 }} orientation="right" width={55} />
                <ReferenceLine y={0} stroke="hsl(225, 16%, 20%)" />
                <Tooltip contentStyle={tooltipStyle}
                  formatter={(v: number, name: string) => [v?.toFixed(4), name === "macd" ? "MACD" : name === "macdSignal" ? "Signal" : "Hist"]} />
                <Bar dataKey="macdHist" barSize={3}>
                  {chartData.map((e, i) => (
                    <Cell key={i} fill={(e.macdHist ?? 0) >= 0 ? "hsl(145, 80%, 42%)" : "hsl(0, 72%, 51%)"} fillOpacity={0.6} />
                  ))}
                </Bar>
                <Line type="monotone" dataKey="macd" stroke="hsl(200, 95%, 48%)" strokeWidth={1.5} dot={false} />
                <Line type="monotone" dataKey="macdSignal" stroke="hsl(0, 72%, 51%)" strokeWidth={1} dot={false} strokeDasharray="3 3" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Volume Sub-chart */}
        {indicator === "volume" && (
          <div className="h-[120px] border-t border-border mt-1 pt-1 shrink-0">
            <div className="text-[9px] font-mono text-muted-foreground px-2 mb-0.5">Volume</div>
            <ResponsiveContainer width="100%" height="90%">
              <ComposedChart data={chartData} margin={{ top: 2, right: 60, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(225, 16%, 10%)" />
                <XAxis dataKey="time" hide />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: "hsl(215, 15%, 40%)", fontSize: 8 }}
                  orientation="right" width={55} tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`} />
                <Tooltip contentStyle={tooltipStyle}
                  formatter={(v: number) => [v?.toLocaleString(), "Volume"]} />
                <Bar dataKey="volume" barSize={Math.max(2, Math.min(8, 600 / chartData.length))}>
                  {chartData.map((e, i) => (
                    <Cell key={i} fill={e.isGreen ? "hsl(145, 80%, 42%)" : "hsl(0, 72%, 51%)"} fillOpacity={0.4} />
                  ))}
                </Bar>
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Bottom Status */}
      <div className="px-4 py-1 border-t border-border/50 flex items-center justify-between text-[9px] font-mono text-muted-foreground/50">
        <span>Press ESC to close · Click ─ to add price level</span>
        <span>{symbol} · {timeframe} · {chartView} · {overlay !== "none" ? overlay.toUpperCase() : ""} {indicator !== "none" ? `+ ${indicator.toUpperCase()}` : ""}</span>
      </div>
    </div>
  );
}
