import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callHermes, HERMES_MODEL, hermesConfigured, parseHermesJson } from "../_shared/hermes.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// The live snapshot the frontend probes from Supabase. Hermes reasons over this;
// it never invents state.
type WorldState = {
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

type HermesBrief = {
  mood: string;
  headline: string;
  bottleneck: string;
  route: string;
  intelligenceScore: number;
  confidence: number;
  displayUpgrade: string;
  reasoning: string;
  agentRoutes: Array<{ agent: string; directive: string; priority: "now" | "next" | "hold" }>;
};

const SYSTEM_PROMPT = `You are Hermes, the world-intelligence agent for Operator OS — a live AI-run business.
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

const buildUserPrompt = (state: WorldState, memory: MemoryBrief[]) => {
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

type MemoryBrief = {
  created_at: string;
  mood: string;
  bottleneck: string;
  route: string;
  intelligence_score: number;
};

const clampScore = (n: unknown) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
const clampConfidence = (n: unknown) => Math.max(0, Math.min(1, Number(n) || 0));

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

  const brief = {
    mood: String(parsed.mood ?? "unclear").slice(0, 120),
    headline: String(parsed.headline ?? "").slice(0, 400),
    bottleneck: String(parsed.bottleneck ?? "Unknown").slice(0, 300),
    route: String(parsed.route ?? "").slice(0, 400),
    intelligenceScore: clampScore(parsed.intelligenceScore),
    confidence: clampConfidence(parsed.confidence),
    displayUpgrade: String(parsed.displayUpgrade ?? "").slice(0, 300),
    reasoning: String(parsed.reasoning ?? "").slice(0, 1200),
    agentRoutes: Array.isArray(parsed.agentRoutes)
      ? parsed.agentRoutes.slice(0, 8).map((r) => ({
          agent: String(r?.agent ?? "").slice(0, 40),
          directive: String(r?.directive ?? "").slice(0, 240),
          priority: ["now", "next", "hold"].includes(String(r?.priority)) ? r.priority : "next",
        }))
      : [],
  };

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
