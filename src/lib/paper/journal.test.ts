import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterTrades, defaultFilter, dayStats, monthStats, calendarGrid, summarize, shiftMonth } from './journal.ts';
import type { ClosedTrade } from './engine.ts';

const ts = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime() / 1000;
let n = 0;
const tr = (exit: number, pnl: number, o: Partial<ClosedTrade> = {}): ClosedTrade => ({
  id: 't' + ++n, symbol: 'AAPL', side: 'long', qty: 1, entryPrice: 1, exitPrice: 1, entryTime: exit - 3600, exitTime: exit, pnl, commission: 1, source: 'manual', reason: 'x', ...o,
});
const trades = [tr(ts(2026, 10, 1), 50), tr(ts(2026, 10, 1, 15), -20, { symbol: 'TSLA', side: 'short' }), tr(ts(2026, 10, 5), -30), tr(ts(2026, 9, 30), 10, { source: 'strat' })];

test('filter sorts newest first and filters', () => {
  const now = ts(2026, 10, 6);
  const all = filterTrades(trades, defaultFilter(), now);
  assert.deepEqual(all.map((t) => t.exitTime), [...all.map((t) => t.exitTime)].sort((a, b) => b - a));
  assert.equal(filterTrades(trades, { ...defaultFilter(), result: 'loss' }, now).length, 2);
  assert.equal(filterTrades(trades, { ...defaultFilter(), symbol: 'TSLA' }, now).length, 1);
  assert.equal(filterTrades(trades, { ...defaultFilter(), side: 'short' }, now).length, 1);
  assert.equal(filterTrades(trades, { ...defaultFilter(), source: 'strat' }, now).length, 1);
  assert.equal(filterTrades(trades, { ...defaultFilter(), range: 'month' }, now).length, 3);
  assert.equal(filterTrades(trades, { ...defaultFilter(), range: '7d' }, now).length, 4);
  assert.equal(filterTrades(trades, { ...defaultFilter(), day: '2026-10-01' }, now).length, 2);
});

test('day and month roll-ups', () => {
  const days = dayStats(trades);
  assert.equal(days.get('2026-10-01')!.pnl, 30);
  const months = monthStats(days);
  assert.deepEqual(months.map((m) => m.month), ['2026-10', '2026-09']);
  assert.equal(months[0].pnl, 0);
  assert.equal(months[0].greenDays, 1); assert.equal(months[0].redDays, 1);
});

test('calendar grid', () => {
  const g = calendarGrid('2026-10', dayStats(trades));
  assert.equal(g.length, 5);
  assert.ok(g.every((w) => w.cells.length === 7));
  assert.equal(g.flatMap((w) => w.cells).filter(Boolean).length, 31);
  assert.equal(g[0].cells[3]?.day, 1); // 1 Oct 2026 is a Thursday
  assert.equal(g[0].pnl, 30);
  assert.equal(shiftMonth('2026-12', 1), '2027-01'); assert.equal(shiftMonth('2026-01', -1), '2025-12');
});

test('summary', () => {
  const s = summarize(trades);
  assert.equal(s.trades, 4); assert.equal(s.net, 10); assert.equal(s.winRate, 50);
  assert.equal(s.profitFactor, 60 / 50); assert.equal(s.lossStreak, 2); assert.equal(s.best, 50);
  assert.equal(summarize([]).trades, 0);
});
