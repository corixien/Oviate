import { app } from './app.svelte';
import { paper } from './paper/paper.svelte';
import { candleStore } from './chart/candleStore';
import { paramSpace, type ParamDef, type OptimizeProgress, type OptimizeResult, type Variant } from './pine/optimizer.ts';
import { runOptimizer, type OptimizeJob } from './pine/optimizer-runner.ts';
import { neededLib } from './pine/indlib.ts';
import { chartStrategy } from './tester.svelte';
import { loadScope, type ScopeSet } from './scopeData';
import { isChartScope } from './universe.ts';
import type { PineCandles } from './pine/types.ts';

export type Row = ParamDef & { on: boolean };

/** State of the strategy optimizer panel: parameter ranges, the running search and its 10 variants. */
class Optimizer {
  status = $state<'idle' | 'loading' | 'running' | 'done' | 'error'>('idle');
  /** candle loading for a scope other than the chart: securities done / total */
  loading = $state({ done: 0, total: 0 });
  /** what the result was computed on (scope other than the chart) */
  info = $state<{ symbols: number; tf: string; bars: number; failed: number; from: number } | null>(null);
  progress = $state<OptimizeProgress | null>(null);
  result = $state<OptimizeResult | null>(null);
  error = $state('');
  budget = $state(600);
  rows = $state<Row[]>([]);
  /** what the rows and the result belong to: chart, strategy, symbol, timeframe */
  key = $state('');
  private job: OptimizeJob | null = null;
  private scopeKey = '';
  private token = 0;

  /** The strategy of the active chart: its indicator entry, script and candles. */
  target() {
    const cs = chartStrategy();
    const data = candleStore.get(app.chart.id);
    return cs && data ? { ...cs, data } : null;
  }

  /** Rebuild the parameter rows when the chart strategy (or its symbol/timeframe) changed. */
  sync() {
    const tg = this.target();
    const sk = JSON.stringify(app.scope.optimizer);
    if (sk !== this.scopeKey) { this.scopeKey = sk; if (this.status !== 'loading' && this.status !== 'running') { this.result = null; this.progress = null; this.info = null; this.error = ''; this.status = 'idle'; } }
    const key = tg ? `${app.chart.id}|${tg.t.uid}|${tg.t.symbol}|${tg.t.tf}|${tg.t.result.inputs.map((i) => i.id).join(',')}` : '';
    if (key === this.key) return;
    this.key = key;
    this.result = null; this.progress = null; this.error = ''; this.status = 'idle';
    this.rows = tg ? paramSpace(tg.t.result.inputs, tg.ind.params).map((p) => ({ ...p, on: true })) : [];
  }

  async run() {
    const tg = this.target();
    if (!tg || this.status === 'running' || this.status === 'loading') return;
    const space = this.rows.filter((r) => r.on && r.max > r.min && r.step > 0);
    if (!space.length) { this.error = 'Switch on at least one parameter with a range.'; this.status = 'error'; return; }
    const token = ++this.token, cancelled = () => token !== this.token;
    this.error = ''; this.result = null; this.info = null;
    // the chart, or other securities / period / timeframe loaded from the cache (missing parts are fetched and stored)
    const sc = $state.snapshot(app.scope.optimizer);
    let data: PineCandles | PineCandles[] = tg.data, stepSec = tg.t.stepSec;
    if (!isChartScope(sc)) {
      this.status = 'loading'; this.loading = { done: 0, total: 0 };
      let set: ScopeSet;
      try { set = await loadScope(sc, { symbol: app.chart.symbol, tf: app.chart.tf, first: tg.data.t[0] ?? 0 }, (done, total) => { if (!cancelled()) this.loading = { done, total }; }, cancelled); }
      catch (e) { if (!cancelled()) { this.error = String((e as Error)?.message ?? e); this.status = 'error'; } return; }
      if (cancelled()) return;
      if (!set.items.length) { this.error = set.failed[0] ? `No data: ${set.failed[0].symbol} ${set.failed[0].error}` : 'No data'; this.status = 'error'; return; }
      data = set.items.map((x) => x.data); stepSec = set.stepSec;
      this.info = { symbols: set.items.length, tf: set.tf, bars: set.items.reduce((s, x) => s + x.data.n, 0), failed: set.failed.length, from: set.from };
    }
    this.status = 'running'; this.progress = { evals: 0, budget: this.budget, best: 0, phase: 'start' };
    const base = { ...$state.snapshot(tg.ind.params) } as Record<string, number | boolean | string>;
    this.job = runOptimizer({
      code: tg.file.code, lib: neededLib(tg.file.code), data, stepSec, space: $state.snapshot(space) as ParamDef[], base, budget: this.budget, settings: $state.snapshot(app.tester),
    }, (p) => { this.progress = p; });
    this.job.promise.then((r) => { if (!cancelled()) { this.result = r; this.status = 'done'; } })
      .catch((e) => { if (cancelled() || String(e.message ?? e) === 'cancelled') { if (!cancelled()) this.status = 'idle'; return; } this.error = String(e.message ?? e); this.status = 'error'; })
      .finally(() => { this.job = null; });
  }

  cancel() { this.token++; this.job?.cancel(); this.job = null; if (this.status === 'running' || this.status === 'loading') this.status = 'idle'; }

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
