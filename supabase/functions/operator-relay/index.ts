import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Operator Relay: the world's comms channel (replaces the self-hosted OpenClaw
// gateway). Emails the signed-in operator their briefs/approvals via Resend.
// Self-notification to the account owner, triggered in-app.
// Deployed via the Supabase MCP (verify_jwt=false; POST self-authenticates).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));

// Operator emails go to the operator's own inbox, where Resend's shared sender
// works without a verified domain. Treat the .env.example placeholder or an
// empty value as "use onboarding@resend.dev".
const senderFrom = () => {
  const raw = (Deno.env.get("RESEND_FROM_EMAIL") || "").trim();
  if (!raw || /your-verified-domain|example\.com/i.test(raw)) return "Operator OS <onboarding@resend.dev>";
  return raw;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseSecretKey = Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (req.method === "GET") {
    return json({ connector: "operator_relay", configured: Boolean(apiKey), channel: "email", from: senderFrom() });
  }
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  if (!apiKey) return json({ error: "RESEND_API_KEY is required" }, 503);
  if (!supabaseUrl || !supabaseSecretKey) return json({ error: "SUPABASE_URL and SUPABASE_SECRET_KEY are required" }, 503);

  const authorization = req.headers.get("Authorization");
  if (!authorization) return json({ error: "Authorization required" }, 401);
  const supabase = createClient(supabaseUrl, supabaseSecretKey);
  const token = authorization.replace(/^Bearer\s+/i, "");
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user?.email) return json({ error: "Invalid user session" }, 401);

  const event = await req.json().catch(() => ({}));
  const title = String(event.title ?? "Operator OS update").slice(0, 200);
  const body = String(event.body ?? "").slice(0, 4000);
  const kind = String(event.kind ?? "world_alert");
  const metaLine = event.meta && typeof event.meta === "object" ? `<p style="color:#64748b;font-size:12px">${esc(JSON.stringify(event.meta))}</p>` : "";
  const html = `<div style="font-family:system-ui,sans-serif;max-width:560px"><p style="color:#94a3b8;font-size:11px;letter-spacing:.08em;text-transform:uppercase">Operator OS &middot; ${esc(kind)}</p><h2 style="margin:6px 0 10px">${esc(title)}</h2><p style="line-height:1.5;color:#0f172a;white-space:pre-wrap">${esc(body)}</p>${metaLine}</div>`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: senderFrom(), to: [userData.user.email], subject: title, html }),
    });
    const raw = await res.json().catch(() => ({}));
    if (!res.ok) return json({ ok: false, error: raw?.message ?? `Resend HTTP ${res.status}`, provider: raw }, 502);
    return json({ ok: true, id: raw?.id ?? null, to: userData.user.email });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "relay failed" }, 502);
  }
});
