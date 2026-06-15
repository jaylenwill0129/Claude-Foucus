import { useState, useEffect, useRef, useCallback } from "react";

export interface TickerData {
  symbol: string;
  price: string;
  priceChange: string;
  priceChangePercent: string;
  high: string;
  low: string;
  volume: string;
  quoteVolume: string;
}

export interface TradeData {
  price: string;
  qty: string;
  time: number;
  isBuyerMaker: boolean;
}

const SYMBOLS = ["btcusdt", "ethusdt", "bnbusdt", "solusdt", "xrpusdt", "adausdt", "dogeusdt", "avaxusdt"];

export function useBinanceTickers() {
  const [tickers, setTickers] = useState<Record<string, TickerData>>({});
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const streams = SYMBOLS.map(s => `${s}@ticker`).join("/");
    const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${streams}`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setTickers(prev => ({
        ...prev,
        [data.s]: {
          symbol: data.s,
          price: data.c,
          priceChange: data.p,
          priceChangePercent: data.P,
          high: data.h,
          low: data.l,
          volume: data.v,
          quoteVolume: data.q,
        },
      }));
    };

    return () => { ws.close(); };
  }, []);

  return tickers;
}

export function useBinanceTrades(symbol: string) {
  const [trades, setTrades] = useState<TradeData[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    setTrades([]);
    const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@trade`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      const trade: TradeData = {
        price: data.p,
        qty: data.q,
        time: data.T,
        isBuyerMaker: data.m,
      };
      setTrades(prev => [trade, ...prev].slice(0, 50));
    };

    return () => { ws.close(); };
  }, [symbol]);

  return trades;
}

export function useBinanceKlines(symbol: string, interval = "1m") {
  const [klines, setKlines] = useState<Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }>>([]);

  useEffect(() => {
    fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=100`)
      .then(r => r.json())
      .then(data => {
        setKlines(data.map((k: any[]) => ({
          time: k[0],
          open: parseFloat(k[1]),
          high: parseFloat(k[2]),
          low: parseFloat(k[3]),
          close: parseFloat(k[4]),
          volume: parseFloat(k[5]),
        })));
      })
      .catch(console.error);
  }, [symbol, interval]);

  // Also subscribe to kline updates
  useEffect(() => {
    const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@kline_${interval}`);
    
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      const k = data.k;
      const kline = {
        time: k.t,
        open: parseFloat(k.o),
        high: parseFloat(k.h),
        low: parseFloat(k.l),
        close: parseFloat(k.c),
        volume: parseFloat(k.v),
      };

      setKlines(prev => {
        const updated = [...prev];
        if (updated.length > 0 && updated[updated.length - 1].time === kline.time) {
          updated[updated.length - 1] = kline;
        } else {
          updated.push(kline);
          if (updated.length > 200) updated.shift();
        }
        return updated;
      });
    };

    return () => { ws.close(); };
  }, [symbol, interval]);

  return klines;
}

export const AVAILABLE_SYMBOLS = SYMBOLS.map(s => s.toUpperCase());
