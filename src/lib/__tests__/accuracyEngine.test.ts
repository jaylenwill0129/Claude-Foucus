import { describe, expect, it } from "vitest";
import { calibrationSummary, falsePositivePenalty, sourceTrustScore, verifyLiveOptionChain } from "@/lib/accuracyEngine";
import type { CatalystEvent } from "@/lib/derivativesEngine";
import type { LiveQuote } from "@/lib/liveData";

const quote = (overrides: Partial<LiveQuote> = {}): LiveQuote => ({
  symbol: "O:TEST",
  underlyingSymbol: "TEST",
  assetClass: "option",
  price: 0.5,
  changePct: 0,
  bid: 0.48,
  ask: 0.52,
  volume: 100,
  openInterest: 500,
  expiration: "2026-07-17",
  strike: 10,
  contractType: "call",
  source: "polygon",
  updatedAt: new Date().toISOString(),
  ...overrides,
});

const record = (score: number, outcome: "hit" | "miss" | "flat", source = "Polygon News") => ({
  symbol: "TEST",
  type: "event_radar",
  source,
  outcome,
  score,
  startedAt: Date.now(),
});

describe("accuracy engine", () => {
  it("requires a complete, fresh, liquid option chain", () => {
    expect(verifyLiveOptionChain(quote(), 1500).verified).toBe(true);
    expect(verifyLiveOptionChain(quote({ bid: undefined, ask: undefined }), 1500).verified).toBe(false);
    expect(verifyLiveOptionChain(quote({ volume: 0, openInterest: 0 }), 1500).verified).toBe(false);
  });

  it("penalizes repeated symbol false positives", () => {
    expect(falsePositivePenalty("TEST", [record(70, "miss"), record(68, "miss"), record(65, "flat")])).toBeGreaterThan(0);
    expect(falsePositivePenalty("TEST", [record(70, "hit"), record(68, "hit"), record(65, "hit")])).toBe(0);
  });

  it("recognizes useful confidence separation", () => {
    const summary = calibrationSummary([
      ...Array.from({ length: 10 }, () => record(82, "hit")),
      ...Array.from({ length: 5 }, () => record(42, "miss")),
      ...Array.from({ length: 5 }, () => record(40, "flat")),
    ]);
    expect(summary.trustworthy).toBe(true);
    expect(summary.calibrationGap).toBeGreaterThanOrEqual(50);
  });

  it("raises trust for corroborated primary data sources", () => {
    const event: CatalystEvent = {
      symbol: "TEST",
      type: "product",
      headline: "Contract award",
      detectedAt: new Date().toISOString(),
      movePct: 4,
      stockPrice: 10,
      urgencyScore: 70,
      chaseRisk: "low",
      contractSignal: "watch",
      action: "confirm",
      sources: ["Polygon News", "Benzinga"],
    };
    expect(sourceTrustScore(event)).toBeGreaterThan(75);
  });
});
