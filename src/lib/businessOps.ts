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
