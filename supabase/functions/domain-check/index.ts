// Brand-domain finder for Cyrus (commerce). Checks real domain availability via
// RDAP — public registration data, no API key, no secret. Suggests brandable
// variants for a dropshipping brand. Read-only lookups; actually registering a
// domain stays an operator-gated action elsewhere.
//
// Deployed via the Supabase MCP (verify_jwt=false).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const sanitize = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 30);

// Per-TLD authoritative RDAP base where known (more reliable than the rdap.org
// aggregator under load); fall back to rdap.org for the rest.
const RDAP_BASE: Record<string, string> = {
  com: "https://rdap.verisign.com/com/v1/domain/",
  net: "https://rdap.verisign.com/net/v1/domain/",
};
const rdapUrl = (domain: string) => {
  const tld = domain.split(".").pop()!;
  return (RDAP_BASE[tld] ?? "https://rdap.org/domain/") + domain;
};

// 404 = no registration found = available. 200 = registered. Else = unknown.
async function checkOne(domain: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(rdapUrl(domain), { signal: controller.signal, redirect: "follow", headers: { "Accept": "application/rdap+json" } });
    if (res.status === 404) return { domain, status: "available" };
    if (res.status === 200) return { domain, status: "taken" };
    return { domain, status: "unknown" };
  } catch {
    return { domain, status: "unknown" };
  } finally {
    clearTimeout(timer);
  }
}

function candidates(seed: string) {
  const s = sanitize(seed);
  if (!s) return [];
  const list = [`${s}.com`, `${s}.co`, `${s}.shop`, `${s}.store`, `${s}.io`, `get${s}.com`, `try${s}.com`, `${s}hq.com`];
  return [...new Set(list)].slice(0, 8);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method === "GET") return json({ connector: "domain_check", configured: true, source: "rdap" });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  const body = await req.json().catch(() => ({}));
  const seed = sanitize(body.seed);
  if (!seed) return json({ error: "seed (a brand/product word) is required" }, 400);

  // Serialize with a small gap so the RDAP servers don't throttle a burst.
  const results = [];
  for (const d of candidates(seed)) {
    results.push(await checkOne(d));
    await sleep(120);
  }
  const available = results.filter((r) => r.status === "available").map((r) => r.domain);
  return json({ seed, results, available, recommendation: available[0] ?? null });
});
