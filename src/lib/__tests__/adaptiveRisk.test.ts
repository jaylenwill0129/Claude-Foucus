import { describe, it, expect } from "vitest";
import { computeAdaptiveRisk } from "@/lib/adaptiveRisk";

const base = {
  stopLossPct: 2,
  takeProfitPct: 5,
  positionSizePct: 5,
  requireMinRR: 2,
  confidenceThreshold: 70,
  trailingStopPct: 1,
};

describe("computeAdaptiveRisk", () => {
  it("produces a profile with a tier and non-empty reasons", () => {
    const p = computeAdaptiveRisk(
      { symbol: "AAPL", price: 175, changePct: 0.4, high: 178, low: 174, volume: 50_000_000, sector: "tech" },
      base,
    );
    expect(p.tier).toBeDefined();
    expect(p.reasons.length).toBeGreaterThan(0);
    expect(p.stopLossPct).toBeGreaterThan(0);
    expect(p.takeProfitPct).toBeGreaterThan(0);
  });

  it("treats penny stocks more cautiously than mega caps", () => {
    const penny = computeAdaptiveRisk(
      { symbol: "XYZ", price: 1.5, changePct: 8, high: 1.8, low: 1.3, volume: 10_000_000 },
      base,
    );
    const mega = computeAdaptiveRisk(
      { symbol: "MSFT", price: 410, changePct: 0.2, high: 412, low: 408, volume: 30_000_000, sector: "tech" },
      base,
    );
    expect(penny.positionSizePct).toBeLessThan(mega.positionSizePct);
  });

  it("widens stops in high volatility regime", () => {
    const quiet = computeAdaptiveRisk(
      { symbol: "AAPL", price: 175, changePct: 0.3, high: 176, low: 174, volume: 10_000_000, regime: "low_volatility" },
      base,
    );
    const wild = computeAdaptiveRisk(
      { symbol: "AAPL", price: 175, changePct: 6, high: 185, low: 165, volume: 80_000_000, regime: "high_volatility" },
      base,
    );
    expect(wild.stopLossPct).toBeGreaterThanOrEqual(quiet.stopLossPct);
  });
});