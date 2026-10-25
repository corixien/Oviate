// Loads the candles of a test scope (Strategy Tester / Optimizer). getCandles keeps everything in the local SQLite cache and only fetches what is missing.
import { getCandles, TF_SECONDS, type Tf } from './api';
import { scopeFrom, scopeSymbols, type Scope } from './universe.ts';
import type { PineCandles } from './pine/types.ts';

export interface ScopeSet {
  tf: Tf; stepSec: number; from: number;
  items: { symbol: string; data: PineCandles }[];
  /** securities without usable data (unknown symbol, provider error, too few bars) */
  failed: { symbol: string; error: string }[];
}

export interface ChartRef { symbol: string; tf: Tf; first: number }
const MIN_BARS = 30, PARALLEL = 4;

/** Candles for every security of the scope; `onProgress(done, total)` after each one, `cancelled()` stops early. */
export async function loadScope(scope: Scope, chart: ChartRef, onProgress: (done: number, total: number) => void, cancelled: () => boolean): Promise<ScopeSet> {
  const tf = (scope.tf === 'chart' ? chart.tf : scope.tf) as Tf;
  const now = Math.floor(Date.now() / 1000);
  const from = scopeFrom(scope, now, chart.first);
  const symbols = scopeSymbols(scope, chart.symbol);
  const out: ScopeSet = { tf, stepSec: TF_SECONDS[tf], from, items: [], failed: [] };
  const slots: ({ symbol: string; data: PineCandles } | null)[] = symbols.map(() => null);
  let next = 0, done = 0;
  async function worker() {
    while (!cancelled()) {
      const i = next++;
      if (i >= symbols.length) return;
      const symbol = symbols[i];
      try {
        const c = await getCandles(symbol, tf, from, now);
        if (c.n >= MIN_BARS) slots[i] = { symbol, data: c };
        else out.failed.push({ symbol, error: c.n ? `only ${c.n} bars` : 'no data' });
      } catch (e) { out.failed.push({ symbol, error: String((e as Error)?.message ?? e) }); }
      onProgress(++done, symbols.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(PARALLEL, symbols.length) }, worker));
  out.items = slots.filter((s): s is { symbol: string; data: PineCandles } => !!s);
  return out;
}
