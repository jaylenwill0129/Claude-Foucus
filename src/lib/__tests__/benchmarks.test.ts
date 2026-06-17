import { describe, expect, it } from "vitest";
import { benchmarkPrompt, benchmarkSignals, BENCHMARKS } from "../../../supabase/functions/_shared/benchmarks";
import { scoreKnowledgeUsage } from "../../../supabase/functions/_shared/knowledgeEval";

describe("benchmarkPrompt", () => {
  it("renders the field, patterns, and metrics-to-beat for a known agent", () => {
    const p = benchmarkPrompt("sales");
    expect(p).toContain("TOP-PERFORMER BENCHMARKS");
    expect(p).toContain("B2B outreach");
    expect(p).toContain("METRICS TO BEAT");
    expect(p.toLowerCase()).toContain("replicate"); // the emulate-then-beat directive
  });

  it("returns empty for an agent without a benchmark", () => {
    expect(benchmarkPrompt("unknown")).toBe("");
  });

  it("covers every benchmarked agent with patterns + a beat target", () => {
    for (const [key, b] of Object.entries(BENCHMARKS)) {
      expect(b.topPerformers.length, key).toBeGreaterThan(0);
      expect(b.beat.length, key).toBeGreaterThan(0);
      expect(benchmarkSignals(key).length, key).toBeGreaterThan(0);
    }
  });
});

describe("benchmark proficiency scoring", () => {
  it("flags a sales draft that applies the benchmark", () => {
    const applied = "I opened on their hiring signal, made one ask, and queued a follow-up — aiming to beat the 3.4% reply baseline.";
    expect(scoreKnowledgeUsage(applied, benchmarkSignals("sales")).used).toBe(true);
  });

  it("marks a generic draft that ignores the benchmark as unproficient", () => {
    const generic = "Hi, we offer great software solutions for your business. Let me know if interested.";
    expect(scoreKnowledgeUsage(generic, benchmarkSignals("sales")).used).toBe(false);
  });
});
