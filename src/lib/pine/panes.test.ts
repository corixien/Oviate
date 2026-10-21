import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPine } from './index.ts';
import { splitPanes } from './panes.ts';

function candles(n = 200) {
  const t = new Float64Array(n), o = new Float64Array(n), h = new Float64Array(n), l = new Float64Array(n), c = new Float64Array(n), v = new Float64Array(n).fill(1000);
  for (let i = 0; i < n; i++) { const p = 100 + Math.sin(i / 9) * 12; t[i] = 1.7e9 + i * 86400; o[i] = p; c[i] = p + Math.cos(i / 2); h[i] = Math.max(o[i], c[i]) + 1; l[i] = Math.min(o[i], c[i]) - 1; }
  return { n, t, o, h, l, c, v };
}
const code = `//@version=6
strategy("Multi", overlay=true, default_qty_type=strategy.percent_of_equity, default_qty_value=100)
f = ta.ema(close, 10)
r = ta.rsi(close, 14)
[m, s, hist] = ta.macd(close, 12, 26, 9)
if ta.crossover(r, 40)
    strategy.entry("L", strategy.long)
plot(f, "EMA", color=color.aqua)
r1 = plot(r, "RSI", color=color.purple, pane="RSI")
hline(70, "OB", pane="RSI")
h2 = hline(30, "OS", pane="RSI")
plot(m, "MACD", pane="MACD")
plot(s, "Signal", pane="MACD")
plot(hist, "Hist", style=plot.style_histogram, pane="MACD")
bgcolor(r > 70 ? color.new(color.red, 90) : na)
`;

test('pane= splits one script into the price pane plus one pane per name', () => {
  const r = runPine(code, candles());
  assert.equal(r.error, undefined);
  const panes = splitPanes(r);
  assert.deepEqual(panes.map((p) => p.name), ['', 'RSI', 'MACD']);
  assert.equal(panes[0].overlay, true);
  assert.deepEqual(panes[0].result.plots.map((p) => p.title), ['EMA']);
  assert.deepEqual(panes[1].result.plots.map((p) => p.title), ['RSI']);
  assert.deepEqual(panes[1].result.hlines.map((h) => h.title), ['OB', 'OS']);
  assert.deepEqual(panes[2].result.plots.map((p) => p.title), ['MACD', 'Signal', 'Hist']);
  assert.ok(panes.slice(1).every((p) => !p.overlay && !p.result.strategy && p.result.shapes.length === 0));
  assert.ok(panes[0].result.bgcolors.some(Boolean), 'bgcolor stays in the main pane');
});

test('without pane= the result is returned untouched; an oscillator-only overlay=false script has no empty main pane', () => {
  const plain = runPine('//@version=6\nindicator("p")\nplot(ta.rsi(close, 14), "R")', candles());
  const one = splitPanes(plain);
  assert.equal(one.length, 1); assert.equal(one[0].result, plain);
  const osc = runPine('//@version=6\nindicator("o", overlay=false)\nplot(ta.rsi(close, 14), "R", pane="R")\nplot(ta.rsi(close, 5), "R5", pane="R5")', candles());
  assert.deepEqual(splitPanes(osc).map((p) => p.name), ['R', 'R5']);
});

test('fills between plots of the same pane survive the split', () => {
  const r = runPine('//@version=6\nindicator("f", overlay=false)\na = plot(ta.rsi(close, 14), "A", pane="X")\nb = plot(ta.rsi(close, 5), "B", pane="X")\nfill(a, b, color=color.new(color.blue, 80))', candles());
  const p = splitPanes(r);
  assert.equal(p[0].result.fills.length, 1);
});
