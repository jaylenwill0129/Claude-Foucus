// Correlation- and sector-aware position sizing.
// Reduces size when the candidate symbol overlaps with existing exposure.

const SECTOR_MAP: Record<string, string> = {
  AAPL: "tech", MSFT: "tech", NVDA: "tech", GOOGL: "tech", META: "tech", AMZN: "tech", TSLA: "tech",
  AMD: "tech", AVGO: "tech", CRM: "tech", ORCL: "tech", ADBE: "tech", INTC: "tech",
  JPM: "finance", BAC: "finance", GS: "finance", WFC: "finance", MS: "finance", V: "finance", MA: "finance",
  JNJ: "healthcare", UNH: "healthcare", LLY: "healthcare", PFE: "healthcare", MRK: "healthcare",
  XOM: "energy", CVX: "energy", COP: "energy", SLB: "energy",
  WMT: "consumer", KO: "consumer", PEP: "consumer", MCD: "consumer", COST: "consumer",
  BTCUSD: "crypto", ETHUSD: "crypto", SOLUSD: "crypto", DOGEUSD: "crypto", AVAXUSD: "crypto",
};

export interface OpenPosition {
  symbol: string;
  notional: number; // current $ exposure
  sector?: string;
}

export interface SizingInput {
  candidateSymbol: string;
  candidateSector?: string;
  baseSizePct: number;          // intended size %
  equity: number;               // total portfolio equity
  openPositions: OpenPosition[];
  maxSectorPct?: number;        // hard cap of sector exposure (default 30%)
  maxSingleNamePct?: number;    // hard cap per symbol (default 15%)
}

export interface SizingResult {
  adjustedSizePct: number;
  multiplier: number;
  sectorExposurePct: number;
  reasons: string[];
  blocked: boolean;
}

export function getSector(symbol: string, hint?: string): string | undefined {
  return hint ?? SECTOR_MAP[symbol.toUpperCase()];
}

export function computeCorrelationAdjustedSize(input: SizingInput): SizingResult {
  const reasons: string[] = [];
  const maxSectorPct = input.maxSectorPct ?? 30;
  const maxSingleNamePct = input.maxSingleNamePct ?? 15;
  const sector = getSector(input.candidateSymbol, input.candidateSector);
  const equity = Math.max(1, input.equity);

  // Sector exposure (% of equity already deployed in same sector)
  let sectorNotional = 0;
  let symbolNotional = 0;
  for (const p of input.openPositions) {
    if (p.symbol.toUpperCase() === input.candidateSymbol.toUpperCase()) symbolNotional += p.notional;
    const pSector = getSector(p.symbol, p.sector);
    if (sector && pSector === sector) sectorNotional += p.notional;
  }
  const sectorExposurePct = (sectorNotional / equity) * 100;
  const symbolExposurePct = (symbolNotional / equity) * 100;

  let multiplier = 1.0;

  // Sector concentration tapers size
  if (sector) {
    if (sectorExposurePct >= maxSectorPct) {
      reasons.push(`Sector ${sector} at cap (${sectorExposurePct.toFixed(1)}% ≥ ${maxSectorPct}%) — blocked`);
      return { adjustedSizePct: 0, multiplier: 0, sectorExposurePct, reasons, blocked: true };
    }
    if (sectorExposurePct >= maxSectorPct * 0.66) {
      multiplier *= 0.5;
      reasons.push(`Sector ${sector} heavy (${sectorExposurePct.toFixed(1)}%) → 0.5×`);
    } else if (sectorExposurePct >= maxSectorPct * 0.33) {
      multiplier *= 0.75;
      reasons.push(`Sector ${sector} building (${sectorExposurePct.toFixed(1)}%) → 0.75×`);
    }
  }

  // Single-name cap
  if (symbolExposurePct >= maxSingleNamePct) {
    reasons.push(`${input.candidateSymbol} at single-name cap (${symbolExposurePct.toFixed(1)}%) — blocked`);
    return { adjustedSizePct: 0, multiplier: 0, sectorExposurePct, reasons, blocked: true };
  }

  // Soft taper as we approach max positions count
  const count = input.openPositions.length;
  if (count >= 5) {
    multiplier *= 0.75;
    reasons.push(`${count} open positions → 0.75×`);
  }

  const adjustedSizePct = Math.max(0, input.baseSizePct * multiplier);
  return { adjustedSizePct, multiplier, sectorExposurePct, reasons, blocked: false };
}