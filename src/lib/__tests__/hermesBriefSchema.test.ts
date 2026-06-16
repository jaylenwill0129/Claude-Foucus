import { describe, expect, it } from "vitest";
import {
  normalizeBrief,
  scoreRouting,
  type HermesBrief,
  type WorldState,
} from "../../../supabase/functions/_shared/hermesBriefSchema";

const world = (over: Partial<WorldState> = {}): WorldState => ({
  connectors: [
    { id: "crm", name: "Prospect data & CRM", status: "ready" },
    { id: "outreach", name: "Resend outreach", status: "needs_configuration", nextStep: "Add key" },
    { id: "storefront", name: "Shopify storefront", status: "not_deployed" },
    { id: "payments", name: "Stripe revenue ledger", status: "ready" },
    { id: "fulfillment", name: "Google Drive fulfillment", status: "not_deployed" },
  ],
  revenue: { netRevenueCents: 0, verifiedCustomers: 0, verifiedEvents: 0, available: true },
  automation: { enabled: true, paused: false, workerReady: true, plannerReady: true, activeJobs: 1, awaitingApproval: 0, succeededJobs: 0, failedJobs: 0, allowCrmSync: true, allowDraftProducts: true },
  agents: [
    { id: "research", name: "Maya", role: "Research", connector: "crm", ready: true },
    { id: "sales", name: "Marcus", role: "Sales", connector: "outreach", ready: false },
  ],
  ...over,
});

const goodBrief = (over: Partial<HermesBrief> = {}): HermesBrief => ({
  mood: "Kernel live; connectors closing",
  headline: "Close the outreach connector to unblock sends.",
  bottleneck: "Resend outreach",
  route: "Add the Resend API key and from-address.",
  intelligenceScore: 55,
  confidence: 0.8,
  displayUpgrade: "Show connector deploy state",
  reasoning: "Outreach is the first blocked connector; clearing it unblocks Marcus.",
  agentRoutes: [{ agent: "Marcus", directive: "Prepare drafts pending approval", priority: "next" }],
  ...over,
});

describe("normalizeBrief", () => {
  it("clamps score and confidence into range", () => {
    const b = normalizeBrief({ intelligenceScore: 9999, confidence: 5 } as Partial<HermesBrief>);
    expect(b.intelligenceScore).toBe(100);
    expect(b.confidence).toBe(1);
  });

  it("handles negatives and junk", () => {
    const b = normalizeBrief({ intelligenceScore: -5, confidence: -1 } as Partial<HermesBrief>);
    expect(b.intelligenceScore).toBe(0);
    expect(b.confidence).toBe(0);
  });

  it("supplies safe defaults for missing fields", () => {
    const b = normalizeBrief({});
    expect(b.mood).toBe("unclear");
    expect(b.bottleneck).toBe("Unknown");
    expect(b.agentRoutes).toEqual([]);
  });

  it("caps agentRoutes at 8 and defaults invalid priority to next", () => {
    const routes = Array.from({ length: 12 }, (_, i) => ({ agent: `A${i}`, directive: "do", priority: "whenever" as never }));
    const b = normalizeBrief({ agentRoutes: routes } as Partial<HermesBrief>);
    expect(b.agentRoutes).toHaveLength(8);
    expect(b.agentRoutes.every((r) => r.priority === "next")).toBe(true);
  });

  it("preserves valid priorities", () => {
    const b = normalizeBrief({ agentRoutes: [{ agent: "Maya", directive: "go", priority: "now" }] } as Partial<HermesBrief>);
    expect(b.agentRoutes[0].priority).toBe("now");
  });
});

describe("scoreRouting", () => {
  it("gives a well-grounded brief a perfect score", () => {
    const score = scoreRouting(goodBrief(), world());
    expect(score.total).toBe(1);
    expect(score.checks.every((c) => c.pass)).toBe(true);
  });

  it("fails bottleneck_grounded when it names a non-blocked area", () => {
    const score = scoreRouting(goodBrief({ bottleneck: "Marketing budget", route: "Spend more on ads everywhere" }), world());
    const check = score.checks.find((c) => c.name === "bottleneck_grounded");
    expect(check?.pass).toBe(false);
    expect(score.total).toBeLessThan(1);
  });

  it("fails no_self_side_effect when Hermes narrates doing the action itself", () => {
    const score = scoreRouting(goodBrief({ reasoning: "I will send the outreach emails myself right now." }), world());
    expect(score.checks.find((c) => c.name === "no_self_side_effect")?.pass).toBe(false);
  });

  it("fails routes_known_agents for an invented agent", () => {
    const score = scoreRouting(goodBrief({ agentRoutes: [{ agent: "Zaphod", directive: "x", priority: "now" }] }), world());
    expect(score.checks.find((c) => c.name === "routes_known_agents")?.pass).toBe(false);
  });

  it("accepts a meta-bottleneck when nothing is blocked", () => {
    const allReady = world({ connectors: world().connectors.map((c) => ({ ...c, status: "ready" })) });
    const score = scoreRouting(goodBrief({ bottleneck: "Scale the working loop", route: "Increase outreach volume within limits", intelligenceScore: 95 }), allReady);
    expect(score.checks.find((c) => c.name === "bottleneck_grounded")?.pass).toBe(true);
  });

  it("flags an incoherent score (high IQ while mostly blocked)", () => {
    const mostlyBlocked = world({ connectors: world().connectors.map((c, i) => ({ ...c, status: i === 0 ? "ready" : "not_deployed" })) });
    const score = scoreRouting(goodBrief({ intelligenceScore: 100 }), mostlyBlocked);
    expect(score.checks.find((c) => c.name === "score_coherent")?.pass).toBe(false);
  });
});
