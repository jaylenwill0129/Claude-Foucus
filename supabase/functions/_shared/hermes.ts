// Shared client for the Nous Research inference API (OpenAI-compatible).
// Hermes-4 is the world-intelligence brain for Operator OS. Keep the secret
// server-side only: NOUS_API_KEY belongs in Supabase project secrets, never in
// a VITE_* variable or the browser bundle.

const NOUS_BASE_URL =
  Deno.env.get("NOUS_API_BASE_URL")?.replace(/\/$/, "") ??
  "https://inference-api.nousresearch.com/v1";

export const HERMES_MODEL =
  Deno.env.get("HERMES_MODEL") ?? "nousresearch/hermes-4-70b";

export const hermesConfigured = () => Boolean(Deno.env.get("NOUS_API_KEY"));

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type HermesResult = {
  content: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
};

type HermesOptions = {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  jsonObject?: boolean;
};

export async function callHermes(options: HermesOptions): Promise<HermesResult> {
  const apiKey = Deno.env.get("NOUS_API_KEY");
  if (!apiKey) throw new Error("NOUS_API_KEY is not configured");

  const model = options.model ?? HERMES_MODEL;
  const started = Date.now();

  const response = await fetch(`${NOUS_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: options.messages,
      temperature: options.temperature ?? 0.3,
      max_tokens: options.maxTokens ?? 900,
      ...(options.jsonObject ? { response_format: { type: "json_object" } } : {}),
    }),
  });

  const raw = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = raw?.error?.message ?? raw?.error ?? `HTTP ${response.status}`;
    throw new Error(`Hermes request failed: ${detail}`);
  }

  const content: string = raw?.choices?.[0]?.message?.content ?? "";
  return {
    content,
    model,
    promptTokens: Number(raw?.usage?.prompt_tokens ?? 0),
    completionTokens: Number(raw?.usage?.completion_tokens ?? 0),
    latencyMs: Date.now() - started,
  };
}

// Hermes sometimes wraps JSON in prose or a ```json fence. Recover the object.
export function parseHermesJson<T>(content: string): T | null {
  const trimmed = content.trim();
  const candidates: string[] = [];
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidates.push(fenced[1]);
  candidates.push(trimmed);
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first !== -1 && last > first) candidates.push(trimmed.slice(first, last + 1));

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      continue;
    }
  }
  return null;
}
