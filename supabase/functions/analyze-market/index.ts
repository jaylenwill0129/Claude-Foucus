import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Sector mapping for correlation awareness
const SECTOR_MAP: Record<string, string> = {
  AAPL: "tech", MSFT: "tech", NVDA: "tech", GOOGL: "tech", META: "tech", AMZN: "tech", TSLA: "tech",
  AVGO: "tech", ADBE: "tech", CRM: "tech", AMD: "tech", INTC: "tech", ORCL: "tech", NFLX: "tech",
  CSCO: "tech", QCOM: "tech", INTU: "tech", AMAT: "tech", NOW: "tech", UBER: "tech", SQ: "tech",
  SHOP: "tech", SNOW: "tech", PANW: "tech", CRWD: "tech", MRVL: "tech", MU: "tech", LRCX: "tech",
  IBM: "tech", TXN: "tech", KLAC: "tech", SNPS: "tech", CDNS: "tech", ADSK: "tech", WDAY: "tech",
  ZS: "tech", DDOG: "tech", NET: "tech", FTNT: "tech", TEAM: "tech", TTD: "tech", SPOT: "tech",
  ROKU: "tech", TWLO: "tech", OKTA: "tech", MDB: "tech", ABNB: "tech", DASH: "tech", PLTR: "tech",
  ARM: "tech", SMCI: "tech", DELL: "tech", APP: "tech", ANET: "tech", VRT: "tech",
  ON: "tech", MPWR: "tech", SWKS: "tech", MCHP: "tech", GFS: "tech", AI: "tech",
  CYBR: "tech", RBLX: "tech", TTWO: "tech", EA: "tech", BABA: "tech", BIDU: "tech", TSM: "tech",
  JPM: "finance", GS: "finance", BAC: "finance", MS: "finance", WFC: "finance", V: "finance", MA: "finance",
  AXP: "finance", BLK: "finance", SCHW: "finance", C: "finance", COIN: "finance", PYPL: "finance",
  USB: "finance", PNC: "finance", CME: "finance", ICE: "finance", SPGI: "finance", AFRM: "finance",
  UPST: "finance", NU: "finance", SOFI: "finance",
  JNJ: "healthcare", UNH: "healthcare", LLY: "healthcare", PFE: "healthcare", ABBV: "healthcare", MRK: "healthcare", TMO: "healthcare",
  ABT: "healthcare", AMGN: "healthcare", ISRG: "healthcare", GILD: "healthcare", NVO: "healthcare",
  DHR: "healthcare", SYK: "healthcare", BSX: "healthcare", REGN: "healthcare", VRTX: "healthcare", MRNA: "healthcare",
  BIIB: "healthcare", ALNY: "healthcare",
  XOM: "energy", CVX: "energy", COP: "energy", SLB: "energy", EOG: "energy",
  OXY: "energy", PSX: "energy", VLO: "energy", MPC: "energy", HAL: "energy", DVN: "energy", FANG: "energy",
  VST: "energy", CEG: "energy", NNE: "energy", OKLO: "energy", SMR: "energy", CCJ: "energy", UEC: "energy",
  WMT: "consumer", KO: "consumer", PEP: "consumer", COST: "consumer", MCD: "consumer", SBUX: "consumer", NKE: "consumer", DIS: "consumer",
  PG: "consumer", HD: "consumer", TGT: "consumer", LOW: "consumer", LULU: "consumer", CMG: "consumer",
  DKNG: "consumer", CCL: "consumer", RCL: "consumer", F: "consumer", GM: "consumer",
  BA: "industrial", GE: "industrial", CAT: "industrial", HON: "industrial", UNP: "industrial",
  RTX: "industrial", LMT: "industrial", DE: "industrial", ETN: "industrial", FDX: "industrial",
  LIN: "materials", APD: "materials", SHW: "materials", FCX: "materials", NUE: "materials",
  TMC: "materials", CLF: "materials", VALE: "materials", RIO: "materials", BHP: "materials",
};

type SignalName = "strong_buy" | "buy" | "neutral" | "sell" | "strong_sell";
type TrendName = "bullish" | "bearish" | "sideways";
type EntryQuality = "A" | "B" | "C" | "D" | "F";
type SectorRisk = "low" | "medium" | "high";

