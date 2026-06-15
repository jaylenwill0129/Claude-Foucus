import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import {
  BookOpen, Plus, Search, Star, ExternalLink, Trash2, Edit3, Save,
  ArrowLeft, Database, Bitcoin, TrendingUp, BarChart3, Scale, Brain,
  ChevronDown, ChevronUp, Lightbulb, Link2, Tag, Filter
} from "lucide-react";
import { useNavigate } from "react-router-dom";

interface ResearchNote {
  id: string;
  user_id: string;
  topic: string;
  title: string;
  content: string;
  category: string;
  tags: string[];
  source_urls: string[];
  is_actionable: boolean;
  priority: number;
  created_at: string;
  updated_at: string;
}

const RESEARCH_TOPICS = [
  { id: "polymarket-db", label: "Polymarket DB Architecture", icon: Database, color: "text-violet-400" },
  { id: "bitcoin-db", label: "Bitcoin Data Capture", icon: Bitcoin, color: "text-amber-400" },
  { id: "bitcoin-historic", label: "Historic Bitcoin Data", icon: BarChart3, color: "text-orange-400" },
  { id: "polymarket-historic", label: "Historic Polymarket Data", icon: TrendingUp, color: "text-blue-400" },
  { id: "momentum-algos", label: "Momentum & Direction Prediction", icon: Brain, color: "text-emerald-400" },
  { id: "fair-price-arb", label: "Fair Price & Statistical Arbitrage", icon: Scale, color: "text-rose-400" },
] as const;

