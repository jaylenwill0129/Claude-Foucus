import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { invokeAlpacaTrade, usePaperAccount } from "@/lib/alpacaAccount";
import {
  RefreshCw, DollarSign, TrendingUp, TrendingDown, Package, Clock,
  AlertTriangle, X, ShieldCheck, BarChart3, Wallet, ArrowUpRight,
  ArrowDownRight, Landmark, Activity, Loader2, ChevronDown, ChevronUp,
  Wifi, WifiOff, Shield, CheckCircle2, XCircle, Radio, Download,
  Settings, History, ListOrdered, LayoutDashboard, FileDown,
  Target, Percent, Crosshair, Edit3, Bell, BellRing, Zap, Eye,
  CircleDot, Gauge, PieChart, ArrowRightLeft, Ban, Trash2,
  Volume2, VolumeX, Copy, ExternalLink, Search, Filter,
} from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

interface AlpacaAccount {
  equity: string; cash: string; buying_power: string; portfolio_value: string;
  long_market_value: string; short_market_value: string;
  daytrade_count: number; pattern_day_trader: boolean;
  status: string; currency: string; last_equity: string;
  initial_margin: string; maintenance_margin: string;
  sma: string; multiplier: string;
}

interface AlpacaPosition {
  symbol: string; qty: string; avg_entry_price: string; current_price: string;
  market_value: string; unrealized_pl: string; unrealized_plpc: string;
  side: string; asset_class: string; cost_basis: string; change_today: string;
}

interface AlpacaOrder {
  id: string; symbol: string; qty: string; notional: string | null;
  side: string; type: string; status: string; filled_avg_price: string | null;
  created_at: string; filled_at: string | null; limit_price: string | null;
  stop_price: string | null; order_class: string | null; legs: AlpacaOrder[] | null;
}

interface AlpacaActivity {
  id: string; activity_type: string; symbol: string; side: string;
  qty: string; price: string; cum_qty: string; transaction_time: string; order_id: string;
}

interface FillNotification {
  id: string; symbol: string; side: string; qty: string; price: string; time: Date;
  read: boolean;
}

type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";
type AlpacaSection = "overview" | "positions" | "orders" | "history" | "fills" | "settings";

interface AlpacaDashboardProps { mode?: "paper" | "live"; }

const sections: { id: AlpacaSection; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "positions", label: "Positions", icon: Package },
  { id: "orders", label: "Orders", icon: ListOrdered },
  { id: "fills", label: "Live Fills", icon: Zap },
  { id: "history", label: "History", icon: History },
  { id: "settings", label: "Settings", icon: Settings },
];

