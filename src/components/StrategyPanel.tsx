import { useState, useCallback, useMemo, useEffect } from "react";
import { Brain, Settings2, Play, Loader2, Target, Shield, TrendingUp, TrendingDown, Minus, Crosshair, Gauge, Layers, Zap, ChevronDown, ChevronUp, BarChart3, Clock, DollarSign, ArrowUpDown, AlertTriangle, CheckCircle2, Calculator, Save, History, Trash2, Timer, Pin, Eye, EyeOff, FileBarChart } from "lucide-react";
import { PredictionIntelligenceCard } from "@/components/PredictionIntelligenceCard";
import { PerformanceReports } from "@/components/PerformanceReports";
import { computeAdaptiveRisk, getTierColor, getTierBgColor, getTierIcon, type AdaptiveRiskProfile, type StockContext } from "@/lib/adaptiveRisk";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ReferenceLine, ReferenceArea, ResponsiveContainer, CartesianGrid, Bar, ComposedChart, Line } from "recharts";
import { CandlestickShape, VolumeBar } from "@/components/chart/CandlestickBar";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { RiskParams } from "@/hooks/useBacktest";
import { Slider } from "@/components/ui/slider";
import { TickerData } from "@/hooks/useWebullData";
import { useStrategyHistory, type StrategyHistoryEntry, type AccuracyStats } from "@/hooks/useStrategyHistory";
import { isCryptoSymbol } from "@/hooks/useWebullData";

interface StrategySignal {
  action: "buy" | "sell" | "hold";
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  position_size_pct: number;
  reason: string;
  timeframe: string;
}

export interface StrategyResult {
  strategy_name: string;
  overall_bias: string;
  confidence: number;
  signals: StrategySignal[];
  indicators: {
    trend_strength: number;
    momentum_score: number;
    volatility_regime: string;
    support_levels: number[];
    resistance_levels: number[];
    rsi?: number;
    sma10?: number;
    sma20?: number;
    sma50?: number;
    atr?: number;
    relative_volume?: number;
  };
  risk_assessment: {
    risk_reward_ratio: number;
    max_drawdown_estimate: number;
    win_probability: number;
  };
  reasoning: string[];
  analysis_mode?: "ai" | "fallback";
}

type StrategyPreset = "momentum" | "mean_reversion" | "breakout" | "conservative";

const PRESETS: Record<StrategyPreset, { label: string; desc: string; icon: typeof Zap; risk: RiskParams }> = {
  momentum: { label: "Momentum", desc: "Ride trends with tight stops", icon: Zap, risk: { maxPositionPct: 10, stopLossPct: 2, takeProfitPct: 6, riskTolerance: "high" } },
  mean_reversion: { label: "Mean Revert", desc: "Fade extremes", icon: Target, risk: { maxPositionPct: 8, stopLossPct: 1.5, takeProfitPct: 3, riskTolerance: "medium" } },
  breakout: { label: "Breakout", desc: "Volume-confirmed breaks", icon: TrendingUp, risk: { maxPositionPct: 12, stopLossPct: 3, takeProfitPct: 8, riskTolerance: "high" } },
  conservative: { label: "Conservative", desc: "Small, wide stops", icon: Shield, risk: { maxPositionPct: 5, stopLossPct: 4, takeProfitPct: 4, riskTolerance: "low" } },
};

type KlineBar = { time: number; open: number; high: number; low: number; close: number; volume: number };

interface StrategyPanelProps {
  symbol: string;
  klines: KlineBar[];
  riskParams: RiskParams;
  onRiskParamsChange: (params: RiskParams) => void;
  onStrategyResult: (result: StrategyResult) => void;
  onRunBacktest: () => void;
  backtestRunning: boolean;
  tickers?: Record<string, TickerData>;
}

const biasConfig: Record<string, { label: string; colorClass: string; bgClass: string; icon: typeof TrendingUp }> = {
  strong_bullish: { label: "STRONG BULL", colorClass: "text-gain", bgClass: "bg-gain/10 border-gain/20", icon: TrendingUp },
  bullish: { label: "BULLISH", colorClass: "text-gain", bgClass: "bg-gain/5 border-gain/15", icon: TrendingUp },
  neutral: { label: "NEUTRAL", colorClass: "text-warning", bgClass: "bg-warning/5 border-warning/15", icon: Minus },
  bearish: { label: "BEARISH", colorClass: "text-loss", bgClass: "bg-loss/5 border-loss/15", icon: TrendingDown },
  strong_bearish: { label: "STRONG BEAR", colorClass: "text-loss", bgClass: "bg-loss/10 border-loss/20", icon: TrendingDown },
};

// ─── Visual Price Map — Dashboard-Style Area Chart with Signal Overlays ───
type ChartType = "area" | "line" | "candle" | "ohlc";
const CHART_TYPES: { value: ChartType; label: string }[] = [
  { value: "area", label: "Area" },
  { value: "line", label: "Line" },
  { value: "candle", label: "Candles" },
  { value: "ohlc", label: "OHLC" },
];

