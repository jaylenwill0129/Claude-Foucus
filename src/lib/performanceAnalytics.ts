/**
 * Performance analytics — pure functions over trade_journal rows.
 * Used by PerformancePanel + daily-perf-digest.
 */

export interface JournalRow {
  symbol: string;
  side: string;
  trade_type: string;
  pnl: number | null;
  pnl_pct: number | null;
  entry_price: number | null;
  filled_price: number | null;
  signal_price?: number | null;
  slippage_bps?: number | null;
  confidence?: number | null;
  entry_quality?: string | null;
  risk_reward?: number | null;
  sector?: string | null;
  market_session?: string | null;
  holding_time_ms?: number | null;
  created_at: string;
  mode?: string | null;
}

export interface DimensionStat {
  key: string;
  n: number;
  wins: number;
  losses: number;
  winRate: number;        // 0..1
  totalPnl: number;
  avgPnl: number;
  expectancy: number;     // avg pnl per trade
  restricted: boolean;    // n>=10 && winRate<0.35
}

const isExit = (r: JournalRow) => r.trade_type !== "entry";

export function byDimension(rows: JournalRow[], key: keyof JournalRow): DimensionStat[] {
  const buckets = new Map<string, JournalRow[]>();
  for (const r of rows) {
    if (!isExit(r)) continue;
    const k = String((r as any)[key] ?? "unknown");
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(r);
  }
  const out: DimensionStat[] = [];
  for (const [k, items] of buckets) {
    const n = items.length;
    const pnls = items.map(i => Number(i.pnl) || 0);
    const wins = pnls.filter(p => p > 0).length;
    const losses = pnls.filter(p => p < 0).length;
    const totalPnl = pnls.reduce((a, b) => a + b, 0);
    const winRate = n ? wins / n : 0;
    const avgPnl = n ? totalPnl / n : 0;
    out.push({
      key: k, n, wins, losses, winRate, totalPnl, avgPnl,
      expectancy: avgPnl,
      restricted: n >= 10 && winRate < 0.35,
    });
  }
  return out.sort((a, b) => a.totalPnl - b.totalPnl);
}

export interface LossAttribution {
  slippage: number;       // total $ leaked to slippage on losing trades
  adverseMove: number;    // total $ from price moving against us
  timeDecay: number;      // total $ from time_exit churn (small adverse moves)
  totalLoss: number;
}

export function lossAttribution(rows: JournalRow[]): LossAttribution {
  let slippage = 0, adverseMove = 0, timeDecay = 0, totalLoss = 0;
  for (const r of rows) {
    if (!isExit(r)) continue;
    const pnl = Number(r.pnl) || 0;
    if (pnl >= 0) continue;
    totalLoss += pnl;
    const slipPart = ((Number(r.slippage_bps) || 0) / 10000) *
                     (Number(r.filled_price) || 0) *
                     (Number((r as any).qty) || 0);
    slippage += -Math.abs(slipPart);
    if (r.trade_type === "time_exit") timeDecay += pnl;
    else adverseMove += pnl - slipPart;
  }
  return { slippage, adverseMove, timeDecay, totalLoss };
}

export function realizedEquityCurve(rows: JournalRow[]): { t: number; equity: number }[] {
  const sorted = [...rows].filter(isExit).sort(
    (a, b) => +new Date(a.created_at) - +new Date(b.created_at),
  );
  let eq = 0;
  return sorted.map(r => {
    eq += Number(r.pnl) || 0;
    return { t: +new Date(r.created_at), equity: eq };
  });
}

export function worstDimensionLast24h(rows: JournalRow[]): DimensionStat | null {
  const cutoff = Date.now() - 24 * 3600 * 1000;
  const recent = rows.filter(r => +new Date(r.created_at) >= cutoff);
  const dims = byDimension(recent, "symbol").filter(d => d.totalPnl < 0);
  return dims[0] || null;
}