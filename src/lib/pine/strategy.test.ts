import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPine } from './index.ts';

/** Deterministic candles: each bar has explicit o/h/l/c. */
function bars(rows: [number, number, number, number][]) {
  const n = rows.length;
  const t = new Float64Array(n).map((_, i) => 1700000000 + i * 86400);
  return { n, t, o: Float64Array.from(rows.map((r) => r[0])), h: Float64Array.from(rows.map((r) => r[1])), l: Float64Array.from(rows.map((r) => r[2])), c: Float64Array.from(rows.map((r) => r[3])), v: new Float64Array(n).fill(1000) };
}
const flat = (n: number, p = 100) => bars(Array.from({ length: n }, () => [p, p + 1, p - 1, p] as [number, number, number, number]));
const strat = (extra: string, body: string) => `//@version=5\nstrategy("t", overlay=true, initial_capital=10000, ${extra})\n${body}`;
const ok = (r: ReturnType<typeof runPine>) => { if (r.error) throw new Error(r.error.message); return r.strategy!; };

test('market entry fills at the next bar open; close fills at the following open', () => {
  const d = bars([[100, 101, 99, 100], [100, 101, 99, 100], [105, 106, 104, 105], [110, 111, 109, 110], [120, 121, 119, 120], [130, 131, 129, 130]]);
  const s = ok(runPine(strat('default_qty_type=strategy.fixed, default_qty_value=2', `if bar_index == 1\n    strategy.entry("L", strategy.long)\nif bar_index == 3\n    strategy.close("L")`), d));
  assert.equal(s.trades.length, 1);
  const t = s.trades[0];
  assert.equal(t.entryBar, 2); assert.equal(t.entryPrice, 105);
  assert.equal(t.exitBar, 4); assert.equal(t.exitPrice, 120);
  assert.equal(t.qty, 2); assert.equal(t.pnl, 30);
  assert.equal(s.netProfit, 30);
  assert.equal(s.equity[5], 10030);
});

test('stop-loss and take-profit via strategy.exit, with gap fills', () => {
  const d = bars([[100, 101, 99, 100], [100, 101, 99, 100], [100, 112, 99, 111], [111, 112, 108, 109], [109, 110, 90, 95]]);
  // entry at bar 2 open (100); TP at 110 hit on bar 2 (high 112) -> filled at 110
  let s = ok(runPine(strat('default_qty_type=strategy.fixed, default_qty_value=1', `if bar_index == 1\n    strategy.entry("L", strategy.long)\nstrategy.exit("X", "L", limit=110, stop=95)`), d));
  assert.equal(s.trades[0].exitPrice, 110); assert.equal(s.trades[0].pnl, 10);
  // stop gaps: open 90 below stop 95 -> fills at open
  const g = bars([[100, 101, 99, 100], [100, 101, 99, 100], [100, 101, 99, 100], [90, 91, 85, 88]]);
  s = ok(runPine(strat('default_qty_type=strategy.fixed, default_qty_value=1', `if bar_index == 1\n    strategy.entry("L", strategy.long)\nstrategy.exit("X", "L", limit=120, stop=95)`), g));
  assert.equal(s.trades[0].exitPrice, 90); assert.equal(s.trades[0].pnl, -10);
});

test('short positions, reversal and pyramiding limit', () => {
  const d = bars([[100, 101, 99, 100], [100, 101, 99, 100], [100, 101, 99, 100], [90, 91, 89, 90], [80, 81, 79, 80], [85, 86, 84, 85]]);
  const s = ok(runPine(strat('default_qty_type=strategy.fixed, default_qty_value=1', `if bar_index == 1\n    strategy.entry("S", strategy.short)\nif bar_index == 2\n    strategy.entry("S2", strategy.short)\nif bar_index == 3\n    strategy.entry("L", strategy.long)`), d));
  // S fills at bar 2 open (100); S2 ignored (pyramiding 0); L at bar 4 open (80) reverses: short closed at 80 -> +20
  assert.equal(s.trades.filter((t) => !t.open).length, 1);
  assert.equal(s.trades[0].dir, 'short'); assert.equal(s.trades[0].pnl, 20);
  assert.equal(s.openPosition?.dir, 'long'); assert.equal(s.openPosition?.avg, 80);
  assert.equal(s.trades.some((t) => t.id === 'S2'), false);
});

