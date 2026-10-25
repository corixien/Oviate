import { app } from './app.svelte';
import { library } from './library.svelte';
import { candleStore } from './chart/candleStore';
import { runScript } from './pine/runner.ts';
import { neededLib } from './pine/indlib.ts';
import { uniStat, type UniStat } from './pine/stats.ts';
import { loadScope } from './scopeData';
import { isChartScope, scopeSymbols } from './universe.ts';
import type { StrategyResult } from './pine/types.ts';

/** The strategy of the active chart: its indicator entry and script. */
export function chartStrategy() {
  const t = app.strategyResults[app.chart.id];
  const ind = t && app.chart.indicators.find((i) => i.uid === t.uid);
  const file = ind && library.get('strategies', ind.id);
  return t && ind && file ? { t, ind, file } : null;
}

/** One security of a Strategy Tester run over a scope. */
export interface UniRow { symbol: string; strategy: StrategyResult; closes: Float64Array; t0: number; t1: number; bars: number; stat: UniStat }

/** Strategy Tester run over several securities / another period / timeframe (the chart itself is never touched: its strategy keeps drawing its trades). */
class TesterRun {
  status = $state<'idle' | 'loading' | 'running' | 'done' | 'error'>('idle');
  progress = $state({ done: 0, total: 0 });
  rows = $state.raw<UniRow[]>([]);
  failed = $state.raw<{ symbol: string; error: string }[]>([]);
  selected = $state('');
  /** equity of the security being tested right now, growing while the backtest runs (drawn live in the equity chart) */
  live = $state.raw<{ symbol: string; equity: Float64Array; bars: number } | null>(null);
  error = $state('');
  tf = $state('');
  stepSec = $state(0);
  /** requested start of the history (unix seconds) */
  from = $state(0);
  /** what the rows were computed from (see inputKey) */
  key = $state('');
  private token = 0;

  /** Everything a result depends on: strategy code and inputs, simulation settings, scope and (for "Chart" parts) the chart symbol / timeframe. */
  inputKey(): string {
    const cs = chartStrategy();
    if (!cs) return '';
    const sc = app.scope.tester;
    return JSON.stringify([cs.ind.id, cs.file.code.length, cs.file.code.slice(-64), $state.snapshot(cs.ind.params), $state.snapshot(app.tester), sc, sc.count ? '' : app.chart.symbol, sc.tf === 'chart' ? app.chart.tf : '']);
  }

  get stale() { return this.status === 'done' && this.key !== this.inputKey(); }

  async run() {
    const cs = chartStrategy();
    const sc = $state.snapshot(app.scope.tester);
    if (!cs || this.status === 'loading' || this.status === 'running' || isChartScope(sc)) return;
    const token = ++this.token, key = this.inputKey();
    const cancelled = () => token !== this.token;
    this.status = 'loading'; this.error = ''; this.rows = []; this.failed = []; this.live = null; this.selected = ''; this.progress = { done: 0, total: scopeSymbols(sc, app.chart.symbol).length };
    try {
      const first = candleStore.get(app.chart.id)?.t[0] ?? 0;
      const set = await loadScope(sc, { symbol: app.chart.symbol, tf: app.chart.tf, first }, (done, total) => { if (!cancelled()) this.progress = { done, total }; }, cancelled);
      if (cancelled()) return;
      this.status = 'running'; this.progress = { done: 0, total: set.items.length };
      const params = $state.snapshot(cs.ind.params), broker = $state.snapshot(app.tester);
      const rows: UniRow[] = [], failed = [...set.failed];
      this.tf = set.tf; this.stepSec = set.stepSec; this.from = set.from;
      let lastLive = 0;
      for (const it of set.items) {
        const r = await runScript(cs.file.code, it.data, { params, step: set.stepSec, symbol: it.symbol, broker }, (_bar, equity) => {
          const t = performance.now();
          if (!cancelled() && t - lastLive > 40) { lastLive = t; this.live = { symbol: it.symbol, equity, bars: it.data.n }; }
        });
        if (cancelled()) return;
        const strat = r.strategy;
        if (r.error || !strat) failed.push({ symbol: it.symbol, error: r.error?.message ?? 'no strategy result' });
        else {
          const d = it.data, n = d.n;
          rows.push({ symbol: it.symbol, strategy: strat, closes: d.c, t0: d.t[0], t1: d.t[n - 1], bars: n, stat: uniStat(it.symbol, strat, { stepSec: set.stepSec, firstClose: d.c[0], lastClose: d.c[n - 1] }, n) });
        }
        // rows appear one by one: the table, the summary and the equity chart fill while the run goes on
        this.rows = [...rows]; this.failed = failed;
        if (!this.selected || !rows.some((x) => x.symbol === this.selected)) this.selected = rows[0]?.symbol ?? '';
        this.progress = { done: this.progress.done + 1, total: set.items.length };
      }
      this.live = null; this.rows = rows; this.failed = failed; this.key = key;
      if (!rows.some((x) => x.symbol === this.selected)) this.selected = rows[0]?.symbol ?? '';
      this.status = rows.length ? 'done' : 'error';
      if (!rows.length) this.error = failed[0] ? `No data: ${failed[0].symbol} ${failed[0].error}` : 'No data';
    } catch (e) { if (!cancelled()) { this.live = null; this.error = String((e as Error)?.message ?? e); this.status = 'error'; } }
  }

  cancel() { this.token++; this.live = null; if (this.status === 'loading' || this.status === 'running') this.status = 'idle'; }
}

export const testerRun = new TesterRun();
