import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Cyrus's autonomous product engine. TOKEN-FREE: validates a winning product and
// QUEUES it into product_drafts (pending_publish). The 'cyrus-shopify-publisher'
// scheduled task drains the queue to the live store via the Shopify MCP OAuth
// connection — no shpat_ token. Scheduled via pg_cron 'autopublish-drafts' (0 */8).
// v9 adds a COMPLIANCE + COMPLETENESS gate so listings are not rejected by Shopify
// or a payment processor, plus premium, conversion-ready copy.

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-automation-secret" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const NOUS_BASE = (Deno.env.get("NOUS_API_BASE_URL")?.replace(/\/$/, "")) ?? "https://inference-api.nousresearch.com/v1";
const MODEL = Deno.env.get("HERMES_MODEL") ?? "nousresearch/hermes-4-70b";

async function hermesJson(system: string, user: string) {
  const key = Deno.env.get("NOUS_API_KEY");
  const r = await fetch(`${NOUS_BASE}/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: MODEL, messages: [{ role: "system", content: system }, { role: "user", content: user }], temperature: 0.4, max_tokens: 1500 }) });
  const raw = await r.json().catch(() => ({}));
  const txt = raw?.choices?.[0]?.message?.content ?? "";
  const m = txt.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const bodyt = (m ? m[1] : txt).trim();
  const first = bodyt.indexOf("{"), last = bodyt.lastIndexOf("}");
  try { return JSON.parse(first >= 0 && last > first ? bodyt.slice(first, last + 1) : bodyt); } catch { return null; }
}

const SYSTEM = "You are Cyrus, a top-performing AI Commerce Director running a TikTok-driven Shopify dropshipping brand. WINNING-PRODUCT TEST — only propose a product that passes ALL THREE traits: (1) TRENDING/VIRAL with real recent buzz, (2) UNIQUE WOW-FACTOR hard to find in local stores, (3) PROBLEM-SOLVING. Source cheaply on AliExpress. COMPETITIVE VALIDATION GATE: benchmark the BEST-RATED competitor (rating, reviews, price, strength); proceed only if you beat/match it on quality/value AND clear a healthy net margin after product cost + ad spend + fees. COMPLIANCE GATE (so the listing is NEVER rejected by Shopify or a payment processor): only propose products that are NOT restricted/prohibited (no weapons, vape/nicotine, CBD, adult, medical devices, supplements), NOT trademarked or brand-name knockoffs (generic brand only), and that make NO medical, health-cure, weight-loss, or income claims. Use ORIGINAL rewritten copy (never scraped manufacturer text). Keep price in a low-chargeback lane. COMPLETENESS (a complete listing converts AND passes review): descriptionHtml must be a professional, original listing containing, in order: a benefit-led intro <p>; a '<strong>What's included</strong>' list; a key '<strong>Features</strong>' list with concrete specs/materials; a '<strong>Shipping & Processing</strong>' line with an ACCURATE window (e.g. 'Processing 1-3 business days; delivery 7-12 business days') — never promise unrealistic 1-2 day shipping; a '<strong>Returns</strong>' line offering a 30-day return/refund; and a short satisfaction-guarantee line. Truthful claims only. Respond with ONLY a JSON object: {\"verdict\": \"proceed\" | \"reject\", \"reason\": string, \"title\": string, \"priceUsd\": number, \"sku\": string, \"productType\": string, \"descriptionHtml\": string, \"seoKeywords\": string[], \"winningTraits\": {\"trending\": boolean, \"wowFactor\": boolean, \"problemSolving\": boolean}, \"compliance\": {\"ok\": boolean, \"issues\": string[]}, \"shippingNote\": string, \"competitor\": {\"name\": string, \"rating\": number, \"reviewCount\": number, \"priceUsd\": number}, \"advantage\": string, \"estCogsUsd\": number, \"estNetMarginPct\": number}. Set verdict 'proceed' ONLY if all three winningTraits are true AND it beats/matches the best-rated competitor AND margin is healthy AND compliance.ok is true; otherwise 'reject'.";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const url = Deno.env.get("SUPABASE_URL");
  const svc = Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const nous = Deno.env.get("NOUS_API_KEY");
  if (req.method === "GET") return json({ connector: "autopublish", mode: "token_free_queue", configured: Boolean(url && svc && nous) });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  if (!url || !svc || !nous) return json({ error: "missing env (SUPABASE_URL, SUPABASE_SECRET_KEY, NOUS_API_KEY)" }, 503);

  const supabase = createClient(url, svc);
  const candidate = req.headers.get("x-automation-secret");
  const body = await req.json().catch(() => ({}));
  let ok = false, operatorOwner: string | null = null;
  if (candidate) { const { data } = await supabase.rpc("verify_automation_token", { candidate }); ok = data === true; }
  if (!ok) { const a = req.headers.get("Authorization"); if (a) { const { data: u } = await supabase.auth.getUser(a.replace(/^Bearer\s+/i, "")); if (u?.user) { ok = true; operatorOwner = u.user.id; } } }
  if (!ok) return json({ error: "automation token or operator session required" }, 401);

  const { data: pol } = await supabase.from("agent_automation_policies").select("user_id").eq("enabled", true).eq("paused", false).limit(1).maybeSingle();
  const owner = pol?.user_id ?? operatorOwner;
  const dryRun = body.dryRun === true;
  if (!owner && !dryRun) return json({ skipped: "autopilot not armed" });

  const recentTitles = new Set<string>();
  if (owner) {
    const { data: drafts } = await supabase.from("product_drafts").select("title").eq("owner_id", owner).order("created_at", { ascending: false }).limit(100);
    for (const d of (drafts ?? [])) recentTitles.add(String(d.title).toLowerCase());
  }

  const product = await hermesJson(SYSTEM, JSON.stringify({ task: "Propose ONE product that passes the WINNING-PRODUCT TEST, the competitive gate, and the COMPLIANCE + COMPLETENESS gate, to queue for publishing now.", avoidTitles: [...recentTitles].slice(0, 60) }));
  if (!product) return json({ error: "could not parse product from model" }, 502);
  const wt = product.winningTraits || {};
  const comp = product.compliance || {};
  if (product.verdict !== "proceed") return json({ outcome: "rejected_by_gate", reason: product.reason, winningTraits: wt, compliance: comp, competitor: product.competitor });
  if (!(wt.trending && wt.wowFactor && wt.problemSolving)) return json({ outcome: "rejected_by_gate", reason: "failed winning-product test (needs all 3: trending + wow-factor + problem-solving)", winningTraits: wt });
  if (comp.ok === false) return json({ outcome: "rejected_by_gate", reason: "compliance: " + ((comp.issues || []).join("; ") || "would risk Shopify/payment rejection"), compliance: comp });
  if (recentTitles.has(String(product.title || "").toLowerCase())) return json({ outcome: "skipped_duplicate", title: product.title });
  if (dryRun) return json({ outcome: "dry_run", product });

  const tags = ["autopublish", "tiktok viral", "dropship", ...((Array.isArray(product.seoKeywords) ? product.seoKeywords : []).slice(0, 8))];
  const { data: ins, error } = await supabase.from("product_drafts").insert({
    owner_id: owner, title: product.title, description_html: product.descriptionHtml ?? "", product_type: product.productType ?? "General",
    price_usd: Number(product.priceUsd) || 0, sku: product.sku ?? null, tags,
    competitor: product.competitor ?? {}, winning_traits: wt, advantage: product.advantage ?? null, est_net_margin_pct: Number(product.estNetMarginPct) || null,
    status: "pending_publish",
  }).select("id").maybeSingle();
  if (error) {
    if (String(error.message).includes("duplicate")) return json({ outcome: "skipped_duplicate", title: product.title });
    return json({ error: "could not queue product", detail: error.message }, 500);
  }
  return json({ outcome: "queued_for_publish", draftId: ins?.id, title: product.title, priceUsd: product.priceUsd, winningTraits: wt, compliance: comp, competitor: product.competitor, advantage: product.advantage });
});
