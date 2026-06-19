import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callHermes, HERMES_MODEL, hermesConfigured } from "../_shared/hermes.ts";
import { PLAYBOOKS, playbookPrompt } from "../_shared/playbooks.ts";
import { extractTeamLearning, isNearDuplicate, rankKnowledge } from "../_shared/knowledgeEval.ts";
import { benchmarkPrompt } from "../_shared/benchmarks.ts";

// Appended to every system prompt so each agent contributes a reusable insight
// back to the shared learning bus (closing the learn-from-results loop). Framed
// around proficiency: what made this better than the baseline / benchmark.
const LEARNING_INSTRUCTION =
  "\n\nAfter your plan, end with one line exactly: TEAM_LEARNING: <the single most reusable tactic that beat the benchmark, so teammates can replicate it>.";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type AgentJob = {
  agent: "research" | "sales" | "product" | "delivery" | "finance" | "creative" | "commerce";
  objective: string;
  context?: Record<string, unknown>;
};

const BASE_PROMPT =
  "You are a business operations agent. Produce only evidence-backed work. Never claim outreach, publishing, payment, or fulfillment occurred without a provider receipt. " +
  "OWN YOUR LANE: go deep in your specific area of focus (your playbook domain) and deliver work only you should own. Use the collective team knowledge to coordinate and build on teammates' work toward shared revenue — but do not drift into another agent's domain or duplicate their output; hand off to the right specialist instead. " +
  "DELIVER, DON'T DESCRIBE: when the task is to create something, output the finished, ready-to-use artifact in full — the actual copy, templates, listing text, scripts, or numbers a human could ship as-is — not a summary of what you would make. End with the concrete evidence/handoff the next agent needs. " +
  "REVENUE FOCUS: bias every choice toward the next verifiable dollar; name the expected impact and the metric it moves, and prefer the cheapest path to a real receipt. Keep money-moving and outward steps (send, publish, spend, charge) clearly marked APPROVAL-GATED. " +
  "CHANNEL RESILIENCE: never let one blocked channel stop revenue. If a platform rejects, blocks, or can't onboard (e.g. a payment processor declines, a store is under review), do NOT stall — route to the next viable channel: digital products sell via Lemon Squeezy hosted checkout (merchant of record, no payment-gateway approval needed); physical via Shopify. Name the blocker and keep moving to a real receipt. " +
  "AUTONOMOUS PUBLISHING (end-state, when the operator has ARMED autopilot): you may run the full loop yourself — source the product, create the listing + creative, and PUBLISH the product LISTING to the live Shopify store — choosing winners and cutting losers without per-item approval. STILL HARD-GATED regardless of arming: spending on ads, placing supplier orders, charging customers, moving/withdrawing funds, and entering any payment/credential — these always require explicit operator approval and a real receipt. Only ever publish compliant, original, non-counterfeit, non-restricted products with truthful claims; never fabricate sales, reviews, or income.";

// Compose the agent's persona/loop/subagent playbook into the system prompt when
// one exists for the requested agent.
const systemPromptFor = (agent: AgentJob["agent"]) => {
  const playbook = PLAYBOOKS[agent];
  return playbook ? `${BASE_PROMPT}\n\n${playbookPrompt(playbook)}` : BASE_PROMPT;
};

