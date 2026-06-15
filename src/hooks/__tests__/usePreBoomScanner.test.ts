import { describe, expect, it } from "vitest";
import {
  detectPreBoom,
  type PreBoomScannerConfig,
  type PreBoomTickerData,
  type PriceSnapshot,
} from "@/hooks/usePreBoomScanner";

const snapshot = (price: number, volume: string, time: number): PriceSnapshot => ({
  price,
  changePct: 0,
  volume,
  high: 11,
  low: 9,
  time,
});

const current = (overrides: Partial<PreBoomTickerData> = {}): PreBoomTickerData => ({
  symbol: "TEST",
  name: "Test",
  price: "10.90",
  priceChangePercent: "4.00",
  high: "11.00",
  low: "9.00",
  volume: "45M",
  ...overrides,
});

const contextConfig: PreBoomScannerConfig = {
  requireOptionBudgetFit: true,
  contextBySymbol: {
    TEST: {
      optionBudgetFit: true,
      optionQuote: 0.35,
      contractCost: 35,
      catalystUrgency: 90,
      sourceCount: 3,
      gateStatus: "wait",
      learnedPatternScore: 85,
      learnedPattern: "catalyst continuation",
    },
  },
};

describe("detectPreBoom", () => {
  it("rejects a context-only setup without enough market evidence", () => {
    const stale = [
      snapshot(10, "500K", 1),
      snapshot(10, "500K", 2),
      snapshot(10, "500K", 3),
      snapshot(10, "500K", 4),
      snapshot(10, "500K", 5),
    ];

    expect(detectPreBoom("TEST", current({
      price: "10.00",
      priceChangePercent: "0.20",
      volume: "500K",
    }), stale, 28, contextConfig)).toBeNull();
  });

  it("detects genuine acceleration with rising volume and affordable options", () => {
    const rising = [
      snapshot(10, "5M", 1),
      snapshot(10.1, "12M", 2),
      snapshot(10.35, "30M", 3),
      snapshot(10.7, "45M", 4),
    ];

    const alert = detectPreBoom("TEST", current(), rising, 46, contextConfig);

    expect(alert).not.toBeNull();
    expect(alert?.reasons).toContain("Volume accelerating across ticks");
    expect(alert?.reasons.some((reason) => reason.startsWith("Price accelerating"))).toBe(true);
    expect(alert?.optionBudgetFit).toBe(true);
  });

  it("rejects a setup that fails the required option budget filter", () => {
    const config: PreBoomScannerConfig = {
      requireOptionBudgetFit: true,
      contextBySymbol: { TEST: { optionBudgetFit: false, optionQuote: 12 } },
    };

    expect(detectPreBoom("TEST", current(), [
      snapshot(10, "5M", 1),
      snapshot(10.2, "12M", 2),
      snapshot(10.6, "45M", 3),
    ], 28, config)).toBeNull();
  });

  it("never surfaces a negative mover as an upward pre-boom alert", () => {
    expect(detectPreBoom("TEST", current({ priceChangePercent: "-2.00" }), [
      snapshot(10, "5M", 1),
      snapshot(10.2, "12M", 2),
      snapshot(10.6, "45M", 3),
    ], 28, contextConfig)).toBeNull();
  });
});
