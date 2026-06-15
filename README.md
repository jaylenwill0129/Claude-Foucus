# Operator OS / Market Muse

This project now contains two connected workspaces:

- **Operator OS** at `/`: a live AI-agent business world with Supabase, Stripe,
  Resend, Shopify, Google Drive, Apollo/HubSpot CRM, automation worker, planner,
  and the Hermes world-intelligence display layer.
- **Market Muse derivatives dashboard** at `/derivatives`: options, futures,
  stocks, live-data, signal, and risk-confirmation workflows.

Run locally with the workspace Node runtime:

```bash
PATH=/Users/jaylenwilliams/Documents/Codex/2026-05-30/github-plugin-github-openai-curated-pull/work/node/bin:$PATH npm run dev
```

## Live Data

The app includes live data plumbing for options and futures, but it needs provider configuration.

Recommended production path:

1. Deploy `supabase/functions/live-market-data`.
2. Store `POLYGON_API_KEY` and `FUTURES_PROXY_URL` as server-side secrets.
3. Set `VITE_LIVE_DATA_PROXY_URL` in `.env` to the deployed function URL.

Local browser-only testing can use `VITE_POLYGON_API_KEY`, but provider keys are visible in browser bundles, so do not use that for production.

## Operator OS

The real-business agent world is documented in:

- `docs/agent-business-connectors.md`
- `supabase/functions/autopilot-planner`
- `supabase/functions/automation-worker`
- `supabase/functions/crm-prospect-sync`
- `supabase/functions/stripe-webhook`
- `supabase/functions/resend-outreach`
- `supabase/functions/shopify-storefront`
- `supabase/functions/google-drive-oauth`
- `supabase/functions/google-drive-fulfillment`

Secrets belong in Supabase project secrets or local `.env` only. `.env` is
ignored by git and should not be committed.
