import { useState, useMemo, useCallback } from "react";
import { RefreshCw, Loader2, Search, ChevronDown, ChevronUp, X, SlidersHorizontal, Bookmark, Star } from "lucide-react";
import { TickerData, IndexData, STOCK_SIZE_CONFIG, VOLUME_CONFIG, StockSize, VolumeLevel, isCryptoSymbol } from "@/hooks/useWebullData";

interface MarketTickerProps {
  tickers: Record<string, TickerData>;
  indices: IndexData[];
  selectedSymbol: string;
  onSelect: (symbol: string) => void;
  loading: boolean;
  lastUpdated: string;
  nextRefreshIn: number;
  dataSource: "live" | "cached" | "fallback" | "alpaca";
  onRefresh: () => void;
  sourcesUsed?: string[];
}

type SortMode = "default" | "profit_exp" | "change_desc" | "change_asc" | "volume" | "price_desc" | "price_asc" | "name";
type CategoryFilter = "all" | "gainer" | "loser" | "active";
type AssetTypeFilter = "all" | "crypto" | "stocks";

interface FilterState {
  category: CategoryFilter;
  size: StockSize | "all";
  volume: VolumeLevel | "all";
  minPrice: string;
  maxPrice: string;
  excludePenny: boolean;
  sort: SortMode;
  assetType: AssetTypeFilter;
}

const DEFAULT_FILTERS: FilterState = {
  category: "all", size: "all", volume: "all",
  minPrice: "", maxPrice: "", excludePenny: false, sort: "profit_exp", assetType: "all",
};

interface FilterPreset {
  name: string;
  icon: string;
  description: string;
  filters: Partial<FilterState>;
}

const BUILT_IN_PRESETS: FilterPreset[] = [
  {
    name: "Top Profit Exp",
    icon: "🔥",
    description: "Highest profitability expectancy",
    filters: { excludePenny: true, sort: "profit_exp" },
  },
  {
    name: "Blue Chips Only",
    icon: "💎",
    description: "Top-tier established companies",
    filters: { size: "bluechip", excludePenny: true, sort: "profit_exp" },
  },
  {
    name: "Big Movers",
    icon: "🚀",
    description: "Highest % change today",
    filters: { excludePenny: true, sort: "change_desc", minPrice: "5" },
  },
  {
    name: "High Volume",
    icon: "📊",
    description: "Most actively traded stocks",
    filters: { volume: "ultra", excludePenny: true, sort: "volume" },
  },
  {
    name: "Safe Picks",
    icon: "🛡️",
    description: "Large+ stocks, no penny/micro",
    filters: { minPrice: "50", excludePenny: true, sort: "price_desc" },
  },
  {
    name: "Mid-Cap Gems",
    icon: "⚡",
    description: "$20-$100 range stocks",
    filters: { size: "mid", excludePenny: true, sort: "change_desc" },
  },
  {
    name: "Bargain Hunt",
    icon: "🔍",
    description: "Small caps $5-$20",
    filters: { size: "small", excludePenny: true, sort: "volume" },
  },
  {
    name: "Crypto Only",
    icon: "₿",
    description: "All cryptocurrency pairs",
    filters: { category: "all", sort: "change_desc", assetType: "crypto" },
  },
  {
    name: "Stocks Only",
    icon: "🏢",
    description: "Traditional equities only",
    filters: { category: "all", sort: "profit_exp", assetType: "stocks" },
  },
  {
    name: "Gainers",
    icon: "📈",
    description: "Today's winners",
    filters: { category: "gainer", excludePenny: true, sort: "change_desc" },
  },
  {
    name: "Losers (Dip Buy)",
    icon: "📉",
    description: "Biggest drops — potential dip buys",
    filters: { category: "loser", excludePenny: true, minPrice: "10", sort: "change_asc" },
  },
];

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: "profit_exp", label: "🔥 Profit Exp ↓" },
  { value: "default", label: "Default" },
  { value: "change_desc", label: "% Change ↓" },
  { value: "change_asc", label: "% Change ↑" },
  { value: "price_desc", label: "Price ↓" },
  { value: "price_asc", label: "Price ↑" },
  { value: "volume", label: "Volume ↓" },
  { value: "name", label: "Name A-Z" },
];

