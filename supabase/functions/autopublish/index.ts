import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Cyrus's autonomous product engine. TOKEN-FREE: validates a winning product and
// QUEUES it into product_drafts (status pending_publish). The 'cyrus-shopify-
// publisher' scheduled task drains the queue to the live store via the Shopify MCP
// OAuth connection — no shpat_ Admin API token required anywhere.
// Scheduled via pg_cron 'autopublish-drafts' (0 */8 * * *).

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-automation-secret" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const NOUS_BASE = (Deno.env.get("NOUS_API_BASE_URL")?.replace(/\/$/, "")) ?? "https://inference-api.nousresearch.com/v1";
const MODEL = Deno.env.get("HERMES_MODEL") ?? "nousresearch/hermes-4-70b";

async function hermesJson(system: string, user: string) {
  const key = Deno.env.get("NOUS_API_KEY");
  const r = await fetch(`${NOUS_BASE}/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: MODEL, messages: [{ role: "system", content: system }, { role: "user", content: user }], temperature: 0.4, max_tokens: 1300 }) });
  const raw = await r.json().catch(() => ({}));
  const txt = raw?.choices?.[0]?.message?.content ?? "";
  const m = txt.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const bodyt = (m ? m[1] : txt).trim();
  const first = bodyt.indexOf("{"), last = bodyt.lastIndexOf("}");
  try { return JSON.parse(first >= 0 && last > first ? bodyt.slice(first, last + 1) : bodyt); } catch { return null; }
}

const SYSTEM = "You are Cyrus, a top-performing AI Commerce Director running a TikTok-driven Shopify dropshipping brand. WINNING-PRODUCT TEST — only propose a product that passes ALL THREE traits: (1) TRENDING/VIRAL with real recent buzz on TikTok/Facebook, (2) UNIQUE WOW-FACTOR that is hard to find in local brick-and-mortar stores, (3) PROBLEM-SOLVING — it fixes a real problem or insecurity. Source it cheaply on AliExpress. COMPETITIVE VALIDATION GATE: benchmark the candidate against the BEST-RATED competing product already on the market (its rating, review volume, price, key strength). Only proceed if your product can BEAT or MATCH the market leader on quality/value AND clear a healthy net margin after product cost + ad spend + fees — a product worse than what's already selling will not get bought, so reject it. Write a KEYWORD-RICH, SEO-optimized title and descriptionHtml: weave in every relevant buyer keyword naturally, lead with the benefit, frame the product 'in use' (lifestyle), and keep all claims truthful — never misleading. Be honest and evidence-based; no fabricated numbers or income claims. Respond with ONLY a JSON object (no prose): {\"verdict\": \"proceed\" | \"reject\", \"reason\": string, \"title\": string, \"priceUsd\": number, \"sku\": string, \"productType\": string, \"descriptionHtml\": string, \"seoKeywords\": string[], \"winningTraits\": {\"trending\": boolean, \"wowFactor\": boolean, \"problemSolving\": boolean}, \"competitor\": {\"name\": string, \"rating\": number, \"reviewCount\": number, \"priceUsd\": number}, \"advantage\": string, \"estCogsUsd\": number, \"estNetMarginPct\": number}. Set verdict 'proceed' ONLY when ALL three winningTraits are true AND the product beats/matches the best-rated competitor AND margin is healthy; otherwise 'reject'.";

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

  // Dedupe against titles already queued/published for this owner.
  const recentTitles = new Set<string>();
  if (owner) {
    const { data: drafts } = await supabase.from("product_drafts").select("title").eq("owner_id", owner).order("created_at", { ascending: false }).limit(100);
    for (const d of (drafts ?? [])) recentTitles.add(String(d.title).toLowerCase());
  }

  const product = await hermesJson(SYSTEM, JSON.stringify({ task: "Propose ONE product that passes the WINNING-PRODUCT TEST and the competitive-validation gate, to queue for publishing now.", avoidTitles: [...recentTitles].slice(0, 60) }));
  if (!product) return json({ error: "could not parse product from model" }, 502);
  const wt = product.winningTraits || {};
  if (product.verdict !== "proceed") return json({ outcome: "rejected_by_gate", reason: product.reason, winningTraits: wt, competitor: product.competitor });
  if (!(wt.trending && wt.wowFactor && wt.problemSolving)) return json({ outcome: "rejected_by_gate", reason: "failed winning-product test (needs all 3: trending + wow-factor + problem-solving)", winningTraits: wt });
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
  return json({ outcome: "queued_for_publish", draftId: ins?.id, title: product.title, priceUsd: product.priceUsd, winningTraits: wt, competitor: product.competitor, advantage: product.advantage });
});
