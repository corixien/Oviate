import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newAccount, placeOrder, processOrders, closePosition, equity, buyingPower, resolveQty, positionOf, cancelOrder, accountStats, floorQty } from './engine.ts';
import type { Account } from './engine.ts';

const mk = (over: Partial<{ initialCapital: number; leverage: number; commissionPct: number }> = {}): Account => {
  const a = newAccount({ id: 'a', name: 'Test', initialCapital: 10000, leverage: 1, commissionPct: 0, now: 0, ...over });
  a.lastPrices['AAPL'] = 100;
  return a;
};

test('market buy fills at the last price and opens a position', () => {
  const a = mk();
  const { order, error } = placeOrder(a, { symbol: 'AAPL', side: 'buy', type: 'market', qty: 10 }, 1);
  assert.equal(error, undefined);
  assert.equal(order.status, 'filled'); assert.equal(order.fillPrice, 100);
  assert.deepEqual(positionOf(a, 'AAPL')?.qty, 10);
  processOrders(a, 'AAPL', { last: 110, t: 2 });
  assert.equal(equity(a), 10100);
});

test('closing realizes P&L, records a trade, and commission is charged per fill', () => {
  const a = mk({ commissionPct: 0.1 });
  placeOrder(a, { symbol: 'AAPL', side: 'buy', type: 'market', qty: 10 }, 1);
  processOrders(a, 'AAPL', { last: 120, t: 2 });
  closePosition(a, 'AAPL', 3);
  assert.equal(positionOf(a, 'AAPL'), undefined);
  assert.equal(a.trades.length, 1);
  const t = a.trades[0];
  assert.equal(t.side, 'long'); assert.equal(t.entryPrice, 100); assert.equal(t.exitPrice, 120);
  // commission: 0.1% of 1000 + 0.1% of 1200 = 1 + 1.2
  assert.ok(Math.abs(a.balance - (10000 + 200 - 2.2)) < 1e-9, String(a.balance));
});

test('limit buy waits until price touches the limit, fills at the better price', () => {
  const a = mk();
  const { order } = placeOrder(a, { symbol: 'AAPL', side: 'buy', type: 'limit', qty: 5, limit: 95 }, 1);
  assert.equal(order.status, 'open');
  processOrders(a, 'AAPL', { last: 98, t: 2 });
  assert.equal(order.status, 'open');
  processOrders(a, 'AAPL', { last: 97, low: 94, t: 3 });
  assert.equal(order.status, 'filled'); assert.equal(order.fillPrice, 95);
});

test('stop sell triggers on the way down; stop-limit needs both conditions', () => {
  const a = mk();
  placeOrder(a, { symbol: 'AAPL', side: 'buy', type: 'market', qty: 10 }, 1);
  const stop = placeOrder(a, { symbol: 'AAPL', side: 'sell', type: 'stop', qty: 10, stop: 95, reduceOnly: true }, 2).order;
  processOrders(a, 'AAPL', { last: 97, t: 3 });
  assert.equal(stop.status, 'open');
  processOrders(a, 'AAPL', { last: 94, t: 4 });
  assert.equal(stop.status, 'filled'); assert.equal(stop.fillPrice, 94);
  const b = mk();
  placeOrder(b, { symbol: 'AAPL', side: 'buy', type: 'market', qty: 10 }, 1);
  const sl = placeOrder(b, { symbol: 'AAPL', side: 'sell', type: 'stop_limit', qty: 10, stop: 95, limit: 94 }, 2).order;
  processOrders(b, 'AAPL', { last: 93, t: 3 });
  assert.equal(sl.triggered, true);
  assert.equal(sl.status, 'open', 'price is below the limit: a sell limit at 94 must wait for 94 or better');
  processOrders(b, 'AAPL', { last: 94.5, t: 4 });
  assert.equal(sl.status, 'filled'); assert.equal(sl.fillPrice, 94);
});

test('trailing stop follows the price up and triggers on the pullback', () => {
  const a = mk();
  placeOrder(a, { symbol: 'AAPL', side: 'buy', type: 'market', qty: 10 }, 1);
  const tr = placeOrder(a, { symbol: 'AAPL', side: 'sell', type: 'trailing_stop', qty: 10, trailAmount: 5, reduceOnly: true }, 2).order;
  processOrders(a, 'AAPL', { last: 110, t: 3 });
  processOrders(a, 'AAPL', { last: 106, t: 4 });
  assert.equal(tr.status, 'open'); assert.equal(tr.trailRef, 110);
  processOrders(a, 'AAPL', { last: 104, t: 5 });
  assert.equal(tr.status, 'filled'); assert.equal(tr.fillPrice, 104);
  assert.equal(a.trades[0].pnl, 40);
});

