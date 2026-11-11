import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectDrawings, planSecrets, planScripts, hashCode, freeName, type LocalScript, type RemoteScript } from './sync.ts';

const L = (name: string, code: string, modified = 100, pub = false): LocalScript => ({ name, code, modified, public: pub });
const R = (name: string, code: string, updatedAt = 100000, pub = false): RemoteScript => ({ name, code, public: pub, updatedAt });
const seenOf = (code: string, pub = false) => ({ hash: hashCode(code), public: pub });

test('new scripts travel to the other side', () => {
  assert.deepEqual(planScripts([L('a', 'x')], [], {}).map((a) => a.op), ['push']);
  assert.deepEqual(planScripts([], [R('a', 'x')], {}).map((a) => a.op), ['pull']);
});

test('identical scripts are only marked as synced', () => {
  assert.deepEqual(planScripts([L('a', 'x')], [R('a', 'x')], {}), [{ op: 'mark', name: 'a', hash: hashCode('x'), public: false }]);
  assert.deepEqual(planScripts([L('a', 'x')], [R('a', 'x')], { a: seenOf('x') }), []);
});

test('the side that did not change takes the other side', () => {
  const seen = { a: seenOf('v1') };
  assert.equal(planScripts([L('a', 'v1')], [R('a', 'v2')], seen)[0].op, 'pull');
  assert.equal(planScripts([L('a', 'v2')], [R('a', 'v1')], seen)[0].op, 'push');
});

test('publishing alone is a change', () => {
  const seen = { a: seenOf('v1', false) };
  assert.deepEqual(planScripts([L('a', 'v1', 100, true)], [R('a', 'v1', 1, false)], seen), [{ op: 'push', name: 'a', code: 'v1', public: true }]);
});

test('both changed: the newer edit wins', () => {
  const seen = { a: seenOf('v0') };
  assert.equal(planScripts([L('a', 'v1', 200)], [R('a', 'v2', 100000)], seen)[0].op, 'push');
  assert.equal(planScripts([L('a', 'v1', 50)], [R('a', 'v2', 100000)], seen)[0].op, 'pull');
});

test('deletions follow, unless the script was edited on the other side', () => {
  const seen = { a: seenOf('v1') };
  assert.equal(planScripts([L('a', 'v1')], [], seen)[0].op, 'delLocal', 'deleted remotely');
  assert.equal(planScripts([], [R('a', 'v1')], seen)[0].op, 'delRemote', 'deleted locally');
  assert.equal(planScripts([L('a', 'v2')], [], seen)[0].op, 'push', 'edited locally after the remote delete: keep it');
  assert.equal(planScripts([], [R('a', 'v2')], seen)[0].op, 'pull', 'edited remotely after the local delete: keep it');
});

test('free names, newest side', () => {
  assert.equal(freeName('RSI', ['MACD']), 'RSI');
  assert.equal(freeName('RSI', ['RSI'], 'Ann'), 'RSI (Ann)');
  assert.equal(freeName('RSI', ['RSI', 'RSI (Ann)'], 'Ann'), 'RSI (Ann) 2');
});

test('API keys: copied both ways, removals follow, own value wins a conflict', () => {
  const h = hashCode;
  assert.deepEqual(planSecrets({ a: '1' }, {}, {}).push, ['a'], 'new key goes to the account');
  assert.deepEqual(planSecrets({}, { a: '1' }, {}).setLocal, ['a'], 'new key comes to this device');
  assert.deepEqual(planSecrets({ a: '1' }, { a: '1' }, {}).seen, { a: h('1') });
  assert.deepEqual(planSecrets({ a: '1' }, { a: '2' }, { a: h('1') }).setLocal, ['a'], 'changed elsewhere');
  assert.deepEqual(planSecrets({ a: '2' }, { a: '1' }, { a: h('1') }).push, ['a'], 'changed here');
  assert.deepEqual(planSecrets({ a: '2' }, { a: '3' }, { a: h('1') }).push, ['a'], 'both changed: this device wins');
  assert.deepEqual(planSecrets({}, { a: '1' }, { a: h('1') }).delRemote, ['a'], 'removed here');
  assert.deepEqual(planSecrets({ a: '1' }, {}, { a: h('1') }).delLocal, ['a'], 'removed elsewhere');
  assert.deepEqual(planSecrets({ a: '2' }, {}, { a: h('1') }).push, ['a'], 'edited here after the remote removal: keep it');
});

