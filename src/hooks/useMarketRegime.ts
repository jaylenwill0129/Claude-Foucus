import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type Regime = "TREND_UP" | "TREND_DOWN" | "CHOP" | "HIGH_VOL";

export interface MarketRegime {
  regime: Regime;
  size_multiplier: number;
  min_grade: "A" | "B" | "C" | "D" | "F";
  long_bias: number;
  short_bias: number;
  vix: number | null;
  adx: number | null;
  updated_at: string;
}

const GRADE_RANK: Record<string, number> = { A: 4, B: 3, C: 2, D: 1, F: 0 };

export function useMarketRegime() {
  return useQuery({
    queryKey: ["market-regime"],
    queryFn: async (): Promise<MarketRegime | null> => {
      const { data, error } = await supabase
        .from("market_regime_cache")
        .select("regime, size_multiplier, min_grade, long_bias, short_bias, vix, adx, updated_at")
        .eq("id", "global")
        .maybeSingle();
      if (error) throw error;
      return data as MarketRegime | null;
    },
    refetchInterval: 5 * 60 * 1000,
    staleTime: 60 * 1000,
  });
}

/** Apply regime to a planned position size + direction. Returns { sizeMult, allowed, reason }. */
export function applyRegimeGate(
  regime: MarketRegime | null | undefined,
  side: "buy" | "sell",
  signalGrade: string | null | undefined,
  strategyName?: string,
): { sizeMult: number; allowed: boolean; reason?: string } {
  if (!regime) return { sizeMult: 1, allowed: true };
  const minOk = (GRADE_RANK[signalGrade ?? "F"] ?? 0) >= (GRADE_RANK[regime.min_grade] ?? 0);
  if (!minOk) return { sizeMult: 0, allowed: false, reason: `grade<${regime.min_grade}` };
  if (regime.regime === "HIGH_VOL" && /mean.?revers/i.test(strategyName ?? "")) {
    return { sizeMult: 0, allowed: false, reason: "high_vol_no_mean_reversion" };
  }
  const biasMult = side === "buy" ? regime.long_bias : regime.short_bias;
  return { sizeMult: regime.size_multiplier * biasMult, allowed: true };
}