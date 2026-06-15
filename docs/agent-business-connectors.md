# Agent Business Connectors

The Agent Business Network does not simulate business results. It remains
blocked until real server-side connectors are configured.

## Recommended first live stack

Use one focused business model first. For the initial appointment-setting and
digital-product workflows, the practical stack is:

1. **OpenAI API**: agent reasoning, tool calls, structured decisions, and
   deliverable generation.
2. **Supabase**: the source of truth for agents, jobs, prospects, approvals,
   evidence, execution receipts, customers, and the revenue ledger.
3. **Stripe**: checkout, completed payments, refunds, fees, and payouts. Stripe
   webhook events are the only source of revenue truth.
4. **Apollo or another licensed prospect source** plus **HubSpot**: real
   prospect discovery and CRM lifecycle state. Respect provider terms and
   outreach laws.
5. **Resend, Postmark, or Gmail API**: approved outbound messages and reply
   events. Start with low-volume, manually approved outreach.
6. **Shopify or Lemon Squeezy**: required only for digital products. Handles
   live listings, checkout, taxes where supported, and delivery triggers.
7. **Google Drive**: working files, customer deliverables, and fulfillment
   evidence.

Later, add QuickBooks for accounting, Slack for operator alerts, and a
scheduler such as Trigger.dev for durable background jobs.

## Full automation mode

Operator OS now has a two-part automation control plane:

- `autopilot-planner`: creates scheduled work from each enabled operator policy.
- `automation-worker`: claims due jobs, executes safe jobs, retries failures,
  and escalates anything outside policy into approval.

When Autopilot is armed, the planner can automatically create:

- Apollo to HubSpot CRM sync jobs for Maya every 4-hour planning slot.
- Shopify draft product jobs for Lena once per day.
- Outreach draft jobs for Marcus that wait for operator approval before any
  email is sent.

This is real automation, not a simulation: jobs call Supabase Edge Functions,
provider APIs, and store receipts. It is intentionally not blind automation.
Public posting, outbound messages, publication, spending, refunds, contracts,
OAuth consent, and account-security changes remain approval-gated.

For continuous unattended operation, schedule a private `POST` to:

```text
https://rqbynqdfniniyhfqnmgb.supabase.co/functions/v1/autopilot-planner
```

with the `x-automation-secret` header set to `AUTOMATION_WORKER_SECRET`. A
signed-in operator can also seed their own jobs from the app by pressing
**Arm autopilot**.

## App execution connectors

- `VITE_AGENT_CRM_WEBHOOK_URL`: prospect and customer records
- `VITE_AGENT_OUTREACH_WEBHOOK_URL`: approved email/outreach execution
- `VITE_AGENT_STOREFRONT_WEBHOOK_URL`: offer and product publishing
- `VITE_AGENT_PAYMENTS_WEBHOOK_URL`: verified payment and refund events
- `VITE_AGENT_FULFILLMENT_WEBHOOK_URL`: paid-work assignment and delivery proof

These URLs must point to trusted server-side endpoints. Provider secrets must
never be placed in browser-visible `VITE_*` variables.

Suggested mapping:

| App connector | Backing services |
| --- | --- |
| CRM | Supabase + HubSpot + licensed prospect source |
| Outreach | Resend, Postmark, or Gmail API |
| Storefront | Shopify or Lemon Squeezy |
| Payments | Stripe webhooks |
| Fulfillment | Supabase + Google Drive + provider workflow |

## Launch order

1. Connect OpenAI and Supabase to run and persist agent jobs.
2. Connect Stripe before selling so money is always verifiable.
3. Connect CRM and outreach for the appointment-setting model.
4. Connect storefront and Drive for the digital-product model.
5. Run one manually approved customer-to-cash cycle.
6. Automate only the steps that produced correct evidence and receipts.

## World layer

Operator OS treats agents as operators with bodies, workplaces, loops, and
subagents. This is how the world should be extended:

- **Hermes** is the world intelligence and display agent. Hermes reads the
  control plane, connector probes, automation jobs, approval queue, and revenue
  ledger, then turns that state into a command lens, bottleneck, route, and
  display score.
- **Bodies** describe the agent's practical interface: a researcher with a CRM
  tablet, an SDR at an outreach desk, a DJ at a studio console, or a fulfillment
  builder at a Drive workbench.
- **Places** describe where work happens: Prospect Observatory, Outbound
  Office, Signal Studio, Storefront Studio, Delivery Workshop, and Revenue
  Vault.
