import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface RiskParams {
  maxPositionPct: number;
  stopLossPct: number;
  takeProfitPct: number;
  riskTolerance: "low" | "medium" | "high";
}

export interface BacktestTrade {
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  side: "long" | "short";
  pnl: number;
  pnlPct: number;
  exitReason: "stop_loss" | "take_profit" | "signal_change" | "end_of_data";
}

export interface BacktestResult {
  trades: BacktestTrade[];
  totalReturn: number;
  totalReturnPct: number;
  winRate: number;
  maxDrawdown: number;
  sharpeRatio: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  equityCurve: Array<{ time: number; equity: number }>;
}

const DEFAULT_RISK: RiskParams = {
  maxPositionPct: 10,
  stopLossPct: 2,
  takeProfitPct: 5,
  riskTolerance: "medium",
};

export function useBacktest() {
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [running, setRunning] = useState(false);

  const runBacktest = useCallback(
    (
      klines: Array<{ time: number; open: number; high: number; low: number; close: number }>,
      signals: Array<{ action: "buy" | "sell" | "hold"; entry_price: number; stop_loss: number; take_profit: number }>,
      riskParams: RiskParams = DEFAULT_RISK
    ) => {
      setRunning(true);

      const initialEquity = 100000;
      let equity = initialEquity;
      const trades: BacktestTrade[] = [];
      const equityCurve: Array<{ time: number; equity: number }> = [{ time: klines[0]?.time || 0, equity }];

      let position: {
        side: "long" | "short";
        entryPrice: number;
        entryTime: number;
        size: number;
        stopLoss: number;
        takeProfit: number;
      } | null = null;

      // Use AI signals to determine trade direction, apply risk params for SL/TP
      const primarySignal = signals[0];
      if (!primarySignal || primarySignal.action === "hold") {
        setResult({
          trades: [],
          totalReturn: 0,
          totalReturnPct: 0,
          winRate: 0,
          maxDrawdown: 0,
          sharpeRatio: 0,
          totalTrades: 0,
          winningTrades: 0,
          losingTrades: 0,
          avgWin: 0,
          avgLoss: 0,
          profitFactor: 0,
          equityCurve: [{ time: klines[0]?.time || 0, equity: initialEquity }],
        });
        setRunning(false);
        return;
      }

      // Simple momentum-based backtest using AI signal direction
      const side = primarySignal.action === "buy" ? "long" : "short";
      const slPct = riskParams.stopLossPct / 100;
      const tpPct = riskParams.takeProfitPct / 100;
      const positionSizePct = riskParams.maxPositionPct / 100;

      // Walk through klines simulating trades
      for (let i = 1; i < klines.length; i++) {
        const candle = klines[i];

        if (!position) {
          // Look for entry: simple momentum confirmation
          const prevClose = klines[i - 1].close;
          const momentum = (candle.close - prevClose) / prevClose;

          const shouldEnter =
            (side === "long" && momentum > 0) ||
            (side === "short" && momentum < 0);

          if (shouldEnter) {
            const entryPrice = candle.close;
            const size = (equity * positionSizePct) / entryPrice;
            position = {
              side,
              entryPrice,
              entryTime: candle.time,
              size,
              stopLoss: side === "long" ? entryPrice * (1 - slPct) : entryPrice * (1 + slPct),
              takeProfit: side === "long" ? entryPrice * (1 + tpPct) : entryPrice * (1 - tpPct),
            };
          }
        } else {
          // Check exit conditions
          let exitPrice = 0;
          let exitReason: BacktestTrade["exitReason"] = "end_of_data";

          if (position.side === "long") {
            if (candle.low <= position.stopLoss) {
              exitPrice = position.stopLoss;
              exitReason = "stop_loss";
            } else if (candle.high >= position.takeProfit) {
              exitPrice = position.takeProfit;
              exitReason = "take_profit";
            }
          } else {
            if (candle.high >= position.stopLoss) {
              exitPrice = position.stopLoss;
              exitReason = "stop_loss";
            } else if (candle.low <= position.takeProfit) {
              exitPrice = position.takeProfit;
              exitReason = "take_profit";
            }
          }

          // End of data - force close
          if (i === klines.length - 1 && exitPrice === 0) {
            exitPrice = candle.close;
            exitReason = "end_of_data";
          }

          if (exitPrice > 0) {
            const pnl = position.side === "long"
              ? (exitPrice - position.entryPrice) * position.size
              : (position.entryPrice - exitPrice) * position.size;
            const pnlPct = (pnl / (position.entryPrice * position.size)) * 100;

            equity += pnl;

            trades.push({
              entryTime: position.entryTime,
              exitTime: candle.time,
              entryPrice: position.entryPrice,
              exitPrice,
              side: position.side,
              pnl,
              pnlPct,
              exitReason,
            });

            position = null;
          }
        }

        equityCurve.push({ time: candle.time, equity });
      }

      // Calculate stats
      const winningTrades = trades.filter(t => t.pnl > 0);
      const losingTrades = trades.filter(t => t.pnl <= 0);
      const totalReturn = equity - initialEquity;
      const totalReturnPct = (totalReturn / initialEquity) * 100;
      const winRate = trades.length > 0 ? (winningTrades.length / trades.length) * 100 : 0;

      // Max drawdown
      let peak = initialEquity;
      let maxDrawdown = 0;
      for (const point of equityCurve) {
        if (point.equity > peak) peak = point.equity;
        const dd = ((peak - point.equity) / peak) * 100;
        if (dd > maxDrawdown) maxDrawdown = dd;
      }

      // Sharpe ratio (simplified)
      const returns = [];
      for (let i = 1; i < equityCurve.length; i++) {
        returns.push((equityCurve[i].equity - equityCurve[i - 1].equity) / equityCurve[i - 1].equity);
      }
      const avgRet = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
      const stdRet = returns.length > 1
        ? Math.sqrt(returns.reduce((sum, r) => sum + (r - avgRet) ** 2, 0) / (returns.length - 1))
        : 1;
      const sharpeRatio = stdRet > 0 ? (avgRet / stdRet) * Math.sqrt(252) : 0;

      const avgWin = winningTrades.length > 0 ? winningTrades.reduce((s, t) => s + t.pnl, 0) / winningTrades.length : 0;
      const avgLoss = losingTrades.length > 0 ? Math.abs(losingTrades.reduce((s, t) => s + t.pnl, 0) / losingTrades.length) : 0;
      const grossProfit = winningTrades.reduce((s, t) => s + t.pnl, 0);
      const grossLoss = Math.abs(losingTrades.reduce((s, t) => s + t.pnl, 0));
      const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

      setResult({
        trades,
        totalReturn,
        totalReturnPct,
        winRate,
        maxDrawdown,
        sharpeRatio,
        totalTrades: trades.length,
        winningTrades: winningTrades.length,
        losingTrades: losingTrades.length,
        avgWin,
        avgLoss,
        profitFactor,
        equityCurve,
      });
      setRunning(false);
    },
    []
  );

  const saveRun = async (args: {
      symbol: string;
      strategyName: string;
      trainStart: number;
      trainEnd: number;
      testStart: number;
      testEnd: number;
      params?: Record<string, unknown>;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !result) {
        toast.error("Run a backtest before saving");
        return;
      }
      const expectancy = result.totalTrades > 0 ? result.totalReturn / result.totalTrades : 0;
      const { error } = await supabase.from("backtest_runs").insert({
        user_id: user.id,
        symbol: args.symbol,
        strategy_name: args.strategyName,
        train_start: new Date(args.trainStart).toISOString(),
        train_end: new Date(args.trainEnd).toISOString(),
        test_start: new Date(args.testStart).toISOString(),
        test_end: new Date(args.testEnd).toISOString(),
        params: (args.params ?? {}) as never,
        trades_count: result.totalTrades,
        win_rate: result.winRate,
        expectancy,
        max_drawdown_pct: result.maxDrawdown,
        sharpe: result.sharpeRatio,
        metrics: {
          totalReturn: result.totalReturn,
          totalReturnPct: result.totalReturnPct,
          profitFactor: Number.isFinite(result.profitFactor) ? result.profitFactor : null,
          avgWin: result.avgWin,
          avgLoss: result.avgLoss,
        } as never,
      });
      if (error) {
        console.error("Failed to save backtest run", error);
        toast.error("Failed to save backtest");
      } else {
        toast.success("Backtest saved");
      }
    };

  return { result, running, runBacktest, saveRun, saving: false, clearResult: () => setResult(null) };
}