export const AlpacaDashboard = ({ mode = "paper" }: AlpacaDashboardProps) => {
  const [account, setAccount] = useState<AlpacaAccount | null>(null);
  const [positions, setPositions] = useState<AlpacaPosition[]>([]);
  const [orders, setOrders] = useState<AlpacaOrder[]>([]);
  const [activities, setActivities] = useState<AlpacaActivity[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [closing, setClosing] = useState<string | null>(null);
  const [canceling, setCanceling] = useState<string | null>(null);
  const [showOrderDialog, setShowOrderDialog] = useState(false);
  const [orderForm, setOrderForm] = useState({
    symbol: "", side: "buy", qty: "", type: "market", limit_price: "",
    order_class: "simple" as "simple" | "bracket" | "oco",
    take_profit: "", stop_loss: "",
  });
  const [placingOrder, setPlacingOrder] = useState(false);
  const [activeSection, setActiveSection] = useState<AlpacaSection>("overview");
  const [orderFilter, setOrderFilter] = useState<"all" | "open" | "closed">("all");
  const [modifyingOrder, setModifyingOrder] = useState<string | null>(null);
  const [modifyForm, setModifyForm] = useState({ qty: "", limit_price: "", stop_price: "" });
  const [searchSymbol, setSearchSymbol] = useState("");

  // Paper account selection (paper1 = ALPACA_API_KEY, paper2 = ALPACA_PAPER2_API_KEY)
  const [paperAccount, setPaperAccountState] = usePaperAccount();

  // Connection status
  const [paperStatus, setPaperStatus] = useState<ConnectionStatus>("disconnected");
  const [liveStatus, setLiveStatus] = useState<ConnectionStatus>("disconnected");
  const currentStatus = mode === "live" ? liveStatus : paperStatus;

  // Live safety gate
  const [liveConfirmed, setLiveConfirmed] = useState(false);
  const [showLiveGate, setShowLiveGate] = useState(false);
  const [liveGateText, setLiveGateText] = useState("");

  // Streaming & fill detection
  const streamingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [streamTick, setStreamTick] = useState(0);
  const [pollRate, setPollRate] = useState(2000); // 2s default
  const prevOrderIdsRef = useRef<Set<string>>(new Set());
  const [fillNotifications, setFillNotifications] = useState<FillNotification[]>([]);
  const [unreadFills, setUnreadFills] = useState(0);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [closingAll, setClosingAll] = useState(false);
  const [cancelingAll, setCancelingAll] = useState(false);

  const verifyConnection = useCallback(async (m: "paper" | "live") => {
    const setter = m === "live" ? setLiveStatus : setPaperStatus;
    setter("connecting");
    try {
      const res = await invokeAlpacaTrade({ body: { action: "verify", mode: m } });
      setter(res.data?.connected ? "connected" : "error");
    } catch { setter("error"); }
  }, []);

  useEffect(() => { verifyConnection("paper"); verifyConnection("live"); }, [verifyConnection]);

  // Re-verify + refetch whenever the selected paper account changes
  useEffect(() => {
    if (mode === "paper") {
      verifyConnection("paper");
      // Reset known orders so fill detection doesn't fire for the other account's fills
      prevOrderIdsRef.current = new Set();
      setAccount(null);
      setPositions([]);
      setOrders([]);
    }
  }, [paperAccount, mode, verifyConnection]);

  // Play fill sound
  const playFillSound = useCallback(() => {
    if (!soundEnabled) return;
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.05);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.start(); osc.stop(ctx.currentTime + 0.3);
    } catch { /* no audio */ }
  }, [soundEnabled]);

  // Detect new fills by comparing order snapshots
  const detectFills = useCallback((newOrders: AlpacaOrder[]) => {
    const newFilled = newOrders.filter(o => o.status === "filled" && o.filled_at);
    const newIds = new Set(newFilled.map(o => o.id));
    const freshFills = newFilled.filter(o => !prevOrderIdsRef.current.has(o.id));

    if (freshFills.length > 0 && prevOrderIdsRef.current.size > 0) {
      const notifications: FillNotification[] = freshFills.map(o => ({
        id: o.id, symbol: o.symbol, side: o.side, qty: o.qty || "?",
        price: o.filled_avg_price || "MKT", time: new Date(), read: false,
      }));
      setFillNotifications(prev => [...notifications, ...prev].slice(0, 50));
      setUnreadFills(prev => prev + freshFills.length);

      freshFills.forEach(o => {
        playFillSound();
        toast.success(
          `🔔 FILL: ${o.side.toUpperCase()} ${o.qty} ${o.symbol} @ $${parseFloat(o.filled_avg_price || "0").toFixed(2)}`,
          { duration: 6000 }
        );
      });
    }

    prevOrderIdsRef.current = new Set([...prevOrderIdsRef.current, ...newIds]);
  }, [playFillSound]);

  const fetchAll = useCallback(async () => {
    if (mode === "live" && !liveConfirmed) return;
    setLoading(true); setError(null);
    try {
      const [accRes, posRes, ordRes] = await Promise.all([
        invokeAlpacaTrade({ body: { action: "account", mode } }),
        invokeAlpacaTrade({ body: { action: "positions", mode } }),
        invokeAlpacaTrade({ body: { action: "orders", mode, limit: 50 } }),
      ]);
      const authError = accRes.data?.error || posRes.data?.error || ordRes.data?.error;
      const invokeError = accRes.error?.message || posRes.error?.message || ordRes.error?.message;
      if (authError || invokeError) throw new Error(authError || invokeError);
      setAccount(accRes.data);
      setPositions(posRes.data || []);
      const newOrders = ordRes.data || [];
      detectFills(newOrders);
      setOrders(newOrders);
      setLastRefresh(new Date());
      setStreamTick(t => t + 1);
      if (mode === "live") setLiveStatus("connected"); else setPaperStatus("connected");
    } catch (err: any) {
      setAccount(null); setPositions([]); setOrders([]);
      setError(err?.message || "Failed to fetch");
      if (mode === "live") setLiveStatus("error"); else setPaperStatus("error");
    } finally { setLoading(false); }
  }, [mode, liveConfirmed, detectFills]);

  const fetchActivities = useCallback(async () => {
    try {
      const res = await invokeAlpacaTrade({ body: { action: "activities", mode, limit: 100 } });
      if (!res.error && res.data && !res.data.error && Array.isArray(res.data)) setActivities(res.data);
    } catch { /* silent */ }
  }, [mode]);

  useEffect(() => {
    if (currentStatus === "connected" && (mode === "paper" || liveConfirmed)) {
      fetchAll();
      fetchActivities();
      streamingRef.current = setInterval(fetchAll, pollRate);
      setStreaming(true);
    } else {
      if (streamingRef.current) clearInterval(streamingRef.current);
      setStreaming(false);
    }
    return () => { if (streamingRef.current) clearInterval(streamingRef.current); };
  }, [currentStatus, mode, liveConfirmed, fetchAll, fetchActivities, pollRate]);

  const handleLiveEnable = () => {
    if (liveStatus !== "connected") { toast.error("Live account not connected."); return; }
    setShowLiveGate(true); setLiveGateText("");
  };
  const confirmLiveTrading = () => {
    if (liveGateText !== "I CONFIRM LIVE TRADING") { toast.error("Type the exact confirmation."); return; }
    setLiveConfirmed(true); setShowLiveGate(false); toast.success("Live trading unlocked.");
  };

  const closePosition = async (symbol: string) => {
    if (mode === "live" && !liveConfirmed) return;
    setClosing(symbol);
    try {
      const res = await invokeAlpacaTrade({ body: { action: "close_position", symbol, mode } });
      if (res.error || res.data?.error) throw new Error(res.data?.error || res.error?.message);
      toast.success(`Closed ${symbol}`); fetchAll();
    } catch (err: any) { toast.error(`Failed: ${err.message}`); }
    finally { setClosing(null); }
  };

  const closeAllPositions = async () => {
    if (mode === "live" && !confirm("Close ALL live positions?")) return;
    setClosingAll(true);
    try {
      const res = await invokeAlpacaTrade({ body: { action: "close_all", mode } });
      if (res.error || res.data?.error) throw new Error(res.data?.error || res.error?.message);
      toast.success("All positions closed"); fetchAll();
    } catch (err: any) { toast.error(`Failed: ${err.message}`); }
    finally { setClosingAll(false); }
  };

  const cancelOrder = async (orderId: string) => {
    setCanceling(orderId);
    try {
      const res = await invokeAlpacaTrade({ body: { action: "cancel_order", order_id: orderId, mode } });
      if (res.error || res.data?.error) throw new Error(res.data?.error || res.error?.message);
      toast.success("Order canceled"); fetchAll();
    } catch (err: any) { toast.error(`Failed: ${err.message}`); }
    finally { setCanceling(null); }
  };

  const cancelAllOrders = async () => {
    if (mode === "live" && !confirm("Cancel ALL live orders?")) return;
    setCancelingAll(true);
    try {
      const res = await invokeAlpacaTrade({ body: { action: "cancel_all", mode } });
      if (res.error || res.data?.error) throw new Error(res.data?.error || res.error?.message);
      toast.success("All orders canceled"); fetchAll();
    } catch (err: any) { toast.error(`Failed: ${err.message}`); }
    finally { setCancelingAll(false); }
  };

  const modifyOrder = async (orderId: string) => {
    try {
      const body: any = { action: "replace_order", order_id: orderId, mode };
      if (modifyForm.qty) body.qty = modifyForm.qty;
      if (modifyForm.limit_price) body.limit_price = modifyForm.limit_price;
      if (modifyForm.stop_price) body.stop_price = modifyForm.stop_price;
      const res = await invokeAlpacaTrade({ body });
      if (res.error || res.data?.error) throw new Error(res.data?.error || res.error?.message);
      toast.success("Order modified"); setModifyingOrder(null); fetchAll();
    } catch (err: any) { toast.error(`Modify failed: ${err.message}`); }
  };

  const placeOrder = async () => {
    if (!orderForm.symbol || !orderForm.qty) { toast.error("Symbol and qty required"); return; }
    if (mode === "live" && !liveConfirmed) { toast.error("Unlock live mode first."); return; }
    setPlacingOrder(true);
    try {
      const body: any = {
        action: "order", symbol: orderForm.symbol.toUpperCase(),
        side: orderForm.side, qty: orderForm.qty, type: orderForm.type,
        time_in_force: "day", mode,
      };
      if (orderForm.type === "limit" && orderForm.limit_price) body.limit_price = orderForm.limit_price;
      if (orderForm.order_class === "bracket") {
        body.order_class = "bracket";
        if (orderForm.take_profit) body.take_profit = orderForm.take_profit;
        if (orderForm.stop_loss) body.stop_loss = orderForm.stop_loss;
      }
      const res = await invokeAlpacaTrade({ body });
      if (res.error || res.data?.error) throw new Error(res.data?.error || res.error?.message);
      if (res.data?.skipped) {
        toast.info(`Order skipped: ${res.data.message || res.data.reason || "Not supported by Alpaca"}`);
        return;
      }
      toast.success(`Order placed: ${orderForm.side.toUpperCase()} ${orderForm.symbol}`);
      setShowOrderDialog(false);
      setOrderForm({ symbol: "", side: "buy", qty: "", type: "market", limit_price: "", order_class: "simple", take_profit: "", stop_loss: "" });
      fetchAll();
    } catch (err: any) { toast.error(`Order failed: ${err.message}`); }
    finally { setPlacingOrder(false); }
  };

  const exportTradeHistory = () => {
    const data = activities.length ? activities : orders;
    if (!data.length) { toast.error("No data to export"); return; }
    const headers = activities.length
      ? ["Date", "Symbol", "Side", "Qty", "Price", "Type"]
      : ["Date", "Symbol", "Side", "Qty", "Type", "Status", "Fill Price"];
    const rows = activities.length
      ? activities.map(a => [new Date(a.transaction_time).toLocaleString(), a.symbol, a.side, a.qty, a.price, a.activity_type])
      : orders.map(o => [new Date(o.created_at).toLocaleString(), o.symbol, o.side, o.qty || o.notional || "", o.type, o.status, o.filled_avg_price || ""]);
    const csv = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = `alpaca-trades-${mode}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
    toast.success("Trade history exported");
  };

  // Computed metrics
  const metrics = useMemo(() => {
    if (!account) return null;
    const equity = parseFloat(account.equity) || 0;
    const lastEq = parseFloat(account.last_equity || account.equity) || 0;
    const dayPl = equity - lastEq;
    const dayPlPct = lastEq > 0 ? (dayPl / lastEq) * 100 : 0;
    const totalUnrealizedPl = positions.reduce((s, p) => s + (parseFloat(p.unrealized_pl) || 0), 0);
    const totalCostBasis = positions.reduce((s, p) => s + (parseFloat(p.cost_basis) || 0), 0);
    const investedPct = equity > 0 ? (totalCostBasis / equity) * 100 : 0;
    const marginUsed = parseFloat(account.initial_margin) || 0;
    const marginPct = equity > 0 ? (marginUsed / equity) * 100 : 0;
    const filledOrders = orders.filter(o => o.status === "filled");
    const longVal = parseFloat(account.long_market_value) || 0;
    const shortVal = Math.abs(parseFloat(account.short_market_value) || 0);
    const grossExposure = longVal + shortVal;
    const netExposure = longVal - shortVal;
    const cashVal = parseFloat(account.cash) || 0;

    // Account health score (0-100)
    const pdtPenalty = account.pattern_day_trader ? 20 : 0;
    const marginPenalty = Math.min(marginPct * 0.5, 30);
    const diversification = positions.length >= 3 ? 10 : positions.length >= 2 ? 5 : 0;
    const cashReserve = cashVal > equity * 0.1 ? 10 : 0;
    const health = Math.max(0, Math.min(100, 100 - pdtPenalty - marginPenalty + diversification + cashReserve));

    return {
      equity, dayPl, dayPlPct, totalUnrealizedPl, investedPct,
      marginUsed, marginPct, totalCostBasis, longVal, shortVal,
      netExposure, grossExposure,
      buyingPower: parseFloat(account.buying_power) || 0,
      cash: cashVal,
      filledCount: filledOrders.length,
      openOrderCount: orders.filter(o => ["new", "accepted", "pending_new", "partially_filled"].includes(o.status)).length,
      health,
    };
  }, [account, positions, orders]);

  const fmt = (v: string | number | null | undefined, d = 2) => {
    if (v == null || v === "") return "--";
    const n = typeof v === "string" ? parseFloat(v) : v;
    return isNaN(n) ? "--" : n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
  };
  const fmtPct = (v: string | null | undefined) => {
    if (v == null || v === "") return "--";
    const n = parseFloat(v) * 100;
    return isNaN(n) ? "--" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
  };
  const plColor = (v: string | number | null | undefined) => {
    if (v == null) return "text-muted-foreground";
    const n = typeof v === "string" ? parseFloat(v) : v;
    return n >= 0 ? "text-gain" : "text-loss";
  };
  const statusColor = (s: string) => {
    const m: Record<string, string> = {
      filled: "text-gain", partially_filled: "text-yellow-400",
      new: "text-blue-400", accepted: "text-blue-400",
      canceled: "text-muted-foreground", expired: "text-muted-foreground",
      rejected: "text-loss", pending_new: "text-blue-400",
    };
    return m[s] || "text-foreground";
  };
  const connIcon = (s: ConnectionStatus) => {
    switch (s) {
      case "connected": return <CheckCircle2 className="w-3 h-3 text-gain" />;
      case "connecting": return <Loader2 className="w-3 h-3 text-primary animate-spin" />;
      case "error": return <XCircle className="w-3 h-3 text-loss" />;
      default: return <WifiOff className="w-3 h-3 text-muted-foreground" />;
    }
  };
  const connLabel = (s: ConnectionStatus) => {
    switch (s) {
      case "connected": return "Connected";
      case "connecting": return "Connecting...";
      case "error": return "Auth Failed";
      default: return "Not Connected";
    }
  };

  const filteredOrders = orders.filter(o => {
    if (orderFilter === "open") return ["new", "accepted", "pending_new", "partially_filled"].includes(o.status);
    if (orderFilter === "closed") return ["filled", "canceled", "expired", "rejected"].includes(o.status);
    return true;
  }).filter(o => !searchSymbol || o.symbol.toLowerCase().includes(searchSymbol.toLowerCase()));

  const filteredPositions = positions.filter(p => !searchSymbol || p.symbol.toLowerCase().includes(searchSymbol.toLowerCase()));

  // Health color
  const healthColor = (h: number) => h >= 70 ? "text-gain" : h >= 40 ? "text-yellow-400" : "text-loss";
  const healthBg = (h: number) => h >= 70 ? "bg-gain" : h >= 40 ? "bg-yellow-400" : "bg-loss";

  // Live mode gate
  if (mode === "live" && !liveConfirmed) {
    return (
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="px-4 py-3 flex items-center justify-between border-b border-border/50">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-loss/10 flex items-center justify-center"><Shield className="w-3.5 h-3.5 text-loss" /></div>
            <div>
              <h3 className="text-sm font-bold text-foreground">Live Trading Safety Gate</h3>
              <div className="flex items-center gap-2 mt-0.5">
                <div className="flex items-center gap-1 text-[9px]">{connIcon(paperStatus)}<span className="text-muted-foreground">Paper: {connLabel(paperStatus)}</span></div>
                <div className="flex items-center gap-1 text-[9px]">{connIcon(liveStatus)}<span className="text-muted-foreground">Live: {connLabel(liveStatus)}</span></div>
              </div>
            </div>
          </div>
        </div>
        <div className="p-4 space-y-3">
          <div className="p-3 rounded-lg bg-loss/5 border border-loss/20">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-loss mt-0.5 shrink-0" />
              <div className="text-xs text-foreground space-y-1">
                <p className="font-semibold">⚠️ Real Money Warning</p>
                <p className="text-muted-foreground">Live mode executes <span className="text-loss font-semibold">real trades with real money</span>. Confirm below to proceed.</p>
              </div>
            </div>
          </div>
          <button onClick={handleLiveEnable} disabled={liveStatus !== "connected"} className="w-full py-2.5 rounded-lg text-sm font-semibold bg-loss/10 text-loss border border-loss/20 hover:bg-loss/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
            {liveStatus === "connected" ? "🔓 Unlock Live Trading" : liveStatus === "connecting" ? "Verifying..." : "❌ Live Account Not Connected"}
          </button>
          {liveStatus === "error" && <p className="text-[10px] text-muted-foreground text-center">Add ALPACA_LIVE_API_KEY and ALPACA_LIVE_API_SECRET in backend secrets.</p>}
        </div>
        <Dialog open={showLiveGate} onOpenChange={setShowLiveGate}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-sm text-loss"><Shield className="w-4 h-4" />Confirm Live Trading</DialogTitle>
              <DialogDescription className="text-xs">This enables real money trades for this session.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="p-2 rounded bg-loss/10 border border-loss/20 text-[10px] text-loss">⚠️ All orders will execute with real money.</div>
              <div>
                <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Type "I CONFIRM LIVE TRADING"</label>
                <input value={liveGateText} onChange={e => setLiveGateText(e.target.value)} placeholder="I CONFIRM LIVE TRADING" className="w-full mt-1 px-3 py-2 rounded-md bg-secondary border border-border text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-loss" />
              </div>
              <button onClick={confirmLiveTrading} disabled={liveGateText !== "I CONFIRM LIVE TRADING"} className="w-full py-2.5 rounded-lg text-sm font-semibold bg-loss text-white hover:bg-loss/90 transition-colors disabled:opacity-40">Confirm & Enable</button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  if (error && !account) {
    return (
      <div className="bg-card rounded-xl border border-border p-4 space-y-2">
        <div className="flex items-center gap-2 text-loss text-sm">
          <AlertTriangle className="w-4 h-4" />
          <span className="flex-1 truncate">Alpaca: {error}</span>
          <button onClick={fetchAll} className="text-xs text-primary hover:underline shrink-0">Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      {/* ========== HEADER ========== */}
      <div className="px-4 py-3 flex items-center justify-between border-b border-border/50">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Landmark className="w-3.5 h-3.5 text-primary" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <h3 className="text-sm font-bold text-foreground">Brokerage</h3>
              <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono font-semibold ${mode === "live" ? "bg-loss/15 text-loss border border-loss/20" : "bg-accent/15 text-accent border border-accent/20"}`}>
                {mode === "live" ? "🔴 LIVE" : "📝 PAPER"}
              </span>
              {account?.status && (
                <span className={`text-[9px] px-1 py-0.5 rounded font-mono ${account.status === "ACTIVE" ? "bg-gain/15 text-gain" : "bg-loss/15 text-loss"}`}>{account.status}</span>
              )}
              {metrics && (
                <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono font-bold ${healthColor(metrics.health)} ${healthBg(metrics.health)}/10`}>
                  Health: {metrics.health}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-0.5">
              <div className="flex items-center gap-1 text-[9px]">{connIcon(currentStatus)}<span className="text-muted-foreground">{connLabel(currentStatus)}</span></div>
              {streaming && (
                <div className="flex items-center gap-1 text-[9px] text-gain">
                  <Radio className="w-2.5 h-2.5 animate-pulse" />
                  <span>Live • {pollRate / 1000}s • tick {streamTick}</span>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {/* Fill notification bell */}
          <button
            onClick={() => { setActiveSection("fills"); setUnreadFills(0); }}
            className="relative p-1.5 rounded-md hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
          >
            {unreadFills > 0 ? <BellRing className="w-3.5 h-3.5 text-primary animate-pulse" /> : <Bell className="w-3.5 h-3.5" />}
            {unreadFills > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-primary text-primary-foreground text-[7px] font-bold flex items-center justify-center">{unreadFills}</span>
            )}
          </button>
          <button onClick={() => setSoundEnabled(!soundEnabled)} className="p-1.5 rounded-md hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground" title={soundEnabled ? "Mute fills" : "Unmute fills"}>
            {soundEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
          </button>
          <button onClick={() => setShowOrderDialog(true)} className="text-[10px] px-2.5 py-1.5 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors font-semibold">+ Order</button>
          <button onClick={exportTradeHistory} className="p-1.5 rounded-md hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground" title="Export CSV"><FileDown className="w-3.5 h-3.5" /></button>
          <button onClick={fetchAll} disabled={loading} className="p-1.5 rounded-md hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"><RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /></button>
        </div>
      </div>

      {/* ========== PAPER ACCOUNT SELECTOR ========== */}
      {mode === "paper" && (
        <div className="px-3 py-1.5 border-b border-border/30 flex items-center gap-2 bg-secondary/20">
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">Paper Account</span>
          <div className="flex items-center gap-0.5 bg-background rounded-md p-0.5 border border-border/50">
            <button
              onClick={() => setPaperAccountState("paper1")}
              className={`text-[10px] px-2.5 py-1 rounded transition-all font-mono font-semibold ${paperAccount === "paper1" ? "bg-primary/15 text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              title="ALPACA_API_KEY"
            >
              Paper 1
            </button>
            <button
              onClick={() => setPaperAccountState("paper2")}
              className={`text-[10px] px-2.5 py-1 rounded transition-all font-mono font-semibold ${paperAccount === "paper2" ? "bg-primary/15 text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              title="ALPACA_PAPER2_API_KEY"
            >
              Paper 2
            </button>
          </div>
          <span className="text-[9px] text-muted-foreground ml-auto">
            All paper trades + dashboards route to <span className="font-mono text-foreground">{paperAccount}</span>
          </span>
        </div>
      )}

      {/* ========== SUB-NAV ========== */}
      <div className="px-3 py-1.5 border-b border-border/30 overflow-x-auto scrollbar-hide">
        <div className="flex gap-0.5 min-w-max">
          {sections.map(s => (
            <button key={s.id} onClick={() => { setActiveSection(s.id); if (s.id === "history") fetchActivities(); if (s.id === "fills") setUnreadFills(0); }}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[10px] font-medium transition-all whitespace-nowrap ${activeSection === s.id ? "bg-secondary text-foreground shadow-sm border border-border/50" : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"}`}>
              <s.icon className="w-3 h-3" />
              {s.label}
              {s.id === "positions" && positions.length > 0 && <span className="ml-0.5 text-[8px] bg-primary/15 text-primary px-1 rounded">{positions.length}</span>}
              {s.id === "orders" && metrics?.openOrderCount ? <span className="ml-0.5 text-[8px] bg-accent/15 text-accent px-1 rounded">{metrics.openOrderCount}</span> : null}
              {s.id === "fills" && unreadFills > 0 && <span className="ml-0.5 text-[8px] bg-primary/15 text-primary px-1 rounded animate-pulse">{unreadFills}</span>}
            </button>
          ))}
        </div>
      </div>

      {/* ===== OVERVIEW ===== */}
      {activeSection === "overview" && metrics && (
        <>
          {/* Equity + Day P&L hero */}
          <div className="px-4 py-3 bg-gradient-to-r from-primary/5 to-transparent border-b border-border/30">
            <div className="flex items-baseline gap-3">
              <span className="text-2xl font-bold font-mono text-foreground">${fmt(metrics.equity, 0)}</span>
              <span className={`text-sm font-mono font-bold ${plColor(metrics.dayPl)}`}>
                {metrics.dayPl >= 0 ? "+" : ""}${fmt(metrics.dayPl, 0)}
                <span className="text-[10px] ml-1">({metrics.dayPlPct >= 0 ? "+" : ""}{metrics.dayPlPct.toFixed(2)}%)</span>
              </span>
              <span className="text-[9px] text-muted-foreground ml-auto">Today</span>
            </div>
          </div>

          {/* Key metrics grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-0 border-b border-border/50">
            {[
              { label: "Cash", value: `$${fmt(metrics.cash, 0)}`, color: "text-foreground", icon: <Wallet className="w-3 h-3" /> },
              { label: "Buying Power", value: `$${fmt(metrics.buyingPower, 0)}`, color: "text-accent", icon: <Zap className="w-3 h-3" /> },
              { label: "Unrealized P&L", value: `${metrics.totalUnrealizedPl >= 0 ? "+" : ""}$${fmt(metrics.totalUnrealizedPl, 0)}`, color: plColor(metrics.totalUnrealizedPl), icon: metrics.totalUnrealizedPl >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" /> },
              { label: "Invested", value: `${metrics.investedPct.toFixed(1)}%`, color: "text-foreground", icon: <PieChart className="w-3 h-3" /> },
              { label: "Day Trades", value: `${account?.daytrade_count || 0}/3`, color: (account?.daytrade_count || 0) >= 3 ? "text-loss" : "text-foreground", icon: <ArrowRightLeft className="w-3 h-3" /> },
              { label: "Open Orders", value: `${metrics.openOrderCount}`, color: metrics.openOrderCount > 0 ? "text-accent" : "text-muted-foreground", icon: <ListOrdered className="w-3 h-3" /> },
            ].map((item, i) => (
              <div key={item.label} className="px-3 py-2.5 border-r border-border/20 last:border-r-0">
                <div className="flex items-center gap-1 text-[8px] text-muted-foreground uppercase tracking-wider">{item.icon}{item.label}</div>
                <div className={`text-sm font-bold font-mono ${item.color} mt-0.5`}>{item.value}</div>
              </div>
            ))}
          </div>

          {/* Exposure metrics */}
          <div className="p-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { label: "Long Exposure", value: `$${fmt(metrics.longVal, 0)}`, icon: <TrendingUp className="w-3 h-3 text-gain" />, color: "text-foreground" },
              { label: "Short Exposure", value: `$${fmt(metrics.shortVal, 0)}`, icon: <TrendingDown className="w-3 h-3 text-loss" />, color: "text-foreground" },
              { label: "Net Exposure", value: `$${fmt(metrics.netExposure, 0)}`, icon: <BarChart3 className="w-3 h-3 text-primary" />, color: plColor(metrics.netExposure) },
              { label: "Margin Used", value: `$${fmt(metrics.marginUsed, 0)} (${metrics.marginPct.toFixed(1)}%)`, icon: <Shield className="w-3 h-3 text-yellow-400" />, color: metrics.marginPct > 50 ? "text-loss" : "text-foreground" },
            ].map(item => (
              <div key={item.label} className="p-2.5 rounded-lg bg-secondary/20 border border-border/30">
                <div className="flex items-center gap-1 mb-1">{item.icon}<span className="text-[8px] text-muted-foreground uppercase">{item.label}</span></div>
                <div className={`text-sm font-mono font-bold ${item.color}`}>{item.value}</div>
              </div>
            ))}
          </div>

          {/* Allocation bar */}
          {metrics.equity > 0 && (
            <div className="px-3 pb-2">
              <div className="text-[9px] text-muted-foreground mb-1">Portfolio Allocation</div>
              <div className="h-3 rounded-full bg-secondary overflow-hidden flex">
                <div className="bg-gain/60 h-full transition-all" style={{ width: `${(metrics.longVal / metrics.equity) * 100}%` }} title={`Long: ${((metrics.longVal / metrics.equity) * 100).toFixed(1)}%`} />
                <div className="bg-loss/60 h-full transition-all" style={{ width: `${(metrics.shortVal / metrics.equity) * 100}%` }} title={`Short: ${((metrics.shortVal / metrics.equity) * 100).toFixed(1)}%`} />
              </div>
              <div className="flex justify-between text-[8px] text-muted-foreground mt-0.5">
                <span className="text-gain">Long {((metrics.longVal / metrics.equity) * 100).toFixed(0)}%</span>
                <span>Cash {((metrics.cash / metrics.equity) * 100).toFixed(0)}%</span>
                <span className="text-loss">Short {((metrics.shortVal / metrics.equity) * 100).toFixed(0)}%</span>
              </div>
            </div>
          )}

          {/* Account health + PDT */}
          {account && (
            <div className="px-3 pb-3 flex gap-2">
              <div className={`flex-1 flex items-center gap-2 p-2 rounded-lg text-[10px] ${account.pattern_day_trader ? "bg-loss/10 border border-loss/20 text-loss" : "bg-gain/5 border border-gain/20 text-gain"}`}>
                <Shield className="w-3 h-3" />
                PDT: {account.pattern_day_trader ? "⚠️ FLAGGED" : "✅ Clear"}
                <span className="ml-auto font-mono">{account.multiplier}x</span>
              </div>
              <div className={`flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary/20 border border-border/30`}>
                <Gauge className="w-3.5 h-3.5" />
                <div>
                  <div className="text-[8px] text-muted-foreground uppercase">Health</div>
                  <div className={`text-sm font-bold font-mono ${healthColor(metrics.health)}`}>{metrics.health}</div>
                </div>
                <div className="w-12 h-1.5 rounded-full bg-secondary overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${healthBg(metrics.health)}`} style={{ width: `${metrics.health}%` }} />
                </div>
              </div>
            </div>
          )}

          {/* Quick actions */}
          {(positions.length > 0 || metrics.openOrderCount > 0) && (
            <div className="px-3 pb-3 flex gap-2">
              {positions.length > 0 && (
                <button onClick={closeAllPositions} disabled={closingAll} className="flex items-center gap-1 text-[9px] px-2.5 py-1.5 rounded-md bg-loss/10 text-loss hover:bg-loss/20 border border-loss/20 transition-colors disabled:opacity-50">
                  {closingAll ? <Loader2 className="w-3 h-3 animate-spin" /> : <Ban className="w-3 h-3" />} Close All Positions
                </button>
              )}
              {metrics.openOrderCount > 0 && (
                <button onClick={cancelAllOrders} disabled={cancelingAll} className="flex items-center gap-1 text-[9px] px-2.5 py-1.5 rounded-md bg-secondary text-muted-foreground hover:text-foreground border border-border transition-colors disabled:opacity-50">
                  {cancelingAll ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />} Cancel All Orders
                </button>
              )}
            </div>
          )}
        </>
      )}

      {/* ===== POSITIONS ===== */}
      {activeSection === "positions" && (
        <div className="p-3 space-y-2">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
              <input value={searchSymbol} onChange={e => setSearchSymbol(e.target.value)} placeholder="Filter symbol..." className="w-full text-[10px] pl-6 pr-2 py-1.5 rounded bg-secondary border border-border text-foreground" />
            </div>
            {positions.length > 0 && (
              <button onClick={closeAllPositions} disabled={closingAll} className="flex items-center gap-1 text-[9px] px-2 py-1.5 rounded bg-loss/10 text-loss hover:bg-loss/20 transition-colors disabled:opacity-50">
                {closingAll ? <Loader2 className="w-3 h-3 animate-spin" /> : <Ban className="w-3 h-3" />} Close All
              </button>
            )}
          </div>
          {/* Position P&L heatmap */}
          {positions.length > 0 && (
            <div className="flex gap-1 flex-wrap">
              {positions.map(p => {
                const pl = parseFloat(p.unrealized_pl || "0");
                const plPct = parseFloat(p.unrealized_plpc || "0") * 100;
                const intensity = Math.min(Math.abs(plPct) / 5, 1);
                return (
                  <div
                    key={`heat-${p.symbol}`}
                    className="px-2 py-1.5 rounded text-center cursor-pointer hover:scale-105 transition-transform"
                    style={{
                      backgroundColor: pl >= 0 ? `hsla(var(--gain), ${0.1 + intensity * 0.3})` : `hsla(var(--loss), ${0.1 + intensity * 0.3})`,
                      minWidth: "60px",
                    }}
                    title={`${p.symbol}: ${pl >= 0 ? "+" : ""}$${pl.toFixed(2)} (${plPct >= 0 ? "+" : ""}${plPct.toFixed(2)}%)`}
                  >
                    <div className="text-[9px] font-bold font-mono text-foreground">{p.symbol}</div>
                    <div className={`text-[8px] font-mono font-bold ${plColor(pl)}`}>{plPct >= 0 ? "+" : ""}{plPct.toFixed(1)}%</div>
                  </div>
                );
              })}
            </div>
          )}
          {filteredPositions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground"><Package className="w-6 h-6 mx-auto mb-2 opacity-40" /><p className="text-xs">No open positions</p></div>
          ) : (
            <div className="space-y-1.5">
              {filteredPositions.map(p => {
                const changePct = parseFloat(p.change_today || "0") * 100;
                const plVal = parseFloat(p.unrealized_pl || "0");
                return (
                  <div key={p.symbol} className="bg-secondary/20 rounded-lg px-3 py-2.5 border border-border/30 hover:border-border/60 transition-colors">
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm text-foreground">{p.symbol}</span>
                          <span className={`text-[9px] px-1 py-0.5 rounded font-mono ${p.side === "long" ? "bg-gain/10 text-gain" : "bg-loss/10 text-loss"}`}>
                            {p.side === "long" ? "LONG" : "SHORT"}
                          </span>
                          <span className={`text-[9px] font-mono ${changePct >= 0 ? "text-gain" : "text-loss"}`}>
                            Today: {changePct >= 0 ? "+" : ""}{changePct.toFixed(2)}%
                          </span>
                        </div>
                        <div className="text-[10px] text-muted-foreground font-mono mt-0.5 truncate">
                          {fmt(p.qty, 4)} @ ${fmt(p.avg_entry_price)} → ${fmt(p.current_price)} • Cost: ${fmt(p.cost_basis, 0)}
                        </div>
                        {/* Mini P&L bar */}
                        <div className="mt-1 flex items-center gap-1.5">
                          <div className="w-20 h-1 rounded-full bg-secondary overflow-hidden">
                            <div className={`h-full rounded-full ${plVal >= 0 ? "bg-gain" : "bg-loss"}`} style={{ width: `${Math.min(Math.abs(parseFloat(p.unrealized_plpc || "0") * 100) * 5, 100)}%` }} />
                          </div>
                          <span className={`text-[8px] font-mono ${plColor(p.unrealized_pl)}`}>{fmtPct(p.unrealized_plpc)}</span>
                        </div>
                      </div>
                      <div className="text-right mr-2 shrink-0">
                        <div className="font-mono text-xs text-foreground">${fmt(p.market_value)}</div>
                        <div className={`font-mono text-xs font-bold ${plColor(p.unrealized_pl)}`}>
                          {plVal >= 0 ? "+" : ""}${fmt(p.unrealized_pl)}
                        </div>
                      </div>
                      <button onClick={() => closePosition(p.symbol)} disabled={closing === p.symbol} className="p-1.5 rounded-md bg-loss/10 text-loss hover:bg-loss/20 transition-colors disabled:opacity-50 shrink-0" title="Close">
                        {closing === p.symbol ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ===== ORDERS ===== */}
      {activeSection === "orders" && (
        <div className="p-3 space-y-2">
          <div className="flex items-center gap-2">
            <div className="flex gap-0.5 bg-secondary/30 rounded-md p-0.5 flex-1">
              {(["all", "open", "closed"] as const).map(f => (
                <button key={f} onClick={() => setOrderFilter(f)} className={`flex-1 text-[9px] py-1 rounded font-medium transition-colors ${orderFilter === f ? "bg-card text-foreground shadow-sm border border-border/50" : "text-muted-foreground hover:text-foreground"}`}>
                  {f.charAt(0).toUpperCase() + f.slice(1)} ({orders.filter(o => {
                    if (f === "open") return ["new", "accepted", "pending_new", "partially_filled"].includes(o.status);
                    if (f === "closed") return ["filled", "canceled", "expired", "rejected"].includes(o.status);
                    return true;
                  }).length})
                </button>
              ))}
            </div>
            {metrics && metrics.openOrderCount > 0 && (
              <button onClick={cancelAllOrders} disabled={cancelingAll} className="flex items-center gap-1 text-[9px] px-2 py-1.5 rounded bg-loss/10 text-loss hover:bg-loss/20 transition-colors disabled:opacity-50">
                {cancelingAll ? <Loader2 className="w-3 h-3 animate-spin" /> : <Ban className="w-3 h-3" />} Cancel All
              </button>
            )}
          </div>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
            <input value={searchSymbol} onChange={e => setSearchSymbol(e.target.value)} placeholder="Filter symbol..." className="w-full text-[10px] pl-6 pr-2 py-1.5 rounded bg-secondary border border-border text-foreground" />
          </div>
          {filteredOrders.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground"><ListOrdered className="w-6 h-6 mx-auto mb-2 opacity-40" /><p className="text-xs">No {orderFilter !== "all" ? orderFilter : ""} orders</p></div>
          ) : (
            <div className="space-y-1 max-h-96 overflow-y-auto scrollbar-hide">
              {filteredOrders.map(o => (
                <div key={o.id} className="bg-secondary/20 rounded-lg px-3 py-2 border border-border/30 text-[11px]">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span className={`font-bold uppercase text-xs ${o.side === "buy" ? "text-gain" : "text-loss"}`}>
                        {o.side === "buy" ? <ArrowUpRight className="w-3 h-3 inline" /> : <ArrowDownRight className="w-3 h-3 inline" />} {o.side}
                      </span>
                      <span className="font-semibold text-foreground">{o.symbol}</span>
                      <span className="text-muted-foreground truncate">
                        {o.qty || (o.notional ? `$${fmt(o.notional)}` : "--")} • {o.type}
                        {o.limit_price ? ` @ $${fmt(o.limit_price)}` : ""}
                        {o.order_class ? ` [${o.order_class}]` : ""}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {o.filled_avg_price && <span className="font-mono text-foreground">@${fmt(o.filled_avg_price)}</span>}
                      <span className={`font-semibold text-[10px] ${statusColor(o.status)}`}>{o.status}</span>
                      {["new", "accepted", "pending_new"].includes(o.status) && (
                        <>
                          <button onClick={() => { setModifyingOrder(o.id); setModifyForm({ qty: o.qty || "", limit_price: o.limit_price || "", stop_price: o.stop_price || "" }); }} className="p-1 rounded bg-accent/10 text-accent hover:bg-accent/20 transition-colors" title="Modify">
                            <Edit3 className="w-2.5 h-2.5" />
                          </button>
                          <button onClick={() => cancelOrder(o.id)} disabled={canceling === o.id} className="p-1 rounded bg-loss/10 text-loss hover:bg-loss/20 transition-colors disabled:opacity-50">
                            {canceling === o.id ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <X className="w-2.5 h-2.5" />}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  {o.legs && o.legs.length > 0 && (
                    <div className="mt-1 pl-4 border-l-2 border-border/30 space-y-0.5">
                      {o.legs.map((leg, i) => (
                        <div key={i} className="text-[9px] text-muted-foreground flex items-center gap-2">
                          <span className={leg.side === "sell" ? "text-loss" : "text-gain"}>{leg.type}</span>
                          {leg.limit_price && <span>TP: ${fmt(leg.limit_price)}</span>}
                          {leg.stop_price && <span>SL: ${fmt(leg.stop_price)}</span>}
                          <span className={statusColor(leg.status)}>{leg.status}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="text-[8px] text-muted-foreground mt-0.5">{new Date(o.created_at).toLocaleString()}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ===== LIVE FILLS (Real-time notification feed) ===== */}
      {activeSection === "fills" && (
        <div className="p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-primary" />
              <span className="text-xs font-semibold text-foreground">Real-Time Fill Notifications</span>
              <span className="text-[8px] font-mono text-muted-foreground bg-secondary px-1.5 py-0.5 rounded">
                Polling every {pollRate / 1000}s
              </span>
            </div>
            <div className="flex items-center gap-1">
              <select value={pollRate} onChange={e => setPollRate(Number(e.target.value))} className="text-[9px] px-2 py-1 rounded bg-secondary border border-border text-foreground">
                <option value={1000}>1s (Fast)</option>
                <option value={2000}>2s (Default)</option>
                <option value={5000}>5s (Slow)</option>
              </select>
              <button onClick={() => setFillNotifications([])} className="text-[9px] px-2 py-1 rounded bg-secondary text-muted-foreground hover:text-foreground transition-colors">Clear</button>
            </div>
          </div>

          {/* Streaming indicator */}
          <div className={`flex items-center gap-2 p-2.5 rounded-lg border ${streaming ? "bg-gain/5 border-gain/20" : "bg-secondary/20 border-border/30"}`}>
            <div className={`w-2 h-2 rounded-full ${streaming ? "bg-gain animate-pulse" : "bg-muted-foreground"}`} />
            <span className={`text-[10px] font-semibold ${streaming ? "text-gain" : "text-muted-foreground"}`}>
              {streaming ? `Stream active — monitoring for fills (tick ${streamTick})` : "Stream paused"}
            </span>
            {streaming && <Radio className="w-3 h-3 text-gain animate-pulse ml-auto" />}
          </div>

          {fillNotifications.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <BellRing className="w-8 h-8 mx-auto mb-3 opacity-30" />
              <p className="text-xs">No fill notifications yet</p>
              <p className="text-[10px] mt-1">Place an order and watch fills appear here in real-time</p>
            </div>
          ) : (
            <div className="space-y-1 max-h-[400px] overflow-y-auto scrollbar-hide">
              {fillNotifications.map((n, i) => (
                <div key={`${n.id}-${i}`} className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border transition-colors ${!n.read ? "bg-primary/5 border-primary/20" : "bg-secondary/20 border-border/30"}`}>
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center ${n.side === "buy" ? "bg-gain/15" : "bg-loss/15"}`}>
                    {n.side === "buy" ? <ArrowUpRight className="w-3 h-3 text-gain" /> : <ArrowDownRight className="w-3 h-3 text-loss" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className={`text-xs font-bold uppercase ${n.side === "buy" ? "text-gain" : "text-loss"}`}>{n.side}</span>
                      <span className="text-xs font-bold text-foreground">{n.symbol}</span>
                      <span className="text-[10px] font-mono text-muted-foreground">{n.qty} shares</span>
                    </div>
                    <div className="text-[9px] font-mono text-muted-foreground">
                      @ ${n.price !== "MKT" ? parseFloat(n.price).toFixed(2) : "MKT"} • {n.time.toLocaleTimeString()}
                    </div>
                  </div>
                  {!n.read && <span className="w-2 h-2 rounded-full bg-primary shrink-0" />}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ===== HISTORY ===== */}
      {activeSection === "history" && (
        <div className="p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">Recent fills ({activities.length})</span>
            <button onClick={exportTradeHistory} className="flex items-center gap-1 text-[10px] text-primary hover:underline"><Download className="w-3 h-3" /> Export CSV</button>
          </div>
          {activities.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground"><History className="w-6 h-6 mx-auto mb-2 opacity-40" /><p className="text-xs">No trade history</p><button onClick={fetchActivities} className="text-[10px] text-primary hover:underline mt-2">Load</button></div>
          ) : (
            <div className="space-y-1 max-h-96 overflow-y-auto scrollbar-hide">
              {activities.map(a => (
                <div key={a.id} className="flex items-center justify-between bg-secondary/20 rounded-lg px-3 py-2 border border-border/30 text-[11px]">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className={`font-bold uppercase text-xs ${a.side === "buy" ? "text-gain" : "text-loss"}`}>
                      {a.side === "buy" ? <ArrowUpRight className="w-3 h-3 inline" /> : <ArrowDownRight className="w-3 h-3 inline" />} {a.side}
                    </span>
                    <span className="font-semibold text-foreground">{a.symbol}</span>
                    <span className="text-muted-foreground">{a.qty} @ ${fmt(a.price)}</span>
                  </div>
                  <span className="text-[9px] text-muted-foreground font-mono shrink-0">
                    {new Date(a.transaction_time).toLocaleDateString()} {new Date(a.transaction_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ===== SETTINGS ===== */}
      {activeSection === "settings" && (
        <div className="p-4 space-y-4">
          <div className="space-y-3">
            <h4 className="text-xs font-semibold text-foreground">Connection Status</h4>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "Paper Account (Paper 2)", status: paperStatus, keys: "ALPACA_PAPER2_API_KEY / SECRET" },
                { label: "Live Account", status: liveStatus, keys: "ALPACA_LIVE_API_KEY / SECRET" },
              ].map(c => (
                <div key={c.label} className="p-3 rounded-lg bg-secondary/20 border border-border/30 space-y-1">
                  <div className="flex items-center gap-1.5">{connIcon(c.status)}<span className="text-xs font-medium text-foreground">{c.label}</span></div>
                  <p className="text-[10px] text-muted-foreground">{connLabel(c.status)}</p>
                  <p className="text-[9px] text-muted-foreground font-mono">{c.keys}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Stream settings */}
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-foreground">Streaming Settings</h4>
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-lg bg-secondary/20 border border-border/30 space-y-2">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Poll Interval</div>
                <select value={pollRate} onChange={e => setPollRate(Number(e.target.value))} className="w-full text-xs px-2 py-1.5 rounded bg-secondary border border-border text-foreground">
                  <option value={1000}>1s — Fastest</option>
                  <option value={2000}>2s — Default</option>
                  <option value={5000}>5s — Conservative</option>
                  <option value={10000}>10s — Battery Saver</option>
                </select>
              </div>
              <div className="p-3 rounded-lg bg-secondary/20 border border-border/30 space-y-2">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Fill Sounds</div>
                <button onClick={() => setSoundEnabled(!soundEnabled)} className={`w-full flex items-center justify-center gap-1.5 py-1.5 rounded text-xs font-medium transition-colors ${soundEnabled ? "bg-gain/10 text-gain border border-gain/20" : "bg-secondary text-muted-foreground border border-border"}`}>
                  {soundEnabled ? <Volume2 className="w-3 h-3" /> : <VolumeX className="w-3 h-3" />}
                  {soundEnabled ? "Enabled" : "Disabled"}
                </button>
              </div>
            </div>
          </div>

          {account && (
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-foreground">Account Details</h4>
              <div className="space-y-1 text-[11px]">
                {[
                  ["Currency", account.currency],
                  ["Multiplier", `${account.multiplier}x`],
                  ["SMA", `$${fmt(account.sma)}`],
                  ["Pattern Day Trader", account.pattern_day_trader ? "Yes ⚠️" : "No"],
                  ["Account Status", account.status],
                ].map(([l, v]) => (
                  <div key={l} className="flex justify-between py-1 border-b border-border/20">
                    <span className="text-muted-foreground">{l}</span>
                    <span className="font-mono text-foreground">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={() => { verifyConnection("paper"); verifyConnection("live"); }} className="flex-1 py-2 rounded-lg text-xs font-medium bg-secondary text-foreground hover:bg-secondary/80 transition-colors">🔄 Re-verify</button>
            <button onClick={exportTradeHistory} className="flex-1 py-2 rounded-lg text-xs font-medium bg-secondary text-foreground hover:bg-secondary/80 transition-colors">📥 Export All</button>
          </div>
        </div>
      )}

      {/* Footer */}
      {lastRefresh && (
        <div className="px-4 py-1.5 border-t border-border/30 flex items-center justify-between text-[8px] text-muted-foreground">
          <span className="flex items-center gap-1"><Activity className="w-2.5 h-2.5" />Synced: {lastRefresh.toLocaleTimeString()}</span>
          <span>{streaming ? `Streaming (${pollRate / 1000}s) • tick ${streamTick}` : "Paused"}</span>
        </div>
      )}

      {/* Place Order Dialog */}
      <Dialog open={showOrderDialog} onOpenChange={setShowOrderDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Landmark className="w-4 h-4 text-primary" />Place Order
              <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono ${mode === "live" ? "bg-loss/15 text-loss" : "bg-accent/15 text-accent"}`}>{mode === "live" ? "LIVE" : "PAPER"}</span>
            </DialogTitle>
            <DialogDescription className="text-xs">{mode === "live" ? "⚠️ Real money trade." : "Paper trading — no real money."}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Symbol</label>
              <input value={orderForm.symbol} onChange={e => setOrderForm(f => ({ ...f, symbol: e.target.value.toUpperCase() }))} placeholder="AAPL" className="w-full mt-1 px-3 py-2 rounded-md bg-secondary border border-border text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Side</label>
                <div className="flex gap-1 mt-1">
                  {["buy", "sell"].map(s => (
                    <button key={s} onClick={() => setOrderForm(f => ({ ...f, side: s }))} className={`flex-1 py-1.5 rounded text-xs font-semibold transition-colors ${orderForm.side === s ? s === "buy" ? "bg-gain/15 text-gain border border-gain/30" : "bg-loss/15 text-loss border border-loss/30" : "bg-secondary text-muted-foreground border border-border"}`}>{s.toUpperCase()}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Type</label>
                <div className="flex gap-1 mt-1">
                  {["market", "limit"].map(t => (
                    <button key={t} onClick={() => setOrderForm(f => ({ ...f, type: t }))} className={`flex-1 py-1.5 rounded text-xs font-medium transition-colors ${orderForm.type === t ? "bg-primary/15 text-primary border border-primary/30" : "bg-secondary text-muted-foreground border border-border"}`}>{t.charAt(0).toUpperCase() + t.slice(1)}</button>
                  ))}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Quantity</label>
                <input value={orderForm.qty} onChange={e => setOrderForm(f => ({ ...f, qty: e.target.value }))} placeholder="10" type="number" step="any" className="w-full mt-1 px-3 py-2 rounded-md bg-secondary border border-border text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary" />
              </div>
              {orderForm.type === "limit" && (
                <div>
                  <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Limit Price</label>
                  <input value={orderForm.limit_price} onChange={e => setOrderForm(f => ({ ...f, limit_price: e.target.value }))} placeholder="150.00" type="number" step="0.01" className="w-full mt-1 px-3 py-2 rounded-md bg-secondary border border-border text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary" />
                </div>
              )}
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Order Type</label>
              <div className="flex gap-1 mt-1">
                {(["simple", "bracket"] as const).map(oc => (
                  <button key={oc} onClick={() => setOrderForm(f => ({ ...f, order_class: oc }))} className={`flex-1 py-1.5 rounded text-xs font-medium transition-colors ${orderForm.order_class === oc ? "bg-primary/15 text-primary border border-primary/30" : "bg-secondary text-muted-foreground border border-border"}`}>
                    {oc === "simple" ? "Simple" : "🔒 Bracket (TP + SL)"}
                  </button>
                ))}
              </div>
            </div>
            {orderForm.order_class === "bracket" && (
              <div className="grid grid-cols-2 gap-2 p-2.5 rounded-lg bg-secondary/30 border border-border/30">
                <div>
                  <label className="text-[10px] text-gain uppercase tracking-wider flex items-center gap-1"><Target className="w-3 h-3" />Take Profit</label>
                  <input value={orderForm.take_profit} onChange={e => setOrderForm(f => ({ ...f, take_profit: e.target.value }))} placeholder="160.00" type="number" step="0.01" className="w-full mt-1 px-3 py-2 rounded-md bg-secondary border border-gain/20 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-gain" />
                </div>
                <div>
                  <label className="text-[10px] text-loss uppercase tracking-wider flex items-center gap-1"><Crosshair className="w-3 h-3" />Stop Loss</label>
                  <input value={orderForm.stop_loss} onChange={e => setOrderForm(f => ({ ...f, stop_loss: e.target.value }))} placeholder="140.00" type="number" step="0.01" className="w-full mt-1 px-3 py-2 rounded-md bg-secondary border border-loss/20 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-loss" />
                </div>
              </div>
            )}
            {mode === "live" && (
              <div className="p-2 rounded bg-loss/10 border border-loss/20 text-[10px] text-loss flex items-start gap-1.5">
                <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" /><span>Real money trade on your live Alpaca account.</span>
              </div>
            )}
            <button onClick={placeOrder} disabled={placingOrder || !orderForm.symbol || !orderForm.qty} className={`w-full py-2.5 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 ${orderForm.side === "buy" ? "bg-gain text-gain-foreground hover:bg-gain/90" : "bg-loss text-loss-foreground hover:bg-loss/90"}`}>
              {placingOrder ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : `${orderForm.side.toUpperCase()} ${orderForm.symbol || "..."} ${orderForm.order_class === "bracket" ? "(Bracket)" : ""}`}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modify Order Dialog */}
      <Dialog open={!!modifyingOrder} onOpenChange={() => setModifyingOrder(null)}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2"><Edit3 className="w-4 h-4 text-accent" />Modify Order</DialogTitle>
            <DialogDescription className="text-xs">Update qty, limit, or stop price.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-[10px] text-muted-foreground uppercase">New Qty</label>
              <input value={modifyForm.qty} onChange={e => setModifyForm(f => ({ ...f, qty: e.target.value }))} placeholder="Leave blank to keep" type="number" className="w-full mt-1 px-3 py-2 rounded-md bg-secondary border border-border text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground uppercase">New Limit Price</label>
              <input value={modifyForm.limit_price} onChange={e => setModifyForm(f => ({ ...f, limit_price: e.target.value }))} placeholder="Leave blank to keep" type="number" step="0.01" className="w-full mt-1 px-3 py-2 rounded-md bg-secondary border border-border text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary" />
            </div>
            <button onClick={() => modifyingOrder && modifyOrder(modifyingOrder)} className="w-full py-2 rounded-lg text-sm font-semibold bg-accent/15 text-accent border border-accent/30 hover:bg-accent/25 transition-colors">Apply Changes</button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AlpacaDashboard;
