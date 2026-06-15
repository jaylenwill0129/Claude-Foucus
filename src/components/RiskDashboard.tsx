import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { invokeAlpacaTrade } from "@/lib/alpacaAccount";
import {
  Shield, TrendingUp, TrendingDown, AlertTriangle, Activity, Gauge,
  Target, BarChart3, PieChart, Percent, DollarSign, Flame,
} from "lucide-react";
import { computeAdaptiveRisk, getTierColor, getTierBgColor, getTierIcon, type AdaptiveRiskProfile, type StockContext } from "@/lib/adaptiveRisk";

interface RiskMetrics {
  // From portfolio data
  totalEquity: number;
  totalCash: number;
  totalInvested: number;
  investedPct: number;
  // Per-position risk
  positionRisks: Array<{
    symbol: string;
    weight: number;
    unrealizedPl: number;
    unrealizedPlPct: number;
    side: string;
    currentPrice: number;
    avgEntryPrice: number;
    riskTier?: AdaptiveRiskProfile["tier"];
  }>;
  // Aggregate
  largestPosition: number;
  concentrationScore: number; // 0-100, lower = more diversified
  sectorExposure: Record<string, number>;
  longExposure: number;
  shortExposure: number;
  netExposure: number;
  grossExposure: number;
  // Calculated risk
  valueAtRisk95: number; // 95% daily VaR estimate
  sortinoEstimate: number;
  calmarEstimate: number;
}

interface RiskDashboardProps {
  mode: "paper" | "live";
}

const SECTOR_MAP: Record<string, string> = {
  AAPL: "Tech", MSFT: "Tech", NVDA: "Tech", GOOGL: "Tech", META: "Tech", AMZN: "Tech", TSLA: "Tech",
  AMD: "Tech", INTC: "Tech", CRM: "Tech", NFLX: "Tech", PLTR: "Tech", SNOW: "Tech", ARM: "Tech",
  SMCI: "Tech", DELL: "Tech", AVGO: "Tech", ADBE: "Tech", ORCL: "Tech", QCOM: "Tech", MU: "Tech",
  ANET: "Tech", VRT: "Tech", RBLX: "Tech", BABA: "Tech", BIDU: "Tech", TSM: "Tech",
  JPM: "Finance", GS: "Finance", BAC: "Finance", V: "Finance", MA: "Finance", PYPL: "Finance", COIN: "Finance",
  SOFI: "Finance", AFRM: "Finance", UPST: "Finance", NU: "Finance",
  JNJ: "Health", UNH: "Health", LLY: "Health", PFE: "Health", ABBV: "Health", MRNA: "Health",
  REGN: "Health", VRTX: "Health", BIIB: "Health", ALNY: "Health",
  XOM: "Energy", CVX: "Energy", COP: "Energy", OXY: "Energy", VST: "Energy", CEG: "Energy",
  NNE: "Energy", OKLO: "Energy", SMR: "Energy", CCJ: "Energy", UEC: "Energy",
  WMT: "Consumer", KO: "Consumer", MCD: "Consumer", NKE: "Consumer", DIS: "Consumer",
  COST: "Consumer", LULU: "Consumer", DKNG: "Consumer", CCL: "Consumer", RCL: "Consumer",
  BA: "Industrial", CAT: "Industrial", GE: "Industrial", RTX: "Industrial", LMT: "Industrial",
  FCX: "Materials", NUE: "Materials", TMC: "Materials", CLF: "Materials", VALE: "Materials",
};

