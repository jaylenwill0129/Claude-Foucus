import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Dropship fulfillment router. Supplier->customer auto-shipping via ZenDrop OR
// AutoDS (provider-abstracted; set FULFILLMENT_PROVIDER + the matching key).
// Scheduled via pg_cron 'dropship-fulfillment-poll' (*/30 * * * *).
//
// SAFETY: placing a supplier order SPENDS money -> it is HARD-GATED. The cron/poll
// path only DETECTS paid+unfulfilled Shopify orders and QUEUES a supplier-order job
// as awaiting_approval (no spend). The execute path actually places the order with
// the supplier and requires an OPERATOR session (explicit approval) + the supplier
// API key. So this activates end-to-end the moment a valid key is set and a job is
// approved — never spends autonomously.
//
// Endpoint paths / field names are env-configurable (ZENDROP_API_BASE,
// AUTODS_API_BASE) so they can be matched to the operator's plan without a redeploy.

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-automation-secret" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const domainVal = () => Deno.env.get("SHOPIFY_STORE_DOMAIN") || Deno.env.get("SHOPIFY_DOMAIN") || null;
const TOKEN_VARS = ["SHOPIFY_ADMIN_ACCESS_TOKEN", "SHOPIFY_ADMIN_TOKEN", "SHOPIFY_ACCESS_TOKEN", "SHOPIFY_API_TOKEN"];
const shopTokenVal = () => { for (const n of TOKEN_VARS) { const v = Deno.env.get(n); if (v) return v; } return null; };

const providerName = () => (Deno.env.get("FULFILLMENT_PROVIDER") || "").trim().toLowerCase();
const supplierKey = () => { const p = providerName(); if (p === "zendrop") return Deno.env.get("ZENDROP_API_KEY") || null; if (p === "autods") return Deno.env.get("AUTODS_API_KEY") || null; return null; };

