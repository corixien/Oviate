import { runPine } from './interp.ts';
import type { RunOptions } from './interp.ts';
import type { PineCandles, PineResult } from './types.ts';

let worker: Worker | null = null;
let failed = false;
let seq = 0;
const pending = new Map<number, (r: PineResult) => void>();

function getWorker(): Worker | null {
  if (failed || typeof Worker === 'undefined') return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; result: PineResult }>) => {
      const cb = pending.get(e.data.id);
      pending.delete(e.data.id);
      cb?.(e.data.result);
    };
    worker.onerror = () => {
      failed = true;
      worker = null;
      // fall back to the main thread for everything still waiting is not possible (no code kept); callers retry
      for (const [id, cb] of pending) { pending.delete(id); cb({ meta: { kind: 'indicator', title: 'Script', shorttitle: 'Script', overlay: false }, inputs: [], plots: [], shapes: [], hlines: [], fills: [], bgcolors: [], barcolors: [], warnings: [], error: { message: 'worker failed, retrying on the main thread' } }); }
    };
    return worker;
  } catch { failed = true; return null; }
}

/** Run a script in the background worker (main thread fallback). Candle arrays are copied. */
export function runScript(code: string, candles: PineCandles, opts: RunOptions = {}): Promise<PineResult> {
  const w = getWorker();
  if (!w) return Promise.resolve(runPine(code, candles, opts));
  const id = ++seq;
  const copy: PineCandles = { n: candles.n, t: candles.t.slice(), o: candles.o.slice(), h: candles.h.slice(), l: candles.l.slice(), c: candles.c.slice(), v: candles.v.slice() };
  return new Promise((resolve) => {
    pending.set(id, resolve);
    w.postMessage({ id, code, candles: copy, opts });
  });
}
