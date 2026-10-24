import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { newModel, toPine, parseModel, checkModel, suggest, condText, normalizeModel, hhmmText, parseHhmm, TEMPLATES, type IndInfo, type Model } from './model.ts';
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
  assert.match(checkModel(m, info)!, /cannot be a fixed value/);
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

// intraday sample: 5-minute bars from 04:00 to 16:00 New York time on several weekdays, with a gap-up trend each day
function intraday(days = 6): import('../pine/types.ts').PineCandles {
  const t: number[] = [], o: number[] = [], h: number[] = [], l: number[] = [], c: number[] = [], v: number[] = [];
  let p = 100;
  for (let d = 0; d < days; d++) {
    const day0 = Date.UTC(2026, 9, 12 + d) / 1000; // Mon 2026-10-12 ...
    for (let m = 4 * 60; m < 16 * 60; m += 5) {
      const ts = day0 + (m + 4 * 60) * 60; // New York is UTC-4 in October (EDT)
      const wave = Math.sin((m + d * 40) / 25) * 0.6 + (m > 9 * 60 + 30 ? 0.02 * d : 0);
      const open = p, close = 100 + d * 0.5 + wave + (m - 240) * 0.004;
      t.push(ts); o.push(open); c.push(close); h.push(Math.max(open, close) + 0.15); l.push(Math.min(open, close) - 0.15); v.push(1000);
      p = close;
    }
  }
  return { n: t.length, t: Float64Array.from(t), o: Float64Array.from(o), h: Float64Array.from(h), l: Float64Array.from(l), c: Float64Array.from(c), v: Float64Array.from(v) };
}

test('pre-market high / low breakout strategy can be built: session stats, time window, day limit, time exit', () => {
  const m = newModel();
  m.name = 'Pre-market breakout';
  m.long.entry.items.push({ l: { k: 'price', src: 'close' }, cmp: 'cross_above', r: { k: 'sess', stat: 'high', from: 400, to: 930 } });
  m.long.entry.items.push({ l: { k: 'time', f: 'tod' }, cmp: 'between', r: { k: 'num', v: 930 }, r2: { k: 'num', v: 1500 } });
  m.long.exit.op = 'or';
  m.long.exit.items.push({ l: { k: 'price', src: 'close' }, cmp: 'cross_below', r: { k: 'sess', stat: 'low', from: 400, to: 930 } });
  m.long.exit.items.push({ l: { k: 'time', f: 'tod' }, cmp: 'at_least', r: { k: 'num', v: 1555 } });
  m.long.maxPerDay = 1;
  m.short.on = true;
  m.short.entry.items.push({ l: { k: 'price', src: 'close' }, cmp: 'cross_below', r: { k: 'sess', stat: 'low', from: 400, to: 930 } });
  m.short.entry.items.push({ l: { k: 'time', f: 'tod' }, cmp: 'between', r: { k: 'num', v: 930 }, r2: { k: 'num', v: 1500 } });
  m.short.exit.op = 'or';
  m.short.exit.items.push({ l: { k: 'time', f: 'tod' }, cmp: 'at_least', r: { k: 'num', v: 1555 } });
  m.short.maxPerDay = 1;
  assert.equal(checkModel(m, info), null);
  const code = toPine(m, info);
  assert.deepEqual(parseModel(code), m);
  const r = runPine(code, intraday());
  assert.ok(!r.error, r.error?.message ?? '');
  const trades = r.strategy!.trades;
  assert.ok(trades.length > 0, 'no trades');
  // never more than one entry per side and day, none outside 09:30-15:00 New York, all closed by 15:55
  const hhmm = (ts: number) => { const d = new Date((ts - 4 * 3600) * 1000); return d.getUTCHours() * 100 + d.getUTCMinutes(); };
  for (const t of trades) { assert.ok(hhmm(t.entryTime) >= 930 && hhmm(t.entryTime) <= 1500, `entry at ${hhmm(t.entryTime)}`); if (!t.open) assert.ok(hhmm(t.exitTime) <= 1600); }
  const perDay = new Map<string, number>();
  for (const t of trades) { const k = t.dir + new Date((t.entryTime - 4 * 3600) * 1000).toISOString().slice(0, 10); perDay.set(k, (perDay.get(k) ?? 0) + 1); }
  assert.ok([...perDay.values()].every((n) => n <= 1));
});

