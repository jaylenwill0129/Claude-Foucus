import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callHermes, HERMES_MODEL, hermesConfigured, parseHermesJson } from "../_shared/hermes.ts";
import {
  buildUserPrompt,
  type HermesBrief,
  type MemoryBrief,
  normalizeBrief,
  SYSTEM_PROMPT,
  type WorldState,
} from "../_shared/hermesBriefSchema.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (req.method === "GET") {
    return json({
      connector: "hermes_intelligence",
      configured: Boolean(hermesConfigured() && supabaseUrl && serviceKey),
      model: HERMES_MODEL,
    });
  }
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  if (!hermesConfigured() || !supabaseUrl || !serviceKey) {
    return json({ error: "NOUS_API_KEY, SUPABASE_URL, and SUPABASE_SECRET_KEY are required" }, 503);
  }

  const authorization = req.headers.get("Authorization");
  if (!authorization) return json({ error: "Authorization required" }, 401);

  const supabase = createClient(supabaseUrl, serviceKey);
  const token = authorization.replace(/^Bearer\s+/i, "");
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) return json({ error: "Invalid user session" }, 401);
  const ownerId = userData.user.id;

  let state: WorldState;
  try {
    state = (await req.json()) as WorldState;
  } catch {
    return json({ error: "Valid world_state JSON body required" }, 400);
  }
  if (!state?.connectors || !state?.automation) {
    return json({ error: "world_state must include connectors and automation" }, 400);
  }

  // Memory loop: load the operator's recent briefs so Hermes can learn.
  const { data: memoryRows } = await supabase
    .from("agent_hermes_briefs")
    .select("created_at,mood,bottleneck,route,intelligence_score")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false })
    .limit(5);
  const memory = (memoryRows ?? []) as MemoryBrief[];

  let result;
  try {
    result = await callHermes({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(state, memory) },
      ],
      temperature: 0.35,
      maxTokens: 900,
      jsonObject: true,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Hermes call failed" }, 502);
  }

  const parsed = parseHermesJson<HermesBrief>(result.content);
  if (!parsed) {
    return json({ error: "Hermes returned unparseable output", raw: result.content.slice(0, 500) }, 502);
  }

  const brief = normalizeBrief(parsed);

  // Persist the new brief so the next cycle has it as memory.
  const { data: saved } = await supabase
    .from("agent_hermes_briefs")
    .insert({
      owner_id: ownerId,
      model: result.model,
      mood: brief.mood,
      headline: brief.headline,
      bottleneck: brief.bottleneck,
      route: brief.route,
      intelligence_score: brief.intelligenceScore,
      confidence: brief.confidence,
      agent_routes: brief.agentRoutes,
      display_upgrade: brief.displayUpgrade,
      reasoning: brief.reasoning,
      world_state: state,
      prompt_tokens: result.promptTokens,
      completion_tokens: result.completionTokens,
      latency_ms: result.latencyMs,
    })
    .select("id,created_at")
    .maybeSingle();

  return json({
    brief,
    model: result.model,
    memoryDepth: memory.length,
    briefId: saved?.id ?? null,
    createdAt: saved?.created_at ?? new Date().toISOString(),
    usage: { promptTokens: result.promptTokens, completionTokens: result.completionTokens, latencyMs: result.latencyMs },
  });
});
