import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractCode, genIndicator, genCondition, sanity, pickExamples } from './ai.ts';
import { indOperand } from './model.ts';

const seq = (...replies: string[]) => { let i = 0; const seen: string[][] = []; return { fn: async (m: { content: string }[]) => { seen.push(m.map((x) => x.content)); return replies[Math.min(i++, replies.length - 1)]; }, seen }; };

test('extractCode strips fences and chatter', () => {
  assert.equal(extractCode('Here:\n```pine\nplot(close)\n```\nbye'), 'plot(close)');
  assert.equal(extractCode('plot(close)'), 'plot(close)');
});

const good = '//@version=6\nindicator("T", overlay=false)\nlen = input.int(14, "Length")\nplot(ta.rsi(close, len), "RSI")';

test('indicator: plan first, then code; broken code is repaired with the error fed back', async () => {
  const m = seq('- RSI of close, length 14', '```pine\n//@version=6\nindicator("T")\nplot(\n```', '```pine\n' + good + '\n```');
  assert.equal(await genIndicator('rsi', m.fn), good);
  assert.equal(m.seen.length, 3);
  assert.match(m.seen[1][1], /Spec from the analyst/);
  assert.match(m.seen[2][m.seen[2].length - 1], /fails/);
});

test('indicator: works when the plan call fails; strategy declaration and endless failures are rejected', async () => {
  let n = 0;
  const flaky = async () => { if (n++ === 0) throw new Error('rate limit'); return good; };
  assert.equal(await genIndicator('rsi', flaky), good);
  await assert.rejects(genIndicator('x', seq('plan', '//@version=6\nstrategy("s")').fn), /could not produce/);
  await assert.rejects(genIndicator('  ', seq('').fn), /Describe/);
});

test('sanity: flags na, flat, mixed-scale and off-price output; accepts good code', () => {
  assert.equal(sanity(good), null);
  assert.match(sanity('//@version=6\nindicator("a")\nplot(close[1000], "x")')!, /always na/);
  assert.match(sanity('//@version=6\nindicator("a")\nplot(5, "x")')!, /flat/);
  assert.match(sanity('//@version=6\nindicator("a", overlay=false)\nplot((close - ta.sma(close, 20)) / close, "mom")\nplot(close, "price")')!, /Scale mismatch/);
  assert.match(sanity('//@version=6\nindicator("a", overlay=true)\nplot(close - ta.sma(close, 20), "mom")')!, /not on the price scale/);
  assert.equal(sanity('//@version=6\nindicator("a", overlay=true)\nplot(ta.sma(close, 20), "m")'), null);
});

test('pickExamples ranks by request words and falls back to macd and bb', () => {
  const all = [{ name: 'rsi', title: 'Relative Strength Index', code: 'x' }, { name: 'macd', title: 'MACD', code: 'x' }, { name: 'bb', title: 'Bollinger', code: 'x' }, { name: 'obv', title: 'On Balance Volume', code: 'x' }];
  assert.equal(pickExamples('an rsi with smoothing', all)[0].name, 'rsi');
  assert.deepEqual(pickExamples('something unrelated zzz', all).map((e) => e.name), ['macd', 'bb']);
});

test('condition: placeholders compile; unknown function is repaired', async () => {
  const m = seq('IND0 > nope(close)', 'e = ta.ema(close, 50)\nta.crossover(IND0, 30) and close > e');
  const code = await genCondition(indOperand('rsi'), 'RSI crosses 30 with price above EMA 50', m.fn);
  assert.match(code, /ta\.crossover\(IND0, 30\)/);
  assert.equal(m.seen.length, 2);
  assert.match(m.seen[0][1], /IND0 = RSI/);
});
