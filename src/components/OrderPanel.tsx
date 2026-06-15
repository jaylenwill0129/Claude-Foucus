import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ShieldAlert, TrendingUp, TrendingDown, DollarSign, Info, Clock, Crosshair, Target } from "lucide-react";
import { toast } from "sonner";
import { computeAdaptiveRisk, getTierColor, getTierBgColor, type AdaptiveRiskProfile, type StockContext } from "@/lib/adaptiveRisk";

type OrderExecType = "market" | "limit" | "stop" | "stop-limit";

export interface OrderPrefill {
  side: "long" | "short";
  stopLoss: number;
  takeProfit: number;
}

interface OrderPanelProps {
  symbol: string;
  currentPrice: number;
  balance: number;
  onOrder: (symbol: string, side: "long" | "short", price: number, quantity: number, stopLoss?: number, takeProfit?: number) => void;
  onPendingOrder?: (symbol: string, side: "long" | "short", type: "limit" | "stop" | "stop-limit", quantity: number, limitPrice?: number, stopPrice?: number, ttlMinutes?: number) => void;
  settings?: { slippageBps: number; commissionPct: number; enableSlippage: boolean; enableCommissions: boolean };
  tickerData?: { high: string; low: string; priceChangePercent: string; volume: string; profitExpectancy?: number };
  prefill?: OrderPrefill | null;
}

