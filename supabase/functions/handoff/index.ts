import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Cross-agent handoff: Maya (research) -> Marcus (sales). Cron-driven, vault-token
// gated, only when autopilot is ARMED. Takes Maya's highest-confidence research
// digest off the bus and has Marcus draft a first cold outreach email, queued into
// agent_automation_jobs as awaiting_approval (never sent).
// Scheduled via pg_cron 'handoff-maya-marcus' (0 */12 * * *).

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-automation-secret" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const NOUS_BASE = (Deno.env.get("NOUS_API_BASE_URL")?.replace(/\/$/, "")) ?? "https://inference-api.nousresearch.com/v1";
const MODEL = Deno.env.get("HERMES_MODEL") ?? "nousresearch/hermes-4-70b";

async function hermes(system: string, user: string) {
  const key = Deno.env.get("NOUS_API_KEY");
  const r = await fetch(`${NOUS_BASE}/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: MODEL, messages: [{ role: "system", content: system }, { role: "user", content: user }], temperature: 0.4, max_tokens: 700 }) });
  const raw = await r.json().catch(() => ({}));
  return raw?.choices?.[0]?.message?.content ?? "";
}

const SDR = "You are Marcus, a Proactive AI SDR. Using the RESEARCH DIGEST below from Maya, draft a FIRST cold outreach email to the single best-fit prospect. Lead with the documented buying signal, keep it short, one clear ask, and a custom subject line. Benchmarks: signal-based personalization beats the 3.4% average; always plan a follow-up. This is a DRAFT for operator approval — do NOT send, never claim it was sent. Output exactly: 'Subject: ...' then the email body, ready to paste.";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const url = Deno.env.get("SUPABASE_URL");
  const svc = Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const nous = Deno.env.get("NOUS_API_KEY");
  if (req.method === "GET") return json({ connector: "handoff", configured: Boolean(url && svc && nous) });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  if (!url || !svc || !nous) return json({ error: "missing env" }, 503);

  const supabase = createClient(url, svc);
  const candidate = req.headers.get("x-automation-secret");
  let ok = false;
  if (candidate) { const { data } = await supabase.rpc("verify_automation_token", { candidate }); ok = data === true; }
  if (!ok) { const a = req.headers.get("Authorization"); if (a) { const { data: u } = await supabase.auth.getUser(a.replace(/^Bearer\s+/i, "")); ok = Boolean(u?.user); } }
  if (!ok) return json({ error: "automation token or operator session required" }, 401);

  const { data: pol } = await supabase.from("agent_automation_policies").select("user_id").eq("enabled", true).eq("paused", false).limit(1).maybeSingle();
  if (!pol) return json({ skipped: "autopilot not armed" });
  const owner = pol.user_id;

  const { data: digs } = await supabase.from("agent_knowledge").select("topic,insight,confidence").eq("owner_id", owner).or("kind.eq.research_digest,agent.ilike.%maya%").order("confidence", { ascending: false }).order("updated_at", { ascending: false }).limit(1);
  const digest = digs?.[0];
  if (!digest) return json({ skipped: "no research digest from Maya yet" });

  const slot = new Date().toISOString().slice(0, 13);
  const key = `handoff:marcus:${owner}:${slot}`;
  const { data: dup } = await supabase.from("agent_automation_jobs").select("id").eq("idempotency_key", key).limit(1).maybeSingle();
  if (dup) return json({ outcome: "skipped_duplicate", slot });

  const draft = await hermes(SDR, `RESEARCH DIGEST\nTopic: ${digest.topic}\n${digest.insight}`);
  if (!draft || draft.length < 20) return json({ error: "empty draft" }, 502);

  const { error } = await supabase.from("agent_automation_jobs").insert({
    owner_id: owner, agent: "Marcus", action_type: "prepare_outreach_draft", connector: "outreach",
    risk_level: "medium", status: "awaiting_approval", requires_approval: true, idempotency_key: key,
    payload: { draft, fromAgent: "Maya", sourceDigest: digest.topic, note: "Auto-handoff: Maya research -> Marcus outreach draft. Review & approve before sending." },
  });
  if (error) return json({ error: "could not queue draft", detail: error.message }, 500);
  return json({ outcome: "handoff_queued", from: "Maya", to: "Marcus", sourceDigest: digest.topic, draftPreview: draft.slice(0, 220) });
});
