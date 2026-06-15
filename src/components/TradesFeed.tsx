export interface TradeData {
  price: string;
  qty: string;
  time: number;
  isBuyerMaker: boolean;
}

interface TradesFeedProps {
  trades: TradeData[];
  symbol: string;
}

export function TradesFeed({ trades, symbol }: TradesFeedProps) {
  return (
    <div className="bg-card rounded-lg border border-border p-4">
      <h3 className="text-sm font-semibold text-foreground mb-3">
        Live Trades · {symbol.replace("USDT", "")}
      </h3>
      <div className="space-y-0.5 max-h-[200px] overflow-y-auto scrollbar-thin">
        <div className="grid grid-cols-3 text-[10px] text-muted-foreground uppercase tracking-wider pb-1 border-b border-border/50">
          <span>Price</span>
          <span className="text-right">Amount</span>
          <span className="text-right">Time</span>
        </div>
        {trades.slice(0, 20).map((trade, i) => (
          <div key={i} className="grid grid-cols-3 text-[11px] font-mono py-0.5">
            <span className={trade.isBuyerMaker ? "text-loss" : "text-gain"}>
              {parseFloat(trade.price).toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </span>
            <span className="text-right text-muted-foreground">
              {parseFloat(trade.qty).toFixed(4)}
            </span>
            <span className="text-right text-muted-foreground">
              {new Date(trade.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
