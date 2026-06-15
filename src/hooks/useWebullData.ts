import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { invokeAlpacaTrade } from "@/lib/alpacaAccount";
import { useAlpacaStream } from "@/hooks/useAlpacaStream";

export interface StockData {
  symbol: string;
  name: string;
  price: string;
  change: string;
  volume: string;
  category: "gainer" | "loser" | "active";
}

export interface IndexData {
  symbol: string;
  price: string;
  change: string;
}

export interface NewsItem {
  title: string;
  url: string;
  description: string;
  source?: string;
  category?: "earnings" | "movers" | "macro" | "analysis" | "general";
}

export interface MarketData {
  gainers: StockData[];
  losers: StockData[];
  active: StockData[];
  indices: IndexData[];
}

// Stock size classification based on price + market context
export type StockSize = "bluechip" | "mega" | "large" | "mid" | "small" | "micro" | "penny";
export type VolumeLevel = "ultra" | "high" | "moderate" | "low" | "thin";

const BLUE_CHIPS = new Set([
  "AAPL","MSFT","GOOGL","GOOG","AMZN","META","NVDA","BRK.A","BRK.B","JPM",
  "V","JNJ","WMT","PG","MA","UNH","HD","DIS","BAC","XOM","PFE","KO","PEP",
  "CSCO","AVGO","ADBE","CRM","NFLX","COST","TMO","ABT","MRK","CVX","LLY",
  "ORCL","ACN","MCD","NKE","TXN","QCOM","INTU","AMAT","ISRG","LRCX","AMD",
  "GS","MS","AXP","BLK","WFC","SCHW","C","ABBV","AMGN","BMY","GILD",
  "CAT","BA","RTX","LMT","GE","HON","DE","LOW","TGT","SBUX","CMCSA",
  "COP","NEE","NOW","PANW","CRWD",
  // Top crypto treated as "blue chip" equivalent
  "BTCUSD","ETHUSD","SOLUSD",
]);

// Crypto symbol helpers
export const CRYPTO_SYMBOLS = new Set([
  // Only symbols tradable on Alpaca crypto API
  "BTCUSD","ETHUSD","SOLUSD","XRPUSD","DOGEUSD",
  "AVAXUSD","DOTUSD","LINKUSD","UNIUSD","AAVEUSD",
  "LTCUSD","BCHUSD","SHIBUSD","PEPEUSD",
  "GRTUSD","YFIUSD","MKRUSD","CRVUSD","SUSHIUSD","BATUSD","XTZUSD",
  "USDCUSD","USDTUSD",
]);

export function isCryptoSymbol(symbol: string): boolean {
  return CRYPTO_SYMBOLS.has(symbol) || symbol.endsWith("USD") && symbol.length > 4 && !symbol.includes("/");
}

// Convert display symbol (BTCUSD) to Alpaca trading format (BTC/USD)
export function toAlpacaCryptoSymbol(displaySymbol: string): string {
  return displaySymbol.replace(/USD$/, "/USD");
}

// Get display name for crypto
export function getCryptoName(symbol: string): string {
  const CRYPTO_NAMES: Record<string, string> = {
    BTCUSD: "Bitcoin", ETHUSD: "Ethereum", SOLUSD: "Solana", XRPUSD: "XRP",
    ADAUSD: "Cardano", DOGEUSD: "Dogecoin", AVAXUSD: "Avalanche", DOTUSD: "Polkadot",
    MATICUSD: "Polygon", LINKUSD: "Chainlink", UNIUSD: "Uniswap", AAVEUSD: "Aave",
    LTCUSD: "Litecoin", BCHUSD: "Bitcoin Cash", SHIBUSD: "Shiba Inu", PEPEUSD: "Pepe",
    ARBUSD: "Arbitrum", OPUSD: "Optimism", NEARUSD: "NEAR Protocol", SUIUSD: "Sui",
    APTUSD: "Aptos", FILUSD: "Filecoin", ATOMUSD: "Cosmos", ALGOUSD: "Algorand",
    XLMUSD: "Stellar", HBARUSD: "Hedera", ICPUSD: "Internet Computer", VETUSD: "VeChain",
    FTMUSD: "Fantom", SANDUSD: "The Sandbox", MANAUSD: "Decentraland", AXSUSD: "Axie Infinity",
    RNDRUSD: "Render", GRTUSD: "The Graph", IMXUSD: "Immutable X", INJUSD: "Injective",
    TIAUSD: "Celestia", SEIUSD: "Sei", JUPUSD: "Jupiter", WUSD: "Wormhole",
    BONKUSD: "Bonk", WIFUSD: "Dogwifhat",
  };
  return CRYPTO_NAMES[symbol] || symbol.replace(/USD$/, "");
}

export function classifyStockSize(price: number, symbol?: string): StockSize {
  if (symbol && BLUE_CHIPS.has(symbol) && price >= 50) return "bluechip";
  if (price >= 500) return "mega";
  if (price >= 100) return "large";
  if (price >= 20) return "mid";
  if (price >= 5) return "small";
  if (price >= 1) return "micro";
  return "penny";
}

export function classifyVolume(volumeStr: string): VolumeLevel {
  const raw = volumeStr.replace(/[^\d.]/g, "");
  let vol = parseFloat(raw) || 0;
  if (volumeStr.includes("B")) vol *= 1000;
  else if (volumeStr.includes("K")) vol /= 1000;
  if (vol >= 100) return "ultra";
  if (vol >= 30) return "high";
  if (vol >= 5) return "moderate";
  if (vol >= 1) return "low";
  return "thin";
}

export const STOCK_SIZE_CONFIG: Record<StockSize, { label: string; color: string; description: string }> = {
  bluechip: { label: "BLUE CHIP", color: "text-primary", description: "Top-tier established company" },
  mega: { label: "MEGA", color: "text-accent", description: "$500+ share price" },
  large: { label: "LARGE", color: "text-gain", description: "$100-$500 share price" },
  mid: { label: "MID", color: "text-foreground", description: "$20-$100 share price" },
  small: { label: "SMALL", color: "text-warning", description: "$5-$20 share price" },
  micro: { label: "MICRO", color: "text-muted-foreground", description: "$1-$5 share price" },
  penny: { label: "PENNY", color: "text-loss", description: "Under $1 — high risk" },
};

export const VOLUME_CONFIG: Record<VolumeLevel, { label: string; color: string }> = {
  ultra: { label: "ULTRA VOL", color: "text-primary" },
  high: { label: "HIGH VOL", color: "text-gain" },
  moderate: { label: "MOD VOL", color: "text-foreground" },
  low: { label: "LOW VOL", color: "text-warning" },
  thin: { label: "THIN", color: "text-loss" },
};

// Convert StockData to a TickerData-like format for compatibility
export interface TickerData {
  symbol: string;
  name: string;
  price: string;
  priceChange: string;
  priceChangePercent: string;
  high: string;
  low: string;
  volume: string;
  quoteVolume: string;
  category: "gainer" | "loser" | "active";
  stockSize: StockSize;
  volumeLevel: VolumeLevel;
  sources?: string[];
  profitExpectancy: number; // 0-100 composite score
}

// Calculate profitability expectancy score (0-100)
// Factors: momentum (% change direction + magnitude), volume strength, stock tier, category
export function calcProfitExpectancy(
  price: number, changePct: number, volumeLevel: VolumeLevel, stockSize: StockSize, category: string
): number {
  // Momentum score (0-35): positive change = higher, magnitude matters
  const absPct = Math.abs(changePct);
  const momentumDir = changePct >= 0 ? 1 : 0.4; // gainers get full weight
  const momentumMag = Math.min(absPct / 5, 1); // cap at 5%
  const momentum = (momentumDir * 0.6 + momentumMag * 0.4) * 35;

  // Volume score (0-25): higher volume = more reliable signal
  const volScores: Record<VolumeLevel, number> = { ultra: 25, high: 20, moderate: 14, low: 7, thin: 2 };
  const volScore = volScores[volumeLevel];

  // Tier score (0-20): blue chips more reliable, but small caps have higher upside
  const tierScores: Record<StockSize, number> = { bluechip: 18, mega: 16, large: 15, mid: 17, small: 14, micro: 8, penny: 3 };
  const tierScore = tierScores[stockSize];

  // Category bonus (0-20): gainers > active > losers (for profit expectancy)
  const catScores: Record<string, number> = { gainer: 20, active: 12, loser: 5 };
  const catScore = catScores[category] || 10;

  return Math.round(Math.min(100, Math.max(0, momentum + volScore + tierScore + catScore)));
}

function stockToTicker(s: StockData & { sources?: string[]; high?: string; low?: string }): TickerData {
  const pct = s.change.replace(/[^0-9.+-]/g, "");
  const price = Math.max(0, parseFloat(s.price.replace(/,/g, "")) || 0);
  const changeAmt = price * (parseFloat(pct) / 100);
  const size = classifyStockSize(price, s.symbol);
  const vol = classifyVolume(s.volume || "0");
  // Use real high/low if provided, otherwise estimate from change %
  const changeMag = Math.abs(parseFloat(pct) || 0) / 100;
  const estimatedRange = Math.max(changeMag * 1.5, 0.005); // at least 0.5% range
  let high = s.high ? s.high : (price * (1 + estimatedRange)).toFixed(2);
  let low = s.low ? s.low : (price * (1 - estimatedRange)).toFixed(2);
  // Sanitize: prices can't be negative
  if (parseFloat(low) < 0) low = (price * 0.9).toFixed(2);
  if (parseFloat(high) < 0) high = (price * 1.1).toFixed(2);
  return {
    symbol: s.symbol,
    name: s.name,
    price: s.price === "--" ? "0" : s.price,
    priceChange: changeAmt.toFixed(2),
    priceChangePercent: pct || "0",
    high,
    low,
    volume: s.volume || "0",
    quoteVolume: "0",
    category: s.category,
    stockSize: size,
    volumeLevel: vol,
    sources: s.sources || [],
    profitExpectancy: calcProfitExpectancy(price, parseFloat(pct) || 0, vol, size, s.category),
  };
}

// Fallback market data when Firecrawl is unavailable
const FALLBACK_MARKET_DATA: MarketData = {
  indices: [
    { symbol: "DIA", price: "451.39", change: "-1.72%" },
    { symbol: "SPY", price: "634.09", change: "-1.71%" },
    { symbol: "QQQ", price: "562.58", change: "-1.95%" },
  ],
  gainers: [
    { symbol: "AAPL", name: "Apple Inc", price: "224.50", change: "+1.25%", volume: "45.2M", category: "gainer" },
    { symbol: "MSFT", name: "Microsoft Corp", price: "420.80", change: "+0.85%", volume: "22.1M", category: "gainer" },
    { symbol: "GOOGL", name: "Alphabet Inc", price: "295.69", change: "+1.10%", volume: "18.5M", category: "gainer" },
    { symbol: "AMZN", name: "Amazon.com Inc", price: "198.50", change: "+0.95%", volume: "32.8M", category: "gainer" },
    { symbol: "META", name: "Meta Platforms", price: "585.20", change: "+1.40%", volume: "15.3M", category: "gainer" },
    { symbol: "LLY", name: "Eli Lilly & Co", price: "782.40", change: "+2.10%", volume: "8.4M", category: "gainer" },
    { symbol: "V", name: "Visa Inc", price: "312.60", change: "+0.65%", volume: "6.2M", category: "gainer" },
    { symbol: "AVGO", name: "Broadcom Inc", price: "314.46", change: "+1.80%", volume: "12.7M", category: "gainer" },
  ],
  losers: [
    { symbol: "TSLA", name: "Tesla Inc", price: "361.04", change: "-2.15%", volume: "88.5M", category: "loser" },
    { symbol: "AMD", name: "Advanced Micro Devices", price: "217.57", change: "-1.85%", volume: "42.1M", category: "loser" },
    { symbol: "INTC", name: "Intel Corp", price: "50.35", change: "-3.20%", volume: "55.2M", category: "loser" },
    { symbol: "BA", name: "Boeing Co", price: "168.90", change: "-2.50%", volume: "8.7M", category: "loser" },
    { symbol: "PYPL", name: "PayPal Holdings", price: "45.35", change: "-1.95%", volume: "12.4M", category: "loser" },
    { symbol: "NKE", name: "Nike Inc", price: "44.19", change: "-2.80%", volume: "14.6M", category: "loser" },
    { symbol: "DIS", name: "Walt Disney Co", price: "108.50", change: "-1.40%", volume: "9.8M", category: "loser" },
    { symbol: "UBER", name: "Uber Technologies", price: "72.40", change: "-1.60%", volume: "18.3M", category: "loser" },
  ],
  active: [
    { symbol: "NVDA", name: "NVIDIA Corp", price: "167.52", change: "-2.17%", volume: "185.3M", category: "active" },
    { symbol: "PLTR", name: "Palantir Technologies", price: "148.57", change: "+3.20%", volume: "72.1M", category: "active" },
    { symbol: "SOFI", name: "SoFi Technologies", price: "15.87", change: "+2.50%", volume: "65.8M", category: "active" },
    { symbol: "MARA", name: "Marathon Digital", price: "8.7", change: "+4.10%", volume: "48.5M", category: "active" },
    { symbol: "CRM", name: "Salesforce Inc", price: "187.15", change: "+1.15%", volume: "10.2M", category: "active" },
    { symbol: "NFLX", name: "Netflix Inc", price: "98.39", change: "+0.90%", volume: "7.5M", category: "active" },
    { symbol: "JPM", name: "JPMorgan Chase", price: "294.71", change: "-0.45%", volume: "11.4M", category: "active" },
    { symbol: "COIN", name: "Coinbase Global", price: "171.39", change: "+3.60%", volume: "14.9M", category: "active" },
  ],
};

