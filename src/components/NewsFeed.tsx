import { Newspaper, ExternalLink, RefreshCw, Loader2, TrendingUp, TrendingDown, Minus, DollarSign, BarChart3, Globe, Target, Search } from "lucide-react";
import { NewsItem } from "@/hooks/useWebullData";
import { useMemo, useState } from "react";

interface NewsFeedProps {
  news: NewsItem[];
  loading: boolean;
  onRefresh: () => void;
  stockNews?: NewsItem[];
  stockNewsLoading?: boolean;
  stockNewsSymbol?: string;
  onFetchStockNews?: (symbol: string) => void;
  symbols?: string[];
}

function guessSentiment(title: string): "bullish" | "bearish" | "neutral" {
  const lower = title.toLowerCase();
  const bullish = ["gain", "surge", "rally", "jump", "soar", "record", "profit", "beat", "growth", "bull", "up ", "rise", "higher", "boost", "strong", "upgrade", "buy", "outperform", "overweight"];
  const bearish = ["drop", "fall", "crash", "lose", "loser", "decline", "plunge", "cut", "miss", "bear", "down", "lower", "weak", "sell", "slump", "oversold", "downgrade", "underperform"];
  const bScore = bullish.filter(w => lower.includes(w)).length;
  const sScore = bearish.filter(w => lower.includes(w)).length;
  if (bScore > sScore) return "bullish";
  if (sScore > bScore) return "bearish";
  return "neutral";
}

const CATEGORY_CONFIG: Record<string, { label: string; icon: typeof Globe; className: string }> = {
  movers: { label: "Movers", icon: TrendingUp, className: "bg-accent/10 text-accent" },
  earnings: { label: "Earnings", icon: DollarSign, className: "bg-warning/10 text-warning" },
  macro: { label: "Macro", icon: Globe, className: "bg-primary/10 text-primary" },
  analysis: { label: "Analysis", icon: Target, className: "bg-gain/10 text-gain" },
  general: { label: "News", icon: Newspaper, className: "bg-muted text-muted-foreground" },
};

type FilterCat = "all" | "movers" | "earnings" | "macro" | "analysis";