test('bracket entry creates an OCO take profit / stop loss pair', () => {
  const a = mk();
  const { order } = placeOrder(a, { symbol: 'AAPL', side: 'buy', type: 'market', qty: 10, bracket: { takeProfit: 110, stopLoss: 95 } }, 1);
  assert.equal(order.status, 'filled');
  const kids = a.orders.filter((o) => o.oco);
  assert.equal(kids.length, 2);
  processOrders(a, 'AAPL', { last: 111, high: 112, t: 2 });
  assert.equal(a.orders.filter((o) => o.status === 'filled').length, 2);
  assert.equal(a.orders.filter((o) => o.oco && o.status === 'cancelled').length, 1, 'stop loss cancelled by OCO');
  assert.equal(positionOf(a, 'AAPL'), undefined);
  assert.equal(a.trades[0].reason, 'limit');
});

test('selling more than held flips into a short position', () => {
  const a = mk();
  placeOrder(a, { symbol: 'AAPL', side: 'buy', type: 'market', qty: 10 }, 1);
  placeOrder(a, { symbol: 'AAPL', side: 'sell', type: 'market', qty: 25 }, 2);
  assert.equal(positionOf(a, 'AAPL')?.qty, -15);
  processOrders(a, 'AAPL', { last: 90, t: 3 });
  assert.equal(equity(a), 10000 + 15 * 10);
});

test('buying power, leverage and rejections', () => {
  const a = mk({ leverage: 2 });
  assert.equal(buyingPower(a), 20000);
  const big = placeOrder(a, { symbol: 'AAPL', side: 'buy', type: 'market', qty: 250 }, 1);
  assert.equal(big.order.status, 'rejected'); assert.ok(big.error?.includes('buying power'));
  const ok = placeOrder(a, { symbol: 'AAPL', side: 'buy', type: 'market', qty: 200 }, 2);
  assert.equal(ok.order.status, 'filled');
  assert.equal(buyingPower(a), 0);
  const noPrice = placeOrder(mk(), { symbol: 'XYZ', side: 'buy', type: 'market', qty: 1 }, 1);
  assert.equal(noPrice.order.status, 'rejected');
});

test('quantity modes round down to the tradable step', () => {
  const a = mk();
  assert.equal(resolveQty(a, 'AAPL', 'units', 7.9, 100), 7);
  assert.equal(resolveQty(a, 'AAPL', 'cash', 950, 100), 9);
  assert.equal(resolveQty(a, 'AAPL', 'percent', 25, 100), 25);
  assert.equal(resolveQty(a, 'AAPL', 'percent', 33, 100), 33);
  assert.equal(resolveQty(a, 'BTC/USD', 'cash', 1000, 30000), 0.033333);
  assert.equal(floorQty(0.0000019, 'BTC/USD'), 0.000001);
  assert.equal(resolveQty(mk({ leverage: 5 }), 'AAPL', 'percent', 100, 100), 500);
});

test('day orders expire, cancel works, statistics add up', () => {
  const a = mk();
  const d = placeOrder(a, { symbol: 'AAPL', side: 'buy', type: 'limit', qty: 1, limit: 50, tif: 'day' }, 1000).order;
  processOrders(a, 'AAPL', { last: 100, t: 90000 });
  assert.equal(d.status, 'cancelled');
  const c = placeOrder(a, { symbol: 'AAPL', side: 'buy', type: 'limit', qty: 1, limit: 50 }, 1).order;
  cancelOrder(a, c.id);
  assert.equal(c.status, 'cancelled');
  placeOrder(a, { symbol: 'AAPL', side: 'buy', type: 'market', qty: 10 }, 2);
  processOrders(a, 'AAPL', { last: 110, t: 3 }); closePosition(a, 'AAPL', 4);
  placeOrder(a, { symbol: 'AAPL', side: 'buy', type: 'market', qty: 10 }, 5);
  processOrders(a, 'AAPL', { last: 105, t: 6 }); closePosition(a, 'AAPL', 7);
  const s = accountStats(a);
  assert.equal(s.trades, 2); assert.equal(s.wins, 1); assert.equal(s.losses, 1);
  assert.equal(s.netProfit, 50); assert.equal(s.grossProfit, 100); assert.equal(s.grossLoss, 50); assert.equal(s.profitFactor, 2);
  assert.equal(s.winRate, 50);
});
