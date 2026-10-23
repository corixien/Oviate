import { app } from './app.svelte';
import { library } from './library.svelte';
import { paper } from './paper/paper.svelte';
import { candleStore } from './chart/candleStore';
import { paramSpace, type ParamDef, type OptimizeProgress, type OptimizeResult, type Variant } from './pine/optimizer.ts';
import { runOptimizer, type OptimizeJob } from './pine/optimizer-runner.ts';
import { neededLib } from './pine/indlib.ts';

export type Row = ParamDef & { on: boolean };

/** State of the strategy optimizer panel: parameter ranges, the running search and its 10 variants. */
class Optimizer {
  status = $state<'idle' | 'running' | 'done' | 'error'>('idle');
  progress = $state<OptimizeProgress | null>(null);
  result = $state<OptimizeResult | null>(null);
  error = $state('');
  budget = $state(600);
  rows = $state<Row[]>([]);
  /** what the rows and the result belong to: chart, strategy, symbol, timeframe */
  key = $state('');
  private job: OptimizeJob | null = null;

  /** The strategy of the active chart: its indicator entry, script and candles. */
  target() {
    const t = app.strategyResults[app.chart.id];
    const ind = t && app.chart.indicators.find((i) => i.uid === t.uid);
    const file = ind && library.get('strategies', ind.id);
    const data = candleStore.get(app.chart.id);
    return t && ind && file && data ? { t, ind, file, data } : null;
  }

  /** Rebuild the parameter rows when the chart strategy (or its symbol/timeframe) changed. */
  sync() {
    const tg = this.target();
    const key = tg ? `${app.chart.id}|${tg.t.uid}|${tg.t.symbol}|${tg.t.tf}|${tg.t.result.inputs.map((i) => i.id).join(',')}` : '';
    if (key === this.key) return;
    this.key = key;
    this.result = null; this.progress = null; this.error = ''; this.status = 'idle';
    this.rows = tg ? paramSpace(tg.t.result.inputs, tg.ind.params).map((p) => ({ ...p, on: true })) : [];
  }

  run() {
    const tg = this.target();
    if (!tg || this.status === 'running') return;
    const space = this.rows.filter((r) => r.on && r.max > r.min && r.step > 0);
    if (!space.length) { this.error = 'Switch on at least one parameter with a range.'; this.status = 'error'; return; }
    this.status = 'running'; this.error = ''; this.result = null; this.progress = { evals: 0, budget: this.budget, best: 0, phase: 'start' };
    const base = { ...$state.snapshot(tg.ind.params) } as Record<string, number | boolean | string>;
    this.job = runOptimizer({
      code: tg.file.code, lib: neededLib(tg.file.code), data: tg.data, stepSec: tg.t.stepSec, space: $state.snapshot(space) as ParamDef[], base, budget: this.budget, settings: $state.snapshot(app.tester),
    }, (p) => { this.progress = p; });
    this.job.promise.then((r) => { this.result = r; this.status = 'done'; })
      .catch((e) => { if (String(e.message ?? e) === 'cancelled') { this.status = 'idle'; return; } this.error = String(e.message ?? e); this.status = 'error'; })
      .finally(() => { this.job = null; });
  }

  cancel() { this.job?.cancel(); this.job = null; if (this.status === 'running') this.status = 'idle'; }

  /** Put a variant's parameters on the chart strategy and show the Strategy Tester. */
  apply(v: Variant) {
    const tg = this.target();
    if (!tg) return;
    tg.ind.params = { ...tg.ind.params, ...v.params };
    app.persist();
    paper.panelTab = 'tester'; paper.persist();
    app.notify(`Applied: ${v.tag}`);
  }
}

export const optimizer = new Optimizer();