- **Loops** describe repeatable work: trend scan to creative package, lead
  search to CRM sync, draft to approval, payment to reconciliation.
- **Subagents** keep responsibilities narrow: research, scoring, drafting,
  upload preparation, QA, closing, reconciliation, and account health.

The Creative Label district can prepare music concepts, visual briefs, captions,
and upload packages from trend evidence. It must not blindly upload to TikTok or
run a nonstop posting loop. Community guidelines, copyright checks, account
health, and operator approval are required before any public post.

The Proactive SDR Office can run scheduled lead research, budget analysis,
personalized draft creation, HubSpot sync, and senior-closer escalation. It must
not send LinkedIn messages, emails, or web forms without approval and
provider-compliant limits.

When an approved provider API is unavailable, an OpenClaw-compatible browser
wrapper can be used as the physical interaction layer. Browser-wrapper actions
that transmit data, change account settings, post content, or contact people
remain approval-gated.

## Supabase secrets

Deploy `supabase/functions/agent-orchestrator` and configure these as Supabase
project secrets:

```bash
supabase secrets set OPENAI_API_KEY=...
supabase secrets set SUPABASE_SECRET_KEY=...
supabase secrets set OPENAI_AGENT_MODEL=gpt-5-mini
```

The function also requires the Supabase-provided `SUPABASE_URL`. Do not put the
OpenAI project key or Supabase secret key in `.env`, `VITE_*` variables, or any
client-side file.

For Stripe, configure server-side secrets separately:

```bash
supabase secrets set STRIPE_SECRET_KEY=...
supabase secrets set STRIPE_WEBHOOK_SECRET=...
```

A Stripe secret key normally has an `sk_test_` or `sk_live_` prefix. The webhook
signing secret normally has a `whsec_` prefix. Do not guess or relabel an
unidentified credential.

Configure Stripe to send relevant events to:

```text
https://<project-ref>.supabase.co/functions/v1/stripe-webhook
```

Recommended events:

- `checkout.session.completed`
- `payment_intent.succeeded`
- `charge.succeeded`
- `charge.refunded`
- `refund.created`
- `payout.paid`

## Resend outreach

Deploy `resend-outreach`, verify a sending domain in Resend, and configure:

```bash
supabase secrets set RESEND_API_KEY=...
supabase secrets set RESEND_FROM_EMAIL=agent@your-verified-domain.com
```

The connector requires an operator approval receipt and caps each approved send
at 25 recipients.

## Shopify storefront

The configured store handle is `3j0nxx-1d`, so the Admin API domain should be:

```bash
supabase secrets set SHOPIFY_STORE_DOMAIN=3j0nxx-1d.myshopify.com
supabase secrets set SHOPIFY_ADMIN_ACCESS_TOKEN=...
```

Create a Shopify custom app and grant only the required Admin API scopes. The
current connector creates draft products only. Pricing and publication remain
separate approved actions.

## Google Drive

A Google API key is not sufficient for private Drive access. Use OAuth 2.0 or a
service account with access restricted to a dedicated fulfillment folder. Do
not store a general Google API key as the Drive credential.

The provided OAuth client ID should be configured as a Supabase secret together
with its matching client secret:

```bash
supabase secrets set GOOGLE_OAUTH_CLIENT_ID=...
supabase secrets set GOOGLE_OAUTH_CLIENT_SECRET=...
supabase secrets set GOOGLE_OAUTH_REDIRECT_URI=https://rqbynqdfniniyhfqnmgb.supabase.co/functions/v1/google-drive-oauth
supabase secrets set GOOGLE_DRIVE_FULFILLMENT_FOLDER_ID=...
supabase secrets set OPERATOR_OS_APP_URL=http://127.0.0.1:8104
```

Add the same `GOOGLE_OAUTH_REDIRECT_URI` to the Google Cloud OAuth client's
authorized redirect URIs. The connector requests the narrow `drive.file` scope,
which limits access to files created or opened by Operator OS.

## Action request

Approved actions send a JSON `POST`:

```json
{
  "actionId": "publish-product",
  "approvedAt": "2026-06-15T15:00:00.000Z",
  "agent": "Lena",
  "action": "Publish first paid digital product",
  "payload": {
    "sku": "contractor-follow-up-kit",
    "priceUsd": 29
  }
}
```

The connector should validate the action, execute it through the provider API,
store an audit record, and return a non-error HTTP response only after accepting
responsibility for execution. Revenue must be recorded from provider payment
events, never forecasts or manually incremented UI values.
