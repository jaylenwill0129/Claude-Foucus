import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import type { StrategyResult } from "@/components/StrategyPanel";

export interface StrategyHistoryEntry {
  id: string;
  user_id: string;
  created_at: string;
  symbol: string;
  strategy_name: string;
  overall_bias: string;
  confidence: number;
  analysis_mode: string;
  preset: string | null;
  current_price_at_gen: number;
  signals: any[];
  indicators: any;
  risk_assessment: any;
  reasoning: string[];
  entry_hit: boolean;
  entry_hit_at: string | null;
  tp_hit: boolean;
  tp_hit_at: string | null;
  sl_hit: boolean;
  sl_hit_at: string | null;
  outcome: string;
  actual_pnl_pct: number | null;
  resolved_at: string | null;
  notes: string;
}

export interface AccuracyStats {
  total: number;
  entryHits: number;
  tpHits: number;
  slHits: number;
  wins: number;
  losses: number;
  pending: number;
  entryHitRate: number;
  winRate: number;
  avgPnl: number;
}

export function useStrategyHistory() {
  const { user } = useAuth();
  const [history, setHistory] = useState<StrategyHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<AccuracyStats>({
    total: 0, entryHits: 0, tpHits: 0, slHits: 0,
    wins: 0, losses: 0, pending: 0,
    entryHitRate: 0, winRate: 0, avgPnl: 0,
  });

  const fetchHistory = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("strategy_history")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) {
      console.error("Failed to fetch strategy history:", error);
    } else if (data) {
      const typed = data as unknown as StrategyHistoryEntry[];
      setHistory(typed);
      computeStats(typed);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  const computeStats = (entries: StrategyHistoryEntry[]) => {
    if (entries.length === 0) {
      setStats({ total: 0, entryHits: 0, tpHits: 0, slHits: 0, wins: 0, losses: 0, pending: 0, entryHitRate: 0, winRate: 0, avgPnl: 0 });
      return;
    }
    const entryHits = entries.filter(e => e.entry_hit).length;
    const tpHits = entries.filter(e => e.tp_hit).length;
    const slHits = entries.filter(e => e.sl_hit).length;
    const wins = entries.filter(e => e.outcome === "win").length;
    const losses = entries.filter(e => e.outcome === "loss").length;
    const pending = entries.filter(e => e.outcome === "pending").length;
    const resolved = entries.filter(e => e.actual_pnl_pct !== null);
    const avgPnl = resolved.length > 0 ? resolved.reduce((s, e) => s + (e.actual_pnl_pct ?? 0), 0) / resolved.length : 0;
    const resolvedCount = wins + losses;

    setStats({
      total: entries.length,
      entryHits, tpHits, slHits, wins, losses, pending,
      entryHitRate: entries.length > 0 ? (entryHits / entries.length) * 100 : 0,
      winRate: resolvedCount > 0 ? (wins / resolvedCount) * 100 : 0,
      avgPnl,
    });
  };

  const saveStrategy = useCallback(async (
    strategy: StrategyResult,
    symbol: string,
    currentPrice: number,
    preset?: string | null,
  ) => {
    if (!user) return;
    const row = {
      user_id: user.id,
      symbol,
      strategy_name: strategy.strategy_name,
      overall_bias: strategy.overall_bias,
      confidence: strategy.confidence,
      analysis_mode: strategy.analysis_mode || "fallback",
      preset: preset || null,
      current_price_at_gen: currentPrice,
      signals: strategy.signals as any,
      indicators: strategy.indicators as any,
      risk_assessment: strategy.risk_assessment as any,
      reasoning: strategy.reasoning,
    };
    const { error } = await supabase.from("strategy_history").insert(row as any);
    if (error) {
      console.error("Failed to save strategy:", error);
      toast.error("Failed to save strategy");
    } else {
      toast.success("Strategy saved to history");
      fetchHistory();
    }
  }, [user, fetchHistory]);

  const checkPriceAgainstStrategies = useCallback(async (symbol: string, currentPrice: number) => {
    if (!user || history.length === 0) return;

    const pendingForSymbol = history.filter(
      h => h.symbol === symbol && h.outcome === "pending"
    );

    for (const entry of pendingForSymbol) {
      const signals = entry.signals as any[];
      if (!signals || signals.length === 0) continue;

      let entryHit = entry.entry_hit;
      let tpHit = entry.tp_hit;
      let slHit = entry.sl_hit;
      let outcome = entry.outcome;
      let actualPnl: number | null = null;
      const updates: Record<string, any> = {};

      for (const sig of signals) {
        const isBuy = sig.action === "buy";

        // Check entry hit
        if (!entryHit) {
          if (isBuy && currentPrice <= sig.entry_price * 1.002) {
            entryHit = true;
            updates.entry_hit = true;
            updates.entry_hit_at = new Date().toISOString();
          } else if (!isBuy && currentPrice >= sig.entry_price * 0.998) {
            entryHit = true;
            updates.entry_hit = true;
            updates.entry_hit_at = new Date().toISOString();
          }
        }

        // Check TP/SL only if entry was hit
        if (entryHit && !tpHit && !slHit) {
          if (isBuy) {
            if (currentPrice >= sig.take_profit) {
              tpHit = true;
              outcome = "win";
              actualPnl = ((sig.take_profit - sig.entry_price) / sig.entry_price) * 100;
              updates.tp_hit = true;
              updates.tp_hit_at = new Date().toISOString();
              updates.outcome = "win";
              updates.actual_pnl_pct = actualPnl;
              updates.resolved_at = new Date().toISOString();
            } else if (currentPrice <= sig.stop_loss) {
              slHit = true;
              outcome = "loss";
              actualPnl = ((sig.stop_loss - sig.entry_price) / sig.entry_price) * 100;
              updates.sl_hit = true;
              updates.sl_hit_at = new Date().toISOString();
              updates.outcome = "loss";
              updates.actual_pnl_pct = actualPnl;
              updates.resolved_at = new Date().toISOString();
            }
          } else {
            if (currentPrice <= sig.take_profit) {
              tpHit = true;
              outcome = "win";
              actualPnl = ((sig.entry_price - sig.take_profit) / sig.entry_price) * 100;
              updates.tp_hit = true;
              updates.tp_hit_at = new Date().toISOString();
              updates.outcome = "win";
              updates.actual_pnl_pct = actualPnl;
              updates.resolved_at = new Date().toISOString();
            } else if (currentPrice >= sig.stop_loss) {
              slHit = true;
              outcome = "loss";
              actualPnl = ((sig.entry_price - sig.stop_loss) / sig.entry_price) * 100;
              updates.sl_hit = true;
              updates.sl_hit_at = new Date().toISOString();
              updates.outcome = "loss";
              updates.actual_pnl_pct = actualPnl;
              updates.resolved_at = new Date().toISOString();
            }
          }
        }

        if (Object.keys(updates).length > 0) break; // Only track first signal
      }

      if (Object.keys(updates).length > 0) {
        await supabase
          .from("strategy_history")
          .update(updates as any)
          .eq("id", entry.id)
          .eq("user_id", user.id);
      }
    }
  }, [user, history]);

  const deleteEntry = useCallback(async (id: string) => {
    if (!user) return;
    const { error } = await supabase
      .from("strategy_history")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id);
    if (error) {
      toast.error("Failed to delete");
    } else {
      toast.success("Strategy deleted");
      fetchHistory();
    }
  }, [user, fetchHistory]);

  return { history, loading, stats, saveStrategy, checkPriceAgainstStrategies, deleteEntry, refresh: fetchHistory };
}
