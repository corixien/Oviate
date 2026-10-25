import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detailedStats, buyHoldCurves } from './stats.ts';
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
  // buy & hold over invested time = (1 + whole-period change) ^ (invested bars / bars) - 1
  const inv = (s.exposurePct / 100);
  assert.ok(Math.abs(s.buyHoldInvested - (Math.pow(1.1, inv) - 1) * 100) < 1e-9, String(s.buyHoldInvested));
  assert.equal(s.openPnl, 5);
  assert.equal(s.drawdown.length, eq.length);
  assert.ok(s.exposurePct > 0 && s.exposurePct <= 100);
  assert.ok(Math.abs(s.avgBars - (2 + 1 + 1 + 2) / 4) < 1e-9);
});

test('empty result is all zeros', () => {
  const s = detailedStats(res([], [1000, 1000, 1000]), { stepSec: 60, firstClose: 0, lastClose: 0 });
  assert.equal(s.trades, 0); assert.equal(s.buyHoldInvested, 0); assert.equal(s.profitFactor, 0); assert.equal(s.sharpe, 0); assert.equal(s.maxDrawdown, 0);
});

test('buy & hold curves: whole period and invested time only', () => {
  const trades = [tr('long', 2, 4, 5)];
  const closes = [100, 100, 100, 110, 120, 120, 121];
  const r = res(trades, [1000, 1000, 1000, 1000, 1000, 1000, 1000]);
  const { full, invested } = buyHoldCurves(r, closes);
  assert.equal(full.length, 7);
  assert.ok(Math.abs(full[6] - 1210) < 1e-9);
  assert.equal(invested[1], 1000);
  const s = detailedStats(r, { stepSec: 86400, firstClose: closes[0], lastClose: closes[6] });
  assert.ok(Math.abs(invested[6] - 1000 * (1 + s.buyHoldInvested / 100)) < 1e-6);
  assert.deepEqual(buyHoldCurves(res([], []), []), { full: [], invested: [] });
});

test('universeSummary: breadth, medians and pooled win rate', async () => {
  const { universeSummary } = await import('./stats.ts');
  const row = (ret: number, buyHold: number, trades: number, wins: number, maxDD: number) => ({ symbol: 'X', ret, buyHold, trades, wins, winRate: 0, profitFactor: 1, maxDD, bars: 100, years: 1 });
  const s = universeSummary([row(10, 5, 10, 6, 5), row(-4, 8, 30, 12, 20), row(2, 1, 0, 0, 0)]);
  assert.equal(s.n, 3); assert.equal(s.profitable, 2); assert.equal(s.beatBuyHold, 2);
  assert.equal(s.medianRet, 2); assert.equal(s.medianBuyHold, 5);
  assert.equal(s.trades, 40); assert.equal(s.winRate, 45);
  assert.equal(s.worstMaxDD, 20);
  assert.equal(universeSummary([]).n, 0);
});
