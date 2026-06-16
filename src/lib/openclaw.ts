// OpenClaw integration (https://github.com/openclaw/openclaw).
// OpenClaw is a self-hosted personal AI assistant with a Gateway control plane
// (`openclaw gateway --port 18789`), multi-channel comms (Slack, Discord,
// WhatsApp, WebChat, ...), and inbound webhooks. In Operator OS it is the
// operator's comms relay: Hermes pushes briefs/decisions out to whatever channel
// the operator lives in, and the operator can command the world back through it.
//
// Configure by pointing VITE_OPENCLAW_WEBHOOK_URL at an OpenClaw inbound webhook
// (Automation → Webhooks). Unset = relay offline; everything else still works.

const webhookUrl = import.meta.env.VITE_OPENCLAW_WEBHOOK_URL as string | undefined;
const gatewayUrl = (import.meta.env.VITE_OPENCLAW_GATEWAY_URL as string | undefined)?.replace(/\/$/, "") ?? "http://localhost:18789";

export type OpenclawStatus = {
  connected: boolean;
  channel: string;
  detail: string;
};

export const openclawConfigured = () => Boolean(webhookUrl);

export const openclawStatus = (): OpenclawStatus =>
  openclawConfigured()
    ? { connected: true, channel: "Gateway webhook", detail: "Relay armed. Hermes can reach the operator's channels." }
    : { connected: false, channel: gatewayUrl, detail: "Offline. Run `openclaw gateway --port 18789` and set VITE_OPENCLAW_WEBHOOK_URL." };

export type RelayEvent = {
  kind: "hermes_brief" | "approval_request" | "world_alert";
  title: string;
  body: string;
  meta?: Record<string, unknown>;
};

// Best-effort push to the operator's OpenClaw relay. Never throws; returns a
// status the UI can surface. This is a notification, not a side effect on any
// external account, so it is not approval-gated.
export const relayToOpenclaw = async (event: RelayEvent): Promise<{ ok: boolean; message: string }> => {
  if (!webhookUrl) return { ok: false, message: "OpenClaw relay is offline (set VITE_OPENCLAW_WEBHOOK_URL)." };
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "operator-os", ...event }),
    });
    if (!response.ok) return { ok: false, message: `OpenClaw relay returned HTTP ${response.status}.` };
    return { ok: true, message: "Relayed to OpenClaw." };
  } catch {
    return { ok: false, message: "Could not reach the OpenClaw gateway." };
  }
};
