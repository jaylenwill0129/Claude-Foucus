import { describe, it, expect } from "vitest";
import { detectRegime } from "@/lib/regimeDetection";

const mkKlines = (closes: number[]) =>
  closes.map((c, i) => ({
    open: closes[i - 1] ?? c,
    high: c * 1.005,
    low: c * 0.995,
    close: c,
  }));

describe("detectRegime", () => {
  it("returns neutral on insufficient data", () => {
    expect(detectRegime([]).regime).toBe("neutral");
    expect(detectRegime(mkKlines([100, 101])).regime).toBe("neutral");
  });

  it("detects an uptrend", () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + i * 0.5);
    const r = detectRegime(mkKlines(closes));
    expect(r.regime).toBe("trending_up");
    expect(r.trendStrength).toBeGreaterThan(0);
  });

  it("detects a downtrend", () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 - i * 0.5);
    const r = detectRegime(mkKlines(closes));
    expect(r.regime).toBe("trending_down");
    expect(r.trendStrength).toBeLessThan(0);
  });

  it("flags high volatility", () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + (i % 2 === 0 ? 8 : -8));
    const r = detectRegime(mkKlines(closes));
    expect(r.regime).toBe("high_volatility");
    expect(r.volatilityPct).toBeGreaterThan(4);
  });

  it("flags low volatility / choppy when range is tight", () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + (i % 2 === 0 ? 0.05 : -0.05));
    const r = detectRegime(mkKlines(closes));
    expect(["low_volatility", "choppy", "neutral"]).toContain(r.regime);
  });
});