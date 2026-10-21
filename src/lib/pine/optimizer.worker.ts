// Web Worker: runs the strategy optimizer off the UI thread.
import { optimize } from './optimizer.ts';
import type { OptimizeOpts } from './optimizer.ts';

type Req = Omit<OptimizeOpts, 'onProgress' | 'shouldStop' | 'run'>;

self.onmessage = (e: MessageEvent<Req>) => {
  const post = (m: unknown) => (self as unknown as Worker).postMessage(m);
  try {
    const result = optimize({ ...e.data, onProgress: (p) => post({ type: 'progress', ...p }) });
    post({ type: 'done', result });
  } catch (err) { post({ type: 'error', message: err instanceof Error ? err.message : String(err) }); }
};
