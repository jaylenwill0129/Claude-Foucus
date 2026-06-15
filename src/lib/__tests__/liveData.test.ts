import { describe, expect, it } from "vitest";
import { rankedPlans, type CatalystEvent } from "@/lib/derivativesEngine";
import { assessCatalystCredibility, buildDirectOptionBatch, buildOptionDiscoveryUniverse, mergeQuotesIntoPlans, type LiveQuote } from "@/lib/liveData";

function catalyst(overrides: Partial<CatalystEvent>): CatalystEvent {
  return {
    symbol: "TEST",
    type: "macro",
    headline: "Market update",
    detectedAt: new Date().toISOString(),
    movePct: 0,
    stockPrice: 10,
    urgencyScore: 80,
    chaseRisk: "low",
    sources: ["Benzinga"],
    contractSignal: "Watch",
    action: "Wait",
    ...overrides,
  };
}

describe("live-only option discovery", () => {
  it("scans a substantially wider option universe", () => {
    expect(buildOptionDiscoveryUniverse([]).length).toBeGreaterThan(36);
  });

  it("keeps each direct provider refresh bounded while rotating through the wider universe", () => {
    const universe = buildOptionDiscoveryUniverse([]);
    const first = buildDirectOptionBatch(universe);
    const second = buildDirectOptionBatch(universe);

    expect(first.length).toBeLessThanOrEqual(36);
    expect(second.length).toBeLessThanOrEqual(36);
    expect(new Set([...first, ...second]).size).toBeGreaterThan(first.length);
  });

  it("returns no plans when no live quotes are available", () => {
    expect(mergeQuotesIntoPlans([], [])).toEqual([]);
  });

  it("demotes generic headlines and rewards fresh corroborated market evidence", () => {
    const weak = assessCatalystCredibility(catalyst({ headline: "How much $1000 invested 15 years ago would be worth today" }));
    const strong = assessCatalystCredibility(catalyst({
      type: "regulatory",
      headline: "FDA approval confirmed after trial results",
      movePct: 12,
      optionVolume: 8000,
      sources: ["Reuters", "Benzinga"],
      corroborationScore: 2,
    }));

    expect(weak.credibilityScore).toBeLessThan(45);
    expect(strong.credibilityScore).toBeGreaterThan(weak.credibilityScore);
  });

  it("returns only plans backed by a valid live quote", () => {
    const plan = rankedPlans[0];
    const root = plan.symbol.split(" ")[0];
    const quote: LiveQuote = {
      symbol: root,
      underlyingSymbol: root,
      assetClass: plan.assetClass,
      price: 2.25,
      changePct: 4.5,
      source: "polygon",
      updatedAt: new Date().toISOString(),
    };

    const merged = mergeQuotesIntoPlans(plan.assetClass === "future" ? [] : [quote], plan.assetClass === "future" ? [quote] : []);
    expect(merged).toHaveLength(1);
    expect(merged[0].price).toBe(2.25);
  });
});
