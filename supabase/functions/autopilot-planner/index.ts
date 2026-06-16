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

type Policy = {
  user_id: string;
  enabled: boolean;
  paused: boolean;
  allow_crm_sync: boolean;
  allow_draft_products: boolean;
  max_attempts: number;
  prospect_keywords: string;
};

const slot = (hours: number) => Math.floor(Date.now() / (hours * 60 * 60 * 1000));
const daySlot = () => new Date().toISOString().slice(0, 10);

type HermesRoute = { agent?: string; directive?: string; priority?: "now" | "next" | "hold" };

// Read the operator's most recent Hermes brief so the planner can let Hermes's
// reasoning drive which autonomous jobs to queue. Defensive: returns [] if no
// brief exists or the read fails, preserving the original fixed-plan behavior.
const loadHermesRoutes = async (
  supabase: ReturnType<typeof createClient>,
  userId: string,
): Promise<HermesRoute[]> => {
  const { data } = await supabase
    .from("agent_hermes_briefs")
    .select("agent_routes")
    .eq("owner_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const routes = (data as { agent_routes?: unknown } | null)?.agent_routes;
  return Array.isArray(routes) ? (routes as HermesRoute[]) : [];
};

// Hermes routes by display name (Maya/Marcus/Lena). "hold" means Hermes judged
// this agent low-leverage right now, so skip its optional autonomous job this cycle.
const routeFor = (routes: HermesRoute[], agentName: string) =>
  routes.find((r) => (r.agent ?? "").toLowerCase() === agentName.toLowerCase());
const isHeld = (route?: HermesRoute) => route?.priority === "hold";

const insertJob = async (
  supabase: ReturnType<typeof createClient>,
  policy: Policy,
  job: {
    agent: string;
    action_type: string;
    connector: "crm" | "outreach" | "storefront";
    risk_level: "low" | "medium";
    status?: "queued" | "awaiting_approval";
    requires_approval: boolean;
    idempotency_key: string;
    payload: Record<string, unknown>;
  },
) => {
  const { error } = await supabase.from("agent_automation_jobs").insert({
    owner_id: policy.user_id,
    agent: job.agent,
    action_type: job.action_type,
    connector: job.connector,
    risk_level: job.risk_level,
    status: job.status ?? "queued",
    requires_approval: job.requires_approval,
    run_after: new Date().toISOString(),
    max_attempts: policy.max_attempts,
    idempotency_key: job.idempotency_key,
    payload: job.payload,
  });

  if (error?.code === "23505") return { created: false, duplicate: true };
  if (error) return { created: false, error: error.message };

  await supabase.from("agent_automation_events").insert({
    owner_id: policy.user_id,
    event_type: "job_planned",
    detail: { connector: job.connector, actionType: job.action_type, idempotencyKey: job.idempotency_key },
  });
  return { created: true };
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const workerSecret = Deno.env.get("AUTOMATION_WORKER_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (req.method === "GET") {
    return json({ connector: "autopilot_planner", configured: Boolean(workerSecret && supabaseUrl && serviceKey) });
  }
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  if (!workerSecret || !supabaseUrl || !serviceKey) return json({ error: "Planner credentials are required" }, 503);

  const supabase = createClient(supabaseUrl, serviceKey);
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  const hasWorkerSecret = req.headers.get("x-automation-secret") === workerSecret;
  const { data: authData } = token ? await supabase.auth.getUser(token) : { data: { user: null } };
  const operatorUserId = authData.user?.id;

  if (!hasWorkerSecret && !operatorUserId) return json({ error: "Authorization or worker secret required" }, 401);

  let query = supabase
    .from("agent_automation_policies")
    .select("user_id,enabled,paused,allow_crm_sync,allow_draft_products,max_attempts,prospect_keywords")
    .eq("enabled", true)
    .eq("paused", false);

  if (!hasWorkerSecret && operatorUserId) query = query.eq("user_id", operatorUserId);

  const { data: policies, error } = await query.limit(50);
  if (error) return json({ error: "Could not load automation policies" }, 500);

  const planned: Array<Record<string, unknown>> = [];
  for (const policy of (policies ?? []) as Policy[]) {
    const crmSlot = slot(4);
    const routes = await loadHermesRoutes(supabase, policy.user_id);
    const mayaRoute = routeFor(routes, "Maya");
    const marcusRoute = routeFor(routes, "Marcus");
    const lenaRoute = routeFor(routes, "Lena");

    // Maya's CRM sync is autonomous unless Hermes parked her this cycle.
    if (policy.allow_crm_sync && !isHeld(mayaRoute)) {
      planned.push({
        connector: "crm",
        ...(await insertJob(supabase, policy, {
          agent: "Maya",
          action_type: "autopilot_crm_sync",
          connector: "crm",
          risk_level: "low",
          requires_approval: false,
          idempotency_key: `crm-sync:${policy.user_id}:${crmSlot}`,
          payload: { keywords: policy.prospect_keywords, limit: 5, hermesDirective: mayaRoute?.directive ?? null },
        })),
      });
    } else if (isHeld(mayaRoute)) {
      planned.push({ connector: "crm", skipped: true, reason: "hermes_hold" });
    }

    // Outreach draft is always prepared, but stays approval-gated before any send.
    planned.push({
      connector: "outreach",
      ...(await insertJob(supabase, policy, {
        agent: "Marcus",
        action_type: "prepare_outreach_draft",
        connector: "outreach",
        risk_level: "medium",
        status: "awaiting_approval",
        requires_approval: true,
        idempotency_key: `outreach-draft:${policy.user_id}:${crmSlot}`,
        payload: {
          campaign: "qualified-prospect-follow-up",
          note: "Draft only. Operator approval is required before Resend sends anything.",
          maxRecipients: 5,
          hermesDirective: marcusRoute?.directive ?? null,
          hermesPriority: marcusRoute?.priority ?? null,
        },
      })),
    });

    // Lena's draft product is autonomous unless Hermes parked her this cycle.
    if (policy.allow_draft_products && !isHeld(lenaRoute)) {
      planned.push({
        connector: "storefront",
        ...(await insertJob(supabase, policy, {
          agent: "Lena",
          action_type: "create_shopify_draft_product",
          connector: "storefront",
          risk_level: "low",
          requires_approval: false,
          idempotency_key: `storefront-draft:${policy.user_id}:${daySlot()}`,
          payload: {
            title: "Contractor Follow-Up Kit",
            descriptionHtml: "<p>AI-assisted follow-up templates and workflow checklist for home service contractors. Draft listing prepared by Operator OS.</p>",
            productType: "Digital product",
            vendor: "Operator OS",
            priceUsd: 29,
            hermesDirective: lenaRoute?.directive ?? null,
          },
        })),
      });
    } else if (isHeld(lenaRoute)) {
      planned.push({ connector: "storefront", skipped: true, reason: "hermes_hold" });
    }

    await supabase
      .from("agent_automation_policies")
      .update({ last_planned_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("user_id", policy.user_id);
  }

  const workerResponse = await fetch(`${supabaseUrl}/functions/v1/automation-worker`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-automation-secret": workerSecret },
    body: JSON.stringify({ source: "autopilot-planner" }),
  });
  const worker = await workerResponse.json().catch(() => ({}));

  return json({
    planned: planned.filter((item) => item.created).length,
    duplicates: planned.filter((item) => item.duplicate).length,
    errors: planned.filter((item) => item.error).length,
    skippedByHermes: planned.filter((item) => item.skipped).length,
    worker,
  });
});
