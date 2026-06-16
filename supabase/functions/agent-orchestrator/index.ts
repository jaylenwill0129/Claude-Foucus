import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callHermes, HERMES_MODEL, hermesConfigured } from "../_shared/hermes.ts";
import { PLAYBOOKS, playbookPrompt } from "../_shared/playbooks.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type AgentJob = {
  agent: "research" | "sales" | "product" | "delivery" | "finance" | "creative";
  objective: string;
  context?: Record<string, unknown>;
};

const BASE_PROMPT =
  "You are a business operations agent. Produce only evidence-backed work. Never claim outreach, publishing, payment, or fulfillment occurred without a provider receipt. Return a concise action plan and the evidence required for the next handoff.";

// Compose the agent's persona/loop/subagent playbook into the system prompt when
// one exists for the requested agent.
const systemPromptFor = (agent: AgentJob["agent"]) => {
  const playbook = PLAYBOOKS[agent];
  return playbook ? `${BASE_PROMPT}\n\n${playbookPrompt(playbook)}` : BASE_PROMPT;
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

  // Hermes path (Nous Research).
  if (useHermes) {
    try {
      const hermes = await callHermes({
        messages: [
          { role: "system", content: systemPromptFor(job.agent) },
          { role: "user", content: JSON.stringify(job) },
        ],
        temperature: 0.3,
        maxTokens: 900,
      });
      return json({
        accepted: true,
        agent: job.agent,
        brain: hermes.model,
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
        { role: "system", content: systemPromptFor(job.agent) },
        { role: "user", content: JSON.stringify(job) },
      ],
    }),
  });

  const result = await response.json();
  if (!response.ok) return json({ error: "OpenAI request failed", provider: result }, response.status);

  return json({
    accepted: true,
    agent: job.agent,
    brain: "openai",
    result,
    executionPolicy: "prepare_only_until_operator_approval",
  });
});
