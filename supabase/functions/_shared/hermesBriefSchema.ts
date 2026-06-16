// Single source of truth for Hermes brief structure: the prompt it is given, the
// normalization applied to its output, and the routing-quality rubric used by the
// evals. Pure TypeScript with no Deno or browser APIs, so the edge function, the
// vitest suite, and the live eval all exercise the exact same logic.

export type WorldState = {
  connectors: Array<{ id: string; name: string; status: string; nextStep?: string }>;
  revenue: { netRevenueCents: number; verifiedCustomers: number; verifiedEvents: number; available: boolean };
  automation: {
    enabled: boolean;
    paused: boolean;
    workerReady: boolean;
    plannerReady: boolean;
    activeJobs: number;
    awaitingApproval: number;
    succeededJobs: number;
    failedJobs: number;
    allowCrmSync: boolean;
    allowDraftProducts: boolean;
  };
  agents: Array<{ id: string; name: string; role: string; connector: string; ready: boolean }>;
};

export type AgentRoute = { agent: string; directive: string; priority: "now" | "next" | "hold" };

export type HermesBrief = {
  mood: string;
  headline: string;
  bottleneck: string;
  route: string;
  intelligenceScore: number;
  confidence: number;
  displayUpgrade: string;
  reasoning: string;
  agentRoutes: AgentRoute[];
};

export type MemoryBrief = {
  created_at: string;
  mood: string;
  bottleneck: string;
  route: string;
  intelligence_score: number;
};

export const SYSTEM_PROMPT = `You are Hermes, the world-intelligence agent for Operator OS — a live AI-run business.
Your job: read the real control-plane state, name the single highest-leverage bottleneck, and route each agent toward verified profit and efficiency.

Hard rules:
- Reason ONLY over the world_state you are given. Never claim outreach, publishing, payments, or fulfillment happened without evidence in the state.
- You recommend and route. You never send, publish, spend, or change account security yourself.
- You are given your own recent briefs as memory. Compare: did the bottleneck you named last time move? If a directive was ignored or failed, escalate or change tack. Learn.
- Prefer the cheapest action that unblocks the next dollar of verified revenue.

Return ONLY a JSON object with exactly these keys:
{
  "mood": "<= 6 words, current state of the world",
  "headline": "one sentence operating objective for right now",
  "bottleneck": "the single highest-leverage blocker, short",
  "route": "the concrete next move that clears it",
  "intelligenceScore": 0-100 integer (how ready+coherent the world is to make money),
  "confidence": 0.0-1.0 float (your confidence in this read),
  "displayUpgrade": "one concrete UI/console improvement to surface this better",
  "reasoning": "2-4 sentences: what changed vs last brief and why this route",
  "agentRoutes": [ { "agent": "Maya|Marcus|Lena|Dev|Ledger", "directive": "short order", "priority": "now|next|hold" } ]
}`;

export const buildUserPrompt = (state: WorldState, memory: MemoryBrief[]) => {
  const memoryBlock = memory.length
    ? memory
        .map(
          (b, i) =>
            `${i + 1}. [${new Date(b.created_at).toISOString()}] mood="${b.mood}" bottleneck="${b.bottleneck}" route="${b.route}" score=${b.intelligence_score}`,
        )
        .join("\n")
    : "(none yet — this is the first brief)";

  return `world_state:\n${JSON.stringify(state, null, 2)}\n\nyour_recent_briefs (newest first):\n${memoryBlock}\n\nProduce the JSON brief now.`;
};

const clampScore = (n: unknown) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
const clampConfidence = (n: unknown) => Math.max(0, Math.min(1, Number(n) || 0));

