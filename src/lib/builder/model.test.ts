import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { newModel, toPine, parseModel, checkModel, suggest, condText, normalizeModel, type IndInfo, type Model } from './model.ts';
import { runPine } from '../pine/interp.ts';
import { describeScript } from '../pine/describe.ts';
import { setIndicatorSource } from '../pine/indlib.ts';
import { STRAT_SAMPLE } from '../ai/pine.ts';

const src = (n: string) => readFileSync(new URL(`../../../indicators/${n}.pine`, import.meta.url), 'utf8');
setIndicatorSource((n) => { try { return src(n); } catch { return undefined; } });
const infoCache = new Map<string, IndInfo | undefined>();
const info = (n: string): IndInfo | undefined => {
  if (!infoCache.has(n)) {
    let code: string | undefined; try { code = src(n); } catch { code = undefined; }
    if (!code) infoCache.set(n, undefined);
    else { const d = describeScript(code); infoCache.set(n, { title: d.meta.title, short: d.meta.shorttitle, overlay: d.meta.overlay, plots: d.plots.map((p) => p.title), inputs: d.inputs }); }
  }
  return infoCache.get(n);
};

const rsi = (p = {}) => ({ k: 'ind', ind: 'rsi', plot: 'RSI', p }) as const;

function sample(): Model {
  const m = newModel();
  m.name = 'RSI reversal';
  m.long.entry.items.push({ l: rsi(), cmp: 'cross_above', r: { k: 'num', v: 45 } });
  m.long.entry.items.push({ l: { k: 'price', src: 'close' }, cmp: 'above', r: { k: 'ind', ind: 'ema', plot: 'EMA', p: { Length: 20 } } });
  m.long.exit.items.push({ l: rsi(), cmp: 'cross_below', r: { k: 'num', v: 55 } });
  m.long.sl = 3; m.long.tp = 6;
  return m;
}

test('generated strategy runs and trades on sample data', () => {
  const m = sample();
  assert.equal(checkModel(m, info), null);
  const code = toPine(m, info);
  const r = runPine(code, STRAT_SAMPLE);
  assert.ok(!r.error, r.error?.message ?? '');
  assert.ok(r.strategy && r.strategy.trades.length > 0, 'no trades');
  assert.ok(r.inputs.some((i) => /RSI · Length/.test(i.title)) && r.inputs.some((i) => /Long stop loss %/.test(i.title)));
  assert.ok(r.plots.some((p) => p.title === 'RSI'));
});

