import { useState, useEffect, useCallback } from "react";
import { TickerData } from "@/hooks/useWebullData";
import { TrendingUp, TrendingDown, Minus, Brain, Activity, BarChart3, RefreshCw, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface SignalPanelProps {
  tickers: Record<string, TickerData>;
  selectedSymbol: string;
}

type Signal = "strong_buy" | "buy" | "neutral" | "sell" | "strong_sell";

interface AISignal {
  signal: Signal;
  confidence: number;
  reasons: string[];
  rsi_estimate: number;
  trend: "bullish" | "bearish" | "sideways";
  key_levels: { support: number; resistance: number };
}

const signalConfig: Record<Signal, { label: string; colorClass: string; icon: typeof TrendingUp }> = {
  strong_buy: { label: "STRONG BUY", colorClass: "text-gain", icon: TrendingUp },
  buy: { label: "BUY", colorClass: "text-gain", icon: TrendingUp },
  neutral: { label: "NEUTRAL", colorClass: "text-warning", icon: Minus },
  sell: { label: "SELL", colorClass: "text-loss", icon: TrendingDown },
  strong_sell: { label: "STRONG SELL", colorClass: "text-loss", icon: TrendingDown },
};

export function SignalPanel({ tickers, selectedSymbol }: SignalPanelProps) {
  const [aiSignal, setAiSignal] = useState<AISignal | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastAnalyzed, setLastAnalyzed] = useState<string>("");
  const ticker = tickers[selectedSymbol];

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

      if (error) {
        const msg = error.message || "Analysis unavailable";
        if (msg.toLowerCase().includes("credits") || msg.includes("402")) {
          toast.warning("AI unavailable — using local fallback analysis.");
          return;
        }
        throw error;
      }
      if (data?.error) {
        if (data.error.includes("Rate limited")) {
          toast.error("AI rate limited. Try again in a moment.");
          return;
        }
        if (data.error.includes("credits")) {
          toast.warning("AI unavailable — using local fallback analysis.");
          return;
        }
        throw new Error(data.error);
      }

      setAiSignal(data);
      setLastAnalyzed(new Date().toLocaleTimeString());
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown";
      console.error("AI analysis failed:", err);
      if (msg.toLowerCase().includes("credits") || msg.includes("402")) {
        toast.warning("AI unavailable — using local fallback analysis.");
      } else {
        toast.error("AI analysis failed. Using fallback signals.");
      }
    } finally {
      setLoading(false);
    }
  }, [ticker, loading]);

  // Auto-analyze when symbol changes and data is available
  useEffect(() => {
    if (ticker && !aiSignal) {
      const timeout = setTimeout(analyzeMarket, 1000);
      return () => clearTimeout(timeout);
    }
  }, [selectedSymbol, !!ticker]);

  // Reset signal when symbol changes
  useEffect(() => {
    setAiSignal(null);
  }, [selectedSymbol]);

  if (!ticker) {
    return (
      <div className="bg-card rounded-lg border border-border p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <Brain className="w-4 h-4 text-accent" />
          AI Signals
        </h3>
        <div className="text-xs text-muted-foreground animate-pulse-glow">Waiting for data...</div>
      </div>
    );
  }

  const analysis = aiSignal;
  const config = analysis ? signalConfig[analysis.signal] : null;
  const Icon = config?.icon || Brain;

  return (
    <div className="bg-card rounded-lg border border-border p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Brain className="w-4 h-4 text-accent" />
          AI Signals
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-accent/10 text-accent font-mono">LIVE AI</span>
        </h3>
        <button
          onClick={analyzeMarket}
          disabled={loading}
          className="p-1 rounded hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
          title="Refresh AI analysis"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
        </button>
      </div>

      {loading && !analysis && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
          <Loader2 className="w-4 h-4 animate-spin text-accent" />
          Analyzing {selectedSymbol.replace("USDT", "")}/USDT with AI...
        </div>
      )}

      {analysis && config && (
        <>
          <div className="flex items-center gap-3 mb-3">
            <div className={`flex items-center gap-1.5 text-lg font-bold ${config.colorClass}`}>
              <Icon className="w-5 h-5" />
              {config.label}
            </div>
            <div className="text-xs font-mono text-muted-foreground">
              {analysis.confidence}% confidence
            </div>
          </div>

          <div className="w-full bg-secondary rounded-full h-1.5 mb-3">
            <div
              className={`h-1.5 rounded-full transition-all duration-500 ${
                analysis.signal.includes("buy") ? "bg-gain" :
                analysis.signal.includes("sell") ? "bg-loss" : "bg-warning"
              }`}
              style={{ width: `${analysis.confidence}%` }}
            />
          </div>

          <div className="space-y-1.5 mb-3">
            {analysis.reasons.map((reason, i) => (
              <div key={i} className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <Activity className="w-3 h-3 text-accent/60 shrink-0" />
                {reason}
              </div>
            ))}
          </div>

          <div className="pt-3 border-t border-border">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
              <BarChart3 className="w-3 h-3" />
              AI Indicators
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
              <div className="flex justify-between">
                <span className="text-muted-foreground">RSI</span>
                <span className={`${analysis.rsi_estimate > 70 ? "text-loss" : analysis.rsi_estimate < 30 ? "text-gain" : "text-foreground"}`}>
                  {analysis.rsi_estimate.toFixed(1)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Trend</span>
                <span className={`${analysis.trend === "bullish" ? "text-gain" : analysis.trend === "bearish" ? "text-loss" : "text-warning"}`}>
                  {analysis.trend.toUpperCase()}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Support</span>
                <span className="text-foreground">${analysis.key_levels.support.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Resist</span>
                <span className="text-foreground">${analysis.key_levels.resistance.toLocaleString()}</span>
              </div>
            </div>
          </div>

          {lastAnalyzed && (
            <div className="mt-2 text-[9px] text-muted-foreground/60 font-mono text-right">
              Updated {lastAnalyzed}
            </div>
          )}
        </>
      )}
    </div>
  );
}