// Always-available enrichment stocks — injected if not already in live data
const ENRICHMENT_STOCKS: StockData[] = [
  // Tech Giants
  { symbol: "AAPL", name: "Apple Inc", price: "224.50", change: "+1.25%", volume: "45.2M", category: "active" },
  { symbol: "MSFT", name: "Microsoft Corp", price: "420.80", change: "+0.85%", volume: "22.1M", category: "active" },
  { symbol: "GOOGL", name: "Alphabet Inc", price: "295.69", change: "+1.10%", volume: "18.5M", category: "active" },
  { symbol: "AMZN", name: "Amazon.com Inc", price: "198.50", change: "+0.95%", volume: "32.8M", category: "active" },
  { symbol: "META", name: "Meta Platforms", price: "585.20", change: "+1.40%", volume: "15.3M", category: "active" },
  { symbol: "NVDA", name: "NVIDIA Corp", price: "167.52", change: "-2.17%", volume: "185.3M", category: "active" },
  { symbol: "TSLA", name: "Tesla Inc", price: "361.04", change: "-2.15%", volume: "88.5M", category: "active" },
  { symbol: "AVGO", name: "Broadcom Inc", price: "314.46", change: "+1.80%", volume: "12.7M", category: "active" },
  { symbol: "ADBE", name: "Adobe Inc", price: "242.91", change: "-0.55%", volume: "4.2M", category: "active" },
  { symbol: "CRM", name: "Salesforce Inc", price: "187.15", change: "+1.15%", volume: "10.2M", category: "active" },
  { symbol: "ORCL", name: "Oracle Corp", price: "178.90", change: "+0.65%", volume: "8.7M", category: "active" },
  { symbol: "AMD", name: "Advanced Micro Devices", price: "217.57", change: "-1.85%", volume: "42.1M", category: "active" },
  { symbol: "INTC", name: "Intel Corp", price: "50.35", change: "-1.10%", volume: "38.5M", category: "active" },
  { symbol: "NFLX", name: "Netflix Inc", price: "98.39", change: "+0.90%", volume: "7.5M", category: "active" },
  { symbol: "CSCO", name: "Cisco Systems", price: "79.02", change: "+0.45%", volume: "14.8M", category: "active" },
  { symbol: "QCOM", name: "Qualcomm Inc", price: "126.84", change: "+1.30%", volume: "8.9M", category: "active" },
  { symbol: "INTU", name: "Intuit Inc", price: "422.26", change: "+0.70%", volume: "2.1M", category: "active" },
  { symbol: "AMAT", name: "Applied Materials", price: "348.42", change: "+1.55%", volume: "6.4M", category: "active" },
  { symbol: "NOW", name: "ServiceNow Inc", price: "101.97", change: "+1.20%", volume: "2.3M", category: "active" },
  { symbol: "UBER", name: "Uber Technologies", price: "78.40", change: "+2.10%", volume: "18.6M", category: "active" },
  { symbol: "SQ", name: "Block Inc", price: "86.95", change: "+2.45%", volume: "11.2M", category: "active" },
  { symbol: "SHOP", name: "Shopify Inc", price: "105.80", change: "+1.80%", volume: "9.4M", category: "active" },
  { symbol: "SNOW", name: "Snowflake Inc", price: "168.50", change: "-0.90%", volume: "5.7M", category: "active" },
  { symbol: "PANW", name: "Palo Alto Networks", price: "163.27", change: "+1.35%", volume: "4.5M", category: "active" },
  { symbol: "CRWD", name: "CrowdStrike", price: "348.90", change: "+1.60%", volume: "5.1M", category: "active" },
  { symbol: "MRVL", name: "Marvell Technology", price: "107.09", change: "+2.30%", volume: "14.2M", category: "active" },
  { symbol: "MU", name: "Micron Technology", price: "366.21", change: "-1.40%", volume: "16.8M", category: "active" },
  { symbol: "LRCX", name: "Lam Research", price: "218.31", change: "+1.15%", volume: "4.8M", category: "active" },
  // Finance
  { symbol: "JPM", name: "JPMorgan Chase", price: "294.71", change: "-0.45%", volume: "11.4M", category: "active" },
  { symbol: "V", name: "Visa Inc", price: "312.60", change: "+0.65%", volume: "6.2M", category: "active" },
  { symbol: "MA", name: "Mastercard Inc", price: "518.30", change: "+0.35%", volume: "3.8M", category: "active" },
  { symbol: "BAC", name: "Bank of America", price: "42.80", change: "-0.30%", volume: "28.5M", category: "active" },
  { symbol: "WFC", name: "Wells Fargo", price: "80.61", change: "+0.55%", volume: "14.2M", category: "active" },
  { symbol: "GS", name: "Goldman Sachs", price: "863.37", change: "+0.80%", volume: "3.4M", category: "active" },
  { symbol: "MS", name: "Morgan Stanley", price: "165.79", change: "+0.45%", volume: "7.1M", category: "active" },
  { symbol: "AXP", name: "American Express", price: "268.50", change: "+0.70%", volume: "3.8M", category: "active" },
  { symbol: "BLK", name: "BlackRock Inc", price: "892.30", change: "+0.55%", volume: "1.2M", category: "active" },
  { symbol: "SCHW", name: "Charles Schwab", price: "78.40", change: "+1.10%", volume: "8.6M", category: "active" },
  { symbol: "C", name: "Citigroup Inc", price: "115.24", change: "-0.25%", volume: "12.4M", category: "active" },
  { symbol: "COIN", name: "Coinbase Global", price: "171.39", change: "+3.60%", volume: "14.9M", category: "active" },
  { symbol: "PYPL", name: "PayPal Holdings", price: "45.35", change: "+1.90%", volume: "12.3M", category: "active" },
  // Healthcare
  { symbol: "JNJ", name: "Johnson & Johnson", price: "243.03", change: "+0.30%", volume: "7.8M", category: "active" },
  { symbol: "UNH", name: "UnitedHealth Group", price: "277.23", change: "-0.70%", volume: "4.1M", category: "active" },
  { symbol: "LLY", name: "Eli Lilly & Co", price: "782.40", change: "+2.10%", volume: "8.4M", category: "active" },
  { symbol: "MRK", name: "Merck & Co", price: "125.30", change: "+0.90%", volume: "9.1M", category: "active" },
  { symbol: "PFE", name: "Pfizer Inc", price: "28.60", change: "-0.80%", volume: "25.1M", category: "active" },
  { symbol: "ABT", name: "Abbott Laboratories", price: "118.50", change: "+0.65%", volume: "5.2M", category: "active" },
  { symbol: "TMO", name: "Thermo Fisher", price: "568.40", change: "+0.45%", volume: "2.1M", category: "active" },
  { symbol: "ABBV", name: "AbbVie Inc", price: "178.90", change: "+1.20%", volume: "7.3M", category: "active" },
  { symbol: "BMY", name: "Bristol-Myers Squibb", price: "52.40", change: "-0.40%", volume: "9.8M", category: "active" },
  { symbol: "AMGN", name: "Amgen Inc", price: "312.80", change: "+0.55%", volume: "3.2M", category: "active" },
  { symbol: "ISRG", name: "Intuitive Surgical", price: "425.60", change: "+1.30%", volume: "2.8M", category: "active" },
  { symbol: "GILD", name: "Gilead Sciences", price: "139.69", change: "+0.70%", volume: "6.4M", category: "active" },
  { symbol: "NVO", name: "Novo Nordisk", price: "36.97", change: "+2.80%", volume: "12.5M", category: "active" },
  // Consumer / Retail
  { symbol: "WMT", name: "Walmart Inc", price: "125.79", change: "+0.55%", volume: "6.9M", category: "active" },
  { symbol: "PG", name: "Procter & Gamble", price: "172.80", change: "+0.40%", volume: "5.4M", category: "active" },
  { symbol: "KO", name: "Coca-Cola Co", price: "76.72", change: "+0.20%", volume: "10.1M", category: "active" },
  { symbol: "PEP", name: "PepsiCo Inc", price: "145.70", change: "-0.15%", volume: "5.3M", category: "active" },
  { symbol: "COST", name: "Costco Wholesale", price: "925.40", change: "+0.90%", volume: "2.8M", category: "active" },
  { symbol: "HD", name: "Home Depot", price: "385.40", change: "-1.10%", volume: "5.6M", category: "active" },
  { symbol: "MCD", name: "McDonald's Corp", price: "298.50", change: "+0.35%", volume: "3.6M", category: "active" },
  { symbol: "NKE", name: "Nike Inc", price: "44.19", change: "-1.50%", volume: "8.9M", category: "active" },
  { symbol: "SBUX", name: "Starbucks Corp", price: "98.70", change: "+0.60%", volume: "7.2M", category: "active" },
  { symbol: "TGT", name: "Target Corp", price: "142.30", change: "-0.85%", volume: "4.5M", category: "active" },
  { symbol: "LOW", name: "Lowe's Companies", price: "258.90", change: "-0.70%", volume: "3.8M", category: "active" },
  { symbol: "DIS", name: "Walt Disney Co", price: "112.40", change: "+1.45%", volume: "12.1M", category: "active" },
  { symbol: "CMCSA", name: "Comcast Corp", price: "27.93", change: "+0.50%", volume: "18.2M", category: "active" },
  // Energy
  { symbol: "XOM", name: "Exxon Mobil", price: "160.73", change: "+1.80%", volume: "15.2M", category: "active" },
  { symbol: "CVX", name: "Chevron Corp", price: "198.97", change: "+1.50%", volume: "7.3M", category: "active" },
  { symbol: "COP", name: "ConocoPhillips", price: "112.40", change: "+1.60%", volume: "5.8M", category: "active" },
  { symbol: "SLB", name: "Schlumberger Ltd", price: "48.70", change: "+2.10%", volume: "9.4M", category: "active" },
  { symbol: "EOG", name: "EOG Resources", price: "128.30", change: "+1.40%", volume: "3.9M", category: "active" },
  // Industrial / Defense
  { symbol: "CAT", name: "Caterpillar Inc", price: "717.38", change: "+0.95%", volume: "3.2M", category: "active" },
  { symbol: "BA", name: "Boeing Co", price: "178.50", change: "-1.80%", volume: "8.5M", category: "active" },
  { symbol: "RTX", name: "RTX Corp", price: "196.21", change: "+0.75%", volume: "5.4M", category: "active" },
  { symbol: "LMT", name: "Lockheed Martin", price: "622.83", change: "+0.45%", volume: "2.1M", category: "active" },
  { symbol: "GE", name: "GE Aerospace", price: "281.12", change: "+1.20%", volume: "6.8M", category: "active" },
  { symbol: "HON", name: "Honeywell Intl", price: "208.30", change: "+0.35%", volume: "3.5M", category: "active" },
  { symbol: "UPS", name: "United Parcel Service", price: "98.18", change: "-0.90%", volume: "4.2M", category: "active" },
  { symbol: "DE", name: "Deere & Company", price: "575.4", change: "+0.80%", volume: "2.4M", category: "active" },
  // Telecom / Utilities
  { symbol: "T", name: "AT&T Inc", price: "28.32", change: "+0.45%", volume: "32.5M", category: "active" },
  { symbol: "VZ", name: "Verizon Comms", price: "42.30", change: "+0.30%", volume: "15.8M", category: "active" },
  { symbol: "NEE", name: "NextEra Energy", price: "78.50", change: "+0.85%", volume: "8.2M", category: "active" },
  // Trending / Growth
  { symbol: "PLTR", name: "Palantir Technologies", price: "148.57", change: "+3.20%", volume: "72.1M", category: "active" },
  { symbol: "SOFI", name: "SoFi Technologies", price: "15.87", change: "+4.50%", volume: "28.4M", category: "active" },
  { symbol: "RIVN", name: "Rivian Automotive", price: "14.20", change: "-3.10%", volume: "22.8M", category: "active" },
  { symbol: "LCID", name: "Lucid Group", price: "9.96", change: "-2.80%", volume: "18.5M", category: "active" },
  { symbol: "ARM", name: "Arm Holdings", price: "152.30", change: "+2.40%", volume: "8.9M", category: "active" },
  { symbol: "SMCI", name: "Super Micro Computer", price: "23.21", change: "+5.20%", volume: "35.2M", category: "active" },
  { symbol: "MSTR", name: "MicroStrategy", price: "119.84", change: "+4.80%", volume: "6.4M", category: "active" },
  { symbol: "RKLB", name: "Rocket Lab USA", price: "67.74", change: "+3.60%", volume: "15.2M", category: "active" },
  { symbol: "IONQ", name: "IonQ Inc", price: "28.90", change: "+5.80%", volume: "12.1M", category: "active" },
  { symbol: "HOOD", name: "Robinhood Markets", price: "68.92", change: "+2.90%", volume: "14.8M", category: "active" },
  // === EXPANDED POOL: More S&P 500 & High-Volume Stocks ===
  // Tech — Extended
  { symbol: "IBM", name: "IBM Corp", price: "218.40", change: "+0.65%", volume: "4.2M", category: "active" },
  { symbol: "TXN", name: "Texas Instruments", price: "192.80", change: "+0.55%", volume: "5.1M", category: "active" },
  { symbol: "KLAC", name: "KLA Corp", price: "1516.94", change: "+1.20%", volume: "1.8M", category: "active" },
  { symbol: "SNPS", name: "Synopsys Inc", price: "395.97", change: "+0.90%", volume: "1.5M", category: "active" },
  { symbol: "CDNS", name: "Cadence Design", price: "298.40", change: "+1.10%", volume: "2.3M", category: "active" },
  { symbol: "ADSK", name: "Autodesk Inc", price: "278.60", change: "+0.80%", volume: "2.1M", category: "active" },
  { symbol: "WDAY", name: "Workday Inc", price: "132.22", change: "+1.30%", volume: "2.8M", category: "active" },
  { symbol: "ZS", name: "Zscaler Inc", price: "138.57", change: "+2.10%", volume: "3.2M", category: "active" },
  { symbol: "DDOG", name: "Datadog Inc", price: "128.90", change: "+1.80%", volume: "5.4M", category: "active" },
  { symbol: "NET", name: "Cloudflare Inc", price: "211.72", change: "+2.50%", volume: "7.1M", category: "active" },
  { symbol: "FTNT", name: "Fortinet Inc", price: "82.30", change: "+1.45%", volume: "4.8M", category: "active" },
  { symbol: "TEAM", name: "Atlassian Corp", price: "68.3", change: "+1.60%", volume: "2.5M", category: "active" },
  { symbol: "DOCN", name: "DigitalOcean", price: "90.11", change: "+2.80%", volume: "3.8M", category: "active" },
  { symbol: "TTD", name: "The Trade Desk", price: "22.04", change: "+3.10%", volume: "6.2M", category: "active" },
  { symbol: "SPOT", name: "Spotify Tech", price: "558.40", change: "+1.90%", volume: "3.5M", category: "active" },
  { symbol: "ROKU", name: "Roku Inc", price: "97.66", change: "+2.60%", volume: "8.4M", category: "active" },
  { symbol: "TWLO", name: "Twilio Inc", price: "130.93", change: "+1.70%", volume: "4.2M", category: "active" },
  { symbol: "OKTA", name: "Okta Inc", price: "98.30", change: "+1.40%", volume: "3.1M", category: "active" },
  { symbol: "MDB", name: "MongoDB Inc", price: "268.50", change: "+2.20%", volume: "2.8M", category: "active" },
  { symbol: "ABNB", name: "Airbnb Inc", price: "148.60", change: "+1.50%", volume: "6.8M", category: "active" },
  { symbol: "DASH", name: "DoorDash Inc", price: "178.40", change: "+2.30%", volume: "5.4M", category: "active" },
  { symbol: "PINS", name: "Pinterest Inc", price: "18.17", change: "+2.40%", volume: "9.2M", category: "active" },
  { symbol: "SNAP", name: "Snap Inc", price: "4.65", change: "+3.80%", volume: "22.5M", category: "active" },
  { symbol: "U", name: "Unity Software", price: "22.30", change: "+2.90%", volume: "8.7M", category: "active" },
  { symbol: "PATH", name: "UiPath Inc", price: "11.25", change: "+1.60%", volume: "6.5M", category: "active" },
  { symbol: "BILL", name: "BILL Holdings", price: "38.67", change: "+2.10%", volume: "3.4M", category: "active" },
  { symbol: "HUBS", name: "HubSpot Inc", price: "244.55", change: "+1.30%", volume: "1.2M", category: "active" },
  { symbol: "ZM", name: "Zoom Video", price: "68.90", change: "+0.80%", volume: "5.8M", category: "active" },
  { symbol: "DELL", name: "Dell Technologies", price: "174.31", change: "+1.70%", volume: "7.2M", category: "active" },
  { symbol: "HPE", name: "Hewlett Packard Ent", price: "24.62", change: "+1.20%", volume: "12.5M", category: "active" },
  { symbol: "GDDY", name: "GoDaddy Inc", price: "81.64", change: "+0.90%", volume: "2.1M", category: "active" },
  // Finance — Extended
  { symbol: "USB", name: "US Bancorp", price: "48.30", change: "+0.65%", volume: "6.8M", category: "active" },
  { symbol: "PNC", name: "PNC Financial", price: "178.90", change: "+0.55%", volume: "3.2M", category: "active" },
  { symbol: "TFC", name: "Truist Financial", price: "42.80", change: "+0.80%", volume: "5.4M", category: "active" },
  { symbol: "CME", name: "CME Group", price: "305.07", change: "+0.45%", volume: "2.8M", category: "active" },
  { symbol: "ICE", name: "Intercont Exchange", price: "152.30", change: "+0.70%", volume: "3.5M", category: "active" },
  { symbol: "SPGI", name: "S&P Global", price: "478.60", change: "+0.60%", volume: "1.8M", category: "active" },
  { symbol: "MCO", name: "Moody's Corp", price: "428.90", change: "+0.55%", volume: "1.4M", category: "active" },
  { symbol: "MMC", name: "Marsh McLennan", price: "218.50", change: "+0.40%", volume: "2.1M", category: "active" },
  { symbol: "AON", name: "Aon plc", price: "348.20", change: "+0.35%", volume: "1.2M", category: "active" },
  { symbol: "FIS", name: "Fidelity National", price: "46.28", change: "+1.10%", volume: "5.8M", category: "active" },
  { symbol: "AFRM", name: "Affirm Holdings", price: "52.80", change: "+3.40%", volume: "9.5M", category: "active" },
  // Healthcare — Extended
  { symbol: "DHR", name: "Danaher Corp", price: "191.03", change: "+0.70%", volume: "3.2M", category: "active" },
  { symbol: "SYK", name: "Stryker Corp", price: "378.40", change: "+0.85%", volume: "1.8M", category: "active" },
  { symbol: "BSX", name: "Boston Scientific", price: "62.83", change: "+1.20%", volume: "5.4M", category: "active" },
  { symbol: "MDT", name: "Medtronic plc", price: "88.30", change: "+0.55%", volume: "4.8M", category: "active" },
  { symbol: "ELV", name: "Elevance Health", price: "300.84", change: "-0.60%", volume: "2.1M", category: "active" },
  { symbol: "HUM", name: "Humana Inc", price: "177.84", change: "-0.45%", volume: "1.5M", category: "active" },
  { symbol: "CI", name: "Cigna Group", price: "270.12", change: "+0.40%", volume: "2.3M", category: "active" },
  { symbol: "ZTS", name: "Zoetis Inc", price: "117.93", change: "+0.90%", volume: "2.8M", category: "active" },
  { symbol: "REGN", name: "Regeneron Pharma", price: "761.93", change: "+1.10%", volume: "1.2M", category: "active" },
  { symbol: "VRTX", name: "Vertex Pharma", price: "458.90", change: "+1.50%", volume: "2.4M", category: "active" },
  { symbol: "MRNA", name: "Moderna Inc", price: "42.30", change: "+4.20%", volume: "18.5M", category: "active" },
  { symbol: "DXCM", name: "DexCom Inc", price: "62.21", change: "+2.30%", volume: "4.2M", category: "active" },
  // Consumer — Extended
  { symbol: "CL", name: "Colgate-Palmolive", price: "98.40", change: "+0.30%", volume: "3.8M", category: "active" },
  { symbol: "EL", name: "Estée Lauder", price: "78.60", change: "-1.20%", volume: "4.5M", category: "active" },
  { symbol: "MNST", name: "Monster Beverage", price: "72.39", change: "+0.70%", volume: "5.2M", category: "active" },
  { symbol: "STZ", name: "Constellation Brands", price: "151.15", change: "+0.55%", volume: "1.8M", category: "active" },
  { symbol: "GIS", name: "General Mills", price: "37.41", change: "+0.25%", volume: "4.1M", category: "active" },
  { symbol: "KHC", name: "Kraft Heinz Co", price: "22.78", change: "-0.40%", volume: "6.8M", category: "active" },
  { symbol: "SYY", name: "Sysco Corp", price: "78.50", change: "+0.60%", volume: "3.2M", category: "active" },
  { symbol: "ROST", name: "Ross Stores", price: "220.03", change: "+1.10%", volume: "2.8M", category: "active" },
  { symbol: "TJX", name: "TJX Companies", price: "161.27", change: "+0.80%", volume: "4.5M", category: "active" },
  { symbol: "LULU", name: "Lululemon", price: "155.73", change: "+1.60%", volume: "3.1M", category: "active" },
  { symbol: "YUM", name: "Yum! Brands", price: "138.20", change: "+0.45%", volume: "2.4M", category: "active" },
  { symbol: "CMG", name: "Chipotle Mexican", price: "33.16", change: "+1.30%", volume: "4.8M", category: "active" },
  { symbol: "DHI", name: "D.R. Horton", price: "148.60", change: "+1.40%", volume: "3.5M", category: "active" },
  { symbol: "LEN", name: "Lennar Corp", price: "86.46", change: "+1.20%", volume: "2.8M", category: "active" },
  // Energy — Extended
  { symbol: "OXY", name: "Occidental Petroleum", price: "58.40", change: "+2.30%", volume: "12.8M", category: "active" },
  { symbol: "PSX", name: "Phillips 66", price: "176.24", change: "+1.80%", volume: "3.5M", category: "active" },
  { symbol: "VLO", name: "Valero Energy", price: "244.06", change: "+2.10%", volume: "3.8M", category: "active" },
  { symbol: "MPC", name: "Marathon Petroleum", price: "241.81", change: "+1.90%", volume: "4.2M", category: "active" },
  { symbol: "HAL", name: "Halliburton Co", price: "32.80", change: "+2.40%", volume: "8.5M", category: "active" },
  { symbol: "DVN", name: "Devon Energy", price: "42.30", change: "+2.60%", volume: "7.2M", category: "active" },
  { symbol: "FANG", name: "Diamondback Energy", price: "168.50", change: "+1.70%", volume: "2.8M", category: "active" },
  { symbol: "KMI", name: "Kinder Morgan", price: "32.96", change: "+0.90%", volume: "14.5M", category: "active" },
  { symbol: "WMB", name: "Williams Companies", price: "72.01", change: "+1.20%", volume: "6.8M", category: "active" },
  // Industrial — Extended
  { symbol: "UNP", name: "Union Pacific", price: "248.30", change: "+0.65%", volume: "3.2M", category: "active" },
  { symbol: "MMM", name: "3M Company", price: "128.40", change: "+1.10%", volume: "4.5M", category: "active" },
  { symbol: "EMR", name: "Emerson Electric", price: "118.60", change: "+0.85%", volume: "3.1M", category: "active" },
  { symbol: "ITW", name: "Illinois Tool Works", price: "258.90", change: "+0.55%", volume: "1.8M", category: "active" },
  { symbol: "ROK", name: "Rockwell Automation", price: "364.92", change: "+0.70%", volume: "1.2M", category: "active" },
  { symbol: "ETN", name: "Eaton Corp", price: "308.50", change: "+1.30%", volume: "2.4M", category: "active" },
  { symbol: "PH", name: "Parker-Hannifin", price: "908.27", change: "+0.90%", volume: "1.5M", category: "active" },
  { symbol: "WM", name: "Waste Management", price: "212.30", change: "+0.45%", volume: "2.8M", category: "active" },
  { symbol: "GD", name: "General Dynamics", price: "298.40", change: "+0.60%", volume: "1.8M", category: "active" },
  { symbol: "NOC", name: "Northrop Grumman", price: "702.38", change: "+0.55%", volume: "1.2M", category: "active" },
  { symbol: "FDX", name: "FedEx Corp", price: "361.31", change: "-0.80%", volume: "3.5M", category: "active" },
  { symbol: "DAL", name: "Delta Air Lines", price: "66.77", change: "+1.80%", volume: "8.4M", category: "active" },
  { symbol: "UAL", name: "United Airlines", price: "78.40", change: "+2.10%", volume: "6.2M", category: "active" },
  { symbol: "LUV", name: "Southwest Airlines", price: "32.40", change: "+1.50%", volume: "7.8M", category: "active" },
  // Materials & Mining
  { symbol: "LIN", name: "Linde plc", price: "458.30", change: "+0.55%", volume: "2.1M", category: "active" },
  { symbol: "APD", name: "Air Products", price: "298.40", change: "+0.70%", volume: "1.5M", category: "active" },
  { symbol: "SHW", name: "Sherwin-Williams", price: "348.60", change: "+0.80%", volume: "1.8M", category: "active" },
  { symbol: "ECL", name: "Ecolab Inc", price: "238.40", change: "+0.65%", volume: "1.4M", category: "active" },
  { symbol: "NUE", name: "Nucor Corp", price: "158.30", change: "+2.10%", volume: "3.2M", category: "active" },
  { symbol: "FCX", name: "Freeport-McMoRan", price: "61.39", change: "+2.80%", volume: "15.8M", category: "active" },
  { symbol: "AA", name: "Alcoa Corp", price: "71.52", change: "+3.20%", volume: "5.4M", category: "active" },
  // REITs
  { symbol: "AMT", name: "American Tower", price: "173.69", change: "+0.55%", volume: "2.8M", category: "active" },
  { symbol: "PLD", name: "Prologis Inc", price: "128.60", change: "+0.70%", volume: "3.5M", category: "active" },
  { symbol: "CCI", name: "Crown Castle", price: "98.30", change: "+0.45%", volume: "3.2M", category: "active" },
  { symbol: "EQIX", name: "Equinix Inc", price: "848.40", change: "+0.60%", volume: "0.8M", category: "active" },
  { symbol: "O", name: "Realty Income", price: "58.40", change: "+0.35%", volume: "5.8M", category: "active" },
  // High-Momentum / Volatile (bigger moves = bigger opportunities)
  { symbol: "CELH", name: "Celsius Holdings", price: "34.11", change: "+4.50%", volume: "12.8M", category: "active" },
  { symbol: "DUOL", name: "Duolingo Inc", price: "96.42", change: "+2.80%", volume: "2.1M", category: "active" },
  { symbol: "CAVA", name: "CAVA Group", price: "98.60", change: "+3.40%", volume: "4.5M", category: "active" },
  { symbol: "APP", name: "AppLovin Corp", price: "386.25", change: "+4.20%", volume: "8.2M", category: "active" },
  { symbol: "AXON", name: "Axon Enterprise", price: "428.60", change: "+2.60%", volume: "2.8M", category: "active" },
  { symbol: "DECK", name: "Deckers Outdoor", price: "98.31", change: "+1.90%", volume: "1.8M", category: "active" },
  { symbol: "FICO", name: "Fair Isaac Corp", price: "1089.61", change: "+1.40%", volume: "0.5M", category: "active" },
  { symbol: "TOST", name: "Toast Inc", price: "26.48", change: "+3.60%", volume: "7.2M", category: "active" },
  { symbol: "CVNA", name: "Carvana Co", price: "313.75", change: "+5.10%", volume: "8.5M", category: "active" },
  { symbol: "VST", name: "Vistra Corp", price: "128.40", change: "+3.80%", volume: "12.4M", category: "active" },
  { symbol: "CEG", name: "Constellation Energy", price: "248.60", change: "+2.90%", volume: "4.5M", category: "active" },
  { symbol: "GEV", name: "GE Vernova", price: "898.32", change: "+2.40%", volume: "3.8M", category: "active" },
  // Deep-Sea Mining & Metals
  { symbol: "TMC", name: "TMC the metals company", price: "4.51", change: "-0.43%", volume: "4.9M", category: "active" },
  { symbol: "MP", name: "MP Materials", price: "49.73", change: "+3.40%", volume: "5.2M", category: "active" },
  { symbol: "LAC", name: "Lithium Americas", price: "4.80", change: "+4.50%", volume: "8.1M", category: "active" },
  { symbol: "VALE", name: "Vale SA", price: "16.2", change: "+2.80%", volume: "22.5M", category: "active" },
  { symbol: "RIO", name: "Rio Tinto Group", price: "94.46", change: "+1.90%", volume: "4.8M", category: "active" },
  { symbol: "BHP", name: "BHP Group Ltd", price: "73.23", change: "+1.70%", volume: "5.4M", category: "active" },
  { symbol: "CLF", name: "Cleveland-Cliffs", price: "8.4", change: "+3.60%", volume: "16.2M", category: "active" },
  { symbol: "X", name: "United States Steel", price: "54.85", change: "+2.90%", volume: "8.5M", category: "active" },
  { symbol: "SCCO", name: "Southern Copper", price: "177.84", change: "+2.10%", volume: "2.8M", category: "active" },
  // Small/Mid-Cap High-Momentum (bigger % moves = bigger profit potential)
  { symbol: "SOUN", name: "SoundHound AI", price: "8.40", change: "+7.20%", volume: "42.5M", category: "active" },
  { symbol: "RGTI", name: "Rigetti Computing", price: "12.80", change: "+8.50%", volume: "28.4M", category: "active" },
  { symbol: "QUBT", name: "Quantum Computing", price: "6.40", change: "+9.20%", volume: "35.2M", category: "active" },
  { symbol: "BBAI", name: "BigBear.ai Holdings", price: "4.20", change: "+6.80%", volume: "22.1M", category: "active" },
  { symbol: "APLD", name: "Applied Digital", price: "24.55", change: "+5.40%", volume: "15.8M", category: "active" },
  { symbol: "LUNR", name: "Intuitive Machines", price: "23.98", change: "+6.10%", volume: "12.4M", category: "active" },
  { symbol: "ASTS", name: "AST SpaceMobile", price: "92.71", change: "+4.80%", volume: "8.2M", category: "active" },
  { symbol: "DNA", name: "Ginkgo Bioworks", price: "8.20", change: "+5.60%", volume: "14.5M", category: "active" },
  { symbol: "JOBY", name: "Joby Aviation", price: "7.80", change: "+4.90%", volume: "11.8M", category: "active" },
  { symbol: "AEHR", name: "Aehr Test Systems", price: "44.4", change: "+5.80%", volume: "4.2M", category: "active" },
  { symbol: "KULR", name: "KULR Technology", price: "2.1", change: "+8.40%", volume: "18.5M", category: "active" },
  { symbol: "GSAT", name: "Globalstar Inc", price: "77.68", change: "+7.50%", volume: "25.8M", category: "active" },
  { symbol: "OPEN", name: "Opendoor Tech", price: "4.74", change: "+4.20%", volume: "32.1M", category: "active" },
  { symbol: "WULF", name: "TeraWulf Inc", price: "14.88", change: "+6.40%", volume: "22.8M", category: "active" },
  { symbol: "BTBT", name: "Bit Digital Inc", price: "1.38", change: "+7.80%", volume: "12.4M", category: "active" },
  { symbol: "CLSK", name: "CleanSpark Inc", price: "8.79", change: "+5.20%", volume: "18.2M", category: "active" },
  { symbol: "CIFR", name: "Cipher Mining", price: "12.84", change: "+6.90%", volume: "14.5M", category: "active" },
  // Cannabis / Biotech High-Vol
  { symbol: "TLRY", name: "Tilray Brands", price: "6.55", change: "+5.60%", volume: "42.8M", category: "active" },
  { symbol: "CGC", name: "Canopy Growth", price: "1.01", change: "+4.80%", volume: "18.5M", category: "active" },
  { symbol: "SNDL", name: "SNDL Inc", price: "1.36", change: "+3.90%", volume: "28.4M", category: "active" },
  // Clean Energy / EV Extended
  { symbol: "FSLR", name: "First Solar Inc", price: "178.40", change: "+2.80%", volume: "4.5M", category: "active" },
  { symbol: "ENPH", name: "Enphase Energy", price: "34.91", change: "+3.40%", volume: "6.8M", category: "active" },
  { symbol: "SEDG", name: "SolarEdge Tech", price: "48.74", change: "+4.20%", volume: "8.2M", category: "active" },
  { symbol: "PLUG", name: "Plug Power Inc", price: "2.40", change: "+5.80%", volume: "32.4M", category: "active" },
  { symbol: "CHPT", name: "ChargePoint Holdings", price: "4.81", change: "+6.40%", volume: "22.1M", category: "active" },
  { symbol: "QS", name: "QuantumScape Corp", price: "5.80", change: "+4.60%", volume: "12.5M", category: "active" },
  { symbol: "NIO", name: "NIO Inc", price: "6.3", change: "+3.80%", volume: "45.2M", category: "active" },
  { symbol: "XPEV", name: "XPeng Inc", price: "17.7", change: "+4.20%", volume: "15.8M", category: "active" },
  { symbol: "LI", name: "Li Auto Inc", price: "18.47", change: "+2.90%", volume: "8.4M", category: "active" },
  // Space & Defense Small-Cap
  { symbol: "IRDM", name: "Iridium Communications", price: "28.40", change: "+2.10%", volume: "3.2M", category: "active" },
  { symbol: "RCAT", name: "Red Cat Holdings", price: "12.93", change: "+7.40%", volume: "14.5M", category: "active" },
  { symbol: "KTOS", name: "Kratos Defense", price: "67.32", change: "+3.20%", volume: "4.8M", category: "active" },
  // === ADDITIONAL 100+ STOCKS FOR 380+ UNIVERSE ===
  // Semiconductors Extended
  { symbol: "ON", name: "ON Semiconductor", price: "68.40", change: "+2.10%", volume: "8.2M", category: "active" },
  { symbol: "MPWR", name: "Monolithic Power", price: "1118.55", change: "+1.80%", volume: "1.2M", category: "active" },
  { symbol: "SWKS", name: "Skyworks Solutions", price: "55.16", change: "+1.50%", volume: "3.5M", category: "active" },
  { symbol: "MCHP", name: "Microchip Technology", price: "65.63", change: "+1.20%", volume: "5.4M", category: "active" },
  { symbol: "GFS", name: "GlobalFoundries", price: "52.80", change: "+2.40%", volume: "4.8M", category: "active" },
  { symbol: "WOLF", name: "Wolfspeed Inc", price: "17.45", change: "+6.80%", volume: "15.2M", category: "active" },
  { symbol: "CRUS", name: "Cirrus Logic", price: "147.13", change: "+1.70%", volume: "1.8M", category: "active" },
  { symbol: "MTSI", name: "MACOM Technology", price: "238.56", change: "+2.30%", volume: "1.5M", category: "active" },
  // Software / SaaS Extended
  { symbol: "VEEV", name: "Veeva Systems", price: "174.06", change: "+1.40%", volume: "2.1M", category: "active" },
  { symbol: "PAYC", name: "Paycom Software", price: "123.6", change: "+1.10%", volume: "1.4M", category: "active" },
  { symbol: "PCOR", name: "Procore Technologies", price: "58.03", change: "+2.50%", volume: "2.8M", category: "active" },
  { symbol: "ESTC", name: "Elastic NV", price: "50.66", change: "+1.90%", volume: "2.4M", category: "active" },
  { symbol: "CFLT", name: "Confluent Inc", price: "28.90", change: "+3.20%", volume: "5.8M", category: "active" },
  { symbol: "S", name: "SentinelOne", price: "13.35", change: "+3.80%", volume: "8.5M", category: "active" },
  { symbol: "GTLB", name: "GitLab Inc", price: "22.55", change: "+2.60%", volume: "3.2M", category: "active" },
  { symbol: "MNDY", name: "monday.com", price: "68.29", change: "+1.70%", volume: "1.5M", category: "active" },
  { symbol: "AI", name: "C3.ai Inc", price: "8.65", change: "+5.40%", volume: "12.8M", category: "active" },
  { symbol: "BIGC", name: "BigCommerce", price: "4.77", change: "+4.20%", volume: "4.5M", category: "active" },
  // Biotech / Pharma Extended
  { symbol: "BIIB", name: "Biogen Inc", price: "178.30", change: "+1.10%", volume: "2.8M", category: "active" },
  { symbol: "ALNY", name: "Alnylam Pharma", price: "318.79", change: "+2.30%", volume: "1.8M", category: "active" },
  { symbol: "EXAS", name: "Exact Sciences", price: "104.94", change: "+2.80%", volume: "3.5M", category: "active" },
  { symbol: "NBIX", name: "Neurocrine Bio", price: "148.20", change: "+1.50%", volume: "1.4M", category: "active" },
  { symbol: "HALO", name: "Halozyme Therapeutics", price: "58.40", change: "+1.90%", volume: "2.1M", category: "active" },
  { symbol: "SRPT", name: "Sarepta Therapeutics", price: "23.23", change: "+3.40%", volume: "2.8M", category: "active" },
  { symbol: "PCVX", name: "Vaxcyte Inc", price: "58.37", change: "+2.70%", volume: "1.8M", category: "active" },
  { symbol: "LEGN", name: "Legend Biotech", price: "19.15", change: "+4.10%", volume: "3.5M", category: "active" },
  { symbol: "ARGX", name: "argenx SE", price: "746.22", change: "+1.40%", volume: "0.8M", category: "active" },
  { symbol: "UTHR", name: "United Therapeutics", price: "564.42", change: "+0.90%", volume: "0.5M", category: "active" },
  // Fintech / Payments
  { symbol: "MQ", name: "Marqeta Inc", price: "5.80", change: "+4.60%", volume: "8.2M", category: "active" },
  { symbol: "UPST", name: "Upstart Holdings", price: "25.57", change: "+5.80%", volume: "12.4M", category: "active" },
  { symbol: "NU", name: "Nu Holdings", price: "12.80", change: "+3.40%", volume: "18.5M", category: "active" },
  { symbol: "FOUR", name: "Shift4 Payments", price: "42.76", change: "+2.10%", volume: "3.2M", category: "active" },
  { symbol: "RELY", name: "Remitly Global", price: "18.60", change: "+3.80%", volume: "4.5M", category: "active" },
  { symbol: "GLBE", name: "Global-e Online", price: "31.19", change: "+2.90%", volume: "2.8M", category: "active" },
  // Consumer / E-Commerce Extended
  { symbol: "ETSY", name: "Etsy Inc", price: "58.40", change: "+2.10%", volume: "5.4M", category: "active" },
  { symbol: "W", name: "Wayfair Inc", price: "72.63", change: "+3.60%", volume: "6.8M", category: "active" },
  { symbol: "CHWY", name: "Chewy Inc", price: "28.90", change: "+2.80%", volume: "7.2M", category: "active" },
  { symbol: "DKNG", name: "DraftKings Inc", price: "23.15", change: "+3.20%", volume: "14.8M", category: "active" },
  { symbol: "PENN", name: "Penn Entertainment", price: "14.78", change: "+4.50%", volume: "8.5M", category: "active" },
  { symbol: "MGM", name: "MGM Resorts", price: "42.80", change: "+1.80%", volume: "5.2M", category: "active" },
  { symbol: "WYNN", name: "Wynn Resorts", price: "98.40", change: "+1.60%", volume: "3.5M", category: "active" },
  { symbol: "RCL", name: "Royal Caribbean", price: "273.65", change: "+1.40%", volume: "3.8M", category: "active" },
  { symbol: "CCL", name: "Carnival Corp", price: "22.40", change: "+2.80%", volume: "28.5M", category: "active" },
  { symbol: "MAR", name: "Marriott Intl", price: "331.96", change: "+0.90%", volume: "2.1M", category: "active" },
  { symbol: "HLT", name: "Hilton Worldwide", price: "305.08", change: "+0.75%", volume: "1.8M", category: "active" },
  // Automotive
  { symbol: "F", name: "Ford Motor", price: "12.40", change: "+1.80%", volume: "42.5M", category: "active" },
  { symbol: "GM", name: "General Motors", price: "72.55", change: "+1.50%", volume: "12.8M", category: "active" },
  { symbol: "STLA", name: "Stellantis NV", price: "7.55", change: "+2.40%", volume: "8.5M", category: "active" },
  { symbol: "TM", name: "Toyota Motor", price: "178.40", change: "+0.65%", volume: "2.8M", category: "active" },
  { symbol: "HMC", name: "Honda Motor", price: "24.16", change: "+1.10%", volume: "3.5M", category: "active" },
  { symbol: "RACE", name: "Ferrari NV", price: "340.49", change: "+0.80%", volume: "0.8M", category: "active" },
  // Media / Entertainment
  { symbol: "WBD", name: "Warner Bros Discovery", price: "27.33", change: "+3.60%", volume: "22.5M", category: "active" },
  { symbol: "PARA", name: "Paramount Global", price: "12.30", change: "+2.80%", volume: "15.8M", category: "active" },
  { symbol: "RBLX", name: "Roblox Corp", price: "52.40", change: "+3.40%", volume: "12.4M", category: "active" },
  { symbol: "TTWO", name: "Take-Two Interactive", price: "178.30", change: "+1.50%", volume: "3.2M", category: "active" },
  { symbol: "EA", name: "Electronic Arts", price: "203.57", change: "+0.90%", volume: "3.8M", category: "active" },
  { symbol: "ATVI", name: "Activision Blizzard", price: "82.40", change: "+0.60%", volume: "5.4M", category: "active" },
  // Crypto / Blockchain Extended
  { symbol: "MARA", name: "Marathon Digital", price: "8.7", change: "+6.80%", volume: "48.5M", category: "active" },
  { symbol: "RIOT", name: "Riot Platforms", price: "12.80", change: "+7.20%", volume: "32.4M", category: "active" },
  { symbol: "HUT", name: "Hut 8 Mining", price: "48.12", change: "+5.40%", volume: "12.8M", category: "active" },
  { symbol: "BITF", name: "Bitfarms Ltd", price: "1.97", change: "+8.50%", volume: "18.5M", category: "active" },
  { symbol: "IREN", name: "Iris Energy", price: "34.74", change: "+6.20%", volume: "8.4M", category: "active" },
  // Utilities Extended
  { symbol: "DUK", name: "Duke Energy", price: "132.24", change: "+0.45%", volume: "3.8M", category: "active" },
  { symbol: "SO", name: "Southern Company", price: "82.40", change: "+0.35%", volume: "4.5M", category: "active" },
  { symbol: "D", name: "Dominion Energy", price: "52.80", change: "+0.55%", volume: "5.2M", category: "active" },
  { symbol: "AEP", name: "American Electric Power", price: "132.69", change: "+0.40%", volume: "3.2M", category: "active" },
  { symbol: "EXC", name: "Exelon Corp", price: "42.60", change: "+0.70%", volume: "6.8M", category: "active" },
  { symbol: "XEL", name: "Xcel Energy", price: "68.40", change: "+0.50%", volume: "3.5M", category: "active" },
  { symbol: "AES", name: "AES Corp", price: "14.29", change: "+1.80%", volume: "8.2M", category: "active" },
  // Food / Agriculture
  { symbol: "ADM", name: "Archer-Daniels", price: "73.85", change: "+0.90%", volume: "3.8M", category: "active" },
  { symbol: "BG", name: "Bunge Global", price: "129.45", change: "+1.20%", volume: "2.1M", category: "active" },
  { symbol: "TSN", name: "Tyson Foods", price: "58.40", change: "+0.65%", volume: "3.5M", category: "active" },
  { symbol: "HRL", name: "Hormel Foods", price: "22.09", change: "+0.40%", volume: "2.8M", category: "active" },
  { symbol: "MKC", name: "McCormick & Co", price: "48.84", change: "+0.55%", volume: "1.8M", category: "active" },
  // Insurance
  { symbol: "PGR", name: "Progressive Corp", price: "195.34", change: "+0.80%", volume: "3.2M", category: "active" },
  { symbol: "TRV", name: "Travelers Companies", price: "294.06", change: "+0.55%", volume: "1.5M", category: "active" },
  { symbol: "ALL", name: "Allstate Corp", price: "188.30", change: "+0.70%", volume: "1.8M", category: "active" },
  { symbol: "MET", name: "MetLife Inc", price: "78.40", change: "+0.90%", volume: "3.5M", category: "active" },
  { symbol: "AFL", name: "Aflac Inc", price: "98.30", change: "+0.45%", volume: "2.8M", category: "active" },
  // Retail / Specialty
  { symbol: "ULTA", name: "Ulta Beauty", price: "537.55", change: "+1.30%", volume: "1.2M", category: "active" },
  { symbol: "DG", name: "Dollar General", price: "119.84", change: "+1.80%", volume: "4.5M", category: "active" },
  { symbol: "DLTR", name: "Dollar Tree", price: "108.5", change: "+2.10%", volume: "3.8M", category: "active" },
  { symbol: "BBY", name: "Best Buy Co", price: "64.52", change: "+1.50%", volume: "3.2M", category: "active" },
  { symbol: "AZO", name: "AutoZone Inc", price: "3148.30", change: "+0.60%", volume: "0.3M", category: "active" },
  { symbol: "ORLY", name: "O'Reilly Auto", price: "91.42", change: "+0.70%", volume: "0.4M", category: "active" },
  { symbol: "GPS", name: "Gap Inc", price: "22.40", change: "+3.20%", volume: "8.5M", category: "active" },
  // Nuclear / Data Center Energy
  { symbol: "NNE", name: "Nano Nuclear Energy", price: "21.36", change: "+8.20%", volume: "12.8M", category: "active" },
  { symbol: "OKLO", name: "Oklo Inc", price: "48.09", change: "+6.40%", volume: "8.5M", category: "active" },
  { symbol: "SMR", name: "NuScale Power", price: "10.16", change: "+7.80%", volume: "15.2M", category: "active" },
  { symbol: "LEU", name: "Centrus Energy", price: "183.03", change: "+5.20%", volume: "3.8M", category: "active" },
  { symbol: "CCJ", name: "Cameco Corp", price: "112.58", change: "+3.40%", volume: "5.4M", category: "active" },
  { symbol: "UEC", name: "Uranium Energy", price: "13.61", change: "+5.80%", volume: "12.4M", category: "active" },
  // AI / Robotics Extended
  { symbol: "PLTR", name: "Palantir Technologies", price: "148.57", change: "+3.20%", volume: "72.1M", category: "active" },
  { symbol: "TWST", name: "Twist Bioscience", price: "52.40", change: "+3.80%", volume: "2.8M", category: "active" },
  { symbol: "AMBA", name: "Ambarella Inc", price: "50.53", change: "+2.90%", volume: "1.8M", category: "active" },
  { symbol: "VRT", name: "Vertiv Holdings", price: "261.31", change: "+3.40%", volume: "8.5M", category: "active" },
  { symbol: "ANET", name: "Arista Networks", price: "126.69", change: "+1.80%", volume: "3.2M", category: "active" },
  // International ADRs
  { symbol: "BABA", name: "Alibaba Group", price: "122", change: "+2.80%", volume: "18.5M", category: "active" },
  { symbol: "PDD", name: "PDD Holdings", price: "100.84", change: "+3.40%", volume: "12.4M", category: "active" },
  { symbol: "JD", name: "JD.com Inc", price: "28.47", change: "+2.60%", volume: "8.5M", category: "active" },
  { symbol: "BIDU", name: "Baidu Inc", price: "98.30", change: "+2.10%", volume: "5.4M", category: "active" },
  { symbol: "SE", name: "Sea Ltd", price: "82.26", change: "+3.20%", volume: "6.8M", category: "active" },
  { symbol: "GRAB", name: "Grab Holdings", price: "3.62", change: "+3.60%", volume: "22.5M", category: "active" },
  { symbol: "MELI", name: "MercadoLibre", price: "1828.40", change: "+1.40%", volume: "0.8M", category: "active" },
  { symbol: "TSM", name: "TSMC", price: "338.8", change: "+1.60%", volume: "12.8M", category: "active" },
  // Cybersecurity
  { symbol: "CYBR", name: "CyberArk Software", price: "408.76", change: "+1.90%", volume: "1.8M", category: "active" },
  { symbol: "VRNS", name: "Varonis Systems", price: "22.53", change: "+2.40%", volume: "2.1M", category: "active" },
  { symbol: "RPD", name: "Rapid7 Inc", price: "5.38", change: "+2.80%", volume: "2.5M", category: "active" },
  { symbol: "TENB", name: "Tenable Holdings", price: "17.59", change: "+1.70%", volume: "1.8M", category: "active" },
  // ETFs Extended
  { symbol: "SPY", name: "SPDR S&P 500 ETF", price: "582.40", change: "+0.65%", volume: "52.8M", category: "active" },
  { symbol: "QQQ", name: "Invesco QQQ Trust", price: "498.30", change: "+0.85%", volume: "38.2M", category: "active" },
  { symbol: "IWM", name: "iShares Russell 2000", price: "212.50", change: "+1.10%", volume: "22.4M", category: "active" },
  { symbol: "DIA", name: "SPDR Dow Jones ETF", price: "425.80", change: "+0.45%", volume: "4.8M", category: "active" },
  { symbol: "ARKK", name: "ARK Innovation ETF", price: "68.59", change: "+2.30%", volume: "18.5M", category: "active" },
  { symbol: "XLF", name: "Financial Select SPDR", price: "42.30", change: "+0.55%", volume: "28.4M", category: "active" },
  { symbol: "XLE", name: "Energy Select SPDR", price: "59.17", change: "+1.80%", volume: "15.2M", category: "active" },
  { symbol: "XLK", name: "Technology Select SPDR", price: "136.01", change: "+0.90%", volume: "12.8M", category: "active" },
  { symbol: "SOXX", name: "iShares Semiconductor", price: "339.6", change: "+1.40%", volume: "8.5M", category: "active" },
  { symbol: "SMH", name: "VanEck Semiconductor", price: "392.22", change: "+1.60%", volume: "12.4M", category: "active" },
  { symbol: "MSOS", name: "AdvisorShares Cannabis", price: "3.85", change: "+3.20%", volume: "8.5M", category: "active" },
  { symbol: "TAN", name: "Invesco Solar ETF", price: "54.83", change: "+2.40%", volume: "4.2M", category: "active" },
  { symbol: "REMX", name: "VanEck Rare Earth", price: "88.8", change: "+1.80%", volume: "1.8M", category: "active" },
  { symbol: "XLV", name: "Health Care Select", price: "148.30", change: "+0.55%", volume: "8.5M", category: "active" },
  { symbol: "XLI", name: "Industrial Select", price: "163.77", change: "+0.70%", volume: "6.8M", category: "active" },
  { symbol: "XLP", name: "Consumer Staples", price: "78.30", change: "+0.30%", volume: "5.4M", category: "active" },
  { symbol: "XLY", name: "Consumer Discretionary", price: "108.16", change: "+1.10%", volume: "4.5M", category: "active" },
  { symbol: "XLU", name: "Utilities Select", price: "46.36", change: "+0.45%", volume: "8.2M", category: "active" },
  { symbol: "XLB", name: "Materials Select", price: "50.41", change: "+1.30%", volume: "3.8M", category: "active" },
  { symbol: "XLRE", name: "Real Estate Select", price: "42.30", change: "+0.60%", volume: "4.2M", category: "active" },
  { symbol: "VTI", name: "Vanguard Total Market", price: "278.40", change: "+0.70%", volume: "4.8M", category: "active" },
  { symbol: "VOO", name: "Vanguard S&P 500", price: "538.30", change: "+0.65%", volume: "5.2M", category: "active" },
  { symbol: "IBIT", name: "iShares Bitcoin Trust", price: "38.01", change: "+4.20%", volume: "32.5M", category: "active" },
  { symbol: "GDX", name: "VanEck Gold Miners", price: "94.25", change: "+2.80%", volume: "18.5M", category: "active" },
  { symbol: "SLV", name: "iShares Silver Trust", price: "65.99", change: "+2.10%", volume: "12.4M", category: "active" },
  { symbol: "GLD", name: "SPDR Gold Shares", price: "429.19", change: "+1.20%", volume: "8.5M", category: "active" },
  { symbol: "URA", name: "Global X Uranium ETF", price: "48.87", change: "+3.40%", volume: "5.8M", category: "active" },
  // Leveraged / Volatility ETFs
  { symbol: "UVXY", name: "ProShares Ultra VIX", price: "28.50", change: "+5.40%", volume: "42.8M", category: "active" },
  { symbol: "TQQQ", name: "ProShares UltraPro QQQ", price: "58.30", change: "+2.55%", volume: "85.2M", category: "active" },
  { symbol: "SQQQ", name: "ProShares UltraPro Short QQQ", price: "9.80", change: "-2.40%", volume: "72.5M", category: "active" },
  { symbol: "VXX", name: "Barclays iPath VIX ST", price: "42.10", change: "+4.80%", volume: "18.5M", category: "active" },
  { symbol: "SVXY", name: "ProShares Short VIX", price: "52.60", change: "-3.20%", volume: "8.4M", category: "active" },
  { symbol: "SPXU", name: "ProShares UltraPro Short S&P", price: "8.20", change: "-2.10%", volume: "22.4M", category: "active" },
  { symbol: "SPXS", name: "Direxion Daily S&P Bear 3X", price: "7.90", change: "-2.30%", volume: "18.2M", category: "active" },
  { symbol: "UVIX", name: "2x Long VIX Futures ETF", price: "14.80", change: "+6.20%", volume: "28.5M", category: "active" },
  { symbol: "SOXL", name: "Direxion Semis Bull 3X", price: "22.40", change: "+4.20%", volume: "58.2M", category: "active" },
  { symbol: "SOXS", name: "Direxion Semis Bear 3X", price: "18.90", change: "-4.10%", volume: "32.5M", category: "active" },
  { symbol: "LABU", name: "Direxion Biotech Bull 3X", price: "4.80", change: "+5.60%", volume: "28.4M", category: "active" },
  { symbol: "LABD", name: "Direxion Biotech Bear 3X", price: "12.30", change: "-5.40%", volume: "14.2M", category: "active" },
  { symbol: "TNA", name: "Direxion Small Cap Bull 3X", price: "38.20", change: "+3.30%", volume: "22.8M", category: "active" },
  { symbol: "TZA", name: "Direxion Small Cap Bear 3X", price: "14.50", change: "-3.10%", volume: "15.2M", category: "active" },
  { symbol: "SPXL", name: "Direxion Daily S&P Bull 3X", price: "142.30", change: "+1.95%", volume: "8.5M", category: "active" },
  { symbol: "UPRO", name: "ProShares UltraPro S&P 500", price: "72.40", change: "+1.90%", volume: "12.4M", category: "active" },
  { symbol: "SDOW", name: "ProShares UltraPro Short Dow", price: "18.60", change: "-1.80%", volume: "5.8M", category: "active" },
  { symbol: "UDOW", name: "ProShares UltraPro Dow 30", price: "78.30", change: "+1.35%", volume: "2.8M", category: "active" },
  { symbol: "FNGU", name: "MicroSectors FANG+ Bull 3X", price: "285.40", change: "+3.60%", volume: "4.5M", category: "active" },
  { symbol: "FNGD", name: "MicroSectors FANG+ Bear 3X", price: "5.20", change: "-3.50%", volume: "3.2M", category: "active" },
  { symbol: "VIXY", name: "ProShares VIX ST Futures", price: "18.40", change: "+4.50%", volume: "8.2M", category: "active" },
  { symbol: "SVOL", name: "Simplify Volatility Prem", price: "22.80", change: "-0.90%", volume: "3.5M", category: "active" },
  { symbol: "NUGT", name: "Direxion Gold Miners Bull 2X", price: "42.60", change: "+5.20%", volume: "4.8M", category: "active" },
  { symbol: "DUST", name: "Direxion Gold Miners Bear 2X", price: "8.40", change: "-5.10%", volume: "3.2M", category: "active" },
  { symbol: "JNUG", name: "Direxion Jr Gold Bull 2X", price: "38.50", change: "+6.40%", volume: "5.8M", category: "active" },
  { symbol: "JDST", name: "Direxion Jr Gold Bear 2X", price: "12.80", change: "-6.20%", volume: "2.4M", category: "active" },
  { symbol: "BOIL", name: "ProShares Ultra Bloomberg NG", price: "4.20", change: "+8.50%", volume: "18.5M", category: "active" },
  { symbol: "KOLD", name: "ProShares UltraShort NG", price: "32.40", change: "-8.20%", volume: "4.2M", category: "active" },
  { symbol: "UCO", name: "ProShares Ultra Bloomberg Oil", price: "22.80", change: "+3.80%", volume: "5.4M", category: "active" },
  { symbol: "SCO", name: "ProShares UltraShort Oil", price: "15.60", change: "-3.60%", volume: "2.8M", category: "active" },
  // === CRYPTO ===
  { symbol: "BTCUSD", name: "Bitcoin", price: "67500.00", change: "+2.40%", volume: "32.5B", category: "active" },
  { symbol: "ETHUSD", name: "Ethereum", price: "3450.00", change: "+1.80%", volume: "18.2B", category: "active" },
  { symbol: "SOLUSD", name: "Solana", price: "178.50", change: "+4.20%", volume: "4.8B", category: "active" },
  { symbol: "XRPUSD", name: "XRP", price: "0.62", change: "+3.10%", volume: "2.1B", category: "active" },
  { symbol: "ADAUSD", name: "Cardano", price: "0.48", change: "+2.80%", volume: "1.2B", category: "active" },
  { symbol: "DOGEUSD", name: "Dogecoin", price: "0.16", change: "+5.40%", volume: "2.8B", category: "active" },
  { symbol: "AVAXUSD", name: "Avalanche", price: "38.50", change: "+3.60%", volume: "0.8B", category: "active" },
  { symbol: "DOTUSD", name: "Polkadot", price: "7.80", change: "+2.10%", volume: "0.5B", category: "active" },
  { symbol: "MATICUSD", name: "Polygon", price: "0.72", change: "+1.90%", volume: "0.6B", category: "active" },
  { symbol: "LINKUSD", name: "Chainlink", price: "15.20", change: "+3.40%", volume: "0.9B", category: "active" },
  { symbol: "UNIUSD", name: "Uniswap", price: "8.40", change: "+2.50%", volume: "0.4B", category: "active" },
  { symbol: "AAVEUSD", name: "Aave", price: "98.50", change: "+1.80%", volume: "0.3B", category: "active" },
  { symbol: "LTCUSD", name: "Litecoin", price: "72.30", change: "+1.50%", volume: "0.6B", category: "active" },
  { symbol: "BCHUSD", name: "Bitcoin Cash", price: "248.50", change: "+2.20%", volume: "0.4B", category: "active" },
  { symbol: "SHIBUSD", name: "Shiba Inu", price: "0.000012", change: "+6.80%", volume: "1.5B", category: "active" },
  { symbol: "PEPEUSD", name: "Pepe", price: "0.0000085", change: "+8.20%", volume: "1.8B", category: "active" },
  { symbol: "ARBUSD", name: "Arbitrum", price: "1.18", change: "+3.80%", volume: "0.5B", category: "active" },
  { symbol: "OPUSD", name: "Optimism", price: "2.40", change: "+2.60%", volume: "0.3B", category: "active" },
  { symbol: "NEARUSD", name: "NEAR Protocol", price: "5.80", change: "+4.50%", volume: "0.4B", category: "active" },
  { symbol: "SUIUSD", name: "Sui", price: "1.32", change: "+5.10%", volume: "0.6B", category: "active" },
  { symbol: "APTUSD", name: "Aptos", price: "8.90", change: "+3.20%", volume: "0.3B", category: "active" },
  { symbol: "FILUSD", name: "Filecoin", price: "6.20", change: "+2.40%", volume: "0.3B", category: "active" },
  { symbol: "ATOMUSD", name: "Cosmos", price: "9.40", change: "+1.80%", volume: "0.2B", category: "active" },
  { symbol: "ALGOUSD", name: "Algorand", price: "0.22", change: "+2.90%", volume: "0.1B", category: "active" },
  { symbol: "XLMUSD", name: "Stellar", price: "0.12", change: "+1.60%", volume: "0.2B", category: "active" },
  { symbol: "HBARUSD", name: "Hedera", price: "0.08", change: "+3.80%", volume: "0.2B", category: "active" },
  { symbol: "ICPUSD", name: "Internet Computer", price: "12.50", change: "+2.10%", volume: "0.2B", category: "active" },
  { symbol: "RNDRUSD", name: "Render", price: "8.60", change: "+4.80%", volume: "0.3B", category: "active" },
  { symbol: "GRTUSD", name: "The Graph", price: "0.28", change: "+3.40%", volume: "0.2B", category: "active" },
  { symbol: "INJUSD", name: "Injective", price: "25.40", change: "+3.60%", volume: "0.2B", category: "active" },
  { symbol: "BONKUSD", name: "Bonk", price: "0.000018", change: "+7.50%", volume: "0.4B", category: "active" },
  { symbol: "WIFUSD", name: "Dogwifhat", price: "2.80", change: "+6.20%", volume: "0.5B", category: "active" },
];

