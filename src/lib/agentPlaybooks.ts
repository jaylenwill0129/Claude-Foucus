// Display-side mirror of the orchestrator playbooks
// (supabase/functions/_shared/playbooks.ts). Encodes each agent's operational
// loop with a per-step autonomy policy so the world can show what runs
// automatically versus what is held for operator approval.

export type Autonomy = "autonomous" | "approval_gated";

export type LoopStep = { phase: string; action: string; autonomy: Autonomy };

export type AgentPlaybook = {
  loop: LoopStep[];
  cadence: string;
  guardrails: string[];
};

export const agentPlaybooks: Record<string, AgentPlaybook> = {
  hermes: {
    loop: [
      { phase: "Probe", action: "Read the live control plane: connectors, jobs, approvals, revenue.", autonomy: "autonomous" },
      { phase: "Reason", action: "Compare to prior briefs in memory; name the highest-leverage bottleneck.", autonomy: "autonomous" },
      { phase: "Route", action: "Issue per-agent directives toward the next dollar of verified revenue.", autonomy: "autonomous" },
      { phase: "Act", action: "Hermes never sends, publishes, spends, or changes security. It recommends only.", autonomy: "approval_gated" },
    ],
    cadence: "Continuously, on every refresh and Autopilot cycle.",
    guardrails: ["Reasons only over real probed state.", "Recommends and routes; never executes side effects."],
  },
  creative: {
    loop: [
      { phase: "Trend analysis", action: "Scan TikTok Discover for trending sounds/hashtags; pick the best reach-to-effort cluster.", autonomy: "autonomous" },
      { phase: "Music generation", action: "Generate a track aligned to the trend cluster.", autonomy: "autonomous" },
      { phase: "Visual creation", action: "Generate a visual background (browser-automation fallback only if no provider API).", autonomy: "autonomous" },
      { phase: "Package + caption", action: "Assemble upload package and draft a keyword-rich caption as approval-ready evidence.", autonomy: "autonomous" },
      { phase: "Publish", action: "Upload to TikTok — held for operator approval, never auto-posted.", autonomy: "approval_gated" },
    ],
    cadence: "24/7 preparation loop. On error, restart from the previous safe preparation phase.",
    guardrails: ["Adhere to TikTok Community Guidelines & ToS.", "Copyright + account-health checks before approval-ready.", "No blind upload loop."],
  },
  product: {
    loop: [
      { phase: "1 · Research", action: "Confirm real buyer demand, competitor pricing, and repeat-seller patterns before writing a word (market-research-status).", autonomy: "autonomous" },
      { phase: "2 · Product strategy", action: "Lock title, audience, promise, price lane, and format; offer_score ≥ 70 (publisher-strategy).", autonomy: "autonomous" },
      { phase: "3 · Manuscript", action: "Write ≥ 8 substantive chapters with concrete examples and step-by-step actions.", autonomy: "autonomous" },
      { phase: "4 · Editorial QA", action: "Strip repetition, generic language, and weak sections until grade 'publisher_review_ready'.", autonomy: "autonomous" },
      { phase: "5 · Design QA", action: "Check spacing, buyer-facing language, visuals, and PDF layout safety (system-audit).", autonomy: "autonomous" },
      { phase: "6 · Bundle builder", action: "Assemble guide + trackers + calendars + templates + ≥ 5 bonus tools (planner-bundle).", autonomy: "autonomous" },
      { phase: "7 · Sales page", action: "Write headline, price, FAQ, preview assets, and offer positioning (gumroad-copy).", autonomy: "autonomous" },
      { phase: "8 · Launch assets", action: "Produce ≥ 20 short-form scripts, organic calendar, Pinterest pins, AI-UGC prompts, and cover/lifestyle visuals.", autonomy: "autonomous" },
      { phase: "9 · Approval", action: "Quality score ≥ 82 + market proof, then publish / charge / paid ads — held for operator approval.", autonomy: "approval_gated" },
    ],
    cadence: "Runs the full 9-stage publisher pipeline; targets quality score ≥ 82 before the gated approval step.",
    guardrails: ["Quality score ≥ 82 (ready_for_review) before approval; below that, fix failing checks.", "No publish, charge, or paid ads without approval + receipt.", "Verify real market proof; never fabricate proof, reviews, or income.", "Compliance + originality pass first; original work only."],
  },
  sales: {
    loop: [
      { phase: "Lead generation", action: "Find B2B partners via Apollo/HubSpot first; LinkedIn only as a compliant fallback.", autonomy: "autonomous" },
      { phase: "Qualification", action: "Finance subagent scores budget and need per lead.", autonomy: "autonomous" },
      { phase: "Personalized drafting", action: "Draft a specific message per qualified lead into the CRM.", autonomy: "autonomous" },
      { phase: "Outreach send", action: "Send — held for approval and provider-compliant rate limits.", autonomy: "approval_gated" },
      { phase: "Reporting", action: "Every 4 hours, update the tracking record with prepared/approved touchpoints.", autonomy: "autonomous" },
    ],
    cadence: "Proactive: initiates every 4 hours while armed, not on a per-task command.",
    guardrails: ["Respect LinkedIn/email ToS and rate limits.", "External sends require approval + receipt.", "Never fabricate lead data."],
  },
  commerce: {
    loop: [
      { phase: "09:00 — Find & screen winners", action: "Bulk-import candidates and screen each against the WINNING-PRODUCT TEST: trending/viral (TikTok/FB buzz) + unique wow-factor (hard to find in stores) + problem-solving. Fail any leg → reject.", autonomy: "autonomous" },
      { phase: "Validate demand", action: "Read spy-tool signals (units sold, revenue, trend) + AI deep research on demand, competition, and margin. Source the match on AliExpress with unit cost + fast shipping.", autonomy: "autonomous" },
      { phase: "Competitive-validation gate", action: "Benchmark the BEST-RATED competitor (rating, reviews, price, strength). Proceed only if you beat/match on quality/value AND clear healthy net margin after COGS + ad spend + fees.", autonomy: "autonomous" },
      { phase: "12:00 — Lifestyle creative", action: "Generate AI lifestyle images (product in use) that outperform white-bg stock; produce hook-first TikTok/Meta + AI-UGC ad creative.", autonomy: "autonomous" },
      { phase: "15:00 — Optimize & list", action: "Rewrite keyword-rich SEO titles/descriptions, price for margin, prefer a .store domain; set winners Active (publish to Shopify when armed).", autonomy: "autonomous" },
      { phase: "Continuous — profit-based scaling", action: "Model SKU CAC/LTV/net margin; on a profitable campaign recommend bumping budget ($50→$150) to reinvest, cut losers fast. PMAX ~$50/day, Meta broad, Omnisend abandoned-cart flows.", autonomy: "autonomous" },
      { phase: "Ad spend / orders / charge", action: "Launch/fund/scale ads, place supplier orders, charge customers — all held for operator approval, never autonomous.", autonomy: "approval_gated" },
    ],
    cadence: "Recursive daily loop (09:00 import/screen · 12:00 creative · 15:00 optimize+list · continuous profit-scaling). Listing publishes when armed; all spend is a gated step.",
    guardrails: ["List only products passing all 3 winning traits + the competitive gate + healthy margin.", "No ad spend, supplier order, or charge without approval + receipt; never enter payment credentials.", "No fabricated demand, units sold, reviews, or income (no '$X/week') — real unit economics only.", "Respect TikTok/Meta/Google/Shopify/AliExpress ToS; no counterfeit/IP/restricted products; truthful claims; sub-6% refunds."],
  },
  research: {
    loop: [
      { phase: "Define ICP", action: "Set tight firmographics + the expensive, measurable problem to hunt for.", autonomy: "autonomous" },
      { phase: "Source prospects", action: "Pull real businesses (OpenStreetMap Overpass; Apollo/HubSpot when available) matching the ICP.", autonomy: "autonomous" },
      { phase: "Document trigger", action: "Attach a specific buying signal + evidence per prospect (no fabricated leads).", autonomy: "autonomous" },
      { phase: "Verify & dedupe", action: "Validate contact data and remove duplicates before handoff.", autonomy: "autonomous" },
      { phase: "Broadcast digest", action: "Publish a structured research digest to the shared bus for Marcus & the team.", autonomy: "autonomous" },
    ],
    cadence: "Runs on the autopilot loop; refreshes the prospect pool and digest continuously.",
    guardrails: ["Never fabricate prospects or contact data.", "Every prospect carries a documented, verifiable trigger.", "Dedupe before broadcasting."],
  },
  finance: {
    loop: [
      { phase: "Pull receipts", action: "Read real revenue from Stripe / Lemon Squeezy / Shopify — provider receipts only.", autonomy: "autonomous" },
      { phase: "Reconcile", action: "Match every dollar to a receipt; reject anything unverified.", autonomy: "autonomous" },
      { phase: "Flag leakage", action: "Surface fees, refunds, and margin erosion early.", autonomy: "autonomous" },
      { phase: "Report withdrawable", action: "Show what's available to withdraw and keep the books honest.", autonomy: "autonomous" },
    ],
    cadence: "Continuous; reconciles on every refresh and after each sale.",
    guardrails: ["Count only receipt-backed revenue; zero unverified.", "Never move money — withdrawals are the operator's action.", "Flag fee leakage and refunds."],
  },
  delivery: {
    loop: [
      { phase: "Receive approved order", action: "Pick up a paid/approved order for fulfillment.", autonomy: "autonomous" },
      { phase: "QC", action: "Verify the deliverable is correct, complete, and accessible before sending.", autonomy: "autonomous" },
      { phase: "Store in Google Drive", action: "Place the deliverable (PDF/bundle) in the Drive 'Fufilment' folder, organized per order, and prepare the buyer's access link.", autonomy: "autonomous" },
      { phase: "Record proof", action: "Save the Drive file id + view link + timestamp as delivery evidence on the order record.", autonomy: "autonomous" },
      { phase: "Grant access", action: "Change file sharing / access permissions — held for operator approval, never autonomous.", autonomy: "approval_gated" },
    ],
    cadence: "Fires on each paid order; SLA-driven. Delivers digital goods via the connected Google Drive.",
    guardrails: ["QC pass before any delivery.", "Every delivery has a stored Drive link as evidence.", "Never modify file sharing/access controls autonomously — operator-gated.", "Protect margin; flag unprofitable fulfillment."],
  },
};