const SIZE_OPTIONS: { value: StockSize | "all"; label: string; color: string }[] = [
  { value: "all", label: "All Sizes", color: "text-foreground" },
  { value: "bluechip", label: "💎 Blue Chip", color: STOCK_SIZE_CONFIG.bluechip.color },
  { value: "mega", label: "Mega $500+", color: STOCK_SIZE_CONFIG.mega.color },
  { value: "large", label: "Large $100+", color: STOCK_SIZE_CONFIG.large.color },
  { value: "mid", label: "Mid $20+", color: STOCK_SIZE_CONFIG.mid.color },
  { value: "small", label: "Small $5+", color: STOCK_SIZE_CONFIG.small.color },
  { value: "micro", label: "Micro $1+", color: STOCK_SIZE_CONFIG.micro.color },
  { value: "penny", label: "⚠ Penny <$1", color: STOCK_SIZE_CONFIG.penny.color },
];

const VOL_OPTIONS: { value: VolumeLevel | "all"; label: string }[] = [
  { value: "all", label: "All Volume" },
  { value: "ultra", label: "Ultra 100M+" },
  { value: "high", label: "High 30M+" },
  { value: "moderate", label: "Moderate 5M+" },
  { value: "low", label: "Low 1M+" },
  { value: "thin", label: "Thin <1M" },
];

function parseVolume(v: string): number {
  const raw = v.replace(/[^\d.]/g, "");
  let vol = parseFloat(raw) || 0;
  if (v.includes("B")) vol *= 1000;
  else if (v.includes("K")) vol /= 1000;
  return vol;
}

const PRESETS_STORAGE_KEY = "neuraltrade_filter_presets";

