/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LIVE_DATA_PROXY_URL?: string;
  readonly VITE_CATALYST_PROXY_URL?: string;
  readonly VITE_BENZINGA_API_KEY?: string;
  readonly VITE_ALPHA_VANTAGE_API_KEY?: string;
  readonly VITE_POLYGON_API_KEY?: string;
  readonly VITE_OPTIONS_UNDERLYINGS?: string;
  readonly VITE_DISCOVERY_SYMBOLS?: string;
  readonly VITE_CATALYST_TOPICS?: string;
  readonly VITE_CATALYST_SCAN_MS?: string;
  readonly VITE_FUTURES_PROXY_URL?: string;
  readonly VITE_FUTURES_SYMBOLS?: string;
  readonly VITE_LIVE_POLL_MS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
