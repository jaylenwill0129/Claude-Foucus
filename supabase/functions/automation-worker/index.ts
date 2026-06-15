import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-automation-secret",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

type Job = {
  id: string;
  owner_id: string;
  agent: string;
  action_type: string;
  connector: "crm" | "outreach" | "storefront" | "fulfillment";
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
};

const functionByConnector = {
  crm: "crm-prospect-sync",
  outreach: "resend-outreach",
  storefront: "shopify-storefront",
  fulfillment: "google-drive-fulfillment",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const workerSecret = Deno.env.get("AUTOMATION_WORKER_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (req.method === "GET") {
    return json({ connector: "automation_worker", configured: Boolean(workerSecret && supabaseUrl && serviceKey) });
  }
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  if (!workerSecret || req.headers.get("x-automation-secret") !== workerSecret) return json({ error: "Invalid worker secret" }, 401);
  if (!supabaseUrl || !serviceKey) return json({ error: "Supabase service credentials are required" }, 503);

  const supabase = createClient(supabaseUrl, serviceKey);
  const { data: jobs, error } = await supabase
    .from("agent_automation_jobs")
    .select("id,owner_id,agent,action_type,connector,payload,attempts,max_attempts")
    .eq("status", "queued")
    .eq("requires_approval", false)
    .lte("run_after", new Date().toISOString())
    .order("created_at")
    .limit(10);
  if (error) return json({ error: "Could not load automation jobs" }, 500);

  const results: Array<Record<string, unknown>> = [];
  for (const job of (jobs ?? []) as Job[]) {
    const { data: policy } = await supabase
      .from("agent_automation_policies")
      .select("enabled,paused,allow_crm_sync,allow_outreach,allow_draft_products,max_outreach_recipients")
      .eq("user_id", job.owner_id)
      .maybeSingle();
    const recipients = Array.isArray(job.payload.to) ? job.payload.to.length : 0;
    const permitted = Boolean(
      policy?.enabled &&
      !policy.paused &&
      ((job.connector === "crm" && policy.allow_crm_sync) ||
        (job.connector === "outreach" && policy.allow_outreach && recipients > 0 && recipients <= policy.max_outreach_recipients) ||
        (job.connector === "storefront" && policy.allow_draft_products)),
    );
    if (!permitted) {
      await supabase.from("agent_automation_jobs").update({
        status: "awaiting_approval",
        requires_approval: true,
        last_error: "Automation policy requires operator approval",
        updated_at: new Date().toISOString(),
      }).eq("id", job.id);
      await supabase.from("agent_automation_events").insert({
        owner_id: job.owner_id,
        job_id: job.id,
        event_type: "job_approval_required",
        detail: { connector: job.connector },
      });
      results.push({ id: job.id, succeeded: false, awaitingApproval: true });
      continue;
    }

    const { data: claimed } = await supabase
      .from("agent_automation_jobs")
      .update({ status: "running", started_at: new Date().toISOString(), attempts: job.attempts + 1, updated_at: new Date().toISOString() })
      .eq("id", job.id)
      .eq("status", "queued")
      .select("id")
      .maybeSingle();
    if (!claimed) continue;

    const functionName = functionByConnector[job.connector];
    const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        actionId: job.id,
        approvedAt: new Date().toISOString(),
        agent: job.agent,
        action: job.action_type,
        payload: { ...job.payload, ownerId: job.owner_id },
      }),
    });
    const receipt = await response.json().catch(() => ({}));
    const succeeded = response.ok;
    const retry = !succeeded && job.attempts + 1 < job.max_attempts;
    await supabase.from("agent_automation_jobs").update({
      status: succeeded ? "succeeded" : retry ? "queued" : "failed",
      provider_receipt: succeeded ? receipt : null,
      last_error: succeeded ? null : String(receipt.error ?? `HTTP ${response.status}`),
      run_after: retry ? new Date(Date.now() + 5 * 60_000).toISOString() : new Date().toISOString(),
      finished_at: succeeded || !retry ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }).eq("id", job.id);
    await supabase.from("agent_automation_events").insert({
      owner_id: job.owner_id,
      job_id: job.id,
      event_type: succeeded ? "job_succeeded" : retry ? "job_retry_scheduled" : "job_failed",
      detail: { connector: job.connector, responseStatus: response.status },
    });
    results.push({ id: job.id, succeeded, retry });
  }

  return json({ processed: results.length, results });
});
