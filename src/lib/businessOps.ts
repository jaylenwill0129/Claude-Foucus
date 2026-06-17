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
  track: { genre: string; bpm: number; mood: string; structure: string; durationSec: number; assetUrl?: string };
  visual: { concept: string; palette: string; motion: string; assetUrl?: string };
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

export type CreativePackageStatus = "awaiting_approval" | "approved" | "rejected" | "published";

export type CreativePackageRecord = CreativePackage & {
  id: string;
  status: CreativePackageStatus;
  pendingProviders: string[];
  createdAt: string;
  model: string;
};

// Operator's prepared creative packages, newest first. Read is RLS-scoped to the
// signed-in operator.
export const loadCreativePackages = async (limit = 10): Promise<CreativePackageRecord[]> => {
  const { data: sess } = await supabase.auth.getSession();
  if (!sess.session?.user) return [];
  const { data, error } = await supabase
    .from("agent_creative_packages" as never)
    .select("id,title,trend_cluster,track,visual,caption,hashtags,pending_providers,status,reasoning,model,created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return (data as unknown as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    title: String(row.title ?? ""),
    trendCluster: (row.trend_cluster as CreativePackage["trendCluster"]) ?? { tags: [], rationale: "", reachToEffort: "medium" },
    track: (row.track as CreativePackage["track"]) ?? { genre: "", bpm: 0, mood: "", structure: "", durationSec: 0 },
    visual: (row.visual as CreativePackage["visual"]) ?? { concept: "", palette: "", motion: "" },
    caption: String(row.caption ?? ""),
    hashtags: Array.isArray(row.hashtags) ? (row.hashtags as string[]) : [],
    reasoning: String(row.reasoning ?? ""),
    pendingProviders: Array.isArray(row.pending_providers) ? (row.pending_providers as string[]) : [],
    status: (row.status as CreativePackageStatus) ?? "awaiting_approval",
    model: String(row.model ?? ""),
    createdAt: String(row.created_at ?? ""),
  }));
};

// Operator decision on a prepared package. Approving marks it ready; it does NOT
// post anything — external publishing remains a separate gated action.
export const decideCreativePackage = async (id: string, status: "approved" | "rejected"): Promise<{ ok: boolean; message: string }> => {
  const { data: sess } = await supabase.auth.getSession();
  if (!sess.session?.user) return { ok: false, message: "Sign in to decide packages." };
  const { error } = await supabase
    .from("agent_creative_packages" as never)
    .update({ status, decided_at: new Date().toISOString() } as never)
    .eq("id", id);
  if (error) return { ok: false, message: error.message };
  return { ok: true, message: status === "approved" ? "Approved. Publishing stays a separate gated step." : "Rejected." };
};

export type ProspectRecord = {
  id: string;
  businessName: string;
  website: string | null;
  contactRoute: string | null;
  problemEvidence: string;
  offerFit: string;
  status: string;
  source: string;
  createdAt: string;
};

// Maya's qualified prospects, newest first. RLS-scoped to the operator.
export const loadProspects = async (limit = 25): Promise<ProspectRecord[]> => {
  const { data: sess } = await supabase.auth.getSession();
  if (!sess.session?.user) return [];
  const { data, error } = await supabase
    .from("agent_prospects" as never)
    .select("id,business_name,website,contact_route,problem_evidence,offer_fit,status,source,created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return (data as unknown as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    businessName: String(row.business_name ?? ""),
    website: typeof row.website === "string" ? row.website : null,
    contactRoute: typeof row.contact_route === "string" ? row.contact_route : null,
    problemEvidence: String(row.problem_evidence ?? ""),
    offerFit: String(row.offer_fit ?? ""),
    status: String(row.status ?? "qualified"),
    source: String(row.source ?? ""),
    createdAt: String(row.created_at ?? ""),
  }));
};

