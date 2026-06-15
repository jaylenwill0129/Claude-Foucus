import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface JournalEntry {
  id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  symbol: string;
  side: string;
  qty: number;
  entry_price: number | null;
  exit_price: number | null;
  filled_price: number;
  pnl: number | null;
  pnl_pct: number | null;
  alpaca_order_id: string | null;
  order_type: string;
  order_class: string | null;
  trade_type: string;
  mode: string;
  confidence: number | null;
  risk_reward: number | null;
  entry_quality: string | null;
  signal_type: string | null;
  stat_edge_score: number | null;
  chart_snapshot: any;
  notes: string;
  tags: string[];
  rating: number | null;
  lessons_learned: string;
  market_session: string | null;
  sector: string | null;
  holding_time_ms: number | null;
}

export interface JournalStats {
  totalTrades: number;
  wins: number;
  losses: number;
  totalPnl: number;
  avgPnl: number;
  avgHoldTime: number;
  bestTrade: number;
  worstTrade: number;
  avgConfidence: number;
  winRate: number;
}

export function useTradeJournal() {
  const { user } = useAuth();
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<JournalStats>({
    totalTrades: 0, wins: 0, losses: 0, totalPnl: 0, avgPnl: 0,
    avgHoldTime: 0, bestTrade: 0, worstTrade: 0, avgConfidence: 0, winRate: 0,
  });

  const fetchEntries = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("trade_journal")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(500);

    if (error) {
      console.error("Failed to fetch journal:", error);
    } else if (data) {
      const typed = data as unknown as JournalEntry[];
      setEntries(typed);
      computeStats(typed);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  const computeStats = (entries: JournalEntry[]) => {
    const exits = entries.filter(e => e.trade_type === "exit" && e.pnl !== null);
    if (exits.length === 0) {
      setStats({ totalTrades: 0, wins: 0, losses: 0, totalPnl: 0, avgPnl: 0, avgHoldTime: 0, bestTrade: 0, worstTrade: 0, avgConfidence: 0, winRate: 0 });
      return;
    }
    const wins = exits.filter(e => (e.pnl ?? 0) > 0).length;
    const totalPnl = exits.reduce((s, e) => s + (e.pnl ?? 0), 0);
    const best = Math.max(...exits.map(e => e.pnl ?? 0));
    const worst = Math.min(...exits.map(e => e.pnl ?? 0));
    const holdTimes = exits.filter(e => e.holding_time_ms).map(e => e.holding_time_ms!);
    const avgHold = holdTimes.length > 0 ? holdTimes.reduce((a, b) => a + b, 0) / holdTimes.length : 0;
    const confEntries = entries.filter(e => e.confidence !== null);
    const avgConf = confEntries.length > 0 ? confEntries.reduce((s, e) => s + (e.confidence ?? 0), 0) / confEntries.length : 0;

    setStats({
      totalTrades: exits.length,
      wins,
      losses: exits.length - wins,
      totalPnl,
      avgPnl: totalPnl / exits.length,
      avgHoldTime: avgHold,
      bestTrade: best,
      worstTrade: worst,
      avgConfidence: avgConf,
      winRate: (wins / exits.length) * 100,
    });
  };

  const logTrade = useCallback(async (entry: Omit<JournalEntry, "id" | "user_id" | "created_at" | "updated_at">) => {
    if (!user) return;
    const row = { ...entry, user_id: user.id };
    const { error } = await supabase.from("trade_journal").insert(row as any);
    if (error) {
      console.error("Failed to log journal entry:", error);
    } else {
      fetchEntries();
    }
  }, [user, fetchEntries]);

  const updateEntry = useCallback(async (id: string, updates: { notes?: string; rating?: number; tags?: string[]; lessons_learned?: string }) => {
    if (!user) return;
    const { error } = await supabase
      .from("trade_journal")
      .update({ ...updates, updated_at: new Date().toISOString() } as any)
      .eq("id", id)
      .eq("user_id", user.id);
    if (error) {
      toast.error("Failed to update journal entry");
    } else {
      toast.success("Journal entry updated");
      fetchEntries();
    }
  }, [user, fetchEntries]);

  const deleteEntry = useCallback(async (id: string) => {
    if (!user) return;
    const { error } = await supabase
      .from("trade_journal")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id);
    if (error) {
      toast.error("Failed to delete entry");
    } else {
      toast.success("Entry deleted");
      fetchEntries();
    }
  }, [user, fetchEntries]);

  const exportCSV = useCallback(() => {
    if (entries.length === 0) return;
    const headers = ["Date", "Symbol", "Side", "Type", "Qty", "Price", "PnL", "PnL%", "Confidence", "R:R", "Mode", "Hold Time", "Rating", "Notes"];
    const rows = entries.map(e => [
      new Date(e.created_at).toLocaleString(),
      e.symbol, e.side, e.trade_type, e.qty, e.filled_price,
      e.pnl?.toFixed(2) ?? "", e.pnl_pct?.toFixed(2) ?? "",
      e.confidence ?? "", e.risk_reward ?? "", e.mode,
      e.holding_time_ms ? `${Math.floor(e.holding_time_ms / 60000)}m` : "",
      e.rating ?? "", `"${(e.notes || "").replace(/"/g, '""')}"`,
    ]);
    const csv = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `trade-journal-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
    toast.success("Journal exported");
  }, [entries]);

  return { entries, loading, stats, logTrade, updateEntry, deleteEntry, exportCSV, refresh: fetchEntries };
}
