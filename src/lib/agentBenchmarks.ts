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
  research: {
    field: "Prospect research / ICP",
    top: [
      "Precision ICP + a documented, expensive, measurable problem per prospect.",
      "Prioritize trigger/intent signals so outreach lands at the right moment.",
      "Enrich, verify, dedupe; broadcast a crisp digest the team can act on.",
    ],
    beat: "100% prospects carry a documented trigger; zero duplicates; verified data",
  },
  finance: {
    field: "Revenue / finance ops",
    top: [
      "Count only receipt-backed revenue; reconcile every dollar to a receipt.",
      "Watch margin, fees, cash-conversion; flag fee leakage and refunds early.",
      "Surface what's available to withdraw; keep the books honest.",
    ],
    beat: "100% revenue receipt-backed; fee leakage flagged; zero unverified revenue",
  },
  delivery: {
    field: "Fulfillment / delivery",
    top: [
      "Hit the SLA every time; QC before anything ships or is marked delivered.",
      "Store fulfillment evidence so every delivery is provable.",
      "Protect margin; flag work that costs more to deliver than it earns.",
    ],
    beat: "On-time delivery; QC pass before delivery; every delivery has evidence",
  },
};

export const benchmarkFor = (placeId: string): AgentBenchmark | undefined => agentBenchmarks[placeId];