// Cyrus's brand-domain finder. Calls the public RDAP-backed domain-check
// function (no auth, no secret) and returns availability for a brand seed.
export type DomainResult = { domain: string; status: "available" | "taken" | "unknown" };
export type DomainCheck = { seed: string; results: DomainResult[]; available: string[]; recommendation: string | null };

export const findBrandDomains = async (seed: string): Promise<DomainCheck | { error: string }> => {
  const endpoint = functionUrl("domain-check");
  if (!endpoint) return { error: "Supabase URL not configured." };
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seed }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { error: body?.error ?? `Domain check returned HTTP ${res.status}.` };
    return body as DomainCheck;
  } catch {
    return { error: "Could not reach the domain finder." };
  }
};

// Dev's Google Drive fulfillment connection. GET reports provider + per-user
// state; POST returns a Google consent URL for the operator to authorize (the
// OAuth grant is the operator's own click, never automated).
export const loadGoogleDriveStatus = async (): Promise<{ configured: boolean; connected: boolean }> => {
  const endpoint = functionUrl("google-drive-oauth");
  if (!endpoint) return { configured: false, connected: false };
  try {
    const res = await fetch(endpoint, { headers: await authHeaders() });
    const body = await res.json().catch(() => ({}));
    return { configured: Boolean(body.configured), connected: Boolean(body.connected) };
  } catch {
    return { configured: false, connected: false };
  }
};

export const startGoogleDriveConnect = async (): Promise<{ url: string } | { error: string }> => {
  const endpoint = functionUrl("google-drive-oauth");
  if (!endpoint) return { error: "Supabase URL not configured." };
  const { data: sess } = await supabase.auth.getSession();
  if (!sess.session) return { error: "Sign in first to connect Drive." };
  try {
    const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.authorizationUrl) return { error: body?.error ?? `Connector returned HTTP ${res.status}.` };
    return { url: body.authorizationUrl as string };
  } catch {
    return { error: "Could not reach the Drive connector." };
  }
};

// Ledger's treasury view: real Stripe balance + recent payouts so the operator
// can see and withdraw money the agents earn. Read-only; withdrawing is done by
// the operator in Stripe (never automated).
export type Payout = { id: string; amountCents: number; currency: string; status: string; arrivalDate: number; method: string };
export type Treasury = {
  mode: "live" | "test";
  currency: string;
  availableCents: number;
  pendingCents: number;
  payouts: Payout[];
  withdrawUrl: string;
  note: string;
};

export const loadTreasury = async (): Promise<Treasury | { error: string }> => {
  const endpoint = functionUrl("stripe-balance");
  if (!endpoint) return { error: "Supabase URL not configured." };
  const { data: sess } = await supabase.auth.getSession();
  if (!sess.session) return { error: "Sign in to view the treasury." };
  try {
    const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { error: body?.error ?? `Treasury returned HTTP ${res.status}.` };
    return body as Treasury;
  } catch {
    return { error: "Could not reach the treasury." };
  }
};

export type KnowledgeEntry = {
  id: string;
  agent: string;
  audience: string;
  kind: string;
  topic: string;
  insight: string;
  confidence: number;
  createdAt: string;
};

// The shared learning bus: what the agents have learned and broadcast to each
// other (Maya's research digests, outcomes, signals). RLS-scoped to the operator.
export const loadAgentKnowledge = async (limit = 12): Promise<KnowledgeEntry[]> => {
  const { data: sess } = await supabase.auth.getSession();
  if (!sess.session?.user) return [];
  const { data, error } = await supabase
    .from("agent_knowledge" as never)
    .select("id,agent,audience,kind,topic,insight,confidence,created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return (data as unknown as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    agent: String(row.agent ?? ""),
    audience: String(row.audience ?? "all"),
    kind: String(row.kind ?? "insight"),
    topic: String(row.topic ?? ""),
    insight: String(row.insight ?? ""),
    confidence: Number(row.confidence ?? 0),
    createdAt: String(row.created_at ?? ""),
  }));
};

export type SystemHealth = { id: string; name: string; ok: boolean; detail: string };