test('drawings belong to symbols, not to chart slots', () => {
  const d = (id: string, sym = 'AAPL') => ({ id, sym });
  assert.deepEqual(collectDrawings({ charts: [{ drawings: [d('a'), d('b')] }, { drawings: [d('b'), d('c', 'MSFT')] }] }).map((x) => x.id), ['a', 'b', 'c'], 'old saves: union over the slots');
  assert.deepEqual(collectDrawings({ drawings: [d('x')], charts: [{ drawings: [d('old')] }] }).map((x) => x.id), ['x'], 'new saves: the list');
  assert.deepEqual(collectDrawings({}), []);
});

import { mergeSettings, mergePaper, list3, set3 } from './sync.ts';
const D = (id: string, v = 0) => ({ id, v });
test('first sync (no base) keeps what only exists on this device, the account wins the rest', () => {
  const m = mergeSettings(undefined,
    { drawings: [D('1'), D('2', 1)], watchlists: [{ id: 'default', name: 'Main', symbols: ['AAPL', 'TSLA'] }, { id: 'mine', name: 'M', symbols: ['X'] }], tz: 'system' },
    { drawings: [D('2', 5), D('3')], watchlists: [{ id: 'default', name: 'Main', symbols: ['MSFT', 'AAPL'] }], tz: 'Europe/Berlin' });
  assert.deepEqual(m.drawings.map((x: any) => x.id + ':' + x.v), ['2:5', '3:0', '1:0']);
  assert.deepEqual(m.watchlists.map((w: any) => w.id + ':' + w.symbols.join()), ['default:MSFT,AAPL,TSLA', 'mine:X']);
  assert.equal(m.tz, 'Europe/Berlin');
});
test('drawn on the PC, nothing changed on the phone since the last sync: the drawing stays', () => {
  const base = { drawings: [D('1')], theme: 'dark' };
  const phone = { drawings: [D('1')], theme: 'dark' }, pc = { drawings: [D('1'), D('2')], theme: 'dark' };
  assert.deepEqual(mergeSettings(base, phone, pc).drawings.map((x: any) => x.id), ['1', '2']);
  assert.deepEqual(mergeSettings(base, pc, phone).drawings.map((x: any) => x.id), ['1', '2']);
});
test('different things changed: both are kept; the same thing: the account wins; deletions follow', () => {
  const base = { drawings: [D('1'), D('2')], theme: 'dark', tz: 'system' };
  const local = { drawings: [D('1', 9), D('3')], theme: 'light', tz: 'system' }; // edited 1, deleted 2, added 3, theme
  const remote = { drawings: [D('1', 7), D('2')], theme: 'dark', tz: 'UTC' }; // edited 1 too, tz
  const m = mergeSettings(base, local, remote);
  assert.deepEqual(m.drawings.map((x: any) => x.id + ':' + x.v), ['1:7', '3:0']);
  assert.equal(m.theme, 'light'); assert.equal(m.tz, 'UTC');
});
test('removed on the other device and untouched here: removed; changed here: the removal wins only when untouched', () => {
  assert.deepEqual(list3([D('1')], [D('1')], []), []);
  assert.deepEqual(list3([D('1')], [], [D('1', 4)]), [D('1', 4)]);
  assert.deepEqual(list3([D('1')], [], [D('1')]), []);
});
test('watchlist symbols merge as a set', () => {
  assert.deepEqual(set3(['A', 'B'], ['A', 'B', 'C'], ['B', 'D']), ['B', 'D', 'C']);
  assert.deepEqual(set3(['A', 'B'], ['A'], ['A', 'B', 'D']), ['A', 'D']);
});
test('paper accounts merge per account', () => {
  const m = mergePaper({ accounts: [D('a'), D('b')], activeId: 'a' }, { accounts: [D('a', 1), D('b'), D('c')], activeId: 'c' }, { accounts: [D('a'), D('b', 2)], activeId: 'a' });
  assert.deepEqual(m.accounts.map((x: any) => x.id + ':' + x.v), ['a:1', 'b:2', 'c:0']);
  assert.equal(m.activeId, 'c');
});

import { unionCapped, mergeNews } from './sync.ts';
test('unionCapped unions and drops the oldest beyond the limit', () => {
  assert.deepEqual(Object.keys(unionCapped({ a: 1, b: 2 }, { b: 9, c: 3 }, 2)), ['b', 'c']);
});
test('mergeNews dedupes, sorts newest first, drops old and malformed items', () => {
  const n = (id: string, ts: number, url = 'https://x.y') => ({ id, ts, url, headline: id });
  const out = mergeNews([n('a', 10), n('b', 30)], [n('b', 30), n('c', 20), n('old', 1), n('bad', 25, 'javascript:1'), { id: 5 }], 5, 10);
  assert.deepEqual(out.map((x) => x.id), ['b', 'c', 'a']);
});
