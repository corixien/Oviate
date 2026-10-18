import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPine } from './index.ts';
import { sma as oldSma, ema as oldEma, rsi as oldRsi, atr as oldAtr, INDICATORS } from '../chart/indicators.ts';

function candles(n = 300, seed = 7) {
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const t = new Float64Array(n), o = new Float64Array(n), h = new Float64Array(n), l = new Float64Array(n), c = new Float64Array(n), v = new Float64Array(n);
  let p = 100;
  for (let i = 0; i < n; i++) {
    o[i] = p; c[i] = p * (1 + (rnd() - 0.5) * 0.04);
    h[i] = Math.max(o[i], c[i]) * (1 + rnd() * 0.01); l[i] = Math.min(o[i], c[i]) * (1 - rnd() * 0.01);
    v[i] = 1000 + rnd() * 5000; t[i] = 1700000000 + i * 86400; p = c[i];
  }
  return { n, t, o, h, l, c, v };
}
const data = candles();
const close = (res: ReturnType<typeof runPine>, i = 0) => res.plots[i].values;
function same(a: Float64Array | number[], b: Float64Array | number[], tol = 1e-9, from = 0) {
  assert.equal(a.length, b.length);
  for (let i = from; i < a.length; i++) {
    if (Number.isNaN(a[i]) && Number.isNaN(b[i])) continue;
    assert.ok(Math.abs(a[i] - b[i]) <= tol * Math.max(1, Math.abs(b[i])), `index ${i}: ${a[i]} vs ${b[i]}`);
  }
}
const run = (code: string, params = {}) => { const r = runPine(code, data, { params }); if (r.error) throw new Error(r.error.message); return r; };

test('sma / ema / rma match reference implementations', () => {
  const r = run('indicator("t")\nplot(ta.sma(close, 20))\nplot(ta.ema(close, 20))');
  same(close(r, 0), oldSma(data.c, 20));
  same(close(r, 1), oldEma(data.c, 20));
});

test('rsi and atr match reference', () => {
  const r = run('indicator("t")\nplot(ta.rsi(close, 14))\nplot(ta.atr(14))');
  same(close(r, 0), oldRsi(data.c, 14), 1e-9);
  same(close(r, 1), oldAtr(data as any, 14), 1e-9);
});

test('bollinger, macd and stochastic match the built-in definitions', () => {
  const r = run('indicator("t")\n[b, u, l] = ta.bb(close, 20, 2)\nplot(b)\nplot(u)\nplot(l)\n[m, s, h] = ta.macd(close, 12, 26, 9)\nplot(m)\nplot(s)\nplot(h)\nplot(ta.stoch(close, high, low, 14))');
  const old = INDICATORS.find((d) => d.id === 'bb')!.compute(data as any, { length: 20, mult: 2 });
  same(close(r, 0), old[0].v); same(close(r, 1), old[1].v); same(close(r, 2), old[2].v);
  const mac = INDICATORS.find((d) => d.id === 'macd')!.compute(data as any, { fast: 12, slow: 26, signal: 9 });
  same(close(r, 3), mac[1].v, 1e-9); same(close(r, 4), mac[2].v, 1e-9); same(close(r, 5), mac[0].v, 1e-9);
  const st = INDICATORS.find((d) => d.id === 'stoch')!.compute(data as any, { k: 14, d: 3 });
  same(close(r, 6), st[0].v, 1e-9);
});

