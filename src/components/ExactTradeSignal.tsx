import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { TickerData } from "@/hooks/useWebullData";
import { TrendingUp, TrendingDown, Minus, Activity, RefreshCw, Loader2, Target, Clock, Shield, Zap, AlertTriangle, CheckCircle2, Timer, ToggleLeft, ToggleRight, Rocket, Volume2, VolumeX, Bell, BellOff, Clipboard, ClipboardCheck } from "lucide-react";
import { WebullCopyPanel } from "./WebullCopyPanel";
import { supabase } from "@/integrations/supabase/client";
import { invokeAlpacaTrade } from "@/lib/alpacaAccount";
import { toast } from "sonner";
import { generateShortTermPredictions, ShortTermPrediction, getPredictionAccuracy, recordPrediction, resolvePredictions } from "@/lib/microPredictions";
import { useSignalAlerts, getSignalFreshness } from "@/hooks/useSignalAlerts";

export interface TradeSignalExecution {
  side: "long" | "short";
  stopLoss: number;
  takeProfit: number;
}

interface ExactTradeSignalProps {
  tickers: Record<string, TickerData>;
  selectedSymbol: string;
  klines: Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }>;
  currentPrice: number;
  onExecuteTrade?: (exec: TradeSignalExecution) => void;
  alpacaMode?: "paper" | "live";
  onAlpacaModeChange?: (mode: "paper" | "live") => void;
}

type Signal = "strong_buy" | "buy" | "neutral" | "sell" | "strong_sell";

interface AISignal {
  signal: Signal;
  confidence: number;
  reasons: string[];
  rsi_estimate: number;
  trend: "bullish" | "bearish" | "sideways";
  key_levels: { support: number; resistance: number };
  suggested_stop_loss_pct?: number;
  suggested_take_profit_pct?: number;
  risk_reward_ratio?: number;
  entry_quality?: string;
  analysis_mode?: string;
}

const signalConfig: Record<Signal, { label: string; colorClass: string; bgClass: string; action: string }> = {
  strong_buy: { label: "STRONG BUY", colorClass: "text-gain", bgClass: "bg-gain/10 border-gain/30", action: "BUY NOW" },
  buy: { label: "BUY", colorClass: "text-gain", bgClass: "bg-gain/10 border-gain/20", action: "BUY" },
  neutral: { label: "HOLD", colorClass: "text-warning", bgClass: "bg-warning/10 border-warning/20", action: "WAIT" },
  sell: { label: "SELL", colorClass: "text-loss", bgClass: "bg-loss/10 border-loss/20", action: "SELL" },
  strong_sell: { label: "STRONG SELL", colorClass: "text-loss", bgClass: "bg-loss/10 border-loss/30", action: "SELL NOW" },
};

