import { useEffect, useState } from "react";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

interface Row {
  trading_halted: boolean;
  halt_reason: string | null;
  weekly_pause_until: string | null;
  max_weekly_drawdown_pct: number;
}

/**
 * Server-side kill switch + weekly drawdown breaker.
 * Reads/writes auto_trade_settings. Independent of local AutoTradeConfig
 * so it overrides client state even if the tab is closed.
 */
export function KillSwitchBanner() {
  const { user } = useAuth();
  const [row, setRow] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    let mounted = true;
    const load = async () => {
      const { data } = await supabase
        .from("auto_trade_settings")
        .select("trading_halted, halt_reason, weekly_pause_until, max_weekly_drawdown_pct")
        .eq("user_id", user.id)
        .maybeSingle();
      if (mounted && data) setRow(data as unknown as Row);
    };
    load();
    const id = setInterval(load, 15000);
    return () => { mounted = false; clearInterval(id); };
  }, [user]);

  const toggle = async (halt: boolean) => {
    if (!user) return;
    setBusy(true);
    const patch = halt
      ? { trading_halted: true, halt_reason: "Manual kill-switch", halted_at: new Date().toISOString() }
      : { trading_halted: false, halt_reason: null, halted_at: null };
    const { error } = await supabase
      .from("auto_trade_settings")
      .update(patch)
      .eq("user_id", user.id);
    setBusy(false);
    if (error) {
      toast.error("Could not update kill-switch");
    } else {
      setRow((r) => (r ? { ...r, ...patch } as Row : r));
      toast.success(halt ? "🛑 Trading halted server-side" : "✅ Trading re-enabled");
    }
  };

  const clearPause = async () => {
    if (!user) return;
    await supabase.from("auto_trade_settings").update({ weekly_pause_until: null }).eq("user_id", user.id);
    setRow((r) => (r ? { ...r, weekly_pause_until: null } : r));
    toast.success("Drawdown pause cleared");
  };

  if (!row) return null;
  const paused = row.weekly_pause_until && new Date(row.weekly_pause_until) > new Date();

  return (
    <div className={`p-2 mb-3 rounded border text-[10px] flex items-center justify-between gap-2 ${
      row.trading_halted
        ? "bg-loss/10 border-loss/30 text-loss"
        : paused
          ? "bg-warning/10 border-warning/30 text-warning"
          : "bg-accent/10 border-accent/20 text-accent"
    }`}>
      <div className="flex items-center gap-1.5">
        {row.trading_halted ? <ShieldAlert className="w-3 h-3" /> : <ShieldCheck className="w-3 h-3" />}
        <span className="font-mono">
          {row.trading_halted
            ? `KILL-SWITCH ON — ${row.halt_reason || "halted"}`
            : paused
              ? `DD-PAUSE until ${new Date(row.weekly_pause_until!).toLocaleString()}`
              : `Server kill-switch ready (max weekly DD ${row.max_weekly_drawdown_pct}%)`}
        </span>
      </div>
      <div className="flex items-center gap-2">
        {paused && !row.trading_halted && (
          <button onClick={clearPause} className="px-1.5 py-0.5 rounded border border-current text-[9px] hover:bg-current hover:text-background transition-colors">
            Clear pause
          </button>
        )}
        <Switch
          checked={row.trading_halted}
          disabled={busy}
          onCheckedChange={(v) => toggle(v)}
          aria-label="Kill switch"
        />
      </div>
    </div>
  );
}