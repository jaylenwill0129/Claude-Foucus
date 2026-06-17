// Top-performer benchmarks per agent domain. These encode what the BEST operators
// in each field actually do, plus the concrete metric to beat, so every agent
// reasons from proven best-in-class patterns instead of generic instinct — then
// is told to replicate-and-improve and to share what worked back to the team.
//
// Imported by the agent-orchestrator (injected into the system prompt) and the
// frontend display (src/lib/agentBenchmarks.ts mirrors this for the UI).

export type Benchmark = {
  agentKey: string;
  field: string;
  // What the top performers do (proven patterns worth replicating).
  topPerformers: string[];
  // Hard targets to beat — the numbers separating the best from average.
  beat: string[];
};

export const BENCHMARKS: Record<string, Benchmark> = {
  sales: {
    agentKey: "sales",
    field: "B2B outreach / SDR",
    topPerformers: [
      "Lead with a specific buying signal (hiring surge, funding, leadership change, new location, slow online booking) — signal-based personalization hits 15-25% reply vs the 3.4% average.",
      "Always send at least one follow-up: follow-ups drive ~42% of all replies, yet ~48% of reps never send a second message.",
      "Keep each segment small and tight (<=50 recipients) — small targeted lists reply ~5.8% vs ~2.1% for big blasts.",
      "Coordinate channels (email + LinkedIn + phone) — omnichannel can lift results ~287%.",
      "One clear ask, short message, custom subject line (lifts opens ~50%).",
    ],
    beat: ["Reply rate >= 8% (beat the 3.4% average)", "100% of threads get a follow-up", "Every draft cites one concrete prospect signal", "Segment size <= 50"],
  },
  creative: {
    agentKey: "creative",
    field: "Short-form / TikTok creative",
    topPerformers: [
      "Win the first 1-3 seconds with a pattern-interrupt hook — retention in the first 3s is the single biggest driver of reach.",
      "Ride native trending audio and formats early, before saturation.",
      "Post consistently (3-5x/week) and test multiple hook variants per concept.",
      "Optimize for saves/shares/watch-time, not raw views; reply fast to early comments to feed the algorithm.",
    ],
    beat: ["3s hook retention as the primary KPI", ">= 3 posts/week", "Save+share rate over view count", "Test >= 3 hook variants per concept"],
  },
  product: {
    agentKey: "product",
    field: "Digital products",
    topPerformers: [
      "Solve ONE painful, specific niche problem — narrow beats broad.",
      "Outcome-based titles + proof (testimonials, before/after), not feature lists.",
      "Value-ladder pricing: tripwire offer + order bump + upsell; capture email on every visit.",
      "Iterate fast on what converts; kill what doesn't; reinvest in the winners.",
    ],
    beat: ["Landing-page conversion as the north star", "Refund rate < 5%", "Repeat-purchase / LTV growth", "Email captured on >= 1 of every 3 visits"],
  },
  commerce: {
    agentKey: "commerce",
    field: "Dropshipping / ecommerce",
    topPerformers: [
      "Test 3-5 products/week; cut losers fast, scale winners hard (creative-led, UGC hooks).",
      "Brand it: private label + custom packaging + unboxing — commands premium and repeat.",
      "Fast US/EU fulfillment (<=3-5 days); honor TikTok Shop's ~3-day US rule.",
      "Decide on SKU-level unit economics: only scale when CAC < LTV with margin after fees.",
    ],
    beat: ["Net margin positive after CAC + fees", "Refund rate < 6%", "Fulfillment <= 3 days where required", "Winner:loser test ratio improving weekly"],
  },
  research: {
    agentKey: "research",
    field: "Prospect research / ICP",
    topPerformers: [
      "Precision ICP: tight firmographics + a documented, expensive, measurable problem per prospect.",
      "Prioritize trigger/intent signals (recent hiring, reviews, tech changes) so outreach lands at the right moment.",
      "Enrich, verify, and dedupe before handoff; broadcast a crisp, structured digest the whole team can act on.",
    ],
    beat: ["100% of prospects carry a documented trigger/problem", "Zero duplicates", "Contact-data accuracy verified before handoff"],
  },
  finance: {
    agentKey: "finance",
    field: "Revenue / finance ops",
    topPerformers: [
      "Count only receipt-backed revenue; reconcile every dollar to a provider receipt.",
      "Watch margin, fees, and cash-conversion — flag fee leakage and refunds early.",
      "Surface what's available to withdraw and keep the operator's books honest.",
    ],
    beat: ["100% revenue receipt-backed", "Fee leakage flagged", "Zero unverified revenue counted"],
  },
  delivery: {
    agentKey: "delivery",
    field: "Fulfillment / delivery",
    topPerformers: [
      "Hit the SLA every time; QC before anything ships or is marked delivered.",
      "Store fulfillment evidence (receipts, files) so every delivery is provable.",
      "Protect margin — flag work that costs more to deliver than it earns.",
    ],
    beat: ["On-time delivery rate", "QC pass before delivery", "Every delivery has stored evidence"],
  },
};

const DIRECTIVE =
  "Study these top-performer patterns AND the collective team knowledge below. Replicate what the best do, then improve on it for this specific task. State which pattern you are applying and the metric you intend to beat. Prefer proven patterns over guesses.";

// Render the benchmark for an agent as compact prompt context.
export function benchmarkPrompt(agentKey: string): string {
  const b = BENCHMARKS[agentKey];
  if (!b) return "";
  return [
    `\n\nTOP-PERFORMER BENCHMARKS (${b.field}) — emulate, then beat:`,
    ...b.topPerformers.map((t) => `  - ${t}`),
    `METRICS TO BEAT: ${b.beat.join("; ")}.`,
    DIRECTIVE,
  ].join("\n");
}
