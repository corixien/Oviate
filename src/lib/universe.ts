// Test universe of the Strategy Tester and the Optimizer: scope settings (period, securities, timeframe) and the list of the 200 most important securities (pure, tested).
import type { Tf } from './api.ts';

/** What the tester / optimizer runs on. 0 / 'chart' = whatever the active chart has. */
export interface Scope { years: number; count: number; tf: Tf | 'chart' }
export const DEFAULT_SCOPE: Scope = { years: 0, count: 0, tf: 'chart' };
export const MAX_SYMBOLS = 200;
export const YEAR_CHOICES = [1, 2, 3, 5, 10, 15, 20];
export const COUNT_CHOICES = [10, 25, 50, 100, 200];

export const isChartScope = (s: Scope) => s.years === 0 && s.count === 0 && s.tf === 'chart';

/** Sanitised scope (persisted state may be old or hand edited). */
export function cleanScope(s: Partial<Scope> | undefined, tfs: readonly string[]): Scope {
  return {
    years: s?.years && s.years > 0 ? Math.min(50, Math.round(s.years)) : 0,
    count: s?.count && s.count > 0 ? Math.min(MAX_SYMBOLS, Math.round(s.count)) : 0,
    tf: s?.tf && tfs.includes(s.tf) ? s.tf : 'chart',
  };
}

// Listed for at least 10 years (US exchanges). Tiers by price performance over the last 10 years: STRONG = big winners, MID = about the market, WEAK = laggards and losers.
// The list is interleaved strong / mid / weak, so any first N is a mixed sample and not just the stocks that went up (survivorship bias).
const STRONG = ['NVDA', 'AVGO', 'AMD', 'TSLA', 'AAPL', 'MSFT', 'AMZN', 'META', 'NFLX', 'GOOGL', 'LLY', 'COST', 'V', 'MA', 'ADBE', 'CRM', 'NOW', 'PANW', 'FTNT', 'LRCX',
  'KLAC', 'AMAT', 'MU', 'ANET', 'MPWR', 'ENPH', 'CAT', 'URI', 'ORLY', 'AZO', 'TSCO', 'FICO', 'MSCI', 'IDXX', 'ISRG', 'REGN', 'VRTX', 'DXCM', 'ODFL', 'CPRT',
  'FAST', 'MELI', 'TMUS', 'WMT', 'PGR', 'BLK', 'GS', 'JPM', 'HD', 'TXN', 'QCOM', 'ADI', 'NXPI', 'INTU', 'SNPS', 'CDNS', 'TMO', 'DHR', 'ABBV', 'MCD',
  'LIN', 'ORCL', 'QQQ', 'SMH', 'XLK', 'SOXX', 'VGT'];
const MID = ['JNJ', 'PG', 'KO', 'PEP', 'CSCO', 'MRK', 'ABT', 'MDT', 'HON', 'UPS', 'LOW', 'SPGI', 'CME', 'ICE', 'MMC', 'AON', 'CB', 'TRV', 'ALL', 'AFL',
  'MET', 'PRU', 'BAC', 'WFC', 'C', 'USB', 'PNC', 'SCHW', 'AXP', 'COF', 'DUK', 'SO', 'D', 'NEE', 'AEP', 'XEL', 'ED', 'WEC', 'EXC', 'UNP',
  'CSX', 'NSC', 'LMT', 'RTX', 'GD', 'NOC', 'DE', 'EMR', 'ITW', 'ETN', 'PH', 'CMI', 'PPG', 'SHW', 'ECL', 'APD', 'MS', 'AMGN', 'BDX', 'SYK',
  'SPY', 'DIA', 'XLF', 'XLV', 'XLI', 'EFA', 'VTI', 'KR'];
const WEAK = ['INTC', 'BA', 'PFE', 'T', 'VZ', 'KHC', 'WBA', 'CVS', 'MMM', 'DIS', 'NKE', 'SBUX', 'F', 'GM', 'XOM', 'CVX', 'OXY', 'SLB', 'HAL', 'APA',
  'DVN', 'COP', 'BMY', 'GILD', 'CMCSA', 'CHTR', 'DG', 'TGT', 'KSS', 'M', 'GPS', 'NWL', 'VFC', 'HPQ', 'IBM', 'MO', 'CL', 'GIS', 'KMB', 'CAG',
  'SJM', 'HRL', 'CPB', 'CLX', 'ZBH', 'BAX', 'EL', 'HAS', 'MAT', 'LUMN', 'AAL', 'UAL', 'DAL', 'CCL', 'RCL', 'NCLH', 'SPG', 'VNO', 'PYPL',
  'TLT', 'USO', 'UNG', 'XLE', 'EEM', 'VNQ'];

function interleave(...lists: string[][]): string[] {
  const out: string[] = [], seen = new Set<string>();
  const n = Math.max(...lists.map((l) => l.length));
  for (let i = 0; i < n; i++) for (const l of lists) if (i < l.length && !seen.has(l[i])) { seen.add(l[i]); out.push(l[i]); }
  return out.slice(0, MAX_SYMBOLS);
}

/** The 200 most important securities, strong / mid / weak performer one after the other. */
export const UNIVERSE: readonly string[] = interleave(STRONG, MID, WEAK);

/** Symbols a scope runs on: the chart symbol alone, or the first N of the universe. */
export function scopeSymbols(s: Scope, chartSymbol: string): string[] {
  return s.count > 0 ? UNIVERSE.slice(0, Math.min(s.count, MAX_SYMBOLS)) : [chartSymbol];
}

/** Start of the requested history (unix seconds): N years back, or the first bar of the chart for "Chart". */
export function scopeFrom(s: Scope, now: number, chartFirst: number): number {
  return s.years > 0 ? now - Math.round(s.years * 365.25 * 86400) : chartFirst > 0 ? chartFirst : now - Math.round(10 * 365.25 * 86400);
}

/** One line for the header: what a scope covers. */
export function scopeLabel(s: Scope, chartSymbol: string, chartTf: string): string {
  const n = s.count > 0 ? `${Math.min(s.count, MAX_SYMBOLS)} securities` : chartSymbol;
  return `${n} · ${(s.tf === 'chart' ? chartTf : s.tf).toUpperCase()} · ${s.years > 0 ? s.years + ' y' : 'chart history'}`;
}