test('percent_of_equity sizing and percentage commission', () => {
  const d = flat(6, 100);
  const s = ok(runPine(strat('default_qty_type=strategy.percent_of_equity, default_qty_value=50, commission_type=strategy.commission.percent, commission_value=0.1', `if bar_index == 1\n    strategy.entry("L", strategy.long)\nif bar_index == 3\n    strategy.close("L")`), d));
  const t = s.trades[0];
  assert.ok(Math.abs(t.qty - 50) < 1e-9, `qty ${t.qty}`);
  // commission 0.1% of 5000 on both sides = 10
  assert.ok(Math.abs(t.commission - 10) < 1e-9);
  assert.ok(Math.abs(t.pnl + 10) < 1e-9);
  assert.ok(Math.abs(s.netProfit + 10) < 1e-9);
});

test('limit entries wait until price trades through the level', () => {
  const d = bars([[100, 101, 99, 100], [100, 101, 99, 100], [100, 101, 97, 99], [99, 100, 95, 96], [96, 97, 94, 95]]);
  const s = ok(runPine(strat('default_qty_type=strategy.fixed, default_qty_value=1', `if bar_index == 1\n    strategy.entry("L", strategy.long, limit=96)`), d));
  assert.equal(s.trades[0].entryBar, 3); assert.equal(s.trades[0].entryPrice, 96);
});

test('strategy variables, trailing stop and open trade reporting', () => {
  const d = bars([[100, 101, 99, 100], [100, 101, 99, 100], [100, 102, 100, 101], [101, 110, 100.5, 109], [109, 109.5, 104, 105], [105, 106, 100, 101]]);
  const s = ok(runPine(strat('default_qty_type=strategy.fixed, default_qty_value=1', `if bar_index == 1\n    strategy.entry("L", strategy.long)\nstrategy.exit("T", "L", trail_points=300, trail_offset=300)`), d));
  // trail activates at 103 on bar 3 (peak 110), stop = 110 - 3 = 107 -> hit on bar 4 (low 104) at 107
  assert.equal(s.trades[0].exitPrice, 107);
  const r = runPine(strat('', `if bar_index == 1\n    strategy.entry("L", strategy.long, qty=3)\nplot(strategy.position_size)\nplot(strategy.opentrades)`), d);
  assert.deepEqual(Array.from(r.plots[0].values), [0, 0, 3, 3, 3, 3]);
  assert.equal(r.strategy!.trades.at(-1)!.open, true);
});

test('equity curve matches realized + unrealized every bar', () => {
  const d = bars([[100, 101, 99, 100], [100, 101, 99, 100], [100, 111, 99, 110], [110, 121, 109, 120]]);
  const s = ok(runPine(strat('default_qty_type=strategy.fixed, default_qty_value=10', `if bar_index == 1\n    strategy.entry("L", strategy.long)`), d));
  assert.deepEqual(Array.from(s.equity), [10000, 10000, 10100, 10200]);
});

test('tester settings override capital, commission and slippage; slippage hits pnl but raw prices stay unslipped', () => {
  const d = bars([[100, 101, 99, 100], [100, 101, 99, 100], [100, 101, 99, 100], [100, 101, 99, 100], [100, 101, 99, 100]]);
  const code = strat('default_qty_type=strategy.fixed, default_qty_value=1', `if bar_index == 1\n    strategy.entry("L", strategy.long)\nif bar_index == 3\n    strategy.close("L")`);
  const s = ok(runPine(code, d, { mintick: 0.5, broker: { initialCapital: 500, commissionValue: 0, slippageTicks: 2 } }));
  const t = s.trades[0];
  assert.equal(s.initialCapital, 500);
  assert.equal(t.qty, 1);
  assert.equal(t.entryPrice, 101); assert.equal(t.exitPrice, 99);
  assert.equal(t.entryRaw, 100); assert.equal(t.exitRaw, 100);
  assert.equal(t.pnl, -2);
});
