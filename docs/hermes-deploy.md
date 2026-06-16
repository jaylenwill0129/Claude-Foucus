# Hermes World-Intelligence — Deployment Runbook

Everything below runs from a **real terminal** with the Supabase CLI logged in
(`supabase login`) and linked to the project (`supabase link --project-ref rqbynqdfniniyhfqnmgb`).
These steps can't run from the IDE-embedded environment because the `supabase`
CLI isn't on its PATH.

## 1. Set server-side secrets

The Nous key is a **server secret** — never a `VITE_*` variable.

```bash
supabase secrets set \
  NOUS_API_KEY=sk-nous-xxxxxxxx \
  HERMES_MODEL=nousresearch/hermes-4-70b
```

Optional override: `NOUS_API_BASE_URL` (defaults to `https://inference-api.nousresearch.com/v1`).

The `agent-orchestrator` also reads `SUPABASE_URL` and `SUPABASE_SECRET_KEY`
(or `SUPABASE_SERVICE_ROLE_KEY`), which Supabase injects automatically.

## 2. Apply the migration

Creates `agent_hermes_briefs` (the memory table) + `agent_hermes_latest_brief` view, with RLS.

```bash
supabase db push
```

## 3. Deploy the functions

```bash
supabase functions deploy hermes-intelligence
supabase functions deploy agent-orchestrator   # now Hermes-first, OpenAI fallback
supabase functions deploy autopilot-planner     # now consumes Hermes routes
supabase functions deploy creative-studio        # Aria's preparation loop (concepts + caption, gated)
```

`creative-studio` prepares track/visual concepts and a caption with Hermes-4 and
stores an approval-ready package (`agent_creative_packages`). Audio/video
rendering needs external providers — set `MUSIC_PROVIDER_URL` / `VISUAL_PROVIDER_URL`
secrets when available; until then those stages report as `provider pending` and
nothing is posted.

## 4. Verify

```bash
# Health checks (no auth needed) — expect {"configured": true, "model": "..."}.
curl https://rqbynqdfniniyhfqnmgb.supabase.co/functions/v1/hermes-intelligence
curl https://rqbynqdfniniyhfqnmgb.supabase.co/functions/v1/agent-orchestrator
```

In the app: open `/` (Agent World), sign in, click **Probe stack**. The Hermes
card should flip from `heuristic` to `Hermes-4 live`, the command lens should show
real reasoning + per-agent routes, and the **Hermes memory** panel should start
accumulating briefs each refresh.

## How it fits together

```
Probe stack ─▶ control-plane state ─▶ hermes-intelligence (Hermes-4 + last 5 briefs as memory)
                                          │
                                          ├─▶ persists brief to agent_hermes_briefs
                                          └─▶ returns mood / bottleneck / route / agentRoutes
                                                    │
autopilot-planner ◀── reads latest brief's agentRoutes ──┘
   • skips agents Hermes marked "hold"
   • attaches Hermes directive to each job
   • outreach/send stays approval-gated regardless
```

## Evals — routing quality

Deterministic schema/rubric tests run with the normal suite (`npm test`). To check
the live model's judgment against fixtures (one blocked connector / mostly blocked /
all ready), run the gated eval:

```bash
NOUS_API_KEY=sk-nous-xxxx npm run eval:hermes
```

It sends each fixture through the same prompt + normalization the edge function
uses (`supabase/functions/_shared/hermesBriefSchema.ts`) and asserts average
routing quality ≥ 80% (grounded bottleneck, coherent score, known agents only,
no self-executed side effects, concrete next move). Baseline at time of writing:
100% across all three fixtures.

## Safety posture (do not change without an explicit decision)

Preparation is autonomous. External side effects — TikTok posting, LinkedIn/email
sends, spending, contracts, refunds, OAuth/account-security — stay approval-gated.
See agent playbooks in `supabase/functions/_shared/playbooks.ts`.
