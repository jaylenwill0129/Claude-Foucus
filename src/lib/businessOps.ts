import { supabase } from "@/integrations/supabase/client";

export type ConnectorId = "crm" | "outreach" | "storefront" | "payments" | "fulfillment";
export type ConnectorStatus = "checking" | "ready" | "needs_configuration" | "not_deployed" | "unreachable";

export type BusinessAction = {
  id: string;
  agent: string;
  title: string;
  detail: string;
  connector: ConnectorId;
  payload: Record<string, unknown>;
};

export type Connector = {
  id: ConnectorId;
  name: string;
  purpose: string;
  endpoint?: string;
  status: ConnectorStatus;
  detail: string;
  nextStep: string;
};

export type RevenueSummary = {
  netRevenueCents: number;
  verifiedCustomers: number;
  verifiedEvents: number;
  lastEventAt?: string;
  available: boolean;
};

export type AutomationSummary = {
  authenticated: boolean;
  workerReady: boolean;
  plannerReady: boolean;
  enabled: boolean;
  paused: boolean;
  allowCrmSync: boolean;
  allowDraftProducts: boolean;
  activeJobs: number;
  awaitingApproval: number;
  succeededJobs: number;
  failedJobs: number;
  lastPlannedAt?: string;
};

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, "");
const functionUrl = (name: string) => supabaseUrl ? `${supabaseUrl}/functions/v1/${name}` : undefined;

const definitions: Record<ConnectorId, Omit<Connector, "status" | "detail">> = {
  crm: {
    id: "crm",
    name: "Prospect data & CRM",
    purpose: "Store qualified prospects and customer lifecycle evidence",
    endpoint: functionUrl("crm-prospect-sync"),
    nextStep: "Deploy crm-prospect-sync, then add APOLLO_API_KEY and HUBSPOT_ACCESS_TOKEN.",
  },
  outreach: {
    id: "outreach",
    name: "Resend outreach",
    purpose: "Send approved campaigns and collect provider receipts",
    endpoint: functionUrl("resend-outreach"),
    nextStep: "Deploy resend-outreach, then add RESEND_API_KEY and RESEND_FROM_EMAIL.",
  },
  storefront: {
    id: "storefront",
    name: "Shopify storefront",
    purpose: "Create approved draft offers before publication",
    endpoint: functionUrl("shopify-storefront"),
    nextStep: "Deploy shopify-storefront and add a scoped Shopify Admin API token.",
  },
  payments: {
    id: "payments",
    name: "Stripe revenue ledger",
    purpose: "Verify payments, refunds, fees, and payouts",
    endpoint: functionUrl("stripe-webhook"),
    nextStep: "Deploy stripe-webhook, apply the ledger migration, and register the Stripe webhook.",
  },
  fulfillment: {
    id: "fulfillment",
    name: "Google Drive fulfillment",
    purpose: "Store approved deliverables and fulfillment evidence",
    endpoint: functionUrl("google-drive-oauth"),
    nextStep: "Deploy Drive OAuth functions, add the client secret, and connect a fulfillment folder.",
  },
};

