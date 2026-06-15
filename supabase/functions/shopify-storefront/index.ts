const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

type StorefrontRequest = {
  actionId: string;
  approvedAt: string;
  payload: {
    title?: string;
    descriptionHtml?: string;
    productType?: string;
    vendor?: string;
    priceUsd?: number;
  };
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const domain = Deno.env.get("SHOPIFY_STORE_DOMAIN");
  const token = Deno.env.get("SHOPIFY_ADMIN_ACCESS_TOKEN");
  if (req.method === "GET") {
    return json({ connector: "shopify", configured: Boolean(domain && token), store: domain ?? null });
  }
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  if (!domain || !token) return json({ error: "SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_ACCESS_TOKEN are required" }, 503);

  const body = (await req.json()) as StorefrontRequest;
  if (!body.actionId || !body.approvedAt) return json({ error: "Operator approval receipt required" }, 400);
  if (!body.payload?.title || !body.payload?.descriptionHtml || !body.payload?.priceUsd) {
    return json({ error: "title, descriptionHtml, and priceUsd are required" }, 400);
  }

  const query = `
    mutation CreateProduct($product: ProductCreateInput!) {
      productCreate(product: $product) {
        product { id title handle status }
        userErrors { field message }
      }
    }
  `;
  const response = await fetch(`https://${domain}/admin/api/2026-04/graphql.json`, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      variables: {
        product: {
          title: body.payload.title,
          descriptionHtml: body.payload.descriptionHtml,
          productType: body.payload.productType ?? "Digital product",
          vendor: body.payload.vendor ?? "Operator OS",
          status: "DRAFT",
        },
      },
    }),
  });
  const result = await response.json();
  if (!response.ok || result.errors?.length || result.data?.productCreate?.userErrors?.length) {
    return json({ error: "Shopify rejected the draft product", provider: result }, response.status || 400);
  }
  return json({
    accepted: true,
    provider: "shopify",
    note: "Created as DRAFT. Price and publication require a separate approved action.",
    receipt: result.data.productCreate.product,
  });
});
