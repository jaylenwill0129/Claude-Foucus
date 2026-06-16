import { describe, expect, it } from "vitest";
import { normalizeCreativePackage, type CreativePackage } from "../../../supabase/functions/_shared/creativeSchema";

describe("normalizeCreativePackage", () => {
  it("supplies safe defaults for an empty object", () => {
    const p = normalizeCreativePackage({});
    expect(p.title).toBe("Untitled release");
    expect(p.trendCluster.reachToEffort).toBe("medium");
    expect(p.track.bpm).toBe(0);
    expect(p.hashtags).toEqual([]);
  });

  it("clamps BPM and duration into range", () => {
    const p = normalizeCreativePackage({ track: { genre: "x", bpm: 9999, mood: "y", structure: "z", durationSec: -50 } } as Partial<CreativePackage>);
    expect(p.track.bpm).toBe(300);
    expect(p.track.durationSec).toBe(0);
  });

  it("validates reachToEffort against the allowed set", () => {
    expect(normalizeCreativePackage({ trendCluster: { tags: [], rationale: "", reachToEffort: "high" } } as Partial<CreativePackage>).trendCluster.reachToEffort).toBe("high");
    expect(normalizeCreativePackage({ trendCluster: { tags: [], rationale: "", reachToEffort: "ludicrous" } } as Partial<CreativePackage>).trendCluster.reachToEffort).toBe("medium");
  });

  it("caps tags at 12 and hashtags at 15", () => {
    const tags = Array.from({ length: 30 }, (_, i) => `#t${i}`);
    const hashtags = Array.from({ length: 30 }, (_, i) => `#h${i}`);
    const p = normalizeCreativePackage({ trendCluster: { tags, rationale: "", reachToEffort: "low" }, hashtags } as Partial<CreativePackage>);
    expect(p.trendCluster.tags).toHaveLength(12);
    expect(p.hashtags).toHaveLength(15);
  });

  it("truncates overlong free-text fields", () => {
    const p = normalizeCreativePackage({ caption: "x".repeat(1000), reasoning: "y".repeat(1000) } as Partial<CreativePackage>);
    expect(p.caption.length).toBe(400);
    expect(p.reasoning.length).toBe(600);
  });

  it("coerces non-string scalar fields to strings", () => {
    const p = normalizeCreativePackage({ title: 123 as never } as Partial<CreativePackage>);
    expect(typeof p.title).toBe("string");
    expect(p.title).toBe("123");
  });
});
