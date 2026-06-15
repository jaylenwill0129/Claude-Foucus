import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@17?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method === "GET") {
    const configured = Boolean(
      Deno.env.get("STRIPE_SECRET_KEY") &&
      Deno.env.get("STRIPE_WEBHOOK_SECRET") &&
      Deno.env.get("SUPABASE_URL") &&
      (Deno.env.get("SUPABASE_SECRET_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")),
    );
    return json({ connector: "stripe", configured });
  }

  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseSecret = Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!stripeSecret || !webhookSecret || !supabaseUrl || !supabaseSecret) {
    return json({ error: "Stripe connector is not fully configured" }, 503);
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) return json({ error: "Missing stripe-signature" }, 400);

  const rawBody = await req.text();
  const stripe = new Stripe(stripeSecret, { apiVersion: "2024-12-18.acacia" });
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, webhookSecret);
  } catch {
    return json({ error: "Invalid Stripe signature" }, 400);
  }

  const object = event.data.object as Record<string, unknown>;
  const amount =
    Number(object.amount_total ?? object.amount_received ?? object.amount ?? 0);
  const customer =
    typeof object.customer === "string" ? object.customer : null;
  const paymentRef =
    typeof object.payment_intent === "string"
      ? object.payment_intent
      : typeof object.id === "string"
        ? object.id
        : null;

  const supabase = createClient(supabaseUrl, supabaseSecret);
  const { error } = await supabase.from("agent_revenue_events").upsert({
    provider: "stripe",
    provider_event_id: event.id,
    event_type: event.type,
    amount_cents: amount,
    currency: typeof object.currency === "string" ? object.currency : "usd",
    customer_ref: customer,
    payment_ref: paymentRef,
    status: typeof object.status === "string" ? object.status : "received",
    occurred_at: new Date(event.created * 1000).toISOString(),
    payload: event,
  }, { onConflict: "provider_event_id" });

  if (error) return json({ error: "Could not store Stripe event" }, 500);
  return json({ received: true });
});