interface TradingSignalPayload {
  signal: SignalName;
  confidence: number;
  reasons: string[];
  rsi_estimate: number;
  trend: TrendName;
  key_levels: { support: number; resistance: number };
  risk_reward_ratio: number;
  suggested_stop_loss_pct: number;
  suggested_take_profit_pct: number;
  volatility_warning: boolean;
  entry_quality: EntryQuality;
  sector_risk: SectorRisk;
  analysis_mode?: "ai" | "fallback";
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const buildFallbackSignal = ({
  marketData,
  statEdge,
  price,
  high,
  low,
  changePct,
  rangePos,
  momentumScore,
  volatilityRegime,
  volumeQuality,
  sector,
  sectorConcentration,
  fallbackReason,
}: {
  marketData: Record<string, unknown>;
  statEdge?: Record<string, unknown>;
  price: number;
  high: number;
  low: number;
  changePct: number;
  rangePos: number;
  momentumScore: number;
  volatilityRegime: string;
  volumeQuality: string;
  sector: string;
  sectorConcentration: number;
  fallbackReason: string;
}): TradingSignalPayload => {
  const reasons = [
    `Local fallback analysis used: ${fallbackReason}`,
  ];

  const trend: TrendName = changePct > 1 ? "bullish" : changePct < -1 ? "bearish" : "sideways";
  const rsiEstimate = clamp(50 + (changePct * 3) + ((rangePos - 50) * 0.35), 10, 90);

  let score = 0;

  if (changePct >= 4) {
    score += 2;
    reasons.push(`Strong price momentum: ${changePct.toFixed(2)}%`);
  } else if (changePct >= 1) {
    score += 1;
    reasons.push(`Positive price trend: ${changePct.toFixed(2)}%`);
  } else if (changePct <= -4) {
    score -= 2;
    reasons.push(`Sharp downside momentum: ${changePct.toFixed(2)}%`);
  } else if (changePct <= -1) {
    score -= 1;
    reasons.push(`Negative price trend: ${changePct.toFixed(2)}%`);
  }

  if (volumeQuality === "high") {
    score += 1.25;
    reasons.push("High volume supports the move");
  } else if (volumeQuality === "medium") {
    score += 0.5;
  } else if (volumeQuality === "low") {
    score -= 0.5;
    reasons.push("Low volume reduces conviction");
  } else if (volumeQuality === "very_low") {
    score -= 1;
    reasons.push("Very low volume reduces conviction");
  }

  if (rangePos > 55 && rangePos < 85) score += 0.75;
  if (rangePos > 90) {
    score -= 1.5;
    reasons.push("Price is near the day high, so chasing risk is elevated");
  }
  if (rangePos < 10) {
    score += 0.5;
    reasons.push("Price is near the day low, which can support bounce setups");
  }

  const patternText = String(marketData.candlePatterns || "").toLowerCase();
  if (patternText.includes("new high breakout") || patternText.includes("flat top breakout") || patternText.includes("bull flag")) {
    score += 1;
    reasons.push("Bullish breakout pattern detected");
  }
  if (patternText.includes("bear") || patternText.includes("reversal")) {
    score -= 1;
    reasons.push("Bearish candle pressure detected");
  }

  const floatM = parseFloat(String(marketData.floatM || "0")) || 0;
  const turnoverRatio = parseFloat(String(marketData.turnoverRatio || "0")) || 0;
  if (floatM > 0 && floatM < 10 && turnoverRatio >= 0.25 && changePct > 0) {
    score += 1.25;
    reasons.push("Low-float supply with strong turnover can accelerate momentum");
  }

  const statScore = Number(statEdge?.score || 0);
  if (statScore >= 50) {
    score += 1;
    reasons.push(`Statistical edge detected (${statScore}/100)`);
  }

  if (sectorConcentration >= 2) {
    score -= 1;
    reasons.push(`Existing ${sector} exposure raises concentration risk`);
  }

  const supportBase = low > 0 ? low : price * 0.985;
  const resistanceBase = high > 0 ? high : price * 1.02;
  const support = Number((supportBase >= price ? price * 0.99 : supportBase).toFixed(4));
  const resistance = Number((resistanceBase <= price ? price * 1.015 : resistanceBase).toFixed(4));
  const stopLossPct = clamp(((price - support) / Math.max(price, 0.0001)) * 100, 0.5, 8);
  const takeProfitPct = clamp(((resistance - price) / Math.max(price, 0.0001)) * 100, 1, 20);
  const riskRewardRatio = Number((takeProfitPct / Math.max(stopLossPct, 0.1)).toFixed(2));

  let signal: SignalName = "neutral";
  let confidence = clamp(30 + Math.abs(score) * 6, 25, 72);
  let entryQuality: EntryQuality = "C";

  if (volatilityRegime === "extreme") {
    signal = "neutral";
    confidence = 28;
    entryQuality = "F";
    reasons.push("Extreme volatility blocks actionable entries");
  } else if (score >= 3.5 && rangePos <= 90) {
    signal = momentumScore > 35 && volumeQuality === "high" ? "strong_buy" : "buy";
    confidence = clamp(52 + score * 5, 40, 74);
    entryQuality = score >= 4.5 ? "A" : "B";
  } else if (score <= -3.5 && rangePos >= 10) {
    signal = momentumScore < -35 && volumeQuality !== "very_low" ? "strong_sell" : "sell";
    confidence = clamp(52 + Math.abs(score) * 5, 40, 74);
    entryQuality = score <= -4.5 ? "A" : "B";
  } else if (Math.abs(score) < 1.5) {
    entryQuality = "D";
  }

  if (volumeQuality === "low" || volumeQuality === "very_low") {
    confidence = Math.min(confidence, 45);
  }

  if (volatilityRegime === "high") {
    confidence = Math.min(confidence, 55);
  }

  if (riskRewardRatio < 1.5 && signal !== "neutral") {
    signal = "neutral";
    confidence = Math.min(confidence, 40);
    entryQuality = "D";
    reasons.push("Risk/reward is too weak for an actionable trade");
  }

  const sectorRisk: SectorRisk = sectorConcentration >= 2 ? "high" : sector === "unknown" ? "medium" : "low";

  return {
    signal,
    confidence: Number(confidence.toFixed(0)),
    reasons: reasons.slice(0, 5),
    rsi_estimate: Number(rsiEstimate.toFixed(1)),
    trend,
    key_levels: { support, resistance },
    risk_reward_ratio: riskRewardRatio,
    suggested_stop_loss_pct: Number(stopLossPct.toFixed(2)),
    suggested_take_profit_pct: Number(takeProfitPct.toFixed(2)),
    volatility_warning: volatilityRegime === "high" || volatilityRegime === "extreme",
    entry_quality: entryQuality,
    sector_risk: sectorRisk,
    analysis_mode: "fallback",
  };
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const BodySchema = z.object({
      marketData: z.object({
        symbol: z.string().min(1).max(32),
        price: z.union([z.number(), z.string()]).optional(),
        high: z.union([z.number(), z.string()]).optional(),
        low: z.union([z.number(), z.string()]).optional(),
        priceChangePercent: z.union([z.number(), z.string()]).optional(),
        rangePosition: z.union([z.number(), z.string()]).optional(),
      }).passthrough(),
      portfolioContext: z.record(z.unknown()).optional(),
      statEdge: z.record(z.unknown()).optional(),
    });
    let body: unknown;
    try { body = await req.json(); } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: "Invalid payload", details: parsed.error.flatten() }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const { marketData, portfolioContext, statEdge } = parsed.data;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const price = parseFloat(marketData.price) || 0;
    const high = parseFloat(marketData.high) || price;
    const low = parseFloat(marketData.low) || price;
    const changePct = parseFloat(marketData.priceChangePercent) || 0;
    const rangePos = parseFloat(marketData.rangePosition) || 50;

