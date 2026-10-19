// Web Worker: runs Pine scripts off the UI thread.
import { runPine } from './interp.ts';
import type { PineCandles, PineResult } from './types.ts';

interface Req { id: number; code: string; candles: PineCandles; opts: { params?: Record<string, any>; step?: number; symbol?: string; mintick?: number; broker?: import('./types.ts').TesterSettings } }

self.onmessage = (e: MessageEvent<Req>) => {
  const { id, code, candles, opts } = e.data;
  const result: PineResult = runPine(code, candles, opts);
  const transfer: Transferable[] = [];
  for (const p of result.plots) transfer.push(p.values.buffer);
  for (const s of result.shapes) transfer.push(s.flags.buffer);
  if (result.strategy) transfer.push(result.strategy.equity.buffer);
  (self as unknown as Worker).postMessage({ id, result }, transfer);
};