const CACHE_KEY = "neuraltrade_market_cache";
const CACHE_MAX_AGE_MS = 60 * 60 * 1000; // 60 minutes
const LIVE_PRICE_CACHE_KEY = "neuraltrade_live_prices";
const LIVE_PRICE_MAX_AGE_MS = 10 * 1000; // 10 seconds — aggressive freshness for live prices
const DB_CACHE_FRESH_MS = 60 * 1000; // 60 seconds — matches cron interval, skip Alpaca if DB is this fresh

// In-memory cache for DB freshness (avoids redundant DB queries)
let _dbFreshnessCache: { isFresh: boolean; ageMs: number; checkedAt: number } | null = null;
const DB_FRESHNESS_CHECK_INTERVAL = 10_000; // Re-check DB freshness every 10s max

// In-memory live price cache (fastest layer — survives within session, no serialization cost)
let _inMemoryPriceCache: { prices: Record<string, LivePriceEntry>; fetchedAt: number } | null = null;

/** Check if DB cache is fresh enough to skip Alpaca API calls (with in-memory memoization) */
async function getDbCacheFreshness(): Promise<{ isFresh: boolean; ageMs: number }> {
  // Return memoized result if checked recently
  if (_dbFreshnessCache && (Date.now() - _dbFreshnessCache.checkedAt) < DB_FRESHNESS_CHECK_INTERVAL) {
    // Adjust ageMs for time elapsed since check
    const adjustedAge = _dbFreshnessCache.ageMs + (Date.now() - _dbFreshnessCache.checkedAt);
    return { isFresh: adjustedAge < DB_CACHE_FRESH_MS, ageMs: adjustedAge };
  }
  try {
    const { data } = await supabase
      .from("market_prices_cache")
      .select("updated_at")
      .order("updated_at", { ascending: false })
      .limit(1);
    const lastUpdate = data?.[0]?.updated_at;
    if (!lastUpdate) {
      _dbFreshnessCache = { isFresh: false, ageMs: Infinity, checkedAt: Date.now() };
      return { isFresh: false, ageMs: Infinity };
    }
    const ageMs = Date.now() - new Date(lastUpdate).getTime();
    const isFresh = ageMs < DB_CACHE_FRESH_MS;
    _dbFreshnessCache = { isFresh, ageMs, checkedAt: Date.now() };
    return { isFresh, ageMs };
  } catch {
    return { isFresh: false, ageMs: Infinity };
  }
}