const SEED_RESEARCH: Omit<ResearchNote, "id" | "user_id" | "created_at" | "updated_at">[] = [
  // Polymarket DB Architecture
  {
    topic: "polymarket-db",
    title: "Polymarket's Production Architecture: Postgres + ClickHouse",
    content: `**How Polymarket scales their data stack:**

Polymarket started with PostgreSQL for everything—trading, dashboards, APIs. As they grew to $7B+/month volume, they hit Postgres limits on analytical queries.

**Current Architecture:**
- **PostgreSQL** — Core transactional data (trades, orders, user state)
- **ClickHouse** — Analytical warehouse for aggregations, leaderboards, heavy queries
- **Goldsky** — Indexes on-chain data, provides ClickHouse sink for streaming blockchain events
- **Batch sync** — Off-chain metadata (profiles, market metadata) syncs from Postgres → ClickHouse via PostgreSQL Table Engine

**Key Design Decisions:**
1. Don't replace Postgres—complement it. Postgres handles OLTP, ClickHouse handles OLAP
2. Leaderboard modeled as aggregated materialized data inside ClickHouse
3. API layer (Go + ClickHouse Go client) queries ClickHouse views
4. Raw trades flow from blockchain → Goldsky → ClickHouse in real-time

**For our implementation:**
- Use Supabase (Postgres) for user data, positions, trades
- Consider TimescaleDB extension for time-series price data
- For heavy analytics, pre-compute aggregations in edge functions
- Store market snapshots with hypertable-like partitioning by time`,
    category: "architecture",
    tags: ["postgres", "clickhouse", "polymarket", "database", "architecture"],
    source_urls: ["https://clickhouse.com/blog/how-polymarket-scales-data-with-postgres-and-clickhouse"],
    is_actionable: true,
    priority: 5,
  },
  {
    topic: "polymarket-db",
    title: "Polymarket's Three API Layers",
    content: `**Polymarket exposes 3 distinct APIs:**

| API | Purpose | Auth Required? | Base URL |
|-----|---------|----------------|----------|
| **Gamma** | Market metadata, events, search | No | gamma-api.polymarket.com |
| **CLOB** | Trading, order book, order management | Yes (API key + L1/L2 auth) | clob.polymarket.com |
| **Data** | Historical activity, profiles | No | data-api.polymarket.com |

**Gamma API (Discovery):**
- \`GET /events\` — List events with markets
- \`GET /markets\` — Search/filter markets
- No auth needed — great for data collection

**CLOB API (Trading):**
- \`GET /order-book/{token_id}\` — Live order book
- \`POST /order\` — Place orders (requires API credentials)
- WebSocket for real-time order book updates

**Data API (Historical):**
- \`GET /activity\` — Recent global activity feed
- \`GET /trades\` — Historical trade data
- Perfect for backtesting and training

**Recommended DB Schema for Capture:**
\`\`\`sql
-- Markets table
CREATE TABLE polymarket_markets (
  id TEXT PRIMARY KEY,
  question TEXT,
  description TEXT,
  outcomes JSONB,
  end_date TIMESTAMPTZ,
  volume NUMERIC,
  liquidity NUMERIC,
  last_price JSONB,
  captured_at TIMESTAMPTZ DEFAULT now()
);

-- Price snapshots (time-series)
CREATE TABLE polymarket_prices (
  market_id TEXT REFERENCES polymarket_markets(id),
  outcome_index INT,
  price NUMERIC,
  volume_24h NUMERIC,
  captured_at TIMESTAMPTZ DEFAULT now()
);
-- Create index on (market_id, captured_at)
\`\`\``,
    category: "api",
    tags: ["polymarket", "api", "gamma", "clob", "data", "schema"],
    source_urls: ["https://pm.wiki/learn/polymarket-api"],
    is_actionable: true,
    priority: 4,
  },

  // Bitcoin Data Capture
  {
    topic: "bitcoin-db",
    title: "Real-Time Bitcoin Data Pipeline Architecture",
    content: `**Best architecture for live Bitcoin data capture:**

**Option 1: Kappa Architecture (Recommended for our scale)**
\`\`\`
Binance WebSocket → Edge Function → Supabase (Postgres) → Realtime subscriptions
\`\`\`

**Option 2: Full CDC Pipeline (Enterprise)**
\`\`\`
Binance API → PostgreSQL → Debezium (CDC) → Kafka → Cassandra → Grafana
\`\`\`

**Option 3: TimescaleDB (Best for time-series)**
\`\`\`
Kraken/Binance WS → TimescaleDB (hypertables) → Continuous Aggregates → Dashboard
\`\`\`

**Recommended Schema:**
\`\`\`sql
-- Raw trades
CREATE TABLE btc_trades (
  id BIGSERIAL,
  exchange TEXT,
  price NUMERIC(20, 8),
  quantity NUMERIC(20, 8),
  side TEXT, -- 'buy' or 'sell'
  trade_time TIMESTAMPTZ,
  captured_at TIMESTAMPTZ DEFAULT now()
);

-- OHLCV candles (aggregated)
CREATE TABLE btc_candles (
  exchange TEXT,
  interval TEXT, -- '1m', '5m', '1h', '1d'
  open_time TIMESTAMPTZ,
  open NUMERIC(20, 8),
  high NUMERIC(20, 8),
  low NUMERIC(20, 8),
  close NUMERIC(20, 8),
  volume NUMERIC(20, 8),
  PRIMARY KEY (exchange, interval, open_time)
);
\`\`\`

**Key considerations:**
- Binance WS gives ~100 trades/sec for BTCUSDT
- Store raw trades for ML training, pre-aggregate for display
- Use continuous aggregates or materialized views for OHLCV
- Partition by time (monthly) for query performance`,
    category: "architecture",
    tags: ["bitcoin", "real-time", "websocket", "timescale", "database"],
    source_urls: [
      "https://dev.to/augo_amos/real-time-crypto-data-pipeline-with-change-data-capture-cdc-using-postgresql-kafka-cassandra-3ip7",
      "https://medium.com/@aw_marcell/real-time-data-streaming-project-bitcoin-live-price-dashboard-dda614c28177"
    ],
    is_actionable: true,
    priority: 5,
  },

  // Historic Bitcoin Data
  {
    topic: "bitcoin-historic",
    title: "Best Sources for Historic Bitcoin Training Data",
    content: `**Free & Paid Sources for Historic BTC OHLCV Data:**

| Source | Coverage | Granularity | Cost | Format |
|--------|----------|-------------|------|--------|
| **Binance API** | 2017-present | 1m-1M | Free | REST/JSON |
| **CoinGecko** | 2013-present | Daily/hourly | Free (Demo) | REST/JSON |
| **Kaggle BTC Dataset** | 2012-present | 1-minute | Free | CSV |
| **CoinAPI Flat Files** | 5+ years | 1m, tick | Paid | S3/FTP/Parquet |
| **CryptoDataDownload** | 2013-present | 1m-1d | Free | CSV |

**For ML Training, use:**
1. **Binance REST API** (free, 1000 candles per request):
   \`GET /api/v3/klines?symbol=BTCUSDT&interval=1m&limit=1000\`
   - Paginate using \`startTime\` / \`endTime\` to get years of data
   - ~525,600 candles per year at 1m interval

2. **Kaggle: "Bitcoin BTC, 7 Exchanges, 1m Full Historical Data"**
   - 7 exchanges, 1-minute resolution, pre-cleaned
   - Direct download as CSV

3. **GitHub: mouadja02/bitcoin-technical-indicators-dataset**
   - Pre-computed technical indicators (RSI, MACD, Bollinger, etc.)
   - Ready for ML feature engineering

**Feature Engineering for Training:**
- Price returns (1m, 5m, 15m, 1h, 4h, 1d)
- RSI(14), MACD(12,26,9), Bollinger Bands(20,2)
- Volume profile, VWAP
- Order book imbalance (if available)
- Funding rate (perpetual futures)
- On-chain metrics (hash rate, active addresses)`,
    category: "data-source",
    tags: ["bitcoin", "historic", "ohlcv", "kaggle", "training", "ml"],
    source_urls: [
      "https://www.coingecko.com/learn/best-historical-crypto-data-apis",
      "https://www.coinapi.io/blog/crypto-ai-model-training-historical-transaction-data",
      "https://www.kaggle.com/datasets/imranbukhari/comprehensive-btcusd-1m-data",
      "https://github.com/mouadja02/bitcoin-technical-indicators-dataset"
    ],
    is_actionable: true,
    priority: 4,
  },

  // Historic Polymarket Data
  {
    topic: "polymarket-historic",
    title: "Polymarket Historical Datasets & Collection Tools",
    content: `**Available Historic Polymarket Data:**

**1. Jon-Becker/prediction-market-analysis (GitHub)**
- Largest publicly available dataset of Polymarket + Kalshi data
- 36 GiB compressed (market metadata + full trade history)
- Collection indexers included for gathering new data
- \`make setup\` downloads dataset, \`make index\` collects live data
- URL: github.com/jon-becker/prediction-market-analysis

**2. PolymarketData.co (Commercial)**
- 10B+ rows, 450K+ markets, 1M+ resolution events
- Formats: SQL, Parquet, CSV, JSON
- REST API + Python SDK
- Full L2 order book history
- S3 bulk dumps available

**3. Kaggle: "Polymarket Prediction Markets"**
- Community dataset with market snapshots
- Good for initial exploration

**4. DIY Collection via Gamma API:**
\`\`\`javascript
// Collect all markets
const markets = await fetch('https://gamma-api.polymarket.com/markets?limit=100&offset=0');

// Collect price history for a market
const history = await fetch('https://data-api.polymarket.com/prices?market_id=XXX');
\`\`\`

**Recommended Training Pipeline:**
1. Download Jon-Becker dataset as baseline (covers 2021-2025)
2. Set up live indexer for ongoing data collection
3. Store in Postgres with time-series indexing
4. Features: price trajectory, volume patterns, time-to-resolution, category correlations`,
    category: "data-source",
    tags: ["polymarket", "historic", "dataset", "training", "kaggle"],
    source_urls: [
      "https://github.com/jon-becker/prediction-market-analysis",
      "https://www.polymarketdata.co/",
      "https://www.kaggle.com/datasets/ismetsemedov/polymarket-prediction-markets"
    ],
    is_actionable: true,
    priority: 4,
  },

  // Momentum & Direction Prediction
  {
    topic: "momentum-algos",
    title: "Stock Momentum & Direction Prediction Algorithms",
    content: `**Research-Backed Approaches:**

**1. LSTM with Technical + Sentiment Fusion (17% accuracy improvement)**
- Combine technical indicators via TA-Lib with sentiment scores
- Features: RSI(14), MACD(12,26,9), Bollinger Bands, OBV, ATR
- Sentiment from financial news (FinBERT or similar)
- Architecture: LSTM layers → Dense → Softmax (up/down/flat)
- Paper: Farhan et al., "Predicting Stock Price Direction with LSTM"

**2. Multi-Factor Momentum Crossover Strategy**
- RSI + MACD + Volume confirmation
- Entry: RSI crosses above 30 + MACD histogram turns positive + volume > 1.5x avg
- Exit: RSI > 70 or MACD bearish crossover
- Adds: EMA(9) vs EMA(21) for trend direction

**3. Gradient Boosted Trees (XGBoost/LightGBM)**
- Often outperforms deep learning for tabular financial data
- Features: price returns (multi-timeframe), volatility, volume ratios, RSI, MACD
- Target: next-bar direction (classification) or return (regression)
- Advantage: interpretable feature importances

**4. Reinforcement Learning (DQN/PPO)**
- State: price history window + indicators + portfolio state
- Actions: buy, sell, hold (with position sizing)
- Reward: risk-adjusted return (Sharpe ratio)
- Challenge: needs large data, careful reward shaping

**Recommended Implementation Order:**
1. Start with XGBoost classifier (fast to iterate, interpretable)
2. Add LSTM for sequence modeling
3. Combine as ensemble (majority vote or stacking)
4. Add RL for position sizing optimization`,
    category: "algorithm",
    tags: ["momentum", "prediction", "lstm", "xgboost", "rsi", "macd", "ml"],
    source_urls: [
      "https://link.springer.com/article/10.1007/s10690-025-09560-4",
      "https://medium.com/@FMZQuant/multi-factor-momentum-crossover-trend-strategy-high-volume-rsi-macd-optimization-framework-878131437746"
    ],
    is_actionable: true,
    priority: 5,
  },

  // Fair Price & Statistical Arbitrage
  {
    topic: "fair-price-arb",
    title: "Fair Price Evaluation & Statistical Arbitrage Methods",
    content: `**Statistical Arbitrage Frameworks:**

**1. Pairs Trading with Cointegration**
- Find cointegrated pairs (e.g., MSFT/AAPL, GS/JPM)
- Test with Engle-Granger or Johansen cointegration test (p-value < 0.05)
- Trade the spread: buy undervalued, sell overvalued when z-score > 2
- Mean reversion expected — profit when spread returns to equilibrium
- **Key finding:** Dynamic rolling-window cointegration outperforms static (Sharpe 1.1 vs -0.77)

**2. Fair Price Models**
- **DCF (Discounted Cash Flow):** Intrinsic value from future cash flows
- **Relative Valuation:** P/E, P/B, EV/EBITDA vs sector peers
- **Options-Implied:** Use put-call parity to derive market's expected fair price
- **For Polymarket:** Fair price = probability × payoff. Compare market price vs model probability

**3. Cross-Market Arbitrage (Stocks ↔ Prediction Markets)**
- If Polymarket prices a political event at 70% and stock market hasn't priced it in → opportunity
- Monitor correlation between prediction market outcomes and sector ETFs
- Example: Election outcome → energy sector positioning

**4. Copula-Based Statistical Arbitrage**
- Model joint distribution of asset returns using copulas
- Captures non-linear dependencies that cointegration misses
- Better for tail risk estimation

**Implementation for our platform:**
\`\`\`python
# Cointegration test
from statsmodels.tsa.stattools import coint
score, pvalue, _ = coint(stock_a_prices, stock_b_prices)
if pvalue < 0.05:
    spread = stock_a - hedge_ratio * stock_b
    z_score = (spread - spread.mean()) / spread.std()
    # Trade when |z_score| > 2, exit when |z_score| < 0.5
\`\`\`

**Risk Management:**
- Max drawdown estimate: 15-25% for pairs strategies
- Win probability: 55-65% historically
- Sharpe ratio target: 1.0-1.5`,
    category: "algorithm",
    tags: ["arbitrage", "cointegration", "pairs-trading", "fair-price", "copula", "stat-arb"],
    source_urls: [
      "https://www.quantanalysis.org.uk/python/statistical-arbitrage-cointegration-pairs/",
      "https://www.researchsquare.com/article/rs-7871070/latest"
    ],
    is_actionable: true,
    priority: 5,
  },
];

