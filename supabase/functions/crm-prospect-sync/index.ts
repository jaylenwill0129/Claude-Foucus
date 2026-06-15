import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

type Prospect = {
  businessName?: string;
  website?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  title?: string;
  problemEvidence?: string;
  offerFit?: string;
  sourceRecordId?: string;
};

const config = () => ({
  apolloKey: Deno.env.get("APOLLO_API_KEY"),
  hubspotToken: Deno.env.get("HUBSPOT_ACCESS_TOKEN"),
  supabaseUrl: Deno.env.get("SUPABASE_URL"),
  supabaseSecret: Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
});

const hubspot = async (path: string, token: string, init: RequestInit = {}) => {
  const response = await fetch(`https://api.hubapi.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
};

const normalizeApolloPerson = (person: Record<string, unknown>): Prospect => {
  const organization = (person.organization ?? person.account ?? {}) as Record<string, unknown>;
  const businessName = String(organization.name ?? person.organization_name ?? "Unknown business");
  const email = typeof person.email === "string" && !person.email.includes("email_not_unlocked") ? person.email : undefined;
  return {
    businessName,
    website: typeof organization.website_url === "string" ? organization.website_url : undefined,
    email,
    firstName: typeof person.first_name === "string" ? person.first_name : undefined,
    lastName: typeof person.last_name === "string" ? person.last_name : undefined,
    title: typeof person.title === "string" ? person.title : undefined,
    problemEvidence: `Apollo prospect match${person.title ? `: ${person.title}` : ""}`,
    offerFit: "Needs operator review before outreach.",
    sourceRecordId: typeof person.id === "string" ? person.id : crypto.randomUUID(),
  };
};

const fetchApolloProspects = async (apolloKey: string, payload: Record<string, unknown>) => {
  const limit = Math.min(Math.max(Number(payload.limit ?? 5), 1), 10);
  const body = {
    q_keywords: payload.keywords ?? "home services contractors follow up",
    person_titles: Array.isArray(payload.titles) ? payload.titles : ["Owner", "Founder", "Operations Manager"],
    organization_locations: Array.isArray(payload.locations) ? payload.locations : ["United States"],
    page: 1,
    per_page: limit,
  };
  const response = await fetch("https://api.apollo.io/api/v1/mixed_people/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Cache-Control": "no-cache", "X-Api-Key": apolloKey },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) return { error: result, prospects: [] as Prospect[], status: response.status };
  const people = Array.isArray(result.people) ? result.people : Array.isArray(result.contacts) ? result.contacts : [];
  return { prospects: people.map(normalizeApolloPerson).slice(0, limit), status: response.status };
};

const upsertHubSpot = async (token: string, prospect: Prospect) => {
  const companyName = prospect.businessName ?? "Unknown business";
  const websiteUrl = prospect.website?.startsWith("http") ? prospect.website : prospect.website ? `https://${prospect.website}` : undefined;
  const domain = websiteUrl ? new URL(websiteUrl).hostname : undefined;
  let companyReceipt: Record<string, unknown> | null = null;
  const company = await hubspot("/crm/v3/objects/companies", token, {
    method: "POST",
    body: JSON.stringify({ properties: { name: companyName, domain } }),
  });
  companyReceipt = company.body;

  let contactReceipt: Record<string, unknown> | null = null;
  if (prospect.email) {
    const contact = await hubspot("/crm/v3/objects/contacts", token, {
      method: "POST",
      body: JSON.stringify({
        properties: {
          email: prospect.email,
          firstname: prospect.firstName,
          lastname: prospect.lastName,
          jobtitle: prospect.title,
          company: companyName,
          website: prospect.website,
          hs_lead_status: "NEW",
        },
      }),
    });
    contactReceipt = contact.body;
  }

  return { company: companyReceipt, contact: contactReceipt };
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const settings = config();
  if (req.method === "GET") {
    return json({
      connector: "apollo_hubspot_crm",
      configured: Boolean(settings.apolloKey && settings.hubspotToken && settings.supabaseUrl && settings.supabaseSecret),
      apolloConfigured: Boolean(settings.apolloKey),
      hubspotConfigured: Boolean(settings.hubspotToken),
    });
  }
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  if (!settings.apolloKey || !settings.hubspotToken || !settings.supabaseUrl || !settings.supabaseSecret) {
    return json({ error: "APOLLO_API_KEY, HUBSPOT_ACCESS_TOKEN, SUPABASE_URL, and SUPABASE_SECRET_KEY are required" }, 503);
  }

  const authorization = req.headers.get("Authorization");
  if (!authorization) return json({ error: "Authorization required" }, 401);
  const supabase = createClient(settings.supabaseUrl, settings.supabaseSecret);
  const body = await req.json();
  if (!body.actionId || !body.approvedAt) return json({ error: "Operator approval receipt required" }, 400);

  const token = authorization.replace(/^Bearer\s+/i, "");
  const { data: userData } = await supabase.auth.getUser(token);
  const serviceWorkerOwnerId = token === settings.supabaseSecret && typeof body.payload?.ownerId === "string"
    ? body.payload.ownerId
    : undefined;
  const ownerId = userData.user?.id ?? serviceWorkerOwnerId;
  if (!ownerId) return json({ error: "Invalid user session or worker owner id" }, 401);

  const prospects = Array.isArray(body.payload?.prospects)
    ? body.payload.prospects as Prospect[]
    : body.payload?.prospect
      ? [body.payload.prospect as Prospect]
      : (await fetchApolloProspects(settings.apolloKey, body.payload ?? {})).prospects;

  if (!prospects.length) return json({ error: "No prospects were available to sync" }, 400);

  const receipts = [];
  for (const prospect of prospects.slice(0, 10)) {
    if (!prospect.businessName) continue;
    const receipt = await upsertHubSpot(settings.hubspotToken, prospect);
    await supabase.from("agent_prospects").upsert({
      owner_id: ownerId,
      business_name: prospect.businessName,
      website: prospect.website ?? null,
      contact_route: prospect.email ?? null,
      problem_evidence: prospect.problemEvidence ?? "Apollo/HubSpot CRM sync evidence",
      offer_fit: prospect.offerFit ?? "Needs operator review before outreach.",
      status: "qualified",
      source: "apollo_hubspot",
      source_record_id: prospect.sourceRecordId ?? crypto.randomUUID(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "owner_id,source,source_record_id" });
    receipts.push({ prospect: prospect.businessName, receipt });
  }

  return json({ accepted: true, provider: "apollo_hubspot", synced: receipts.length, receipts });
});
