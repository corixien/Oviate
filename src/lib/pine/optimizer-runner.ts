import { optimize } from './optimizer.ts';
import type { OptimizeOpts, OptimizeProgress, OptimizeResult } from './optimizer.ts';

export interface OptimizeJob { promise: Promise<OptimizeResult>; cancel(): void }

/** Run the optimizer in a background worker (main thread fallback). Candle arrays are copied; cancel() kills the worker. */
export function runOptimizer(opts: Omit<OptimizeOpts, 'onProgress' | 'shouldStop' | 'run'>, onProgress: (p: OptimizeProgress) => void): OptimizeJob {
  if (typeof Worker === 'undefined') {
    let stop = false;
    return { promise: Promise.resolve().then(() => optimize({ ...opts, onProgress, shouldStop: () => stop })), cancel: () => { stop = true; } };
  }
  const w = new Worker(new URL('./optimizer.worker.ts', import.meta.url), { type: 'module' });
  const d = opts.data;
  const data = { n: d.n, t: d.t.slice(), o: d.o.slice(), h: d.h.slice(), l: d.l.slice(), c: d.c.slice(), v: d.v.slice() };
  let cancelled = false;
  const promise = new Promise<OptimizeResult>((resolve, reject) => {
    w.onmessage = (e: MessageEvent<{ type: string; message?: string; result?: OptimizeResult } & Partial<OptimizeProgress>>) => {
      const m = e.data;
      if (m.type === 'progress') onProgress({ evals: m.evals!, budget: m.budget!, best: m.best!, phase: m.phase! });
      else if (m.type === 'done') { w.terminate(); resolve(m.result!); }
      else { w.terminate(); reject(new Error(m.message ?? 'optimizer failed')); }
    };
    w.onerror = (e) => { w.terminate(); reject(new Error(cancelled ? 'cancelled' : e.message || 'optimizer worker failed')); };
    w.postMessage({ ...opts, data });
  });
  return { promise, cancel: () => { cancelled = true; w.terminate(); } };
}
