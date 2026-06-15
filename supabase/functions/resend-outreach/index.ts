const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

type OutreachRequest = {
  actionId: string;
  approvedAt: string;
  payload: {
    from?: string;
    to?: string[];
    subject?: string;
    html?: string;
    text?: string;
  };
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method === "GET") {
    return json({
      connector: "resend",
      configured: Boolean(Deno.env.get("RESEND_API_KEY") && Deno.env.get("RESEND_FROM_EMAIL")),
    });
  }
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  const apiKey = Deno.env.get("RESEND_API_KEY");
  const defaultFrom = Deno.env.get("RESEND_FROM_EMAIL");
  if (!apiKey || !defaultFrom) return json({ error: "RESEND_API_KEY and RESEND_FROM_EMAIL are required" }, 503);

  const body = (await req.json()) as OutreachRequest;
  if (!body.actionId || !body.approvedAt) return json({ error: "Operator approval receipt required" }, 400);
  const recipients = body.payload?.to ?? [];
  if (!recipients.length || !body.payload?.subject || (!body.payload?.html && !body.payload?.text)) {
    return json({ error: "to, subject, and message content are required" }, 400);
  }
  if (recipients.length > 25) return json({ error: "Maximum 25 recipients per approved action" }, 400);

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: body.payload.from ?? defaultFrom,
      to: recipients,
      subject: body.payload.subject,
      html: body.payload.html,
      text: body.payload.text,
      headers: { "X-Agent-Action-Id": body.actionId },
    }),
  });
  const result = await response.json();
  if (!response.ok) return json({ error: "Resend rejected the action", provider: result }, response.status);
  return json({ accepted: true, provider: "resend", receipt: result });
});
