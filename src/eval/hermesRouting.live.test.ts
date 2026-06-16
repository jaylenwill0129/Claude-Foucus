// Live routing-quality eval for Hermes-4. Skipped in normal test runs; run it on
// demand against the real Nous API:
//
//   HERMES_LIVE_EVAL=1 NOUS_API_KEY=sk-nous-... npx vitest run src/eval/hermesRouting.live.test.ts
//
// It sends each world-state fixture through the SAME prompt + normalization the
// edge function uses, scores the result with the shared rubric, and asserts the
// average routing quality clears a threshold. This is the regression net for the
// model's judgment as the world grows.
import { describe, expect, it } from "vitest";
import {
  buildUserPrompt,
  normalizeBrief,
  scoreRouting,
  SYSTEM_PROMPT,
  type HermesBrief,
  type WorldState,
} from "../../supabase/functions/_shared/hermesBriefSchema";

const LIVE = process.env.HERMES_LIVE_EVAL === "1" && Boolean(process.env.NOUS_API_KEY);
const MODEL = process.env.HERMES_MODEL ?? "nousresearch/hermes-4-70b";
const BASE = process.env.NOUS_API_BASE_URL?.replace(/\/$/, "") ?? "https://inference-api.nousresearch.com/v1";
const THRESHOLD = 0.8;

const baseAutomation = { enabled: true, paused: false, workerReady: true, plannerReady: true, activeJobs: 1, awaitingApproval: 0, succeededJobs: 0, failedJobs: 0, allowCrmSync: true, allowDraftProducts: true };
const baseRevenue = { netRevenueCents: 0, verifiedCustomers: 0, verifiedEvents: 0, available: true };
const agents = [
  { id: "research", name: "Maya", role: "Research", connector: "crm", ready: true },
  { id: "sales", name: "Marcus", role: "Sales", connector: "outreach", ready: false },
  { id: "product", name: "Lena", role: "Product", connector: "storefront", ready: false },
];

const fixtures: Array<{ name: string; state: WorldState }> = [
  {
    name: "one connector blocked",
    state: {
      connectors: [
        { id: "crm", name: "Prospect data & CRM", status: "ready" },
        { id: "outreach", name: "Resend outreach", status: "needs_configuration", nextStep: "Add RESEND_API_KEY" },
        { id: "storefront", name: "Shopify storefront", status: "ready" },
        { id: "payments", name: "Stripe revenue ledger", status: "ready" },
        { id: "fulfillment", name: "Google Drive fulfillment", status: "ready" },
      ],
      revenue: baseRevenue,
      automation: baseAutomation,
      agents,
    },
  },
  {
    name: "mostly blocked, kernel down",
    state: {
      connectors: [
        { id: "crm", name: "Prospect data & CRM", status: "ready" },
        { id: "outreach", name: "Resend outreach", status: "not_deployed" },
        { id: "storefront", name: "Shopify storefront", status: "not_deployed" },
        { id: "payments", name: "Stripe revenue ledger", status: "not_deployed" },
        { id: "fulfillment", name: "Google Drive fulfillment", status: "not_deployed" },
      ],
      revenue: { ...baseRevenue, available: false },
      automation: { ...baseAutomation, workerReady: false, plannerReady: false },
      agents,
    },
  },
  {
    name: "all ready, scaling",
    state: {
      connectors: [
        { id: "crm", name: "Prospect data & CRM", status: "ready" },
        { id: "outreach", name: "Resend outreach", status: "ready" },
        { id: "storefront", name: "Shopify storefront", status: "ready" },
        { id: "payments", name: "Stripe revenue ledger", status: "ready" },
        { id: "fulfillment", name: "Google Drive fulfillment", status: "ready" },
      ],
      revenue: { ...baseRevenue, netRevenueCents: 8700, verifiedCustomers: 3, verifiedEvents: 3 },
      automation: { ...baseAutomation, awaitingApproval: 2 },
      agents: agents.map((a) => ({ ...a, ready: true })),
    },
  },
];

async function askHermes(state: WorldState): Promise<HermesBrief> {
  const response = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.NOUS_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(state, []) },
      ],
      temperature: 0.35,
      max_tokens: 900,
      response_format: { type: "json_object" },
    }),
  });
  const raw = await response.json();
  const content: string = raw?.choices?.[0]?.message?.content ?? "{}";
  return normalizeBrief(JSON.parse(content));
}

describe.runIf(LIVE)("Hermes routing quality (live)", () => {
  it("clears the routing-quality threshold across fixtures", async () => {
    const results: number[] = [];
    for (const f of fixtures) {
      const brief = await askHermes(f.state);
      const score = scoreRouting(brief, f.state);
      const failed = score.checks.filter((c) => !c.pass).map((c) => c.name);
      console.log(`  [${f.name}] score=${(score.total * 100).toFixed(0)}% bottleneck="${brief.bottleneck}"${failed.length ? ` failed: ${failed.join(", ")}` : ""}`);
      results.push(score.total);
      expect(score.total, `${f.name} failed: ${failed.join(", ")}`).toBeGreaterThanOrEqual(THRESHOLD);
    }
    const avg = results.reduce((a, b) => a + b, 0) / results.length;
    console.log(`  AVERAGE routing quality: ${(avg * 100).toFixed(0)}%`);
    expect(avg).toBeGreaterThanOrEqual(THRESHOLD);
  }, 90_000);
});

describe.skipIf(LIVE)("Hermes routing quality (live) — skipped", () => {
  it("set HERMES_LIVE_EVAL=1 and NOUS_API_KEY to run", () => {
    expect(true).toBe(true);
  });
});
