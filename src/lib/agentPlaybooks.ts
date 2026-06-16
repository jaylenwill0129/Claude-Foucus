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
      { phase: "Visual creation", action: "Generate a visual background (OpenClaw wrapper only if no provider API).", autonomy: "autonomous" },
      { phase: "Package + caption", action: "Assemble upload package and draft a keyword-rich caption as approval-ready evidence.", autonomy: "autonomous" },
      { phase: "Publish", action: "Upload to TikTok — held for operator approval, never auto-posted.", autonomy: "approval_gated" },
    ],
    cadence: "24/7 preparation loop. On error, restart from the previous safe preparation phase.",
    guardrails: ["Adhere to TikTok Community Guidelines & ToS.", "Copyright + account-health checks before approval-ready.", "No blind upload loop."],
  },
  sales: {
    loop: [
      { phase: "Lead generation", action: "Find B2B partners via Apollo/HubSpot first; OpenClaw + LinkedIn only as a compliant fallback.", autonomy: "autonomous" },
      { phase: "Qualification", action: "Finance subagent scores budget and need per lead.", autonomy: "autonomous" },
      { phase: "Personalized drafting", action: "Draft a specific message per qualified lead into the CRM.", autonomy: "autonomous" },
      { phase: "Outreach send", action: "Send — held for approval and provider-compliant rate limits.", autonomy: "approval_gated" },
      { phase: "Reporting", action: "Every 4 hours, update the tracking record with prepared/approved touchpoints.", autonomy: "autonomous" },
    ],
    cadence: "Proactive: initiates every 4 hours while armed, not on a per-task command.",
    guardrails: ["Respect LinkedIn/email ToS and rate limits.", "External sends require approval + receipt.", "Never fabricate lead data."],
  },
};
