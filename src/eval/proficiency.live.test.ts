// Live proficiency guard: does an agent actually APPLY its top-performer
// benchmark in its output? Skipped in normal runs; run on demand against Nous:
//
//   HERMES_LIVE_EVAL=1 NOUS_API_KEY=sk-nous-... npx vitest run src/eval/proficiency.live.test.ts
//
// It assembles the orchestrator's prompt (playbook + benchmark + directive) for
// each agent, calls Hermes, and asserts the output references the benchmark
// signals. If "study the top performers" silently regresses, this fails.
import { describe, expect, it } from "vitest";
import { benchmarkPrompt, benchmarkSignals } from "../../supabase/functions/_shared/benchmarks";
import { scoreKnowledgeUsage } from "../../supabase/functions/_shared/knowledgeEval";

const LIVE = process.env.HERMES_LIVE_EVAL === "1" && Boolean(process.env.NOUS_API_KEY);
const MODEL = process.env.HERMES_MODEL ?? "nousresearch/hermes-4-70b";
const BASE = process.env.NOUS_API_BASE_URL?.replace(/\/$/, "") ?? "https://inference-api.nousresearch.com/v1";

const CASES: Array<{ agent: string; objective: string; threshold: number }> = [
  { agent: "sales", objective: "Draft a first cold outreach email for our best-fit prospect (do not send).", threshold: 0.5 },
  { agent: "commerce", objective: "Propose this week's product test plan for a home-services niche.", threshold: 0.34 },
];

async function ask(agent: string, objective: string): Promise<string> {
  const system = `You are a business operations agent.${benchmarkPrompt(agent)}`;
  const r = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.NOUS_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, messages: [{ role: "system", content: system }, { role: "user", content: JSON.stringify({ agent, objective }) }], temperature: 0.3, max_tokens: 500 }),
  });
  const raw = await r.json();
  return raw?.choices?.[0]?.message?.content ?? "";
}

describe.runIf(LIVE)("agent proficiency vs benchmark (live)", () => {
  for (const c of CASES) {
    it(`${c.agent} applies its top-performer benchmark`, async () => {
      const out = await ask(c.agent, c.objective);
      const usage = scoreKnowledgeUsage(out, benchmarkSignals(c.agent), c.threshold);
      console.log(`  ${c.agent} benchmark usage=${(usage.score * 100).toFixed(0)}% hits=${usage.hits.join(", ")}`);
      expect(usage.used, `${c.agent} ignored its benchmark; missed: ${usage.missed.join(", ")}`).toBe(true);
    }, 90_000);
  }
});

describe.skipIf(LIVE)("agent proficiency (live) — skipped", () => {
  it("set HERMES_LIVE_EVAL=1 and NOUS_API_KEY to run", () => {
    expect(true).toBe(true);
  });
});
