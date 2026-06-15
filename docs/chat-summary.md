# Market Muse Derivatives Chat Summary

Date: May 30, 2026

## Goal

Create a separate Codex-ready app derived from the Lovable Market Muse project, focused on options first, with futures parked for a later phase. The tool should support smaller-account traders by emphasizing affordable, liquid option underlyings and strict risk controls.

## Current App

Folder:

```text
/Users/jaylenwilliams/Documents/Codex/2026-05-30/github-plugin-github-openai-curated-pull/market-muse-derivatives-focus
```

Latest verified local URL:

```text
http://127.0.0.1:8090/
```

## Major Decisions

- Keep the original Lovable import separate in `market-muse-ai-83`.
- Build a new focused app in `market-muse-derivatives-focus`.
- Prioritize options over futures for now.
- Prefer affordable option underlyings in the `$10-$100` stock-price range.
- Keep futures code paths dormant so they can be reintroduced later.
- Do not add journaling because trade notes will be kept on paper.
- Treat all strategy output as decision support, not guaranteed financial advice.

## Features Added

- Options-first dashboard.
- Compact three-column workstation layout:
  - setup rail
  - selected setup and workbench
  - live/options status and trade gate summary
- Workbench tabs:
  - Gate
  - Lab
  - Advisor
- Strategy Lab with modeled backtest metrics:
  - win rate
  - expectancy
  - profit factor
  - max drawdown
  - regime breakdown
  - modeled trade outcomes
- Serious Trading Controls:
  - account size
  - daily loss lock
  - max trade risk
  - minimum edge score
  - spread/event filters
  - rule toggles
- Pre-trade execution gate:
  - approved
  - wait
  - blocked
- Live options feed plumbing:
  - Alpha Vantage adapter
  - Polygon-style adapter slot
  - Supabase Edge Function proxy template
  - fallback mode when provider limits are hit
- API key redaction in provider errors.
- 52-week-high distance visuals.
- Support/resistance framework:
  - support floor
  - resistance ceiling
  - higher-timeframe trend
  - retest status
- Options playbook card:
  - 6M Call Pullback
  - Breakout Retest
  - Wait For Setup
- Affordable options candidates:
  - PLTR
  - SOFI
  - HOOD

## Strategy Concepts Incorporated

From the user-provided video breakdown:

- Use support and resistance as floors and ceilings.
- Analyze higher time frames.
- Wait for clean breakouts or retests.
- Track high-quality, fast-moving companies.
- Monitor distance from 52-week highs.
- Consider six-month call options after meaningful pullbacks from highs.
- Respect time decay and use consistent risk management.

## Data Status

Alpha Vantage key was configured locally in `.env`.

Current limitation:

- Alpha Vantage `REALTIME_OPTIONS` is returning free-tier/rate-limit messages.
- The app safely falls back to modeled data.
- Futures live data is intentionally paused.

Relevant docs:

```text
docs/live-data.md
```

## Important Files

```text
src/pages/DerivativesDashboard.tsx
src/lib/derivativesEngine.ts
src/lib/liveData.ts
src/hooks/useLiveMarketData.ts
supabase/functions/live-market-data/index.ts
docs/live-data.md
```

## Next Good Improvements

- Add a strict options-only universe editor.
- Add real options chain selection when provider access allows it.
- Add account-size-based contract affordability estimates.
- Add support/resistance editing per symbol.
- Add alerting for retest confirmed, resistance reclaim, or 52-week gap zones.
- Add a backend proxy deployment so provider keys are not exposed in browser builds.
