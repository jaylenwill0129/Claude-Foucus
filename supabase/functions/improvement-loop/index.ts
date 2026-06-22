import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Continuous improvement (kaizen) loop. Cron-driven ('improvement-loop', 15 */4),
// vault-token gated, Hermes-powered — runs 24/7 server-side regardless of any app
// being open. Each run has agents proactively reflect on their recent learnings +
// benchmark + real data and produce ONE concrete improvement to efficiency,
// profitability, or product quality, written back to the shared knowledge bus
// (where reinforcement compounds it and decay prunes the rest). Commerce
// (revenue/product) is improved every run; one other agent rotates in.

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-automation-secret" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const NOUS_BASE = (Deno.env.get("NOUS_API_BASE_URL")?.replace(/\/$/, "")) ?? "https://inference-api.nousresearch.com/v1";
function cleanModel(v: string | undefined) {
  let m = String(v || "").trim();
  if (!m) return "nousresearch/hermes-4-70b";
  // Repair a value accidentally saved with a filesystem path prefix.
  if (m.includes("/Users/") || m.startsWith("/") || m.split("/").length > 2) { const p = m.split("/").filter(Boolean); m = p.slice(-2).join("/"); }
  return m || "nousresearch/hermes-4-70b";
}
const MODEL = cleanModel(Deno.env.get("HERMES_MODEL"));

