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
  phone?: string;
  firstName?: string;
  lastName?: string;
  title?: string;
  problemEvidence?: string;
  offerFit?: string;
  source?: string;
  sourceRecordId?: string;
};

const config = () => ({
  apolloKey: Deno.env.get("APOLLO_API_KEY"),
  hubspotToken: Deno.env.get("HUBSPOT_ACCESS_TOKEN"),
  supabaseUrl: Deno.env.get("SUPABASE_URL"),
  supabaseSecret: Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
});

// --- Source 1: OpenStreetMap Overpass (free, no key, no plan limit) -----------
// Returns real local businesses in a category + area, with name/website/phone.
// This is Maya's reliable default source.
const DEFAULT_BBOX = "30.10,-97.95,30.52,-97.56"; // Austin, TX metro (south,west,north,east)
const DEFAULT_CRAFTS = "plumber|electrician|hvac|roofer|carpenter|painter|gardener";

const fetchOsmProspects = async (payload: Record<string, unknown>): Promise<{ prospects: Prospect[]; status: number; error?: unknown }> => {
  const limit = Math.min(Math.max(Number(payload.limit ?? 5), 1), 25);
  const bbox = typeof payload.bbox === "string" ? payload.bbox : DEFAULT_BBOX;
  const crafts = typeof payload.crafts === "string" ? payload.crafts : DEFAULT_CRAFTS;
  const query = `[out:json][timeout:25];(node["craft"~"${crafts}"]["name"](${bbox});node["shop"~"${crafts}"]["name"](${bbox}););out tags 60;`;

  try {
    const response = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(query)}`,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return { prospects: [], status: response.status, error: result };
    const elements = Array.isArray(result.elements) ? result.elements : [];
    const prospects: Prospect[] = elements
      .filter((el: Record<string, unknown>) => (el.tags as Record<string, string>)?.name)
      .map((el: Record<string, unknown>) => {
        const tags = el.tags as Record<string, string>;
        const website = tags.website ?? tags["contact:website"];
        const phone = tags.phone ?? tags["contact:phone"];
        const domain = website ? safeHost(website) : undefined;
        return {
          businessName: tags.name,
          website,
          phone,
          title: tags.craft ? `${tags.craft} contractor` : "Owner",
          problemEvidence: website
            ? `Live site (${domain ?? website}). Audit for online booking, lead-capture, and follow-up automation gaps.`
            : "No website on file in OSM — strong fit for a booking + follow-up presence.",
          offerFit: "Home-services follow-up kit fit. Operator review required before outreach.",
          source: "osm_overpass",
          sourceRecordId: `osm:${el.type}/${el.id}`,
        };
      })
      .slice(0, limit);
    return { prospects, status: 200 };
  } catch (error) {
    return { prospects: [], status: 502, error: error instanceof Error ? error.message : "Overpass unreachable" };
  }
};

const safeHost = (url: string) => {
  try { return new URL(url.startsWith("http") ? url : `https://${url}`).hostname; } catch { return undefined; }
};

// --- Source 2: Apollo (optional; requires a paid plan for People Search) ------
const normalizeApolloPerson = (person: Record<string, unknown>): Prospect => {
  const organization = (person.organization ?? person.account ?? {}) as Record<string, unknown>;
  const email = typeof person.email === "string" && !person.email.includes("email_not_unlocked") ? person.email : undefined;
  return {
    businessName: String(organization.name ?? person.organization_name ?? "Unknown business"),
    website: typeof organization.website_url === "string" ? organization.website_url : undefined,
    email,
    firstName: typeof person.first_name === "string" ? person.first_name : undefined,
    lastName: typeof person.last_name === "string" ? person.last_name : undefined,
    title: typeof person.title === "string" ? person.title : undefined,
    problemEvidence: `Apollo prospect match${person.title ? `: ${person.title}` : ""}`,
    offerFit: "Needs operator review before outreach.",
    source: "apollo",
    sourceRecordId: typeof person.id === "string" ? person.id : crypto.randomUUID(),
  };
};

const fetchApolloProspects = async (apolloKey: string, payload: Record<string, unknown>): Promise<{ prospects: Prospect[]; status: number; error?: unknown }> => {
  const limit = Math.min(Math.max(Number(payload.limit ?? 5), 1), 10);
  const response = await fetch("https://api.apollo.io/api/v1/mixed_people/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Cache-Control": "no-cache", "X-Api-Key": apolloKey },
    body: JSON.stringify({
      q_keywords: payload.keywords ?? "home services contractors",
      person_titles: Array.isArray(payload.titles) ? payload.titles : ["Owner", "Founder", "Operations Manager"],
      organization_locations: Array.isArray(payload.locations) ? payload.locations : ["United States"],
      page: 1,
      per_page: limit,
    }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) return { prospects: [], status: response.status, error: result };
  const people = Array.isArray(result.people) ? result.people : Array.isArray(result.contacts) ? result.contacts : [];
  return { prospects: people.map(normalizeApolloPerson).slice(0, limit), status: 200 };
};

