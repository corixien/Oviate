// A script can put plots in several panes: plot(x, "T", pane="RSI") / hline(30, pane="RSI"). Plots without a pane stay in the script's main pane.
import type { PineResult } from './types.ts';

export interface PaneResult { /** pane name, '' = the script's main pane */ name: string; overlay: boolean; result: PineResult }

/** Split one script result into its panes: the main pane first, then the named ones in order of appearance. */
export function splitPanes(res: PineResult): PaneResult[] {
  const names = [...new Set(res.plots.map((p) => p.pane).filter((n): n is string => !!n))];
  if (!names.length) return [{ name: '', overlay: res.meta.overlay, result: res }];
  const refOk = (ref: { kind: 'plot' | 'hline'; id: number }, plots: Set<number>, hlines: Set<number>) => (ref.kind === 'plot' ? plots : hlines).has(ref.id);
  const part = (name: string): PineResult => {
    const plots = res.plots.filter((p) => (p.pane ?? '') === name);
    const hlines = res.hlines.filter((h) => (h.pane ?? '') === name);
    const pi = new Set(plots.map((p) => p.id)), hi = new Set(hlines.map((h) => h.id));
    const fills = res.fills.filter((f) => refOk(f.a, pi, hi) && refOk(f.b, pi, hi));
    return name === ''
      ? { ...res, plots, hlines, fills }
      : { ...res, plots, hlines, fills, shapes: [], bgcolors: [], barcolors: [], strategy: undefined, meta: { ...res.meta, overlay: false } };
  };
  const out: PaneResult[] = [];
  const main = part('');
  const hasMain = main.plots.length || main.hlines.length || main.shapes.length || main.bgcolors.some(Boolean) || main.barcolors.some(Boolean);
  if (hasMain || res.meta.overlay) out.push({ name: '', overlay: res.meta.overlay, result: main });
  for (const n of names) out.push({ name: n, overlay: false, result: part(n) });
  return out;
}
