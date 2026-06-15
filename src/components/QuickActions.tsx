import { Zap, TrendingUp, TrendingDown, DollarSign } from "lucide-react";
import { toast } from "sonner";

interface QuickActionsProps {
  symbol: string;
  currentPrice: number;
  balance: number;
  onOrder: (symbol: string, side: "long" | "short", price: number, quantity: number) => void;
}

export function QuickActions({ symbol, currentPrice, balance, onOrder }: QuickActionsProps) {
  if (!symbol || currentPrice <= 0) return null;

  const quickAmounts = [100, 500, 1000, 5000];

  const handleQuickBuy = (amount: number) => {
    if (amount > balance) {
      toast.error("Insufficient balance");
      return;
    }
    const qty = amount / currentPrice;
    onOrder(symbol, "long", currentPrice, qty);
    toast.success(`Quick buy: ${qty.toFixed(4)} ${symbol} for $${amount}`);
  };

  return (
    <div className="bg-card rounded-lg border border-border p-3">
      <div className="flex items-center gap-2 mb-2">
        <Zap className="w-3.5 h-3.5 text-warning" />
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Quick Trade {symbol}</span>
      </div>
      <div className="flex gap-1.5">
        {quickAmounts.map(amount => (
          <button
            key={amount}
            onClick={() => handleQuickBuy(amount)}
            disabled={amount > balance}
            className="flex-1 py-2 rounded-md bg-gain/10 hover:bg-gain/20 border border-gain/15 text-gain text-[11px] font-mono font-semibold transition-all disabled:opacity-30 disabled:cursor-not-allowed flex flex-col items-center gap-0.5"
          >
            <TrendingUp className="w-3 h-3" />
            ${amount >= 1000 ? `${amount / 1000}K` : amount}
          </button>
        ))}
      </div>
    </div>
  );
}
