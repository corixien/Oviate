import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detailedStats } from './stats.ts';
import type { StrategyResult, TradeRec } from './types.ts';

const tr = (dir: 'long' | 'short', entryBar: number, exitBar: number, pnl: number, open = false): TradeRec => ({
  id: 'x', dir, qty: 1, entryBar, entryTime: 0, entryPrice: 100, exitBar, exitTime: 0, exitPrice: 100 + pnl, pnl, commission: 1, entryComment: '', exitComment: '', open, mfe: 5, mae: 2,
});
const res = (trades: TradeRec[], equity: number[]): StrategyResult => ({
  config: { qtyType: 'fixed', qtyValue: 1, pyramiding: 0, initialCapital: 1000 }, pending: [], trades, equity: Float64Array.from(equity), netProfit: 0, initialCapital: 1000, openPosition: null,
});

test('aggregates, streaks, sides and drawdown', () => {
  const trades = [tr('long', 0, 2, 50), tr('long', 3, 4, -20), tr('short', 5, 6, -10), tr('short', 7, 9, 30), tr('long', 10, -1, 5, true)];
  const eq = [1000, 1050, 1050, 1030, 1030, 1030, 1020, 1020, 1040, 1050, 1055];
  const s = detailedStats(res(trades, eq), { stepSec: 86400, firstClose: 100, lastClose: 110 });
  assert.equal(s.trades, 4);
  assert.equal(s.wins, 2); assert.equal(s.losses, 2);
  assert.equal(s.grossProfit, 80); assert.equal(s.grossLoss, 30);
  assert.equal(s.netProfit, 50);
  assert.ok(Math.abs(s.profitFactor - 80 / 30) < 1e-9);
  assert.equal(s.winRate, 50);
  assert.equal(s.maxWinStreak, 1); assert.equal(s.maxLossStreak, 2);
  assert.equal(s.long.trades, 2); assert.equal(s.long.net, 30);
  assert.equal(s.short.trades, 2); assert.equal(s.short.net, 20);
  assert.equal(s.maxDrawdown, 30);
  assert.ok(Math.abs(s.maxDrawdownPct - (30 / 1050) * 100) < 1e-9);
  assert.equal(s.buyHold, 10);
  assert.equal(s.openPnl, 5);
  assert.equal(s.drawdown.length, eq.length);
  assert.ok(s.exposurePct > 0 && s.exposurePct <= 100);
  assert.ok(Math.abs(s.avgBars - (2 + 1 + 1 + 2) / 4) < 1e-9);
});

test('empty result is all zeros', () => {
  const s = detailedStats(res([], [1000, 1000, 1000]), { stepSec: 60, firstClose: 0, lastClose: 0 });
  assert.equal(s.trades, 0); assert.equal(s.profitFactor, 0); assert.equal(s.sharpe, 0); assert.equal(s.maxDrawdown, 0);
});
