import { useState, useMemo } from "react";
import {
  BookOpen, Star, Download, Search, Filter, TrendingUp, TrendingDown,
  Clock, Target, Award, Edit3, Trash2, ChevronDown, ChevronUp,
  BarChart3, Flame, Calendar, Tag, FileText, X, Save,
} from "lucide-react";
import { JournalEntry, JournalStats } from "@/hooks/useTradeJournal";

interface TradeJournalProps {
  entries: JournalEntry[];
  stats: JournalStats;
  loading: boolean;
  onUpdateEntry: (id: string, updates: { notes?: string; rating?: number; tags?: string[]; lessons_learned?: string }) => void;
  onDeleteEntry: (id: string) => void;
  onExportCSV: () => void;
}

function StatsBar({ stats }: { stats: JournalStats }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-1.5">
      {[
        { label: "Trades", value: stats.totalTrades, color: "text-foreground" },
        { label: "Win Rate", value: `${stats.winRate.toFixed(1)}%`, color: stats.winRate >= 50 ? "text-gain" : "text-loss" },
        { label: "Total P&L", value: `${stats.totalPnl >= 0 ? "+" : ""}$${stats.totalPnl.toFixed(0)}`, color: stats.totalPnl >= 0 ? "text-gain" : "text-loss" },
        { label: "Avg P&L", value: `$${stats.avgPnl.toFixed(0)}`, color: stats.avgPnl >= 0 ? "text-gain" : "text-loss" },
        { label: "Best", value: `+$${stats.bestTrade.toFixed(0)}`, color: "text-gain" },
        { label: "Worst", value: `$${stats.worstTrade.toFixed(0)}`, color: "text-loss" },
        { label: "Avg Conf", value: `${stats.avgConfidence.toFixed(0)}%`, color: "text-accent" },
        { label: "Avg Hold", value: stats.avgHoldTime > 0 ? `${Math.floor(stats.avgHoldTime / 60000)}m` : "--", color: "text-muted-foreground" },
      ].map(s => (
        <div key={s.label} className="p-2 rounded-lg bg-secondary/40 text-center">
          <div className="text-[7px] text-muted-foreground uppercase tracking-wider">{s.label}</div>
          <div className={`text-xs font-mono font-bold ${s.color}`}>{s.value}</div>
        </div>
      ))}
    </div>
  );
}

function StarRating({ value, onChange }: { value: number | null; onChange: (v: number) => void }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(n => (
        <button key={n} onClick={() => onChange(n)} className="p-0.5 hover:scale-110 transition-transform">
          <Star className={`w-3.5 h-3.5 ${(value ?? 0) >= n ? "text-primary fill-primary" : "text-muted-foreground/30"}`} />
        </button>
      ))}
    </div>
  );
}

