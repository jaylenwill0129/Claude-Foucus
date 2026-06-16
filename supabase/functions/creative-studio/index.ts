import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callHermes, HERMES_MODEL, hermesConfigured, parseHermesJson } from "../_shared/hermes.ts";
import { PLAYBOOKS, playbookPrompt } from "../_shared/playbooks.ts";
import { asStringArray, type CreativePackage, normalizeCreativePackage } from "../_shared/creativeSchema.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// Music/visual generation need external providers (set MUSIC_PROVIDER /
// VISUAL_PROVIDER once available). Until then the studio prepares full creative
// concepts + caption and marks those stages as pending — it never fabricates a
// rendered asset and never posts.
const pendingProviders = () => {
  const pending: string[] = [];
  if (!Deno.env.get("MUSIC_PROVIDER_URL")) pending.push("music");
  if (!Deno.env.get("VISUAL_PROVIDER_URL")) pending.push("visual");
  return pending;
};

const SYSTEM_PROMPT = `${playbookPrompt(PLAYBOOKS.creative)}

You are running ONE preparation cycle. Reason over the provided trend signals and
produce a release-ready creative package. You prepare concepts and copy only — you
do not render audio/video and you do not post. Music and visual rendering are
handled by external providers downstream.

Return ONLY a JSON object with exactly these keys:
{
  "title": "short release title",
  "trendCluster": { "tags": ["#..."], "rationale": "why this cluster", "reachToEffort": "high|medium|low" },
  "track": { "genre": "...", "bpm": 0, "mood": "...", "structure": "intro/build/drop/outro style", "durationSec": 0 },
  "visual": { "concept": "...", "palette": "...", "motion": "..." },
  "caption": "TikTok caption text with a hook",
  "hashtags": ["#...", "#..."],
  "reasoning": "1-3 sentences on the creative bet"
}`;

const buildUserPrompt = (tags: string[], seedTheme?: string) =>
  `Trend signals (TikTok Discover): ${tags.length ? tags.join(", ") : "(none provided — infer a currently plausible cluster)"}\n` +
  `${seedTheme ? `Seed theme: ${seedTheme}\n` : ""}` +
  `Produce the creative package JSON now.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (req.method === "GET") {
    return json({
      connector: "creative_studio",
      configured: Boolean(hermesConfigured() && supabaseUrl && serviceKey),
      model: HERMES_MODEL,
      pendingProviders: pendingProviders(),
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

  const body = await req.json().catch(() => ({}));
  const tags = asStringArray((body as { discoverTags?: unknown }).discoverTags, 12);
  const seedTheme = typeof (body as { seedTheme?: unknown }).seedTheme === "string" ? (body as { seedTheme: string }).seedTheme.slice(0, 200) : undefined;

  let result;
  try {
    result = await callHermes({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(tags, seedTheme) },
      ],
      temperature: 0.7,
      maxTokens: 900,
      jsonObject: true,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Hermes call failed" }, 502);
  }

  const parsed = parseHermesJson<CreativePackage>(result.content);
  if (!parsed) return json({ error: "Hermes returned unparseable output", raw: result.content.slice(0, 500) }, 502);

  const pending = pendingProviders();
  const pkg = normalizeCreativePackage(parsed);

  const { data: saved } = await supabase
    .from("agent_creative_packages")
    .insert({
      owner_id: ownerId,
      model: result.model,
      title: pkg.title,
      trend_cluster: pkg.trendCluster,
      track: pkg.track,
      visual: pkg.visual,
      caption: pkg.caption,
      hashtags: pkg.hashtags,
      pending_providers: pending,
      status: "awaiting_approval",
      reasoning: pkg.reasoning,
    })
    .select("id,created_at")
    .maybeSingle();

  return json({
    package: pkg,
    packageId: saved?.id ?? null,
    createdAt: saved?.created_at ?? new Date().toISOString(),
    status: "awaiting_approval",
    pendingProviders: pending,
    publishPolicy: "approval_gated_no_auto_post",
    model: result.model,
  });
});
