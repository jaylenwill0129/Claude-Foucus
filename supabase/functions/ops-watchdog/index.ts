import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Ops watchdog — the ENABLER that keeps the world running 24/7. Cron-driven
// ('ops-watchdog', 20 * * * *), vault-token gated. Heals transient failures
// (re-queues failed NON-approval jobs under their attempt cap), un-sticks jobs
// stuck 'running' > 1h, and returns a health summary. Never touches approval-gated
// jobs (those wait for the operator).

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-automation-secret" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const url = Deno.env.get("SUPABASE_URL");
  const svc = Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (req.method === "GET") return json({ connector: "ops_watchdog", configured: Boolean(url && svc) });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  if (!url || !svc) return json({ error: "missing env" }, 503);
  const supabase = createClient(url, svc);
  const candidate = req.headers.get("x-automation-secret");
  let ok = false;
  if (candidate) { const { data } = await supabase.rpc("verify_automation_token", { candidate }); ok = data === true; }
  if (!ok) { const a = req.headers.get("Authorization"); if (a) { const { data: u } = await supabase.auth.getUser(a.replace(/^Bearer\s+/i, "")); ok = Boolean(u?.user); } }
  if (!ok) return json({ error: "automation token or operator session required" }, 401);

  const nowIso = new Date().toISOString();
  const staleCutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  let requeuedFailed = 0, unstuck = 0;

  // 1) Heal transient failures: re-queue NON-approval jobs that failed but still have attempts left.
  try {
    const { data } = await supabase.from("agent_automation_jobs").select("id,attempts,max_attempts").eq("status", "failed").eq("requires_approval", false).limit(100);
    for (const j of (data ?? [])) {
      if ((j.attempts ?? 0) < (j.max_attempts ?? 3)) {
        await supabase.from("agent_automation_jobs").update({ status: "queued", last_error: null, run_after: nowIso }).eq("id", j.id);
        requeuedFailed++;
      }
    }
  } catch (_e) { /* best-effort */ }

  // 2) Un-stick jobs stuck in running/started with no finish for > 1h.
  try {
    const { data } = await supabase.from("agent_automation_jobs").select("id").in("status", ["running", "started", "in_progress"]).is("finished_at", null).lt("started_at", staleCutoff).limit(100);
    for (const j of (data ?? [])) { await supabase.from("agent_automation_jobs").update({ status: "queued", run_after: nowIso }).eq("id", j.id); unstuck++; }
  } catch (_e) { /* best-effort */ }

  // 3) Health snapshot.
  const counts: Record<string, number> = {};
  try {
    const { data } = await supabase.from("agent_automation_jobs").select("status").limit(1000);
    for (const r of (data ?? [])) counts[r.status] = (counts[r.status] ?? 0) + 1;
  } catch (_e) { /* best-effort */ }
  let pendingPublish = 0, publishedDrafts = 0;
  try {
    const { count: p } = await supabase.from("product_drafts").select("id", { count: "exact", head: true }).eq("status", "pending_publish");
    const { count: d } = await supabase.from("product_drafts").select("id", { count: "exact", head: true }).eq("status", "published");
    pendingPublish = p ?? 0; publishedDrafts = d ?? 0;
  } catch (_e) { /* best-effort */ }

  return json({ mode: "watchdog", healed: { requeuedFailed, unstuck }, jobs: counts, products: { pendingPublish, publishedDrafts }, at: nowIso });
});
