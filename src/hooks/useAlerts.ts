import { useState, useCallback, useRef, useEffect } from "react";
import { toast } from "sonner";
import { TickerData } from "@/hooks/useWebullData";

export interface PriceAlert {
  id: string;
  symbol: string;
  targetPrice: number;
  direction: "above" | "below";
  triggered: boolean;
  createdAt: number;
  triggeredAt?: number;
}

export interface PnlAlert {
  id: string;
  type: "profit" | "loss";
  thresholdPct: number;
  triggered: boolean;
  createdAt: number;
}

export interface SignalAlert {
  id: string;
  symbol: string;
  signalType: "buy" | "sell" | "strong_buy" | "strong_sell" | "any";
  minConfidence: number;
  triggered: boolean;
  createdAt: number;
}

export type Alert = 
  | (PriceAlert & { alertType: "price" })
  | (PnlAlert & { alertType: "pnl" })
  | (SignalAlert & { alertType: "signal" });

export interface AlertNotification {
  id: string;
  message: string;
  type: "price" | "pnl" | "signal";
  severity: "info" | "warning" | "success" | "error";
  timestamp: number;
  read: boolean;
}

export function useAlerts(
  tickers: Record<string, TickerData>,
  portfolioPnlPct: number,
) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [notifications, setNotifications] = useState<AlertNotification[]>([]);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const audioRef = useRef<AudioContext | null>(null);

  const playAlertSound = useCallback((freq: number = 880, duration: number = 150) => {
    if (!soundEnabled) return;
    try {
      if (!audioRef.current) audioRef.current = new AudioContext();
      const ctx = audioRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = "sine";
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration / 1000);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + duration / 1000);
    } catch {}
  }, [soundEnabled]);

  const addNotification = useCallback((message: string, type: Alert["alertType"], severity: AlertNotification["severity"]) => {
    const notif: AlertNotification = {
      id: crypto.randomUUID(),
      message,
      type,
      severity,
      timestamp: Date.now(),
      read: false,
    };
    setNotifications(prev => [notif, ...prev].slice(0, 50));
    
    if (severity === "success") {
      toast.success(message);
      playAlertSound(1200, 200);
    } else if (severity === "error") {
      toast.error(message);
      playAlertSound(400, 300);
    } else if (severity === "warning") {
      toast.warning(message);
      playAlertSound(600, 200);
    } else {
      toast.info(message);
      playAlertSound(880, 150);
    }
  }, [playAlertSound]);

  // Check price alerts
  useEffect(() => {
    setAlerts(prev => prev.map(alert => {
      if (alert.triggered || alert.alertType !== "price") return alert;
      const ticker = tickers[alert.symbol];
      if (!ticker) return alert;
      const price = parseFloat(ticker.price);
      if (price <= 0) return alert;

      const hit = alert.direction === "above" ? price >= alert.targetPrice : price <= alert.targetPrice;
      if (hit) {
        addNotification(
          `${alert.symbol} hit $${alert.targetPrice.toFixed(2)} (now $${price.toFixed(2)})`,
          "price",
          alert.direction === "above" ? "success" : "warning"
        );
        return { ...alert, triggered: true, triggeredAt: Date.now() };
      }
      return alert;
    }));
  }, [tickers, addNotification]);

  // Check P&L alerts
  useEffect(() => {
    setAlerts(prev => prev.map(alert => {
      if (alert.triggered || alert.alertType !== "pnl") return alert;
      const hit = alert.type === "profit"
        ? portfolioPnlPct >= alert.thresholdPct
        : portfolioPnlPct <= -alert.thresholdPct;
      if (hit) {
        addNotification(
          `Portfolio ${alert.type === "profit" ? "profit" : "loss"} alert: ${portfolioPnlPct.toFixed(2)}% (threshold: ${alert.thresholdPct}%)`,
          "pnl",
          alert.type === "profit" ? "success" : "error"
        );
        return { ...alert, triggered: true };
      }
      return alert;
    }));
  }, [portfolioPnlPct, addNotification]);

  const addPriceAlert = useCallback((symbol: string, targetPrice: number, direction: "above" | "below") => {
    const alert: Alert = {
      alertType: "price",
      id: crypto.randomUUID(),
      symbol,
      targetPrice,
      direction,
      triggered: false,
      createdAt: Date.now(),
    };
    setAlerts(prev => [...prev, alert]);
    toast.info(`Alert set: ${symbol} ${direction} $${targetPrice.toFixed(2)}`);
  }, []);

  const addPnlAlert = useCallback((type: "profit" | "loss", thresholdPct: number) => {
    const alert: Alert = {
      alertType: "pnl",
      id: crypto.randomUUID(),
      type,
      thresholdPct,
      triggered: false,
      createdAt: Date.now(),
    };
    setAlerts(prev => [...prev, alert]);
    toast.info(`P&L alert set: ${type} at ${thresholdPct}%`);
  }, []);

  const addSignalAlert = useCallback((symbol: string, signalType: SignalAlert["signalType"], minConfidence: number) => {
    const alert: Alert = {
      alertType: "signal",
      id: crypto.randomUUID(),
      symbol,
      signalType,
      minConfidence,
      triggered: false,
      createdAt: Date.now(),
    };
    setAlerts(prev => [...prev, alert]);
    toast.info(`Signal alert set: ${signalType} on ${symbol} ≥${minConfidence}%`);
  }, []);

  const triggerSignalAlert = useCallback((symbol: string, signal: string, confidence: number) => {
    setAlerts(prev => prev.map(alert => {
      if (alert.triggered || alert.alertType !== "signal") return alert;
      if (alert.symbol !== symbol && alert.symbol !== "ALL") return alert;
      if (confidence < alert.minConfidence) return alert;
      const matchesType = alert.signalType === "any" || alert.signalType === signal || 
        (alert.signalType === "buy" && (signal === "buy" || signal === "strong_buy")) ||
        (alert.signalType === "sell" && (signal === "sell" || signal === "strong_sell"));
      if (!matchesType) return alert;

      addNotification(
        `Signal alert: ${signal.toUpperCase()} on ${symbol} (${confidence}% confidence)`,
        "signal",
        signal.includes("buy") ? "success" : "error"
      );
      return { ...alert, triggered: true };
    }));
  }, [addNotification]);

  const removeAlert = useCallback((id: string) => {
    setAlerts(prev => prev.filter(a => a.id !== id));
  }, []);

  const clearNotifications = useCallback(() => {
    setNotifications([]);
  }, []);

  const markRead = useCallback((id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  }, []);

  const unreadCount = notifications.filter(n => !n.read).length;

  return {
    alerts, notifications, unreadCount, soundEnabled,
    setSoundEnabled,
    addPriceAlert, addPnlAlert, addSignalAlert, triggerSignalAlert,
    removeAlert, clearNotifications, markRead,
  };
}
