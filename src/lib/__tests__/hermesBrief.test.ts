import { describe, expect, it } from "vitest";
import { buildHermesWorldState, computeFallbackBrief } from "@/lib/hermesBrief";
import type { AutomationSummary, Connector, ConnectorId, RevenueSummary } from "@/lib/businessOps";

const connector = (id: ConnectorId, status: Connector["status"], nextStep = "do thing"): Connector => ({
  id,
  name: `${id} connector`,
  purpose: "test",
  endpoint: `https://x/${id}`,
  status,
  detail: "",
  nextStep,
});

const allReady: Connector[] = [
  connector("crm", "ready"),
  connector("outreach", "ready"),
  connector("storefront", "ready"),
  connector("payments", "ready"),
  connector("fulfillment", "ready"),
];

const noRevenue: RevenueSummary = { netRevenueCents: 0, verifiedCustomers: 0, verifiedEvents: 0, available: false };

const automation = (over: Partial<AutomationSummary> = {}): AutomationSummary => ({
  authenticated: true,
  workerReady: true,
  plannerReady: true,
  enabled: true,
  paused: false,
  allowCrmSync: true,
  allowDraftProducts: true,
  activeJobs: 0,
  awaitingApproval: 0,
  succeededJobs: 0,
  failedJobs: 0,
  ...over,
});

describe("computeFallbackBrief", () => {
  it("reports a live world when everything is ready", () => {
    const brief = computeFallbackBrief(allReady, { ...noRevenue, available: true }, automation());
    expect(brief.mood).toBe("World is live");
    expect(brief.intelligenceScore).toBe(100);
    expect(brief.agentRoutes).toEqual([]);
  });

  it("names the first blocked connector as the bottleneck", () => {
    const connectors = [connector("crm", "ready"), connector("outreach", "needs_configuration", "Add RESEND_API_KEY"), ...allReady.slice(2)];
    const brief = computeFallbackBrief(connectors, noRevenue, automation());
    expect(brief.bottleneck).toBe("outreach connector");
    expect(brief.route).toBe("Add RESEND_API_KEY");
  });

  it("flags the kernel when worker/planner are down", () => {
    const brief = computeFallbackBrief(allReady, noRevenue, automation({ workerReady: false }));
    expect(brief.mood).toBe("Display online; kernel needs attention");
  });

  it("falls back to the approval queue when connectors are ready but approvals wait", () => {
    const brief = computeFallbackBrief(allReady, { ...noRevenue, available: true }, automation({ awaitingApproval: 3 }));
    expect(brief.bottleneck).toBe("Approval queue");
  });

  it("scores partial readiness between 0 and 100", () => {
    const connectors = [connector("crm", "ready"), connector("outreach", "not_deployed"), connector("storefront", "not_deployed"), connector("payments", "not_deployed"), connector("fulfillment", "not_deployed")];
    const brief = computeFallbackBrief(connectors, noRevenue, automation({ enabled: false }));
    expect(brief.intelligenceScore).toBeGreaterThan(0);
    expect(brief.intelligenceScore).toBeLessThan(100);
  });

  it("never divides by zero with an empty connector list", () => {
    const brief = computeFallbackBrief([], noRevenue, automation({ workerReady: false, plannerReady: false, enabled: false }));
    expect(Number.isFinite(brief.intelligenceScore)).toBe(true);
  });
});

describe("buildHermesWorldState", () => {
  const agentList = [
    { id: "hermes", name: "Hermes", role: "Intelligence", connector: "intelligence" },
    { id: "creative", name: "Aria", role: "DJ", connector: "creative" },
    { id: "research", name: "Maya", role: "Research", connector: "crm" },
    { id: "sales", name: "Marcus", role: "Sales", connector: "outreach" },
  ];

  it("excludes connector-less agents (Hermes, creative) from the routed set", () => {
    const state = buildHermesWorldState(agentList, allReady, noRevenue, automation());
    const ids = state.agents.map((a) => a.id);
    expect(ids).toEqual(["research", "sales"]);
  });

  it("marks an agent ready only when its connector is ready", () => {
    const connectors = [connector("crm", "ready"), connector("outreach", "not_deployed")];
    const state = buildHermesWorldState(agentList, connectors, noRevenue, automation());
    expect(state.agents.find((a) => a.id === "research")?.ready).toBe(true);
    expect(state.agents.find((a) => a.id === "sales")?.ready).toBe(false);
  });
});