const authHeaders = async () => {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const probeFunction = async (connector: Connector): Promise<Connector> => {
  if (!connector.endpoint) return { ...connector, status: "not_deployed", detail: "No endpoint configured." };
  try {
    const response = await fetch(connector.endpoint, { headers: await authHeaders() });
    if (response.status === 404) return { ...connector, status: "not_deployed", detail: "Function is not deployed." };
    if (response.status === 401) return { ...connector, status: "needs_configuration", detail: "Function exists; sign in to verify its provider connection." };
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return { ...connector, status: "needs_configuration", detail: result.error ?? `Function returned HTTP ${response.status}.` };
    const connected = result.connected ?? result.configured;
    return {
      ...connector,
      status: connected ? "ready" : "needs_configuration",
      detail: connected ? "Provider connection verified." : "Function exists but provider credentials or user authorization are incomplete.",
    };
  } catch {
    return { ...connector, status: "unreachable", detail: "Could not reach the function." };
  }
};

export const getInitialConnectors = (): Connector[] =>
  (Object.keys(definitions) as ConnectorId[]).map((id) => ({ ...definitions[id], status: "checking", detail: "Waiting for live probe." }));

export const probeBusinessConnectors = async (): Promise<Connector[]> => {
  const ids = Object.keys(definitions) as ConnectorId[];
  return Promise.all(ids.map((id) => probeFunction({ ...definitions[id], status: "checking", detail: "Checking function." })));
};

export const loadRevenueSummary = async (): Promise<RevenueSummary> => {
  const { data, error } = await supabase.from("agent_revenue_summary" as never).select("*").maybeSingle();
  if (error || !data) return { netRevenueCents: 0, verifiedCustomers: 0, verifiedEvents: 0, available: false };
  const row = data as unknown as Record<string, unknown>;
  return {
    netRevenueCents: Number(row.net_revenue_cents ?? 0),
    verifiedCustomers: Number(row.verified_customers ?? 0),
    verifiedEvents: Number(row.verified_events ?? 0),
    lastEventAt: typeof row.last_event_at === "string" ? row.last_event_at : undefined,
    available: true,
  };
};

export const loadAutomationSummary = async (): Promise<AutomationSummary> => {
  const base: AutomationSummary = {
    authenticated: false,
    workerReady: false,
    plannerReady: false,
    enabled: false,
    paused: false,
    allowCrmSync: false,
    allowDraftProducts: false,
    activeJobs: 0,
    awaitingApproval: 0,
    succeededJobs: 0,
    failedJobs: 0,
  };
  const [sessionResult, workerResponse, plannerResponse] = await Promise.all([
    supabase.auth.getSession(),
    fetch(functionUrl("automation-worker") ?? "").catch(() => undefined),
    fetch(functionUrl("autopilot-planner") ?? "").catch(() => undefined),
  ]);
  const session = sessionResult.data.session;
  const workerHealth = await workerResponse?.json().catch(() => ({}));
  const plannerHealth = await plannerResponse?.json().catch(() => ({}));
  base.workerReady = Boolean(workerResponse?.ok && workerHealth?.configured);
  base.plannerReady = Boolean(plannerResponse?.ok && plannerHealth?.configured);
  if (!session?.user) return base;

  const [{ data: policy }, { data: summary }] = await Promise.all([
    supabase.from("agent_automation_policies" as never).select("enabled,paused,allow_crm_sync,allow_draft_products,last_planned_at").eq("user_id", session.user.id).maybeSingle(),
    supabase.from("agent_automation_summary" as never).select("*").eq("owner_id", session.user.id).maybeSingle(),
  ]);
  const policyRow = policy as unknown as Record<string, unknown> | null;
  const summaryRow = summary as unknown as Record<string, unknown> | null;
  return {
    authenticated: true,
    workerReady: base.workerReady,
    plannerReady: base.plannerReady,
    enabled: Boolean(policyRow?.enabled),
    paused: Boolean(policyRow?.paused),
    allowCrmSync: Boolean(policyRow?.allow_crm_sync),
    allowDraftProducts: Boolean(policyRow?.allow_draft_products),
    activeJobs: Number(summaryRow?.active_jobs ?? 0),
    awaitingApproval: Number(summaryRow?.awaiting_approval ?? 0),
    succeededJobs: Number(summaryRow?.succeeded_jobs ?? 0),
    failedJobs: Number(summaryRow?.failed_jobs ?? 0),
    lastPlannedAt: typeof policyRow?.last_planned_at === "string" ? policyRow.last_planned_at : undefined,
  };
};

export const setAutomationEnabled = async (enabled: boolean) => {
  const { data } = await supabase.auth.getSession();
  if (!data.session?.user) return { ok: false, message: "Sign in before changing automation policy." };
  const { error } = await supabase.from("agent_automation_policies" as never).upsert({
    user_id: data.session.user.id,
    enabled,
    paused: false,
    allow_crm_sync: true,
    allow_outreach: false,
    allow_draft_products: true,
    prospect_keywords: "home services contractors follow up",
  } as never, { onConflict: "user_id" });
  if (error) return { ok: false, message: error.message };
  if (!enabled) return { ok: true, message: "Autopilot disabled." };

  const plannerEndpoint = functionUrl("autopilot-planner");
  if (!plannerEndpoint) return { ok: true, message: "Autopilot armed. Planner endpoint is not configured locally." };

  const plannerResponse = await fetch(plannerEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ source: "operator-toggle" }),
  }).catch(() => undefined);
  if (!plannerResponse?.ok) return { ok: true, message: "Autopilot armed. Planner will run when the scheduler calls it." };
  const plannerResult = await plannerResponse.json().catch(() => ({}));
  return { ok: true, message: `Autopilot armed. Planned ${plannerResult.planned ?? 0} new jobs and started the worker.` };
};

export type HermesAgentRoute = { agent: string; directive: string; priority: "now" | "next" | "hold" };

export type HermesBrief = {
  mood: string;
  headline: string;
  bottleneck: string;
  route: string;
  intelligenceScore: number;
  confidence: number;
  displayUpgrade: string;
  reasoning: string;
  agentRoutes: HermesAgentRoute[];
};

export type HermesIntelligence = {
  source: "hermes-4" | "heuristic";
  brief: HermesBrief;
  model?: string;
  memoryDepth?: number;
  createdAt?: string;
  error?: string;
};