export function NewsFeed({ news, loading, onRefresh, stockNews, stockNewsLoading, stockNewsSymbol, onFetchStockNews, symbols }: NewsFeedProps) {
  const [filter, setFilter] = useState<FilterCat>("all");
  const [stockSearch, setStockSearch] = useState("");

  const taggedNews = useMemo(() => {
    let items = news.map(item => ({
      ...item,
      sentiment: guessSentiment(item.title),
    }));
    if (filter !== "all") {
      items = items.filter(i => i.category === filter);
    }
    return items;
  }, [news, filter]);

  return (
    <div className="bg-card rounded-lg border border-border p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Newspaper className="w-4 h-4 text-accent" />
          Market News
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-accent/10 text-accent font-mono">LIVE</span>
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-muted-foreground font-mono">{taggedNews.length} articles</span>
          <button onClick={onRefresh} disabled={loading}
            className="p-1 rounded hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground">
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Category filters */}
      <div className="flex gap-1 mb-3 flex-wrap">
        {(["all", "movers", "earnings", "macro", "analysis"] as const).map(cat => (
          <button
            key={cat}
            onClick={() => setFilter(cat)}
            className={`text-[9px] px-2 py-0.5 rounded-full font-medium transition-colors ${
              filter === cat
                ? cat === "all" ? "bg-primary/15 text-primary" : (CATEGORY_CONFIG[cat]?.className || "bg-muted text-muted-foreground")
                : "text-muted-foreground hover:text-foreground hover:bg-secondary"
            }`}
          >
            {cat === "all" ? "All" : CATEGORY_CONFIG[cat]?.label || cat}
          </button>
        ))}
      </div>

      {/* Stock-specific news search */}
      {onFetchStockNews && (
        <div className="flex gap-1.5 mb-3">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
            <input
              type="text"
              value={stockSearch}
              onChange={e => setStockSearch(e.target.value.toUpperCase())}
              onKeyDown={e => { if (e.key === "Enter" && stockSearch) onFetchStockNews(stockSearch); }}
              placeholder="Search stock news (e.g. AAPL)"
              className="w-full pl-6 pr-2 py-1 text-[10px] rounded bg-secondary/60 border border-border/50 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
              list="stock-symbols"
            />
            {symbols && (
              <datalist id="stock-symbols">
                {symbols.slice(0, 20).map(s => <option key={s} value={s} />)}
              </datalist>
            )}
          </div>
          <button
            onClick={() => stockSearch && onFetchStockNews(stockSearch)}
            disabled={!stockSearch || stockNewsLoading}
            className="text-[9px] px-2 py-1 rounded bg-primary/15 text-primary hover:bg-primary/25 disabled:opacity-50 transition-colors font-medium"
          >
            {stockNewsLoading ? "..." : "Search"}
          </button>
        </div>
      )}

      {/* Stock-specific news results */}
      {stockNewsSymbol && stockNews && stockNews.length > 0 && (
        <div className="mb-3 p-2 rounded-md bg-primary/5 border border-primary/20">
          <h4 className="text-[10px] font-semibold text-primary mb-1.5 flex items-center gap-1">
            <Target className="w-3 h-3" />
            {stockNewsSymbol} News
          </h4>
          <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
            {stockNews.map((item, i) => (
              <a key={i} href={item.url} target="_blank" rel="noopener noreferrer"
                className="block p-1.5 rounded bg-secondary/40 hover:bg-secondary/70 border border-border/30 transition-all group">
                <div className="flex items-center gap-1 mb-0.5">
                  {item.source && <span className="text-[7px] px-1 py-0.5 rounded-full bg-primary/10 text-primary font-semibold uppercase">{item.source}</span>}
                </div>
                <div className="text-[10px] font-medium text-foreground group-hover:text-accent line-clamp-2">{item.title}</div>
              </a>
            ))}
          </div>
        </div>
      )}
      {stockNewsSymbol && stockNews && stockNews.length === 0 && !stockNewsLoading && (
        <div className="mb-3 p-2 rounded-md bg-secondary/30 text-[10px] text-muted-foreground text-center">
          No news found for {stockNewsSymbol}
        </div>
      )}

      <div className="max-h-[400px] overflow-y-auto scrollbar-thin space-y-2">
        {loading && news.length === 0 ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
            <Loader2 className="w-4 h-4 animate-spin" />
            Fetching financial news from accredited sources...
          </div>
        ) : taggedNews.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-4">
            {filter !== "all" ? `No ${filter} news available.` : "No news available. Click refresh to fetch."}
          </div>
        ) : (
          taggedNews.map((item, i) => {
            const catConfig = CATEGORY_CONFIG[item.category || "general"];
            const CatIcon = catConfig?.icon || Newspaper;
            return (
              <a
                key={i}
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block p-2.5 rounded-md bg-secondary/40 hover:bg-secondary/70 border border-border/50 transition-all group hover:border-border"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    {/* Source + Category + Sentiment badges */}
                    <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                      {item.source && (
                        <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-semibold uppercase tracking-wider shrink-0">
                          {item.source}
                        </span>
                      )}
                      {item.category && item.category !== "general" && (
                        <span className={`flex items-center gap-0.5 text-[8px] px-1 py-0.5 rounded-full ${catConfig?.className || ""} shrink-0`}>
                          <CatIcon className="w-2 h-2" />
                          {catConfig?.label}
                        </span>
                      )}
                      {item.sentiment === "bullish" && (
                        <span className="flex items-center gap-0.5 text-[8px] px-1 py-0.5 rounded-full bg-gain/10 text-gain font-mono shrink-0">
                          <TrendingUp className="w-2 h-2" /> Bull
                        </span>
                      )}
                      {item.sentiment === "bearish" && (
                        <span className="flex items-center gap-0.5 text-[8px] px-1 py-0.5 rounded-full bg-loss/10 text-loss font-mono shrink-0">
                          <TrendingDown className="w-2 h-2" /> Bear
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] font-medium text-foreground group-hover:text-accent transition-colors line-clamp-2">
                      {item.title}
                    </div>
                    {item.description && (
                      <div className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">
                        {item.description}
                      </div>
                    )}
                  </div>
                  <ExternalLink className="w-3 h-3 text-muted-foreground/40 shrink-0 mt-0.5 group-hover:text-accent transition-colors" />
                </div>
              </a>
            );
          })
        )}
      </div>
    </div>
  );
}