function JournalRow({ entry, onUpdate, onDelete }: {
  entry: JournalEntry;
  onUpdate: (id: string, u: any) => void;
  onDelete: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [notes, setNotes] = useState(entry.notes || "");
  const [lessons, setLessons] = useState(entry.lessons_learned || "");
  const [tagInput, setTagInput] = useState("");

  const isEntry = entry.trade_type === "entry";
  const isExit = entry.trade_type === "exit";
  const isPartial = entry.trade_type === "partial_exit";
  const pnlColor = (entry.pnl ?? 0) >= 0 ? "text-gain" : "text-loss";
  const holdMin = entry.holding_time_ms ? Math.floor(entry.holding_time_ms / 60000) : null;

  const handleSave = () => {
    const newTags = tagInput ? [...(entry.tags || []), ...tagInput.split(",").map(t => t.trim()).filter(Boolean)] : entry.tags;
    onUpdate(entry.id, { notes, lessons_learned: lessons, tags: newTags });
    setEditing(false);
    setTagInput("");
  };

  // Chart snapshot mini visualization
  const chartPreview = useMemo(() => {
    const snap = entry.chart_snapshot;
    if (!snap?.prices || snap.prices.length < 2) return null;
    const prices = snap.prices as number[];
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = max - min || 1;
    const w = 100; const h = 24;
    const step = w / (prices.length - 1);
    const points = prices.map((p: number, i: number) => `${i * step},${h - ((p - min) / range) * h}`).join(" ");
    const isUp = prices[prices.length - 1] >= prices[0];
    return (
      <svg width={w} height={h} className="overflow-visible">
        <polyline points={points} fill="none" stroke={isUp ? "hsl(var(--gain))" : "hsl(var(--loss))"} strokeWidth="1.5" strokeLinejoin="round" />
        {snap.tradePrice && (
          <circle cx={w - step} cy={h - ((snap.tradePrice - min) / range) * h} r="2.5" fill="hsl(var(--primary))" stroke="hsl(var(--background))" strokeWidth="1" />
        )}
      </svg>
    );
  }, [entry.chart_snapshot]);

  return (
    <div className={`border rounded-lg transition-colors ${expanded ? "border-primary/30 bg-card" : "border-border/50 bg-card/50 hover:bg-card"}`}>
      {/* Compact row */}
      <button onClick={() => setExpanded(!expanded)} className="w-full p-2.5 flex items-center gap-2 text-left">
        {/* Type badge */}
        <span className={`text-[8px] font-mono font-bold px-1.5 py-0.5 rounded ${
          isEntry ? "bg-accent/15 text-accent" : isPartial ? "bg-warning/15 text-warning" : "bg-primary/15 text-primary"
        }`}>
          {isEntry ? "ENTRY" : isPartial ? "PARTIAL" : "EXIT"}
        </span>

        {/* Symbol */}
        <span className="text-xs font-mono font-bold text-foreground w-14">{entry.symbol}</span>

        {/* Side */}
        <span className={`text-[9px] font-mono ${entry.side === "buy" ? "text-gain" : "text-loss"}`}>
          {entry.side === "buy" ? "▲ BUY" : "▼ SELL"}
        </span>

        {/* Price */}
        <span className="text-[10px] font-mono text-muted-foreground">${entry.filled_price.toFixed(2)}</span>

        {/* Qty */}
        <span className="text-[9px] font-mono text-muted-foreground">{entry.qty}sh</span>

        {/* Chart preview */}
        <div className="hidden sm:block">{chartPreview}</div>

        {/* P&L */}
        {entry.pnl !== null && (
          <span className={`text-[10px] font-mono font-bold ${pnlColor} ml-auto`}>
            {entry.pnl >= 0 ? "+" : ""}${entry.pnl.toFixed(2)}
            {entry.pnl_pct !== null && <span className="text-[8px] ml-0.5">({entry.pnl_pct.toFixed(1)}%)</span>}
          </span>
        )}

        {/* Confidence */}
        {entry.confidence !== null && (
          <span className="text-[9px] font-mono text-accent hidden md:inline">{entry.confidence}%</span>
        )}

        {/* Rating */}
        <div className="hidden md:flex gap-0.5">
          {[1, 2, 3, 4, 5].map(n => (
            <Star key={n} className={`w-2.5 h-2.5 ${(entry.rating ?? 0) >= n ? "text-primary fill-primary" : "text-muted-foreground/20"}`} />
          ))}
        </div>

        {/* Mode badge */}
        <span className={`text-[7px] font-mono px-1 py-0.5 rounded ${
          entry.mode === "live" ? "bg-loss/10 text-loss" : "bg-secondary text-muted-foreground"
        }`}>
          {entry.mode === "live" ? "LIVE" : "PAPER"}
        </span>

        {/* Time */}
        <span className="text-[9px] text-muted-foreground hidden lg:inline">
          {new Date(entry.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
        </span>

        <ChevronDown className={`w-3 h-3 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t border-border/30">
          {/* Trade details grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2">
            {entry.entry_price && (
              <div><div className="text-[7px] text-muted-foreground uppercase">Entry</div><div className="text-[10px] font-mono">${entry.entry_price.toFixed(2)}</div></div>
            )}
            {entry.exit_price && (
              <div><div className="text-[7px] text-muted-foreground uppercase">Exit</div><div className="text-[10px] font-mono">${entry.exit_price.toFixed(2)}</div></div>
            )}
            {entry.risk_reward && (
              <div><div className="text-[7px] text-muted-foreground uppercase">R:R</div><div className="text-[10px] font-mono text-accent">{entry.risk_reward.toFixed(1)}x</div></div>
            )}
            {entry.entry_quality && (
              <div><div className="text-[7px] text-muted-foreground uppercase">Quality</div><div className="text-[10px] font-mono">{entry.entry_quality}</div></div>
            )}
            {entry.signal_type && (
              <div><div className="text-[7px] text-muted-foreground uppercase">Signal</div><div className="text-[10px] font-mono">{entry.signal_type}</div></div>
            )}
            {entry.stat_edge_score && (
              <div><div className="text-[7px] text-muted-foreground uppercase">Stat Edge</div><div className="text-[10px] font-mono text-accent">{entry.stat_edge_score}</div></div>
            )}
            {holdMin !== null && (
              <div><div className="text-[7px] text-muted-foreground uppercase">Hold Time</div><div className="text-[10px] font-mono">{holdMin}m</div></div>
            )}
            {entry.sector && (
              <div><div className="text-[7px] text-muted-foreground uppercase">Sector</div><div className="text-[10px] font-mono">{entry.sector}</div></div>
            )}
            {entry.order_class && (
              <div><div className="text-[7px] text-muted-foreground uppercase">Order Class</div><div className="text-[10px] font-mono">{entry.order_class}</div></div>
            )}
            {entry.market_session && (
              <div><div className="text-[7px] text-muted-foreground uppercase">Session</div><div className="text-[10px] font-mono">{entry.market_session}</div></div>
            )}
          </div>

          {/* Chart snapshot */}
          {chartPreview && (
            <div>
              <div className="text-[8px] text-muted-foreground uppercase mb-1">Chart at Trade Time</div>
              <div className="bg-secondary/30 rounded p-2 flex items-center justify-center">
                <svg width={200} height={48} className="overflow-visible">
                  {(() => {
                    const snap = entry.chart_snapshot;
                    if (!snap?.prices) return null;
                    const prices = snap.prices as number[];
                    const min = Math.min(...prices);
                    const max = Math.max(...prices);
                    const range = max - min || 1;
                    const w = 200; const h = 48;
                    const step = w / (prices.length - 1);
                    const points = prices.map((p: number, i: number) => `${i * step},${h - ((p - min) / range) * h}`).join(" ");
                    const isUp = prices[prices.length - 1] >= prices[0];
                    return (
                      <>
                        <polyline points={points} fill="none" stroke={isUp ? "hsl(var(--gain))" : "hsl(var(--loss))"} strokeWidth="1.5" strokeLinejoin="round" />
                        {snap.tradePrice && (
                          <>
                            <line x1="0" y1={h - ((snap.tradePrice - min) / range) * h} x2={w} y2={h - ((snap.tradePrice - min) / range) * h}
                              stroke="hsl(var(--primary))" strokeWidth="0.5" strokeDasharray="3 3" opacity="0.5" />
                            <circle cx={w - step} cy={h - ((snap.tradePrice - min) / range) * h} r="3" fill="hsl(var(--primary))" />
                            <text x={w - step + 6} y={h - ((snap.tradePrice - min) / range) * h + 3} fill="hsl(var(--primary))" fontSize="8" fontFamily="monospace">
                              ${snap.tradePrice.toFixed(2)}
                            </text>
                          </>
                        )}
                        <text x="2" y="8" fill="hsl(var(--muted-foreground))" fontSize="7" fontFamily="monospace">H: ${max.toFixed(2)}</text>
                        <text x="2" y={h - 2} fill="hsl(var(--muted-foreground))" fontSize="7" fontFamily="monospace">L: ${min.toFixed(2)}</text>
                      </>
                    );
                  })()}
                </svg>
              </div>
            </div>
          )}

          {/* Tags */}
          {(entry.tags?.length > 0 || editing) && (
            <div>
              <div className="text-[8px] text-muted-foreground uppercase mb-1">Tags</div>
              <div className="flex flex-wrap gap-1">
                {entry.tags?.map((tag, i) => (
                  <span key={i} className="text-[9px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-mono">{tag}</span>
                ))}
                {editing && (
                  <input
                    value={tagInput}
                    onChange={e => setTagInput(e.target.value)}
                    placeholder="Add tags (comma-separated)"
                    className="text-[9px] px-1.5 py-0.5 rounded bg-secondary border border-border text-foreground w-40"
                  />
                )}
              </div>
            </div>
          )}

          {/* Notes & Lessons */}
          {editing ? (
            <div className="space-y-2">
              <div>
                <div className="text-[8px] text-muted-foreground uppercase mb-1">Notes</div>
                <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
                  className="w-full text-[10px] p-2 rounded bg-secondary border border-border text-foreground resize-none" placeholder="Trade notes..." />
              </div>
              <div>
                <div className="text-[8px] text-muted-foreground uppercase mb-1">Lessons Learned</div>
                <textarea value={lessons} onChange={e => setLessons(e.target.value)} rows={2}
                  className="w-full text-[10px] p-2 rounded bg-secondary border border-border text-foreground resize-none" placeholder="What did you learn?" />
              </div>
              <div>
                <div className="text-[8px] text-muted-foreground uppercase mb-1">Rating</div>
                <StarRating value={entry.rating} onChange={v => onUpdate(entry.id, { rating: v })} />
              </div>
            </div>
          ) : (
            <>
              {entry.notes && (
                <div>
                  <div className="text-[8px] text-muted-foreground uppercase mb-0.5">Notes</div>
                  <p className="text-[10px] text-foreground/80">{entry.notes}</p>
                </div>
              )}
              {entry.lessons_learned && (
                <div>
                  <div className="text-[8px] text-muted-foreground uppercase mb-0.5">Lessons Learned</div>
                  <p className="text-[10px] text-foreground/80">{entry.lessons_learned}</p>
                </div>
              )}
            </>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            <StarRating value={entry.rating} onChange={v => onUpdate(entry.id, { rating: v })} />
            <div className="flex-1" />
            {editing ? (
              <button onClick={handleSave} className="text-[9px] px-2 py-1 rounded bg-primary/15 text-primary hover:bg-primary/25 flex items-center gap-1">
                <Save className="w-3 h-3" /> Save
              </button>
            ) : (
              <button onClick={() => setEditing(true)} className="text-[9px] px-2 py-1 rounded bg-secondary text-muted-foreground hover:text-foreground flex items-center gap-1">
                <Edit3 className="w-3 h-3" /> Edit
              </button>
            )}
            <button onClick={() => { if (confirm("Delete this journal entry?")) onDelete(entry.id); }}
              className="text-[9px] px-2 py-1 rounded bg-loss/10 text-loss hover:bg-loss/20 flex items-center gap-1">
              <Trash2 className="w-3 h-3" /> Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function TradeJournal({ entries, stats, loading, onUpdateEntry, onDeleteEntry, onExportCSV }: TradeJournalProps) {
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<"all" | "entry" | "exit" | "partial_exit">("all");
  const [filterMode, setFilterMode] = useState<"all" | "paper" | "live">("all");
  const [sortBy, setSortBy] = useState<"date" | "pnl" | "symbol">("date");

  const filtered = useMemo(() => {
    let result = entries;
    if (filterType !== "all") result = result.filter(e => e.trade_type === filterType);
    if (filterMode !== "all") result = result.filter(e => e.mode === filterMode);
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(e => e.symbol.toLowerCase().includes(q) || (e.notes || "").toLowerCase().includes(q) || (e.tags || []).some(t => t.toLowerCase().includes(q)));
    }
    if (sortBy === "pnl") result = [...result].sort((a, b) => Math.abs(b.pnl ?? 0) - Math.abs(a.pnl ?? 0));
    else if (sortBy === "symbol") result = [...result].sort((a, b) => a.symbol.localeCompare(b.symbol));
    return result;
  }, [entries, filterType, filterMode, search, sortBy]);

  return (
    <div className="bg-card rounded-xl border border-border p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-primary" />
          Trade Journal
          <span className="text-[9px] font-mono text-muted-foreground bg-secondary px-1.5 py-0.5 rounded">{entries.length} entries</span>
        </h3>
        <button onClick={onExportCSV} className="text-[9px] px-2 py-1 rounded bg-secondary text-muted-foreground hover:text-foreground flex items-center gap-1">
          <Download className="w-3 h-3" /> Export CSV
        </button>
      </div>

      {/* Stats */}
      <StatsBar stats={stats} />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[120px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search symbol, notes, tags..."
            className="w-full text-[10px] pl-6 pr-2 py-1.5 rounded bg-secondary border border-border text-foreground" />
        </div>
        <div className="flex gap-0.5 bg-secondary/50 rounded-lg p-0.5">
          {(["all", "entry", "exit", "partial_exit"] as const).map(t => (
            <button key={t} onClick={() => setFilterType(t)}
              className={`text-[9px] px-2 py-1 rounded font-mono transition-colors ${filterType === t ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
              {t === "partial_exit" ? "Partial" : t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        <div className="flex gap-0.5 bg-secondary/50 rounded-lg p-0.5">
          {(["all", "paper", "live"] as const).map(m => (
            <button key={m} onClick={() => setFilterMode(m)}
              className={`text-[9px] px-2 py-1 rounded font-mono transition-colors ${filterMode === m
                ? m === "live" ? "bg-loss/15 text-loss" : "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"}`}>
              {m.charAt(0).toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
        <select value={sortBy} onChange={e => setSortBy(e.target.value as any)}
          className="text-[9px] px-2 py-1.5 rounded bg-secondary border border-border text-foreground">
          <option value="date">Sort: Date</option>
          <option value="pnl">Sort: P&L</option>
          <option value="symbol">Sort: Symbol</option>
        </select>
      </div>

      {/* Entries */}
      <div className="space-y-1.5 max-h-[500px] overflow-y-auto scrollbar-hide">
        {loading ? (
          <div className="text-center py-8 text-muted-foreground text-xs">Loading journal...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-xs">
            {entries.length === 0 ? "No journal entries yet. Enable auto-trading with Alpaca to start logging." : "No entries match your filters."}
          </div>
        ) : (
          filtered.map(entry => (
            <JournalRow key={entry.id} entry={entry} onUpdate={onUpdateEntry} onDelete={onDeleteEntry} />
          ))
        )}
      </div>
    </div>
  );
}
