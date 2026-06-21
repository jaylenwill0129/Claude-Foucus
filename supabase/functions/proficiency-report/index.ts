import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Weekly proficiency report. Cron-driven ('proficiency-weekly', 0 13 * * 1),
// vault-token gated. Emails each armed operator a per-agent learning summary
// (how many learnings, avg confidence, most-reinforced tactic) so they can see
// who's improving and what's working.

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-automation-secret" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
// Anchored validation: the WHOLE value must be email or 'Name <email>' (a trailing
// char like a stray '.' makes it invalid). Otherwise fall back to Resend's sender.
const senderFrom = () => {
  const raw = (Deno.env.get("RESEND_FROM_EMAIL") || "").trim();
  const validEmail = /^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(raw);
  const validNamed = /^[^<>]+<[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+>$/.test(raw);
  if (!raw || (!validEmail && !validNamed) || /your-verified-domain|example\.com/i.test(raw)) return "Operator OS <onboarding@resend.dev>";
  return raw;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const url = Deno.env.get("SUPABASE_URL");
  const svc = Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (req.method === "GET") return json({ connector: "proficiency_report", configured: Boolean(url && svc && resendKey), from: senderFrom() });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  if (!url || !svc) return json({ error: "missing supabase env" }, 503);

  const supabase = createClient(url, svc);
  const candidate = req.headers.get("x-automation-secret");
  let ok = false;
  if (candidate) { const { data } = await supabase.rpc("verify_automation_token", { candidate }); ok = data === true; }
  if (!ok) { const a = req.headers.get("Authorization"); if (a) { const { data: u } = await supabase.auth.getUser(a.replace(/^Bearer\s+/i, "")); ok = Boolean(u?.user); } }
  if (!ok) return json({ error: "automation token or operator session required" }, 401);

  const { data: policies } = await supabase.from("agent_automation_policies").select("user_id").eq("enabled", true).eq("paused", false);
  const sent: unknown[] = [];
  for (const p of (policies ?? [])) {
    const { data: rows } = await supabase.from("agent_knowledge").select("agent,insight,confidence,reinforced_count,kind").eq("owner_id", p.user_id).limit(500);
    const ks = rows ?? [];
    const byAgent: Record<string, any[]> = {};
    for (const k of ks) { const a = k.agent || "unknown"; (byAgent[a] ||= []).push(k); }
    const totalReinforced = ks.reduce((n, k) => n + Number(k.reinforced_count || 0), 0);
    const agents = Object.entries(byAgent).map(([agent, items]) => {
      const avg = items.reduce((n, k) => n + Number(k.confidence || 0), 0) / items.length;
      const top = items.slice().sort((a, b) => (Number(b.reinforced_count || 0) - Number(a.reinforced_count || 0)) || (Number(b.confidence || 0) - Number(a.confidence || 0)))[0];
      return { agent, count: items.length, avgConf: Math.round(avg * 100), topReinforced: Number(top?.reinforced_count || 0), topTactic: top?.insight || "" };
    }).sort((a, b) => b.topReinforced - a.topReinforced || b.avgConf - a.avgConf);
    const summary = { learnings: ks.length, totalReinforced, agents };
    if (!resendKey) { sent.push({ owner: p.user_id, emailed: false, reason: "resend not configured", ...summary }); continue; }
    const { data: u } = await supabase.auth.admin.getUserById(p.user_id);
    const email = u?.user?.email;
    if (!email) { sent.push({ owner: p.user_id, emailed: false, reason: "no email" }); continue; }
    const rowsHtml = agents.map((a) => `<tr><td style="padding:6px 10px;border-bottom:1px solid #eef"><b>${esc(a.agent)}</b></td><td style="padding:6px 10px;border-bottom:1px solid #eef;text-align:center">${a.count}</td><td style="padding:6px 10px;border-bottom:1px solid #eef;text-align:center">${a.avgConf}%</td><td style="padding:6px 10px;border-bottom:1px solid #eef">${a.topReinforced > 0 ? `↻${a.topReinforced} · ` : ""}${esc((a.topTactic || "").slice(0, 90))}</td></tr>`).join("");
    const html = `<div style="font-family:system-ui,sans-serif;max-width:620px"><p style="color:#94a3b8;font-size:11px;letter-spacing:.08em;text-transform:uppercase">Operator OS &middot; weekly proficiency</p><h2 style="margin:6px 0 4px">Your team is learning</h2><p style="color:#475569">${summary.learnings} learnings on the bus &middot; ${summary.totalReinforced} reinforcements. Higher confidence + more ↻ = more proven.</p><table style="border-collapse:collapse;width:100%;font-size:13px"><tr style="text-align:left;color:#64748b"><th style="padding:6px 10px">Agent</th><th style="padding:6px 10px">Learnings</th><th style="padding:6px 10px">Avg conf</th><th style="padding:6px 10px">Top proven tactic</th></tr>${rowsHtml || '<tr><td style="padding:10px" colspan=4>No learnings yet.</td></tr>'}</table></div>`;
    const res = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: senderFrom(), to: [email], subject: `Operator OS — weekly proficiency report (${summary.learnings} learnings)`, html }) });
    const rj = await res.json().catch(() => ({}));
    sent.push({ owner: p.user_id, emailed: res.ok, ...summary, from: senderFrom(), error: res.ok ? undefined : (rj?.message ?? `HTTP ${res.status}`) });
  }
  return json({ mode: "proficiency", sent });
});
