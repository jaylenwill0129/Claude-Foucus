import { useState, useCallback, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

// --- Types ---
export interface Position {
  id: string;
  symbol: string;
  side: "long" | "short";
  entryPrice: number;
  quantity: number;
  timestamp: number;
  stopLoss?: number;
  takeProfit?: number;
  trailingStop?: number;
  highWaterMark?: number;
  fees: number;
}

export interface PendingOrder {
  id: string;
  symbol: string;
  side: "long" | "short";
  type: "limit" | "stop" | "stop-limit";
  limitPrice?: number;
  stopPrice?: number;
  quantity: number;
  createdAt: number;
  expiresAt?: number; // GTC = undefined, else timestamp
}

export interface Trade {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  price: number;
  quantity: number;
  pnl?: number;
  fees: number;
  slippage: number;
  timestamp: number;
  orderType: "market" | "limit" | "stop" | "stop-limit";
}

export interface Portfolio {
  balance: number;
  positions: Position[];
  trades: Trade[];
  pendingOrders: PendingOrder[];
  totalPnl: number;
  totalFees: number;
  marginUsed: number;
}

export interface TradingSettings {
  slippageBps: number;       // basis points (e.g., 5 = 0.05%)
  commissionPerTrade: number; // flat $ fee per trade
  commissionPct: number;      // % of trade value
  maxPositionPct: number;     // max % of equity per position
  enableSlippage: boolean;
  enableCommissions: boolean;
  defaultStopLossPct: number;
  defaultTakeProfitPct: number;
  enableTrailingStop: boolean;
  trailingStopPct: number;
}

const DEFAULT_SETTINGS: TradingSettings = {
  slippageBps: 5,
  commissionPerTrade: 0,
  commissionPct: 0.1,
  maxPositionPct: 25,
  enableSlippage: true,
  enableCommissions: true,
  defaultStopLossPct: 2,
  defaultTakeProfitPct: 4,
  enableTrailingStop: false,
  trailingStopPct: 1.5,
};

const INITIAL_BALANCE = 100000;

function applySlippage(price: number, side: "long" | "short", bps: number): number {
  const factor = bps / 10000;
  return side === "long" ? price * (1 + factor) : price * (1 - factor);
}

function calcCommission(value: number, settings: TradingSettings): number {
  if (!settings.enableCommissions) return 0;
  return settings.commissionPerTrade + (value * settings.commissionPct / 100);
}

export function usePaperTrading() {
  const { user } = useAuth();
  const [portfolio, setPortfolio] = useState<Portfolio>({
    balance: INITIAL_BALANCE,
    positions: [],
    trades: [],
    pendingOrders: [],
    totalPnl: 0,
    totalFees: 0,
    marginUsed: 0,
  });
  const [settings, setSettings] = useState<TradingSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load from database
  useEffect(() => {
    if (!user) {
      setLoaded(false);
      setPortfolio({ balance: INITIAL_BALANCE, positions: [], trades: [], pendingOrders: [], totalPnl: 0, totalFees: 0, marginUsed: 0 });
      return;
    }

    const loadData = async () => {
      try {
        const [{ data: portfolioData }, { data: positionsData }, { data: tradesData }] = await Promise.all([
          supabase.from("portfolios").select("*").eq("user_id", user.id).maybeSingle(),
          supabase.from("positions").select("*").eq("user_id", user.id),
          supabase.from("trades").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(200),
        ]);

        const positions: Position[] = (positionsData || []).map(p => ({
          id: p.id,
          symbol: p.symbol,
          side: p.side as "long" | "short",
          entryPrice: Number(p.entry_price),
          quantity: Number(p.quantity),
          timestamp: new Date(p.created_at).getTime(),
          fees: 0,
        }));

        const trades: Trade[] = (tradesData || []).map(t => ({
          id: t.id,
          symbol: t.symbol,
          side: t.side as "buy" | "sell",
          price: Number(t.price),
          quantity: Number(t.quantity),
          pnl: t.pnl != null ? Number(t.pnl) : undefined,
          timestamp: new Date(t.created_at).getTime(),
          fees: 0,
          slippage: 0,
          orderType: "market" as const,
        }));

        const marginUsed = positions.reduce((t, p) => t + p.entryPrice * p.quantity, 0);

        setPortfolio({
          balance: portfolioData ? Number(portfolioData.balance) : INITIAL_BALANCE,
          totalPnl: portfolioData ? Number(portfolioData.total_pnl) : 0,
          totalFees: 0,
          positions,
          trades,
          pendingOrders: [],
          marginUsed,
        });

        if (!portfolioData) {
          await supabase.from("portfolios").insert({ user_id: user.id, balance: INITIAL_BALANCE, total_pnl: 0 });
        }
      } catch (err) {
        console.error("Failed to load portfolio:", err);
      }
      setLoaded(true);
    };
    loadData();
  }, [user]);

  // Debounced save
  const savePortfolio = useCallback((balance: number, totalPnl: number) => {
    if (!user) return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      await supabase.from("portfolios").update({ balance, total_pnl: totalPnl, updated_at: new Date().toISOString() }).eq("user_id", user.id);
    }, 1000);
  }, [user]);

  // Check pending orders against current prices
  const checkPendingOrders = useCallback((prices: Record<string, number>) => {
    setPortfolio(prev => {
      const triggered: PendingOrder[] = [];
      const remaining: PendingOrder[] = [];
      const now = Date.now();

      for (const order of prev.pendingOrders) {
        // Expire old orders
        if (order.expiresAt && now > order.expiresAt) continue;

        const price = prices[order.symbol];
        if (!price) { remaining.push(order); continue; }

        let shouldFill = false;
        if (order.type === "limit") {
          shouldFill = order.side === "long" ? price <= (order.limitPrice || 0) : price >= (order.limitPrice || 0);
        } else if (order.type === "stop") {
          shouldFill = order.side === "long" ? price >= (order.stopPrice || 0) : price <= (order.stopPrice || 0);
        } else if (order.type === "stop-limit") {
          const stopTriggered = order.side === "long" ? price >= (order.stopPrice || 0) : price <= (order.stopPrice || 0);
          const limitMet = order.side === "long" ? price <= (order.limitPrice || 0) : price >= (order.limitPrice || 0);
          shouldFill = stopTriggered && limitMet;
        }

        if (shouldFill) triggered.push(order);
        else remaining.push(order);
      }

      if (triggered.length === 0) return prev;

      let newState = { ...prev, pendingOrders: remaining };
      for (const order of triggered) {
        const fillPrice = settings.enableSlippage
          ? applySlippage(prices[order.symbol], order.side, settings.slippageBps)
          : prices[order.symbol];
        const cost = fillPrice * order.quantity;
        const fees = calcCommission(cost, settings);

        if (cost + fees > newState.balance) continue;

        const posId = crypto.randomUUID();
        const tradeId = crypto.randomUUID();
        const newBalance = newState.balance - cost - fees;

        if (user) {
          supabase.from("positions").insert({ id: posId, user_id: user.id, symbol: order.symbol, side: order.side, entry_price: fillPrice, quantity: order.quantity }).then();
          supabase.from("trades").insert({ id: tradeId, user_id: user.id, symbol: order.symbol, side: "buy", price: fillPrice, quantity: order.quantity }).then();
        }

        newState = {
          ...newState,
          balance: newBalance,
          totalFees: newState.totalFees + fees,
          marginUsed: newState.marginUsed + cost,
          positions: [...newState.positions, {
            id: posId, symbol: order.symbol, side: order.side, entryPrice: fillPrice,
            quantity: order.quantity, timestamp: Date.now(), fees,
            stopLoss: settings.defaultStopLossPct > 0
              ? (order.side === "long" ? fillPrice * (1 - settings.defaultStopLossPct / 100) : fillPrice * (1 + settings.defaultStopLossPct / 100))
              : undefined,
            takeProfit: settings.defaultTakeProfitPct > 0
              ? (order.side === "long" ? fillPrice * (1 + settings.defaultTakeProfitPct / 100) : fillPrice * (1 - settings.defaultTakeProfitPct / 100))
              : undefined,
          }],
          trades: [...newState.trades, {
            id: tradeId, symbol: order.symbol, side: "buy" as const, price: fillPrice,
            quantity: order.quantity, timestamp: Date.now(), fees, slippage: Math.abs(fillPrice - prices[order.symbol]),
            orderType: order.type,
          }],
        };
      }

      savePortfolio(newState.balance, newState.totalPnl);
      return newState;
    });
  }, [user, settings, savePortfolio]);

  // Check SL/TP/trailing stop
  const checkStopLevels = useCallback((prices: Record<string, number>) => {
    setPortfolio(prev => {
      const toClose: { pos: Position; price: number; reason: string }[] = [];
      const updatedPositions: Position[] = [];

      for (const pos of prev.positions) {
        const currentPrice = prices[pos.symbol];
        if (!currentPrice) { updatedPositions.push(pos); continue; }

        let close = false;
        let reason = "";

        // Stop loss
        if (pos.stopLoss) {
          if (pos.side === "long" && currentPrice <= pos.stopLoss) { close = true; reason = "Stop Loss"; }
          if (pos.side === "short" && currentPrice >= pos.stopLoss) { close = true; reason = "Stop Loss"; }
        }

        // Take profit
        if (!close && pos.takeProfit) {
          if (pos.side === "long" && currentPrice >= pos.takeProfit) { close = true; reason = "Take Profit"; }
          if (pos.side === "short" && currentPrice <= pos.takeProfit) { close = true; reason = "Take Profit"; }
        }

        // Trailing stop
        if (!close && pos.trailingStop && settings.enableTrailingStop) {
          const hwm = Math.max(pos.highWaterMark || pos.entryPrice, currentPrice);
          const trailPrice = pos.side === "long"
            ? hwm * (1 - pos.trailingStop / 100)
            : (pos.highWaterMark ? Math.min(pos.highWaterMark, currentPrice) : currentPrice) * (1 + pos.trailingStop / 100);

          if (pos.side === "long" && currentPrice <= trailPrice) { close = true; reason = "Trailing Stop"; }
          if (pos.side === "short" && currentPrice >= trailPrice) { close = true; reason = "Trailing Stop"; }

          if (!close) {
            updatedPositions.push({ ...pos, highWaterMark: hwm });
            continue;
          }
        }

        if (close) {
          toClose.push({ pos, price: currentPrice, reason });
        } else {
          updatedPositions.push(pos);
        }
      }

      if (toClose.length === 0 && updatedPositions.length === prev.positions.length) return prev;
      if (toClose.length === 0) return { ...prev, positions: updatedPositions };

      let newBalance = prev.balance;
      let newTotalPnl = prev.totalPnl;
      let newTotalFees = prev.totalFees;
      const newTrades = [...prev.trades];

      for (const { pos, price, reason } of toClose) {
        const fillPrice = settings.enableSlippage ? applySlippage(price, pos.side === "long" ? "short" : "long", settings.slippageBps) : price;
        const proceeds = fillPrice * pos.quantity;
        const fees = calcCommission(proceeds, settings);
        const pnl = pos.side === "long"
          ? (fillPrice - pos.entryPrice) * pos.quantity - pos.fees - fees
          : (pos.entryPrice - fillPrice) * pos.quantity - pos.fees - fees;

        newBalance += proceeds - fees;
        newTotalPnl += pnl;
        newTotalFees += fees;

        const tradeId = crypto.randomUUID();
        newTrades.push({
          id: tradeId, symbol: pos.symbol, side: "sell", price: fillPrice,
          quantity: pos.quantity, pnl, timestamp: Date.now(), fees,
          slippage: Math.abs(fillPrice - price), orderType: "market",
        });

        if (user) {
          supabase.from("positions").delete().eq("id", pos.id).then();
          supabase.from("trades").insert({
            id: tradeId, user_id: user.id, symbol: pos.symbol, side: "sell", price: fillPrice, quantity: pos.quantity, pnl,
          }).then();
        }

        console.log(`[Paper] Auto-closed ${pos.symbol} — ${reason} @ $${fillPrice.toFixed(2)} | PnL: $${pnl.toFixed(2)}`);
      }

      savePortfolio(newBalance, newTotalPnl);
      return {
        ...prev,
        balance: newBalance,
        totalPnl: newTotalPnl,
        totalFees: newTotalFees,
        positions: updatedPositions,
        trades: newTrades,
        marginUsed: updatedPositions.reduce((t, p) => t + p.entryPrice * p.quantity, 0),
      };
    });
  }, [user, settings, savePortfolio]);

  // Place market order with realistic fills
  const openPosition = useCallback((
    symbol: string, side: "long" | "short", price: number, quantity: number,
    stopLoss?: number, takeProfit?: number
  ) => {
    const fillPrice = settings.enableSlippage ? applySlippage(price, side, settings.slippageBps) : price;
    const cost = fillPrice * quantity;
    const fees = calcCommission(cost, settings);
    const totalCost = cost + fees;

    setPortfolio(prev => {
      if (totalCost > prev.balance) return prev;

      // Position size check
      const equity = prev.balance + prev.marginUsed;
      if (settings.maxPositionPct > 0 && (cost / equity) * 100 > settings.maxPositionPct) {
        console.warn(`[Paper] Position exceeds ${settings.maxPositionPct}% limit`);
        return prev;
      }

      const newBalance = prev.balance - totalCost;
      const posId = crypto.randomUUID();
      const tradeId = crypto.randomUUID();

      const sl = stopLoss ?? (settings.defaultStopLossPct > 0
        ? (side === "long" ? fillPrice * (1 - settings.defaultStopLossPct / 100) : fillPrice * (1 + settings.defaultStopLossPct / 100))
        : undefined);
      const tp = takeProfit ?? (settings.defaultTakeProfitPct > 0
        ? (side === "long" ? fillPrice * (1 + settings.defaultTakeProfitPct / 100) : fillPrice * (1 - settings.defaultTakeProfitPct / 100))
        : undefined);

      if (user) {
        supabase.from("positions").insert({ id: posId, user_id: user.id, symbol, side, entry_price: fillPrice, quantity }).then();
        supabase.from("trades").insert({ id: tradeId, user_id: user.id, symbol, side: "buy", price: fillPrice, quantity }).then();
        savePortfolio(newBalance, prev.totalPnl);
      }

      return {
        ...prev,
        balance: newBalance,
        totalFees: prev.totalFees + fees,
        marginUsed: prev.marginUsed + cost,
        positions: [...prev.positions, {
          id: posId, symbol, side, entryPrice: fillPrice, quantity, timestamp: Date.now(),
          fees, stopLoss: sl, takeProfit: tp,
          trailingStop: settings.enableTrailingStop ? settings.trailingStopPct : undefined,
          highWaterMark: fillPrice,
        }],
        trades: [...prev.trades, {
          id: tradeId, symbol, side: "buy", price: fillPrice, quantity, timestamp: Date.now(),
          fees, slippage: Math.abs(fillPrice - price), orderType: "market" as const,
        }],
      };
    });
  }, [user, settings, savePortfolio]);

  // Place pending order
  const placePendingOrder = useCallback((
    symbol: string, side: "long" | "short", type: "limit" | "stop" | "stop-limit",
    quantity: number, limitPrice?: number, stopPrice?: number, ttlMinutes?: number
  ) => {
    const order: PendingOrder = {
      id: crypto.randomUUID(), symbol, side, type, limitPrice, stopPrice,
      quantity, createdAt: Date.now(),
      expiresAt: ttlMinutes ? Date.now() + ttlMinutes * 60000 : undefined,
    };
    setPortfolio(prev => ({ ...prev, pendingOrders: [...prev.pendingOrders, order] }));
  }, []);

  const cancelPendingOrder = useCallback((orderId: string) => {
    setPortfolio(prev => ({
      ...prev,
      pendingOrders: prev.pendingOrders.filter(o => o.id !== orderId),
    }));
  }, []);

  // Close position with realistic fill
  const closePosition = useCallback((positionId: string, currentPrice: number) => {
    setPortfolio(prev => {
      const pos = prev.positions.find(p => p.id === positionId);
      if (!pos) return prev;

      const fillPrice = settings.enableSlippage
        ? applySlippage(currentPrice, pos.side === "long" ? "short" : "long", settings.slippageBps)
        : currentPrice;
      const proceeds = fillPrice * pos.quantity;
      const fees = calcCommission(proceeds, settings);
      const pnl = pos.side === "long"
        ? (fillPrice - pos.entryPrice) * pos.quantity - pos.fees - fees
        : (pos.entryPrice - fillPrice) * pos.quantity - pos.fees - fees;
      const newBalance = prev.balance + proceeds - fees;
      const newTotalPnl = prev.totalPnl + pnl;
      const tradeId = crypto.randomUUID();

      if (user) {
        supabase.from("positions").delete().eq("id", positionId).then();
        supabase.from("trades").insert({
          id: tradeId, user_id: user.id, symbol: pos.symbol, side: "sell", price: fillPrice, quantity: pos.quantity, pnl,
        }).then();
        savePortfolio(newBalance, newTotalPnl);
      }

      return {
        ...prev,
        balance: newBalance,
        positions: prev.positions.filter(p => p.id !== positionId),
        trades: [...prev.trades, {
          id: tradeId, symbol: pos.symbol, side: "sell", price: fillPrice, quantity: pos.quantity,
          pnl, timestamp: Date.now(), fees, slippage: Math.abs(fillPrice - currentPrice), orderType: "market" as const,
        }],
        totalPnl: newTotalPnl,
        totalFees: prev.totalFees + fees,
        marginUsed: prev.marginUsed - pos.entryPrice * pos.quantity,
      };
    });
  }, [user, settings, savePortfolio]);

  // Update SL/TP on existing position
  const updatePositionLevels = useCallback((positionId: string, stopLoss?: number, takeProfit?: number) => {
    setPortfolio(prev => ({
      ...prev,
      positions: prev.positions.map(p =>
        p.id === positionId ? { ...p, stopLoss, takeProfit } : p
      ),
    }));
  }, []);

  const getUnrealizedPnl = useCallback((prices: Record<string, number>) => {
    return portfolio.positions.reduce((total, pos) => {
      const currentPrice = prices[pos.symbol] || pos.entryPrice;
      const pnl = pos.side === "long"
        ? (currentPrice - pos.entryPrice) * pos.quantity
        : (pos.entryPrice - currentPrice) * pos.quantity;
      return total + pnl;
    }, 0);
  }, [portfolio.positions]);

  const addFunds = useCallback((amount: number) => {
    if (amount <= 0) return;
    setPortfolio(prev => {
      const newBalance = prev.balance + amount;
      savePortfolio(newBalance, prev.totalPnl);
      return { ...prev, balance: newBalance };
    });
  }, [savePortfolio]);

  const withdrawFunds = useCallback((amount: number) => {
    if (amount <= 0) return;
    setPortfolio(prev => {
      const newBalance = Math.max(0, prev.balance - amount);
      savePortfolio(newBalance, prev.totalPnl);
      return { ...prev, balance: newBalance };
    });
  }, [savePortfolio]);

  const resetBalance = useCallback((amount: number = INITIAL_BALANCE) => {
    if (user) {
      supabase.from("positions").delete().eq("user_id", user.id).then();
      savePortfolio(amount, 0);
    }
    setPortfolio({ balance: amount, positions: [], trades: [], pendingOrders: [], totalPnl: 0, totalFees: 0, marginUsed: 0 });
  }, [user, savePortfolio]);

  return {
    portfolio, settings, setSettings,
    openPosition, closePosition, placePendingOrder, cancelPendingOrder,
    updatePositionLevels, checkPendingOrders, checkStopLevels,
    getUnrealizedPnl, addFunds, withdrawFunds, resetBalance, loaded,
  };
}