export function OrderPanel({ symbol, currentPrice, balance, onOrder, onPendingOrder, settings, tickerData, prefill }: OrderPanelProps) {
  const [inputMode, setInputMode] = useState<"qty" | "usd">("usd");
  const [quantity, setQuantity] = useState("");
  const [usdAmount, setUsdAmount] = useState("");
  const [orderType, setOrderType] = useState<"long" | "short">("long");
  const [execType, setExecType] = useState<OrderExecType>("market");
  const [limitPrice, setLimitPrice] = useState("");
  const [stopPrice, setStopPrice] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [takeProfit, setTakeProfit] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // Apply prefill from signal execution
  useEffect(() => {
    if (prefill) {
      setOrderType(prefill.side);
      setStopLoss(prefill.stopLoss.toFixed(2));
      setTakeProfit(prefill.takeProfit.toFixed(2));
      setShowAdvanced(true);
      setShowConfirm(false);
      toast.info(`Order prefilled: ${prefill.side.toUpperCase()} with SL $${prefill.stopLoss.toFixed(2)} / TP $${prefill.takeProfit.toFixed(2)}`);
    }
  }, [prefill]);

  const effectivePrice = execType === "market" ? currentPrice : (parseFloat(limitPrice) || parseFloat(stopPrice) || currentPrice);
  const qty = inputMode === "qty" ? (parseFloat(quantity) || 0) : (effectivePrice > 0 ? (parseFloat(usdAmount) || 0) / effectivePrice : 0);
  const total = qty * effectivePrice;

  const estimatedFees = useMemo(() => {
    if (!settings?.enableCommissions) return 0;
    return total * (settings.commissionPct / 100);
  }, [total, settings]);

  const estimatedSlippage = useMemo(() => {
    if (!settings?.enableSlippage || execType !== "market") return 0;
    return total * (settings.slippageBps / 10000);
  }, [total, settings, execType]);

  const totalCost = total + estimatedFees;
  const canAfford = totalCost <= balance && qty > 0 && effectivePrice > 0;
  const balancePct = balance > 0 ? (totalCost / balance) * 100 : 0;

  const riskEstimate = useMemo(() => {
    if (!canAfford) return null;
    const sl2 = total * 0.02;
    const sl5 = total * 0.05;
    return { sl2, sl5 };
  }, [total, canAfford]);

  // Adaptive risk suggestion for current stock
  const adaptiveRisk = useMemo<AdaptiveRiskProfile | null>(() => {
    if (!tickerData || currentPrice <= 0) return null;
    const ctx: StockContext = {
      symbol: symbol.replace("USDT", ""),
      price: currentPrice,
      changePct: parseFloat(tickerData.priceChangePercent) || 0,
      high: parseFloat(tickerData.high) || currentPrice,
      low: parseFloat(tickerData.low) || currentPrice,
      volume: parseFloat(tickerData.volume?.replace(/[^\d.]/g, '') || '0') || 0,
      peScore: tickerData.profitExpectancy,
    };
    return computeAdaptiveRisk(ctx, {
      stopLossPct: 2, takeProfitPct: 5, positionSizePct: 5,
      requireMinRR: 2, confidenceThreshold: 55, trailingStopPct: 1.5,
    });
  }, [symbol, currentPrice, tickerData]);

  const handleOrder = () => {
    if (!canAfford) return;
    if (!showConfirm) { setShowConfirm(true); return; }

    if (execType === "market") {
      const sl = parseFloat(stopLoss) || undefined;
      const tp = parseFloat(takeProfit) || undefined;
      onOrder(symbol, orderType, currentPrice, qty, sl, tp);
      toast.success(`${orderType === "long" ? "Bought" : "Shorted"} ${qty.toFixed(4)} ${symbol} @ $${currentPrice.toLocaleString()}${estimatedFees > 0 ? ` (fees: $${estimatedFees.toFixed(2)})` : ""}`);
    } else if (onPendingOrder) {
      const lp = parseFloat(limitPrice) || undefined;
      const sp = parseFloat(stopPrice) || undefined;
      onPendingOrder(symbol, orderType, execType as "limit" | "stop" | "stop-limit", qty, lp, sp);
      toast.success(`${execType.toUpperCase()} order placed: ${qty.toFixed(4)} ${symbol}${lp ? ` @ $${lp}` : ""}${sp ? ` trigger $${sp}` : ""}`);
    }

    setQuantity(""); setUsdAmount(""); setShowConfirm(false);
    setStopLoss(""); setTakeProfit("");
  };

  const percentages = [10, 25, 50, 75, 100];

  return (
    <div className="bg-card rounded-lg border border-border p-4">
      <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
        <DollarSign className="w-4 h-4 text-accent" />
        Paper Trade
      </h3>

      {/* Side toggle */}
      <div className="flex gap-1 mb-3">
        <button onClick={() => { setOrderType("long"); setShowConfirm(false); }}
          className={`flex-1 py-2 text-xs font-semibold rounded-md transition-all flex items-center justify-center gap-1.5 ${orderType === "long" ? "bg-gain/20 text-gain border border-gain/30 shadow-sm" : "bg-secondary text-muted-foreground hover:text-foreground"}`}>
          <TrendingUp className="w-3 h-3" /> LONG
        </button>
        <button onClick={() => { setOrderType("short"); setShowConfirm(false); }}
          className={`flex-1 py-2 text-xs font-semibold rounded-md transition-all flex items-center justify-center gap-1.5 ${orderType === "short" ? "bg-loss/20 text-loss border border-loss/30 shadow-sm" : "bg-secondary text-muted-foreground hover:text-foreground"}`}>
          <TrendingDown className="w-3 h-3" /> SHORT
        </button>
      </div>

      {/* Order type selector */}
      <div className="flex gap-0.5 mb-3 p-0.5 bg-secondary rounded-md">
        {(["market", "limit", "stop", "stop-limit"] as OrderExecType[]).map(t => (
          <button key={t} onClick={() => { setExecType(t); setShowConfirm(false); }}
            className={`flex-1 py-1.5 text-[10px] font-semibold rounded transition-all uppercase tracking-wider ${execType === t ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
            {t}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {/* Market price display */}
        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider">
            {execType === "market" ? "Price (Market)" : "Market Price"}
          </label>
          <div className="bg-secondary rounded-md px-3 py-2 text-sm font-mono text-foreground flex items-center justify-between">
            <span>${currentPrice > 0 ? currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2 }) : "--"}</span>
            <span className="text-[9px] text-muted-foreground">{symbol}</span>
          </div>
        </div>

        {/* Limit / Stop price inputs */}
        {(execType === "limit" || execType === "stop-limit") && (
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
              <Crosshair className="w-3 h-3" /> Limit Price
            </label>
            <Input type="number" placeholder={currentPrice.toFixed(2)} value={limitPrice}
              onChange={e => { setLimitPrice(e.target.value); setShowConfirm(false); }}
              className="font-mono text-sm bg-secondary border-border" />
          </div>
        )}
        {(execType === "stop" || execType === "stop-limit") && (
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
              <ShieldAlert className="w-3 h-3" /> Stop/Trigger Price
            </label>
            <Input type="number" placeholder={currentPrice.toFixed(2)} value={stopPrice}
              onChange={e => { setStopPrice(e.target.value); setShowConfirm(false); }}
              className="font-mono text-sm bg-secondary border-border" />
          </div>
        )}

        {/* Input mode & amount */}
        <div className="flex gap-1 mb-1">
          <button onClick={() => { setInputMode("usd"); setShowConfirm(false); }}
            className={`text-[10px] px-2 py-0.5 rounded font-medium transition-colors ${inputMode === "usd" ? "bg-primary/15 text-primary" : "text-muted-foreground"}`}>
            $ Amount
          </button>
          <button onClick={() => { setInputMode("qty"); setShowConfirm(false); }}
            className={`text-[10px] px-2 py-0.5 rounded font-medium transition-colors ${inputMode === "qty" ? "bg-primary/15 text-primary" : "text-muted-foreground"}`}>
            Quantity
          </button>
        </div>

        <div>
          {inputMode === "usd" ? (
            <>
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Amount (USD)</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                <Input type="number" placeholder="0.00" value={usdAmount}
                  onChange={e => { setUsdAmount(e.target.value); setShowConfirm(false); }}
                  className="font-mono text-sm bg-secondary border-border pl-7" />
              </div>
              {qty > 0 && <div className="text-[9px] text-muted-foreground mt-0.5 font-mono">≈ {qty.toFixed(6)} shares</div>}
            </>
          ) : (
            <>
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Quantity</label>
              <Input type="number" placeholder="0.00" value={quantity}
                onChange={e => { setQuantity(e.target.value); setShowConfirm(false); }}
                className="font-mono text-sm bg-secondary border-border" />
            </>
          )}
        </div>

        <div className="flex gap-1">
          {percentages.map(pct => {
            const maxQty = effectivePrice > 0 ? balance / effectivePrice : 0;
            return (
              <button key={pct} onClick={() => {
                if (inputMode === "usd") setUsdAmount((balance * pct / 100).toFixed(2));
                else setQuantity((maxQty * pct / 100).toFixed(6));
                setShowConfirm(false);
              }}
                className="flex-1 py-1 text-[10px] font-mono bg-secondary hover:bg-secondary/80 rounded text-muted-foreground transition-colors">
                {pct}%
              </button>
            );
          })}
        </div>

        {/* Advanced: SL/TP */}
        <button onClick={() => setShowAdvanced(!showAdvanced)}
          className="text-[10px] text-primary hover:text-primary/80 font-medium flex items-center gap-1 transition-colors">
          <Target className="w-3 h-3" />
          {showAdvanced ? "Hide" : "Show"} Stop Loss / Take Profit
        </button>

        {showAdvanced && (
          <div className="grid grid-cols-2 gap-2 p-2 bg-secondary/50 rounded-md border border-border/50">
            <div>
              <label className="text-[9px] text-loss uppercase tracking-wider font-semibold">Stop Loss $</label>
              <Input type="number" placeholder={effectivePrice > 0 ? (effectivePrice * 0.98).toFixed(2) : "0"} value={stopLoss}
                onChange={e => setStopLoss(e.target.value)}
                className="font-mono text-xs bg-background border-border h-8" />
            </div>
            <div>
              <label className="text-[9px] text-gain uppercase tracking-wider font-semibold">Take Profit $</label>
              <Input type="number" placeholder={effectivePrice > 0 ? (effectivePrice * 1.04).toFixed(2) : "0"} value={takeProfit}
                onChange={e => setTakeProfit(e.target.value)}
                className="font-mono text-xs bg-background border-border h-8" />
            </div>
            <div className="col-span-2 flex gap-1">
              {[1, 2, 3, 5].map(pct => (
                <button key={pct} onClick={() => {
                  if (effectivePrice > 0) {
                    setStopLoss((orderType === "long" ? effectivePrice * (1 - pct / 100) : effectivePrice * (1 + pct / 100)).toFixed(2));
                    setTakeProfit((orderType === "long" ? effectivePrice * (1 + pct * 2 / 100) : effectivePrice * (1 - pct * 2 / 100)).toFixed(2));
                  }
                }}
                  className="flex-1 py-1 text-[9px] font-mono bg-muted hover:bg-muted/80 rounded text-muted-foreground transition-colors">
                  {pct}% SL / {pct * 2}% TP
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Adaptive Risk Suggestion */}
        {adaptiveRisk && (
          <div className={`p-2 rounded-md border ${getTierBgColor(adaptiveRisk.tier)} mb-2`}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[9px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                <Crosshair className="w-3 h-3" /> Suggested Risk
              </span>
              <span className={`text-[9px] font-mono font-bold ${getTierColor(adaptiveRisk.tier)}`}>
                {adaptiveRisk.tier.replace("_", " ").toUpperCase()}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-1 text-center">
              <div>
                <div className="text-[7px] text-muted-foreground">SL</div>
                <button onClick={() => setStopLoss((currentPrice * (1 - adaptiveRisk.stopLossPct / 100)).toFixed(2))}
                  className="text-[10px] font-mono text-loss hover:underline cursor-pointer">{adaptiveRisk.stopLossPct}%</button>
              </div>
              <div>
                <div className="text-[7px] text-muted-foreground">TP</div>
                <button onClick={() => setTakeProfit((currentPrice * (1 + adaptiveRisk.takeProfitPct / 100)).toFixed(2))}
                  className="text-[10px] font-mono text-gain hover:underline cursor-pointer">{adaptiveRisk.takeProfitPct}%</button>
              </div>
              <div>
                <div className="text-[7px] text-muted-foreground">Size</div>
                <button onClick={() => setUsdAmount((balance * adaptiveRisk.positionSizePct / 100).toFixed(0))}
                  className="text-[10px] font-mono text-foreground hover:underline cursor-pointer">{adaptiveRisk.positionSizePct.toFixed(1)}%</button>
              </div>
            </div>
            <div className="text-[7px] text-muted-foreground mt-1 text-center">Click values to apply</div>
          </div>
        )}

        {/* Order Summary */}
        <div className="space-y-1 pt-1 border-t border-border/50">
          <div className="flex justify-between text-[11px]">
            <span className="text-muted-foreground">Subtotal</span>
            <span className="font-mono text-foreground">${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
          {estimatedFees > 0 && (
            <div className="flex justify-between text-[11px]">
              <span className="text-muted-foreground">Est. Commission</span>
              <span className="font-mono text-warning">${estimatedFees.toFixed(2)}</span>
            </div>
          )}
          {estimatedSlippage > 0 && (
            <div className="flex justify-between text-[11px]">
              <span className="text-muted-foreground">Est. Slippage</span>
              <span className="font-mono text-warning">~${estimatedSlippage.toFixed(2)}</span>
            </div>
          )}
          <div className="flex justify-between text-[11px] font-semibold">
            <span className="text-muted-foreground">Total Cost</span>
            <span className={`font-mono ${canAfford ? "text-foreground" : "text-loss"}`}>
              ${totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
          <div className="flex justify-between text-[11px]">
            <span className="text-muted-foreground">% of Balance</span>
            <span className={`font-mono ${balancePct > 80 ? "text-loss" : balancePct > 50 ? "text-warning" : "text-muted-foreground"}`}>
              {balancePct.toFixed(1)}%
            </span>
          </div>
          <div className="flex justify-between text-[11px]">
            <span className="text-muted-foreground">Available</span>
            <span className="font-mono text-muted-foreground">${balance.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
          </div>
        </div>

        {/* Risk Preview */}
        {riskEstimate && (
          <div className="p-2 rounded bg-secondary/50 border border-border/50 space-y-0.5">
            <div className="text-[9px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
              <ShieldAlert className="w-3 h-3" /> Risk Preview
            </div>
            <div className="flex justify-between text-[10px] font-mono">
              <span className="text-muted-foreground">2% SL</span>
              <span className="text-loss">-${riskEstimate.sl2.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-[10px] font-mono">
              <span className="text-muted-foreground">5% SL</span>
              <span className="text-loss">-${riskEstimate.sl5.toFixed(2)}</span>
            </div>
          </div>
        )}

        {/* Confirmation */}
        {showConfirm && canAfford && (
          <div className="p-2 rounded bg-warning/10 border border-warning/20 text-[10px] text-warning flex items-start gap-1.5">
            <Info className="w-3 h-3 mt-0.5 shrink-0" />
            <span>
              Confirm {execType.toUpperCase()} {orderType === "long" ? "buy" : "short"} {qty.toFixed(4)} {symbol}
              {execType === "market" ? ` @ market $${currentPrice.toFixed(2)}` : execType === "limit" ? ` limit $${limitPrice}` : ` stop $${stopPrice}`}
              ? Click again.
            </span>
          </div>
        )}

        <Button onClick={handleOrder} disabled={!canAfford}
          className={`w-full font-semibold text-sm py-2.5 ${showConfirm && canAfford ? "bg-warning hover:bg-warning/90 text-warning-foreground" : orderType === "long" ? "bg-gain hover:bg-gain/90 text-primary-foreground" : "bg-loss hover:bg-loss/90 text-destructive-foreground"}`}>
          {showConfirm ? "⚡ Confirm Order" : execType === "market"
            ? (orderType === "long" ? `Buy / Long ${symbol}` : `Sell / Short ${symbol}`)
            : `Place ${execType.toUpperCase()} Order`}
        </Button>
      </div>
    </div>
  );
}