async function shopify(domain: string, token: string, query: string, variables?: unknown) {
  const r = await fetch(`https://${domain}/admin/api/2026-04/graphql.json`, { method: "POST", headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" }, body: JSON.stringify({ query, variables: variables ?? {} }) });
  return await r.json().catch(() => ({}));
}

// Map a Shopify order into a provider-neutral supplier payload.
function toSupplierPayload(order: any) {
  const a = order.shippingAddress ?? {};
  return {
    external_order_id: order.name || order.id,
    shipping_address: { name: a.name, address1: a.address1, address2: a.address2, city: a.city, province: a.province, country: a.country, zip: a.zip, phone: a.phone },
    email: order.email,
    line_items: (order.lineItems?.nodes ?? []).map((li: any) => ({ sku: li.sku || li.variant?.sku || null, title: li.title, quantity: li.quantity })),
  };
}

// Place the order with the configured supplier. Returns the raw provider response
// as the receipt; throws on non-2xx.
async function placeSupplierOrder(payload: any) {
  const provider = providerName();
  const key = supplierKey();
  if (!provider) throw new Error("FULFILLMENT_PROVIDER not set (zendrop|autods)");
  if (!key) throw new Error(`${provider} API key not set`);
  let urlBase: string, body: unknown, headers: Record<string, string>;
  if (provider === "zendrop") {
    urlBase = (Deno.env.get("ZENDROP_API_BASE") || "https://api.zendrop.com/v1").replace(/\/$/, "");
    headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
    body = { external_id: payload.external_order_id, email: payload.email, shipping_address: payload.shipping_address, line_items: payload.line_items };
  } else if (provider === "autods") {
    urlBase = (Deno.env.get("AUTODS_API_BASE") || "https://v2.autods.com").replace(/\/$/, "");
    headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
    body = { external_order_id: payload.external_order_id, buyer_email: payload.email, shipping: payload.shipping_address, items: payload.line_items };
  } else {
    throw new Error(`unknown FULFILLMENT_PROVIDER: ${provider}`);
  }
  const endpoint = `${urlBase}/orders`;
  const r = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(body) });
  const raw = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${provider} order failed: ${raw?.message ?? raw?.error ?? `HTTP ${r.status}`}`);
  return { provider, endpoint, response: raw };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const url = Deno.env.get("SUPABASE_URL");
  const svc = Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const domain = domainVal();
  const shopToken = shopTokenVal();
  if (req.method === "GET") return json({ connector: "dropship_fulfillment", provider: providerName() || null, configured: Boolean(url && svc && domain && shopToken), supplierKeyPresent: Boolean(supplierKey()) });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  if (!url || !svc) return json({ error: "missing supabase env" }, 503);

  const supabase = createClient(url, svc);
  const body = await req.json().catch(() => ({}));
  const candidate = req.headers.get("x-automation-secret");
  let isOperator = false, owner: string | null = null, machineOk = false;
  if (candidate) { const { data } = await supabase.rpc("verify_automation_token", { candidate }); machineOk = data === true; }
  const auth = req.headers.get("Authorization");
  if (auth) { const { data: u } = await supabase.auth.getUser(auth.replace(/^Bearer\s+/i, "")); if (u?.user) { isOperator = true; owner = u.user.id; } }
  if (!machineOk && !isOperator) return json({ error: "automation token or operator session required" }, 401);

  // EXECUTE: actually place a queued supplier order. Operator-only (explicit approval) + spends money.
  if (body.mode === "execute") {
    if (!isOperator) return json({ error: "placing a supplier order requires an operator session (approval)" }, 403);
    if (!body.jobId) return json({ error: "jobId required" }, 400);
    const { data: jobRow } = await supabase.from("agent_automation_jobs").select("*").eq("id", body.jobId).eq("owner_id", owner).maybeSingle();
    if (!jobRow) return json({ error: "job not found" }, 404);
    if (jobRow.action_type !== "place_supplier_order") return json({ error: "not a supplier-order job" }, 400);
    if (jobRow.finished_at) return json({ outcome: "already_done", job: jobRow.id });
    try {
      const receipt = await placeSupplierOrder(jobRow.payload?.supplier ?? jobRow.payload);
      await supabase.from("agent_automation_jobs").update({ status: "succeeded", approved_by: owner, approved_at: new Date().toISOString(), finished_at: new Date().toISOString(), provider_receipt: receipt }).eq("id", jobRow.id);
      return json({ outcome: "supplier_order_placed", job: jobRow.id, provider: receipt.provider, receipt: receipt.response });
    } catch (e) {
      await supabase.from("agent_automation_jobs").update({ status: "failed", last_error: String((e as Error)?.message ?? e), attempts: (jobRow.attempts ?? 0) + 1 }).eq("id", jobRow.id);
      return json({ outcome: "supplier_order_failed", job: jobRow.id, error: String((e as Error)?.message ?? e) }, 502);
    }
  }

  // POLL (default): detect paid + unfulfilled orders and QUEUE supplier-order jobs as awaiting_approval. No spend.
  if (!domain || !shopToken) return json({ error: "missing shopify env", haveDomain: Boolean(domain), haveToken: Boolean(shopToken) }, 503);
  const { data: pol } = await supabase.from("agent_automation_policies").select("user_id").eq("enabled", true).eq("paused", false).limit(1).maybeSingle();
  if (!pol && !isOperator) return json({ skipped: "autopilot not armed" });
  const ownerId = pol?.user_id ?? owner;

  const res = await shopify(domain, shopToken, `{ orders(first: 20, query: "financial_status:paid fulfillment_status:unfulfilled") { nodes { id name email shippingAddress { name address1 address2 city province country zip phone } lineItems(first: 25){ nodes { sku title quantity variant { sku } } } } } }`);
  if (res?.errors || !res?.data) return json({ error: "shopify orders query failed", detail: res?.errors?.[0]?.message ?? "no data (check Admin token + read_orders scope)" }, 502);
  const orders = res.data.orders?.nodes ?? [];
  const provider = providerName() || "unset";
  const queued: unknown[] = [];
  for (const o of orders) {
    const key = `supplierorder:${provider}:${o.id}`;
    const { data: dup } = await supabase.from("agent_automation_jobs").select("id,status").eq("idempotency_key", key).limit(1).maybeSingle();
    if (dup) { queued.push({ order: o.name, status: dup.status, deduped: true }); continue; }
    const supplier = toSupplierPayload(o);
    const { data: ins, error } = await supabase.from("agent_automation_jobs").insert({
      owner_id: ownerId, agent: "Dev", action_type: "place_supplier_order", connector: provider,
      risk_level: "high", status: "awaiting_approval", requires_approval: true, idempotency_key: key,
      payload: { supplier, shopifyOrder: o.name, note: `Auto-prepared ${provider} supplier order. Approve to place & ship supplier->customer (spends money).` },
    }).select("id").maybeSingle();
    if (error) { queued.push({ order: o.name, error: error.message }); continue; }
    queued.push({ order: o.name, jobId: ins?.id, status: "awaiting_approval" });
  }
  return json({ mode: "poll", provider, ordersFound: orders.length, queued });
});
