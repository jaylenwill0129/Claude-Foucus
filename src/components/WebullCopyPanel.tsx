import { useState, useEffect, useCallback, useMemo } from "react";
import { Copy, ExternalLink, History, ChevronDown, ChevronUp, DollarSign, Check, Zap, Keyboard, Target, ShieldAlert, TrendingUp, TrendingDown, BarChart3, Percent, CheckCircle2, XCircle, Clock } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface WebullCopyPanelProps {
  symbol: string;
  side: "buy" | "sell";
  entry: number;
  tp: number;
  sl: number;
  tpPct: number;
  slPct: number;
  rr: number;
  confidence: number;
  grade: string;
  reasons: string[];
  trend: string;
  rsi: number;
  urgency: string;
  buyingPower?: number;
  portfolioSize?: number;
}

interface SignalCopyRecord {
  id: string;
  symbol: string;
  side: string;
  entry_price: number;
  tp_price: number;
  sl_price: number;
  qty: number;
  position_value: number;
  risk_pct: number;
  rr_ratio: number | null;
  confidence: number | null;
  grade: string | null;
  copied_at: string;
  executed: boolean;
  outcome: string;
  pnl: number | null;
}

export function WebullCopyPanel({
  symbol, side, entry, tp, sl, tpPct, slPct, rr, confidence, grade, reasons, trend, rsi, urgency, buyingPower, portfolioSize,
}: WebullCopyPanelProps) {
  const [showHistory, setShowHistory] = useState(false);
  const [showSizing, setShowSizing] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [riskPct, setRiskPct] = useState(() => {
    const saved = localStorage.getItem("trade_risk_pct");
    return saved ? Number(saved) : 2;
  });
  const [accountBalance, setAccountBalance] = useState(buyingPower || portfolioSize || 10000);
  const [signalHistory, setSignalHistory] = useState<SignalCopyRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Sync buying power from Alpaca
  useEffect(() => {
    if (buyingPower && buyingPower > 0) setAccountBalance(buyingPower);
    else if (portfolioSize && portfolioSize > 0) setAccountBalance(portfolioSize);
  }, [buyingPower, portfolioSize]);

  // Persist risk %
  useEffect(() => {
    localStorage.setItem("trade_risk_pct", String(riskPct));
  }, [riskPct]);

  // ========== POSITION SIZING ==========
  // Risk-based: Account × Risk% ÷ (Entry - SL) = Shares
  const sizing = useMemo(() => {
    const riskAmount = accountBalance * (riskPct / 100);
    const slDistance = Math.abs(entry - sl);
    if (slDistance <= 0 || entry <= 0) return { qty: 1, riskAmount, positionValue: entry, slDistance: 0, riskPerShare: 0 };
    const qty = Math.max(1, Math.floor(riskAmount / slDistance));
    const positionValue = qty * entry;
    return { qty, riskAmount, positionValue, slDistance, riskPerShare: slDistance };
  }, [accountBalance, riskPct, entry, sl]);

  // ========== COPY FUNCTIONS ==========
  const copyToClip = useCallback((text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(label);
    setTimeout(() => setCopiedField(null), 1200);
    toast.success(`${label} copied`, { duration: 800 });
  }, []);

  const rawEntry = entry.toFixed(2);
  const rawTp = tp.toFixed(2);
  const rawSl = sl.toFixed(2);
  const rawQty = String(sizing.qty);

  const richText = `${symbol} ${side.toUpperCase()} | ${grade} ${confidence}% | ${urgency}
Entry: ${rawEntry} | TP: ${rawTp} (+${tpPct.toFixed(1)}%) | SL: ${rawSl} (-${slPct.toFixed(1)}%)
R:R ${rr.toFixed(2)} | ${sizing.qty} shares ($${sizing.positionValue.toFixed(0)}) | Risk: $${sizing.riskAmount.toFixed(0)} (${riskPct}%)
${trend.toUpperCase()} RSI:${rsi.toFixed(0)} | ${reasons.slice(0, 2).join(" · ")}`;

  const limitOrderText = `Limit ${side.toUpperCase()} ${sizing.qty} ${symbol} @ $${rawEntry}, SL $${rawSl}, TP $${rawTp}`;

  // ========== SIGNAL COPY TRACKING (DB) ==========
  const trackSignalCopy = useCallback(async (copyType: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      await supabase.from("signal_copies").insert({
        user_id: user.id,
        symbol,
        side,
        entry_price: entry,
        tp_price: tp,
        sl_price: sl,
        qty: sizing.qty,
        position_value: sizing.positionValue,
        risk_pct: riskPct,
        rr_ratio: rr,
        confidence,
        grade,
        signal_reasons: reasons.slice(0, 5),
      } as any);
    } catch (err) {
      console.warn("Signal copy tracking failed:", err);
    }
  }, [symbol, side, entry, tp, sl, sizing.qty, sizing.positionValue, riskPct, rr, confidence, grade, reasons]);

  const handleFullCopy = useCallback(() => {
    copyToClip(richText, "⚡ Signal");
    trackSignalCopy("full");
  }, [copyToClip, richText, trackSignalCopy]);

  const handleLimitCopy = useCallback(() => {
    copyToClip(limitOrderText, "Order");
    trackSignalCopy("limit");
  }, [copyToClip, limitOrderText, trackSignalCopy]);

  const openWebull = () => {
    window.open(`https://app.webull.com/stocks/${symbol}`, "_blank", "noopener");
  };

  // Load signal copy history from DB
  const loadHistory = useCallback(async () => {
    if (historyLoading) return;
    setHistoryLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from("signal_copies")
        .select("*")
        .eq("user_id", user.id)
        .order("copied_at", { ascending: false })
        .limit(20);

      if (data) setSignalHistory(data as any);
    } catch {
    } finally {
      setHistoryLoading(false);
    }
  }, [historyLoading]);

  useEffect(() => {
    if (showHistory) loadHistory();
  }, [showHistory]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      switch (e.key.toLowerCase()) {
        case "e": copyToClip(rawEntry, "Entry"); break;
        case "t": copyToClip(rawTp, "TP"); break;
        case "s": copyToClip(rawSl, "SL"); break;
        case "q": copyToClip(rawQty, "Qty"); break;
        case "f": handleFullCopy(); break;
        case "w": openWebull(); break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [copyToClip, rawEntry, rawTp, rawSl, rawQty, handleFullCopy]);

  const isCopied = (label: string) => copiedField === label;

  // Mark a signal as executed
  const markExecuted = async (id: string) => {
    await supabase.from("signal_copies").update({ executed: true, executed_at: new Date().toISOString(), outcome: "executed" } as any).eq("id", id);
    loadHistory();
    toast.success("Marked as executed");
  };

  const markSkipped = async (id: string) => {
    await supabase.from("signal_copies").update({ outcome: "skipped" } as any).eq("id", id);
    loadHistory();
  };

  return (
    <div className="space-y-1.5 border-t border-border/50 pt-2">
      {/* Position Sizing Header */}
      <button
        onClick={() => setShowSizing(!showSizing)}
        className="flex items-center gap-1.5 w-full text-[9px] text-muted-foreground hover:text-foreground transition-colors"
      >
        <Target className="w-3 h-3 text-primary" />
        <span className="font-semibold">Position: {sizing.qty} shares · ${sizing.positionValue.toFixed(0)}</span>
        <span className="text-muted-foreground/50">({riskPct}% risk = ${sizing.riskAmount.toFixed(0)})</span>
        {showSizing ? <ChevronUp className="w-2.5 h-2.5 ml-auto" /> : <ChevronDown className="w-2.5 h-2.5 ml-auto" />}
      </button>

      {/* Expandable Position Sizing Controls */}
      {showSizing && (
        <div className="bg-secondary/30 rounded-lg p-2 space-y-1.5 border border-border/30">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[7px] uppercase tracking-wider text-muted-foreground/60">Account Balance</label>
              <div className="flex items-center gap-1">
                <DollarSign className="w-2.5 h-2.5 text-muted-foreground" />
                <input
                  type="number"
                  value={accountBalance}
                  onChange={e => setAccountBalance(Math.max(100, Number(e.target.value)))}
                  className="w-full bg-secondary/50 border border-border rounded px-1.5 py-0.5 text-[10px] font-mono text-foreground"
                />
              </div>
            </div>
            <div>
              <label className="text-[7px] uppercase tracking-wider text-muted-foreground/60">Risk Per Trade</label>
              <div className="flex items-center gap-1">
                <Percent className="w-2.5 h-2.5 text-muted-foreground" />
                <div className="flex gap-0.5">
                  {[1, 2, 3, 5].map(pct => (
                    <button
                      key={pct}
                      onClick={() => setRiskPct(pct)}
                      className={`px-1.5 py-0.5 rounded text-[9px] font-mono transition-colors ${
                        riskPct === pct
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {pct}%
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-1 text-[8px] font-mono">
            <div className="text-center">
              <div className="text-muted-foreground/50">Risk $</div>
              <div className="text-foreground font-bold">${sizing.riskAmount.toFixed(0)}</div>
            </div>
            <div className="text-center">
              <div className="text-muted-foreground/50">SL Dist</div>
              <div className="text-loss font-bold">${sizing.slDistance.toFixed(2)}</div>
            </div>
            <div className="text-center">
              <div className="text-muted-foreground/50">Shares</div>
              <div className="text-foreground font-bold">{sizing.qty}</div>
            </div>
            <div className="text-center">
              <div className="text-muted-foreground/50">Value</div>
              <div className="text-foreground font-bold">${sizing.positionValue.toFixed(0)}</div>
            </div>
          </div>
        </div>
      )}

      {/* One-Tap Copy Row — Entry, TP, SL, Qty */}
      <div className="grid grid-cols-4 gap-1">
        {[
          { label: "Entry", value: rawEntry, key: "Entry", hotkey: "E", color: "text-foreground bg-secondary/60 hover:bg-secondary border-border/50" },
          { label: "TP", value: rawTp, key: "TP", hotkey: "T", color: "text-gain bg-gain/5 hover:bg-gain/15 border-gain/20" },
          { label: "SL", value: rawSl, key: "SL", hotkey: "S", color: "text-loss bg-loss/5 hover:bg-loss/15 border-loss/20" },
          { label: "Qty", value: rawQty, key: "Qty", hotkey: "Q", color: "text-primary bg-primary/5 hover:bg-primary/15 border-primary/20" },
        ].map(({ label, value, key, hotkey, color }) => (
          <button
            key={key}
            onClick={() => copyToClip(value, key)}
            className={`relative flex flex-col items-center justify-center py-1.5 rounded-md border text-center transition-all active:scale-95 ${color} ${
              isCopied(key) ? "ring-1 ring-primary" : ""
            }`}
          >
            <span className="text-[6px] uppercase tracking-wider opacity-50 flex items-center gap-0.5">
              {label} <span className="opacity-40">{hotkey}</span>
            </span>
            <span className="text-[12px] font-mono font-bold leading-tight">{value}</span>
            {isCopied(key) && (
              <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-primary flex items-center justify-center">
                <Check className="w-2 h-2 text-primary-foreground" />
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Action buttons */}
      <div className="flex gap-1">
        <button
          onClick={handleFullCopy}
          className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md font-semibold text-[10px] transition-all active:scale-95 bg-primary/10 text-primary hover:bg-primary/20 border border-primary/20`}
        >
          {isCopied("⚡ Signal") ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          Full Signal
          <span className="opacity-40 text-[7px]">F</span>
        </button>
        <button
          onClick={handleLimitCopy}
          className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md bg-secondary hover:bg-secondary/80 border border-border text-[10px] font-semibold text-foreground transition-all active:scale-95"
        >
          {isCopied("Order") ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          Limit Order
        </button>
        <button
          onClick={openWebull}
          className="px-2 py-1.5 rounded-md bg-accent/10 hover:bg-accent/20 border border-accent/20 text-[10px] font-semibold text-accent transition-all active:scale-95 flex items-center gap-0.5"
          title="Open in Webull"
        >
          <ExternalLink className="w-3 h-3" />
          <span className="opacity-40 text-[7px]">W</span>
        </button>
      </div>

      {/* Keyboard hint */}
      <div className="flex items-center justify-center gap-1 text-[7px] text-muted-foreground/40">
        <Keyboard className="w-2.5 h-2.5" />
        E=Entry T=TP S=SL Q=Qty F=Full W=Webull
      </div>

      {/* Signal Copy History (DB-backed) */}
      <button
        onClick={() => setShowHistory(!showHistory)}
        className="flex items-center gap-1 text-[8px] text-muted-foreground hover:text-foreground transition-colors w-full"
      >
        <History className="w-2.5 h-2.5" />
        Signal Copy Log
        {showHistory ? <ChevronUp className="w-2.5 h-2.5 ml-auto" /> : <ChevronDown className="w-2.5 h-2.5 ml-auto" />}
      </button>

      {showHistory && (
        <div className="max-h-40 overflow-y-auto space-y-1 bg-secondary/20 rounded-md p-1.5">
          {historyLoading && <div className="text-[8px] text-muted-foreground animate-pulse">Loading...</div>}
          {!historyLoading && signalHistory.length === 0 && (
            <div className="text-[8px] text-muted-foreground/50 text-center py-2">No signals copied yet</div>
          )}
          {signalHistory.map((h) => (
            <div key={h.id} className="flex items-center gap-1.5 text-[7px] font-mono py-1 border-b border-border/10 last:border-0">
              {/* Direction indicator */}
              {h.side === "buy" ? (
                <TrendingUp className="w-2.5 h-2.5 text-gain shrink-0" />
              ) : (
                <TrendingDown className="w-2.5 h-2.5 text-loss shrink-0" />
              )}
              {/* Symbol + prices */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1">
                  <span className="font-bold text-foreground">{h.symbol}</span>
                  <span className="text-muted-foreground/50">{h.qty}sh</span>
                  <span className="text-muted-foreground/50">{h.grade} {h.confidence}%</span>
                </div>
                <div className="text-muted-foreground/60">
                  {h.entry_price.toFixed(2)}→{h.tp_price.toFixed(2)} SL:{h.sl_price.toFixed(2)}
                </div>
              </div>
              {/* Time */}
              <span className="text-muted-foreground/40 shrink-0">
                {new Date(h.copied_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
              {/* Action buttons */}
              {h.outcome === "pending" && (
                <div className="flex gap-0.5 shrink-0">
                  <button
                    onClick={() => markExecuted(h.id)}
                    className="p-0.5 rounded bg-gain/10 text-gain hover:bg-gain/20"
                    title="Mark as executed"
                  >
                    <CheckCircle2 className="w-2.5 h-2.5" />
                  </button>
                  <button
                    onClick={() => markSkipped(h.id)}
                    className="p-0.5 rounded bg-loss/10 text-loss hover:bg-loss/20"
                    title="Mark as skipped"
                  >
                    <XCircle className="w-2.5 h-2.5" />
                  </button>
                </div>
              )}
              {h.outcome === "executed" && (
                <CheckCircle2 className="w-2.5 h-2.5 text-gain shrink-0" />
              )}
              {h.outcome === "skipped" && (
                <XCircle className="w-2.5 h-2.5 text-muted-foreground/30 shrink-0" />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
