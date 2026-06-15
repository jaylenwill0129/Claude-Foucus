import { useMarketRegime, type Regime } from "@/hooks/useMarketRegime";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Activity, AlertTriangle } from "lucide-react";

const STYLES: Record<Regime, { label: string; cls: string; Icon: typeof TrendingUp }> = {
  TREND_UP: { label: "Trend Up", cls: "bg-green-500/10 text-green-400 border-green-500/30", Icon: TrendingUp },
  TREND_DOWN: { label: "Trend Down", cls: "bg-red-500/10 text-red-400 border-red-500/30", Icon: TrendingDown },
  CHOP: { label: "Chop", cls: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30", Icon: Activity },
  HIGH_VOL: { label: "High Vol", cls: "bg-orange-500/10 text-orange-400 border-orange-500/30", Icon: AlertTriangle },
};

export function AutoTraderRegimeBadge({ compact = false }: { compact?: boolean }) {
  const { data, isLoading } = useMarketRegime();
  if (isLoading || !data) return null;
  const style = STYLES[data.regime] ?? STYLES.CHOP;
  const { Icon } = style;
  return (
    <Badge variant="outline" className={`gap-1.5 font-mono text-xs ${style.cls}`} title={`Size× ${data.size_multiplier.toFixed(2)} · Min ${data.min_grade} · ADX ${data.adx?.toFixed(0) ?? "—"} · VIX ${data.vix?.toFixed(1) ?? "—"}`}>
      <Icon className="w-3 h-3" />
      {compact ? data.regime.replace("_", " ") : `Regime: ${style.label}`}
      {!compact && (
        <span className="opacity-60 ml-1">× {data.size_multiplier.toFixed(2)}</span>
      )}
    </Badge>
  );
}