import { useMemo, useState } from "react";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine, Cell, Area,
} from "recharts";
import { TickerData } from "@/hooks/useWebullData";
import { CandlestickShape, VolumeBar } from "@/components/chart/CandlestickBar";

interface PriceChartProps {
  klines: Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }>;
  ticker?: TickerData;
  symbol: string;
}

type ChartView = "candles" | "area";
type Overlay = "bb" | "sma" | "none";
type Indicator = "rsi" | "macd" | "vol" | "none";

// --- Technical indicator calculations ---
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
  for (let i = 1; i < data.length; i++) {
    ema.push(data[i] * k + ema[i - 1] * (1 - k));
  }
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
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
    rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return rsi;
}

function calcMACD(closes: number[]): { macd: (number | null)[]; signal: (number | null)[]; histogram: (number | null)[] } {
  if (closes.length < 26) return { macd: closes.map(() => null), signal: closes.map(() => null), histogram: closes.map(() => null) };
  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);
  const macdLine = ema12.map((v, i) => i < 25 ? null : v - ema26[i]);

  const nonNullStart = macdLine.findIndex(v => v !== null);
  const macdNonNull = macdLine.slice(nonNullStart).map(v => v!);
  const sigEma = calcEMA(macdNonNull, 9);

  const signal: (number | null)[] = new Array(closes.length).fill(null);
  const histogram: (number | null)[] = new Array(closes.length).fill(null);
  for (let i = 0; i < macdNonNull.length; i++) {
    const idx = nonNullStart + i;
    if (i >= 8) {
      signal[idx] = sigEma[i];
      histogram[idx] = macdNonNull[i] - sigEma[i];
    }
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

export function PriceChart({ klines, ticker, symbol }: PriceChartProps) {
  const [chartView, setChartView] = useState<ChartView>("candles");
  const [overlay, setOverlay] = useState<Overlay>("bb");
  const [indicator, setIndicator] = useState<Indicator>("rsi");

  const chartData = useMemo(() => {
    const closes = klines.map(k => k.close);
    const rsi = calcRSI(closes);
    const macd = calcMACD(closes);
    const bb = calcBollingerBands(closes);
    const sma20 = calcSMA(closes, 20);
    const sma50 = calcSMA(closes, 50);

    return klines.map((k, i) => ({
      time: new Date(k.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
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
      sma20: sma20[i],
      sma50: sma50[i],
      isGreen: k.close >= k.open,
    }));
  }, [klines]);

  const isPositive = ticker ? parseFloat(ticker.priceChangePercent) >= 0 : true;
  const currentPrice = ticker ? parseFloat(ticker.price) : klines[klines.length - 1]?.close || 0;

  const priceMin = useMemo(() => {
    if (chartData.length === 0) return 0;
    const lows = chartData.map(d => d.low);
    const bbLows = chartData.filter(d => d.bbLower !== null).map(d => d.bbLower!);
    return Math.min(...lows, ...bbLows) * 0.998;
  }, [chartData]);

  const priceMax = useMemo(() => {
    if (chartData.length === 0) return 0;
    const highs = chartData.map(d => d.high);
    const bbHighs = chartData.filter(d => d.bbUpper !== null).map(d => d.bbUpper!);
    return Math.max(...highs, ...bbHighs) * 1.002;
  }, [chartData]);

  const tooltipStyle = {
    backgroundColor: "hsl(220, 20%, 10%)",
    border: "1px solid hsl(220, 15%, 20%)",
    borderRadius: "8px",
    color: "hsl(210, 20%, 90%)",
    fontSize: 11,
    fontFamily: "JetBrains Mono, monospace",
    padding: "8px 12px",
    boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
  };

  const mainChartHeight = indicator !== "none" ? "h-[220px]" : "h-[300px]";

  return (
    <div className="bg-card rounded-lg border border-border p-4 flex-1">
      {/* Header */}
      <div className="flex items-baseline justify-between mb-2">
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            {symbol.replace("USDT", "")}/USDT
          </h2>
          <div className="flex items-baseline gap-3 mt-1">
            <span className="text-2xl font-mono font-bold text-foreground">
              ${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            {ticker && (
              <span className={`text-sm font-mono ${isPositive ? "text-gain" : "text-loss"}`}>
                {isPositive ? "▲" : "▼"} {parseFloat(ticker.priceChangePercent).toFixed(2)}%
              </span>
            )}
          </div>
        </div>
        {ticker && (
          <div className="text-right text-xs font-mono text-muted-foreground space-y-0.5">
            <div>H: <span className="text-gain">${parseFloat(ticker.high).toLocaleString()}</span></div>
            <div>L: <span className="text-loss">${parseFloat(ticker.low).toLocaleString()}</span></div>
            <div>Vol: {(parseFloat(ticker.quoteVolume) / 1e6).toFixed(1)}M</div>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2 mb-2 text-[10px] font-mono">
        <div className="flex gap-0.5 bg-secondary/60 rounded-md p-0.5">
          {(["candles", "area"] as const).map(v => (
            <button key={v} onClick={() => setChartView(v)}
              className={`px-2 py-1 rounded transition-colors ${chartView === v ? "bg-primary/20 text-primary font-semibold" : "text-muted-foreground hover:text-foreground"}`}>
              {v === "candles" ? "🕯 Candles" : "📈 Area"}
            </button>
          ))}
        </div>
        <div className="flex gap-0.5 bg-secondary/60 rounded-md p-0.5">
          {([["bb", "BB"], ["sma", "SMA"], ["none", "—"]] as const).map(([v, label]) => (
            <button key={v} onClick={() => setOverlay(v as Overlay)}
              className={`px-2 py-1 rounded transition-colors ${overlay === v ? "bg-primary/20 text-primary font-semibold" : "text-muted-foreground hover:text-foreground"}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex gap-0.5 bg-secondary/60 rounded-md p-0.5">
          {([["rsi", "RSI"], ["macd", "MACD"], ["vol", "Vol"], ["none", "—"]] as const).map(([v, label]) => (
            <button key={v} onClick={() => setIndicator(v as Indicator)}
              className={`px-2 py-1 rounded transition-colors ${indicator === v ? "bg-primary/20 text-primary font-semibold" : "text-muted-foreground hover:text-foreground"}`}>
              {label}
            </button>
          ))}
        </div>
        <span className="ml-auto text-[9px] text-muted-foreground/50">{chartData.length} bars</span>
      </div>

      {/* Main Price Chart */}
      <div className={mainChartHeight}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} barGap={0} barCategoryGap="15%">
            <defs>
              <linearGradient id="priceGradientArea" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={isPositive ? "hsl(152, 69%, 53%)" : "hsl(0, 84%, 60%)"} stopOpacity={0.3} />
                <stop offset="95%" stopColor={isPositive ? "hsl(152, 69%, 53%)" : "hsl(0, 84%, 60%)"} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="bbFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(195, 100%, 50%)" stopOpacity={0.05} />
                <stop offset="100%" stopColor="hsl(195, 100%, 50%)" stopOpacity={0.02} />
              </linearGradient>
            </defs>

            <XAxis dataKey="time" axisLine={false} tickLine={false}
              tick={{ fill: "hsl(215, 15%, 45%)", fontSize: 9, fontFamily: "JetBrains Mono" }}
              interval="preserveStartEnd" />
            <YAxis domain={[priceMin, priceMax]} axisLine={false} tickLine={false}
              tick={{ fill: "hsl(215, 15%, 45%)", fontSize: 9, fontFamily: "JetBrains Mono" }}
              orientation="right" width={55}
              tickFormatter={(v) => `$${v.toLocaleString()}`} />
            <Tooltip contentStyle={tooltipStyle}
              content={({ active, payload, label }) => {
                if (!active || !payload?.[0]?.payload) return null;
                const d = payload[0].payload;
                const green = d.close >= d.open;
                return (
                  <div style={tooltipStyle}>
                    <div style={{ color: "hsl(215, 15%, 55%)", marginBottom: 4, fontSize: 10 }}>{label}</div>
                    <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px 8px", fontSize: 11 }}>
                      <span style={{ color: "hsl(215, 15%, 55%)" }}>O</span>
                      <span>${d.open.toLocaleString()}</span>
                      <span style={{ color: "hsl(215, 15%, 55%)" }}>H</span>
                      <span style={{ color: "hsl(152, 69%, 53%)" }}>${d.high.toLocaleString()}</span>
                      <span style={{ color: "hsl(215, 15%, 55%)" }}>L</span>
                      <span style={{ color: "hsl(0, 84%, 60%)" }}>${d.low.toLocaleString()}</span>
                      <span style={{ color: "hsl(215, 15%, 55%)" }}>C</span>
                      <span style={{ color: green ? "hsl(152, 69%, 53%)" : "hsl(0, 84%, 60%)", fontWeight: 700 }}>
                        ${d.close.toLocaleString()}
                      </span>
                    </div>
                  </div>
                );
              }}
            />

            {/* Current price reference line */}
            <ReferenceLine y={currentPrice} stroke="hsl(45, 100%, 55%)" strokeDasharray="6 3" strokeWidth={0.8} strokeOpacity={0.6} />

            {/* Bollinger Bands */}
            {overlay === "bb" && (
              <>
                <Area type="monotone" dataKey="bbUpper" stroke="none" fill="url(#bbFill)"
                  dot={false} activeDot={false} connectNulls={false} />
                <Line type="monotone" dataKey="bbUpper" stroke="hsl(195, 100%, 50%)" strokeWidth={1}
                  dot={false} strokeDasharray="4 2" opacity={0.6} />
                <Line type="monotone" dataKey="bbMiddle" stroke="hsl(195, 100%, 50%)" strokeWidth={1}
                  dot={false} opacity={0.3} />
                <Line type="monotone" dataKey="bbLower" stroke="hsl(195, 100%, 50%)" strokeWidth={1}
                  dot={false} strokeDasharray="4 2" opacity={0.6} />
              </>
            )}

            {/* SMA overlays */}
            {overlay === "sma" && (
              <>
                <Line type="monotone" dataKey="sma20" stroke="hsl(45, 100%, 55%)" strokeWidth={1.2}
                  dot={false} opacity={0.8} name="SMA 20" />
                <Line type="monotone" dataKey="sma50" stroke="hsl(280, 80%, 65%)" strokeWidth={1.2}
                  dot={false} opacity={0.8} name="SMA 50" />
              </>
            )}

            {chartView === "candles" ? (
              <Bar dataKey="close" barSize={8} shape={(props: any) => (
                <CandlestickShape {...props} yAxisMin={priceMin} yAxisMax={priceMax} />
              )} />
            ) : (
              <Area type="monotone" dataKey="close"
                stroke={isPositive ? "hsl(152, 69%, 53%)" : "hsl(0, 84%, 60%)"}
                strokeWidth={2} fill="url(#priceGradientArea)"
                dot={false} activeDot={{ r: 3, strokeWidth: 2 }} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Volume sub-chart */}
      {indicator === "vol" && (
        <div className="h-[70px] mt-1 border-t border-border/50 pt-1">
          <div className="text-[9px] font-mono text-muted-foreground/60 mb-0.5 px-1">Volume</div>
          <ResponsiveContainer width="100%" height="85%">
            <ComposedChart data={chartData} barGap={0} barCategoryGap="15%">
              <XAxis dataKey="time" hide />
              <YAxis axisLine={false} tickLine={false}
                tick={{ fill: "hsl(215, 15%, 40%)", fontSize: 8 }} orientation="right" width={40}
                tickFormatter={(v) => v >= 1e6 ? `${(v / 1e6).toFixed(0)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : v} />
              <Bar dataKey="volume" shape={(props: any) => <VolumeBar {...props} />} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* RSI Indicator */}
      {indicator === "rsi" && (
        <div className="h-[75px] mt-1 border-t border-border/50 pt-1">
          <div className="text-[9px] font-mono text-muted-foreground/60 mb-0.5 px-1">RSI (14)</div>
          <ResponsiveContainer width="100%" height="90%">
            <ComposedChart data={chartData}>
              <XAxis dataKey="time" hide />
              <YAxis domain={[0, 100]} axisLine={false} tickLine={false}
                tick={{ fill: "hsl(215, 15%, 45%)", fontSize: 8 }} orientation="right"
                ticks={[30, 50, 70]} width={30} />
              <ReferenceLine y={70} stroke="hsl(0, 84%, 60%)" strokeDasharray="3 3" strokeOpacity={0.4} />
              <ReferenceLine y={30} stroke="hsl(152, 69%, 53%)" strokeDasharray="3 3" strokeOpacity={0.4} />
              <ReferenceLine y={50} stroke="hsl(220, 15%, 25%)" strokeOpacity={0.3} />
              <Tooltip contentStyle={tooltipStyle}
                formatter={(value: number) => [value?.toFixed(1), "RSI"]} />
              <Area type="monotone" dataKey="rsi" stroke="hsl(45, 100%, 55%)" strokeWidth={1.5}
                fill="hsl(45, 100%, 55%)" fillOpacity={0.05} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* MACD Indicator */}
      {indicator === "macd" && (
        <div className="h-[75px] mt-1 border-t border-border/50 pt-1">
          <div className="text-[9px] font-mono text-muted-foreground/60 mb-0.5 px-1">MACD (12, 26, 9)</div>
          <ResponsiveContainer width="100%" height="90%">
            <ComposedChart data={chartData}>
              <XAxis dataKey="time" hide />
              <YAxis axisLine={false} tickLine={false}
                tick={{ fill: "hsl(215, 15%, 45%)", fontSize: 8 }} orientation="right" width={30} />
              <ReferenceLine y={0} stroke="hsl(220, 15%, 25%)" />
              <Tooltip contentStyle={tooltipStyle}
                formatter={(value: number, name: string) => {
                  const labels: Record<string, string> = { macd: "MACD", macdSignal: "Signal", macdHist: "Hist" };
                  return [value?.toFixed(4), labels[name] || name];
                }} />
              <Bar dataKey="macdHist" barSize={3}>
                {chartData.map((entry, i) => (
                  <Cell key={i} fill={(entry.macdHist ?? 0) >= 0 ? "hsl(152, 69%, 53%)" : "hsl(0, 84%, 60%)"} fillOpacity={0.5} />
                ))}
              </Bar>
              <Line type="monotone" dataKey="macd" stroke="hsl(195, 100%, 50%)" strokeWidth={1.5} dot={false} />
              <Line type="monotone" dataKey="macdSignal" stroke="hsl(0, 84%, 60%)" strokeWidth={1} dot={false} strokeDasharray="3 3" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