test('model round-trips through the code and picks up size / SL / TP edits made in the code', () => {
  const m = sample();
  const code = toPine(m, info);
  assert.deepEqual(parseModel(code), m);
  const edited = code.replace('default_qty_value=100', 'default_qty_value=25').replace(/input\.float\(3, "Long stop loss %"/, 'input.float(1.5, "Long stop loss %"');
  const back = parseModel(edited)!;
  assert.equal(back.qty, 25); assert.equal(back.long.sl, 1.5); assert.equal(back.long.tp, 6);
  assert.equal(parseModel('//@version=5\nstrategy("x")'), null);
});

test('unary comparisons, within-N-bars, OR groups and short side', () => {
  const m = newModel();
  m.long.on = false; m.short.on = true;
  m.short.entry.op = 'or';
  m.short.entry.items.push({ l: rsi(), cmp: 'turn_down', within: 3 });
  m.short.entry.items.push({ l: { k: 'ind', ind: 'macd', plot: 'MACD', p: {} }, cmp: 'falling', n: 2 });
  m.short.exit.items.push({ l: { k: 'price', src: 'close' }, cmp: 'cross_above', r: { k: 'ind', ind: 'supertrend', plot: 'Up Trend', p: {} } });
  assert.equal(checkModel(m, info), null);
  const r = runPine(toPine(m, info), STRAT_SAMPLE);
  assert.ok(!r.error, r.error?.message ?? '');
  assert.ok(r.strategy!.trades.length > 0 && r.strategy!.trades.every((t) => t.dir === 'short'));
});

test('two instances of one indicator with different inputs get their own inputs', () => {
  const m = newModel();
  m.long.entry.items.push({ l: { k: 'ind', ind: 'ema', plot: 'EMA', p: { Length: 10 } }, cmp: 'cross_above', r: { k: 'ind', ind: 'ema', plot: 'EMA', p: { Length: 40 } } });
  const r = runPine(toPine(m, info), STRAT_SAMPLE);
  assert.ok(!r.error, r.error?.message ?? '');
  const lens = r.inputs.filter((i) => /Length/.test(i.title));
  assert.equal(lens.length, 2);
  assert.deepEqual(lens.map((i) => i.def).sort(), [10, 40]);
});

test('checkModel names the problem', () => {
  const m = newModel();
  assert.match(checkModel(m, info)!, /entry condition/);
  m.long.entry.items.push({ l: { k: 'ind', ind: 'nope', plot: 'x', p: {} }, cmp: 'above', r: { k: 'num', v: 1 } });
  assert.match(checkModel(m, info)!, /not in the list/);
  m.long.entry.items[0] = { l: rsi(), cmp: 'above' };
  assert.match(checkModel(m, info)!, /right: missing/);
  m.long.entry.items[0] = { l: { k: 'num', v: 3 }, cmp: 'rising' };
  assert.match(checkModel(m, info)!, /price or indicator on the left/);
  m.long.entry.items[0] = { l: rsi(), cmp: 'rising' };
  assert.equal(checkModel(m, info), null);
});

test('suggestions fit the indicator', () => {
  const rs = suggest('rsi', info('rsi')!).map((s) => s.label);
  assert.ok(rs.some((l) => /RSI crosses below 30/.test(l)) && rs.some((l) => /RSI crosses above 70/.test(l)));
  const ma = suggest('ema', info('ema')!).map((s) => s.label);
  assert.ok(ma.some((l) => /Close crosses above EMA/.test(l)));
  const mc = suggest('macd', info('macd')!).map((s) => s.label);
  assert.ok(mc.some((l) => /MACD MACD crosses above MACD Signal/.test(l)), mc.join('|'));
  assert.equal(condText({ l: rsi(), cmp: 'rising', n: 3, within: 2 }, info), 'RSI is rising for 3 bars (within the last 2 bars)');
});

test('normalizeModel repairs sloppy input', () => {
  const m = normalizeModel({ name: ' X ', qty: 'a', long: { entry: { op: 'or', items: [{ l: { k: 'price', src: 'close' }, cmp: 'rising', r: { k: 'num', v: 1 } }, null, { nope: 1 }] } } });
  assert.equal(m.name, 'X'); assert.equal(m.qty, 100); assert.equal(m.long.entry.op, 'or'); assert.equal(m.long.entry.items.length, 1);
  assert.equal(m.long.entry.items[0].r, undefined);
});

import { aiBuilder } from './ai.ts';
test('aiBuilder repairs a model that names a missing plot', async () => {
  const list = ['rsi', 'ema'].map((name) => ({ name, info: info(name)! }));
  const bad = { name: 'x', long: { entry: { items: [{ l: { k: 'ind', ind: 'rsi', plot: 'Nope', p: {} }, cmp: 'cross_above', r: { k: 'num', v: 45 } }] }, exit: { items: [{ l: { k: 'ind', ind: 'rsi', plot: 'RSI', p: {} }, cmp: 'cross_below', r: { k: 'num', v: 55 } }] } } };
  const good = JSON.parse(JSON.stringify(bad)); good.long.entry.items[0].l.plot = 'RSI';
  const replies = ['```json\n' + JSON.stringify(bad) + '\n```', 'text ```json\n' + JSON.stringify(good) + '\n```'];
  let calls = 0;
  const m = await aiBuilder('rsi cross', list, async (msgs) => { calls++; if (calls === 2) assert.match(msgs[msgs.length - 1].content, /no plot "Nope"/); return replies[calls - 1]; });
  assert.equal(calls, 2); assert.equal(m.long.entry.items.length, 1);
  await assert.rejects(aiBuilder('x', list, async () => 'not json', 2), /could not build/);
});
