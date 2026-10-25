import { test } from 'node:test';
import assert from 'node:assert/strict';
import { History } from './history.ts';

test('back and forward only after a step', () => {
  const h = new History(); let v = 0;
  assert.equal(h.forward(), false); assert.equal(h.back(), false);
  h.push({ undo: () => (v = 0), redo: () => (v = 1) }); v = 1;
  assert.equal(h.forward(), false);
  assert.equal(h.back(), true); assert.equal(v, 0);
  assert.equal(h.forward(), true); assert.equal(v, 1);
});

test('a new action drops the forward branch', () => {
  const h = new History(); const log: string[] = [];
  h.push({ undo: () => log.push('u1'), redo: () => log.push('r1') });
  h.back();
  h.push({ undo: () => log.push('u2'), redo: () => log.push('r2') });
  assert.equal(h.forward(), false);
});

test('same-key pushes in quick succession merge', () => {
  const h = new History(); let v = 0;
  h.push({ key: 'd', undo: () => (v = 0), redo: () => (v = 1) }, 1000);
  h.push({ key: 'd', undo: () => (v = 1), redo: () => (v = 2) }, 1100);
  h.push({ key: 'd', undo: () => (v = 2), redo: () => (v = 3) }, 1200);
  h.back(); assert.equal(v, 0);
  assert.equal(h.back(), false);
  h.forward(); assert.equal(v, 3);
  h.push({ key: 'd', undo: () => (v = 3), redo: () => (v = 4) }, 5000); // too late: separate step
  h.back(); assert.equal(v, 3);
});