function PriceZoneMap({ signals, currentPrice, support, resistance, klines }: {
  signals: StrategySignal[];
  currentPrice: number;
  support: number[];
  resistance: number[];
  klines: KlineBar[];
}) {
  const [pulsePhase, setPulsePhase] = useState(0);
  const [chartType, setChartType] = useState<ChartType>("area");
  const [showVolume, setShowVolume] = useState(false);
  const [showEma9, setShowEma9] = useState(false);
  const [showEma21, setShowEma21] = useState(false);
  const [showPredictions, setShowPredictions] = useState(true);
  const [showSignals, setShowSignals] = useState(true);
  const [showSR, setShowSR] = useState(false);

  // Generate micro predictions
  const predictions = useMemo(() => {
    if (klines.length < 20) return [];
    return generateShortTermPredictions(klines, currentPrice);
  }, [klines, currentPrice]);
  const displayKlines = klines.slice(-60);

  useEffect(() => {
    const interval = setInterval(() => setPulsePhase(p => (p + 1) % 60), 50);
    return () => clearInterval(interval);
  }, []);

  const chartData = useMemo(() => {
    // Compute EMAs
    const computeEMA = (period: number) => {
      const ema: number[] = [];
      const k = 2 / (period + 1);
      displayKlines.forEach((kl, i) => {
        if (i === 0) ema.push(kl.close);
        else ema.push(kl.close * k + ema[i - 1] * (1 - k));
      });
      return ema;
    };
    const ema9 = computeEMA(9);
    const ema21 = computeEMA(21);

    return displayKlines.map((k, i) => {
      const d = new Date(k.time);
      return {
        time: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        close: Number(k.close.toFixed(2)),
        open: Number(k.open.toFixed(2)),
        high: Number(k.high.toFixed(2)),
        low: Number(k.low.toFixed(2)),
        volume: k.volume,
        isGreen: k.close >= k.open,
        ema9: Number(ema9[i].toFixed(2)),
        ema21: Number(ema21[i].toFixed(2)),
      };
    });
  }, [displayKlines]);

  if (displayKlines.length < 2) return null;

  const allPrices = [
    currentPrice,
    ...signals.flatMap(s => [s.entry_price, s.stop_loss, s.take_profit]),
    ...support, ...resistance,
    ...displayKlines.flatMap(k => [k.high, k.low]),
  ].filter(p => p > 0);

  const priceMin = Math.min(...allPrices) * 0.997;
  const priceMax = Math.max(...allPrices) * 1.003;
  const maxVol = Math.max(...displayKlines.map(k => k.volume), 1);

  const isPositive = displayKlines[displayKlines.length - 1].close >= displayKlines[0].close;
  const lineColor = isPositive ? "hsl(145, 80%, 42%)" : "hsl(0, 72%, 51%)";
  const gradientId = `priceZoneGrad-${isPositive ? "up" : "dn"}`;

  const proximityAlerts: string[] = [];
  signals.forEach(sig => {
    const distEntry = Math.abs(currentPrice - sig.entry_price) / sig.entry_price * 100;
    const distTP = Math.abs(currentPrice - sig.take_profit) / sig.take_profit * 100;
    const distSL = Math.abs(currentPrice - sig.stop_loss) / sig.stop_loss * 100;
    if (distEntry < 0.5) proximityAlerts.push(`⚡ Near entry $${sig.entry_price.toFixed(2)}`);
    if (distTP < 0.5) proximityAlerts.push(`🎯 Near TP $${sig.take_profit.toFixed(2)}`);
    if (distSL < 0.5) proximityAlerts.push(`⚠️ Near SL $${sig.stop_loss.toFixed(2)}`);
  });

  const change = chartData[chartData.length - 1].close - chartData[0].close;
  const changePct = (change / chartData[0].close * 100).toFixed(2);
  const pulseOpacity = 0.4 + Math.sin(pulsePhase * 0.1) * 0.4;

  // Custom candlestick/OHLC rendering via SVG overlay
  const renderCandlesOrOHLC = (type: "candle" | "ohlc") => {
    const padL = 50, padR = 66, padT = 8, padB = 30;
    const chartW = 1000 - padL - padR; // approximate responsive
    const chartH = showVolume ? 180 : 210;
    const range = priceMax - priceMin || 1;
    const candleW = Math.max(2, chartW / displayKlines.length - 1.5);
    const gap = (chartW - candleW * displayKlines.length) / (displayKlines.length + 1);
    const getY = (price: number) => padT + (1 - (price - priceMin) / range) * chartH;
    const getX = (i: number) => padL + gap + i * (candleW + gap);

    return (
      <g>
        {displayKlines.map((k, i) => {
          const x = getX(i);
          const isGreen = k.close >= k.open;
          const bodyTop = getY(Math.max(k.open, k.close));
          const bodyBot = getY(Math.min(k.open, k.close));
          const bodyH = Math.max(bodyBot - bodyTop, 0.8);
          const wickX = x + candleW / 2;
          const bullColor = "hsl(152, 69%, 53%)";
          const bearColor = "hsl(0, 84%, 60%)";
          const color = isGreen ? bullColor : bearColor;

          if (type === "ohlc") {
            const tickW = candleW * 0.4;
            return (
              <g key={`ohlc-${i}`}>
                <line x1={wickX} y1={getY(k.high)} x2={wickX} y2={getY(k.low)} stroke={color} strokeWidth={1} />
                <line x1={x} y1={getY(k.open)} x2={wickX} y2={getY(k.open)} stroke={color} strokeWidth={1.5} />
                <line x1={wickX} y1={getY(k.close)} x2={x + candleW} y2={getY(k.close)} stroke={color} strokeWidth={1.5} />
              </g>
            );
          }

          return (
            <g key={`candle-${i}`}>
              <line x1={wickX} y1={getY(k.high)} x2={wickX} y2={bodyTop} stroke={color} strokeWidth={0.8} strokeOpacity={0.7} />
              <line x1={wickX} y1={bodyBot} x2={wickX} y2={getY(k.low)} stroke={color} strokeWidth={0.8} strokeOpacity={0.7} />
              <rect x={x} y={bodyTop} width={candleW} height={bodyH} rx={0.5}
                fill={isGreen ? color : "transparent"} stroke={color} strokeWidth={isGreen ? 0 : 0.9} fillOpacity={0.85} />
            </g>
          );
        })}
      </g>
    );
  };

  // Shared reference elements
  const referenceElements = (
    <>
      {/* Signal zones */}
      {showSignals && signals.map((sig, i) => (
        <ReferenceArea key={`tp-zone-${i}`} yAxisId="price" y1={sig.entry_price} y2={sig.take_profit} fill="hsl(152, 69%, 53%)" fillOpacity={0.05} strokeOpacity={0} />
      ))}
      {showSignals && signals.map((sig, i) => (
        <ReferenceArea key={`sl-zone-${i}`} yAxisId="price" y1={sig.stop_loss} y2={sig.entry_price} fill="hsl(0, 84%, 60%)" fillOpacity={0.05} strokeOpacity={0} />
      ))}
      {/* S/R levels */}
      {showSR && support.map((s, i) => (
        <ReferenceLine key={`sup-${i}`} yAxisId="price" y={s} stroke="hsl(152, 69%, 53%)" strokeDasharray="4 3" strokeWidth={0.6} strokeOpacity={0.4}
          label={{ value: `S${i + 1}`, position: "left", fill: "hsl(152, 69%, 53%)", fontSize: 7, fontFamily: "monospace" }} />
      ))}
      {showSR && resistance.map((r, i) => (
        <ReferenceLine key={`res-${i}`} yAxisId="price" y={r} stroke="hsl(0, 84%, 60%)" strokeDasharray="4 3" strokeWidth={0.6} strokeOpacity={0.4}
          label={{ value: `R${i + 1}`, position: "left", fill: "hsl(0, 84%, 60%)", fontSize: 7, fontFamily: "monospace" }} />
      ))}
      {/* Signal lines */}
      {showSignals && signals.map((sig, i) => (
        <ReferenceLine key={`entry-${i}`} yAxisId="price" y={sig.entry_price} stroke="hsl(200, 95%, 60%)" strokeWidth={1.2} strokeDasharray="6 3"
          label={{ value: `${sig.action.toUpperCase()} $${sig.entry_price.toFixed(2)}`, position: "insideTopLeft", fill: "hsl(200, 95%, 60%)", fontSize: 8, fontWeight: "bold", fontFamily: "monospace" }} />
      ))}
      {showSignals && signals.map((sig, i) => (
        <ReferenceLine key={`tp-${i}`} yAxisId="price" y={sig.take_profit} stroke="hsl(152, 69%, 53%)" strokeWidth={1}
          label={{ value: `TP $${sig.take_profit.toFixed(2)}`, position: "insideTopLeft", fill: "hsl(152, 69%, 53%)", fontSize: 7, fontWeight: "bold", fontFamily: "monospace" }} />
      ))}
      {showSignals && signals.map((sig, i) => (
        <ReferenceLine key={`sl-${i}`} yAxisId="price" y={sig.stop_loss} stroke="hsl(0, 84%, 60%)" strokeWidth={1}
          label={{ value: `SL $${sig.stop_loss.toFixed(2)}`, position: "insideBottomLeft", fill: "hsl(0, 84%, 60%)", fontSize: 7, fontWeight: "bold", fontFamily: "monospace" }} />
      ))}
      {/* Current price */}
      <ReferenceLine yAxisId="price" y={currentPrice} stroke="hsl(210, 25%, 92%)" strokeWidth={1} strokeDasharray="3 2"
        label={{ value: `$${currentPrice.toFixed(2)}`, position: "insideTopRight", fill: "hsl(210, 25%, 92%)", fontSize: 8, fontWeight: "bold", fontFamily: "monospace" }} />
    </>
  );

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      {/* Compact header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-foreground">Price Zone Map</span>
          <span className="text-[8px] px-1 py-0.5 rounded-full font-mono bg-gain/10 text-gain flex items-center gap-1">
            <span className="w-1 h-1 rounded-full bg-gain" style={{ opacity: pulseOpacity }} />
            LIVE
          </span>
          {proximityAlerts.length > 0 && (
            <span className="text-[7px] font-mono bg-warning/15 border border-warning/30 text-warning px-1 py-0.5 rounded animate-pulse">
              {proximityAlerts[0]}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-mono font-bold text-foreground tabular-nums">
            ${currentPrice.toFixed(2)}
          </span>
          <span className={`text-[10px] font-mono ${isPositive ? "text-gain" : "text-loss"}`}>
            {isPositive ? "+" : ""}{changePct}%
          </span>
        </div>
      </div>

      {/* Toolbar — all toggles in one row */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-0.5 flex-wrap">
          {CHART_TYPES.map(ct => (
            <button key={ct.value} onClick={() => setChartType(ct.value)}
              className={`text-[7px] font-mono px-1.5 py-0.5 rounded border transition-colors ${chartType === ct.value ? 'bg-primary/10 border-primary/30 text-primary' : 'bg-secondary/50 border-border/30 text-muted-foreground hover:text-foreground'}`}>
              {ct.label}
            </button>
          ))}
          <span className="w-px h-2.5 bg-border/30 mx-0.5" />
          {[
            { key: "signals", label: "Signals", active: showSignals, toggle: () => setShowSignals(!showSignals), activeClass: "bg-accent/10 border-accent/30 text-accent" },
            { key: "sr", label: "S/R", active: showSR, toggle: () => setShowSR(!showSR), activeClass: "bg-foreground/10 border-foreground/20 text-foreground" },
            { key: "pred", label: "μPred", active: showPredictions, toggle: () => setShowPredictions(!showPredictions), activeClass: "bg-accent/10 border-accent/30 text-accent" },
            { key: "ema9", label: "EMA9", active: showEma9, toggle: () => setShowEma9(!showEma9), activeClass: "bg-yellow-500/10 border-yellow-500/30 text-yellow-400" },
            { key: "ema21", label: "EMA21", active: showEma21, toggle: () => setShowEma21(!showEma21), activeClass: "bg-purple-500/10 border-purple-500/30 text-purple-400" },
            { key: "vol", label: "VOL", active: showVolume, toggle: () => setShowVolume(!showVolume), activeClass: "bg-accent/10 border-accent/30 text-accent" },
          ].map(t => (
            <button key={t.key} onClick={t.toggle}
              className={`text-[7px] font-mono px-1.5 py-0.5 rounded border transition-colors ${t.active ? t.activeClass : 'bg-secondary/50 border-border/30 text-muted-foreground'}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div className={showVolume ? "h-[260px]" : "h-[230px]"}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={lineColor} stopOpacity={0.3} />
                <stop offset="100%" stopColor={lineColor} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(225, 16%, 13%)" strokeOpacity={0.5} />
            <XAxis dataKey="time" axisLine={false} tickLine={false}
              tick={{ fill: "hsl(215, 15%, 40%)", fontSize: 9, fontFamily: "JetBrains Mono, monospace" }}
              interval="preserveStartEnd" />
            <YAxis yAxisId="price" domain={[priceMin, priceMax]} axisLine={false} tickLine={false}
              tick={{ fill: "hsl(215, 15%, 40%)", fontSize: 9, fontFamily: "JetBrains Mono, monospace" }}
              orientation="right" width={58} tickFormatter={(v: number) => `$${v.toFixed(2)}`} />
            {showVolume && (
              <YAxis yAxisId="volume" orientation="left" width={0} domain={[0, maxVol * 4]} hide />
            )}
            <Tooltip
              contentStyle={{
                background: "hsl(225, 22%, 9%)",
                border: "1px solid hsl(225, 16%, 15%)",
                borderRadius: "8px",
                fontSize: "10px",
                fontFamily: "JetBrains Mono, monospace",
                boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
              }}
              formatter={(value: number, name: string) => {
                if (name === "volume") return [`${(value / 1e6).toFixed(1)}M`, "Volume"];
                const labels: Record<string, string> = { close: "Close", high: "High", low: "Low", open: "Open" };
                return [`$${value.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, labels[name] || name];
              }}
              labelStyle={{ color: "hsl(215, 15%, 50%)" }}
            />

            {referenceElements}

            {/* Volume bars */}
            {showVolume && (
              <Bar yAxisId="volume" dataKey="volume" fill="hsl(215, 15%, 30%)" fillOpacity={0.3}
                shape={(props: any) => {
                  const { x, y, width, height, payload } = props;
                  const color = payload?.isGreen ? "hsl(152, 69%, 53%)" : "hsl(0, 84%, 60%)";
                  return <rect x={x} y={y} width={width} height={Math.max(height, 0)} rx={0.5} fill={color} fillOpacity={0.25} />;
                }}
              />
            )}

            {/* Render based on chart type */}
            {chartType === "area" && (
              <Area yAxisId="price" type="monotone" dataKey="close" stroke={lineColor} strokeWidth={2}
                fill={`url(#${gradientId})`} dot={false}
                activeDot={{ r: 3, fill: lineColor, stroke: "hsl(225, 22%, 9%)", strokeWidth: 2 }} />
            )}
            {chartType === "line" && (
              <Line yAxisId="price" type="monotone" dataKey="close" stroke={lineColor} strokeWidth={2}
                dot={false} activeDot={{ r: 3, fill: lineColor, stroke: "hsl(225, 22%, 9%)", strokeWidth: 2 }} />
            )}
            {(chartType === "candle" || chartType === "ohlc") && (
              <>
                <Bar yAxisId="price" dataKey="high" fill="transparent" stroke="transparent" isAnimationActive={false}
                  background={{ fill: "transparent" }}
                  shape={(props: any) => {
                    const { x, width, payload, background } = props;
                    if (!payload || !background) return null;

                    const isGreen = payload.close >= payload.open;
                    const bullColor = "hsl(152, 69%, 53%)";
                    const bearColor = "hsl(0, 84%, 60%)";
                    const bullWick = "hsl(152, 69%, 65%)";
                    const bearWick = "hsl(0, 84%, 72%)";
                    const color = isGreen ? bullColor : bearColor;
                    const wickColor = isGreen ? bullWick : bearWick;

                    const range = priceMax - priceMin || 1;
                    const totalH = background.height;
                    const yTop = background.y;
                    const getYp = (price: number) => yTop + (1 - (price - priceMin) / range) * totalH;

                    const yOpen = getYp(payload.open);
                    const yClose = getYp(payload.close);
                    const yHigh = getYp(payload.high);
                    const yLow = getYp(payload.low);
                    const bodyTop = Math.min(yOpen, yClose);
                    const bodyH = Math.max(Math.abs(yOpen - yClose), 1.5);
                    const wickX = x + width / 2;

                    // Wider candle body
                    const bodyW = Math.max(width * 0.8, 4);
                    const bodyX = x + (width - bodyW) / 2;

                    if (chartType === "ohlc") {
                      return (
                        <g>
                          <line x1={wickX} y1={yHigh} x2={wickX} y2={yLow} stroke={color} strokeWidth={1.2} strokeLinecap="round" />
                          <line x1={x + 1} y1={yOpen} x2={wickX} y2={yOpen} stroke={color} strokeWidth={2} strokeLinecap="round" />
                          <line x1={wickX} y1={yClose} x2={x + width - 1} y2={yClose} stroke={color} strokeWidth={2} strokeLinecap="round" />
                        </g>
                      );
                    }

                    const bigMove = Math.abs(payload.close - payload.open) / payload.open > 0.015;

                    return (
                      <g>
                        {/* Upper wick */}
                        <line x1={wickX} y1={yHigh} x2={wickX} y2={bodyTop} stroke={wickColor} strokeWidth={1.2} strokeLinecap="round" />
                        {/* Lower wick */}
                        <line x1={wickX} y1={bodyTop + bodyH} x2={wickX} y2={yLow} stroke={wickColor} strokeWidth={1.2} strokeLinecap="round" />
                        {/* Body */}
                        <rect x={bodyX} y={bodyTop} width={bodyW} height={bodyH} rx={1}
                          fill={isGreen ? color : "transparent"} stroke={color}
                          strokeWidth={isGreen ? 0 : 1.5} fillOpacity={0.9} />
                        {/* Glow for large moves */}
                        {bigMove && (
                          <rect x={bodyX - 1} y={bodyTop - 1} width={bodyW + 2} height={bodyH + 2} rx={2}
                            fill="none" stroke={color} strokeWidth={0.5} opacity={0.3} />
                        )}
                      </g>
                    );
                  }}
                />
              </>
            )}

            {/* EMA overlays */}
            {showEma9 && (
              <Line yAxisId="price" type="monotone" dataKey="ema9" stroke="hsl(40, 96%, 53%)" strokeWidth={1.3} dot={false} strokeOpacity={0.7} name="EMA 9" />
            )}
            {showEma21 && (
              <Line yAxisId="price" type="monotone" dataKey="ema21" stroke="hsl(280, 70%, 60%)" strokeWidth={1.3} dot={false} strokeOpacity={0.7} name="EMA 21" />
            )}
            {/* Micro prediction target lines */}
            {showPredictions && predictions.map((pred, i) => {
              const color = pred.direction === "up" ? "hsl(145, 80%, 50%)" : pred.direction === "down" ? "hsl(0, 72%, 55%)" : "hsl(40, 96%, 53%)";
              const arrow = pred.direction === "up" ? "▲" : pred.direction === "down" ? "▼" : "◆";
              return (
                <ReferenceLine key={`pred-${i}`} yAxisId="price" y={pred.target_price}
                  stroke={color} strokeWidth={1} strokeDasharray="2 4" strokeOpacity={0.6}
                  label={{ value: `${arrow} ${pred.timeframe} $${pred.target_price.toFixed(2)}`, position: "insideTopRight", fill: color, fontSize: 7, fontFamily: "monospace", fontWeight: "bold" }} />
              );
            })}
            {showPredictions && predictions.length > 0 && (
              <>
                {/* Prediction range band for strongest signal */}
                {(() => {
                  const best = predictions.reduce((a, b) => b.confidence > a.confidence ? b : a, predictions[0]);
                  return (
                    <ReferenceArea yAxisId="price" y1={best.target_low} y2={best.target_high}
                      fill={best.direction === "up" ? "hsl(145, 80%, 50%)" : "hsl(0, 72%, 55%)"}
                      fillOpacity={0.04} strokeOpacity={0} />
                  );
                })()}
              </>
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Compact stats bar */}
      <div className="flex items-center justify-between mt-1.5 text-[8px] font-mono text-muted-foreground/60">
        <span>{chartData.length} bars · ${Math.min(...displayKlines.map(k => k.low)).toFixed(2)}–${Math.max(...displayKlines.map(k => k.high)).toFixed(2)}</span>
        {signals[0] && <span>R:R {(Math.abs(signals[0].take_profit - signals[0].entry_price) / Math.abs(signals[0].entry_price - signals[0].stop_loss)).toFixed(1)}x</span>}
        {showPredictions && predictions.length > 0 && (
          <span className="text-accent/60">{predictions.filter(p => p.direction !== "flat").length} predictions active</span>
        )}
      </div>
    </div>
  );
}

// ─── Signal P&L Calculator ───
function SignalPnLCalc({ signal, currentPrice }: { signal: StrategySignal; currentPrice: number }) {
  const [shares, setShares] = useState(100);

  const isBuy = signal.action === "buy";
  const distToEntry = ((signal.entry_price - currentPrice) / currentPrice * 100);
  const riskPerShare = Math.abs(signal.entry_price - signal.stop_loss);
  const rewardPerShare = Math.abs(signal.take_profit - signal.entry_price);
  const rr = riskPerShare > 0 ? (rewardPerShare / riskPerShare) : 0;
  const maxLoss = riskPerShare * shares;
  const maxProfit = rewardPerShare * shares;
  const cost = signal.entry_price * shares;

  return (
    <div className="mt-2 p-2 rounded bg-secondary/40 border border-border/30 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[8px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
          <Calculator className="w-2.5 h-2.5" /> P&L Calculator
        </span>
        <div className="flex items-center gap-1">
          <span className="text-[9px] text-muted-foreground">Shares:</span>
          <input
            type="number"
            value={shares}
            onChange={(e) => setShares(Math.max(1, parseInt(e.target.value) || 1))}
            className="w-14 text-[10px] font-mono bg-secondary border border-border/50 rounded px-1 py-0.5 text-foreground text-right"
          />
        </div>
      </div>
      <div className="grid grid-cols-4 gap-1.5 text-[9px] font-mono">
        <div className="text-center p-1 rounded bg-background/50">
          <div className="text-muted-foreground text-[7px]">COST</div>
          <div className="text-foreground font-semibold">${cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
        </div>
        <div className="text-center p-1 rounded bg-loss/5">
          <div className="text-loss/70 text-[7px]">MAX LOSS</div>
          <div className="text-loss font-semibold">-${maxLoss.toFixed(0)}</div>
        </div>
        <div className="text-center p-1 rounded bg-gain/5">
          <div className="text-gain/70 text-[7px]">MAX PROFIT</div>
          <div className="text-gain font-semibold">+${maxProfit.toFixed(0)}</div>
        </div>
        <div className="text-center p-1 rounded bg-accent/5">
          <div className="text-accent/70 text-[7px]">R:R</div>
          <div className="text-accent font-semibold">{rr.toFixed(1)}:1</div>
        </div>
      </div>
      <div className="flex items-center gap-2 text-[8px]">
        <span className={`${distToEntry > 0 ? "text-muted-foreground" : "text-gain"}`}>
          Entry is {Math.abs(distToEntry).toFixed(2)}% {distToEntry > 0 ? "above" : "below"} current price
        </span>
      </div>
    </div>
  );
}

// ─── Accuracy Stats Widget ───
function AccuracyStatsBar({ stats }: { stats: AccuracyStats }) {
  if (stats.total === 0) return null;
  return (
    <div className="grid grid-cols-5 gap-1.5 text-[9px] font-mono">
      <div className="p-1.5 rounded bg-secondary/40 border border-border/30 text-center">
        <div className="text-[7px] text-muted-foreground uppercase">Total</div>
        <div className="text-foreground font-bold">{stats.total}</div>
      </div>
      <div className="p-1.5 rounded bg-gain/5 border border-gain/10 text-center">
        <div className="text-[7px] text-gain/70 uppercase">Entry Hit</div>
        <div className="text-gain font-bold">{stats.entryHitRate.toFixed(0)}%</div>
      </div>
      <div className="p-1.5 rounded bg-gain/5 border border-gain/10 text-center">
        <div className="text-[7px] text-gain/70 uppercase">Win Rate</div>
        <div className="text-gain font-bold">{stats.winRate.toFixed(0)}%</div>
      </div>
      <div className="p-1.5 rounded bg-secondary/40 border border-border/30 text-center">
        <div className="text-[7px] text-muted-foreground uppercase">Avg P&L</div>
        <div className={stats.avgPnl >= 0 ? "text-gain font-bold" : "text-loss font-bold"}>{stats.avgPnl >= 0 ? "+" : ""}{stats.avgPnl.toFixed(2)}%</div>
      </div>
      <div className="p-1.5 rounded bg-secondary/40 border border-border/30 text-center">
        <div className="text-[7px] text-muted-foreground uppercase">W/L</div>
        <div className="text-foreground font-bold">{stats.wins}/{stats.losses}</div>
      </div>
    </div>
  );
}

// Re-export from shared module
import { generateShortTermPredictions, type ShortTermPrediction, recordPrediction, resolvePredictions, getPredictionAccuracy } from "@/lib/microPredictions";


function GaugeIndicator({ value, max, label, suffix = "", color }: { value: number; max: number; label: string; suffix?: string; color: string }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="text-[8px] text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className="relative w-14 h-7 overflow-hidden">
        <svg viewBox="0 0 100 50" className="w-full h-full">
          <path d="M 10 45 A 40 40 0 0 1 90 45" fill="none" stroke="hsl(var(--secondary))" strokeWidth="8" strokeLinecap="round" />
          <path d="M 10 45 A 40 40 0 0 1 90 45" fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" strokeDasharray={`${pct * 1.26} 126`} className="transition-all duration-700" />
        </svg>
      </div>
      <div className="text-[11px] font-mono font-semibold" style={{ color }}>{typeof value === "number" ? (Number.isInteger(value) ? value : value.toFixed(1)) : value}{suffix}</div>
    </div>
  );
}
function AdaptiveRiskCard({ symbol, currentPrice, strategy, tickers, klines, onRiskParamsChange }: {
  symbol: string; currentPrice: number; strategy: StrategyResult; tickers?: Record<string, TickerData>;
  klines: KlineBar[]; onRiskParamsChange: (p: RiskParams) => void;
}) {
  const riskProfile = useMemo<AdaptiveRiskProfile | null>(() => {
    if (currentPrice <= 0) return null;
    const ticker = tickers?.[symbol];
    const sig = strategy.signals[0];
    const ctx: StockContext = {
      symbol: symbol.replace("USDT", ""),
      price: currentPrice,
      changePct: parseFloat(ticker?.priceChangePercent || "0"),
      high: parseFloat(ticker?.high || String(currentPrice)),
      low: parseFloat(ticker?.low || String(currentPrice)),
      volume: parseFloat(ticker?.volume?.replace(/[^\d.]/g, '') || '0'),
      atr: strategy.indicators.atr,
      strategyConfidence: strategy.confidence,
      strategyBias: strategy.overall_bias,
      strategyRR: strategy.risk_assessment.risk_reward_ratio,
      strategySL: sig?.stop_loss,
      strategyTP: sig?.take_profit,
      peScore: ticker?.profitExpectancy,
      klineCount: klines.length,
    };
    return computeAdaptiveRisk(ctx, {
      stopLossPct: 2, takeProfitPct: 5, positionSizePct: 5,
      requireMinRR: 2, confidenceThreshold: 55, trailingStopPct: 1.5,
    });
  }, [symbol, currentPrice, strategy, tickers, klines]);

  if (!riskProfile) return null;

  return (
    <div className={`p-2.5 rounded-lg border ${getTierBgColor(riskProfile.tier)}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="text-[9px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
          <Shield className="w-3 h-3" /> Adaptive Risk Profile
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-sm">{getTierIcon(riskProfile.tier)}</span>
          <span className={`text-[10px] font-mono font-bold ${getTierColor(riskProfile.tier)}`}>
            {riskProfile.tier.replace("_", " ").toUpperCase()}
          </span>
        </div>
      </div>
      <div className="grid grid-cols-5 gap-1.5 mb-2">
        {[
          { label: "SL", value: `${riskProfile.stopLossPct}%`, color: "text-loss" },
          { label: "TP", value: `${riskProfile.takeProfitPct}%`, color: "text-gain" },
          { label: "Size", value: `${riskProfile.positionSizePct.toFixed(1)}%`, color: "text-foreground" },
          { label: "Min R:R", value: `${riskProfile.requireMinRR}x`, color: "text-accent" },
          { label: "Trail", value: `${riskProfile.trailingStopPct}%`, color: "text-primary" },
        ].map(m => (
          <div key={m.label} className="text-center p-1 rounded bg-background/30">
            <div className="text-[7px] text-muted-foreground">{m.label}</div>
            <div className={`text-[10px] font-mono font-bold ${m.color}`}>{m.value}</div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-1 mb-1.5">
        {riskProfile.reasons.slice(0, 5).map((r, i) => (
          <span key={i} className="text-[7px] px-1.5 py-0.5 rounded-full bg-background/40 text-muted-foreground">{r}</span>
        ))}
      </div>
      <button
        onClick={() => onRiskParamsChange({
          maxPositionPct: Math.round(riskProfile.positionSizePct),
          stopLossPct: riskProfile.stopLossPct,
          takeProfitPct: riskProfile.takeProfitPct,
          riskTolerance: riskProfile.tier === "aggressive" || riskProfile.tier === "speculative" ? "high" : riskProfile.tier === "ultra_safe" || riskProfile.tier === "conservative" ? "low" : "medium",
        })}
        className="w-full text-[9px] font-semibold py-1 rounded bg-accent/15 text-accent hover:bg-accent/25 transition-colors"
      >
        Apply Adaptive Risk to Strategy Params
      </button>
    </div>
  );
}

export function StrategyPanel({
  symbol, klines, riskParams, onRiskParamsChange, onStrategyResult, onRunBacktest, backtestRunning, tickers,
}: StrategyPanelProps) {
  const [loading, setLoading] = useState(false);
  const [strategy, setStrategy] = useState<StrategyResult | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showReasoning, setShowReasoning] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<StrategyPreset | null>(null);
  const [multiScan, setMultiScan] = useState(false);
  const [scanResults, setScanResults] = useState<Array<{ symbol: string; bias: string; confidence: number; topSignal?: StrategySignal }>>([]);
  const [scanning, setScanning] = useState(false);
  const [expandedSignal, setExpandedSignal] = useState<number | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [historyAssetFilter, setHistoryAssetFilter] = useState<"all" | "stocks" | "crypto">("all");
  const [showShortTerm, setShowShortTerm] = useState(true);
  const [showReports, setShowReports] = useState(false);
  const [pinnedSignals, setPinnedSignals] = useState(true);

  const { history, stats: accuracyStats, saveStrategy, checkPriceAgainstStrategies, deleteEntry, loading: historyLoading } = useStrategyHistory();

  const currentPrice = useMemo(() => {
    if (tickers?.[symbol]) return parseFloat(tickers[symbol].price) || 0;
    if (klines.length > 0) return klines[klines.length - 1].close;
    return 0;
  }, [tickers, symbol, klines]);

  // Track prices against pending strategies
  useEffect(() => {
    if (currentPrice > 0 && symbol) {
      checkPriceAgainstStrategies(symbol, currentPrice);
    }
  }, [currentPrice, symbol, checkPriceAgainstStrategies]);

  // Short-term predictions with auto-refresh
  const [predRefreshCount, setPredRefreshCount] = useState(0);
  const [predCountdown, setPredCountdown] = useState(15);
  const shortTermPredictions = useMemo(() => {
    if (!showShortTerm || klines.length < 20 || currentPrice <= 0) return [];
    return generateShortTermPredictions(klines, currentPrice);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showShortTerm, klines, currentPrice, predRefreshCount]);

  const predAccuracy = useMemo(() => getPredictionAccuracy(), [predRefreshCount]);

  // Auto-refresh predictions every 15 seconds + record + resolve
  useEffect(() => {
    if (!showShortTerm) return;
    const timer = setInterval(() => {
      setPredRefreshCount(c => c + 1);
      setPredCountdown(15);
    }, 15000);
    const countdownTimer = setInterval(() => setPredCountdown(c => Math.max(0, c - 1)), 1000);
    return () => { clearInterval(timer); clearInterval(countdownTimer); };
  }, [showShortTerm]);

  // Record & resolve predictions
  useEffect(() => {
    if (shortTermPredictions.length > 0 && currentPrice > 0) {
      shortTermPredictions.forEach(p => recordPrediction(p, currentPrice));
      resolvePredictions(currentPrice);
    }
  }, [predRefreshCount]);

  const applyPreset = useCallback((preset: StrategyPreset) => {
    // === Improvement #2: Block mean-reversion preset on crypto (proven 0% WR in our review) ===
    if (preset === "mean_reversion" && isCryptoSymbol(symbol)) {
      toast.error("Mean-Revert disabled on crypto — 0% win rate in historical data. Try Momentum or Breakout.");
      return;
    }
    setSelectedPreset(preset);
    onRiskParamsChange(PRESETS[preset].risk);
    toast.success(`Applied ${PRESETS[preset].label} preset`);
  }, [onRiskParamsChange, symbol]);

  const runStrategy = useCallback(async () => {
    if (loading) return;
    if (!klines || klines.length < 10) {
      toast.error(`Not enough data for ${symbol}. Need 10+ candles.`);
      return;
    }
    setLoading(true);
    try {
      const tickerPE = tickers?.[symbol]?.profitExpectancy ?? 0;
      const { data, error } = await supabase.functions.invoke("strategy-engine", {
        body: {
          klines, symbol, riskParams,
          profitExpectancy: tickerPE,
          historicalAccuracy: accuracyStats.total >= 3 ? { winRate: accuracyStats.winRate, avgPnl: accuracyStats.avgPnl, total: accuracyStats.total, entryHitRate: accuracyStats.entryHitRate } : undefined,
          microPredDirection: shortTermPredictions[0]?.direction,
          microPredConfidence: shortTermPredictions[0]?.confidence,
        },
      });
      if (error) throw error;
      if (data?.error) {
        if (data.error.includes("Rate limited")) toast.error("Rate limited.");
        else if (data.error.includes("credits")) toast.warning("AI credits exhausted — using local TA.");
        else throw new Error(data.error);
        return;
      }
      setStrategy(data);
      onStrategyResult(data);
      const mode = data.analysis_mode === "fallback" ? " (local TA)" : "";
      toast.success(`Strategy "${data.strategy_name}"${mode} generated`);
    } catch (err) {
      console.error("Strategy engine failed:", err);
      toast.error("Strategy generation failed.");
    } finally {
      setLoading(false);
    }
  }, [klines, symbol, riskParams, loading, onStrategyResult]);

  const runMultiScan = useCallback(async () => {
    if (!tickers || scanning) return;
    setScanning(true);
    setScanResults([]);
    const topSymbols = Object.entries(tickers)
      .sort((a, b) => (b[1].profitExpectancy ?? 0) - (a[1].profitExpectancy ?? 0))
      .slice(0, 5)
      .map(([s]) => s);

    const results: typeof scanResults = [];
    for (const sym of topSymbols) {
      try {
        const ticker = tickers[sym];
        const price = parseFloat(ticker.price);
        const high = parseFloat(ticker.high);
        const low = parseFloat(ticker.low);
        const range = high - low;
        const rangePosition = range > 0 ? ((price - low) / range * 100).toFixed(1) : "50";
        const { data } = await supabase.functions.invoke("analyze-market", {
          body: { marketData: { symbol: sym, price: ticker.price, priceChangePercent: ticker.priceChangePercent, high: ticker.high, low: ticker.low, quoteVolume: ticker.volume || "0", rangePosition } },
        });
        if (data && !data.error) {
          results.push({ symbol: sym, bias: data.signal || "neutral", confidence: data.confidence || 0 });
          setScanResults([...results]);
        }
      } catch { /* skip */ }
    }
    setScanResults(results);
    setScanning(false);
    toast.success(`Scanned ${results.length} stocks`);
  }, [tickers, scanning]);

  const bias = strategy ? biasConfig[strategy.overall_bias] || biasConfig.neutral : null;
  const BiasIcon = bias?.icon || Minus;

  return (
    <div className="bg-card rounded-lg border border-border p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Target className="w-4 h-4 text-accent" />
          Strategy Engine
          {strategy?.analysis_mode && (
            <span className={`text-[8px] px-1.5 py-0.5 rounded font-mono ${strategy.analysis_mode === "ai" ? "bg-accent/10 text-accent" : "bg-warning/10 text-warning"}`}>
              {strategy.analysis_mode === "ai" ? "AI" : "LOCAL TA"}
            </span>
          )}
        </h3>
        <div className="flex items-center gap-1.5">
          <button onClick={() => setShowShortTerm(!showShortTerm)} className={`p-1 rounded transition-colors ${showShortTerm ? "bg-warning/15 text-warning" : "text-muted-foreground hover:text-foreground hover:bg-secondary"}`} title="Short-term predictions (1-5 min)">
            <Timer className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => setShowReports(!showReports)} className={`p-1 rounded transition-colors ${showReports ? "bg-accent/15 text-accent" : "text-muted-foreground hover:text-foreground hover:bg-secondary"}`} title="Performance reports">
            <FileBarChart className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => setShowHistory(!showHistory)} className={`p-1 rounded transition-colors ${showHistory ? "bg-accent/15 text-accent" : "text-muted-foreground hover:text-foreground hover:bg-secondary"}`} title="Strategy history & accuracy">
            <History className="w-3.5 h-3.5" />
          </button>
          {tickers && (
            <button onClick={() => setMultiScan(!multiScan)} className={`p-1 rounded transition-colors ${multiScan ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-secondary"}`} title="Multi-stock scanner">
              <Layers className="w-3.5 h-3.5" />
            </button>
          )}
          <button onClick={() => setShowSettings(!showSettings)} className="p-1 rounded hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground" title="Risk parameters">
            <Settings2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Presets */}
      <div className="grid grid-cols-4 gap-1.5">
        {(Object.entries(PRESETS) as [StrategyPreset, typeof PRESETS[StrategyPreset]][]).map(([key, preset]) => {
          const PresetIcon = preset.icon;
          return (
            <button key={key} onClick={() => applyPreset(key)} className={`p-2 rounded-md text-center transition-all border ${selectedPreset === key ? "bg-accent/10 border-accent/30 text-accent" : "bg-secondary/40 border-border/50 text-muted-foreground hover:border-border hover:text-foreground"}`}>
              <PresetIcon className="w-3.5 h-3.5 mx-auto mb-1" />
              <div className="text-[9px] font-semibold">{preset.label}</div>
              <div className="text-[7px] opacity-60 leading-tight">{preset.desc}</div>
            </button>
          );
        })}
      </div>

      {/* Multi-Stock Scanner */}
      {multiScan && (
        <div className="p-3 rounded-md bg-secondary/30 border border-border/50 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1"><Layers className="w-3 h-3" /> Scanner</div>
            <button onClick={runMultiScan} disabled={scanning} className="text-[9px] px-2 py-1 rounded bg-primary/15 text-primary hover:bg-primary/25 disabled:opacity-40 font-medium">
              {scanning ? "Scanning..." : "Scan Top 5"}
            </button>
          </div>
          {scanResults.length > 0 && (
            <div className="space-y-1">
              {scanResults.map((r, i) => {
                const signalColor = r.bias.includes("buy") ? "text-gain" : r.bias.includes("sell") ? "text-loss" : "text-warning";
                return (
                  <div key={i} className="flex items-center justify-between text-[10px] font-mono py-1 border-b border-border/30">
                    <span className="text-foreground font-semibold">{r.symbol}</span>
                    <div className="flex items-center gap-2">
                      <span className={signalColor}>{r.bias.replace("_", " ").toUpperCase()}</span>
                      <div className="w-12 h-1.5 bg-secondary rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${r.confidence >= 70 ? "bg-gain" : r.confidence >= 50 ? "bg-warning" : "bg-loss"}`} style={{ width: `${r.confidence}%` }} />
                      </div>
                      <span className="text-muted-foreground w-8 text-right">{r.confidence}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {scanning && <div className="flex items-center gap-2 text-[10px] text-muted-foreground"><Loader2 className="w-3 h-3 animate-spin" /> Analyzing...</div>}
        </div>
      )}

      {/* Risk Settings */}
      {showSettings && (
        <div className="p-3 rounded-md bg-secondary/50 border border-border space-y-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1"><Shield className="w-3 h-3" /> Risk Parameters</div>
          <div className="space-y-2">
            <div className="flex justify-between text-[11px]"><span className="text-muted-foreground">Max Position</span><span className="font-mono text-foreground">{riskParams.maxPositionPct}%</span></div>
            <Slider value={[riskParams.maxPositionPct]} min={1} max={50} step={1} onValueChange={([v]) => onRiskParamsChange({ ...riskParams, maxPositionPct: v })} className="py-1" />
            <div className="flex justify-between text-[11px]"><span className="text-muted-foreground">Stop Loss</span><span className="font-mono text-loss">{riskParams.stopLossPct}%</span></div>
            <Slider value={[riskParams.stopLossPct]} min={0.5} max={10} step={0.5} onValueChange={([v]) => onRiskParamsChange({ ...riskParams, stopLossPct: v })} className="py-1" />
            <div className="flex justify-between text-[11px]"><span className="text-muted-foreground">Take Profit</span><span className="font-mono text-gain">{riskParams.takeProfitPct}%</span></div>
            <Slider value={[riskParams.takeProfitPct]} min={1} max={20} step={0.5} onValueChange={([v]) => onRiskParamsChange({ ...riskParams, takeProfitPct: v })} className="py-1" />
            <div className="flex justify-between text-[11px]">
              <span className="text-muted-foreground">Risk Tolerance</span>
              <div className="flex gap-1">
                {(["low", "medium", "high"] as const).map(level => (
                  <button key={level} onClick={() => onRiskParamsChange({ ...riskParams, riskTolerance: level })} className={`px-2 py-0.5 text-[10px] rounded font-mono transition-colors ${riskParams.riskTolerance === level ? "bg-accent/20 text-accent border border-accent/30" : "bg-secondary text-muted-foreground"}`}>
                    {level.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Short-Term Predictions — V2 Enhanced */}
      {showShortTerm && currentPrice > 0 && (
        <div className="p-3 rounded-lg bg-gradient-to-br from-warning/5 via-accent/3 to-primary/5 border border-warning/20 space-y-3">
          {/* Header with countdown */}
          <div className="flex items-center justify-between">
            <div className="text-[10px] uppercase tracking-wider text-warning flex items-center gap-1.5">
              <Timer className="w-3.5 h-3.5" /> Micro Predictions V2
              <span className="w-1.5 h-1.5 rounded-full bg-gain animate-pulse" />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[8px] text-muted-foreground font-mono bg-secondary/50 px-1.5 py-0.5 rounded">
                {predCountdown}s
              </span>
              <span className="text-[8px] text-muted-foreground font-mono">
                ${currentPrice.toFixed(2)}
              </span>
            </div>
          </div>

          {shortTermPredictions.length > 0 ? (
            <>
              {/* Accuracy Badge */}
              {predAccuracy.total > 0 && (
                <div className="p-2 rounded bg-secondary/30 border border-border/30 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] text-muted-foreground font-medium">Micro Prediction Accuracy</span>
                    <span className={`text-[9px] font-mono font-bold ${predAccuracy.rate >= 60 ? "text-gain" : predAccuracy.rate >= 45 ? "text-warning" : "text-loss"}`}>
                      Direction: {predAccuracy.rate}% ({predAccuracy.hits}/{predAccuracy.total})
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[8px]">
                    <span className="text-muted-foreground">Target Range Hit: <span className={`font-mono font-bold ${predAccuracy.targetRate >= 40 ? "text-gain" : "text-loss"}`}>{predAccuracy.targetRate}%</span></span>
                    <span className="text-muted-foreground">Recent 10: <span className={`font-mono font-bold ${predAccuracy.recentTrend >= 60 ? "text-gain" : predAccuracy.recentTrend >= 45 ? "text-warning" : "text-loss"}`}>{predAccuracy.recentTrend}%</span></span>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {Object.entries(predAccuracy.byTimeframe).map(([tf, data]) => (
                      <div key={tf} className="text-[7px] font-mono text-muted-foreground bg-background/50 px-1.5 py-0.5 rounded">
                        {tf}: <span className={data.rate >= 55 ? "text-gain" : "text-loss"}>{data.rate}%</span>
                        <span className="text-muted-foreground/60 ml-0.5">({data.total})</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Expanded Indicator Dashboard */}
              {shortTermPredictions[0] && (() => {
                const ind = shortTermPredictions[0].indicators;
                return (
                  <div className="space-y-1.5">
                    <div className="grid grid-cols-5 gap-1 text-[8px] font-mono">
                      <div className={`p-1.5 rounded text-center border ${ind.microRsi > 65 ? "bg-loss/5 border-loss/15 text-loss" : ind.microRsi < 35 ? "bg-gain/5 border-gain/15 text-gain" : "bg-secondary/40 border-border/30 text-foreground"}`}>
                        <div className="text-[6px] text-muted-foreground">RSI(7)</div>
                        <div className="font-bold text-[10px]">{ind.microRsi.toFixed(0)}</div>
                      </div>
                      <div className={`p-1.5 rounded text-center border ${ind.stochRsi > 80 ? "bg-loss/5 border-loss/15 text-loss" : ind.stochRsi < 20 ? "bg-gain/5 border-gain/15 text-gain" : "bg-secondary/40 border-border/30 text-foreground"}`}>
                        <div className="text-[6px] text-muted-foreground">StochRSI</div>
                        <div className="font-bold text-[10px]">{ind.stochRsi.toFixed(0)}</div>
                      </div>
                      <div className={`p-1.5 rounded text-center border ${ind.macdSignal === "bullish" ? "bg-gain/5 border-gain/15 text-gain" : ind.macdSignal === "bearish" ? "bg-loss/5 border-loss/15 text-loss" : "bg-secondary/40 border-border/30 text-muted-foreground"}`}>
                        <div className="text-[6px] text-muted-foreground">MACD</div>
                        <div className="font-bold text-[10px]">{ind.macdSignal === "bullish" ? "↑ Bull" : ind.macdSignal === "bearish" ? "↓ Bear" : "— Flat"}</div>
                      </div>
                      <div className={`p-1.5 rounded text-center border ${ind.bbPosition === "lower" ? "bg-gain/5 border-gain/15 text-gain" : ind.bbPosition === "upper" ? "bg-loss/5 border-loss/15 text-loss" : "bg-secondary/40 border-border/30 text-muted-foreground"}`}>
                        <div className="text-[6px] text-muted-foreground">BB{ind.bbWidth < 0.02 ? " 🔥" : ""}</div>
                        <div className="font-bold text-[10px]">{ind.bbPosition.toUpperCase()}</div>
                      </div>
                      <div className={`p-1.5 rounded text-center border ${ind.volumeProfile === "surge" ? "bg-accent/5 border-accent/15 text-accent" : ind.volumeProfile === "dry" ? "bg-loss/5 border-loss/15 text-loss" : "bg-secondary/40 border-border/30 text-muted-foreground"}`}>
                        <div className="text-[6px] text-muted-foreground">VOL</div>
                        <div className="font-bold text-[10px]">{ind.volumeRatio.toFixed(1)}x</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-5 gap-1 text-[8px] font-mono">
                      <div className={`p-1.5 rounded text-center border ${ind.ema3vs8 === "golden" ? "bg-gain/5 border-gain/15 text-gain" : ind.ema3vs8 === "death" ? "bg-loss/5 border-loss/15 text-loss" : "bg-secondary/40 border-border/30 text-muted-foreground"}`}>
                        <div className="text-[6px] text-muted-foreground">EMA3/8</div>
                        <div className="font-bold text-[10px]">{ind.ema3vs8 === "golden" ? "🟢" : ind.ema3vs8 === "death" ? "🔴" : "—"}</div>
                      </div>
                      <div className={`p-1.5 rounded text-center border ${ind.ema9vs21 === "golden" ? "bg-gain/5 border-gain/15 text-gain" : ind.ema9vs21 === "death" ? "bg-loss/5 border-loss/15 text-loss" : "bg-secondary/40 border-border/30 text-muted-foreground"}`}>
                        <div className="text-[6px] text-muted-foreground">EMA9/21</div>
                        <div className="font-bold text-[10px]">{ind.ema9vs21 === "golden" ? "🟢" : ind.ema9vs21 === "death" ? "🔴" : "—"}</div>
                      </div>
                      <div className={`p-1.5 rounded text-center border ${ind.obvTrend === "rising" ? "bg-gain/5 border-gain/15 text-gain" : ind.obvTrend === "falling" ? "bg-loss/5 border-loss/15 text-loss" : "bg-secondary/40 border-border/30 text-muted-foreground"}`}>
                        <div className="text-[6px] text-muted-foreground">OBV</div>
                        <div className="font-bold text-[10px]">{ind.obvTrend === "rising" ? "↑" : ind.obvTrend === "falling" ? "↓" : "—"}</div>
                      </div>
                      <div className={`p-1.5 rounded text-center border ${ind.vwapPosition === "above" ? "bg-gain/5 border-gain/15 text-gain" : ind.vwapPosition === "below" ? "bg-loss/5 border-loss/15 text-loss" : "bg-secondary/40 border-border/30 text-muted-foreground"}`}>
                        <div className="text-[6px] text-muted-foreground">VWAP</div>
                        <div className="font-bold text-[10px]">{ind.vwapPosition === "above" ? "Above" : ind.vwapPosition === "below" ? "Below" : "At"}</div>
                      </div>
                      <div className={`p-1.5 rounded text-center border ${ind.orderFlowBias > 25 ? "bg-gain/5 border-gain/15 text-gain" : ind.orderFlowBias < -25 ? "bg-loss/5 border-loss/15 text-loss" : "bg-secondary/40 border-border/30 text-muted-foreground"}`}>
                        <div className="text-[6px] text-muted-foreground">Flow</div>
                        <div className="font-bold text-[10px]">{ind.orderFlowBias > 0 ? "+" : ""}{ind.orderFlowBias}%</div>
                      </div>
                    </div>
                    {/* Contextual tags */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {ind.candlePattern && (
                        <span className={`text-[7px] px-1.5 py-0.5 rounded font-mono border ${ind.candlePattern.includes("Bullish") ? "bg-gain/10 border-gain/20 text-gain" : ind.candlePattern.includes("Bearish") || ind.candlePattern === "Hanging Man" ? "bg-loss/10 border-loss/20 text-loss" : "bg-secondary/50 border-border/30 text-foreground"}`}>
                          🕯 {ind.candlePattern}
                        </span>
                      )}
                      {ind.fibDistance < 0.5 && (
                        <span className="text-[7px] px-1.5 py-0.5 rounded font-mono bg-accent/10 border border-accent/20 text-accent">
                          📐 Fib {ind.fibLevel}
                        </span>
                      )}
                      {Math.abs(ind.trendPersistence) >= 2 && (
                        <span className={`text-[7px] px-1.5 py-0.5 rounded font-mono border ${ind.trendPersistence > 0 ? "bg-gain/10 border-gain/20 text-gain" : "bg-loss/10 border-loss/20 text-loss"}`}>
                          📊 {Math.abs(ind.trendPersistence)} candles {ind.trendPersistence > 0 ? "up" : "down"}
                        </span>
                      )}
                      {Math.abs(ind.priceAccel) > 2 && (
                        <span className={`text-[7px] px-1.5 py-0.5 rounded font-mono border ${ind.priceAccel > 0 ? "bg-gain/10 border-gain/20 text-gain" : "bg-loss/10 border-loss/20 text-loss"}`}>
                          ⚡ {ind.priceAccel > 0 ? "+" : ""}{ind.priceAccel.toFixed(1)}bp
                        </span>
                      )}
                      {ind.bbWidth < 0.02 && (
                        <span className="text-[7px] px-1.5 py-0.5 rounded font-mono bg-warning/10 border border-warning/20 text-warning">
                          🔥 BB Squeeze
                        </span>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Strength Meter */}
              {shortTermPredictions[0] && (
                <div className="flex items-center gap-2">
                  <span className="text-[7px] text-muted-foreground uppercase w-10">Bias</span>
                  <div className="flex-1 h-2.5 bg-secondary rounded-full overflow-hidden relative">
                    <div className="absolute inset-0 flex">
                      <div className="w-1/2 bg-gradient-to-r from-loss/30 to-transparent" />
                      <div className="w-1/2 bg-gradient-to-l from-gain/30 to-transparent" />
                    </div>
                    <div className="absolute top-0 left-1/2 h-full w-px bg-muted-foreground/30" />
                    <div
                      className="absolute top-0 h-2.5 w-1.5 rounded-full bg-foreground shadow-lg transition-all duration-500"
                      style={{ left: `${Math.max(2, Math.min(98, 50 + shortTermPredictions[0].strength / 2))}%` }}
                    />
                  </div>
                  <span className={`text-[9px] font-mono font-bold w-10 text-right ${shortTermPredictions[0].strength > 10 ? "text-gain" : shortTermPredictions[0].strength < -10 ? "text-loss" : "text-muted-foreground"}`}>
                    {shortTermPredictions[0].strength > 0 ? "+" : ""}{shortTermPredictions[0].strength}
                  </span>
                </div>
              )}

              {/* Prediction Cards */}
              <div className="grid grid-cols-4 gap-1.5">
                {shortTermPredictions.map((p, i) => {
                  const moveFromCurrent = ((p.target_price - currentPrice) / currentPrice * 100);
                  const gradeColor = p.signalQuality === "A+" ? "text-gain" : p.signalQuality === "A" ? "text-gain/80" : p.signalQuality === "B" ? "text-warning" : "text-loss";
                  return (
                    <div key={i} className={`p-2 rounded-lg border text-center space-y-1 transition-all ${p.direction === "up" ? "bg-gain/5 border-gain/20 hover:bg-gain/10" : p.direction === "down" ? "bg-loss/5 border-loss/20 hover:bg-loss/10" : "bg-secondary/40 border-border/30 hover:bg-secondary/60"}`}>
                      <div className="flex items-center justify-between px-0.5">
                        <span className="text-[8px] text-muted-foreground uppercase font-semibold">{p.timeframe}</span>
                        <span className={`text-[7px] font-bold ${gradeColor} bg-secondary/60 px-1 rounded`}>{p.signalQuality}</span>
                      </div>
                      <div className="flex items-center justify-center gap-0.5">
                        {p.direction === "up" ? <TrendingUp className="w-3.5 h-3.5 text-gain" /> : p.direction === "down" ? <TrendingDown className="w-3.5 h-3.5 text-loss" /> : <Minus className="w-3.5 h-3.5 text-muted-foreground" />}
                        <span className={`text-sm font-mono font-bold ${p.direction === "up" ? "text-gain" : p.direction === "down" ? "text-loss" : "text-foreground"}`}>
                          ${p.target_price.toFixed(2)}
                        </span>
                      </div>
                      <div className={`text-[8px] font-mono ${moveFromCurrent >= 0 ? "text-gain" : "text-loss"}`}>
                        {moveFromCurrent >= 0 ? "+" : ""}{moveFromCurrent.toFixed(3)}%
                      </div>
                      <div className="text-[6px] text-muted-foreground font-mono">
                        ${p.target_low.toFixed(2)} — ${p.target_high.toFixed(2)}
                      </div>
                      <div className="w-full h-1.5 bg-secondary rounded-full overflow-hidden">
                        <div className={`h-full rounded-full transition-all duration-500 ${p.confidence >= 70 ? "bg-gain" : p.confidence >= 50 ? "bg-warning" : "bg-loss"}`} style={{ width: `${p.confidence}%` }} />
                      </div>
                      <div className="text-[7px] text-muted-foreground font-mono">{p.confidence}%</div>
                      <div className="flex flex-wrap gap-0.5 justify-center">
                        {p.reasoning.slice(0, 3).map((r, ri) => (
                          <span key={ri} className="text-[5px] px-0.5 py-0.5 rounded bg-secondary/60 text-muted-foreground leading-tight">{r}</span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="text-[10px] text-muted-foreground text-center py-2">Need 20+ candles for micro predictions</div>
          )}
        </div>
      )}

      {/* Prediction Intelligence Card */}
      {showShortTerm && shortTermPredictions.length > 0 && (
        <PredictionIntelligenceCard predictions={shortTermPredictions} symbol={symbol} />
      )}

      {/* Performance Reports */}
      {showReports && <PerformanceReports />}

      {/* Accuracy Stats */}
      {accuracyStats.total > 0 && (
        <div className="space-y-1.5">
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" /> Prediction Accuracy ({accuracyStats.total} strategies)
          </div>
          <AccuracyStatsBar stats={accuracyStats} />
        </div>
      )}

      {/* History Panel */}
      {showHistory && (() => {
        const filteredHistory = history.filter(e =>
          historyAssetFilter === "all" ? true :
          historyAssetFilter === "crypto" ? isCryptoSymbol(e.symbol) :
          !isCryptoSymbol(e.symbol)
        );
        const cryptoCount = history.filter(e => isCryptoSymbol(e.symbol)).length;
        const stockCount = history.length - cryptoCount;
        return (
        <div className="p-3 rounded-md bg-secondary/30 border border-border/50 space-y-2 max-h-72 overflow-y-auto">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              <History className="w-3 h-3" /> Strategy History
            </div>
            <div className="flex items-center gap-0.5 bg-background/50 rounded p-0.5">
              {([
                { k: "all" as const, label: `All ${history.length}` },
                { k: "stocks" as const, label: `🏢 ${stockCount}` },
                { k: "crypto" as const, label: `₿ ${cryptoCount}` },
              ]).map(o => (
                <button
                  key={o.k}
                  onClick={() => setHistoryAssetFilter(o.k)}
                  className={`px-1.5 py-0.5 rounded text-[9px] font-mono transition-colors ${historyAssetFilter === o.k ? "bg-accent/20 text-accent" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          {historyLoading ? (
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground"><Loader2 className="w-3 h-3 animate-spin" /> Loading...</div>
          ) : filteredHistory.length === 0 ? (
            <div className="text-[10px] text-muted-foreground">No {historyAssetFilter === "all" ? "saved" : historyAssetFilter} strategies yet.</div>
          ) : (
            <div className="space-y-1.5">
              {filteredHistory.slice(0, 30).map(entry => {
                const outcomeColor = entry.outcome === "win" ? "text-gain" : entry.outcome === "loss" ? "text-loss" : "text-warning";
                const outcomeBg = entry.outcome === "win" ? "bg-gain/5 border-gain/15" : entry.outcome === "loss" ? "bg-loss/5 border-loss/15" : "bg-secondary/40 border-border/30";
                return (
                  <div key={entry.id} className={`p-2 rounded-md border ${outcomeBg} flex items-center justify-between`}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono font-bold text-foreground">{entry.symbol}</span>
                        <span className={`text-[8px] px-1 py-0.5 rounded font-mono ${outcomeColor} bg-current/5`}>{entry.outcome.toUpperCase()}</span>
                        <span className="text-[8px] text-muted-foreground">{entry.confidence}%</span>
                        {entry.entry_hit && <CheckCircle2 className="w-2.5 h-2.5 text-gain" />}
                      </div>
                      <div className="text-[8px] text-muted-foreground truncate">
                        {entry.strategy_name} · ${entry.current_price_at_gen.toFixed(2)} · {new Date(entry.created_at).toLocaleDateString()}
                        {entry.actual_pnl_pct !== null && <span className={entry.actual_pnl_pct >= 0 ? " text-gain" : " text-loss"}> {entry.actual_pnl_pct >= 0 ? "+" : ""}{entry.actual_pnl_pct.toFixed(2)}%</span>}
                      </div>
                    </div>
                    <button onClick={() => deleteEntry(entry.id)} className="p-1 text-muted-foreground hover:text-loss transition-colors shrink-0">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        );
      })()}

      {/* Run buttons */}
      <div className="flex gap-2">
        <button onClick={runStrategy} disabled={loading} className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-md text-xs font-semibold bg-accent/15 text-accent border border-accent/20 hover:bg-accent/25 transition-all disabled:opacity-40 hover:shadow-[0_0_12px_hsl(var(--accent)/0.15)]">
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Brain className="w-3.5 h-3.5" />}
          {loading ? "Analyzing..." : "Generate Strategy"}
        </button>
        {strategy && (
          <button onClick={() => saveStrategy(strategy, symbol, currentPrice, selectedPreset)} className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-md text-xs font-semibold bg-gain/15 text-gain border border-gain/20 hover:bg-gain/25 transition-all">
            <Save className="w-3.5 h-3.5" /> Save
          </button>
        )}
        <button onClick={onRunBacktest} disabled={!strategy || backtestRunning} className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-md text-xs font-semibold bg-primary/15 text-primary border border-primary/20 hover:bg-primary/25 transition-all disabled:opacity-40">
          {backtestRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
          {backtestRunning ? "Running..." : "Backtest"}
        </button>
      </div>

      {/* Strategy Results */}
      {strategy && bias && (
        <div className="space-y-3">
          {/* Bias Header */}
          <div className={`p-3 rounded-lg border ${bias.bgClass} flex items-center justify-between`}>
            <div>
              <div className="text-[10px] text-muted-foreground font-mono mb-0.5">{strategy.strategy_name}</div>
              <div className={`flex items-center gap-1.5 text-lg font-bold ${bias.colorClass}`}>
                <BiasIcon className="w-5 h-5" />
                {bias.label}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[9px] text-muted-foreground">Confidence</div>
              <div className={`text-2xl font-mono font-bold ${bias.colorClass}`}>{strategy.confidence}%</div>
            </div>
          </div>

          {/* Indicator Gauges */}
          <div className="grid grid-cols-5 gap-1 p-2 rounded-md bg-secondary/30 border border-border/50">
            <GaugeIndicator value={strategy.indicators.trend_strength} max={100} label="Trend" color={strategy.indicators.trend_strength > 50 ? "hsl(145, 80%, 42%)" : "hsl(0, 72%, 51%)"} />
            <GaugeIndicator value={Math.abs(strategy.indicators.momentum_score)} max={100} label="Momentum" color={strategy.indicators.momentum_score > 0 ? "hsl(145, 80%, 42%)" : "hsl(0, 72%, 51%)"} />
            <GaugeIndicator value={strategy.risk_assessment.win_probability} max={100} label="Win %" suffix="%" color={strategy.risk_assessment.win_probability > 55 ? "hsl(145, 80%, 42%)" : "hsl(40, 96%, 53%)"} />
            <GaugeIndicator value={strategy.risk_assessment.risk_reward_ratio} max={5} label="R:R" suffix="x" color="hsl(200, 95%, 60%)" />
            <GaugeIndicator value={strategy.indicators.rsi || 50} max={100} label="RSI" color={
              (strategy.indicators.rsi || 50) > 70 ? "hsl(0, 72%, 51%)" :
              (strategy.indicators.rsi || 50) < 30 ? "hsl(145, 80%, 42%)" : "hsl(40, 96%, 53%)"
            } />
          </div>

          {/* Extended Indicators */}
          {(strategy.indicators.sma10 || strategy.indicators.atr) && (
            <div className="grid grid-cols-3 gap-2 text-[10px] font-mono">
              {strategy.indicators.sma10 && (
                <div className="p-1.5 rounded bg-secondary/40 border border-border/30 text-center">
                  <div className="text-[7px] text-muted-foreground uppercase">SMA10</div>
                  <div className={currentPrice > strategy.indicators.sma10 ? "text-gain" : "text-loss"}>${strategy.indicators.sma10.toFixed(2)}</div>
                </div>
              )}
              {strategy.indicators.sma20 && (
                <div className="p-1.5 rounded bg-secondary/40 border border-border/30 text-center">
                  <div className="text-[7px] text-muted-foreground uppercase">SMA20</div>
                  <div className={currentPrice > strategy.indicators.sma20 ? "text-gain" : "text-loss"}>${strategy.indicators.sma20.toFixed(2)}</div>
                </div>
              )}
              {strategy.indicators.atr && (
                <div className="p-1.5 rounded bg-secondary/40 border border-border/30 text-center">
                  <div className="text-[7px] text-muted-foreground uppercase">ATR</div>
                  <div className="text-foreground">${strategy.indicators.atr.toFixed(2)}</div>
                </div>
              )}
            </div>
          )}

          {/* Visual Price Zone Map */}
          {currentPrice > 0 && strategy.signals.length > 0 && (
            <div>
              <div className="text-[9px] uppercase tracking-wider text-muted-foreground flex items-center gap-1 mb-1.5">
                <Crosshair className="w-3 h-3" /> Price Zone Map — Exact Entry/Exit Levels
              </div>
              <PriceZoneMap
                signals={strategy.signals}
                currentPrice={currentPrice}
                support={strategy.indicators.support_levels}
                resistance={strategy.indicators.resistance_levels}
                klines={klines}
              />
            </div>
          )}

          {/* Volatility */}
          <div className="flex items-center gap-2 p-2 rounded-md bg-secondary/30 border border-border/50">
            <BarChart3 className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground">Volatility:</span>
            <span className={`text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded ${
              strategy.indicators.volatility_regime === "high" || strategy.indicators.volatility_regime === "extreme" ? "bg-loss/10 text-loss" :
              strategy.indicators.volatility_regime === "low" ? "bg-gain/10 text-gain" : "bg-warning/10 text-warning"
            }`}>{strategy.indicators.volatility_regime.toUpperCase()}</span>
            {strategy.indicators.relative_volume && (
              <>
                <span className="text-[10px] text-muted-foreground ml-2">Rel Vol:</span>
                <span className={`text-[10px] font-mono font-semibold ${strategy.indicators.relative_volume > 2 ? "text-gain" : "text-foreground"}`}>
                  {strategy.indicators.relative_volume}x
                </span>
              </>
            )}
          </div>

          {/* Trade Signals with P&L Calc */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                <Zap className="w-3 h-3" /> Exact Trade Signals ({strategy.signals.length})
              </div>
              <button onClick={() => setPinnedSignals(!pinnedSignals)} className={`p-1 rounded transition-colors ${pinnedSignals ? "text-accent" : "text-muted-foreground hover:text-foreground"}`} title={pinnedSignals ? "Unpin signals" : "Pin signals to top"}>
                <Pin className="w-3 h-3" />
              </button>
            </div>
            {strategy.signals.map((sig, i) => {
              const isBuy = sig.action === "buy";
              const distToEntry = currentPrice > 0 ? ((sig.entry_price - currentPrice) / currentPrice * 100) : 0;
              const distToTP = currentPrice > 0 ? ((sig.take_profit - currentPrice) / currentPrice * 100) : 0;
              const distToSL = currentPrice > 0 ? ((sig.stop_loss - currentPrice) / currentPrice * 100) : 0;
              const riskPct = Math.abs((sig.entry_price - sig.stop_loss) / sig.entry_price * 100);
              const rewardPct = Math.abs((sig.take_profit - sig.entry_price) / sig.entry_price * 100);
              const rr = riskPct > 0 ? (rewardPct / riskPct) : 0;

              // Live position tracking
              const entryNear = Math.abs(distToEntry) < 0.5;
              const tpNear = Math.abs(distToTP) < 0.5;
              const slNear = Math.abs(distToSL) < 1;

              // Progress bar: how far price has moved from entry toward TP vs SL
              const entryToTP = sig.take_profit - sig.entry_price;
              const currentFromEntry = currentPrice - sig.entry_price;
              const progressPct = entryToTP !== 0 ? Math.max(-100, Math.min(100, (currentFromEntry / entryToTP) * 100)) : 0;

              return (
                <div key={i} className={`rounded-lg border overflow-hidden ${isBuy ? "bg-gain/5 border-gain/15" : sig.action === "sell" ? "bg-loss/5 border-loss/15" : "bg-secondary/50 border-border"} ${entryNear ? "ring-1 ring-accent/50" : ""}`}>
                  {/* Urgency banner */}
                  {entryNear && (
                    <div className="px-2.5 py-1 bg-accent/15 border-b border-accent/20 flex items-center gap-1.5 animate-pulse">
                      <Zap className="w-3 h-3 text-accent" />
                      <span className="text-[9px] font-bold text-accent">APPROACHING ENTRY — {Math.abs(distToEntry).toFixed(2)}% away</span>
                    </div>
                  )}
                  {slNear && !entryNear && (
                    <div className="px-2.5 py-1 bg-loss/15 border-b border-loss/20 flex items-center gap-1.5">
                      <AlertTriangle className="w-3 h-3 text-loss" />
                      <span className="text-[9px] font-bold text-loss">NEAR STOP LOSS — {Math.abs(distToSL).toFixed(2)}% away</span>
                    </div>
                  )}

                  {/* Signal Header */}
                  <div className="p-2.5 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {isBuy ? <TrendingUp className="w-4 h-4 text-gain" /> : sig.action === "sell" ? <TrendingDown className="w-4 h-4 text-loss" /> : <Minus className="w-4 h-4 text-warning" />}
                        <span className={`font-bold text-sm ${isBuy ? "text-gain" : sig.action === "sell" ? "text-loss" : "text-warning"}`}>
                          {sig.action.toUpperCase()}
                        </span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground font-mono">{sig.timeframe}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${rr >= 2 ? "bg-gain/10 text-gain" : rr >= 1.5 ? "bg-warning/10 text-warning" : "bg-loss/10 text-loss"}`}>
                          {rr.toFixed(1)}:1 R:R
                        </span>
                        <span className="text-[9px] font-mono text-muted-foreground">{sig.position_size_pct}% size</span>
                      </div>
                    </div>

                    {/* Price Levels Grid with live distances */}
                    <div className="grid grid-cols-3 gap-2 font-mono text-[11px]">
                      <div className={`p-2 rounded-md border ${entryNear ? "bg-accent/10 border-accent/30" : "bg-background/60 border-border/30"}`}>
                        <div className="text-[8px] text-accent/70 uppercase mb-0.5">ENTRY PRICE</div>
                        <div className="text-foreground font-bold text-sm">${sig.entry_price.toFixed(2)}</div>
                        <div className={`text-[8px] mt-0.5 ${entryNear ? "text-accent font-bold" : Math.abs(distToEntry) < 1 ? "text-gain" : "text-muted-foreground"}`}>
                          {distToEntry > 0 ? "+" : ""}{distToEntry.toFixed(2)}% away
                        </div>
                      </div>
                      <div className={`p-2 rounded-md border ${slNear ? "bg-loss/15 border-loss/30" : "bg-loss/5 border-loss/10"}`}>
                        <div className="text-[8px] text-loss/70 uppercase mb-0.5">STOP LOSS</div>
                        <div className="text-loss font-bold text-sm">${sig.stop_loss.toFixed(2)}</div>
                        <div className="text-[8px] text-loss/60 mt-0.5">
                          {distToSL > 0 ? "+" : ""}{distToSL.toFixed(2)}% ({riskPct.toFixed(1)}% risk)
                        </div>
                      </div>
                      <div className={`p-2 rounded-md border ${tpNear ? "bg-gain/15 border-gain/30" : "bg-gain/5 border-gain/10"}`}>
                        <div className="text-[8px] text-gain/70 uppercase mb-0.5">TAKE PROFIT</div>
                        <div className="text-gain font-bold text-sm">${sig.take_profit.toFixed(2)}</div>
                        <div className="text-[8px] text-gain/60 mt-0.5">
                          {distToTP > 0 ? "+" : ""}{distToTP.toFixed(2)}% ({rewardPct.toFixed(1)}% reward)
                        </div>
                      </div>
                    </div>

                    {/* Live progress bar: SL ← Entry → TP */}
                    <div className="space-y-0.5">
                      <div className="flex items-center justify-between text-[7px] font-mono text-muted-foreground">
                        <span className="text-loss">SL</span>
                        <span className="text-foreground">Price Position</span>
                        <span className="text-gain">TP</span>
                      </div>
                      <div className="h-2 bg-secondary/60 rounded-full overflow-hidden relative border border-border/30">
                        <div className="absolute inset-y-0 left-0 w-1/2 bg-loss/10" />
                        <div className="absolute inset-y-0 right-0 w-1/2 bg-gain/10" />
                        <div
                          className={`absolute top-0 h-full w-1 rounded-full ${progressPct >= 0 ? "bg-gain" : "bg-loss"}`}
                          style={{ left: `${Math.max(2, Math.min(98, 50 + progressPct * 0.5))}%`, transition: "left 0.5s ease" }}
                        />
                        {/* Center mark (entry) */}
                        <div className="absolute top-0 left-1/2 h-full w-px bg-foreground/30" />
                      </div>
                    </div>

                    {/* Reason */}
                    <div className="text-[10px] text-muted-foreground leading-relaxed">{sig.reason}</div>

                    {/* Trade Quality Badge */}
                    <div className="flex items-center gap-2 flex-wrap">
                      {rr >= 2 ? (
                        <span className="flex items-center gap-1 text-[9px] text-gain bg-gain/10 px-2 py-0.5 rounded-full">
                          <CheckCircle2 className="w-3 h-3" /> High-quality setup
                        </span>
                      ) : rr >= 1.5 ? (
                        <span className="flex items-center gap-1 text-[9px] text-warning bg-warning/10 px-2 py-0.5 rounded-full">
                          <AlertTriangle className="w-3 h-3" /> Moderate setup
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-[9px] text-loss bg-loss/10 px-2 py-0.5 rounded-full">
                          <AlertTriangle className="w-3 h-3" /> Weak R:R
                        </span>
                      )}
                      {entryNear && (
                        <span className="flex items-center gap-1 text-[9px] text-accent bg-accent/10 px-2 py-0.5 rounded-full animate-pulse">
                          <Crosshair className="w-3 h-3" /> Entry zone active
                        </span>
                      )}
                      <button onClick={() => setExpandedSignal(expandedSignal === i ? null : i)} className="text-[9px] text-accent hover:underline flex items-center gap-0.5">
                        <Calculator className="w-3 h-3" />
                        {expandedSignal === i ? "Hide P&L" : "P&L Calc"}
                      </button>
                    </div>
                  </div>

                  {/* P&L Calculator (expandable) */}
                  {expandedSignal === i && <SignalPnLCalc signal={sig} currentPrice={currentPrice} />}
                </div>
              );
            })}
          </div>

          {/* Adaptive Risk Profile */}
          <AdaptiveRiskCard symbol={symbol} currentPrice={currentPrice} strategy={strategy} tickers={tickers} klines={klines} onRiskParamsChange={onRiskParamsChange} />

          {/* AI Reasoning */}
          <button onClick={() => setShowReasoning(!showReasoning)} className="flex items-center justify-between w-full py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors">
            <span className="flex items-center gap-1"><Brain className="w-3 h-3" /> AI Reasoning ({strategy.reasoning.length})</span>
            {showReasoning ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          {showReasoning && (
            <div className="space-y-1 pl-1">
              {strategy.reasoning.map((r, i) => (
                <div key={i} className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                  <span className="text-accent/60 mt-0.5 shrink-0">▸</span>
                  <span>{r}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!strategy && !loading && (
        <div className="text-center py-6">
          <Brain className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
          <div className="text-xs text-muted-foreground">
            Select a preset and click <span className="text-accent font-semibold">Generate Strategy</span> to analyze <span className="font-mono text-foreground">{symbol}</span>
          </div>
        </div>
      )}
    </div>
  );
}
