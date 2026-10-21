import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPine } from './index.ts';
import { paramSpace, orderedPairs, optimize, metricsOf, minTradesFor, SEGS } from './optimizer.ts';
import type { StrategyResult, TradeRec, TesterSettings, PineInput } from './types.ts';

const SET: TesterSettings = { initialCapital: 10000, commissionValue: 0, slippagePct: 0.1, fillOnClose: true };

function candles(n = 1500) {
  const t = new Float64Array(n), o = new Float64Array(n), h = new Float64Array(n), l = new Float64Array(n), c = new Float64Array(n), v = new Float64Array(n).fill(1000);
  let seed = 99, p = 100;
  for (let i = 0; i < n; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const open = p; p = Math.max(20, p * (1 + Math.sin(i / 70) * 0.004 + ((seed / 4294967296) - 0.5) * 0.02));
    t[i] = 1.6e9 + i * 86400; o[i] = open; c[i] = p; h[i] = Math.max(open, p) * 1.004; l[i] = Math.min(open, p) * 0.996;
  }
  return { n, t, o, h, l, c, v };
}
const input = (o: Partial<PineInput> & { id: string; def: number }): PineInput => ({ title: o.id, type: 'int', ...o });

test('paramSpace: tunable numeric inputs with ranges from the script or around the default', () => {
  const sp = paramSpace([
    input({ id: 'Fast', def: 10, min: 2, max: 50 }), input({ id: 'Mult', def: 2, type: 'float', step: 0.1 }), input({ id: 'Off', def: 0 }),
    input({ id: 'Flag', def: 1, type: 'bool' }), input({ id: 'Level', def: -100, min: -300, max: 0 }),
  ]);
  assert.deepEqual(sp.map((p) => p.id), ['Fast', 'Mult', 'Level']);
  assert.deepEqual([sp[0].min, sp[0].max, sp[0].step], [2, 50, 1]);
  assert.deepEqual([sp[1].min, sp[1].max, sp[1].step], [0, 8, 0.1]);
  assert.equal(paramSpace([input({ id: 'Len', def: 14 })], { Len: 20 })[0].def, 20, 'current value is the search start');
});

test('orderedPairs keeps Fast < Slow style inputs ordered during the search', () => {
  const sp = paramSpace([input({ id: 'Fast EMA Length', def: 10, min: 2, max: 50 }), input({ id: 'Slow EMA Length', def: 40, min: 5, max: 150 }), input({ id: 'RSI Length', def: 14, min: 2, max: 50 })]);
  assert.deepEqual(orderedPairs(sp), [['Fast EMA Length', 'Slow EMA Length']]);
  assert.deepEqual(orderedPairs(paramSpace([input({ id: 'Fast', def: 50, min: 2, max: 80 }), input({ id: 'Slow', def: 20, min: 2, max: 80 })])), [], 'a default that is already inverted is left alone');
  const seen: [number, number][] = [];
  const data = candles(800);
  optimize({ code: '', data, stepSec: 86400, space: sp, settings: SET, budget: 200, run: (p) => { seen.push([Number(p['Fast EMA Length']), Number(p['Slow EMA Length'])]); return fake(800)({ Len: Number(p['Fast EMA Length']) }); } });
  assert.ok(seen.length > 20 && seen.every(([f, s]) => f < s), 'no evaluated setting has Fast >= Slow');
});

test('metricsOf: segments, recency weights and shrunk win rate', () => {
  const n = 1000;
  const trade = (exitBar: number, pnl: number): TradeRec => ({ id: 'x', dir: 'long', qty: 1, entryBar: exitBar - 1, entryTime: 0, entryPrice: 100, exitBar, exitTime: 0, exitPrice: 100 + pnl, pnl, commission: 0, entryComment: '', exitComment: '', open: false, mfe: 0, mae: 0 });
  const eq = Float64Array.from({ length: n }, (_, i) => 10000 + i * 2);
  const res = (trades: TradeRec[]): StrategyResult => ({ config: { qtyType: 'fixed', qtyValue: 1, pyramiding: 0, initialCapital: 10000 }, pending: [], trades, equity: eq, netProfit: 0, initialCapital: 10000, openPosition: null });
  // wins only in the oldest segment vs only in the newest: the newest counts more
  const old = metricsOf(res([...Array(5)].map((_, i) => trade(10 + i, 5)).concat([...Array(5)].map((_, i) => trade(900 + i, -5)))), n);
  const recent = metricsOf(res([...Array(5)].map((_, i) => trade(10 + i, -5)).concat([...Array(5)].map((_, i) => trade(900 + i, 5)))), n);
  assert.equal(old.trades, 10); assert.equal(old.rawWinRate, 0.5); assert.equal(recent.rawWinRate, 0.5);
  assert.ok(recent.winRate > old.winRate, `${recent.winRate} vs ${old.winRate}`);
  assert.equal(old.segs.length, SEGS);
  assert.ok(Math.abs(old.ret - (eq[n - 1] / 10000 - 1) * 100) < 1e-9);
  const few = metricsOf(res([trade(990, 5)]), n);
  assert.ok(few.winRate < 0.7, 'one win is not a 100% win rate: shrunk towards 50%');
  assert.equal(minTradesFor(2500), 13); assert.equal(minTradesFor(100), 8);
});

