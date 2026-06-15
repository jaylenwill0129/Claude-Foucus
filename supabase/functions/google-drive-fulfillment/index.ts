import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  const authorization = req.headers.get("Authorization");
  if (!authorization) return json({ error: "Authorization required" }, 401);

  const clientId = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET");
  const folderId = Deno.env.get("GOOGLE_DRIVE_FULFILLMENT_FOLDER_ID");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseSecret = Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!clientId || !clientSecret || !folderId || !supabaseUrl || !supabaseSecret) return json({ error: "Google Drive fulfillment is not fully configured" }, 503);

  const supabase = createClient(supabaseUrl, supabaseSecret);
  const { data: userData } = await supabase.auth.getUser(authorization.replace(/^Bearer\s+/i, ""));
  if (!userData.user) return json({ error: "Invalid user session" }, 401);
  const { data: connection } = await supabase
    .from("agent_oauth_connections")
    .select("refresh_token")
    .eq("user_id", userData.user.id)
    .eq("provider", "google_drive")
    .maybeSingle();
  if (!connection?.refresh_token) return json({ error: "Google Drive is not connected for this user" }, 503);

  const body = await req.json();
  if (!body.actionId || !body.approvedAt) return json({ error: "Operator approval receipt required" }, 400);
  if (!body.payload?.fileName || !body.payload?.content) return json({ error: "fileName and content are required" }, 400);

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: connection.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const tokenData = await tokenResponse.json();
  if (!tokenResponse.ok) return json({ error: "Could not refresh Google access", provider: tokenData }, 502);

  const boundary = `operator-os-${crypto.randomUUID()}`;
  const metadata = JSON.stringify({ name: body.payload.fileName, parents: [folderId] });
  const multipart = [
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
    `--${boundary}\r\nContent-Type: ${body.payload.mimeType ?? "text/plain"}\r\n\r\n${body.payload.content}\r\n`,
    `--${boundary}--`,
  ].join("");
  const uploadResponse = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body: multipart,
  });
  const receipt = await uploadResponse.json();
  if (!uploadResponse.ok) return json({ error: "Google Drive rejected fulfillment", provider: receipt }, uploadResponse.status);
  return json({ accepted: true, provider: "google_drive", receipt });
});