test('supertrend follows the documented band/direction rules', () => {
  const r = run('indicator("t", overlay=true)\n[st, dir] = ta.supertrend(3, 10)\nplot(st)\nplot(dir)');
  const atr = oldAtr(data as any, 10);
  let lo = NaN, up = NaN, stv = NaN, dir = 1;
  for (let i = 0; i < data.n; i++) {
    if (Number.isNaN(atr[i])) { assert.ok(Number.isNaN(close(r, 0)[i])); continue; }
    const src = (data.h[i] + data.l[i]) / 2;
    let u = src + 3 * atr[i], l = src - 3 * atr[i];
    const pl = Number.isNaN(lo) ? l : lo, pu = Number.isNaN(up) ? u : up;
    l = l > pl || data.c[i - 1] < pl ? l : pl;
    u = u < pu || data.c[i - 1] > pu ? u : pu;
    if (Number.isNaN(stv)) dir = 1; else if (stv === pu) dir = data.c[i] > u ? -1 : 1; else dir = data.c[i] < l ? 1 : -1;
    stv = dir === -1 ? l : u; lo = l; up = u;
    assert.ok(Math.abs(close(r, 0)[i] - stv) < 1e-9, `st at ${i}`);
    assert.equal(close(r, 1)[i], dir);
  }
});

test('wma, hma, stdev, highest, lowest, change', () => {
  const r = run('indicator("t")\nplot(ta.wma(close, 5))\nplot(ta.stdev(close, 10))\nplot(ta.highest(high, 7))\nplot(ta.lowest(low, 7))\nplot(ta.change(close, 3))\nplot(ta.hma(close, 9))');
  const i = 100;
  let sum = 0, norm = 0; for (let k = 0; k < 5; k++) { sum += data.c[i - k] * (5 - k); norm += 5 - k; }
  assert.ok(Math.abs(close(r, 0)[i] - sum / norm) < 1e-9);
  const w = Array.from(data.c.slice(i - 9, i + 1)); const m = w.reduce((a, b) => a + b) / 10;
  assert.ok(Math.abs(close(r, 1)[i] - Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / 10)) < 1e-9);
  assert.equal(close(r, 2)[i], Math.max(...Array.from(data.h.slice(i - 6, i + 1))));
  assert.equal(close(r, 3)[i], Math.min(...Array.from(data.l.slice(i - 6, i + 1))));
  assert.ok(Math.abs(close(r, 4)[i] - (data.c[i] - data.c[i - 3])) < 1e-12);
  assert.ok(!Number.isNaN(close(r, 5)[i]));
});

test('language: var, history, functions, loops, switch, arrays, tuples, if-expression', () => {
  const r = run(`indicator("lang")
var total = 0.0
total += 1
f(a, b) =>
    c = a * b
    c + 1
sumLoop = 0
for i = 1 to 4
    sumLoop += i
w = 0
while w < 3
    w += 1
mode = 2
sw = switch mode
    1 => 10
    2 => 20
    => 30
arr = array.new_float(0)
array.push(arr, 5)
array.push(arr, 7)
t = array.sum(arr) + array.size(arr)
[hi, lo] = [high, low]
cond = close > open ? 1 : 0
v = if cond == 1
    100
else
    200
plot(total)
plot(f(3, 4))
plot(sumLoop)
plot(w)
plot(sw)
plot(t)
plot(close[1])
plot(total[1])
plot(v)
plot(hi - lo)
plot(nz(na) + 1)
`);
  const at = (p: number, i: number) => close(r, p)[i];
  assert.equal(at(0, 10), 11);
  assert.equal(at(1, 10), 13);
  assert.equal(at(2, 10), 10);
  assert.equal(at(3, 10), 3);
  assert.equal(at(4, 10), 20);
  assert.equal(at(5, 10), 14);
  assert.equal(at(6, 10), data.c[9]);
  assert.equal(at(7, 10), 10);
  assert.equal(at(8, 10), data.c[10] > data.o[10] ? 100 : 200);
  assert.ok(Math.abs(at(9, 10) - (data.h[10] - data.l[10])) < 1e-12);
  assert.equal(at(10, 10), 1);
});

