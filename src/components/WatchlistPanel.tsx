import { useState, useMemo } from "react";
import { Star, StarOff, TrendingUp, TrendingDown, Zap } from "lucide-react";
import { TickerData } from "@/hooks/useWebullData";

interface WatchlistPanelProps {
  tickers: Record<string, TickerData>;
  selectedSymbol: string;
  onSelect: (symbol: string) => void;
}

const WATCHLIST_KEY = "neuraltrade_watchlist";

function getWatchlist(): string[] {
  try {
    return JSON.parse(localStorage.getItem(WATCHLIST_KEY) || "[]");
  } catch {
    return [];
  }
}

function setWatchlistStorage(list: string[]) {
  localStorage.setItem(WATCHLIST_KEY, JSON.stringify(list));
}

export function WatchlistPanel({ tickers, selectedSymbol, onSelect }: WatchlistPanelProps) {
  const [watchlist, setWatchlist] = useState<string[]>(getWatchlist);

  const toggleWatchlist = (symbol: string) => {
    setWatchlist(prev => {
      const next = prev.includes(symbol) ? prev.filter(s => s !== symbol) : [...prev, symbol];
      setWatchlistStorage(next);
      return next;
    });
  };

  const watchlistTickers = useMemo(() => {
    return watchlist.map(s => tickers[s]).filter(Boolean);
  }, [watchlist, tickers]);

  const allSymbols = Object.keys(tickers);

  if (watchlist.length === 0) {
    return (
      <div className="bg-card rounded-lg border border-border p-4">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-3">
          <Star className="w-4 h-4 text-warning" />
          Watchlist
        </h3>
        <div className="text-center py-4 space-y-2">
          <div className="text-[11px] text-muted-foreground">No stocks in your watchlist yet</div>
          <div className="text-[10px] text-muted-foreground/60">Click the ★ on any stock in the ticker to add it</div>
          <div className="flex flex-wrap gap-1 justify-center mt-2">
            {allSymbols.slice(0, 5).map(s => (
              <button key={s} onClick={() => toggleWatchlist(s)}
                className="text-[10px] px-2 py-1 rounded-md bg-secondary hover:bg-secondary/80 text-muted-foreground hover:text-foreground transition-colors font-mono flex items-center gap-1">
                <Star className="w-2.5 h-2.5" /> {s}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-lg border border-border p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Star className="w-4 h-4 text-warning" />
          Watchlist
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-warning/10 text-warning font-mono">{watchlist.length}</span>
        </h3>
      </div>

      <div className="space-y-1 max-h-[200px] overflow-y-auto scrollbar-thin">
        {watchlistTickers.map(t => {
          const isPositive = parseFloat(t.priceChangePercent) >= 0;
          const isSelected = t.symbol === selectedSymbol;
          return (
            <div
              key={t.symbol}
              onClick={() => onSelect(t.symbol)}
              className={`flex items-center justify-between py-2 px-2.5 rounded-md cursor-pointer transition-all ${
                isSelected ? "bg-accent/10 border border-accent/20" : "hover:bg-secondary/60"
              }`}
            >
              <div className="flex items-center gap-2">
                <button onClick={(e) => { e.stopPropagation(); toggleWatchlist(t.symbol); }}
                  className="text-warning hover:text-warning/60 transition-colors">
                  <Star className="w-3 h-3 fill-current" />
                </button>
                <div>
                  <div className="text-[11px] font-semibold text-foreground">{t.symbol}</div>
                  <div className="text-[9px] text-muted-foreground truncate max-w-[80px]">{t.name}</div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-[11px] font-mono text-foreground">${parseFloat(t.price).toLocaleString()}</div>
                <div className={`text-[10px] font-mono flex items-center gap-0.5 justify-end ${isPositive ? "text-gain" : "text-loss"}`}>
                  {isPositive ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
                  {isPositive ? "+" : ""}{t.priceChangePercent}%
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function useWatchlist() {
  const [watchlist, setWatchlist] = useState<string[]>(getWatchlist);

  const toggle = (symbol: string) => {
    setWatchlist(prev => {
      const next = prev.includes(symbol) ? prev.filter(s => s !== symbol) : [...prev, symbol];
      setWatchlistStorage(next);
      return next;
    });
  };

  const isWatched = (symbol: string) => watchlist.includes(symbol);

  return { watchlist, toggle, isWatched };
}
