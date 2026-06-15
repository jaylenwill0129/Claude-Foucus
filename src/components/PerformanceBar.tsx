import { TrendingUp, TrendingDown, Wallet, BarChart3, Activity, Zap, Calendar, FolderOpen } from "lucide-react";
import { Portfolio } from "@/hooks/usePaperTrading";
import { TickerData } from "@/hooks/useWebullData";

interface PerformanceBarProps {
  portfolio: Portfolio;
  tickers: Record<string, TickerData>;
  autoTradeEnabled: boolean;
  isAnalyzing: boolean;
}

function safeNum(val: unknown, fallback = 0): number {
  const n = Number(val);
  return isFinite(n) ? n : fallback;
}

export function PerformanceBar({ portfolio, tickers, autoTradeEnabled, isAnalyzing }: PerformanceBarProps) {
  // Open (unrealized) P&L
  const openPnl = (portfolio.positions ?? []).reduce((total, pos) => {
    try {
      const ticker = tickers[pos?.symbol];
      const currentPrice = ticker ? safeNum(parseFloat(ticker.price), pos.entryPrice) : pos.entryPrice;
      const entry = safeNum(pos.entryPrice);
      const qty = safeNum(pos.quantity);
      if (entry <= 0 || qty <= 0) return total;
      const pnl = pos.side === "long"
        ? (currentPrice - entry) * qty
        : (entry - currentPrice) * qty;
      return total + safeNum(pnl);
    } catch { return total; }
  }, 0);

  // Day's P&L — trades closed today
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayTs = todayStart.getTime();

  const dayPnl = (portfolio.trades ?? []).reduce((total, t) => {
    try {
      if (t.pnl == null) return total;
      const ts = safeNum(t.timestamp);
      if (ts >= todayTs) return total + safeNum(t.pnl);
      return total;
    } catch { return total; }
  }, 0);

  const investedValue = (portfolio.positions ?? []).reduce((t, p) => {
    try {
      return t + safeNum(p.entryPrice) * safeNum(p.quantity);
    } catch { return t; }
  }, 0);

  const balance = safeNum(portfolio.balance);
  const totalPnlRealized = safeNum(portfolio.totalPnl);
  const totalEquity = balance + investedValue + openPnl;
  const totalPnl = totalPnlRealized + openPnl;
  const base = totalEquity - totalPnl;
  const totalPnlPct = base > 0 ? (totalPnl / base) * 100 : 0;

  const winningTrades = (portfolio.trades ?? []).filter(t => t.pnl != null && safeNum(t.pnl) > 0).length;
  const closedTrades = (portfolio.trades ?? []).filter(t => t.pnl != null).length;
  const winRate = closedTrades > 0 ? (winningTrades / closedTrades * 100) : 0;

  const stats = [
    {
      label: "Equity",
      value: `$${totalEquity.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
      icon: Wallet,
      color: "text-foreground",
    },
    {
      label: "Total P&L",
      value: `${totalPnl >= 0 ? "+" : ""}$${totalPnl.toFixed(0)}`,
      sub: `${totalPnlPct >= 0 ? "+" : ""}${totalPnlPct.toFixed(2)}%`,
      icon: totalPnl >= 0 ? TrendingUp : TrendingDown,
      color: totalPnl >= 0 ? "text-gain" : "text-loss",
    },
    {
      label: "Day P&L",
      value: `${dayPnl >= 0 ? "+" : ""}$${dayPnl.toFixed(0)}`,
      icon: Calendar,
      color: dayPnl >= 0 ? "text-gain" : dayPnl < 0 ? "text-loss" : "text-muted-foreground",
    },
    {
      label: "Open P&L",
      value: `${openPnl >= 0 ? "+" : ""}$${openPnl.toFixed(0)}`,
      icon: FolderOpen,
      color: openPnl > 0 ? "text-gain" : openPnl < 0 ? "text-loss" : "text-muted-foreground",
    },
    {
      label: "Win Rate",
      value: closedTrades > 0 ? `${winRate.toFixed(0)}%` : "—",
      sub: closedTrades > 0 ? `${winningTrades}/${closedTrades}` : "",
      icon: BarChart3,
      color: winRate >= 50 ? "text-gain" : winRate > 0 ? "text-loss" : "text-muted-foreground",
    },
    {
      label: "Positions",
      value: `${(portfolio.positions ?? []).length}`,
      icon: Activity,
      color: (portfolio.positions ?? []).length > 0 ? "text-accent" : "text-muted-foreground",
    },
  ];

  return (
    <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border glass-strong overflow-x-auto scrollbar-thin">
      {stats.map((stat, i) => (
        <div key={stat.label} className="flex items-center gap-1.5 px-2 py-1 shrink-0">
          <stat.icon className={`w-3 h-3 ${stat.color} opacity-60`} />
          <div className="flex items-baseline gap-1">
            <span className="text-[9px] text-muted-foreground uppercase tracking-wider">{stat.label}</span>
            <span className={`text-xs font-mono font-semibold ${stat.color}`}>{stat.value}</span>
            {stat.sub && (
              <span className={`text-[9px] font-mono ${stat.color} opacity-70`}>{stat.sub}</span>
            )}
          </div>
          {i < stats.length - 1 && <div className="w-px h-4 bg-border ml-1" />}
        </div>
      ))}

      <div className="ml-auto flex items-center gap-1.5 shrink-0">
        {autoTradeEnabled && (
          <span className="flex items-center gap-1 text-[9px] px-2 py-0.5 rounded-full bg-gain/10 text-gain font-mono border border-gain/20">
            <Zap className={`w-2.5 h-2.5 ${isAnalyzing ? "animate-pulse" : ""}`} />
            AUTO
          </span>
        )}
      </div>
    </div>
  );
}
