import { useRef, useEffect, useCallback } from "react";
import { toast } from "sonner";

interface SignalAlertConfig {
  confidenceThreshold: number;
  enableAudio: boolean;
  enableNotifications: boolean;
  autoClipboard: boolean;
  autoDismissSeconds: number;
}

interface SignalData {
  signal: string;
  confidence: number;
  symbol: string;
  side: string;
  entryPrice: number;
  tp: number;
  sl: number;
  qty: number;
  urgency: string;
  grade: string;
}

const ALERT_CONFIG_KEY = "neuraltrade_alert_config";

function loadConfig(): SignalAlertConfig {
  try {
    const raw = localStorage.getItem(ALERT_CONFIG_KEY);
    if (raw) return { ...defaultConfig, ...JSON.parse(raw) };
  } catch {}
  return defaultConfig;
}

const defaultConfig: SignalAlertConfig = {
  confidenceThreshold: 65,
  enableAudio: true,
  enableNotifications: true,
  autoClipboard: true,
  autoDismissSeconds: 90,
};

// Generate alert sound using Web Audio API (no external files needed)
function playAlertSound(type: "buy" | "sell" | "urgent") {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === "urgent") {
      // Rapid double beep for urgent signals
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.1);

      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.frequency.setValueAtTime(1100, ctx.currentTime + 0.15);
      gain2.gain.setValueAtTime(0.3, ctx.currentTime + 0.15);
      gain2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
      osc2.start(ctx.currentTime + 0.15);
      osc2.stop(ctx.currentTime + 0.3);
    } else {
      const freq = type === "buy" ? 660 : 440;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.2);
    }

    setTimeout(() => ctx.close(), 1000);
  } catch {}
}

function sendBrowserNotification(signal: SignalData) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    const side = signal.side.toUpperCase();
    new Notification(`⚡ ${signal.symbol} ${side} Signal`, {
      body: `${signal.grade} ${signal.confidence}% | Entry $${signal.entryPrice.toFixed(2)} | TP $${signal.tp.toFixed(2)} | SL $${signal.sl.toFixed(2)}`,
      icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⚡</text></svg>",
      tag: `signal-${signal.symbol}`,
      requireInteraction: signal.urgency === "NOW",
    });
  } catch {}
}

function autoClipboardCopy(signal: SignalData) {
  const text = `Limit ${signal.side.toUpperCase()} ${signal.qty} ${signal.symbol} @ $${signal.entryPrice.toFixed(2)}, SL $${signal.sl.toFixed(2)}, TP $${signal.tp.toFixed(2)}`;
  navigator.clipboard.writeText(text).then(() => {
    toast.success("📋 Order auto-copied to clipboard!", { duration: 2000 });
  }).catch(() => {});
}

export function useSignalAlerts() {
  const configRef = useRef(loadConfig());
  const lastAlertedRef = useRef<string>("");
  const lastAlertTimeRef = useRef(0);

  // Request notification permission on mount
  useEffect(() => {
    if (configRef.current.enableNotifications && typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  const fireAlert = useCallback((signal: SignalData) => {
    const config = configRef.current;
    
    // Skip if below threshold
    if (signal.confidence < config.confidenceThreshold) return;
    if (signal.signal === "neutral") return;

    // Deduplicate: don't re-alert same signal within 30s
    const key = `${signal.symbol}-${signal.signal}-${signal.confidence}`;
    if (key === lastAlertedRef.current && Date.now() - lastAlertTimeRef.current < 30_000) return;
    lastAlertedRef.current = key;
    lastAlertTimeRef.current = Date.now();

    const isBuy = signal.signal.includes("buy");
    const isUrgent = signal.urgency === "NOW" || signal.confidence >= 80;

    // 1. Audio alert
    if (config.enableAudio) {
      playAlertSound(isUrgent ? "urgent" : isBuy ? "buy" : "sell");
    }

    // 2. Browser notification
    if (config.enableNotifications) {
      sendBrowserNotification(signal);
    }

    // 3. Auto-clipboard
    if (config.autoClipboard) {
      autoClipboardCopy(signal);
    }
  }, []);

  const updateConfig = useCallback((updates: Partial<SignalAlertConfig>) => {
    configRef.current = { ...configRef.current, ...updates };
    try { localStorage.setItem(ALERT_CONFIG_KEY, JSON.stringify(configRef.current)); } catch {}
  }, []);

  const getConfig = useCallback(() => configRef.current, []);

  // Request notification permission
  const requestPermission = useCallback(async () => {
    if (typeof window !== "undefined" && "Notification" in window) {
      const perm = await Notification.requestPermission();
      return perm === "granted";
    }
    return false;
  }, []);

  return { fireAlert, updateConfig, getConfig, requestPermission };
}

// Signal freshness utilities
export function getSignalFreshness(ageSeconds: number): {
  label: string;
  color: string;
  isFresh: boolean;
  isStale: boolean;
  pctRemaining: number;
} {
  const maxAge = 90; // seconds
  const pctRemaining = Math.max(0, (1 - ageSeconds / maxAge) * 100);

  if (ageSeconds < 15) return { label: `${ageSeconds}s`, color: "text-gain", isFresh: true, isStale: false, pctRemaining };
  if (ageSeconds < 30) return { label: `${ageSeconds}s`, color: "text-gain/70", isFresh: true, isStale: false, pctRemaining };
  if (ageSeconds < 45) return { label: `${ageSeconds}s`, color: "text-warning", isFresh: false, isStale: false, pctRemaining };
  if (ageSeconds < 90) return { label: `${ageSeconds}s`, color: "text-loss", isFresh: false, isStale: false, pctRemaining };
  return { label: "STALE", color: "text-loss animate-pulse", isFresh: false, isStale: true, pctRemaining: 0 };
}
