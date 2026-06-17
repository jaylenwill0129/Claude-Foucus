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
      { phase: "Market intelligence", action: "Research demand, competitors, pricing, and the expensive problem; go/no-go status.", autonomy: "autonomous" },
      { phase: "Brief + outline", action: "Define audience, promise, scope, and chapter structure.", autonomy: "autonomous" },
      { phase: "Manuscript + product draft", action: "Write the manuscript and render the sellable HTML/PDF with worksheets.", autonomy: "autonomous" },
      { phase: "Editorial / quality / compliance", action: "Self-review and a compliance gate; block on failed claims/originality.", autonomy: "autonomous" },
      { phase: "Listing + marketing pack", action: "Draft Gumroad copy + pricing and generate cover, mockup, pins, UGC scripts, calendar.", autonomy: "autonomous" },
      { phase: "Publish", action: "List to Gumroad/Shopify and charge — held for operator approval, never auto-published.", autonomy: "approval_gated" },
    ],
    cadence: "Runs the full product pipeline on demand; publishing is a single gated step.",
    guardrails: ["No publish or charge without approval + receipt.", "Compliance/claims review must pass first.", "Original work only; respect platform ToS."],
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
      { phase: "Niche & product research", action: "Hunt micro-niches in high-profit categories; target the $10-30 sweet spot; surface 3-5 weekly test candidates before saturation.", autonomy: "autonomous" },
      { phase: "Supplier & fulfillment vetting", action: "Prefer US/EU warehouses for 3-5 day delivery; honor TikTok Shop's ~3-day US rule; require QC for sub-6% refunds.", autonomy: "autonomous" },
      { phase: "Brand & positioning", action: "Private label + custom packaging + unboxing inserts; check brandable domain availability (prefer .com) before naming; professional copy.", autonomy: "autonomous" },
      { phase: "Listing + ad creative", action: "Draft the unpublished Shopify listing priced for net margin; produce hook-first TikTok/Reels video concepts; plan multi-channel mix.", autonomy: "autonomous" },
      { phase: "Automation + KPI dashboard", action: "Spec AutoDS-style fulfillment + 24/7 stock monitoring + support bot; model SKU-level CAC/LTV/net margin with cut/scale thresholds.", autonomy: "autonomous" },
      { phase: "Publish / spend / charge", action: "Publish listing, launch paid ads, place supplier orders, charge customers — all held for operator approval, never autonomous.", autonomy: "approval_gated" },
    ],
    cadence: "Continuous research with a weekly 3-5 product test batch; publishing and spend are deliberate gated steps.",
    guardrails: ["No publish, ad spend, supplier order, or charge without approval + receipt; never enter payment credentials.", "Honor TikTok Shop US/3-day fulfillment; true shipping times; QC for sub-6% refunds.", "Respect Shopify/TikTok/Meta ToS; no counterfeit/restricted products; evidence-only metrics."],
  },
};
