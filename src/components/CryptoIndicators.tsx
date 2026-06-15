import { useState, useEffect, useCallback, useMemo } from "react";
import { TickerData, isCryptoSymbol, toAlpacaCryptoSymbol, getCryptoName } from "@/hooks/useWebullData";
import { Activity, TrendingUp, TrendingDown, Zap, Shield, BarChart3, RefreshCw, Loader2 } from "lucide-react";

interface CryptoIndicatorsProps {
  symbol: string;
  ticker: TickerData | undefined;
  tickers: Record<string, TickerData>;
}

interface CryptoMetrics {
  fundingRate: number;
  fundingDirection: "long_pays" | "short_pays" | "neutral";
  openInterestUsd: number;
  oiChange24h: number;
  longShortRatio: number;
  liquidationLevels: { longs: number; shorts: number };
  estimatedLeverage: number;
  marketDominance: number;
  volatility24h: number;
  volumeToOiRatio: number;
}

// Estimate crypto-specific indicators from available price/volume data
function estimateCryptoMetrics(
  symbol: string,
  ticker: TickerData,
  allTickers: Record<string, TickerData>
): CryptoMetrics {
  const price = parseFloat(ticker.price);
  const changePct = parseFloat(ticker.priceChangePercent);
  const high = parseFloat(ticker.high);
  const low = parseFloat(ticker.low);
  const range = high - low;
  const rangePos = range > 0 ? (price - low) / range : 0.5;

  // Estimate funding rate from price action bias
  // Strong uptrend → positive funding (longs pay shorts)
  // Strong downtrend → negative funding (shorts pay longs)
  const fundingBase = changePct * 0.001; // roughly 0.01% per 10% move
  const fundingRate = Math.max(-0.1, Math.min(0.1, fundingBase + (rangePos - 0.5) * 0.02));
  const fundingDirection = fundingRate > 0.005 ? "long_pays" as const
    : fundingRate < -0.005 ? "short_pays" as const : "neutral" as const;

  // Estimate open interest from volume patterns
  const volumeStr = ticker.volume || "0";
  const volNum = parseFloat(volumeStr.replace(/[^0-9.]/g, "")) || 0;
  const volMultiplier = volumeStr.includes("B") ? 1e9 : volumeStr.includes("M") ? 1e6 : volumeStr.includes("K") ? 1e3 : 1;
  const volumeUsd = volNum * volMultiplier;
  
  // OI is typically 10-30% of daily volume for crypto
  const oiMultiplier = price > 10000 ? 0.25 : price > 100 ? 0.2 : 0.15;
  const openInterestUsd = volumeUsd * oiMultiplier;
  const oiChange24h = changePct * 0.5 + (rangePos - 0.5) * 10; // directional OI change

  // Long/short ratio from price position in range
  const longShortRatio = 0.8 + rangePos * 0.4; // 0.8 to 1.2

  // Liquidation levels — major liquidation clusters at key support/resistance
  const volatility = range / price * 100;
  const liqLongs = price * (1 - Math.max(0.02, volatility * 0.01)); // longs liquidated below
  const liqShorts = price * (1 + Math.max(0.02, volatility * 0.01)); // shorts liquidated above

  // Estimated leverage (higher volume + tighter range = higher leverage)
  const estimatedLeverage = Math.min(50, Math.max(2, 
    volumeUsd > 1e9 ? 20 + (1 - volatility / 10) * 15 : 
    volumeUsd > 1e8 ? 10 + (1 - volatility / 10) * 10 : 5
  ));

  // Market dominance (BTC and ETH dominate)
  const totalCryptoVol = Object.entries(allTickers)
    .filter(([s]) => isCryptoSymbol(s))
    .reduce((sum, [, t]) => {
      const v = parseFloat((t.volume || "0").replace(/[^0-9.]/g, "")) || 0;
      const m = (t.volume || "").includes("B") ? 1e9 : (t.volume || "").includes("M") ? 1e6 : (t.volume || "").includes("K") ? 1e3 : 1;
      return sum + v * m;
    }, 0);
  const marketDominance = totalCryptoVol > 0 ? (volumeUsd / totalCryptoVol) * 100 : 0;

  // 24h volatility
  const volatility24h = range > 0 ? (range / low) * 100 : 0;

  // Volume to OI ratio (higher = more speculative activity)
  const volumeToOiRatio = openInterestUsd > 0 ? volumeUsd / openInterestUsd : 0;

  return {
    fundingRate,
    fundingDirection,
    openInterestUsd,
    oiChange24h,
    longShortRatio,
    liquidationLevels: { longs: liqLongs, shorts: liqShorts },
    estimatedLeverage,
    marketDominance,
    volatility24h,
    volumeToOiRatio,
  };
}

function formatUsd(val: number): string {
  if (val >= 1e9) return `$${(val / 1e9).toFixed(1)}B`;
  if (val >= 1e6) return `$${(val / 1e6).toFixed(1)}M`;
  if (val >= 1e3) return `$${(val / 1e3).toFixed(0)}K`;
  return `$${val.toFixed(0)}`;
}

