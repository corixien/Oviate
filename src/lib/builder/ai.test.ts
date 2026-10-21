import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractCode, genIndicator, genCondition } from './ai.ts';
import { indOperand } from './model.ts';

const seq = (...replies: string[]) => { let i = 0; const seen: string[][] = []; return { fn: async (m: { content: string }[]) => { seen.push(m.map((x) => x.content)); return replies[Math.min(i++, replies.length - 1)]; }, seen }; };

test('extractCode strips fences and chatter', () => {
  assert.equal(extractCode('Here:\n```pine\nplot(close)\n```\nbye'), 'plot(close)');
  assert.equal(extractCode('plot(close)'), 'plot(close)');
});

test('indicator: valid reply passes; broken reply is repaired with the error fed back', async () => {
  const good = '//@version=5\nindicator("T", overlay=false)\nlen = input.int(14, "Length")\nplot(ta.rsi(close, len), "RSI")';
  const m = seq('```pine\n//@version=5\nindicator("T")\nplot(\n```', '```pine\n' + good + '\n```');
  assert.equal(await genIndicator('rsi', m.fn), good);
  assert.equal(m.seen.length, 2);
  assert.match(m.seen[1][m.seen[1].length - 1], /fails/);
});

test('indicator: strategy declaration and endless failures are rejected', async () => {
  await assert.rejects(genIndicator('x', seq('//@version=5\nstrategy("s")').fn), /could not produce/);
  await assert.rejects(genIndicator('  ', seq('').fn), /Describe/);
});

test('condition: placeholders compile; unknown function is repaired', async () => {
  const m = seq('IND0 > nope(close)', 'e = ta.ema(close, 50)\nta.crossover(IND0, 30) and close > e');
  const code = await genCondition(indOperand('rsi'), 'RSI crosses 30 with price above EMA 50', m.fn);
  assert.match(code, /ta\.crossover\(IND0, 30\)/);
  assert.equal(m.seen.length, 2);
  assert.match(m.seen[0][1], /IND0 = RSI/);
});
