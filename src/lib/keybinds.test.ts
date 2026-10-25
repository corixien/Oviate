import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comboOf, combosOf, bindingOf, hasCombo, assign } from './keybinds.ts';

const ev = (key: string, m: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...m });

test('combo names', () => {
  assert.equal(comboOf(ev('z', { ctrlKey: true })), 'Ctrl+Z');
  assert.equal(comboOf(ev('Z', { ctrlKey: true, shiftKey: true })), 'Ctrl+Shift+Z');
  assert.equal(comboOf(ev('+', { ctrlKey: true, shiftKey: true })), 'Ctrl++');
  assert.equal(comboOf(ev('ArrowLeft', { shiftKey: true })), 'Shift+ArrowLeft');
  assert.equal(comboOf(ev(' ')), 'Space');
  assert.equal(comboOf(ev('Shift', { shiftKey: true })), null);
  assert.equal(comboOf(ev('r', { altKey: true })), 'Alt+R');
});

test('defaults and overrides', () => {
  assert.deepEqual(combosOf(bindingOf('app.forward', {})), ['Ctrl+Shift+Z', 'Ctrl+Y']);
  assert.equal(hasCombo('app.back', 'Ctrl+Z', {}), true);
  assert.equal(hasCombo('app.back', 'Ctrl+Z', { 'app.back': 'Ctrl+B' }), false);
  assert.equal(hasCombo('app.back', 'Ctrl+Z', { 'app.back': '' }), false);
});

test('assign takes the combo from the other action', () => {
  const { next, lost } = assign({}, 'chart.reset', 'Ctrl+Z');
  assert.deepEqual(lost, ['app.back']);
  assert.equal(hasCombo('app.back', 'Ctrl+Z', next), false);
  assert.equal(hasCombo('chart.reset', 'Ctrl+Z', next), true);
  const two = assign({}, 'app.back', 'Ctrl+Y');
  assert.equal(bindingOf('app.forward', two.next), 'Ctrl+Shift+Z');
});
