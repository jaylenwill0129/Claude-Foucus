// Digital delivery: Shopify orders/paid webhook -> verify the order against
// Shopify's authoritative Admin API (so a spoofed webhook can't redirect the
// email) -> email the real buyer their download link(s) via Resend. Maps each
// digital SKU to its hosted deliverable. No money movement; pure fulfillment.
//
// Deployed via the Supabase MCP (verify_jwt=false — Shopify webhooks carry no
// Supabase JWT; authenticity comes from re-fetching the order via Admin API).
//
// REMAINING SETUP (operator, one-time): register the webhook in Shopify admin
// (Settings -> Notifications -> Webhooks): event "Order payment", format JSON,
// URL https://<ref>.supabase.co/functions/v1/shopify-fulfillment. (The Shopify
// MCP blocks webhookSubscriptionCreate as a data-exfiltration safeguard.)

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-shopify-topic, x-shopify-hmac-sha256",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const senderFrom = () => {
  const raw = (Deno.env.get("RESEND_FROM_EMAIL") || "").trim();
  if (!raw || /your-verified-domain|example\.com/i.test(raw)) return "Operator OS <onboarding@resend.dev>";
  return raw;
};

// SKU -> downloadable deliverable. Extend as products are published.
const DELIVERABLES: Record<string, { name: string; url: string }> = {
  "CONTRACTOR-KIT-29": { name: "Contractor Follow-Up & Booking Kit", url: "https://d2ol7oe51mr4n9.cloudfront.net/user_3EaPbckrKq8CRIt6kCQR6f4khFc/900f4ef9-d34d-4556-b928-7c37aa7c9d75.html" },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const domain = Deno.env.get("SHOPIFY_STORE_DOMAIN");
  const shopToken = Deno.env.get("SHOPIFY_ADMIN_ACCESS_TOKEN");
  const resendKey = Deno.env.get("RESEND_API_KEY");

  if (req.method === "GET") return json({ connector: "shopify_fulfillment", configured: Boolean(domain && shopToken && resendKey), skus: Object.keys(DELIVERABLES) });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  if (!domain || !shopToken || !resendKey) return json({ error: "Shopify + Resend env required" }, 503);

  const hook = await req.json().catch(() => ({}));
  const orderGid = hook?.admin_graphql_api_id || (hook?.id ? `gid://shopify/Order/${hook.id}` : null);
  if (!orderGid) return json({ ok: false, error: "no order id in payload" }, 200); // 200 so Shopify doesn't retry-storm

  // Re-fetch the order from the authoritative Admin API (anti-spoof).
  const q = `query($id: ID!){ order(id: $id){ id name displayFinancialStatus email customer{ email } lineItems(first: 50){ nodes{ sku title } } } }`;
  const r = await fetch(`https://${domain}/admin/api/2026-04/graphql.json`, { method: "POST", headers: { "X-Shopify-Access-Token": shopToken, "Content-Type": "application/json" }, body: JSON.stringify({ query: q, variables: { id: orderGid } }) });
  const data = await r.json().catch(() => ({}));
  const order = data?.data?.order;
  if (!order) return json({ ok: false, error: "order not found" }, 200);
  if (order.displayFinancialStatus !== "PAID") return json({ ok: true, skipped: "not paid", status: order.displayFinancialStatus }, 200);

  const email = order.email || order.customer?.email;
  const skus = (order.lineItems?.nodes ?? []).map((n: { sku?: string }) => n.sku).filter(Boolean);
  const items = skus.map((s: string) => DELIVERABLES[s]).filter(Boolean);
  if (!email || !items.length) return json({ ok: true, skipped: "no email or no digital SKU", skus }, 200);

  const links = items.map((d) => `<li><a href="${d.url}">${d.name}</a></li>`).join("");
  const html = `<div style="font-family:system-ui,sans-serif;max-width:560px"><h2 style="margin:0 0 10px">Your download is ready 🎉</h2><p style="color:#475569">Thanks for your order ${order.name}. Access your digital product${items.length > 1 ? "s" : ""} here:</p><ul style="line-height:1.8">${links}</ul><p style="color:#94a3b8;font-size:12px">Save this email — your link stays available. Questions? Just reply.</p></div>`;
  const send = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: senderFrom(), to: [email], subject: `Your download — ${items.map((d) => d.name).join(", ")}`, html }) });
  const sj = await send.json().catch(() => ({}));
  return json({ ok: send.ok, delivered: send.ok ? items.length : 0, to: email, order: order.name, error: send.ok ? undefined : (sj?.message ?? `HTTP ${send.status}`) });
});