// Probe the core (no-JWT) edge functions' GET health so the world can show which
// subsystems are truly green. These endpoints return { configured: bool }.
export const loadSystemsHealth = async (): Promise<SystemHealth[]> => {
  const systems: Array<{ id: string; name: string; fn: string }> = [
    { id: "hermes", name: "Hermes-4 brain", fn: "hermes-intelligence" },
    { id: "studio", name: "Signal Studio", fn: "creative-studio" },
    { id: "planner", name: "Autopilot planner", fn: "autopilot-planner" },
    { id: "worker", name: "Automation worker", fn: "automation-worker" },
    { id: "orchestrator", name: "Agent brain", fn: "agent-orchestrator" },
  ];
  return Promise.all(systems.map(async (s) => {
    const url = functionUrl(s.fn);
    if (!url) return { id: s.id, name: s.name, ok: false, detail: "No endpoint configured." };
    try {
      const r = await fetch(url);
      const body = await r.json().catch(() => ({}));
      const ok = Boolean(body?.configured);
      return { id: s.id, name: s.name, ok, detail: ok ? "Online" : "Deployed; needs a secret." };
    } catch {
      return { id: s.id, name: s.name, ok: false, detail: "Unreachable." };
    }
  }));
};

export type AutomationJobStatus = "queued" | "awaiting_approval" | "running" | "succeeded" | "failed" | "cancelled";

export type AutomationJob = {
  id: string;
  agent: string;
  actionType: string;
  connector: string;
  status: AutomationJobStatus;
  riskLevel: string;
  requiresApproval: boolean;
  directive: string | null;
  note: string | null;
  lastError: string | null;
  createdAt: string;
};

// The operator's automation jobs (planner output), newest first. RLS-scoped.
export const loadAutomationJobs = async (limit = 25): Promise<AutomationJob[]> => {
  const { data: sess } = await supabase.auth.getSession();
  if (!sess.session?.user) return [];
  const { data, error } = await supabase
    .from("agent_automation_jobs" as never)
    .select("id,agent,action_type,connector,status,risk_level,requires_approval,payload,last_error,created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return (data as unknown as Array<Record<string, unknown>>).map((row) => {
    const payload = (row.payload as Record<string, unknown>) ?? {};
    return {
      id: String(row.id),
      agent: String(row.agent ?? ""),
      actionType: String(row.action_type ?? ""),
      connector: String(row.connector ?? ""),
      status: (row.status as AutomationJobStatus) ?? "queued",
      riskLevel: String(row.risk_level ?? "low"),
      requiresApproval: Boolean(row.requires_approval),
      directive: typeof payload.hermesDirective === "string" ? payload.hermesDirective : null,
      note: typeof payload.note === "string" ? payload.note : null,
      lastError: typeof row.last_error === "string" ? row.last_error : null,
      createdAt: String(row.created_at ?? ""),
    };
  });
};

// Operator decision on a queued/awaiting job. Approving releases it to the worker
// (status=queued, requires_approval=false); the worker still enforces final policy
// before any external send. Rejecting cancels it. No external side effect here.
export const decideAutomationJob = async (id: string, decision: "approved" | "rejected"): Promise<{ ok: boolean; message: string }> => {
  const { data: sess } = await supabase.auth.getSession();
  const userId = sess.session?.user?.id;
  if (!userId) return { ok: false, message: "Sign in to decide jobs." };
  const patch = decision === "approved"
    ? { status: "queued", requires_approval: false, approved_at: new Date().toISOString(), approved_by: userId, updated_at: new Date().toISOString() }
    : { status: "cancelled", updated_at: new Date().toISOString() };
  const { error } = await supabase.from("agent_automation_jobs" as never).update(patch as never).eq("id", id);
  if (error) return { ok: false, message: error.message };
  return { ok: true, message: decision === "approved" ? "Approved. Released to the worker (final policy still applies before any send)." : "Rejected." };
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
