import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Unattended scheduler entrypoint for the autopilot, called by pg_cron. It
// validates a Vault-stored token (verify_automation_token RPC) so randoms can't
// trigger it, then drives the prepare-loop via the existing autopilot-planner
// using the shared worker secret. In digest mode it emails each operator a
// summary of what is awaiting approval. It NEVER executes gated actions — the
// planner/worker still hold every send/publish/spend/charge for explicit
// operator approval. Deployed via the Supabase MCP (verify_jwt=false).
//
// Cron jobs (see migration 20260617_autopilot_cron_scheduler):
//   autopilot-run    */30 * * * *   body {"mode":"run"}
//   autopilot-digest 0 13 * * *     body {"mode":"digest"}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-automation-secret",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));

// Operator self-notifications go to the operator's own inbox, where Resend's
// shared sender works without a verified domain. Treat the .env.example
// placeholder (or an empty value) as "use onboarding@resend.dev".
const senderFrom = () => {
  const raw = (Deno.env.get("RESEND_FROM_EMAIL") || "").trim();
  if (!raw || /your-verified-domain|example\.com/i.test(raw)) return "Operator OS <onboarding@resend.dev>";
  return raw;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const workerSecret = Deno.env.get("AUTOMATION_WORKER_SECRET");

  if (req.method === "GET") return json({ connector: "autopilot_cron", configured: Boolean(supabaseUrl && serviceKey && workerSecret) });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  if (!supabaseUrl || !serviceKey || !workerSecret) return json({ error: "Scheduler credentials are required" }, 503);

  const supabase = createClient(supabaseUrl, serviceKey);
  const candidate = req.headers.get("x-automation-secret");
  if (!candidate) return json({ error: "automation token required" }, 401);
  const { data: ok } = await supabase.rpc("verify_automation_token", { candidate });
  if (ok !== true) return json({ error: "invalid automation token" }, 401);

  const body = await req.json().catch(() => ({}));
  const mode = body.mode ?? "run";

  if (mode === "run") {
    try {
      const r = await fetch(`${supabaseUrl}/functions/v1/autopilot-planner`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-automation-secret": workerSecret },
        body: "{}",
      });
      const out = await r.json().catch(() => ({}));
      return json({ mode: "run", ok: r.ok, planner: out }, r.ok ? 200 : 502);
    } catch (e) {
      return json({ mode: "run", ok: false, error: e instanceof Error ? e.message : "planner call failed" }, 502);
    }
  }

  if (mode === "digest") {
    const apiKey = Deno.env.get("RESEND_API_KEY");
    const from = senderFrom();
    const { data: policies } = await supabase.from("agent_automation_policies").select("user_id").eq("enabled", true).eq("paused", false);
    const sent: Array<Record<string, unknown>> = [];
    for (const p of (policies ?? []) as Array<{ user_id: string }>) {
      const { data: awaiting } = await supabase.from("agent_automation_jobs").select("agent,action_type,connector").eq("owner_id", p.user_id).eq("status", "awaiting_approval").order("created_at", { ascending: false }).limit(25);
      const { count: queued } = await supabase.from("agent_automation_jobs").select("id", { count: "exact", head: true }).eq("owner_id", p.user_id).eq("status", "queued");
      const items = awaiting ?? [];
      if (!apiKey) { sent.push({ owner: p.user_id, emailed: false, reason: "resend not configured", awaiting: items.length }); continue; }
      const { data: u } = await supabase.auth.admin.getUserById(p.user_id);
      const email = u?.user?.email;
      if (!email) { sent.push({ owner: p.user_id, emailed: false, reason: "no email on account" }); continue; }
      const rows = items.length ? items.map((j) => `<li>${esc(j.agent)}: ${esc(j.action_type)} <span style="color:#64748b">(${esc(j.connector)})</span></li>`).join("") : `<li style="color:#64748b">Nothing awaiting approval right now.</li>`;
      const html = `<div style="font-family:system-ui,sans-serif;max-width:560px"><p style="color:#94a3b8;font-size:11px;letter-spacing:.08em;text-transform:uppercase">Operator OS &middot; autopilot digest</p><h2 style="margin:6px 0 10px">${items.length} item(s) awaiting your approval</h2><p style="color:#475569">The world kept preparing while you were away. ${queued ?? 0} autonomous job(s) queued. Open the world to approve or reject:</p><ul style="line-height:1.6">${rows}</ul></div>`;
      const res = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ from, to: [email], subject: `Operator OS — ${items.length} item(s) awaiting approval`, html }) });
      const rj = await res.json().catch(() => ({}));
      sent.push({ owner: p.user_id, emailed: res.ok, awaiting: items.length, queued: queued ?? 0, from, error: res.ok ? undefined : (rj?.message ?? rj?.name ?? `HTTP ${res.status}`) });
    }
    return json({ mode: "digest", sent });
  }

  return json({ error: "unknown mode (use run or digest)" }, 400);
});
