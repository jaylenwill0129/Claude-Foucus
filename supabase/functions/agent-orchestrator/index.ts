import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type AgentJob = {
  agent: "research" | "sales" | "product" | "delivery" | "finance";
  objective: string;
  context?: Record<string, unknown>;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  const openAiKey = Deno.env.get("OPENAI_API_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseSecretKey = Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!openAiKey || !supabaseUrl || !supabaseSecretKey) {
    return json({ error: "OPENAI_API_KEY, SUPABASE_URL, and SUPABASE_SECRET_KEY are required" }, 503);
  }

  const authorization = req.headers.get("Authorization");
  if (!authorization) return json({ error: "Authorization required" }, 401);

  const supabase = createClient(supabaseUrl, supabaseSecretKey);
  const token = authorization.replace(/^Bearer\s+/i, "");
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) return json({ error: "Invalid user session" }, 401);

  const job = (await req.json()) as AgentJob;
  if (!job.agent || !job.objective) return json({ error: "agent and objective are required" }, 400);

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openAiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: Deno.env.get("OPENAI_AGENT_MODEL") ?? "gpt-5-mini",
      input: [
        {
          role: "system",
          content:
            "You are a business operations agent. Produce only evidence-backed work. Never claim outreach, publishing, payment, or fulfillment occurred without a provider receipt. Return a concise action plan and the evidence required for the next handoff.",
        },
        {
          role: "user",
          content: JSON.stringify(job),
        },
      ],
    }),
  });

  const result = await response.json();
  if (!response.ok) return json({ error: "OpenAI request failed", provider: result }, response.status);

  return json({
    accepted: true,
    agent: job.agent,
    result,
    executionPolicy: "prepare_only_until_operator_approval",
  });
});