test('shifted and scaled operands, highest of N bars, position fields', () => {
  const m = newModel();
  m.long.entry.items.push({ l: { k: 'price', src: 'close' }, cmp: 'cross_above', r: { k: 'hl', fn: 'highest', src: 'high', n: 20, ago: 1 } });
  m.long.exit.op = 'or';
  m.long.exit.items.push({ l: { k: 'pos', f: 'bars' }, cmp: 'at_least', r: { k: 'num', v: 12 } });
  m.long.exit.items.push({ l: { k: 'pos', f: 'pnl' }, cmp: 'above', r: { k: 'num', v: 3 } });
  m.long.exit.items.push({ l: { k: 'price', src: 'close' }, cmp: 'below', r: { k: 'ind', ind: 'ema', plot: 'EMA', p: { Length: 10 }, pct: -2, ago: 1 } });
  assert.equal(checkModel(m, info), null);
  const r = runPine(toPine(m, info), STRAT_SAMPLE);
  assert.ok(!r.error, r.error?.message ?? '');
  assert.ok(r.strategy!.trades.length > 0);
  assert.match(condText(m.long.exit.items[2], info), /EMA \(10\) 1 bar ago -2%/);
  m.long.exit.items[0].r = { k: 'num', v: Number.NaN };
  assert.match(checkModel(m, info)!, /not a number/);
});

test('hh:mm helpers and day-of-week', () => {
  assert.equal(hhmmText(930), '09:30'); assert.equal(parseHhmm('9:30'), 930); assert.equal(parseHhmm('16'), 1600); assert.ok(Number.isNaN(parseHhmm('99:99')));
  const m = newModel();
  m.long.entry.items.push({ l: { k: 'time', f: 'dow' }, cmp: 'not_equal', r: { k: 'num', v: 5 } });
  m.long.entry.items.push({ l: { k: 'price', src: 'close' }, cmp: 'above', r: { k: 'price', src: 'open' } });
  assert.equal(condText(m.long.entry.items[0], info), 'Day of week is not Fri');
  assert.ok(!runPine(toPine(m, info), STRAT_SAMPLE).error);
});

test('every template is valid and runs', () => {
  for (const t of TEMPLATES) {
    const m = t.build();
    assert.equal(checkModel(m, info), null, t.id);
    const r = runPine(toPine(m, info), t.id === 'premarket' || t.id === 'orb' ? intraday() : STRAT_SAMPLE);
    assert.ok(!r.error, `${t.id}: ${r.error?.message}`);
    if (t.id === 'premarket' || t.id === 'orb') assert.ok(r.strategy!.trades.length > 0, `${t.id} never trades on intraday data`);
  }
});

import { mirrorSideLocal } from './ai.ts';
test('mirrorSideLocal flips a long side into its opposite', () => {
  const m = TEMPLATES.find((t) => t.id === 'rsi')!.build();
  const sh = mirrorSideLocal(m.long);
  assert.equal(sh.entry.items[0].cmp, 'cross_below');
  assert.deepEqual(sh.entry.items[0].r, { k: 'num', v: 70 });
  assert.equal(sh.exit.items[0].cmp, 'cross_below');
  assert.deepEqual(sh.exit.items[0].r, { k: 'num', v: 30 });
  const pm = TEMPLATES.find((t) => t.id === 'premarket')!.build();
  const s2 = mirrorSideLocal(pm.long);
  assert.equal((s2.entry.items[0].r as { stat: string }).stat, 'low');
  assert.equal(s2.entry.items[1].cmp, 'between');
});
