// Live regression guard for cross-agent learning. Skipped in normal runs; run on
// demand against the real Nous API:
//
//   HERMES_LIVE_EVAL=1 NOUS_API_KEY=sk-nous-... npx vitest run src/eval/crossAgentLearning.live.test.ts
//
// It replicates the orchestrator's prompt assembly — an agent's playbook PLUS a
// known teammate digest injected as COLLECTIVE TEAM KNOWLEDGE — and asserts the
// agent's output actually references that knowledge. If cross-agent learning
// regresses (agents stop using the bus), this fails.
import { describe, expect, it } from "vitest";
import { scoreKnowledgeUsage } from "../../supabase/functions/_shared/knowledgeEval";

const LIVE = process.env.HERMES_LIVE_EVAL === "1" && Boolean(process.env.NOUS_API_KEY);
const MODEL = process.env.HERMES_MODEL ?? "nousresearch/hermes-4-70b";
const BASE = process.env.NOUS_API_BASE_URL?.replace(/\/$/, "") ?? "https://inference-api.nousresearch.com/v1";

const SALES_PLAYBOOK =
  "PERSONA: You are a Proactive AI SDR. OPERATIONAL LOOP: lead-gen -> qualify -> personalized drafting -> [GATED] send. GUARDRAILS: external sends require approval; never fabricate a sent receipt.";

const MAYA_DIGEST =
  "COLLECTIVE TEAM KNOWLEDGE (learn from your teammates; newest first):\n" +
  "  1. [Maya -> all] Austin home-services ICP: 46 Austin home-services contractors (HVAC/roofing/carpentry); expensive problem = weak online booking + slow follow-up. Recommended offer: Contractor Follow-Up + Booking Kit ($29). Outreach angle: you are losing jobs to slow follow-up.";

async function ask(system: string, objective: string): Promise<string> {
  const r = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.NOUS_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify({ agent: "sales", objective }) },
      ],
      temperature: 0.3,
      max_tokens: 400,
    }),
  });
  const raw = await r.json();
  return raw?.choices?.[0]?.message?.content ?? "";
}

describe.runIf(LIVE)("cross-agent learning (live)", () => {
  it("Marcus uses Maya's research digest when it is on the bus", async () => {
    const withKnowledge = `You are a business operations agent.\n\n${SALES_PLAYBOOK}\n\n${MAYA_DIGEST}`;
    const out = await ask(withKnowledge, "Draft a first cold outreach email for our best-fit prospect (do not send).");
    const usage = scoreKnowledgeUsage(out, ["follow-up", "contractor", "29"]);
    console.log(`  with-knowledge usage=${(usage.score * 100).toFixed(0)}% hits=${usage.hits.join(", ")}`);
    expect(usage.used, `expected Marcus to use Maya's digest; missed: ${usage.missed.join(", ")}`).toBe(true);
  }, 90_000);

  it("without the digest, the same agent does NOT invent that specific ICP", async () => {
    const noKnowledge = `You are a business operations agent.\n\n${SALES_PLAYBOOK}`;
    const out = await ask(noKnowledge, "Draft a first cold outreach email for our best-fit prospect (do not send).");
    const usage = scoreKnowledgeUsage(out, ["contractor", "29"]);
    console.log(`  no-knowledge usage=${(usage.score * 100).toFixed(0)}% (expected low)`);
    // The contrast confirms the lift comes from the bus, not the base prompt.
    expect(usage.score).toBeLessThan(1);
  }, 90_000);
});

describe.skipIf(LIVE)("cross-agent learning (live) — skipped", () => {
  it("set HERMES_LIVE_EVAL=1 and NOUS_API_KEY to run", () => {
    expect(true).toBe(true);
  });
});
