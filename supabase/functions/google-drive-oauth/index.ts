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

const config = () => ({
  clientId: Deno.env.get("GOOGLE_OAUTH_CLIENT_ID"),
  clientSecret: Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET"),
  redirectUri: Deno.env.get("GOOGLE_OAUTH_REDIRECT_URI"),
  appUrl: Deno.env.get("OPERATOR_OS_APP_URL"),
  supabaseUrl: Deno.env.get("SUPABASE_URL"),
  supabaseSecret: Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const settings = config();
  if (!settings.clientId || !settings.clientSecret || !settings.redirectUri || !settings.supabaseUrl || !settings.supabaseSecret) {
    return json({ error: "Google Drive OAuth is not fully configured" }, 503);
  }
  const supabase = createClient(settings.supabaseUrl, settings.supabaseSecret);
  const url = new URL(req.url);

  if (url.searchParams.get("code") && url.searchParams.get("state")) {
    const state = url.searchParams.get("state")!;
    const { data: storedState } = await supabase
      .from("agent_oauth_states")
      .select("user_id, expires_at")
      .eq("state", state)
      .eq("provider", "google_drive")
      .maybeSingle();
    if (!storedState || new Date(storedState.expires_at).getTime() < Date.now()) return json({ error: "Invalid or expired OAuth state" }, 400);

    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: url.searchParams.get("code")!,
        client_id: settings.clientId,
        client_secret: settings.clientSecret,
        redirect_uri: settings.redirectUri,
        grant_type: "authorization_code",
      }),
    });
    const tokens = await tokenResponse.json();
    if (!tokenResponse.ok || !tokens.refresh_token) return json({ error: "Google did not return a refresh token. Revoke access and reconnect.", provider: tokens }, 400);

    await supabase.from("agent_oauth_connections").upsert({
      user_id: storedState.user_id,
      provider: "google_drive",
      refresh_token: tokens.refresh_token,
      scope: tokens.scope ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,provider" });
    await supabase.from("agent_oauth_states").delete().eq("state", state);
    return Response.redirect(`${settings.appUrl ?? "http://127.0.0.1:8104"}/?google_drive=connected`, 302);
  }

  const authorization = req.headers.get("Authorization");
  if (!authorization) return json({ error: "Authorization required" }, 401);
  const token = authorization.replace(/^Bearer\s+/i, "");
  const { data: userData } = await supabase.auth.getUser(token);
  if (!userData.user) return json({ error: "Invalid user session" }, 401);

  if (req.method === "GET") {
    const { data: connection } = await supabase
      .from("agent_oauth_connections")
      .select("updated_at")
      .eq("user_id", userData.user.id)
      .eq("provider", "google_drive")
      .maybeSingle();
    return json({ connector: "google_drive", configured: true, connected: Boolean(connection), updatedAt: connection?.updated_at ?? null });
  }
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  const state = crypto.randomUUID();
  await supabase.from("agent_oauth_states").insert({
    state,
    user_id: userData.user.id,
    provider: "google_drive",
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
  });
  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.search = new URLSearchParams({
    client_id: settings.clientId,
    redirect_uri: settings.redirectUri,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/drive.file",
    access_type: "offline",
    prompt: "consent",
    state,
  }).toString();
  return json({ authorizationUrl: authUrl.toString() });
});