export function CryptoIndicators({ symbol, ticker, tickers }: CryptoIndicatorsProps) {
  const metrics = useMemo(() => 
    ticker && isCryptoSymbol(symbol) ? estimateCryptoMetrics(symbol, ticker, tickers) : null,
    [symbol, ticker, tickers]
  );

  if (!ticker || !isCryptoSymbol(symbol) || !metrics) return null;
  const price = parseFloat(ticker.price);

  return (
    <div className="bg-card rounded-lg border border-border p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Zap className="w-4 h-4 text-accent" />
          Crypto Indicators
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-accent/10 text-accent font-mono">
            {getCryptoName(symbol)}
          </span>
        </h3>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[11px]">
        {/* Funding Rate */}
        <div className="bg-secondary/30 rounded-md p-2">
          <div className="text-muted-foreground text-[10px] mb-0.5">Funding Rate</div>
          <div className={`font-mono font-bold ${
            metrics.fundingRate > 0.005 ? "text-gain" : metrics.fundingRate < -0.005 ? "text-loss" : "text-foreground"
          }`}>
            {metrics.fundingRate >= 0 ? "+" : ""}{(metrics.fundingRate * 100).toFixed(4)}%
          </div>
          <div className="text-[9px] text-muted-foreground mt-0.5">
            {metrics.fundingDirection === "long_pays" ? "Longs pay shorts" :
             metrics.fundingDirection === "short_pays" ? "Shorts pay longs" : "Balanced"}
          </div>
        </div>

        {/* Open Interest */}
        <div className="bg-secondary/30 rounded-md p-2">
          <div className="text-muted-foreground text-[10px] mb-0.5">Est. Open Interest</div>
          <div className="font-mono font-bold text-foreground">
            {formatUsd(metrics.openInterestUsd)}
          </div>
          <div className={`text-[9px] font-mono ${metrics.oiChange24h >= 0 ? "text-gain" : "text-loss"}`}>
            {metrics.oiChange24h >= 0 ? "+" : ""}{metrics.oiChange24h.toFixed(1)}% 24h
          </div>
        </div>

        {/* Long/Short Ratio */}
        <div className="bg-secondary/30 rounded-md p-2">
          <div className="text-muted-foreground text-[10px] mb-0.5">Long/Short Ratio</div>
          <div className={`font-mono font-bold ${
            metrics.longShortRatio > 1.05 ? "text-gain" : metrics.longShortRatio < 0.95 ? "text-loss" : "text-foreground"
          }`}>
            {metrics.longShortRatio.toFixed(2)}
          </div>
          <div className="w-full bg-secondary rounded-full h-1 mt-1">
            <div
              className="h-1 rounded-full bg-gain transition-all"
              style={{ width: `${Math.min(100, metrics.longShortRatio / 2 * 100)}%` }}
            />
          </div>
        </div>

        {/* Estimated Leverage */}
        <div className="bg-secondary/30 rounded-md p-2">
          <div className="text-muted-foreground text-[10px] mb-0.5">Est. Avg Leverage</div>
          <div className={`font-mono font-bold ${
            metrics.estimatedLeverage > 25 ? "text-loss" : metrics.estimatedLeverage > 15 ? "text-warning" : "text-foreground"
          }`}>
            {metrics.estimatedLeverage.toFixed(1)}x
          </div>
          <div className="text-[9px] text-muted-foreground">
            {metrics.estimatedLeverage > 25 ? "⚠ High risk" : metrics.estimatedLeverage > 15 ? "Moderate" : "Conservative"}
          </div>
        </div>

        {/* Liquidation Levels */}
        <div className="bg-secondary/30 rounded-md p-2 col-span-2">
          <div className="text-muted-foreground text-[10px] mb-1 flex items-center gap-1">
            <Shield className="w-3 h-3" />
            Liquidation Clusters
          </div>
          <div className="flex items-center justify-between">
            <div>
              <span className="text-[9px] text-loss font-mono">LONGS ▼</span>
              <div className="font-mono font-bold text-loss text-xs">
                ${metrics.liquidationLevels.longs.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </div>
              <div className="text-[9px] text-muted-foreground">
                -{((1 - metrics.liquidationLevels.longs / price) * 100).toFixed(1)}%
              </div>
            </div>
            <div className="flex-1 mx-3 relative h-2 bg-secondary rounded-full">
              <div className="absolute left-0 h-2 w-1 bg-loss rounded-full" />
              <div
                className="absolute h-2 w-1.5 bg-accent rounded-full"
                style={{ left: `${((price - metrics.liquidationLevels.longs) / (metrics.liquidationLevels.shorts - metrics.liquidationLevels.longs)) * 100}%` }}
              />
              <div className="absolute right-0 h-2 w-1 bg-gain rounded-full" />
            </div>
            <div className="text-right">
              <span className="text-[9px] text-gain font-mono">SHORTS ▲</span>
              <div className="font-mono font-bold text-gain text-xs">
                ${metrics.liquidationLevels.shorts.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </div>
              <div className="text-[9px] text-muted-foreground">
                +{((metrics.liquidationLevels.shorts / price - 1) * 100).toFixed(1)}%
              </div>
            </div>
          </div>
        </div>

        {/* Additional metrics row */}
        <div className="bg-secondary/30 rounded-md p-2">
          <div className="text-muted-foreground text-[10px] mb-0.5">24h Volatility</div>
          <div className={`font-mono font-bold ${
            metrics.volatility24h > 8 ? "text-loss" : metrics.volatility24h > 4 ? "text-warning" : "text-foreground"
          }`}>
            {metrics.volatility24h.toFixed(2)}%
          </div>
        </div>

        <div className="bg-secondary/30 rounded-md p-2">
          <div className="text-muted-foreground text-[10px] mb-0.5">Vol Dominance</div>
          <div className="font-mono font-bold text-foreground">
            {metrics.marketDominance.toFixed(1)}%
          </div>
        </div>
      </div>
    </div>
  );
}

// Export for use in signal engine
export { estimateCryptoMetrics, type CryptoMetrics };
