import { test } from 'node:test';
import assert from 'node:assert/strict';
import { knownCurrencies, regionMatches } from './regions.ts';

test('known symbols map to calendar currencies', () => {
  assert.deepEqual(knownCurrencies('TSLA'), ['USD']);
  assert.deepEqual(knownCurrencies('ASML'), ['EUR', 'USD']);
  assert.deepEqual(knownCurrencies('SHOP'), ['CAD', 'USD']);
  assert.deepEqual(knownCurrencies('EUR/USD'), ['EUR', 'USD']);
  assert.deepEqual(knownCurrencies('GBPJPY=X'), ['GBP', 'JPY']);
  assert.deepEqual(knownCurrencies('BTC/USD'), ['USD']);
  assert.deepEqual(knownCurrencies('SAP.DE'), ['EUR', 'USD']);
  assert.deepEqual(knownCurrencies('^FTSE'), ['GBP']);
  assert.equal(knownCurrencies('ZZZZQ'), null);
});

test('region matching keeps "All" events and drops foreign currencies', () => {
  assert.ok(regionMatches('USD', ['USD'])); assert.ok(regionMatches('All', ['USD']));
  assert.ok(!regionMatches('GBP', ['USD'])); assert.ok(regionMatches('GBP', ['GBP', 'USD']));
});