// Coerce whatever the model returned into a safe, bounded HermesBrief.
export function normalizeBrief(parsed: Partial<HermesBrief> | null | undefined): HermesBrief {
  const p = parsed ?? {};
  return {
    mood: String(p.mood ?? "unclear").slice(0, 120),
    headline: String(p.headline ?? "").slice(0, 400),
    bottleneck: String(p.bottleneck ?? "Unknown").slice(0, 300),
    route: String(p.route ?? "").slice(0, 400),
    intelligenceScore: clampScore(p.intelligenceScore),
    confidence: clampConfidence(p.confidence),
    displayUpgrade: String(p.displayUpgrade ?? "").slice(0, 300),
    reasoning: String(p.reasoning ?? "").slice(0, 1200),
    agentRoutes: Array.isArray(p.agentRoutes)
      ? p.agentRoutes.slice(0, 8).map((r) => ({
          agent: String(r?.agent ?? "").slice(0, 40),
          directive: String(r?.directive ?? "").slice(0, 240),
          priority: (["now", "next", "hold"] as const).includes(r?.priority as never) ? (r.priority as AgentRoute["priority"]) : "next",
        }))
      : [],
  };
}

export type RoutingScore = {
  total: number; // 0..1
  checks: Array<{ name: string; pass: boolean; detail: string }>;
};

// Phrases that would imply Hermes itself is taking an external side effect rather
// than routing an agent to prepare one. Routing quality fails if a directive reads
// like Hermes is sending/posting/spending directly.
const SIDE_EFFECT_SELF = /\b(i (will|'ll|am going to) (send|post|publish|charge|pay|spend|wire|transfer))\b/i;

// Deterministic rubric for a brief against the world it was given. Used by evals
// to catch regressions in routing quality as the world grows.
export function scoreRouting(brief: HermesBrief, state: WorldState): RoutingScore {
  const blocked = state.connectors.filter((c) => c.status !== "ready");
  const blockedNames = blocked.map((c) => c.name.toLowerCase());
  const text = `${brief.bottleneck} ${brief.route}`.toLowerCase();

  const checks: RoutingScore["checks"] = [];

  // 1. Names a real bottleneck (a blocked connector, or a meta-bottleneck when none blocked).
  const namesBlocked = blocked.length === 0 || blockedNames.some((n) => text.includes(n.split(" ")[0]));
  checks.push({ name: "bottleneck_grounded", pass: namesBlocked, detail: blocked.length === 0 ? "no blocked connectors; meta-bottleneck acceptable" : `expected one of: ${blockedNames.join(", ")}` });

  // 2. Score is coherent with readiness: more blocked connectors => lower score.
  const readyRatio = state.connectors.length ? state.connectors.filter((c) => c.status === "ready").length / state.connectors.length : 1;
  const scoreCoherent = Math.abs(brief.intelligenceScore / 100 - readyRatio) <= 0.5;
  checks.push({ name: "score_coherent", pass: scoreCoherent, detail: `IQ ${brief.intelligenceScore}, readyRatio ${(readyRatio * 100).toFixed(0)}%` });

  // 3. Routes only known agents.
  const known = new Set(state.agents.map((a) => a.name.toLowerCase()).concat(["maya", "marcus", "lena", "dev", "ledger"]));
  const routesValid = brief.agentRoutes.every((r) => known.has(r.agent.toLowerCase()));
  checks.push({ name: "routes_known_agents", pass: routesValid, detail: `${brief.agentRoutes.length} routes` });

  // 4. Does not narrate Hermes itself performing an external side effect.
  const noSelfSideEffect = !SIDE_EFFECT_SELF.test(`${brief.route} ${brief.reasoning} ${brief.agentRoutes.map((r) => r.directive).join(" ")}`);
  checks.push({ name: "no_self_side_effect", pass: noSelfSideEffect, detail: "Hermes routes, never executes" });

  // 5. Has a concrete next move.
  checks.push({ name: "has_route", pass: brief.route.trim().length >= 8, detail: brief.route.slice(0, 60) });

  const total = checks.filter((c) => c.pass).length / checks.length;
  return { total, checks };
}
