import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Lemon Squeezy connector (merchant-of-record for digital products). Read-only:
// reports the store, products, and real paid sales. Lemon Squeezy hosts checkout
// and delivers the file natively, and is the merchant of record (handles tax) —
// so the digital line needs no delivery poller or tax handling here. Selling
// happens on LS-hosted checkout; this never charges or moves money.
// Deployed via the Supabase MCP (verify_jwt=false; POST self-authenticates).
//
// SETUP (operator): create a Lemon Squeezy account + store, add the product,
// then set LEMONSQUEEZY_API_KEY in Supabase secrets. The world then reads LS
// sales automatically and the digital line needs no delivery poller.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const LS = "https://api.lemonsqueezy.com/v1";
async function lsGet(path: string, key: string) {
  const res = await fetch(`${LS}/${path}`, { headers: { Authorization: `Bearer ${key}`, Accept: "application/vnd.api+json" } });
  return { ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const key = Deno.env.get("LEMONSQUEEZY_API_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (req.method === "GET") return json({ connector: "lemonsqueezy", configured: Boolean(key) });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  if (!key) return json({ error: "LEMONSQUEEZY_API_KEY is required", configured: false }, 200);
  if (!supabaseUrl || !serviceKey) return json({ error: "Supabase credentials required" }, 503);

  const authorization = req.headers.get("Authorization");
  if (!authorization) return json({ error: "Authorization required" }, 401);
  const supabase = createClient(supabaseUrl, serviceKey);
  const { data: userData, error: userError } = await supabase.auth.getUser(authorization.replace(/^Bearer\s+/i, ""));
  if (userError || !userData.user) return json({ error: "Invalid user session" }, 401);

  const stores = await lsGet("stores", key);
  if (!stores.ok) return json({ error: stores.body?.errors?.[0]?.detail ?? `Lemon Squeezy HTTP ${stores.status}`, configured: true }, 200);
  const store = stores.body?.data?.[0];
  const products = await lsGet("products?page[size]=50", key);
  const orders = await lsGet("orders?page[size]=100", key);
  const orderNodes = orders.body?.data ?? [];
  const paid = orderNodes.filter((o: { attributes?: { status?: string } }) => o.attributes?.status === "paid");
  const grossCents = paid.reduce((n: number, o: { attributes?: { total?: number } }) => n + Number(o.attributes?.total ?? 0), 0);

  return json({
    configured: true,
    store: store ? { name: store.attributes?.name, url: store.attributes?.url, currency: store.attributes?.currency } : null,
    products: (products.body?.data ?? []).map((p: { id: string; attributes?: Record<string, unknown> }) => ({ id: p.id, name: p.attributes?.name, status: p.attributes?.status, priceFormatted: p.attributes?.price_formatted, buyNowUrl: p.attributes?.buy_now_url })),
    sales: { count: paid.length, grossCents, currency: store?.attributes?.currency ?? "USD" },
  });
});
