import type { AutomationSummary, Connector, HermesBrief, RevenueSummary } from "@/lib/businessOps";

// Deterministic read of the world. Used directly until Hermes-4 answers, and as
// the always-available fallback if the model is undeployed or unreachable. Kept
// pure and dependency-free so it can be unit tested in isolation.
export function computeFallbackBrief(connectors: Connector[], revenue: RevenueSummary, automation: AutomationSummary): HermesBrief {
  const ready = connectors.filter((c) => c.status === "ready");
  const blocked = connectors.filter((c) => c.status !== "ready");
  const kernelReady = automation.workerReady && automation.plannerReady;
  const connected = ready.length;
  const total = connectors.length || 1;
  const bottleneck = blocked[0]?.name ?? (automation.awaitingApproval > 0 ? "Approval queue" : revenue.verifiedEvents === 0 ? "First verified revenue event" : "Scale the working loop");
  const route = blocked[0]?.nextStep ?? (automation.awaitingApproval > 0 ? "Review the approval inbox, then let the worker continue." : "Keep Autopilot armed and route receipts into the ledger.");
  const mood = connected === connectors.length && kernelReady ? "World is live" : kernelReady ? "Kernel live; connectors closing" : "Display online; kernel needs attention";
  return {
    mood,
    headline: "See the whole world clearly, route every agent, and turn the next bottleneck into money movement.",
    bottleneck,
    route,
    intelligenceScore: Math.round(((connected / total) * 0.55 + (kernelReady ? 0.25 : 0) + (automation.enabled ? 0.1 : 0) + (revenue.available ? 0.1 : 0)) * 100),
    confidence: 0.5,
    displayUpgrade: "Hermes turns connector probes, jobs, approvals, and revenue into one operating map.",
    reasoning: "Deterministic read of the live control plane. Connect Hermes-4 for adaptive routing with memory.",
    agentRoutes: [],
  };
}

type WorldAgent = { id: string; name: string; role: string; connector: string };

// Assemble the snapshot sent to Hermes. Connector-less agents (Hermes itself,
// the creative DJ) are excluded — Hermes routes connector-backed agents.
export function buildHermesWorldState(agentList: WorldAgent[], connectors: Connector[], revenue: RevenueSummary, automation: AutomationSummary) {
  return {
    connectors: connectors.map((c) => ({ id: c.id, name: c.name, status: c.status, nextStep: c.nextStep })),
    revenue,
    automation,
    agents: agentList
      .filter((a) => a.connector !== "intelligence" && a.connector !== "creative")
      .map((a) => ({ id: a.id, name: a.name, role: a.role, connector: a.connector, ready: connectors.find((c) => c.id === a.connector)?.status === "ready" })),
  };
}
