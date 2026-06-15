/**
 * Round-trip trading cost model (fees + half-spread, both sides).
 * Used as a guardrail so we never time-exit on edge smaller than cost.
 * All outputs are in PERCENT (e.g. 0.12 = 0.12%).
 */

export type AssetClass = "us_equity" | "crypto" | "etf";

export function classifyAsset(symbol: string): AssetClass {
  const s = symbol.toUpperCase();
  if (s.endsWith("USD") || s.endsWith("USDT") || s.endsWith("USDC")) return "crypto";
  return "us_equity";
}

/** Per-side base fee in bps (1 bp = 0.01%). Alpaca equities = 0, crypto ~25bps. */
const BASE_FEE_BPS: Record<AssetClass, number> = {
  us_equity: 0,
  etf: 0,
  crypto: 25,
};

/** Conservative half-spread estimate per side, bps. */
function halfSpreadBps(asset: AssetClass, price: number, volatilityPct: number): number {
  // Higher vol → wider spread. Penny stocks → wider relative spread.
  const volBump = Math.min(50, Math.max(0, volatilityPct - 1) * 8); // 1% → 0, 5% → 32 bps
  if (asset === "crypto") return 10 + volBump;
  if (price < 5) return 25 + volBump;
  if (price < 20) return 8 + volBump;
  return 3 + volBump;
}

/** Full round-trip cost in PERCENT. */
export function roundTripCostPct(args: {
  symbol: string;
  price: number;
  volatilityPct?: number;
}): number {
  const asset = classifyAsset(args.symbol);
  const vol = Math.abs(args.volatilityPct || 0);
  const fee = BASE_FEE_BPS[asset] * 2;            // both sides
  const spread = halfSpreadBps(asset, args.price, vol) * 2;
  return (fee + spread) / 100;                    // bps → %
}

/** Minimum |move| we'd take a time-exit on, given costs. */
export function minTimeExitEdgePct(args: {
  symbol: string;
  price: number;
  volatilityPct?: number;
}): number {
  return Math.max(0.15, 2 * roundTripCostPct(args));
}