test('inputs: defaults, overrides and registration', () => {
  const code = 'indicator("i")\nlen = input.int(5, "Length", minval=1, maxval=50)\nm = input.float(1.5, "Mult")\nplot(ta.sma(close, len) * m)';
  const a = runPine(code, data); const b = runPine(code, data, { params: { Length: 10, Mult: 2 } });
  assert.deepEqual(a.inputs.map((i) => [i.title, i.type, i.def, i.min, i.max]), [['Length', 'int', 5, 1, 50], ['Mult', 'float', 1.5, undefined, undefined]]);
  const i = 50;
  const sma = (n: number) => Array.from(data.c.slice(i - n + 1, i + 1)).reduce((x, y) => x + y) / n;
  assert.ok(Math.abs(a.plots[0].values[i] - sma(5) * 1.5) < 1e-9);
  assert.ok(Math.abs(b.plots[0].values[i] - sma(10) * 2) < 1e-9);
});

test('outputs: plot colors, hline, fill, plotshape, bgcolor', () => {
  const r = run(`indicator("o")
p1 = plot(close, color = close > open ? color.green : color.red)
p2 = plot(open)
h = hline(100, "lvl")
fill(p1, p2, color = color.new(color.blue, 80))
plotshape(close > open, style = shape.triangleup, location = location.belowbar, color = color.lime, text = "U")
bgcolor(close > open ? color.new(color.green, 90) : na)
`);
  assert.ok(r.plots[0].colors, 'per-bar colors');
  assert.equal(r.hlines[0].price, 100);
  assert.deepEqual(r.fills[0].a, { kind: 'plot', id: 0 });
  assert.equal(r.shapes[0].style, 'triangleup');
  assert.equal(r.shapes[0].location, 'belowbar');
  const up = Array.from(data.c).map((c, i) => (c > data.o[i] ? 1 : 0));
  assert.deepEqual(Array.from(r.shapes[0].flags), up);
  assert.equal(r.fills[0].color.length, 9);
});

test('crossover, barssince, valuewhen, pivots', () => {
  const r = run(`indicator("s")
a = ta.sma(close, 5)
b = ta.sma(close, 20)
x = ta.crossover(a, b)
plot(x ? 1 : 0)
plot(ta.barssince(x))
plot(ta.valuewhen(x, close, 0))
plot(ta.pivothigh(high, 3, 3))
`);
  const A = oldSma(data.c, 5), B = oldSma(data.c, 20);
  for (let i = 21; i < data.n; i++) assert.equal(close(r, 0)[i], A[i] > B[i] && A[i - 1] <= B[i - 1] ? 1 : 0);
  const ph = close(r, 3);
  for (let i = 3; i < data.n - 3; i++) {
    const isPivot = [1, 2, 3].every((k) => data.h[i - k] <= data.h[i]) && [1, 2, 3].every((k) => data.h[i + k] < data.h[i]);
    assert.equal(!Number.isNaN(ph[i + 3]), isPivot, `pivot at ${i}`);
  }
});

test('syntax and runtime errors are reported, not thrown', () => {
  assert.ok(runPine('indicator("e")\nplot(unknownVar)', data).error);
  assert.ok(runPine('indicator("e"\nplot(close)', data).error?.line);
  assert.ok(runPine('indicator("e")\nx = nosuch.func(1)', data).error);
});

test('user functions keep separate ta state per call site', () => {
  const r = run('indicator("f")\nmy(x, n) => ta.sma(x, n)\nplot(my(close, 3))\nplot(my(close, 10))');
  same(close(r, 0), oldSma(data.c, 3)); same(close(r, 1), oldSma(data.c, 10));
});

test('performance: 20k bars with several indicators', () => {
  const big = candles(20000, 3);
  const t0 = performance.now();
  const r = runPine('indicator("p")\nplot(ta.sma(close, 50))\nplot(ta.ema(close, 21))\nplot(ta.rsi(close, 14))\n[m, s, h] = ta.macd(close, 12, 26, 9)\nplot(m)\nplot(ta.atr(14))\nplot(ta.stdev(close, 20))', big);
  const ms = performance.now() - t0;
  assert.equal(r.error, undefined);
  assert.ok(ms < 4000, `took ${ms.toFixed(0)} ms`);
  console.log(`  20k bars x 6 indicators: ${ms.toFixed(0)} ms`);
});
