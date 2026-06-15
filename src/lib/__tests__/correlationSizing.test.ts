import { describe, it, expect } from "vitest";
import { computeCorrelationAdjustedSize, getSector } from "@/lib/correlationSizing";

describe("correlationSizing", () => {
  it("maps known symbols to a sector", () => {
    expect(getSector("AAPL")).toBe("tech");
    expect(getSector("JPM")).toBe("finance");
    expect(getSector("BTCUSD")).toBe("crypto");
    expect(getSector("UNKNOWN")).toBeUndefined();
  });

  it("returns base size when no open positions", () => {
    const r = computeCorrelationAdjustedSize({
      candidateSymbol: "AAPL", baseSizePct: 5, equity: 100_000, openPositions: [],
    });
    expect(r.adjustedSizePct).toBe(5);
    expect(r.blocked).toBe(false);
  });

  it("tapers size when sector is heavy", () => {
    const r = computeCorrelationAdjustedSize({
      candidateSymbol: "AAPL", baseSizePct: 10, equity: 100_000,
      openPositions: [
        { symbol: "NVDA", notional: 12_000 },
        { symbol: "MSFT", notional: 12_000 },
      ],
    });
    expect(r.adjustedSizePct).toBeLessThan(10);
    expect(r.multiplier).toBeLessThan(1);
  });

  it("blocks when sector cap reached", () => {
    const r = computeCorrelationAdjustedSize({
      candidateSymbol: "AAPL", baseSizePct: 5, equity: 100_000,
      openPositions: [{ symbol: "NVDA", notional: 35_000 }],
    });
    expect(r.blocked).toBe(true);
    expect(r.adjustedSizePct).toBe(0);
  });

  it("blocks when single-name cap reached", () => {
    const r = computeCorrelationAdjustedSize({
      candidateSymbol: "AAPL", baseSizePct: 5, equity: 100_000,
      openPositions: [{ symbol: "AAPL", notional: 16_000 }],
    });
    expect(r.blocked).toBe(true);
  });
});