export default function ResearchNotebook() {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [notes, setNotes] = useState<ResearchNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTopic, setActiveTopic] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set());
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [showNewNote, setShowNewNote] = useState(false);
  const [newNote, setNewNote] = useState({ topic: "polymarket-db", title: "", content: "", tags: "", source_urls: "" });

  useEffect(() => {
    if (user) loadNotes();
  }, [user]);

  const loadNotes = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("research_notes")
      .select("*")
      .eq("user_id", user!.id)
      .order("priority", { ascending: false });

    if (error) {
      console.error("Error loading notes:", error);
      setNotes([]);
    } else {
      setNotes((data as any[]) || []);
    }
    setLoading(false);
  };

  const seedResearch = async () => {
    if (!user) return;
    const rows = SEED_RESEARCH.map(n => ({ ...n, user_id: user.id }));
    const { error } = await supabase.from("research_notes").insert(rows as any);
    if (error) {
      toast({ title: "Error seeding research", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Research loaded!", description: "6 topics with detailed findings seeded into your notebook." });
      loadNotes();
    }
  };

  const addNote = async () => {
    if (!user || !newNote.title || !newNote.content) return;
    const { error } = await supabase.from("research_notes").insert({
      user_id: user.id,
      topic: newNote.topic,
      title: newNote.title,
      content: newNote.content,
      category: "general",
      tags: newNote.tags.split(",").map(t => t.trim()).filter(Boolean),
      source_urls: newNote.source_urls.split(",").map(u => u.trim()).filter(Boolean),
      is_actionable: false,
      priority: 0,
    } as any);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      setShowNewNote(false);
      setNewNote({ topic: "polymarket-db", title: "", content: "", tags: "", source_urls: "" });
      loadNotes();
    }
  };

  const deleteNote = async (id: string) => {
    await supabase.from("research_notes").delete().eq("id", id);
    loadNotes();
  };

  const toggleExpand = (id: string) => {
    setExpandedNotes(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const filtered = notes.filter(n => {
    const matchesTopic = activeTopic === "all" || n.topic === activeTopic;
    const matchesSearch = !searchQuery || 
      n.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      n.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
      n.tags?.some(t => t.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesTopic && matchesSearch;
  });

  const topicCounts = RESEARCH_TOPICS.reduce((acc, t) => {
    acc[t.id] = notes.filter(n => n.topic === t.id).length;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <div className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <BookOpen className="w-6 h-6 text-primary" />
            <h1 className="text-xl font-bold">Research Notebook</h1>
            <Badge variant="secondary" className="text-xs">{notes.length} notes</Badge>
          </div>
          <div className="flex items-center gap-2">
            {notes.length === 0 && (
              <Button onClick={seedResearch} variant="default" size="sm" className="gap-2">
                <Lightbulb className="w-4 h-4" />
                Load Research Findings
              </Button>
            )}
            <Button onClick={() => setShowNewNote(!showNewNote)} variant="outline" size="sm" className="gap-2">
              <Plus className="w-4 h-4" />
              Add Note
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6 flex gap-6">
        {/* Sidebar */}
        <div className="w-64 shrink-0">
          <div className="sticky top-20 space-y-2">
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search notes..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="pl-9 bg-card border-border"
              />
            </div>

            <button
              onClick={() => setActiveTopic("all")}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTopic === "all" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:bg-muted"
              }`}
            >
              All Topics ({notes.length})
            </button>

            {RESEARCH_TOPICS.map(topic => (
              <button
                key={topic.id}
                onClick={() => setActiveTopic(topic.id)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-2 ${
                  activeTopic === topic.id ? "bg-primary/20 text-primary" : "text-muted-foreground hover:bg-muted"
                }`}
              >
                <topic.icon className={`w-4 h-4 ${topic.color}`} />
                <span className="truncate flex-1">{topic.label}</span>
                <span className="text-xs opacity-60">{topicCounts[topic.id] || 0}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 min-w-0 space-y-4">
          {/* New Note Form */}
          {showNewNote && (
            <Card className="border-primary/30 bg-card">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">New Research Note</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <select
                  value={newNote.topic}
                  onChange={e => setNewNote(p => ({ ...p, topic: e.target.value }))}
                  className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
                >
                  {RESEARCH_TOPICS.map(t => (
                    <option key={t.id} value={t.id}>{t.label}</option>
                  ))}
                </select>
                <Input
                  placeholder="Title"
                  value={newNote.title}
                  onChange={e => setNewNote(p => ({ ...p, title: e.target.value }))}
                  className="bg-background"
                />
                <Textarea
                  placeholder="Content (supports markdown)"
                  value={newNote.content}
                  onChange={e => setNewNote(p => ({ ...p, content: e.target.value }))}
                  rows={6}
                  className="bg-background font-mono text-sm"
                />
                <Input
                  placeholder="Tags (comma-separated)"
                  value={newNote.tags}
                  onChange={e => setNewNote(p => ({ ...p, tags: e.target.value }))}
                  className="bg-background"
                />
                <Input
                  placeholder="Source URLs (comma-separated)"
                  value={newNote.source_urls}
                  onChange={e => setNewNote(p => ({ ...p, source_urls: e.target.value }))}
                  className="bg-background"
                />
                <div className="flex gap-2">
                  <Button onClick={addNote} size="sm" className="gap-2">
                    <Save className="w-4 h-4" /> Save
                  </Button>
                  <Button onClick={() => setShowNewNote(false)} variant="ghost" size="sm">Cancel</Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Empty State */}
          {loading ? (
            <div className="text-center py-20 text-muted-foreground">Loading research...</div>
          ) : notes.length === 0 ? (
            <div className="text-center py-20 space-y-4">
              <BookOpen className="w-16 h-16 mx-auto text-muted-foreground/30" />
              <h2 className="text-xl font-semibold text-muted-foreground">Your Research Notebook is Empty</h2>
              <p className="text-muted-foreground/70 max-w-md mx-auto">
                Click "Load Research Findings" to populate your notebook with pre-researched data on 
                Polymarket architecture, Bitcoin data capture, prediction algorithms, and statistical arbitrage.
              </p>
              <Button onClick={seedResearch} size="lg" className="gap-2 mt-4">
                <Lightbulb className="w-5 h-5" />
                Load Research Findings
              </Button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-20 text-muted-foreground">
              No notes match your search.
            </div>
          ) : (
            /* Notes List */
            filtered.map(note => {
              const topic = RESEARCH_TOPICS.find(t => t.id === note.topic);
              const isExpanded = expandedNotes.has(note.id);
              const TopicIcon = topic?.icon || BookOpen;

              return (
                <Card key={note.id} className="bg-card border-border hover:border-primary/20 transition-colors">
                  <CardHeader className="pb-2 cursor-pointer" onClick={() => toggleExpand(note.id)}>
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        <TopicIcon className={`w-5 h-5 mt-0.5 shrink-0 ${topic?.color || "text-muted-foreground"}`} />
                        <div className="flex-1 min-w-0">
                          <CardTitle className="text-base leading-tight">{note.title}</CardTitle>
                          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                            <Badge variant="outline" className="text-xs">{topic?.label}</Badge>
                            {note.is_actionable && (
                              <Badge className="text-xs bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
                                Actionable
                              </Badge>
                            )}
                            {note.priority >= 4 && (
                              <span className="flex items-center gap-0.5 text-amber-400">
                                <Star className="w-3 h-3 fill-current" />
                                <span className="text-xs">High Priority</span>
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={e => { e.stopPropagation(); deleteNote(note.id); }}>
                          <Trash2 className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive" />
                        </Button>
                        {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                      </div>
                    </div>
                  </CardHeader>
                  {isExpanded && (
                    <CardContent className="pt-0">
                      <div className="prose prose-sm prose-invert max-w-none mt-2">
                        <pre className="whitespace-pre-wrap font-sans text-sm text-foreground/80 leading-relaxed bg-transparent p-0 border-0">
                          {note.content}
                        </pre>
                      </div>

                      {/* Tags */}
                      {note.tags && note.tags.length > 0 && (
                        <div className="flex items-center gap-1.5 mt-4 flex-wrap">
                          <Tag className="w-3 h-3 text-muted-foreground" />
                          {note.tags.map(tag => (
                            <Badge key={tag} variant="secondary" className="text-xs cursor-pointer" onClick={() => setSearchQuery(tag)}>
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      )}

                      {/* Sources */}
                      {note.source_urls && note.source_urls.length > 0 && (
                        <div className="mt-3 space-y-1">
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Link2 className="w-3 h-3" /> Sources:
                          </span>
                          {note.source_urls.map(url => (
                            <a
                              key={url}
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-primary/70 hover:text-primary flex items-center gap-1 truncate"
                            >
                              <ExternalLink className="w-3 h-3 shrink-0" />
                              {url}
                            </a>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  )}
                </Card>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