// Pre-built enrichment map (avoid iterating 380+ entries every cycle)
const ENRICHMENT_MAP = new Map<string, StockData>();
for (const stock of ENRICHMENT_STOCKS) {
  ENRICHMENT_MAP.set(stock.symbol, stock);
}

function getCachedData(): MarketData | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { data, timestamp } = JSON.parse(raw);
    if (Date.now() - timestamp > CACHE_MAX_AGE_MS) return null;
    return data as MarketData;
  } catch {
    return null;
  }
}

function setCachedData(data: MarketData) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ data, timestamp: Date.now() }));
  } catch { /* ignore quota errors */ }
}

// Live price overlay from Alpaca
interface LivePriceEntry { price: number; change: number; volume: number; high?: number; low?: number; timestamp?: number; }

interface LivePriceCache {
  prices: Record<string, LivePriceEntry>;
  fetchedAt: number;
}

function getCachedLivePrices(): LivePriceCache | null {
  // Check in-memory cache first (zero-cost, no JSON parsing)
  if (_inMemoryPriceCache && (Date.now() - _inMemoryPriceCache.fetchedAt) <= LIVE_PRICE_MAX_AGE_MS) {
    return _inMemoryPriceCache;
  }
  // Fall back to localStorage
  try {
    const raw = localStorage.getItem(LIVE_PRICE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LivePriceCache;
    if (Date.now() - parsed.fetchedAt > LIVE_PRICE_MAX_AGE_MS) return null;
    _inMemoryPriceCache = parsed; // Promote to in-memory
    return parsed;
  } catch { return null; }
}

function setCachedLivePrices(cache: LivePriceCache) {
  _inMemoryPriceCache = cache; // Always update in-memory first (instant)
  try { localStorage.setItem(LIVE_PRICE_CACHE_KEY, JSON.stringify(cache)); } catch {}
}

async function fetchLivePricesFromAlpaca(symbols: string[]): Promise<Record<string, LivePriceEntry>> {
  const result: Record<string, LivePriceEntry> = {};
  // Separate stock and crypto symbols
  const stockSymbols = symbols.filter(s => !isCryptoSymbol(s) && /^[A-Z]{1,5}$/.test(s));
  const cryptoSymbols = symbols.filter(s => isCryptoSymbol(s));
  
  const BATCH_SIZE = 200;
  try {
    // Fetch stock snapshots
    const stockBatches: string[][] = [];
    for (let i = 0; i < stockSymbols.length; i += BATCH_SIZE) {
      stockBatches.push(stockSymbols.slice(i, i + BATCH_SIZE));
    }
    const stockResponses = await Promise.allSettled(
      stockBatches.map(batch =>
        invokeAlpacaTrade({
          body: { action: "snapshots", symbols: batch, mode: "paper" },
        })
      )
    );
    for (const res of stockResponses) {
      if (res.status !== "fulfilled" || res.value.error || !res.value.data) continue;
      for (const [sym, snap] of Object.entries(res.value.data)) {
        const s = snap as any;
        if (s?.latestTrade?.p) {
          const price = s.latestTrade.p;
          const open = s.dailyBar?.o || price;
          const change = open > 0 ? ((price - open) / open) * 100 : 0;
          const volume = s.dailyBar?.v || 0;
          const high = s.dailyBar?.h || price;
          const low = s.dailyBar?.l || price;
          result[sym] = { price, change, volume, high, low };
        }
      }
    }

    // Fetch crypto snapshots
    if (cryptoSymbols.length > 0) {
      const cryptoBatches: string[][] = [];
      for (let i = 0; i < cryptoSymbols.length; i += 50) {
        cryptoBatches.push(cryptoSymbols.slice(i, i + 50));
      }
      const cryptoResponses = await Promise.allSettled(
        cryptoBatches.map(batch =>
          invokeAlpacaTrade({
            body: { action: "crypto_snapshots", symbols: batch, mode: "paper" },
          })
        )
      );
      for (const res of cryptoResponses) {
        if (res.status !== "fulfilled" || res.value.error || !res.value.data) continue;
        const snapshots = res.value.data.snapshots || res.value.data;
        for (const [sym, snap] of Object.entries(snapshots)) {
          const s = snap as any;
          const price = s?.latestTrade?.p || s?.dailyBar?.c || 0;
          if (price <= 0) continue;
          const open = s?.dailyBar?.o || price;
          const change = open > 0 ? ((price - open) / open) * 100 : 0;
          const volume = s?.dailyBar?.v || 0;
          const high = s?.dailyBar?.h || price;
          const low = s?.dailyBar?.l || price;
          // Convert BTC/USD → BTCUSD for display
          const displaySym = sym.replace("/", "");
          result[displaySym] = { price, change, volume, high, low };
        }
      }
    }
  } catch (err) {
    console.warn("Alpaca live price fetch failed:", err);
  }
  return result;
}

export function useWebullMarket() {
  const [marketData, setMarketData] = useState<MarketData>({ gainers: [], losers: [], active: [], indices: [] });
  const [tickers, setTickers] = useState<Record<string, TickerData>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string>("");
  const [nextRefreshIn, setNextRefreshIn] = useState<number>(0);
  const [dataSource, setDataSource] = useState<"live" | "cached" | "fallback" | "alpaca">("live");
  const [sourcesUsed, setSourcesUsed] = useState<string[]>([]);
  const failCountRef = useRef(0);
  const mountedRef = useRef(true);
  const lastFetchTimeRef = useRef<number>(0);
  const intervalMsRef = useRef(5 * 60 * 1000);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const livePriceIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchMarketData = useCallback(async () => {
    if (!mountedRef.current) return;
    setLoading(true);
    setError(null);
    try {
      const tickerMap: Record<string, TickerData> = {};

      // Step 1: Check DB cache freshness — if fresh, use it and skip Alpaca entirely
      const { isFresh: dbFresh, ageMs: dbAgeMs } = await getDbCacheFreshness();

      // Step 2: Always fetch Webull movers (lightweight scraper, gives gainers/losers/active)
      let webullOk = false;
      try {
        const { data, error: fnError } = await supabase.functions.invoke("webull-scraper", {
          body: { type: "market" },
        });
        if (!fnError && !data?.error) {
          const allStocks = [...(data.gainers || []), ...(data.losers || []), ...(data.active || [])];
          if (allStocks.length > 0) {
            setMarketData(data);
            setSourcesUsed(data.sourcesUsed || ["Webull"]);
            for (const stock of allStocks) {
              if (!tickerMap[stock.symbol]) {
                tickerMap[stock.symbol] = stockToTicker(stock);
              }
            }
            setCachedData(data);
            failCountRef.current = 0;
            webullOk = true;
          }
        }
      } catch { /* non-critical */ }

      // Step 3: Seed enrichment names using pre-built Map (O(1) lookups)
      for (const [sym, stock] of ENRICHMENT_MAP) {
        if (!tickerMap[sym]) {
          tickerMap[sym] = stockToTicker(stock);
        }
      }

      // Step 4: Overlay DB-cached prices (always — this is the cheapest source)
      try {
        const { data: dbPrices } = await supabase
          .from("market_prices_cache")
          .select("symbol, name, price, change_pct, volume, high, low, updated_at");
        if (dbPrices && dbPrices.length > 0) {
          for (const row of dbPrices) {
            const price = Number(row.price);
            if (price <= 0) continue;
            const changePct = Number(row.change_pct) || 0;
            const size = classifyStockSize(price, row.symbol);
            const volLevel = classifyVolume(row.volume || "0");
            const cat = changePct > 0 ? "gainer" : changePct < 0 ? "loser" : "active";
            const ticker: TickerData = {
              symbol: row.symbol,
              name: row.name || tickerMap[row.symbol]?.name || row.symbol,
              price: price.toFixed(2),
              priceChange: (price * changePct / 100).toFixed(2),
              priceChangePercent: changePct.toFixed(2),
              high: row.high ? String(row.high) : (price * 1.005).toFixed(2),
              low: row.low ? String(row.low) : (price * 0.995).toFixed(2),
              volume: row.volume || "0",
              quoteVolume: "0",
              category: cat as any,
              stockSize: size,
              volumeLevel: volLevel,
              sources: ["DB Cache"],
              profitExpectancy: calcProfitExpectancy(price, changePct, volLevel, size, cat),
            };
            // DB cache overrides hardcoded enrichment but not live Webull data
            if (!tickerMap[row.symbol] || (tickerMap[row.symbol].sources || []).length === 0 || 
                (tickerMap[row.symbol].sources || []).every(s => s === "Enrichment")) {
              tickerMap[row.symbol] = ticker;
            }
          }
          console.log(`DB price cache: overlaid ${dbPrices.length} prices (age: ${Math.round(dbAgeMs / 1000)}s)`);
        }
      } catch (err) {
        console.warn("DB price cache fetch failed (non-blocking):", err);
      }

      if (Object.keys(tickerMap).length === 0) {
        throw new Error("No market data available");
      }

      setTickers(tickerMap);
      setLastUpdated(new Date().toLocaleTimeString());
      lastFetchTimeRef.current = Date.now();
      setDataSource(webullOk ? "live" : "fallback");
      intervalMsRef.current = 10 * 60 * 1000;

      // Step 5: Only call Alpaca API if DB cache is stale (>5 min)
      if (dbFresh) {
        console.log(`DB cache is fresh (${Math.round(dbAgeMs / 1000)}s old) — skipping Alpaca API`);
        setDataSource("cached");
        setSourcesUsed(prev => prev.includes("DB Cache") ? prev : [...prev, "DB Cache"]);
      } else {
        console.log(`DB cache is stale (${Math.round(dbAgeMs / 1000)}s old) — fetching from Alpaca`);
        // Fire-and-forget: overlay Alpaca live prices asynchronously
        const allSymbols = Object.keys(tickerMap);
        fetchLivePricesFromAlpaca(allSymbols).then(alpacaPrices => {
          if (!mountedRef.current) return;
          const alpacaCount = Object.keys(alpacaPrices).length;
          if (alpacaCount === 0) return;

          const cacheEntry: LivePriceCache = { prices: {}, fetchedAt: Date.now() };
          for (const [sym, lp] of Object.entries(alpacaPrices)) {
            cacheEntry.prices[sym] = { ...lp, timestamp: Date.now() };
          }
          setCachedLivePrices(cacheEntry);
          applyLivePrices(cacheEntry.prices);
          setSourcesUsed(prev => prev.includes("Alpaca") ? prev : [...prev, "Alpaca"]);
          setDataSource("alpaca");
        }).catch(err => console.warn("Alpaca overlay failed:", err));

        // Also trigger background DB cache refresh
        supabase.functions.invoke("refresh-prices", { body: {} }).catch(() => {});
      }

    } catch (err) {
      if (!mountedRef.current) return;
      console.error("Failed to fetch market data:", err);
      failCountRef.current += 1;

      const cached = getCachedData();
      if (cached) {
        setMarketData(cached);
        setDataSource("cached");
        const allStocks = [...(cached.gainers || []), ...(cached.losers || []), ...(cached.active || [])];
        const tickerMap: Record<string, TickerData> = {};
        for (const stock of allStocks) {
          if (!tickerMap[stock.symbol]) tickerMap[stock.symbol] = stockToTicker(stock);
        }
        for (const [sym, stock] of ENRICHMENT_MAP) {
          if (!tickerMap[sym]) tickerMap[sym] = stockToTicker(stock);
        }
        setTickers(tickerMap);
        setLastUpdated(new Date().toLocaleTimeString());
        setError("Using cached data — live feed unavailable");
      } else {
        setMarketData(FALLBACK_MARKET_DATA);
        setDataSource("fallback");
        const allStocks = [...FALLBACK_MARKET_DATA.gainers, ...FALLBACK_MARKET_DATA.losers, ...FALLBACK_MARKET_DATA.active];
        const tickerMap: Record<string, TickerData> = {};
        for (const stock of allStocks) {
          if (!tickerMap[stock.symbol]) tickerMap[stock.symbol] = stockToTicker(stock);
        }
        for (const [sym, stock] of ENRICHMENT_MAP) {
          if (!tickerMap[sym]) tickerMap[sym] = stockToTicker(stock);
        }
        setTickers(tickerMap);
        setLastUpdated(new Date().toLocaleTimeString());
        setError("Using default data — live feed unavailable");
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  // Live price overlay: fetches real-time prices from Alpaca — but only if DB cache is stale
  const refreshLivePrices = useCallback(async (skipCache = false) => {
    if (!mountedRef.current) return;
    const symbols = Object.keys(tickers);
    if (symbols.length === 0) return;

    // Check DB freshness first — if fresh, skip Alpaca API entirely
    const { isFresh } = await getDbCacheFreshness();
    if (isFresh && !skipCache) {
      console.log("DB cache fresh — skipping Alpaca live price refresh");
      return;
    }

    // Check localStorage cache
    if (!skipCache) {
      const cached = getCachedLivePrices();
      if (cached) {
        applyLivePrices(cached.prices);
        return;
      }
    }

    try {
      const livePrices = await fetchLivePricesFromAlpaca(symbols);
      if (!mountedRef.current || Object.keys(livePrices).length === 0) return;
      
      const cacheEntry: LivePriceCache = { prices: {} as any, fetchedAt: Date.now() };
      for (const [sym, data] of Object.entries(livePrices)) {
        cacheEntry.prices[sym] = { ...data, timestamp: Date.now() };
      }
      setCachedLivePrices(cacheEntry);
      applyLivePrices(cacheEntry.prices);
      setSourcesUsed(prev => prev.includes("Alpaca") ? prev : [...prev, "Alpaca"]);
      setDataSource("alpaca");
    } catch (err) {
      console.warn("Live price overlay failed:", err);
    }
  }, [tickers]);

  const applyLivePrices = useCallback((prices: Record<string, LivePriceEntry>) => {
    setTickers(prev => {
      const updated = { ...prev };
      for (const [sym, data] of Object.entries(prices)) {
        if (updated[sym]) {
          const newPrice = data.price;
          if (newPrice > 0) {
            const changePct = data.change;
            const size = classifyStockSize(newPrice, sym);
            const vol = classifyVolume(data.volume > 1e9 ? `${(data.volume / 1e9).toFixed(1)}B` : data.volume > 1e6 ? `${(data.volume / 1e6).toFixed(1)}M` : `${(data.volume / 1e3).toFixed(1)}K`);
            updated[sym] = {
              ...updated[sym],
              price: newPrice.toFixed(2),
              priceChange: (newPrice * changePct / 100).toFixed(2),
              priceChangePercent: changePct.toFixed(2),
              high: data.high ? data.high.toFixed(2) : updated[sym].high,
              low: data.low ? data.low.toFixed(2) : updated[sym].low,
              volume: data.volume > 1e6 ? `${(data.volume / 1e6).toFixed(1)}M` : `${(data.volume / 1e3).toFixed(1)}K`,
              stockSize: size,
              volumeLevel: vol,
              profitExpectancy: calcProfitExpectancy(newPrice, changePct, vol, size, updated[sym].category),
              sources: [...(updated[sym].sources || []).filter(s => s !== "Alpaca Live"), "Alpaca Live"],
            };
          }
        }
      }
      return updated;
    });
    setLastUpdated(new Date().toLocaleTimeString());
  }, []);

  // Cooldown-protected manual refresh (min 10s between manual refreshes)
  const manualRefresh = useCallback(() => {
    const elapsed = Date.now() - lastFetchTimeRef.current;
    if (elapsed < 10_000 && lastFetchTimeRef.current > 0) {
      const wait = Math.ceil((10_000 - elapsed) / 1000);
      setError(`Please wait ${wait}s before refreshing again`);
      return;
    }
    fetchMarketData();
  }, [fetchMarketData]);

  // Real-time price push via Alpaca IEX WebSocket (proxied through edge function).
  // Equity symbols only; crypto streams use a different endpoint and are still
  // covered by the 10s polling fallback below.
  const streamSymbols = Object.keys(tickers).filter(s => !s.endsWith("USD") || s.length <= 4 ? true : false)
    .filter(s => /^[A-Z.]{1,8}$/.test(s));
  useAlpacaStream(streamSymbols, useCallback((trade) => {
    if (!mountedRef.current) return;
    setTickers(prev => {
      const cur = prev[trade.symbol];
      if (!cur) return prev;
      const newPrice = trade.price;
      if (!(newPrice > 0)) return prev;
      const baseStr = cur.price;
      const basePrice = parseFloat(baseStr) || newPrice;
      const prevChangePct = parseFloat(cur.priceChangePercent) || 0;
      // Anchor change% off the prior close implied by current price+pct
      const priorClose = basePrice / (1 + prevChangePct / 100) || newPrice;
      const changePct = priorClose > 0 ? ((newPrice - priorClose) / priorClose) * 100 : prevChangePct;
      return {
        ...prev,
        [trade.symbol]: {
          ...cur,
          price: newPrice.toFixed(2),
          priceChange: (newPrice - priorClose).toFixed(2),
          priceChangePercent: changePct.toFixed(2),
          sources: [...(cur.sources || []).filter(s => s !== "Alpaca Stream"), "Alpaca Stream"],
        },
      };
    });
  }, []));

  useEffect(() => {
    mountedRef.current = true;
    fetchMarketData();

    const scheduleNext = () => {
      const backoff = Math.min(10 * 60 * 1000 * Math.pow(1.5, failCountRef.current), 30 * 60 * 1000);
      intervalMsRef.current = backoff;
      return backoff;
    };

    const mainInterval = setInterval(() => {
      scheduleNext();
      fetchMarketData();
    }, intervalMsRef.current);

    // Live price refresh every 10 seconds (in-memory cache makes stale checks free)
    livePriceIntervalRef.current = setInterval(() => {
      if (mountedRef.current) refreshLivePrices();
    }, 10 * 1000);

    // Countdown timer updates every 5 seconds
    countdownRef.current = setInterval(() => {
      if (!mountedRef.current) return;
      const elapsed = Date.now() - (lastFetchTimeRef.current || Date.now());
      const remaining = Math.max(0, Math.ceil((intervalMsRef.current - elapsed) / 1000));
      setNextRefreshIn(remaining);
    }, 5000);

    return () => {
      mountedRef.current = false;
      clearInterval(mainInterval);
      if (countdownRef.current) clearInterval(countdownRef.current);
      if (livePriceIntervalRef.current) clearInterval(livePriceIntervalRef.current);
    };
  }, []); // stable — no deps

  return { marketData, tickers, loading, error, lastUpdated, nextRefreshIn, refresh: manualRefresh, dataSource, sourcesUsed, refreshLivePrices };
}

export function useWebullNews() {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchNews = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("webull-scraper", {
        body: { type: "news" },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setNews(data.news || []);
    } catch (err) {
      console.error("Failed to fetch news:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNews();
    const interval = setInterval(fetchNews, 15 * 60 * 1000); // 15 min news refresh
    return () => clearInterval(interval);
  }, [fetchNews]);

  return { news, loading, refresh: fetchNews };
}

export function useStockNews() {
  const [stockNews, setStockNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentSymbol, setCurrentSymbol] = useState("");

  const fetchStockNews = useCallback(async (symbol: string) => {
    if (!symbol) return;
    setCurrentSymbol(symbol);
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("webull-scraper", {
        body: { type: "stock_news", symbol },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setStockNews(data.news || []);
    } catch (err) {
      console.error("Failed to fetch stock news:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  return { stockNews, loading, currentSymbol, fetchStockNews };
}

// Return all unique symbols from market data
export function getAvailableSymbols(tickers: Record<string, TickerData>): string[] {
  return Object.keys(tickers);
}