const upsertHubSpot = async (token: string, prospect: Prospect) => {
  const websiteUrl = prospect.website?.startsWith("http") ? prospect.website : prospect.website ? `https://${prospect.website}` : undefined;
  const domain = websiteUrl ? safeHost(websiteUrl) : undefined;
  const company = await fetch("https://api.hubapi.com/crm/v3/objects/companies", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ properties: { name: prospect.businessName ?? "Unknown business", domain, phone: prospect.phone } }),
  });
  return await company.json().catch(() => ({}));
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const settings = config();
  if (req.method === "GET") {
    // Configured as long as we can persist. OSM source needs no key, so Maya
    // works even without Apollo/HubSpot.
    return json({
      connector: "prospect_research",
      configured: Boolean(settings.supabaseUrl && settings.supabaseSecret),
      sources: { osm: true, apollo: Boolean(settings.apolloKey), hubspot: Boolean(settings.hubspotToken) },
    });
  }
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  if (!settings.supabaseUrl || !settings.supabaseSecret) {
    return json({ error: "SUPABASE_URL and SUPABASE_SECRET_KEY are required" }, 503);
  }

  const authorization = req.headers.get("Authorization");
  if (!authorization) return json({ error: "Authorization required" }, 401);
  const supabase = createClient(settings.supabaseUrl, settings.supabaseSecret);
  const body = await req.json();
  if (!body.actionId || !body.approvedAt) return json({ error: "Operator approval receipt required" }, 400);

  const token = authorization.replace(/^Bearer\s+/i, "");
  const { data: userData } = await supabase.auth.getUser(token);
  const serviceWorkerOwnerId = token === settings.supabaseSecret && typeof body.payload?.ownerId === "string" ? body.payload.ownerId : undefined;
  const ownerId = userData.user?.id ?? serviceWorkerOwnerId;
  if (!ownerId) return json({ error: "Invalid user session or worker owner id" }, 401);

  const payload = (body.payload ?? {}) as Record<string, unknown>;
  // Source selection: explicit prospects > Apollo (if requested + key) > OSM default.
  let prospects: Prospect[];
  let sourceUsed = "osm_overpass";
  let sourceNote: string | undefined;
  if (Array.isArray(payload.prospects)) {
    prospects = payload.prospects as Prospect[];
    sourceUsed = "operator";
  } else if (payload.source === "apollo" && settings.apolloKey) {
    const apollo = await fetchApolloProspects(settings.apolloKey, payload);
    if (apollo.prospects.length) { prospects = apollo.prospects; sourceUsed = "apollo"; }
    else { const osm = await fetchOsmProspects(payload); prospects = osm.prospects; sourceNote = "Apollo returned none/blocked; fell back to OSM."; }
  } else {
    const osm = await fetchOsmProspects(payload);
    prospects = osm.prospects;
    if (osm.error) sourceNote = "OSM Overpass error.";
  }

  if (!prospects.length) return json({ error: "No prospects were available to sync", sourceNote }, 400);

  const receipts = [];
  for (const prospect of prospects.slice(0, 15)) {
    if (!prospect.businessName) continue;
    const hubspotReceipt = settings.hubspotToken ? await upsertHubSpot(settings.hubspotToken, prospect) : null;
    await supabase.from("agent_prospects").upsert({
      owner_id: ownerId,
      business_name: prospect.businessName,
      website: prospect.website ?? null,
      contact_route: prospect.email ?? prospect.phone ?? prospect.website ?? null,
      problem_evidence: prospect.problemEvidence ?? "Prospect research evidence",
      offer_fit: prospect.offerFit ?? "Needs operator review before outreach.",
      status: "qualified",
      source: prospect.source ?? sourceUsed,
      source_record_id: prospect.sourceRecordId ?? crypto.randomUUID(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "owner_id,source,source_record_id" });
    receipts.push({ prospect: prospect.businessName, website: prospect.website ?? null, hubspot: Boolean(hubspotReceipt) });
  }

  // Maya broadcasts a research digest to the shared learning bus so Marcus,
  // Lena, and Ledger can consume the data efficiently.
  if (receipts.length) {
    await supabase.from("agent_knowledge").insert({
      owner_id: ownerId,
      agent: "Maya",
      audience: "all",
      kind: "research_digest",
      topic: `${sourceUsed} prospect run`,
      insight: `Synced ${receipts.length} qualified prospects via ${sourceUsed}. Marcus: use these for outreach drafts. Lena: shape an offer around their shared pain. Ledger: model pricing and refund risk.`,
      data: { source: sourceUsed, count: receipts.length, businesses: receipts.map((r) => r.prospect).slice(0, 15) },
      confidence: 0.6,
    });
  }

  return json({ accepted: true, source: sourceUsed, sourceNote, synced: receipts.length, receipts });
});