async function hermes(system: string, user: string) {
  const key = Deno.env.get("NOUS_API_KEY");
  const r = await fetch(`${NOUS_BASE}/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: MODEL, messages: [{ role: "system", content: system }, { role: "user", content: user }], temperature: 0.5, max_tokens: 700 }) });
  const raw = await r.json().catch(() => ({}));
  return raw?.choices?.[0]?.message?.content ?? "";
}

const tokenize = (s: string) => String(s).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length >= 3);
function jaccard(a: string, b: string) { const A = new Set(tokenize(a)), B = new Set(tokenize(b)); if (!A.size || !B.size) return 0; let i = 0; for (const t of A) if (B.has(t)) i++; return i / (A.size + B.size - i); }
function extractLearning(out: string) { const m = out.match(/TEAM_LEARNING:\s*(.+?)\s*$/ims); if (!m) return null; const l = m[1].split(/\r?\n/)[0].trim(); return l.length >= 4 ? l.slice(0, 280) : null; }

const BEAT: Record<string, string> = {
  commerce: "all 3 winning traits + beats the best-rated competitor; net margin positive after COGS+CAC+fees; refund < 6%; scale only proven winners",
  product: "landing conversion north star; refund < 5%; repeat/LTV growth",
  sales: "reply >= 8%; 100% of threads followed up; every draft cites one concrete signal; segment <= 50",
  creative: "3s hook retention; >=3 posts/week; saves+shares over views; >=3 hook variants/concept",
  research: "100% prospects carry a documented trigger; ranked by signal strength; zero duplicates; verified before handoff",
  finance: "100% revenue receipt-backed; fee leakage flagged; zero unverified revenue counted",
  delivery: "on-time delivery rate; QC pass before delivery; every delivery has stored evidence",
};
const ROTATION = ["product", "sales", "creative", "research", "finance", "delivery"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const url = Deno.env.get("SUPABASE_URL");
  const svc = Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const nous = Deno.env.get("NOUS_API_KEY");
  if (req.method === "GET") return json({ connector: "improvement_loop", configured: Boolean(url && svc && nous) });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  if (!url || !svc || !nous) return json({ error: "missing env" }, 503);

  const supabase = createClient(url, svc);
  const body = await req.json().catch(() => ({}));
  const candidate = req.headers.get("x-automation-secret");
  let ok = false, operatorOwner: string | null = null;
  if (candidate) { const { data } = await supabase.rpc("verify_automation_token", { candidate }); ok = data === true; }
  if (!ok) { const a = req.headers.get("Authorization"); if (a) { const { data: u } = await supabase.auth.getUser(a.replace(/^Bearer\s+/i, "")); if (u?.user) { ok = true; operatorOwner = u.user.id; } } }
  if (!ok) return json({ error: "automation token or operator session required" }, 401);

  const { data: pol } = await supabase.from("agent_automation_policies").select("user_id").eq("enabled", true).eq("paused", false).limit(1).maybeSingle();
  const owner = pol?.user_id ?? operatorOwner;
  if (!owner) return json({ skipped: "autopilot not armed" });

  // Commerce every run + one rotating agent.
  const rotated = body.agent || ROTATION[Math.floor(Date.now() / (4 * 3600 * 1000)) % ROTATION.length];
  const agents = [...new Set(["commerce", rotated])];

  // Real commerce signals so improvement is grounded in data, not vibes.
  let commerceData = "";
  try {
    const { data: drafts } = await supabase.from("product_drafts").select("status,est_net_margin_pct,price_usd,competitor,title").eq("owner_id", owner).order("created_at", { ascending: false }).limit(40);
    const rows = drafts ?? [];
    const published = rows.filter((r) => r.status === "published").length;
    const margins = rows.map((r) => Number(r.est_net_margin_pct)).filter((n) => n > 0);
    const avgMargin = margins.length ? Math.round(margins.reduce((a, b) => a + b, 0) / margins.length) : null;
    const comps = rows.map((r) => r?.competitor?.name).filter(Boolean).slice(0, 5);
    commerceData = `\n\nYOUR REAL DATA: ${rows.length} products proposed, ${published} published. Avg est net margin: ${avgMargin ?? "n/a"}%. Recent competitors benchmarked: ${comps.join("; ") || "none yet"}. Recent titles: ${rows.slice(0, 4).map((r) => r.title).join(" | ") || "none"}.`;
  } catch (_e) { /* best-effort */ }

  const results: unknown[] = [];
  for (const agent of agents) {
    // The agent's own highest-confidence learnings so far.
    const { data: kn } = await supabase.from("agent_knowledge").select("id,insight,confidence,reinforced_count").eq("owner_id", owner).eq("agent", agent).order("confidence", { ascending: false }).limit(5);
    const own = (kn ?? []).map((k, i) => `  ${i + 1}. ${k.insight} (conf ${Math.round(Number(k.confidence) * 100)}%${k.reinforced_count > 0 ? `, reinforced x${k.reinforced_count}` : ""})`).join("\n") || "  (no learnings yet — establish a strong first one)";
    const sys = `You are the ${agent} specialist in an autonomous AI business, in a CONTINUOUS-IMPROVEMENT (kaizen) review. Your standing target to beat: ${BEAT[agent] ?? "measurable improvement over your last result"}.\n\nYOUR PROVEN PLAYBOOK SO FAR:\n${own}${agent === "commerce" ? commerceData : ""}\n\nReflect honestly on the gap between your current results and the target. Pick the SINGLE highest-leverage improvement you can make next toward better EFFICIENCY, PROFITABILITY, or PRODUCT QUALITY/DESIRABILITY. Be concrete and specific (what to change, and the metric it moves) — not generic advice. Build on what already works; don't repeat an existing learning verbatim. Evidence-based only; never fabricate numbers. End with exactly one line: TEAM_LEARNING: <the single most reusable, implementable tactic, so the team can apply it>.`;
    const out = await hermes(sys, JSON.stringify({ task: `Continuous improvement pass for the ${agent} function. Produce one concrete, implementable upgrade toward efficiency, profitability, or product quality.` }));
    const learning = extractLearning(out);
    if (!learning) { results.push({ agent, recorded: false }); continue; }
    // Reinforce a near-duplicate, else insert (mirrors the orchestrator bus).
    let best: any = null, bestScore = 0;
    for (const r of (kn ?? [])) { const s = jaccard(learning, r.insight || ""); if (s > bestScore) { bestScore = s; best = r; } }
    if (best && bestScore >= 0.8) {
      const newConf = Math.min(0.99, Number(best.confidence ?? 0.5) + 0.1);
      await supabase.from("agent_knowledge").update({ reinforced_count: (best.reinforced_count ?? 0) + 1, confidence: newConf, updated_at: new Date().toISOString() }).eq("id", best.id);
      results.push({ agent, recorded: true, reinforced: true, confidence: newConf, learning });
    } else {
      await supabase.from("agent_knowledge").insert({ owner_id: owner, agent, audience: "all", kind: "improvement", topic: "kaizen: efficiency/profit/product", insight: learning, data: {}, confidence: 0.55 });
      results.push({ agent, recorded: true, reinforced: false, learning });
    }
  }
  return json({ mode: "improvement", improved: agents, results });
});