    // === AI ANALYSIS CACHE (5 min TTL, bucketed by price/range/change) ===
    // Two identical setups within 5 minutes shouldn't pay for two Gemini calls.
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const cacheClient = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
      ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
      : null;
    const priceBucket = price > 0 ? Math.round(price * 100) / 100 : 0; // cent precision
    const rangeBucket = Math.round(rangePos / 5) * 5; // 5% buckets
    const changeBucket = Math.round(changePct * 2) / 2; // 0.5% buckets
    const cacheKey = `am:${marketData.symbol}:${priceBucket}:${rangeBucket}:${changeBucket}`;
    if (cacheClient) {
      try {
        const { data: hit } = await cacheClient
          .from("ai_analysis_cache")
          .select("payload, expires_at")
          .eq("cache_key", cacheKey)
          .maybeSingle();
        if (hit && hit.payload && new Date(hit.expires_at).getTime() > Date.now()) {
          return new Response(JSON.stringify({ ...hit.payload, cached: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } catch (e) {
        console.warn("cache read failed", e);
      }
    }
    
    const range = high - low;
    const rangePct = price > 0 ? (range / price) * 100 : 0;
    const volatilityRegime = rangePct > 8 ? "extreme" : rangePct > 5 ? "high" : rangePct > 2 ? "medium" : "low";
    
    const momentumScore = (changePct * 10) + ((rangePos - 50) * 0.5);
    const meanReversionRisk = rangePos > 85 ? "high_overbought" : rangePos < 15 ? "high_oversold" : "normal";
    
    // Volume quality assessment
    const volumeStr = marketData.quoteVolume || "0";
    const volumeNum = parseFloat(volumeStr.replace(/[^\d.]/g, '')) || 0;
    const volumeQuality = volumeNum > 50 ? "high" : volumeNum > 10 ? "medium" : volumeNum > 1 ? "low" : "very_low";

    // Sector context
    const symbol = (marketData.symbol || "").replace("USDT", "");
    const sector = SECTOR_MAP[symbol] || "unknown";

    // Portfolio context for anti-correlation
    const existingPositions = portfolioContext?.existingPositions || [];
    const existingSectors = existingPositions.map((s: string) => SECTOR_MAP[s] || "unknown");
    const sectorConcentration = existingSectors.filter((s: string) => s === sector).length;

    // Float and pattern context from client
    const floatInfo = marketData.floatM ? `\n- Float Estimate: ${marketData.floatM}M shares (${marketData.floatSource || "estimated"})
- Float Turnover: ${marketData.turnoverRatio || "N/A"}
- Low Float: ${parseFloat(marketData.floatM) < 10 ? "YES — potential for explosive moves" : "No"}` : "";
    
    const patternInfo = marketData.candlePatterns ? `\n
CANDLESTICK PATTERNS DETECTED:
${marketData.candlePatterns}
Pattern Bias Score: ${marketData.patternBias || 0} (-100 bearish to +100 bullish)
IMPORTANT: Weight Warrior Trading patterns (New High Breakout, Flat Top Breakout) as PRIMARY entry signals.` : "";

    const prompt = `You are an elite quantitative trading analyst managing real capital. Your PRIMARY goal is CAPITAL PRESERVATION with selective high-probability entries. You should REJECT most trades — only signal when the edge is clear.

Market Data for ${marketData.symbol}:
- Current Price: $${marketData.price}
- 24h Change: ${changePct.toFixed(2)}%
- 24h High: $${high.toFixed(2)} | Low: $${low.toFixed(2)}
- Volume: $${marketData.quoteVolume} (quality: ${volumeQuality})
- Range Position: ${rangePos.toFixed(1)}% (0=day low, 100=day high)
- Volatility Regime: ${volatilityRegime} (range: ${rangePct.toFixed(1)}%)
- Momentum Score: ${momentumScore.toFixed(1)}
- Mean Reversion Risk: ${meanReversionRisk}
- Sector: ${sector}
- Existing sector positions: ${sectorConcentration} (concentration risk: ${sectorConcentration >= 2 ? "HIGH" : "low"})${floatInfo}
${statEdge ? `
STATISTICAL ANOMALIES DETECTED (score: ${statEdge.score}/100):
${statEdge.triggers?.map((t: string) => `- ${t}`).join("\n") || "None"}
${statEdge.volumeSpike ? "⚡ VOLUME SPIKE — institutional interest likely" : ""}
${statEdge.momentumAnomaly ? "🔥 MOMENTUM ANOMALY — unusual price action detected" : ""}
${statEdge.rangeBreakout ? "💥 RANGE BREAKOUT — potential trend initiation" : ""}
${statEdge.sectorDivergence ? "🔀 SECTOR DIVERGENCE — stock decoupling from peers" : ""}

IMPORTANT: Statistical anomalies suggest elevated probability of directional move. Weight these signals more heavily in your analysis. A volume spike + momentum anomaly together indicate possible catalytic event.
` : ""}${patternInfo}
STRICT RULES (MUST FOLLOW):
1. DEFAULT TO NEUTRAL — only deviate when evidence is overwhelming
2. NEVER give confidence > 80 unless ALL of: strong momentum, good volume, favorable range position, low volatility
3. If volume quality is "low" or "very_low", MAX confidence is 45
4. If volatility is "extreme", signal MUST be "neutral" with volatility_warning=true
5. If volatility is "high", MAX confidence is 55
6. If range position > 90% (near highs), do NOT buy — consider sell or neutral
7. If range position < 10% (near lows), do NOT sell — consider buy or neutral
8. If sector concentration >= 2, REDUCE confidence by 20 (diversification risk)
9. R:R must be > 2.0 for any buy/sell signal. Below 1.5 = MUST be neutral
10. Stop losses should be based on actual support/resistance, NOT arbitrary percentages
11. Prefer entries near support with tight stops over chasing momentum
12. Consider time of day and overall market conditions
13. If statistical anomalies are present with score >= 50, you may be MORE aggressive with confidence (up to +10 bonus)
14. LOW FLOAT stocks (<10M shares) with high relative volume = potential for 50-100%+ moves — be more aggressive on confirmed breakouts
15. Warrior Trading patterns (New High Breakout, Flat Top Breakout) are PRIMARY entry signals — boost confidence +5-10 when detected`;

    const aiBody = JSON.stringify({
      model: "google/gemini-2.5-flash-lite",
      messages: [
        { role: "system", content: "You are a disciplined quantitative trader. Your edge comes from patience and selectivity. You reject 70%+ of potential trades. Capital preservation is paramount. Every signal must have a clear, data-backed reason with precise levels." },
        { role: "user", content: prompt },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "trading_signal",
            description: "Return a structured trading signal. Default to neutral unless strong evidence exists.",
            parameters: {
              type: "object",
              properties: {
                signal: { type: "string", enum: ["strong_buy", "buy", "neutral", "sell", "strong_sell"] },
                confidence: { type: "number", description: "0-100. Most signals should be 30-60. Only exceptional setups > 70." },
                reasons: { type: "array", items: { type: "string" }, description: "3-5 concise data-driven reasons" },
                rsi_estimate: { type: "number" },
                trend: { type: "string", enum: ["bullish", "bearish", "sideways"] },
                key_levels: {
                  type: "object",
                  properties: { support: { type: "number" }, resistance: { type: "number" } },
                  required: ["support", "resistance"],
                  additionalProperties: false,
                },
                risk_reward_ratio: { type: "number", description: "Must be > 2.0 for actionable signals" },
                suggested_stop_loss_pct: { type: "number" },
                suggested_take_profit_pct: { type: "number" },
                volatility_warning: { type: "boolean" },
                entry_quality: { type: "string", enum: ["A", "B", "C", "D", "F"], description: "A=perfect setup, F=avoid" },
                sector_risk: { type: "string", enum: ["low", "medium", "high"] },
              },
              required: ["signal", "confidence", "reasons", "rsi_estimate", "trend", "key_levels", "risk_reward_ratio", "suggested_stop_loss_pct", "suggested_take_profit_pct", "volatility_warning", "entry_quality", "sector_risk"],
              additionalProperties: false,
            },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "trading_signal" } },
    });

    let response: Response | null = null;
    let aiFailureReason = "AI gateway unreachable after retries";
    let aiBodyText: string | null = null;

    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController();
      // Single timeout covers BOTH the request AND body read.
      // Previously clearTimeout fired after headers arrived, so a hanging body
      // would stall until the 150s edge idle-timeout.
      const timeout = setTimeout(() => controller.abort(), 25000);
      try {
        response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: aiBody,
          signal: controller.signal,
        });
        // Read body while abort timer is still armed
        if (response.ok) {
          aiBodyText = await response.text();
        }
        clearTimeout(timeout);
        break;
      } catch (fetchErr) {
        clearTimeout(timeout);
        response = null;
        console.error(`AI fetch attempt ${attempt + 1} failed:`, fetchErr);
        aiFailureReason = fetchErr instanceof Error
          ? fetchErr.name === "AbortError"
            ? "AI request timed out"
            : fetchErr.message
          : "AI gateway request failed";
        if (attempt === 1) break;
        await new Promise(r => setTimeout(r, 750 * (attempt + 1)));
      }
    }

