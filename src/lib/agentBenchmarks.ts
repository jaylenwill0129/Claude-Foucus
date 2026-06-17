// Display mirror of supabase/functions/_shared/benchmarks.ts — what each agent
// emulates (top-performer patterns) and the metrics it tries to beat. Shown in
// the world so the operator can see the bar each agent is held to.

export type AgentBenchmark = { field: string; top: string[]; beat: string };

export const agentBenchmarks: Record<string, AgentBenchmark> = {
  sales: {
    field: "B2B outreach / SDR",
    top: [
      "Lead with a specific buying signal — signal-based personalization hits 15-25% reply vs the 3.4% average.",
      "Always send a follow-up (≈42% of replies); never blast — keep segments ≤50.",
      "Coordinate email + LinkedIn + phone; one clear ask; custom subject line.",
    ],
    beat: "Reply ≥8%, 100% of threads followed up, every draft cites one signal",
  },
  creative: {
    field: "Short-form / TikTok",
    top: [
      "Win the first 1-3s with a pattern-interrupt hook (biggest reach driver).",
      "Ride native trending audio early; post 3-5x/week; test hook variants.",
      "Optimize saves/shares/watch-time over raw views.",
    ],
    beat: "3s hook retention, ≥3 posts/week, save+share rate over views",
  },
  product: {
    field: "Digital products",
    top: [
      "Solve ONE painful niche problem; outcome titles + proof, not features.",
      "Value-ladder pricing (tripwire + bump + upsell); capture email every visit.",
      "Iterate fast on what converts; reinvest in winners.",
    ],
    beat: "Landing conversion north star, refund <5%, repeat/LTV growth",
  },
  commerce: {
    field: "Dropshipping / ecommerce",
    top: [
      "Test 3-5 products/week; cut losers, scale winners (UGC creative-led).",
      "Private label + custom packaging + unboxing; fast US/EU fulfillment.",
      "Scale only when SKU-level CAC < LTV with margin after fees.",
    ],
    beat: "Net margin after CAC+fees, refund <6%, fulfillment ≤3 days",
  },
};

export const benchmarkFor = (placeId: string): AgentBenchmark | undefined => agentBenchmarks[placeId];
