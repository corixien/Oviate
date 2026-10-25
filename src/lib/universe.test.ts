import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UNIVERSE, MAX_SYMBOLS, DEFAULT_SCOPE, isChartScope, cleanScope, scopeSymbols, scopeFrom, scopeLabel } from './universe.ts';

const TFS = ['1m', '5m', '1h', '1d'];

test('universe: 200 unique securities', () => {
  assert.equal(UNIVERSE.length, MAX_SYMBOLS);
  assert.equal(new Set(UNIVERSE).size, MAX_SYMBOLS);
  assert.ok(UNIVERSE.every((s) => /^[A-Z]{1,5}$/.test(s)));
});

test('universe: strong, mid and weak performer follow each other', () => {
  assert.deepEqual(UNIVERSE.slice(0, 6), ['NVDA', 'JNJ', 'INTC', 'AVGO', 'PG', 'BA']);
  // any first N holds all three kinds: the 9 first contain big winners and big laggards
  const first = UNIVERSE.slice(0, 30);
  assert.ok(first.includes('AAPL') && first.includes('PFE') && first.includes('KO'));
});

test('scope: defaults to the chart, symbols and start of history', () => {
  assert.ok(isChartScope(DEFAULT_SCOPE));
  assert.deepEqual(scopeSymbols(DEFAULT_SCOPE, 'BTC/USD'), ['BTC/USD']);
  assert.deepEqual(scopeSymbols({ years: 0, count: 3, tf: 'chart' }, 'X'), UNIVERSE.slice(0, 3));
  assert.equal(scopeSymbols({ years: 0, count: 999, tf: 'chart' }, 'X').length, MAX_SYMBOLS);
  const now = 2_000_000_000;
  assert.equal(scopeFrom({ ...DEFAULT_SCOPE, years: 10 }, now, 5), now - Math.round(10 * 365.25 * 86400));
  assert.equal(scopeFrom(DEFAULT_SCOPE, now, 1_700_000_000), 1_700_000_000, 'Chart = the first bar the chart has');
  assert.ok(scopeFrom(DEFAULT_SCOPE, now, 0) < now, 'chart without data falls back to 10 years');
});

test('cleanScope repairs persisted values', () => {
  assert.deepEqual(cleanScope(undefined, TFS), DEFAULT_SCOPE);
  assert.deepEqual(cleanScope({ years: -3, count: 5000, tf: '7m' as never }, TFS), { years: 0, count: MAX_SYMBOLS, tf: 'chart' });
  assert.deepEqual(cleanScope({ years: 10, count: 50, tf: '1d' }, TFS), { years: 10, count: 50, tf: '1d' });
  assert.equal(scopeLabel({ years: 10, count: 50, tf: '1d' }, 'AAPL', '5m'), '50 securities · 1D · 10 y');
  assert.equal(scopeLabel(DEFAULT_SCOPE, 'AAPL', '5m'), 'AAPL · 5M · chart history');
});