export type HermesWorldState = {
  connectors: Array<{ id: string; name: string; status: string; nextStep?: string }>;
  revenue: RevenueSummary;
  automation: AutomationSummary;
  agents: Array<{ id: string; name: string; role: string; connector: string; ready: boolean }>;
};

// Ask Hermes-4 (Nous Research) to reason over the live world state. The caller
// passes a deterministic fallback brief so the UI still works when the function
// is not deployed or the model is unreachable — Hermes upgrades the read, it is
// never a hard dependency for the page.
export const loadHermesBrief = async (
  state: HermesWorldState,
  fallback: HermesBrief,
): Promise<HermesIntelligence> => {
  const endpoint = functionUrl("hermes-intelligence");
  const headers = await authHeaders();
  if (!endpoint || !("Authorization" in headers)) {
    return { source: "heuristic", brief: fallback };
  }
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(state),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result?.brief) {
      return { source: "heuristic", brief: fallback, error: result?.error ?? `HTTP ${response.status}` };
    }
    return {
      source: "hermes-4",
      brief: { ...fallback, ...result.brief },
      model: result.model,
      memoryDepth: result.memoryDepth,
      createdAt: result.createdAt,
    };
  } catch {
    return { source: "heuristic", brief: fallback, error: "Hermes endpoint unreachable" };
  }
};

export type HermesHistoryEntry = {
  createdAt: string;
  mood: string;
  bottleneck: string;
  intelligenceScore: number;
  model: string;
};

// Recent Hermes briefs for the signed-in operator, newest first. Surfaces the
// memory loop in the UI: how the read, bottleneck, and IQ moved over time.
export const loadHermesHistory = async (limit = 8): Promise<HermesHistoryEntry[]> => {
  const { data } = await supabase.auth.getSession();
  if (!data.session?.user) return [];
  const { data: rows, error } = await supabase
    .from("agent_hermes_briefs" as never)
    .select("created_at,mood,bottleneck,intelligence_score,model")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error || !rows) return [];
  return (rows as unknown as Array<Record<string, unknown>>).map((row) => ({
    createdAt: String(row.created_at ?? ""),
    mood: String(row.mood ?? ""),
    bottleneck: String(row.bottleneck ?? ""),
    intelligenceScore: Number(row.intelligence_score ?? 0),
    model: String(row.model ?? ""),
  }));
};

export type CreativePackage = {
  title: string;
  trendCluster: { tags: string[]; rationale: string; reachToEffort: string };
  track: { genre: string; bpm: number; mood: string; structure: string; durationSec: number };
  visual: { concept: string; palette: string; motion: string };
  caption: string;
  hashtags: string[];
  reasoning: string;
};

export type CreativeCycleResult = {
  ok: boolean;
  message: string;
  pkg?: CreativePackage;
  pendingProviders?: string[];
};

// Run one cycle of Aria's creative preparation loop. Prepares concepts + caption
// only; publishing stays a separate, operator-approved action.
export const runCreativeCycle = async (input: { discoverTags?: string[]; seedTheme?: string } = {}): Promise<CreativeCycleResult> => {
  const endpoint = functionUrl("creative-studio");
  const headers = await authHeaders();
  if (!endpoint) return { ok: false, message: "Creative studio endpoint is not configured." };
  if (!("Authorization" in headers)) return { ok: false, message: "Sign in to run a creative cycle." };
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(input),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result?.package) {
      return { ok: false, message: result?.error ?? `Creative studio returned HTTP ${response.status}.` };
    }
    return { ok: true, message: "Prepared an approval-ready package. Publishing stays gated.", pkg: result.package, pendingProviders: result.pendingProviders ?? [] };
  } catch {
    return { ok: false, message: "Could not reach the creative studio." };
  }
};

export const executeBusinessAction = async (action: BusinessAction, connectors: Connector[]): Promise<{ ok: boolean; message: string }> => {
  const connector = connectors.find((item) => item.id === action.connector);
  if (!connector?.endpoint || connector.status !== "ready") {
    return { ok: false, message: `${connector?.name ?? action.connector} is not ready. ${connector?.nextStep ?? ""}`.trim() };
  }
  try {
    const response = await fetch(connector.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({
        actionId: action.id,
        approvedAt: new Date().toISOString(),
        agent: action.agent,
        action: action.title,
        payload: action.payload,
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, message: result.error ?? `${connector.name} rejected the action with HTTP ${response.status}.` };
    return { ok: true, message: `Accepted by ${connector.name}. Provider receipt recorded.` };
  } catch {
    return { ok: false, message: `${connector.name} could not be reached. No action was executed.` };
  }
};
