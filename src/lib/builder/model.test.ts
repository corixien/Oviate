import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPine } from '../pine/index.ts';
import { INDICATORS, defaultSpec, generate, parseSpec, companions, cond, emptyGroup, indOperand, numOperand, priceOperand, defaultParams, scenariosFor, scenarioCond } from './model.ts';
import type { Spec } from './model.ts';

/** Zig-zag price series so crosses and oscillator extremes happen. */
function candles(n = 400) {
  const t = new Float64Array(n), o = new Float64Array(n), h = new Float64Array(n), l = new Float64Array(n), c = new Float64Array(n), v = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const p = 100 + Math.sin(i / 9) * 12 + Math.sin(i / 3.1) * 2 + i * 0.02;
    t[i] = 1_700_000_000 + i * 86400; o[i] = p; c[i] = p + Math.cos(i / 2); h[i] = Math.max(o[i], c[i]) + 0.8; l[i] = Math.min(o[i], c[i]) - 0.8; v[i] = 1000 + (i % 10) * 100;
  }
  return { n, t, o, h, l, c, v };
}
const run = (s: Spec) => { const r = runPine(generate(s), candles()); if (r.error) throw new Error(r.error.message + '\n' + generate(s)); return r; };

test('default spec generates a valid strategy that trades', () => {
  const r = run(defaultSpec());
  assert.equal(r.meta.kind, 'strategy');
  assert.ok(r.strategy!.trades.length > 2, `trades ${r.strategy!.trades.length}`);
  assert.ok(r.strategy!.trades.every((t) => t.dir === 'long'));
  assert.ok(r.plots.length >= 2, 'overlay MAs are plotted');
});

test('every catalog indicator compiles with each output used on both sides of a condition', () => {
  for (const d of INDICATORS) {
    const s = defaultSpec();
    s.short.on = true;
    s.long.entry = { t: 'group', op: 'and', items: d.outputs.map((_, k) => cond(indOperand(d.key, k), 'above', numOperand(-1e9))) };
    s.short.entry = { t: 'group', op: 'or', items: [cond(indOperand(d.key, 0), 'cross_below', indOperand(d.key, d.outputs.length - 1)), cond(priceOperand('close'), 'rising', numOperand(2))] };
    run(s);
  }
});

test('and / or groups and between / equals compile and behave', () => {
  const s = defaultSpec();
  s.short.on = false;
  const rsi = indOperand('rsi', 0, [14]);
  s.long.entry = { t: 'group', op: 'or', items: [
    cond(rsi, 'between', numOperand(0), numOperand(30)),
    { t: 'group', op: 'and', items: [cond(priceOperand('close'), 'above', indOperand('sma', 0, [50])), cond(rsi, 'cross_above', numOperand(50))] },
  ] };
  s.long.exit = { t: 'group', op: 'and', items: [cond(rsi, 'above_eq', numOperand(70))] };
  const r = run(s);
  assert.ok(r.strategy!.trades.length > 0);
});

test('short side and stop loss / take profit', () => {
  const s = defaultSpec();
  s.long.on = false; s.short.on = true;
  s.short.entry = { t: 'group', op: 'and', items: [cond(indOperand('rsi', 0, [14]), 'cross_below', numOperand(60))] };
  s.short.exit = emptyGroup();
  s.short.sl = 3; s.short.tp = 3;
  const r = run(s);
  const closed = r.strategy!.trades.filter((t) => !t.open);
  assert.ok(closed.length > 0);
  assert.ok(closed.every((t) => t.dir === 'short'));
});

test('position size is written into the strategy declaration', () => {
  const s = defaultSpec();
  s.qtyType = 'cash'; s.qty = 2500;
  assert.match(generate(s), /default_qty_type=strategy\.cash, default_qty_value=2500/);
  const r = run(s);
  assert.equal(r.strategy!.config.qtyType, 'cash'); assert.equal(r.strategy!.config.qtyValue, 2500);
  assert.equal(parseSpec(generate(s))!.qty, 2500);
});

test('empty entry never trades', () => {
  const s = defaultSpec();
  s.long.entry = emptyGroup();
  assert.equal(run(s).strategy!.trades.length, 0);
});