export const RiskDashboard = ({ mode }: RiskDashboardProps) => {
  const [metrics, setMetrics] = useState<RiskMetrics | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchRiskData = useCallback(async () => {
    setLoading(true);
    try {
      const [accRes, posRes] = await Promise.all([
        invokeAlpacaTrade({ body: { action: "account", mode } }),
        invokeAlpacaTrade({ body: { action: "positions", mode } }),
      ]);

      if (accRes.error || accRes.data?.error || posRes.error || posRes.data?.error) return;

      const account = accRes.data;
      const positions = posRes.data || [];

      const totalEquity = parseFloat(account.equity) || 0;
      const totalCash = parseFloat(account.cash) || 0;
      const totalInvested = positions.reduce((s: number, p: any) => s + Math.abs(parseFloat(p.market_value) || 0), 0);

      const positionRisks = positions.map((p: any) => {
        const price = parseFloat(p.current_price) || parseFloat(p.market_value) / (parseFloat(p.qty) || 1) || 0;
        const ctx: StockContext = {
          symbol: p.symbol, price, changePct: (parseFloat(p.unrealized_plpc) || 0) * 100,
          high: price * 1.01, low: price * 0.99, volume: 0,
        };
        const profile = computeAdaptiveRisk(ctx, {
          stopLossPct: 2, takeProfitPct: 5, positionSizePct: 5,
          requireMinRR: 2, confidenceThreshold: 55, trailingStopPct: 1.5,
        });
        return {
          symbol: p.symbol,
          weight: totalEquity > 0 ? (Math.abs(parseFloat(p.market_value) || 0) / totalEquity) * 100 : 0,
          unrealizedPl: parseFloat(p.unrealized_pl) || 0,
          unrealizedPlPct: (parseFloat(p.unrealized_plpc) || 0) * 100,
          side: p.side,
          currentPrice: price,
          avgEntryPrice: parseFloat(p.avg_entry_price) || 0,
          riskTier: profile.tier,
        };
      });

      const longExposure = positions.filter((p: any) => p.side === "long").reduce((s: number, p: any) => s + (parseFloat(p.market_value) || 0), 0);
      const shortExposure = Math.abs(positions.filter((p: any) => p.side === "short").reduce((s: number, p: any) => s + (parseFloat(p.market_value) || 0), 0));

      // Sector exposure
      const sectorExposure: Record<string, number> = {};
      for (const p of positions) {
        const sector = SECTOR_MAP[p.symbol] || "Other";
        const val = Math.abs(parseFloat(p.market_value) || 0);
        sectorExposure[sector] = (sectorExposure[sector] || 0) + val;
      }

      // Concentration (Herfindahl Index)
      const weights = positionRisks.map((p: any) => p.weight / 100);
      const hhi = weights.reduce((s: number, w: number) => s + w * w, 0);
      const concentrationScore = Math.min(100, hhi * 100 * positions.length);

      const largestPosition = Math.max(0, ...positionRisks.map((p: any) => p.weight));

      // Simplified VaR estimate (2% daily vol assumption * 1.65 for 95%)
      const valueAtRisk95 = totalEquity * 0.02 * 1.65;

      setMetrics({
        totalEquity, totalCash, totalInvested,
        investedPct: totalEquity > 0 ? (totalInvested / totalEquity) * 100 : 0,
        positionRisks,
        largestPosition,
        concentrationScore,
        sectorExposure,
        longExposure, shortExposure,
        netExposure: longExposure - shortExposure,
        grossExposure: longExposure + shortExposure,
        valueAtRisk95,
        sortinoEstimate: 0,
        calmarEstimate: 0,
      });
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [mode]);

  useEffect(() => {
    fetchRiskData();
    const interval = setInterval(fetchRiskData, 15000);
    return () => clearInterval(interval);
  }, [fetchRiskData]);

  if (!metrics) {
    return (
      <div className="bg-card rounded-xl border border-border p-4">
        <div className="flex items-center gap-2 text-muted-foreground text-xs">
          <Shield className="w-4 h-4" />
          {loading ? "Loading risk data..." : "Risk dashboard unavailable"}
        </div>
      </div>
    );
  }

  const riskLevel = metrics.investedPct > 80 ? "HIGH" : metrics.investedPct > 50 ? "MODERATE" : "LOW";
  const riskColor = riskLevel === "HIGH" ? "text-loss" : riskLevel === "MODERATE" ? "text-warning" : "text-gain";
  const riskBg = riskLevel === "HIGH" ? "bg-loss/10" : riskLevel === "MODERATE" ? "bg-warning/10" : "bg-gain/10";

  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      <div className="px-4 py-3 flex items-center justify-between border-b border-border/50">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-bold text-foreground">Risk Analytics</h3>
          <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono font-semibold ${riskBg} ${riskColor}`}>
            {riskLevel} RISK
          </span>
        </div>
      </div>

      <div className="p-4 space-y-3">
        {/* Exposure summary */}
        <div className="grid grid-cols-3 gap-2">
          <div className="p-2 rounded-lg bg-secondary/30 text-center">
            <div className="text-[8px] text-muted-foreground uppercase">Invested</div>
            <div className="text-sm font-mono font-bold text-foreground">{metrics.investedPct.toFixed(1)}%</div>
            <div className="text-[9px] text-muted-foreground">${metrics.totalInvested.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
          </div>
          <div className="p-2 rounded-lg bg-secondary/30 text-center">
            <div className="text-[8px] text-muted-foreground uppercase">Net Exposure</div>
            <div className={`text-sm font-mono font-bold ${metrics.netExposure >= 0 ? "text-gain" : "text-loss"}`}>
              ${Math.abs(metrics.netExposure).toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </div>
            <div className="text-[9px] text-muted-foreground">
              L: ${metrics.longExposure.toLocaleString(undefined, { maximumFractionDigits: 0 })} / S: ${metrics.shortExposure.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </div>
          </div>
          <div className="p-2 rounded-lg bg-secondary/30 text-center">
            <div className="text-[8px] text-muted-foreground uppercase">Daily VaR (95%)</div>
            <div className="text-sm font-mono font-bold text-loss">${metrics.valueAtRisk95.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
            <div className="text-[9px] text-muted-foreground">max expected loss</div>
          </div>
        </div>

        {/* Concentration bar */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[9px]">
            <span className="text-muted-foreground flex items-center gap-1"><Gauge className="w-3 h-3" /> Concentration</span>
            <span className={`font-mono ${metrics.concentrationScore > 60 ? "text-loss" : metrics.concentrationScore > 30 ? "text-warning" : "text-gain"}`}>
              {metrics.concentrationScore.toFixed(0)}%
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                metrics.concentrationScore > 60 ? "bg-loss" : metrics.concentrationScore > 30 ? "bg-warning" : "bg-gain"
              }`}
              style={{ width: `${Math.min(100, metrics.concentrationScore)}%` }}
            />
          </div>
        </div>

        {/* Largest position */}
        {metrics.largestPosition > 0 && (
          <div className="flex items-center justify-between text-[10px] px-1">
            <span className="text-muted-foreground">Largest Position</span>
            <span className={`font-mono font-bold ${metrics.largestPosition > 25 ? "text-loss" : "text-foreground"}`}>
              {metrics.largestPosition.toFixed(1)}%
              {metrics.largestPosition > 25 && <AlertTriangle className="w-3 h-3 inline ml-1 text-loss" />}
            </span>
          </div>
        )}

        {/* Sector exposure */}
        {Object.keys(metrics.sectorExposure).length > 0 && (
          <div className="space-y-1">
            <div className="text-[9px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
              <PieChart className="w-3 h-3" /> Sector Exposure
            </div>
            <div className="space-y-1">
              {Object.entries(metrics.sectorExposure)
                .sort((a, b) => b[1] - a[1])
                .map(([sector, value]) => {
                  const pct = metrics.totalEquity > 0 ? (value / metrics.totalEquity) * 100 : 0;
                  return (
                    <div key={sector} className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground w-16 truncate">{sector}</span>
                      <div className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
                        <div className="h-full rounded-full bg-primary/60" style={{ width: `${Math.min(100, pct)}%` }} />
                      </div>
                      <span className="text-[10px] font-mono text-foreground w-12 text-right">{pct.toFixed(1)}%</span>
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {/* Position weights */}
        {metrics.positionRisks.length > 0 && (
          <div className="space-y-1">
            <div className="text-[9px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
              <Target className="w-3 h-3" /> Position Weights
            </div>
            <div className="grid grid-cols-2 gap-1">
              {metrics.positionRisks
                .sort((a, b) => b.weight - a.weight)
                .slice(0, 8)
                .map(p => (
                  <div key={p.symbol} className="flex items-center justify-between p-1.5 rounded bg-secondary/20 border border-border/30">
                    <div className="flex items-center gap-1">
                      <span className={`text-[9px] ${p.side === "long" ? "text-gain" : "text-loss"}`}>
                        {p.side === "long" ? "▲" : "▼"}
                      </span>
                      <span className="text-[10px] font-semibold text-foreground">{p.symbol}</span>
                      {p.riskTier && (
                        <span className={`text-[7px] px-1 py-0.5 rounded ${getTierBgColor(p.riskTier)} ${getTierColor(p.riskTier)}`}>
                          {getTierIcon(p.riskTier)}
                        </span>
                      )}
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] font-mono text-muted-foreground">{p.weight.toFixed(1)}%</span>
                      <span className={`text-[9px] font-mono ml-1 ${p.unrealizedPl >= 0 ? "text-gain" : "text-loss"}`}>
                        {p.unrealizedPlPct >= 0 ? "+" : ""}{p.unrealizedPlPct.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default RiskDashboard;