function loadCustomPresets(): FilterPreset[] {
  try {
    const raw = localStorage.getItem(PRESETS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveCustomPresets(presets: FilterPreset[]) {
  localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(presets));
}

export function MarketTicker({ tickers, indices, selectedSymbol, onSelect, loading, lastUpdated, nextRefreshIn, dataSource, onRefresh, sourcesUsed }: MarketTickerProps) {
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<FilterState>({ ...DEFAULT_FILTERS });
  const [showFilters, setShowFilters] = useState(false);
  const [showPresets, setShowPresets] = useState(false);
  const [activePresetName, setActivePresetName] = useState<string | null>(null);
  const [customPresets, setCustomPresets] = useState<FilterPreset[]>(loadCustomPresets);

  const allPresets = useMemo(() => [...BUILT_IN_PRESETS, ...customPresets], [customPresets]);

  const updateFilter = useCallback(<K extends keyof FilterState>(key: K, value: FilterState[K]) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setActivePresetName(null); // clear active preset when manually changing
  }, []);

  const activeFilterCount = useMemo(() => {
    let c = 0;
    if (filters.category !== "all") c++;
    if (filters.size !== "all") c++;
    if (filters.volume !== "all") c++;
    if (filters.minPrice) c++;
    if (filters.maxPrice) c++;
    if (filters.excludePenny) c++;
    if (filters.sort !== "default") c++;
    if (filters.assetType !== "all") c++;
    return c;
  }, [filters]);

  const clearAllFilters = useCallback(() => {
    setFilters({ ...DEFAULT_FILTERS });
    setSearch("");
    setActivePresetName(null);
  }, []);

  const applyPreset = useCallback((preset: FilterPreset) => {
    setFilters({ ...DEFAULT_FILTERS, ...preset.filters });
    setActivePresetName(preset.name);
    setShowPresets(false);
    setSearch("");
  }, []);

  const saveCurrentAsPreset = useCallback(() => {
    const name = prompt("Preset name:");
    if (!name?.trim()) return;
    const newPreset: FilterPreset = {
      name: name.trim(),
      icon: "⭐",
      description: "Custom filter preset",
      filters: { ...filters },
    };
    const updated = [...customPresets, newPreset];
    setCustomPresets(updated);
    saveCustomPresets(updated);
    setActivePresetName(name.trim());
  }, [filters, customPresets]);

  const deleteCustomPreset = useCallback((name: string) => {
    const updated = customPresets.filter(p => p.name !== name);
    setCustomPresets(updated);
    saveCustomPresets(updated);
    if (activePresetName === name) setActivePresetName(null);
  }, [customPresets, activePresetName]);

  const tickerList = useMemo(() => {
    let list = Object.values(tickers);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(t => t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q));
    }
    if (filters.assetType === "crypto") list = list.filter(t => isCryptoSymbol(t.symbol));
    if (filters.assetType === "stocks") list = list.filter(t => !isCryptoSymbol(t.symbol));
    if (filters.category !== "all") list = list.filter(t => t.category === filters.category);
    if (filters.size !== "all") list = list.filter(t => t.stockSize === filters.size);
    if (filters.volume !== "all") list = list.filter(t => t.volumeLevel === filters.volume);
    if (filters.excludePenny) list = list.filter(t => t.stockSize !== "penny");
    if (filters.minPrice) {
      const min = parseFloat(filters.minPrice);
      if (!isNaN(min)) list = list.filter(t => parseFloat(t.price) >= min);
    }
    if (filters.maxPrice) {
      const max = parseFloat(filters.maxPrice);
      if (!isNaN(max)) list = list.filter(t => parseFloat(t.price) <= max);
    }
    switch (filters.sort) {
      case "profit_exp": list.sort((a, b) => b.profitExpectancy - a.profitExpectancy); break;
      case "change_desc": list.sort((a, b) => parseFloat(b.priceChangePercent) - parseFloat(a.priceChangePercent)); break;
      case "change_asc": list.sort((a, b) => parseFloat(a.priceChangePercent) - parseFloat(b.priceChangePercent)); break;
      case "volume": list.sort((a, b) => parseVolume(b.volume) - parseVolume(a.volume)); break;
      case "price_desc": list.sort((a, b) => parseFloat(b.price) - parseFloat(a.price)); break;
      case "price_asc": list.sort((a, b) => parseFloat(a.price) - parseFloat(b.price)); break;
      case "name": list.sort((a, b) => a.name.localeCompare(b.name)); break;
    }
    return list;
  }, [tickers, search, filters]);

  return (
    <div className="border-b border-border bg-card/60 backdrop-blur-sm">
      {/* Index bar */}
      {indices.length > 0 && (
        <div className="flex items-center gap-4 px-4 py-1.5 border-b border-border/50 overflow-x-auto scrollbar-thin">
          {indices.map(idx => {
            const isPositive = idx.change.startsWith("+") || (!idx.change.startsWith("-") && !idx.change.includes("-"));
            return (
              <div key={idx.symbol} className="flex items-center gap-2 text-[11px] font-mono shrink-0">
                <span className="text-foreground font-semibold">{idx.symbol}</span>
                <span className="text-muted-foreground">{idx.price}</span>
                <span className={isPositive ? "text-gain" : "text-loss"}>{idx.change}</span>
              </div>
            );
          })}
          <div className="ml-auto flex items-center gap-2 shrink-0">
            {sourcesUsed && sourcesUsed.length > 0 && (
              <div className="flex items-center gap-1">
                {sourcesUsed.map(src => (
                  <span key={src} className="text-[7px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-semibold tracking-wider uppercase">
                    {src}
                  </span>
                ))}
              </div>
            )}
            <span className={`text-[8px] px-1.5 py-0.5 rounded-full font-semibold uppercase tracking-wider ${
              dataSource === "alpaca" ? "bg-primary/15 text-primary" :
              dataSource === "live" ? "bg-gain/15 text-gain" :
              dataSource === "cached" ? "bg-warning/15 text-warning" :
              "bg-muted text-muted-foreground"
            }`}>
              {dataSource === "alpaca" ? "● Alpaca Live" : dataSource === "live" ? "● Live" : dataSource === "cached" ? "● Cached" : "● Default"}
            </span>
            {lastUpdated && <span className="text-[9px] text-muted-foreground/60 font-mono">{lastUpdated}</span>}
            {nextRefreshIn > 0 && !loading && (
              <span className="text-[8px] text-muted-foreground/40 font-mono tabular-nums">
                {Math.floor(nextRefreshIn / 60)}:{(nextRefreshIn % 60).toString().padStart(2, "0")}
              </span>
            )}
            <button onClick={onRefresh} disabled={loading}
              className="p-1 rounded hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground disabled:opacity-50">
              {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            </button>
          </div>
        </div>
      )}

      {/* Main filter bar */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border/30">
        {/* Search */}
        <div className="relative flex-1 max-w-[180px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search..."
            className="w-full pl-7 pr-6 py-1 text-[10px] bg-secondary/50 border border-border/50 rounded focus:outline-none focus:ring-1 focus:ring-primary/50 text-foreground placeholder:text-muted-foreground font-mono" />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Quick category pills */}
        <div className="flex gap-0.5">
          {(["all", "gainer", "loser", "active"] as const).map(cat => (
            <button key={cat} onClick={() => updateFilter("category", cat)}
              className={`text-[9px] px-1.5 py-0.5 rounded font-medium transition-colors ${
                filters.category === cat
                  ? cat === "gainer" ? "bg-gain/15 text-gain" : cat === "loser" ? "bg-loss/15 text-loss" : cat === "active" ? "bg-accent/15 text-accent" : "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}>
              {cat === "all" ? "All" : cat === "gainer" ? "▲" : cat === "loser" ? "▼" : "◆"}
            </button>
          ))}
        </div>

        {/* Asset type toggle: separate crypto from stocks */}
        <div className="flex gap-0.5 border-l border-border/40 pl-1.5 ml-0.5">
          {(["all", "stocks", "crypto"] as const).map(at => (
            <button key={at} onClick={() => updateFilter("assetType", at)}
              title={at === "all" ? "All assets" : at === "stocks" ? "Stocks only" : "Crypto only"}
              className={`text-[9px] px-1.5 py-0.5 rounded font-semibold transition-colors ${
                filters.assetType === at
                  ? at === "crypto" ? "bg-warning/15 text-warning" : at === "stocks" ? "bg-primary/15 text-primary" : "bg-accent/15 text-accent"
                  : "text-muted-foreground hover:text-foreground"
              }`}>
              {at === "all" ? "ALL" : at === "stocks" ? "🏢" : "₿"}
            </button>
          ))}
        </div>

        {/* Quick stock size dropdown */}
        <select value={filters.size} onChange={e => updateFilter("size", e.target.value as StockSize | "all")}
          className="text-[9px] bg-secondary/50 border border-border/50 rounded px-1 py-0.5 text-muted-foreground font-mono focus:outline-none max-w-[100px]">
          {SIZE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        {/* Quick volume dropdown */}
        <select value={filters.volume} onChange={e => updateFilter("volume", e.target.value as VolumeLevel | "all")}
          className="text-[9px] bg-secondary/50 border border-border/50 rounded px-1 py-0.5 text-muted-foreground font-mono focus:outline-none max-w-[95px]">
          {VOL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        {/* Sort */}
        <select value={filters.sort} onChange={e => updateFilter("sort", e.target.value as SortMode)}
          className="text-[9px] bg-secondary/50 border border-border/50 rounded px-1 py-0.5 text-muted-foreground font-mono focus:outline-none max-w-[90px]">
          {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        {/* Presets button */}
        <button onClick={() => { setShowPresets(!showPresets); setShowFilters(false); }}
          className={`flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded font-medium transition-colors ${
            showPresets || activePresetName ? "bg-accent/15 text-accent" : "text-muted-foreground hover:text-foreground"
          }`}>
          <Bookmark className="w-3 h-3" />
          {activePresetName ? <span className="max-w-[60px] truncate">{activePresetName}</span> : "Presets"}
        </button>

        {/* Advanced filters toggle */}
        <button onClick={() => { setShowFilters(!showFilters); setShowPresets(false); }}
          className={`flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded font-medium transition-colors ${
            showFilters || activeFilterCount > 0 ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"
          }`}>
          <SlidersHorizontal className="w-3 h-3" />
          {activeFilterCount > 0 && (
            <span className="bg-primary text-primary-foreground text-[8px] px-1 rounded-full font-bold">{activeFilterCount}</span>
          )}
        </button>

        <span className="text-[9px] text-muted-foreground font-mono ml-auto">{tickerList.length}</span>
      </div>

      {/* Presets Panel */}
      {showPresets && (
        <div className="px-3 py-2 border-b border-border/30 bg-secondary/20">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-semibold text-foreground">Filter Presets</span>
            <button onClick={saveCurrentAsPreset}
              className="flex items-center gap-1 text-[8px] px-2 py-0.5 rounded bg-primary/10 text-primary hover:bg-primary/20 font-semibold transition-colors">
              <Star className="w-2.5 h-2.5" />
              Save current
            </button>
          </div>
          <div className="grid grid-cols-4 gap-1">
            {allPresets.map(preset => {
              const isActive = activePresetName === preset.name;
              const isCustom = customPresets.some(c => c.name === preset.name);
              return (
                <button key={preset.name} onClick={() => applyPreset(preset)}
                  className={`relative text-left px-2 py-1.5 rounded-md text-[9px] transition-all ${
                    isActive
                      ? "bg-accent/15 border border-accent/30 text-accent"
                      : "bg-secondary/40 hover:bg-secondary/80 text-muted-foreground hover:text-foreground"
                  }`}>
                  <div className="flex items-center gap-1">
                    <span>{preset.icon}</span>
                    <span className="font-semibold truncate">{preset.name}</span>
                  </div>
                  <div className="text-[8px] text-muted-foreground mt-0.5 truncate">{preset.description}</div>
                  {isCustom && (
                    <button onClick={e => { e.stopPropagation(); deleteCustomPreset(preset.name); }}
                      className="absolute top-1 right-1 text-muted-foreground hover:text-loss">
                      <X className="w-2.5 h-2.5" />
                    </button>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Advanced Filters Panel */}
      {showFilters && (
        <div className="px-3 py-2 border-b border-border/30 bg-secondary/20 space-y-1.5">
          {/* Price Range + Exclude Penny */}
          <div className="flex items-center gap-3">
            <span className="text-[9px] text-muted-foreground font-semibold w-12 shrink-0">Price:</span>
            <div className="flex items-center gap-1">
              <span className="text-[9px] text-muted-foreground">$</span>
              <input type="number" value={filters.minPrice} onChange={e => updateFilter("minPrice", e.target.value)}
                placeholder="Min" min="0" step="1"
                className="w-14 text-[9px] px-1.5 py-0.5 bg-secondary/50 border border-border/50 rounded font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50" />
              <span className="text-[9px] text-muted-foreground">—</span>
              <span className="text-[9px] text-muted-foreground">$</span>
              <input type="number" value={filters.maxPrice} onChange={e => updateFilter("maxPrice", e.target.value)}
                placeholder="Max" min="0" step="1"
                className="w-14 text-[9px] px-1.5 py-0.5 bg-secondary/50 border border-border/50 rounded font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50" />
            </div>

            <label className="flex items-center gap-1 cursor-pointer ml-2">
              <input type="checkbox" checked={filters.excludePenny} onChange={e => updateFilter("excludePenny", e.target.checked)}
                className="w-3 h-3 rounded border-border accent-primary" />
              <span className="text-[9px] text-muted-foreground font-medium">No penny stocks</span>
            </label>

            {activeFilterCount > 0 && (
              <button onClick={clearAllFilters}
                className="ml-auto text-[8px] px-2 py-0.5 rounded bg-loss/10 text-loss hover:bg-loss/20 font-semibold transition-colors flex items-center gap-1">
                <X className="w-2.5 h-2.5" /> Clear all
              </button>
            )}
          </div>
        </div>
      )}

      {/* Stock ticker strip */}
      <div className="flex gap-1 px-2 py-1.5 overflow-x-auto scrollbar-thin">
        {loading && tickerList.length === 0 ? (
          <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading market data...
          </div>
        ) : tickerList.length === 0 ? (
          <div className="flex flex-col items-center gap-1 px-3 py-2 w-full">
            <span className="text-xs text-muted-foreground">
              {search ? `No results for "${search}"` : "No stocks match filters"}
            </span>
            {activeFilterCount > 0 && (
              <button onClick={clearAllFilters} className="text-[10px] text-primary hover:underline">Clear filters</button>
            )}
          </div>
        ) : (
          tickerList.map(t => {
            const isPositive = parseFloat(t.priceChangePercent) >= 0;
            const isSelected = t.symbol === selectedSymbol;
            const sizeConf = STOCK_SIZE_CONFIG[t.stockSize];
            const volConf = VOLUME_CONFIG[t.volumeLevel];
            return (
              <button key={t.symbol} onClick={() => onSelect(t.symbol)}
                className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[11px] font-mono transition-all shrink-0 ${
                  isSelected
                    ? "bg-accent/15 border border-accent/30 text-accent shadow-sm"
                    : "hover:bg-secondary text-muted-foreground hover:text-foreground"
                }`}>
                <div className="flex flex-col items-start">
                  <div className="flex items-center gap-1">
                    <span className={`font-semibold ${isSelected ? "text-foreground" : ""}`}>{t.symbol}</span>
                    <span className={`text-[9px] px-1 rounded ${
                      t.category === "gainer" ? "bg-gain/10 text-gain" :
                      t.category === "loser" ? "bg-loss/10 text-loss" :
                      "bg-accent/10 text-accent"
                    }`}>
                      {t.category === "gainer" ? "↑" : t.category === "loser" ? "↓" : "◆"}
                    </span>
                  </div>
                  <span className="text-[9px] text-muted-foreground truncate max-w-[80px]">{t.name}</span>
                  <div className="flex items-center gap-0.5 mt-0.5">
                    <span className={`text-[7px] px-1 py-px rounded bg-secondary/80 font-semibold ${sizeConf.color}`}>
                      {sizeConf.label}
                    </span>
                    <span className={`text-[7px] px-1 py-px rounded bg-secondary/80 font-semibold ${volConf.color}`}>
                      {volConf.label}
                    </span>
                    {t.sources && t.sources.length > 1 && (
                      <span className="text-[7px] px-1 py-px rounded bg-primary/10 text-primary font-semibold" title={`Verified: ${t.sources.join(", ")}`}>
                        ✓{t.sources.length}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex flex-col items-end">
                  <span className="text-foreground">${t.price !== "0" ? parseFloat(t.price).toLocaleString() : "--"}</span>
                  <span className={`text-[10px] ${isPositive ? "text-gain" : "text-loss"}`}>
                    {isPositive ? "+" : ""}{t.priceChangePercent}%
                  </span>
                  <div className="flex items-center gap-1">
                    <span className="text-[8px] text-muted-foreground">{t.volume}</span>
                    <span className={`text-[7px] px-1 py-px rounded font-bold ${
                      t.profitExpectancy >= 75 ? "bg-gain/15 text-gain" :
                      t.profitExpectancy >= 50 ? "bg-primary/15 text-primary" :
                      t.profitExpectancy >= 30 ? "bg-warning/15 text-warning" :
                      "bg-muted text-muted-foreground"
                    }`} title="Profit Expectancy Score">
                      PE:{t.profitExpectancy}
                    </span>
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
