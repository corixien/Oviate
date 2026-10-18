import { runPine } from './interp.ts';
import type { PineInput, PineMeta } from './types.ts';

export interface ScriptInfo {
  meta: PineMeta;
  inputs: PineInput[];
  plots: { title: string; color: string }[];
  error?: { message: string; line?: number };
}

/** Run the script on a few synthetic bars to learn its inputs, plots and metadata. */
export function describeScript(code: string): ScriptInfo {
  const n = 120;
  const t = new Float64Array(n), o = new Float64Array(n), h = new Float64Array(n), l = new Float64Array(n), c = new Float64Array(n), v = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const p = 100 + Math.sin(i / 7) * 5 + i * 0.05;
    t[i] = 1_700_000_000 + i * 86400; o[i] = p; c[i] = p + Math.cos(i) ; h[i] = Math.max(o[i], c[i]) + 1; l[i] = Math.min(o[i], c[i]) - 1; v[i] = 1000 + (i % 10) * 100;
  }
  const r = runPine(code, { n, t, o, h, l, c, v });
  return { meta: r.meta, inputs: r.inputs, plots: r.plots.map((p) => ({ title: p.title, color: p.color })), error: r.error };
}