// Cross-agent learning: pull a recent window of the team's shared knowledge and
// rank it by relevance to THIS job (agent + objective) so every agent is fed the
// most useful learnings — esp. Maya's research — rather than just the newest.
const teamKnowledgeBlock = async (
  supabase: ReturnType<typeof createClient>,
  ownerId: string,
  query: string,
): Promise<string> => {
  try {
    const { data } = await supabase
      .from("agent_knowledge")
      .select("agent,audience,kind,topic,insight")
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: false })
      .limit(24);
    const rows = (data ?? []) as Array<Record<string, string>>;
    if (!rows.length) return "";
    const ranked = rankKnowledge(query, rows, 6);
    return "\n\nCOLLECTIVE TEAM KNOWLEDGE (ranked by relevance to your task):\n" +
      ranked.map((k, i) => `  ${i + 1}. [${k.agent} -> ${k.audience}] ${k.topic}: ${k.insight}`).join("\n");
  } catch {
    return "";
  }
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const openAiKey = Deno.env.get("OPENAI_API_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseSecretKey = Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  // Hermes is the preferred brain; OpenAI remains a fallback so existing
  // deployments keep working.
  const useHermes = hermesConfigured();

  if (req.method === "GET") {
    return json({
      connector: "agent_orchestrator",
      configured: Boolean((useHermes || openAiKey) && supabaseUrl && supabaseSecretKey),
      brain: useHermes ? HERMES_MODEL : openAiKey ? "openai" : null,
    });
  }
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  if ((!useHermes && !openAiKey) || !supabaseUrl || !supabaseSecretKey) {
    return json({ error: "A model key (NOUS_API_KEY or OPENAI_API_KEY), SUPABASE_URL, and SUPABASE_SECRET_KEY are required" }, 503);
  }

  const authorization = req.headers.get("Authorization");
  if (!authorization) return json({ error: "Authorization required" }, 401);

  const supabase = createClient(supabaseUrl, supabaseSecretKey);
  const token = authorization.replace(/^Bearer\s+/i, "");
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) return json({ error: "Invalid user session" }, 401);

  const job = (await req.json()) as AgentJob;
  if (!job.agent || !job.objective) return json({ error: "agent and objective are required" }, 400);

  const teamKnowledge = await teamKnowledgeBlock(supabase, userData.user.id, `${job.agent} ${job.objective}`);
  const sysPrompt = systemPromptFor(job.agent) + benchmarkPrompt(job.agent) + teamKnowledge + LEARNING_INSTRUCTION;
  // Deliverable-producing agents need room to output complete work (full
  // templates/listings/scripts), not truncated plans.
  const maxTokensFor = (agent: string) =>
    agent === "product" || agent === "commerce" ? 1800 : agent === "creative" ? 1400 : 1000;

  // Persist a reusable insight the agent surfaced back to the shared bus so the
  // whole team learns from this run. Skips near-duplicates so ranked retrieval
  // stays signal-rich. Best-effort: never fails the response.
  const recordLearning = async (content: string) => {
    const learning = extractTeamLearning(content);
    if (!learning) return null;
    try {
      const { data: recent } = await supabase
        .from("agent_knowledge")
        .select("insight")
        .eq("owner_id", userData.user.id)
        .order("created_at", { ascending: false })
        .limit(40);
      const existing = (recent ?? []).map((r: Record<string, string>) => r.insight ?? "");
      if (isNearDuplicate(learning, existing)) return null;
      await supabase.from("agent_knowledge").insert({
        owner_id: userData.user.id,
        agent: job.agent,
        audience: "all",
        kind: "outcome",
        topic: job.objective.slice(0, 80),
        insight: learning,
        data: {},
        confidence: 0.5,
      });
    } catch { /* non-fatal */ }
    return learning;
  };

  // Hermes path (Nous Research).
  if (useHermes) {
    try {
      const hermes = await callHermes({
        messages: [
          { role: "system", content: sysPrompt },
          { role: "user", content: JSON.stringify(job) },
        ],
        temperature: 0.3,
        maxTokens: maxTokensFor(job.agent),
      });
      const learned = await recordLearning(hermes.content);
      return json({
        accepted: true,
        agent: job.agent,
        brain: hermes.model,
        knowledgeUsed: Boolean(teamKnowledge),
        learned,
        result: { content: hermes.content, usage: { promptTokens: hermes.promptTokens, completionTokens: hermes.completionTokens } },
        executionPolicy: "prepare_only_until_operator_approval",
      });
    } catch (error) {
      // If Hermes fails and no OpenAI fallback exists, surface the error.
      if (!openAiKey) return json({ error: error instanceof Error ? error.message : "Hermes request failed" }, 502);
    }
  }

  // OpenAI fallback path.
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openAiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: Deno.env.get("OPENAI_AGENT_MODEL") ?? "gpt-5-mini",
      input: [
        { role: "system", content: sysPrompt },
        { role: "user", content: JSON.stringify(job) },
      ],
    }),
  });

  const result = await response.json();
  if (!response.ok) return json({ error: "OpenAI request failed", provider: result }, response.status);

  const openAiText = typeof result?.output_text === "string"
    ? result.output_text
    : JSON.stringify(result?.output ?? "");
  const learned = await recordLearning(openAiText);

  return json({
    accepted: true,
    agent: job.agent,
    brain: "openai",
    knowledgeUsed: Boolean(teamKnowledge),
    learned,
    result,
    executionPolicy: "prepare_only_until_operator_approval",
  });
});