    if (!response) {
      const fallbackSignal = buildFallbackSignal({
        marketData,
        statEdge,
        price,
        high,
        low,
        changePct,
        rangePos,
        momentumScore,
        volatilityRegime,
        volumeQuality,
        sector,
        sectorConcentration,
        fallbackReason: aiFailureReason,
      });

      return new Response(JSON.stringify(fallbackSignal), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited, please try again later" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        // Graceful degradation: return local fallback signal instead of propagating 402
        // so clients can keep working when AI credits are exhausted.
        const fallbackSignal = buildFallbackSignal({
          marketData,
          statEdge,
          price,
          high,
          low,
          changePct,
          rangePos,
          momentumScore,
          volatilityRegime,
          volumeQuality,
          sector,
          sectorConcentration,
          fallbackReason: "AI credits exhausted",
        });

        return new Response(JSON.stringify(fallbackSignal), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      const fallbackSignal = buildFallbackSignal({
        marketData,
        statEdge,
        price,
        high,
        low,
        changePct,
        rangePos,
        momentumScore,
        volatilityRegime,
        volumeQuality,
        sector,
        sectorConcentration,
        fallbackReason: `AI gateway error ${response.status}`,
      });

      return new Response(JSON.stringify(fallbackSignal), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let signal: TradingSignalPayload;

    try {
      const data = aiBodyText ? JSON.parse(aiBodyText) : await response.json();
      const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
      if (!toolCall) throw new Error("No tool call in response");
      signal = { ...JSON.parse(toolCall.function.arguments), analysis_mode: "ai" };
    } catch (parseErr) {
      console.error("AI response parse failed:", parseErr);
      signal = buildFallbackSignal({
        marketData,
        statEdge,
        price,
        high,
        low,
        changePct,
        rangePos,
        momentumScore,
        volatilityRegime,
        volumeQuality,
        sector,
        sectorConcentration,
        fallbackReason: "AI response was malformed",
      });
    }

    // ===== POST-PROCESSING GUARDRAILS =====
    
    // Hard cap: R:R < 1.5 = force neutral
    if (signal.risk_reward_ratio < 1.5 && signal.signal !== "neutral") {
      signal.signal = "neutral";
      signal.confidence = Math.min(signal.confidence, 40);
      signal.reasons.push("GUARDRAIL: R:R below 1.5 — forced neutral");
    }
    
    // Hard cap: extreme volatility = force neutral
    if (volatilityRegime === "extreme") {
      signal.signal = "neutral";
      signal.confidence = Math.min(signal.confidence, 35);
      signal.volatility_warning = true;
      signal.reasons.push("GUARDRAIL: Extreme volatility — forced neutral");
    }
    
    // Hard cap: high volatility caps confidence
    if (volatilityRegime === "high") {
      signal.confidence = Math.min(signal.confidence, 55);
    }
    
    // Volume gate
    if (volumeQuality === "very_low" || volumeQuality === "low") {
      signal.confidence = Math.min(signal.confidence, 45);
      if (!signal.reasons.some((r: string) => r.includes("volume"))) {
        signal.reasons.push(`Low volume ($${marketData.quoteVolume}) — confidence capped`);
      }
    }
    
    // Sector concentration penalty
    if (sectorConcentration >= 2) {
      signal.confidence = Math.max(0, signal.confidence - 20);
      signal.sector_risk = "high";
      signal.reasons.push(`Sector concentration: ${sectorConcentration} existing ${sector} positions`);
    }
    
    // Entry quality gate: D or F entries = force neutral
    if ((signal.entry_quality === "D" || signal.entry_quality === "F") && signal.signal !== "neutral") {
      signal.confidence = Math.min(signal.confidence, 40);
      signal.reasons.push(`GUARDRAIL: Entry quality ${signal.entry_quality} — confidence reduced`);
    }
    
    // Chasing prevention: buying at day highs or selling at day lows
    if (signal.signal.includes("buy") && rangePos > 90) {
      signal.confidence = Math.min(signal.confidence, 35);
      signal.reasons.push("GUARDRAIL: Buying near day high — chasing risk");
    }
    if (signal.signal.includes("sell") && rangePos < 10) {
      signal.confidence = Math.min(signal.confidence, 35);
      signal.reasons.push("GUARDRAIL: Selling near day low — capitulation risk");
    }

    // Store in cache (5 min TTL) — fire and forget
    if (cacheClient) {
      const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
      cacheClient.from("ai_analysis_cache").upsert({
        cache_key: cacheKey,
        symbol: marketData.symbol,
        timeframe: "snapshot",
        model: "google/gemini-2.5-flash-lite",
        payload: signal,
        expires_at: expiresAt,
      }).then(() => {}).catch((e) => console.warn("cache write failed", e));
    }

    return new Response(JSON.stringify(signal), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("analyze-market error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
