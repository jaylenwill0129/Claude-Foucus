// Operator Relay — the world's comms channel, replacing the self-hosted OpenClaw
// gateway with a zero-setup channel that actually works here: a Resend-backed
// edge function (`operator-relay`) emails the signed-in operator their Hermes
// briefs, approval requests, and world alerts. No daemon, no local port, no
// webhook to stand up — it's live the moment RESEND_* secrets are set.
//
// This is a self-notification to the account owner, triggered by the operator
// in-app (the "Relay" button) — not an autonomous external send.

import { supabase } from "@/integrations/supabase/client";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const relayUrl = supabaseUrl ? `${supabaseUrl}/functions/v1/operator-relay` : undefined;

export type RelayStatus = {
  connected: boolean;
  channel: string;
  detail: string;
};

export type RelayEvent = {
  kind: "hermes_brief" | "approval_request" | "world_alert";
  title: string;
  body: string;
  meta?: Record<string, unknown>;
};

const authHeaders = async (): Promise<Record<string, string>> => {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
};

// Real connectivity check: the operator-relay function reports whether its Resend
// provider credentials are configured. This is the ground truth for whether the
// relay "works" — no optimistic "armed" state.
export const probeOperatorRelay = async (): Promise<RelayStatus> => {
  if (!relayUrl) return { connected: false, channel: "email", detail: "Supabase URL not configured." };
  try {
    const res = await fetch(relayUrl);
    if (res.status === 404) return { connected: false, channel: "email", detail: "operator-relay function is not deployed." };
    const body = await res.json().catch(() => ({}));
    if (body?.configured) return { connected: true, channel: "Email (Resend)", detail: "Relay live. Hermes can email the operator." };
    return { connected: false, channel: "email", detail: "Function deployed but RESEND_API_KEY / RESEND_FROM_EMAIL are not set." };
  } catch {
    return { connected: false, channel: "email", detail: "Could not reach the operator-relay function." };
  }
};

// Best-effort push to the operator's relay. Never throws; returns a status the UI
// can surface. A notification to the operator's own inbox — not approval-gated.
export const relayToOperator = async (event: RelayEvent): Promise<{ ok: boolean; message: string }> => {
  if (!relayUrl) return { ok: false, message: "Relay offline (Supabase URL not configured)." };
  try {
    const res = await fetch(relayUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({ source: "operator-os", ...event }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 401) return { ok: false, message: "Sign in to relay to your email." };
    if (!res.ok || body?.ok === false) return { ok: false, message: body?.error ?? `Relay returned HTTP ${res.status}.` };
    return { ok: true, message: `Emailed to ${body?.to ?? "your inbox"}.` };
  } catch {
    return { ok: false, message: "Could not reach the operator relay." };
  }
};
