import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  JournalRow, byDimension, lossAttribution,
  realizedEquityCurve, worstDimensionLast24h,
} from "@/lib/performanceAnalytics";
import { Card } from "@/components/ui/card";
import { AlertTriangle, TrendingDown, TrendingUp } from "lucide-react";

const DIM_KEYS: (keyof JournalRow)[] = ["symbol", "market_session", "sector", "entry_quality", "trade_type"];

export function PerformancePanel() {
  const { user } = useAuth();
  const [rows, setRows] = useState<JournalRow[]>([]);
  const [dimKey, setDimKey] = useState<keyof JournalRow>("symbol");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("trade_journal")
        .select("symbol, side, trade_type, pnl, pnl_pct, entry_price, filled_price, signal_price, slippage_bps, confidence, entry_quality, risk_reward, sector, market_session, holding_time_ms, created_at, mode")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1000);
      if (!cancelled) {
        setRows((data || []) as JournalRow[]);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  const stats = useMemo(() => byDimension(rows, dimKey), [rows, dimKey]);
  const loss = useMemo(() => lossAttribution(rows), [rows]);
  const curve = useMemo(() => realizedEquityCurve(rows), [rows]);
  const worst = useMemo(() => worstDimensionLast24h(rows), [rows]);

  const total = curve.length ? curve[curve.length - 1].equity : 0;
  const totalLossAbs = Math.abs(loss.totalLoss) || 1;

  return (
    <Card className="p-3 space-y-3 bg-secondary/40 border-border/60">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold tracking-wide text-muted-foreground">PERFORMANCE</div>
        <div className="text-[10px] text-muted-foreground">{rows.length} rows</div>
      </div>

      {/* Headline + Why we lost */}
      <div className="grid grid-cols-2 gap-2">
        <div className="p-2 rounded bg-background/40 border border-border/40">
          <div className="text-[9px] uppercase text-muted-foreground">Realized P&L</div>
          <div className={`text-lg font-mono ${total >= 0 ? "text-profit" : "text-loss"}`}>
            {total >= 0 ? "+" : ""}${total.toFixed(2)}
          </div>
        </div>
        <div className="p-2 rounded bg-background/40 border border-border/40">
          <div className="text-[9px] uppercase text-muted-foreground flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" /> Worst dim 24h
          </div>
          {worst ? (
            <div className="text-xs font-mono text-loss">
              {worst.key} · {worst.n}t · {(worst.winRate * 100).toFixed(0)}% WR · ${worst.totalPnl.toFixed(2)}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">None</div>
          )}
        </div>
      </div>

      {/* Loss attribution */}
      <div>
        <div className="text-[10px] uppercase text-muted-foreground mb-1">Loss attribution</div>
        <div className="space-y-1 text-[10px] font-mono">
          {[
            { label: "Time-exit churn", val: loss.timeDecay },
            { label: "Adverse move",   val: loss.adverseMove },
            { label: "Slippage",       val: loss.slippage },
          ].map(r => {
            const pct = (Math.abs(r.val) / totalLossAbs) * 100;
            return (
              <div key={r.label}>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{r.label}</span>
                  <span className="text-loss">${r.val.toFixed(2)} ({pct.toFixed(0)}%)</span>
                </div>
                <div className="h-1 bg-background rounded overflow-hidden">
                  <div className="h-full bg-loss/70" style={{ width: `${Math.min(100, pct)}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Edge table */}
      <div>
        <div className="flex items-center gap-1 mb-1 flex-wrap">
          <span className="text-[10px] uppercase text-muted-foreground mr-1">Group by</span>
          {DIM_KEYS.map(k => (
            <button
              key={k}
              onClick={() => setDimKey(k)}
              className={`text-[9px] px-1.5 py-0.5 rounded border ${dimKey === k ? "bg-accent text-accent-foreground border-accent" : "border-border/60 text-muted-foreground hover:text-foreground"}`}
            >{k}</button>
          ))}
        </div>
        <div className="max-h-56 overflow-auto rounded border border-border/40">
          <table className="w-full text-[10px] font-mono">
            <thead className="bg-background/60 sticky top-0">
              <tr className="text-muted-foreground">
                <th className="text-left px-2 py-1">{String(dimKey)}</th>
                <th className="text-right px-2 py-1">n</th>
                <th className="text-right px-2 py-1">WR</th>
                <th className="text-right px-2 py-1">Exp</th>
                <th className="text-right px-2 py-1">P&L</th>
              </tr>
            </thead>
            <tbody>
              {stats.length === 0 && (
                <tr><td colSpan={5} className="text-center py-2 text-muted-foreground">
                  {loading ? "Loading…" : "No exits yet"}
                </td></tr>
              )}
              {stats.map(s => (
                <tr key={s.key} className="border-t border-border/30">
                  <td className="px-2 py-1 flex items-center gap-1">
                    {s.totalPnl >= 0
                      ? <TrendingUp className="w-2.5 h-2.5 text-profit" />
                      : <TrendingDown className="w-2.5 h-2.5 text-loss" />}
                    {s.key}
                    {s.restricted && <span className="ml-1 text-warning">⚠</span>}
                  </td>
                  <td className="text-right px-2 py-1">{s.n}</td>
                  <td className="text-right px-2 py-1">{(s.winRate * 100).toFixed(0)}%</td>
                  <td className={`text-right px-2 py-1 ${s.expectancy >= 0 ? "text-profit" : "text-loss"}`}>
                    ${s.expectancy.toFixed(2)}
                  </td>
                  <td className={`text-right px-2 py-1 ${s.totalPnl >= 0 ? "text-profit" : "text-loss"}`}>
                    ${s.totalPnl.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Card>
  );
}