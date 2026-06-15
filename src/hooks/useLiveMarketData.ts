import { useCallback, useEffect, useRef, useState } from "react";
import { loadLiveDataSnapshot, liveDataConfig, type LiveDataSnapshot } from "@/lib/liveData";

function getEasternMinutes() {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date());
    const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
    const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
    return hour * 60 + minute;
  } catch {
    return 12 * 60;
  }
}

function getMarketAwarePollMs(configuredPollMs: number) {
  const base = Math.max(10_000, configuredPollMs);
  const mins = getEasternMinutes();
  const preOpenOrOpenDrive = mins >= 8 * 60 + 30 && mins <= 10 * 60 + 30;
  const regularSession = mins >= 9 * 60 + 30 && mins <= 16 * 60;

  if (preOpenOrOpenDrive) return Math.min(base, 60_000);
  if (regularSession) return Math.min(base, 120_000);
  return base;
}

export function useLiveMarketData() {
  const [snapshot, setSnapshot] = useState<LiveDataSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const inFlightRef = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setLoading(true);
    try {
      setSnapshot(await loadLiveDataSnapshot());
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;

    const load = async () => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      setLoading(true);
      try {
        const next = await loadLiveDataSnapshot();
        if (alive) setSnapshot(next);
      } finally {
        inFlightRef.current = false;
        if (alive) setLoading(false);
      }
    };

    load();
    const interval = window.setInterval(load, getMarketAwarePollMs(liveDataConfig.pollMs));
    return () => {
      alive = false;
      window.clearInterval(interval);
    };
  }, []);

  return { snapshot, loading, refresh };
}
