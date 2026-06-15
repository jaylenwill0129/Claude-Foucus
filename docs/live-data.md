# Live Data Setup

This app can poll live options and futures data, normalize the quotes, and recalculate dashboard prices, spread filters, strategy gates, and setup ranking inputs. The trading dashboard fails closed: when no valid live option contracts are returned, it shows no trade candidates instead of substituting simulated prices.

## Preferred Architecture

Use the included Supabase Edge Function:

```text
supabase/functions/live-market-data/index.ts
```

Put secrets on the server:

```bash
supabase secrets set POLYGON_API_KEY=your_polygon_key
supabase secrets set FUTURES_PROXY_URL=https://your-futures-feed-proxy.example.com/quotes
```

Then set the frontend:

```bash
VITE_LIVE_DATA_PROXY_URL=https://your-project.functions.supabase.co/live-market-data
VITE_LIVE_POLL_MS=30000
```

## Catalyst Radar

The dashboard can scan broad news and mover data for TMHC-style events: takeovers, earnings/guidance shocks, major product/AI news, and large market movers.

Preferred production setup:

```bash
VITE_LIVE_DATA_PROXY_URL=https://your-project.functions.supabase.co/live-market-data
VITE_CATALYST_PROXY_URL=https://your-project.functions.supabase.co/live-market-data
```

Put the provider keys on the server:

```bash
supabase secrets set POLYGON_API_KEY=your_polygon_key
supabase secrets set ALPHA_VANTAGE_API_KEY=your_alpha_key
supabase secrets set BENZINGA_API_KEY=your_benzinga_key
```

The Supabase function returns normalized:

```json
{
  "catalysts": [
    {
      "symbol": "TMHC",
      "type": "takeover",
      "headline": "Cash takeover offer...",
      "movePct": 22.3,
      "urgencyScore": 98,
      "chaseRisk": "high",
      "action": "Flag immediately..."
    }
  ]
}
```

Provider behavior:

- The app scans configured catalyst providers simultaneously where possible.
- Matching tickers are merged into one alert.
- Alerts show source count and source names in the Catalyst Radar.
- Urgency is boosted when multiple independent providers corroborate the same ticker.

Supported sources:

- Catalyst proxy / Supabase function
- Benzinga newsfeed + unusual options activity
- Polygon news
- Alpha Vantage `NEWS_SENTIMENT` + `TOP_GAINERS_LOSERS`
- Reuters through a licensed Reuters/LSEG feed exposed by `VITE_REUTERS_NEWS_PROXY_URL`
- Dow Jones, including entitled WSJ and Barron's content, through `VITE_DOW_JONES_NEWS_PROXY_URL`

Reuters, Dow Jones, The Wall Street Journal, and Barron's should not be scraped. Connect licensed feeds through backend proxies that normalize results to the catalyst shape shown above. WSJ and Barron's access depends on the entitlements included in the Dow Jones agreement.

With only an Alpha Vantage key configured, the frontend adapter calls:

- `NEWS_SENTIMENT` for catalyst headlines and ticker sentiment
- `TOP_GAINERS_LOSERS` for broad market movers

Useful local settings:

```bash
VITE_CATALYST_TOPICS=mergers_and_acquisitions,earnings,financial_markets
VITE_CATALYST_SCAN_MS=300000
VITE_BENZINGA_API_KEY=local_testing_only
VITE_OPTIONS_UNDERLYINGS=SOFI,PLTR,HOOD,HPE,MGM,SMCI,IONQ,RGTI,TMHC
VITE_MAX_OPTION_UNIVERSE=100
VITE_OPTION_CONTRACTS_PER_SYMBOL=12
VITE_REUTERS_NEWS_PROXY_URL=https://your-project.functions.supabase.co/reuters-news
VITE_DOW_JONES_NEWS_PROXY_URL=https://your-project.functions.supabase.co/dow-jones-news
```

The app caches catalyst scans for `VITE_CATALYST_SCAN_MS` so the API key is not hit on every UI refresh. For real trading, keep this scanner behind the Supabase proxy and add a professional news/options-flow provider such as Polygon, Benzinga, Tradier, or Unusual Whales.

## Options

The current adapter supports Polygon-style options snapshots. It expects option contract records with:

- bid / ask
- price or close
- volume
- open interest
- implied volatility
- Greeks
- expiration
- strike
- call/put type

## Futures

Futures data usually requires licensed access. The app expects a futures proxy response shaped like:

```json
{
  "quotes": [
    {
      "symbol": "ES",
      "price": 6418.25,
      "changePct": 0.31,
      "bid": 6418.0,
      "ask": 6418.25,
      "volume": 123456,
      "updatedAt": "2026-05-30T19:00:00.000Z"
    }
  ]
}
```

Good provider candidates include Databento, Interactive Brokers, Tradovate, and CME-licensed data vendors.

## Safety

Do not ship production provider keys in `VITE_*` variables. Vite exposes them to the browser. Use the server-side proxy for real trading work.

The app's ranking and risk logic is decision support, not a guarantee of profitability. A candidate is not displayed as tradable unless a live option contract is available, and every order still requires broker-side bid/ask, volume, open-interest, and fill verification.