test('spec round-trips through the generated header and keeps the title parseable', () => {
  const s = defaultSpec();
  s.name = 'Strat (v2) "quoted"';
  const code = generate(s);
  const back = parseSpec(code);
  assert.deepEqual(back, s);
  assert.equal(parseSpec('//@version=5\nindicator("x")'), null);
  const r = runPine(code, candles());
  assert.equal(r.meta.title, "Strat (v2) 'quoted'");
});

test('companions list oscillator panes with matching input titles', () => {
  const s = defaultSpec();
  s.long.entry = { t: 'group', op: 'and', items: [cond(indOperand('rsi', 0, [9]), 'above', numOperand(50)), cond(indOperand('macd', 0), 'cross_above', indOperand('macd', 1))] };
  const c = companions(s);
  assert.deepEqual(c.map((x) => x.id).sort(), ['macd', 'rsi']);
  assert.deepEqual(c.find((x) => x.id === 'rsi')!.params, { Length: 9 });
  assert.deepEqual(c.find((x) => x.id === 'macd')!.params, { 'Fast Length': 12, 'Slow Length': 26, 'Signal Length': 9 });
  assert.deepEqual(defaultParams('stoch'), [14, 1, 3]);
});

test('every scenario of every indicator and price source compiles with its default arguments', () => {
  const subjects = [...INDICATORS.map((d) => indOperand(d.key, 0)), ...INDICATORS.filter((d) => d.outputs.length > 1).map((d) => indOperand(d.key, d.outputs.length - 1)), priceOperand('close')];
  let n = 0;
  for (const lhs of subjects) {
    for (const sc of scenariosFor(lhs)) {
      const s = defaultSpec();
      s.short.on = false;
      s.long.entry = { t: 'group', op: 'and', items: [scenarioCond(lhs, sc.id)] };
      run(s);
      n++;
    }
  }
  assert.ok(n > 150, `scenarios ${n}`);
});

test('supertrend up/down scenarios follow the direction flag', () => {
  const s = defaultSpec();
  s.short.on = true;
  s.long.entry = { t: 'group', op: 'and', items: [scenarioCond(indOperand('supertrend'), 'flip_up')] };
  s.long.exit = { t: 'group', op: 'and', items: [scenarioCond(indOperand('supertrend'), 'flip_down')] };
  s.short.on = false;
  const r = run(s);
  assert.ok(r.strategy!.trades.length > 1);
  assert.ok(r.strategy!.trades.every((t) => t.dir === 'long'));
});

test('each indicator has its own scenario list; old comparator ids still resolve', () => {
  const ids = (k: string) => scenariosFor(indOperand(k)).map((x) => x.id);
  assert.ok(ids('supertrend').includes('flip_up') && !ids('supertrend').includes('cross_above'));
  assert.ok(ids('macd').includes('hist_pos') && ids('macd').includes('cross_above'));
  assert.ok(ids('ema').includes('price_cross_above'));
  assert.ok(!ids('rsi').includes('price_cross_above'));
  const s = defaultSpec();
  s.long.entry = { t: 'group', op: 'and', items: [cond(indOperand('supertrend'), 'cross_above', numOperand(0))] };
  run(s); // legacy generic id on an indicator that does not list it
});

test('AI conditions: code with IND placeholders becomes a function, empty code never fires', () => {
  const s = defaultSpec();
  s.short.on = false;
  const c = scenarioCond(indOperand('rsi', 0, [14]), 'ai');
  s.long.entry = { t: 'group', op: 'and', items: [c] };
  assert.equal(run(s).strategy!.trades.length, 0);
  c.ai!.code = 'e = ta.ema(close, 20)\nIND0[1] < 50 and IND0 >= 50 and close > e';
  const code = generate(s);
  assert.match(code, /ai1\(\) =>/);
  assert.doesNotMatch(code.split('\n').filter((l) => !l.startsWith('// @oviate-builder')).join('\n'), /IND0/);
  const r = run(s);
  assert.ok(r.strategy!.trades.length > 0, 'AI condition fires');
  const back = parseSpec(code)!;
  assert.equal(back.long.entry.items[0].t === 'cond' && back.long.entry.items[0].ai!.code, c.ai!.code);
});