// Direct Alpaca execution sub-component
function ExecuteTradeSection({
  unified, config, selectedSymbol, currentPrice, alpacaMode, onAlpacaModeChange, onExecuteTrade,
}: {
  unified: any; config: any; selectedSymbol: string; currentPrice: number;
  alpacaMode: "paper" | "live";
  onAlpacaModeChange?: (mode: "paper" | "live") => void;
  onExecuteTrade?: (exec: TradeSignalExecution) => void;
}) {
  const [executing, setExecuting] = useState(false);
  const [showLiveConfirm, setShowLiveConfirm] = useState(false);
  const [liveConfirmText, setLiveConfirmText] = useState("");

  const side = unified.direction === "up" ? "buy" : "sell";
  const isBuy = unified.signal.includes("buy");

  const executeAlpacaOrder = async () => {
    if (alpacaMode === "live" && !showLiveConfirm) {
      setShowLiveConfirm(true);
      return;
    }
    if (alpacaMode === "live" && liveConfirmText !== "CONFIRM") {
      toast.error("Type CONFIRM to place a live order");
      return;
    }

    setExecuting(true);
    try {
      // Calculate qty based on 5% of buying power or $500 min
      const accRes = await invokeAlpacaTrade({
        body: { action: "account", mode: alpacaMode },
      });
      if (accRes.error || accRes.data?.error) throw new Error(accRes.data?.error || "Failed to get account");

      const buyingPower = parseFloat(accRes.data.buying_power);
      const positionSize = Math.max(500, buyingPower * 0.05);
      const qty = Math.max(1, Math.floor(positionSize / currentPrice));

      const orderBody: any = {
        action: "order",
        symbol: selectedSymbol,
        qty,
        side,
        type: "market",
        time_in_force: "day",
        order_class: "bracket",
        take_profit: unified.takeProfit.toFixed(2),
        stop_loss: unified.stopLoss.toFixed(2),
        mode: alpacaMode,
      };

      const res = await invokeAlpacaTrade({ body: orderBody });
      if (res.error || res.data?.error) throw new Error(res.data?.error || "Order failed");
      if (res.data?.skipped) {
        toast.info(`Alpaca skipped ${selectedSymbol}: ${res.data.message || res.data.reason || "order not supported"}`);
        return;
      }

      toast.success(
        `${alpacaMode.toUpperCase()} bracket order placed: ${side.toUpperCase()} ${qty} ${selectedSymbol} @ ~$${currentPrice.toFixed(2)}`,
        { description: `TP: $${unified.takeProfit.toFixed(2)} | SL: $${unified.stopLoss.toFixed(2)}` }
      );
      setShowLiveConfirm(false);
      setLiveConfirmText("");
    } catch (err: any) {
      toast.error(`Alpaca order failed: ${err.message}`);
    } finally {
      setExecuting(false);
    }
  };

  const [buyingPower, setBuyingPower] = useState<number>(10000);

  // Fetch buying power for position sizing
  useEffect(() => {
    (async () => {
      try {
        const res = await invokeAlpacaTrade({
          body: { action: "account", mode: alpacaMode },
        });
        if (res.data?.buying_power) setBuyingPower(parseFloat(res.data.buying_power));
      } catch {}
    })();
  }, [alpacaMode]);

  return (
    <div className="space-y-2">
      {/* Mode Toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => onAlpacaModeChange?.(alpacaMode === "paper" ? "live" : "paper")}
            className="flex items-center gap-1 text-[10px] font-mono"
          >
            {alpacaMode === "paper" ? (
              <ToggleLeft className="w-4 h-4 text-primary" />
            ) : (
              <ToggleRight className="w-4 h-4 text-gain" />
            )}
            <span className={alpacaMode === "live" ? "text-gain font-bold" : "text-muted-foreground"}>
              {alpacaMode === "live" ? "LIVE" : "PAPER"}
            </span>
          </button>
          {alpacaMode === "live" && (
            <span className="text-[8px] px-1 py-0.5 rounded bg-loss/10 text-loss font-bold animate-pulse">REAL MONEY</span>
          )}
        </div>
      </div>

      {/* Live confirmation gate */}
      {showLiveConfirm && alpacaMode === "live" && (
        <div className="bg-loss/5 border border-loss/20 rounded-lg p-3 space-y-2">
          <div className="flex items-center gap-2 text-[10px] text-loss font-bold">
            <AlertTriangle className="w-3.5 h-3.5" />
            LIVE ORDER — Real money will be used
          </div>
          <div className="text-[9px] text-muted-foreground">
            {side.toUpperCase()} {selectedSymbol} with bracket TP/SL. Type <span className="font-bold text-foreground">CONFIRM</span> to proceed.
          </div>
          <input
            value={liveConfirmText}
            onChange={e => setLiveConfirmText(e.target.value.toUpperCase())}
            placeholder="Type CONFIRM"
            className="w-full bg-secondary/50 border border-border rounded px-2 py-1 text-xs font-mono text-foreground placeholder:text-muted-foreground/50"
          />
          <div className="flex gap-2">
            <button
              onClick={executeAlpacaOrder}
              disabled={liveConfirmText !== "CONFIRM" || executing}
              className="flex-1 py-1.5 rounded text-[10px] font-bold bg-loss/20 text-loss border border-loss/30 hover:bg-loss/30 disabled:opacity-40 transition-all"
            >
              {executing ? <Loader2 className="w-3 h-3 animate-spin mx-auto" /> : "PLACE LIVE ORDER"}
            </button>
            <button
              onClick={() => { setShowLiveConfirm(false); setLiveConfirmText(""); }}
              className="px-3 py-1.5 rounded text-[10px] bg-secondary text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Main Execute Buttons */}
      {!showLiveConfirm && (
        <div className="flex gap-2">
          {/* Alpaca Direct Execute */}
          <button
            onClick={executeAlpacaOrder}
            disabled={executing}
            className={`flex-1 py-2.5 rounded-lg font-bold text-sm transition-all flex items-center justify-center gap-2 ${
              isBuy
                ? "bg-gain/20 text-gain border border-gain/30 hover:bg-gain/30"
                : "bg-loss/20 text-loss border border-loss/30 hover:bg-loss/30"
            }`}
          >
            {executing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Rocket className="w-4 h-4" />
            )}
            {alpacaMode === "live" ? "LIVE" : "Alpaca"} {config.action}
          </button>

          {/* Paper Trade (OrderPanel prefill) */}
          {onExecuteTrade && (
            <button
              onClick={() => onExecuteTrade({
                side: unified.direction === "up" ? "long" : "short",
                stopLoss: unified.stopLoss,
                takeProfit: unified.takeProfit,
              })}
              className="px-4 py-2.5 rounded-lg text-xs font-medium bg-secondary text-muted-foreground border border-border hover:text-foreground hover:bg-secondary/80 transition-all flex items-center gap-1.5"
            >
              <Zap className="w-3.5 h-3.5" />
              Prefill
            </button>
          )}
        </div>
      )}

      {/* Order Summary */}
      <div className="text-[8px] font-mono text-muted-foreground/50 text-center">
        Bracket: {side.toUpperCase()} @ ~${currentPrice.toFixed(2)} · TP ${unified.takeProfit.toFixed(2)} · SL ${unified.stopLoss.toFixed(2)}
      </div>

      {/* Enhanced Webull Copy Panel */}
      <WebullCopyPanel
        symbol={selectedSymbol}
        side={side}
        entry={currentPrice}
        tp={unified.takeProfit}
        sl={unified.stopLoss}
        tpPct={unified.tpPct}
        slPct={unified.slPct}
        rr={unified.riskReward}
        confidence={unified.confidence}
        grade={unified.grade || "B"}
        reasons={unified.reasons || []}
        trend={unified.trend || "sideways"}
        rsi={unified.rsi || 50}
        urgency={unified.urgency || "WATCH"}
        buyingPower={buyingPower}
      />
    </div>
  );
}

// Track price velocity for momentum detection
function usePriceVelocity(price: number) {
  const histRef = useRef<{ price: number; time: number }[]>([]);

  useEffect(() => {
    if (price > 0) {
      histRef.current.push({ price, time: Date.now() });
      if (histRef.current.length > 30) histRef.current = histRef.current.slice(-30);
    }
  }, [price]);

  return useMemo(() => {
    const h = histRef.current;
    if (h.length < 3) return { velocity: 0, acceleration: 0, direction: "stable" as const };
    const last = h[h.length - 1];
    const prev = h[h.length - 2];
    const prev2 = h[h.length - 3];
    const dt1 = (last.time - prev.time) / 1000 || 1;
    const dt2 = (prev.time - prev2.time) / 1000 || 1;
    const v1 = (last.price - prev.price) / dt1;
    const v2 = (prev.price - prev2.price) / dt2;
    const velocity = v1;
    const acceleration = (v1 - v2) / ((dt1 + dt2) / 2);
    const direction = velocity > 0.001 ? "rising" as const : velocity < -0.001 ? "falling" as const : "stable" as const;
    return { velocity, acceleration, direction };
  }, [price]);
}

export function ExactTradeSignal({ tickers, selectedSymbol, klines, currentPrice, onExecuteTrade, alpacaMode = "paper", onAlpacaModeChange }: ExactTradeSignalProps) {
  const [aiSignal, setAiSignal] = useState<AISignal | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastAnalyzed, setLastAnalyzed] = useState<string>("");
  const [signalAge, setSignalAge] = useState(0);
  const [prevSignal, setPrevSignal] = useState<Signal | null>(null);
  const [showAlertConfig, setShowAlertConfig] = useState(false);
  const ticker = tickers[selectedSymbol];
  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const signalTimestampRef = useRef(0);
  const priceVelocity = usePriceVelocity(currentPrice);
  const { fireAlert, updateConfig, getConfig, requestPermission } = useSignalAlerts();
  const [alertConfig, setAlertConfig] = useState(getConfig);
  const lastFiredSignalRef = useRef<string>("");

  // Generate micro-predictions
  const predictions = useMemo(() => {
    if (klines.length < 20 || currentPrice <= 0) return [];
    return generateShortTermPredictions(klines, currentPrice);
  }, [klines, currentPrice]);

  // Record & resolve predictions
  useEffect(() => {
    if (currentPrice > 0) resolvePredictions(currentPrice);
  }, [currentPrice]);

  useEffect(() => {
    if (predictions.length > 0) {
      for (const p of predictions) {
        recordPrediction(p, currentPrice);
      }
    }
  }, [predictions.length > 0 ? predictions[0]?.generatedAt : 0]);

  const accuracy = useMemo(() => getPredictionAccuracy(), [predictions]);

  // Primary prediction (2-min timeframe for actionable trades)
  const primary = predictions[1] || predictions[0];

  // Signal age tracking — 1s precision for freshness
  useEffect(() => {
    const interval = setInterval(() => {
      if (signalTimestampRef.current > 0) {
        setSignalAge(Math.floor((Date.now() - signalTimestampRef.current) / 1000));
      }
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const analyzeMarket = useCallback(async () => {
    if (!ticker || loading) return;
    setLoading(true);

    const price = parseFloat(ticker.price);
    const high = parseFloat(ticker.high);
    const low = parseFloat(ticker.low);
    const range = high - low;
    const rangePosition = range > 0 ? ((price - low) / range * 100).toFixed(1) : "50";

    try {
      const { data, error } = await supabase.functions.invoke("analyze-market", {
        body: {
          marketData: {
            symbol: ticker.symbol,
            price: ticker.price,
            priceChangePercent: ticker.priceChangePercent,
            high: ticker.high,
            low: ticker.low,
            quoteVolume: ticker.volume || "0",
            rangePosition,
          },
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      
      // Track signal changes
      if (aiSignal && data.signal !== aiSignal.signal) {
        setPrevSignal(aiSignal.signal);
      }
      
      setAiSignal(data);
      setLastAnalyzed(new Date().toLocaleTimeString());
      signalTimestampRef.current = Date.now();
      setSignalAge(0);
    } catch (err) {
      console.error("AI analysis failed:", err);
    } finally {
      setLoading(false);
    }
  }, [ticker, loading, aiSignal]);

  // Initial analysis on symbol change
  useEffect(() => {
    if (ticker && !aiSignal) {
      const timeout = setTimeout(analyzeMarket, 800);
      return () => clearTimeout(timeout);
    }
  }, [selectedSymbol, !!ticker]);

  useEffect(() => {
    setAiSignal(null);
    setPrevSignal(null);
    signalTimestampRef.current = 0;
  }, [selectedSymbol]);

  // Auto-refresh every 45 seconds for faster signal updates
  useEffect(() => {
    autoRefreshRef.current = setInterval(() => {
      if (ticker && !loading) analyzeMarket();
    }, 45_000);
    return () => { if (autoRefreshRef.current) clearInterval(autoRefreshRef.current); };
  }, [ticker, loading, analyzeMarket]);

  // Multi-timeframe agreement score
  const mtfAgreement = useMemo(() => {
    if (predictions.length < 3) return { score: 0, aligned: false, label: "N/A" };
    const dirs = predictions.map(p => p.direction);
    const upCount = dirs.filter(d => d === "up").length;
    const downCount = dirs.filter(d => d === "down").length;
    const majorityUp = upCount >= 3;
    const majorityDown = downCount >= 3;
    const aligned = majorityUp || majorityDown;
    const score = aligned ? Math.max(upCount, downCount) / dirs.length * 100 : 0;
    return {
      score: Math.round(score),
      aligned,
      label: majorityUp ? "ALL UP" : majorityDown ? "ALL DOWN" : upCount === downCount ? "SPLIT" : "MIXED",
    };
  }, [predictions]);

  // Merge AI signal + micro-prediction into unified verdict
  const unified = useMemo(() => {
    if (!primary && !aiSignal) return null;

    let direction: "up" | "down" | "flat" = "flat";
    let confidence = 50;
    let signal: Signal = "neutral";

    // Dynamic weighting: boost prediction weight when accuracy is good
    const predWeight = accuracy.rate > 55 ? 0.65 : accuracy.rate > 45 ? 0.55 : 0.5;
    const aiWeight = 1 - predWeight;

    if (primary && aiSignal) {
      const aiDir = aiSignal.signal.includes("buy") ? 1 : aiSignal.signal.includes("sell") ? -1 : 0;
      const predDir = primary.direction === "up" ? 1 : primary.direction === "down" ? -1 : 0;
      const merged = aiDir * aiWeight + predDir * predWeight;
      
      // MTF agreement boost
      const mtfBoost = mtfAgreement.aligned ? 0.15 : 0;
      const adjustedMerge = merged + (Math.sign(merged) * mtfBoost);
      
      direction = adjustedMerge > 0.15 ? "up" : adjustedMerge < -0.15 ? "down" : "flat";
      confidence = Math.round(aiSignal.confidence * aiWeight + primary.confidence * predWeight);

      // Agreement bonus
      if (aiDir === predDir && aiDir !== 0) {
        confidence = Math.min(95, confidence + 12);
        if (mtfAgreement.aligned) confidence = Math.min(95, confidence + 5);
        signal = aiDir > 0 ? (confidence >= 75 ? "strong_buy" : "buy") : (confidence >= 75 ? "strong_sell" : "sell");
      } else if (aiDir !== 0 && predDir !== 0 && aiDir !== predDir) {
        confidence = Math.max(25, confidence - 18);
        signal = "neutral"; // Conflicting signals = hold
      } else {
        signal = direction === "up" ? "buy" : direction === "down" ? "sell" : "neutral";
      }
    } else if (primary) {
      direction = primary.direction;
      confidence = primary.confidence;
      if (mtfAgreement.aligned) confidence = Math.min(95, confidence + 8);
      signal = direction === "up" ? (confidence >= 70 ? "strong_buy" : "buy") : direction === "down" ? (confidence >= 70 ? "strong_sell" : "sell") : "neutral";
    } else if (aiSignal) {
      direction = aiSignal.signal.includes("buy") ? "up" : aiSignal.signal.includes("sell") ? "down" : "flat";
      confidence = aiSignal.confidence;
      signal = aiSignal.signal;
    }

    // Price velocity adjustment
    if (priceVelocity.direction === "rising" && direction === "up") {
      confidence = Math.min(95, confidence + 3);
    } else if (priceVelocity.direction === "falling" && direction === "down") {
      confidence = Math.min(95, confidence + 3);
    } else if (priceVelocity.direction === "rising" && direction === "down") {
      confidence = Math.max(20, confidence - 5);
    } else if (priceVelocity.direction === "falling" && direction === "up") {
      confidence = Math.max(20, confidence - 5);
    }

    // Calculate exact price levels
    const entryPrice = currentPrice;
    const slPct = aiSignal?.suggested_stop_loss_pct || (primary ? Math.max(0.5, Math.abs(currentPrice - primary.target_low) / currentPrice * 100) : 2);
    const tpPct = aiSignal?.suggested_take_profit_pct || (primary ? Math.max(1, Math.abs(primary.target_high - currentPrice) / currentPrice * 100) : 4);
    const stopLoss = direction === "up" ? currentPrice * (1 - slPct / 100) : currentPrice * (1 + slPct / 100);
    const takeProfit = direction === "up" ? currentPrice * (1 + tpPct / 100) : currentPrice * (1 - tpPct / 100);
    const rr = slPct > 0 ? tpPct / slPct : 0;

    // Urgency: how quickly should you act?
    const urgency = confidence >= 80 && mtfAgreement.aligned ? "NOW" :
                    confidence >= 65 ? "SOON" :
                    confidence >= 50 ? "WATCH" : "WAIT";

    return {
      signal,
      direction,
      confidence,
      entryPrice,
      stopLoss,
      takeProfit,
      slPct,
      tpPct,
      riskReward: rr,
      targetPrice: primary?.target_price || (direction === "up" ? takeProfit : stopLoss),
      grade: primary?.signalQuality || (confidence >= 70 ? "A" : confidence >= 50 ? "B" : "C"),
      reasons: [
        ...(aiSignal?.reasons?.slice(0, 3) || []),
        ...(primary?.reasoning?.slice(0, 3) || []),
      ],
      support: aiSignal?.key_levels?.support || (primary?.target_low ?? currentPrice * 0.98),
      resistance: aiSignal?.key_levels?.resistance || (primary?.target_high ?? currentPrice * 1.02),
      trend: aiSignal?.trend || (direction === "up" ? "bullish" : direction === "down" ? "bearish" : "sideways"),
      rsi: aiSignal?.rsi_estimate || primary?.indicators?.microRsi || 50,
      mode: aiSignal?.analysis_mode || "prediction",
      regime: primary?.intelligence?.regime,
      urgency,
      mtfAligned: mtfAgreement.aligned,
      signalChanged: prevSignal !== null && prevSignal !== signal,
    };
  }, [primary, aiSignal, currentPrice, mtfAgreement, priceVelocity, accuracy.rate, prevSignal]);

  // Fire alerts when signal changes or new actionable signal appears
  useEffect(() => {
    if (!unified || unified.signal === "neutral") return;
    const key = `${selectedSymbol}-${unified.signal}-${unified.confidence}`;
    if (key === lastFiredSignalRef.current) return;
    lastFiredSignalRef.current = key;

    const riskPctSaved = Number(localStorage.getItem("trade_risk_pct") || "2");
    const slDist = Math.abs(unified.entryPrice - unified.stopLoss);
    const riskAmt = 10000 * (riskPctSaved / 100);
    const qty = slDist > 0 ? Math.max(1, Math.floor(riskAmt / slDist)) : 1;

    fireAlert({
      signal: unified.signal,
      confidence: unified.confidence,
      symbol: selectedSymbol,
      side: unified.direction === "up" ? "buy" : "sell",
      entryPrice: unified.entryPrice,
      tp: unified.takeProfit,
      sl: unified.stopLoss,
      qty,
      urgency: unified.urgency,
      grade: unified.grade || "B",
    });
  }, [unified?.signal, unified?.confidence, selectedSymbol]);

  // Auto-refresh when signal goes stale (>90s)
  useEffect(() => {
    if (signalAge >= 90 && !loading && ticker) {
      analyzeMarket();
    }
  }, [signalAge >= 90]);

  const freshness = getSignalFreshness(signalAge);

  if (!ticker) {
    return (
      <div className="bg-card rounded-lg border border-border p-4">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Target className="w-4 h-4 text-primary" />
          Exact Trade Signal
        </h3>
        <div className="text-xs text-muted-foreground animate-pulse">Waiting for data...</div>
      </div>
    );
  }

  const config = unified ? signalConfig[unified.signal] : null;

  return (
    <div className="bg-card rounded-lg border border-border p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Target className="w-4 h-4 text-primary" />
          Exact Trade Signal
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-mono">
            {unified?.mode === "ai" ? "AI+PRED" : unified?.mode === "fallback" ? "FALLBACK+PRED" : "PRED ENGINE"}
          </span>
          {unified?.mtfAligned && (
            <span className="text-[8px] px-1 py-0.5 rounded bg-gain/10 text-gain font-mono">MTF✓</span>
          )}
        </h3>
        <div className="flex items-center gap-1">
          {/* Alert toggles */}
          <button
            onClick={() => { const v = !alertConfig.enableAudio; updateConfig({ enableAudio: v }); setAlertConfig(c => ({ ...c, enableAudio: v })); }}
            className={`p-1 rounded transition-colors ${alertConfig.enableAudio ? "text-primary hover:bg-primary/10" : "text-muted-foreground/30 hover:bg-secondary"}`}
            title={alertConfig.enableAudio ? "Audio alerts ON" : "Audio alerts OFF"}
          >
            {alertConfig.enableAudio ? <Volume2 className="w-3 h-3" /> : <VolumeX className="w-3 h-3" />}
          </button>
          <button
            onClick={async () => {
              if (!alertConfig.enableNotifications) {
                const granted = await requestPermission();
                if (granted) { updateConfig({ enableNotifications: true }); setAlertConfig(c => ({ ...c, enableNotifications: true })); }
              } else { updateConfig({ enableNotifications: false }); setAlertConfig(c => ({ ...c, enableNotifications: false })); }
            }}
            className={`p-1 rounded transition-colors ${alertConfig.enableNotifications ? "text-primary hover:bg-primary/10" : "text-muted-foreground/30 hover:bg-secondary"}`}
            title={alertConfig.enableNotifications ? "Push notifications ON" : "Push notifications OFF"}
          >
            {alertConfig.enableNotifications ? <Bell className="w-3 h-3" /> : <BellOff className="w-3 h-3" />}
          </button>
          <button
            onClick={() => { const v = !alertConfig.autoClipboard; updateConfig({ autoClipboard: v }); setAlertConfig(c => ({ ...c, autoClipboard: v })); }}
            className={`p-1 rounded transition-colors ${alertConfig.autoClipboard ? "text-primary hover:bg-primary/10" : "text-muted-foreground/30 hover:bg-secondary"}`}
            title={alertConfig.autoClipboard ? "Auto-copy ON" : "Auto-copy OFF"}
          >
            {alertConfig.autoClipboard ? <ClipboardCheck className="w-3 h-3" /> : <Clipboard className="w-3 h-3" />}
          </button>
          {/* Signal freshness */}
          {signalAge > 0 && (
            <span className={`text-[8px] font-mono font-bold px-1 py-0.5 rounded ${freshness.color} ${freshness.isStale ? "bg-loss/10" : ""}`}>
              ⏱{freshness.label}
            </span>
          )}
          <button
            onClick={analyzeMarket}
            disabled={loading}
            className="p-1 rounded hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Signal Freshness Bar */}
      {signalAge > 0 && unified && (
        <div className="w-full bg-secondary rounded-full h-0.5">
          <div
            className={`h-0.5 rounded-full transition-all duration-1000 ${
              freshness.isFresh ? "bg-gain" : freshness.isStale ? "bg-loss" : "bg-warning"
            }`}
            style={{ width: `${freshness.pctRemaining}%` }}
          />
        </div>
      )}

      {loading && !unified && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
          <Loader2 className="w-4 h-4 animate-spin text-primary" />
          Analyzing {selectedSymbol}...
        </div>
      )}

      {unified && config && (
        <>
          {/* Signal Change Alert */}
          {unified.signalChanged && prevSignal && (
            <div className="flex items-center gap-2 bg-warning/10 border border-warning/20 rounded-md px-3 py-1.5 text-[10px] text-warning">
              <AlertTriangle className="w-3 h-3 shrink-0" />
              Signal changed from {signalConfig[prevSignal]?.label} → {config.label}
            </div>
          )}

          {/* Main Signal + Urgency */}
          <div className={`flex items-center justify-between rounded-lg p-3 border ${config.bgClass}`}>
            <div className="flex items-center gap-3">
              <div className={`flex items-center gap-1.5 text-xl font-bold ${config.colorClass}`}>
                {unified.direction === "up" ? <TrendingUp className="w-6 h-6" /> : unified.direction === "down" ? <TrendingDown className="w-6 h-6" /> : <Minus className="w-6 h-6" />}
                {config.label}
              </div>
              <span className={`text-[10px] px-2 py-1 rounded-md font-bold font-mono ${
                unified.grade === "A+" || unified.grade === "A" ? "bg-gain/15 text-gain" :
                unified.grade === "B" ? "bg-warning/15 text-warning" : "bg-loss/15 text-loss"
              }`}>
                {unified.grade}
              </span>
            </div>
            <div className="text-right">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-mono text-muted-foreground">{unified.confidence}%</span>
                <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold font-mono ${
                  unified.urgency === "NOW" ? "bg-gain/20 text-gain animate-pulse" :
                  unified.urgency === "SOON" ? "bg-primary/15 text-primary" :
                  unified.urgency === "WATCH" ? "bg-warning/15 text-warning" :
                  "bg-secondary text-muted-foreground"
                }`}>
                  {unified.urgency === "NOW" && <Timer className="w-2.5 h-2.5 inline mr-0.5" />}
                  {unified.urgency}
                </span>
              </div>
              <div className="text-[9px] text-muted-foreground/60">{unified.trend.toUpperCase()} · RSI {unified.rsi.toFixed(0)}</div>
            </div>
          </div>

          {/* Confidence bar */}
          <div className="w-full bg-secondary rounded-full h-1.5">
            <div
              className={`h-1.5 rounded-full transition-all duration-500 ${
                unified.signal.includes("buy") ? "bg-gain" : unified.signal.includes("sell") ? "bg-loss" : "bg-warning"
              }`}
              style={{ width: `${unified.confidence}%` }}
            />
          </div>

          {/* Exact Price Levels */}
          <div className="bg-secondary/30 rounded-lg p-3 border border-border/50">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2 flex items-center justify-between">
              <span className="flex items-center gap-1">
                <Zap className="w-3 h-3 text-primary" />
                EXACT LEVELS
              </span>
              {priceVelocity.direction !== "stable" && (
                <span className={`text-[8px] font-mono ${priceVelocity.direction === "rising" ? "text-gain" : "text-loss"}`}>
                  {priceVelocity.direction === "rising" ? "▲" : "▼"} momentum
                </span>
              )}
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="text-center">
                <div className="text-[9px] text-muted-foreground mb-0.5">ENTRY</div>
                <div className="text-sm font-mono font-bold text-foreground">
                  ${unified.entryPrice.toFixed(2)}
                </div>
                <div className="text-[8px] font-mono text-primary/70">{config.action}</div>
              </div>
              <div className="text-center">
                <div className="text-[9px] text-gain mb-0.5 flex items-center justify-center gap-0.5">
                  <TrendingUp className="w-2.5 h-2.5" /> TAKE PROFIT
                </div>
                <div className="text-sm font-mono font-bold text-gain">
                  ${unified.takeProfit.toFixed(2)}
                </div>
                <div className="text-[8px] font-mono text-gain/70">+{unified.tpPct.toFixed(1)}%</div>
              </div>
              <div className="text-center">
                <div className="text-[9px] text-loss mb-0.5 flex items-center justify-center gap-0.5">
                  <Shield className="w-2.5 h-2.5" /> STOP LOSS
                </div>
                <div className="text-sm font-mono font-bold text-loss">
                  ${unified.stopLoss.toFixed(2)}
                </div>
                <div className="text-[8px] font-mono text-loss/70">-{unified.slPct.toFixed(1)}%</div>
              </div>
            </div>
            <div className="mt-2 flex items-center justify-between text-[9px] font-mono">
              <span className={`${unified.riskReward >= 2 ? "text-gain" : unified.riskReward >= 1.5 ? "text-warning" : "text-loss"}`}>
                R:R {unified.riskReward.toFixed(2)} {unified.riskReward >= 2 ? "✓" : ""}
              </span>
              <span className="text-muted-foreground">Target: ${unified.targetPrice.toFixed(2)}</span>
              <span className="text-muted-foreground">S/R: ${unified.support.toFixed(2)}/${unified.resistance.toFixed(2)}</span>
            </div>
          </div>

          {/* Prediction Timeframes with MTF alignment indicator */}
          {predictions.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[9px] text-muted-foreground uppercase tracking-wider">Multi-Timeframe</span>
                <span className={`text-[8px] font-mono font-bold ${
                  mtfAgreement.aligned ? "text-gain" : "text-warning"
                }`}>
                  {mtfAgreement.label} ({mtfAgreement.score}%)
                </span>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {predictions.map(p => {
                  const ageSec = Math.floor((Date.now() - p.generatedAt) / 1000);
                  const isExpiring = ageSec > p.seconds * 0.7;
                  return (
                    <div key={p.timeframe} className={`bg-secondary/30 rounded-md p-2 text-center border ${
                      isExpiring ? "border-warning/30" : "border-border/30"
                    }`}>
                      <div className="text-[8px] text-muted-foreground flex items-center justify-center gap-0.5">
                        <Clock className="w-2 h-2" /> {p.timeframe}
                      </div>
                      <div className={`text-[11px] font-mono font-bold ${
                        p.direction === "up" ? "text-gain" : p.direction === "down" ? "text-loss" : "text-muted-foreground"
                      }`}>
                        {p.direction === "up" ? "▲" : p.direction === "down" ? "▼" : "—"} ${p.target_price.toFixed(2)}
                      </div>
                      <div className="text-[8px] font-mono text-muted-foreground/70">{p.confidence}% {p.signalQuality}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Execute Trade Buttons */}
          {unified.signal !== "neutral" && (
            <ExecuteTradeSection
              unified={unified}
              config={config}
              selectedSymbol={selectedSymbol}
              currentPrice={currentPrice}
              alpacaMode={alpacaMode}
              onAlpacaModeChange={onAlpacaModeChange}
              onExecuteTrade={onExecuteTrade}
            />
          )}

          {/* Reasons */}
          <div className="space-y-1">
            {unified.reasons.slice(0, 5).map((reason, i) => (
              <div key={i} className="flex items-center gap-2 text-[10px] text-muted-foreground">
                <Activity className="w-2.5 h-2.5 text-accent/60 shrink-0" />
                {reason}
              </div>
            ))}
          </div>

          {/* Footer with accuracy + regime */}
          <div className="flex items-center justify-between pt-2 border-t border-border/50 text-[9px] font-mono text-muted-foreground/60">
            <span className="flex items-center gap-1">
              {accuracy.rate >= 55 ? <CheckCircle2 className="w-2.5 h-2.5 text-gain" /> : <AlertTriangle className="w-2.5 h-2.5 text-warning" />}
              {accuracy.rate}% acc ({accuracy.total})
              {accuracy.recentTrend !== accuracy.rate && (
                <span className={accuracy.recentTrend > accuracy.rate ? "text-gain" : "text-loss"}>
                  {accuracy.recentTrend > accuracy.rate ? "↑" : "↓"}{accuracy.recentTrend}%
                </span>
              )}
            </span>
            {unified.regime && <span>Regime: {unified.regime}</span>}
            {lastAnalyzed && <span>AI: {lastAnalyzed}</span>}
          </div>
        </>
      )}
    </div>
  );
}