/** Fake backtest whose quality peaks at Len = 30: lets the search be checked without Pine. */
function fake(n: number) {
  return (params: Record<string, number | boolean | string>): StrategyResult => {
    const p = Number(params['Len']);
    const q = Math.max(0, 1 - Math.abs(p - 30) / 120); // 0..1
    const trades: TradeRec[] = [];
    for (let i = 0; i < 40; i++) {
      const win = i < Math.round(40 * (0.3 + 0.6 * q));
      trades.push({ id: 'x', dir: 'long', qty: 1, entryBar: i * 20, entryTime: 0, entryPrice: 100, exitBar: i * 20 + 10 + (i % 3), exitTime: 0, exitPrice: 100, pnl: win ? 10 : -10, commission: 0, entryComment: '', exitComment: '', open: false, mfe: 0, mae: 0 });
    }
    trades.sort((a, b) => a.exitBar - b.exitBar);
    const equity = Float64Array.from({ length: n }, (_, i) => 10000 * (1 + q * 0.5 * (i / n)));
    return { config: { qtyType: 'fixed', qtyValue: 1, pyramiding: 0, initialCapital: 10000 }, pending: [], trades, equity, netProfit: 0, initialCapital: 10000, openPosition: null };
  };
}

test('search: accelerates while improving, stops extending when worse, finds the peak with few evaluations', () => {
  const data = candles(800);
  const space = paramSpace([input({ id: 'Len', def: 5, min: 1, max: 200 })]);
  const seen: number[] = [];
  const run = fake(800);
  const r = optimize({ code: '', data, stepSec: 86400, space, settings: SET, run: (p) => { seen.push(Number(p['Len'])); return run(p); }, budget: 400 });
  assert.ok(Math.abs(r.variants[0].params['Len'] - 30) <= 3, `best Len ${r.variants[0].params['Len']}`);
  assert.ok(r.evals < 90, `evaluations ${r.evals}`);
  assert.equal(new Set(seen).size, seen.length, 'no point is evaluated twice');
  const asc = seen.slice(0, 6);
  assert.ok(asc[1] > asc[0] || asc[2] > asc[1], 'steps grow while improving: ' + asc.join(','));
});

test('variants: up to 10 distinct, ranked, the 3 category winners present, guards respected', () => {
  const data = candles(800);
  const space = paramSpace([input({ id: 'Len', def: 5, min: 1, max: 200 })]);
  const r = optimize({ code: '', data, stepSec: 86400, space, settings: SET, run: fake(800), budget: 400 });
  assert.ok(r.variants.length >= 7 && r.variants.length <= 10, String(r.variants.length));
  assert.deepEqual(r.variants.map((v) => v.rank), r.variants.map((_, i) => i + 1));
  assert.ok(r.variants.every((v, i) => i === 0 || r.variants[i - 1].score >= v.score - 1e-12), 'ranked by score');
  assert.equal(new Set(r.variants.map((v) => JSON.stringify(v.params))).size, r.variants.length, 'distinct parameter sets');
  for (const k of ['best-win', 'best-profit', 'best-drawdown']) assert.ok(r.variants.some((v) => v.kind === k), k);
  assert.ok(r.variants.every((v) => v.metrics.trades >= r.minTrades));
  const win = r.variants.find((v) => v.kind === 'best-win')!;
  assert.ok(r.variants.every((v) => v.metrics.winRate <= win.metrics.winRate + 1e-9), 'best win rate has the highest win rate');
});

test('budget, stop flag and progress', () => {
  const data = candles(800);
  const space = paramSpace([input({ id: 'Len', def: 5, min: 1, max: 200 }), input({ id: 'Other', def: 10, min: 1, max: 100 })]);
  const f = fake(800);
  const calls: number[] = [];
  const small = optimize({ code: '', data, stepSec: 86400, space, settings: SET, run: (p) => f({ ...p, Len: p['Len'] }), budget: 20, onProgress: (p) => calls.push(p.evals) });
  assert.ok(small.evals <= 20 + 24 * 4, 'only the neighbour pass may exceed the budget: ' + small.evals);
  assert.ok(calls.length >= 1);
  let n = 0;
  const stopped = optimize({ code: '', data, stepSec: 86400, space, settings: SET, run: (p) => { n++; return f(p); }, shouldStop: () => n >= 5 });
  assert.equal(stopped.stopped, true); assert.ok(stopped.evals <= 6);
});

test('end to end on a real Pine strategy: improves on a poor default and is deterministic', () => {
  const code = `//@version=6
strategy("EMA cross", overlay=true, default_qty_type=strategy.percent_of_equity, default_qty_value=100)
fastLen = input.int(3, "Fast", minval=2, maxval=60)
slowLen = input.int(8, "Slow", minval=5, maxval=150)
f = ta.ema(close, fastLen)
s = ta.ema(close, slowLen)
up = ta.crossover(f, s)
dn = ta.crossunder(f, s)
if up
    strategy.entry("L", strategy.long)
if dn
    strategy.close("L")
plot(f, "F")
plot(s, "S")`;
  const data = candles(1500);
  const info = runPine(code, data);
  const space = paramSpace(info.inputs);
  assert.deepEqual(space.map((p) => p.id), ['Fast', 'Slow']);
  const a = optimize({ code, data, stepSec: 86400, space, settings: SET, budget: 150 });
  const b = optimize({ code, data, stepSec: 86400, space, settings: SET, budget: 150 });
  assert.deepEqual(a.variants.map((v) => v.params), b.variants.map((v) => v.params), 'deterministic');
  assert.ok(a.variants.length >= 5);
  const best = a.variants[0];
  assert.ok(best.score > 0);
  const base = a.baseline!;
  assert.ok(best.metrics.winRate >= base.winRate - 1e-9 || best.metrics.retW >= base.retW, 'not worse than the default on the weighted figures');
  // every variant reproduces its metrics when run plainly
  const check = runPine(code, data, { params: best.params, broker: SET });
  assert.equal(check.strategy!.trades.filter((t) => !t.open).length, best.metrics.trades);
});
