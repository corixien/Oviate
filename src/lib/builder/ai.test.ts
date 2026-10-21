import { test } from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { extractCode, genIndicator, genCondition, sanity, pickExamples } from './ai.ts';
import { indOperand } from './model.ts';

const seq = (...replies: string[]) => { let i = 0; const seen: string[][] = []; return { fn: async (m: { content: string }[]) => { seen.push(m.map((x) => x.content)); return replies[Math.min(i++, replies.length - 1)]; }, seen }; };

test('extractCode strips fences and chatter', () => {
  assert.equal(extractCode('Here:\n```pine\nplot(close)\n```\nbye'), 'plot(close)');
  assert.equal(extractCode('plot(close)'), 'plot(close)');
});

const good = '//@version=6\nindicator("T", overlay=false)\nlen = input.int(14, "Length")\nplot(ta.rsi(close, len), "RSI")';

test('indicator: one call when the code is fine; broken code is repaired with the error fed back', async () => {
  const one = seq('```pine\n' + good + '\n```');
  assert.equal(await genIndicator('rsi', one.fn), good);
  assert.equal(one.seen.length, 1);
  const m = seq('```pine\n//@version=6\nindicator("T")\nplot(\n```', '```pine\n' + good + '\n```');
  assert.equal(await genIndicator('rsi', m.fn), good);
  assert.equal(m.seen.length, 2);
  assert.match(m.seen[1][m.seen[1].length - 1], /fails/);
});

test('indicator: strategy declaration and endless failures are rejected', async () => {
  await assert.rejects(genIndicator('x', seq('//@version=6\nstrategy("s")').fn), /could not produce/);
  await assert.rejects(genIndicator('  ', seq('').fn), /Describe/);
});

test('sanity: flags na, flat, mixed-scale and off-price output; accepts good code', () => {
  assert.equal(sanity(good), null);
  assert.match(sanity('//@version=6\nindicator("a")\nplot(close[1000], "x")')!, /Every plot is na/);
  assert.match(sanity('//@version=6\nindicator("a")\nplot(5, "x")')!, /flat/);
  assert.match(sanity('//@version=6\nindicator("a", overlay=false)\nplot((close - ta.sma(close, 20)) / close, "mom")\nplot(close, "price")')!, /Scale mismatch/);
  assert.match(sanity('//@version=6\nindicator("a", overlay=true)\nplot(close - ta.sma(close, 20), "mom")')!, /not on the price scale/);
  assert.equal(sanity('//@version=6\nindicator("a")\nplot(close - ta.sma(close, 20), "m")\nplot(close > 1e9 ? 0 : na, "Squeeze", style=plot.style_circles)'), null);
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

// typical v6 output of a code model: every script must be accepted (no false alarms), the deliberately bad one rejected
const CASES: Record<string, string> = {
ttm: `//@version=6
indicator("TTM Squeeze", shorttitle="TTM", overlay=false)
length = input.int(20, "Length", minval=1)
bbMult = input.float(2.0, "BB Mult", step=0.1)
kcMult = input.float(1.5, "KC Mult", step=0.1)
[bbBasis, bbUpper, bbLower] = ta.bb(close, length, bbMult)
ma = ta.sma(close, length)
rangeMa = ta.sma(ta.tr, length)
kcUpper = ma + rangeMa * kcMult
kcLower = ma - rangeMa * kcMult
sqzOn = bbLower > kcLower and bbUpper < kcUpper
sqzOff = bbLower < kcLower and bbUpper > kcUpper
donMid = (ta.highest(high, length) + ta.lowest(low, length)) / 2
val = ta.linreg(close - math.avg(donMid, ta.sma(close, length)), length, 0)
bcolor = val > 0 ? (val > nz(val[1]) ? color.lime : color.green) : (val < nz(val[1]) ? color.red : color.maroon)
plot(val, "Momentum", color=bcolor, style=plot.style_histogram, linewidth=4)
plot(0, "Squeeze", color=sqzOn ? color.red : sqzOff ? color.green : color.gray, style=plot.style_circles, linewidth=2)`,
squeezeNa: `//@version=6
indicator("Sq", overlay=false)
v = ta.linreg(close - ta.sma(close, 20), 20, 0)
on = ta.bb(close, 20, 2.0)[1] > 1e9
plot(v, "Mom", style=plot.style_histogram)
plot(on ? 0 : na, "Squeeze", color=color.red, style=plot.style_circles)`,
vwapBands: `//@version=6
indicator("VWAP Bands", overlay=true)
mult = input.float(1.0, "Mult")
v = ta.vwap(hlc3)
sd = ta.stdev(close, 20)
plot(v, "VWAP", color=color.orange)
plot(v + sd * mult, "Upper", color=color.aqua)
plot(v - sd * mult, "Lower", color=color.aqua)`,
rsiDiv: `//@version=6
indicator("RSI Smooth", overlay=false)
len = input.int(14, "Length", minval=1)
sm = input.int(5, "Smooth", minval=1)
r = ta.rsi(close, len)
s = ta.ema(r, sm)
hline(70, "OB", color=color.red)
hline(30, "OS", color=color.green)
plot(r, "RSI", color=color.purple)
plot(s, "Signal", color=color.orange)
bgcolor(r > 70 ? color.new(color.red, 85) : r < 30 ? color.new(color.green, 85) : na)`,
stochRsi: `//@version=6
indicator("Stoch RSI", overlay=false)
rsiLen = input.int(14, "RSI Length")
stochLen = input.int(14, "Stoch Length")
k = input.int(3, "K")
d = input.int(3, "D")
r = ta.rsi(close, rsiLen)
st = ta.stoch(r, r, r, stochLen)
kk = ta.sma(st, k)
dd = ta.sma(kk, d)
plot(kk, "K", color=color.blue)
plot(dd, "D", color=color.orange)
hline(80)
hline(20)`,
ichimoku: `//@version=6
indicator("Ichi", overlay=true)
conv = input.int(9, "Conv")
base = input.int(26, "Base")
spanB = input.int(52, "SpanB")
donchian(len) => math.avg(ta.lowest(len), ta.highest(len))
t = donchian(conv)
k = donchian(base)
a = math.avg(t, k)
b = donchian(spanB)
p1 = plot(a, "A", color=color.green, offset=base)
p2 = plot(b, "B", color=color.red, offset=base)
plot(t, "Tenkan", color=color.blue)
plot(k, "Kijun", color=color.maroon)
fill(p1, p2, color=color.new(color.gray, 85))`,
vol: `//@version=6
indicator("Rel Volume", overlay=false)
len = input.int(20, "Length")
rv = volume / ta.sma(volume, len)
col = close >= open ? color.green : color.red
plot(rv, "RVOL", style=plot.style_columns, color=col)
hline(1, "Avg")`,
st: `//@version=6
indicator("Supertrend", overlay=true)
atrLen = input.int(10, "ATR")
f = input.float(3.0, "Factor")
[line, dir] = ta.supertrend(f, atrLen)
plot(dir < 0 ? line : na, "Up", color=color.green, style=plot.style_linebr)
plot(dir > 0 ? line : na, "Down", color=color.red, style=plot.style_linebr)`,
varCase: `//@version=6
indicator("Cumulative Delta", overlay=false)
var float cum = 0.0
delta = close > open ? volume : -volume
cum := cum + delta
plot(cum, "CumDelta", color=color.aqua)
plot(ta.ema(cum, 20), "EMA", color=color.orange)`,
shape: `//@version=6
indicator("Engulf", overlay=true)
bull = close > open and close[1] < open[1] and close > open[1] and open < close[1]
bear = close < open and close[1] > open[1] and close < open[1] and open > close[1]
plotshape(bull, "Bull", style=shape.triangleup, location=location.belowbar, color=color.lime, size=size.small)
plotshape(bear, "Bear", style=shape.triangledown, location=location.abovebar, color=color.red, size=size.small)`,
v6types: `//@version=6
indicator("Typed", overlay=false)
int len = input.int(14, "Len")
float src = close
bool up = src > ta.sma(src, len)
float v = ta.rsi(src, len)
plot(v, "R", color = up ? color.green : color.red)`,
__mixedBad: `//@version=6
indicator("Bad", overlay=false)
plot(ta.rsi(close, 14), "RSI")
plot(close, "Close")`,
};

test('sanity accepts realistic v6 indicators (TTM squeeze, bands, oscillators, shapes, var state, typed vars)', () => {
  for (const [k, c] of Object.entries(CASES)) {
    if (k === '__mixedBad') assert.match(sanity(c)!, /Scale mismatch/, k);
    else assert.equal(sanity(c), null, k);
  }
});

test('sanity accepts all bundled indicators', () => {
  const dir = new URL('../../../indicators/', import.meta.url);
  const bad = readdirSync(dir).filter((f) => f.endsWith('.pine')).map((f) => [f, sanity(readFileSync(new URL(f, dir), 'utf8'))]).filter((x) => x[1]);
  assert.deepEqual(bad, []);
});

test('conditions written in words (typical model output) compile and fire on sample data', async () => {
  const cases: [ReturnType<typeof indOperand>, string, string][] = [
    [indOperand('macd'), 'MACD crosses above signal while price is above the EMA 50', 'ta.crossover(IND0, IND1) and close > ta.ema(close, 50)'],
    [indOperand('bb'), 'price closed below the lower band and the next bar is green', 'bounce = close[1] < IND2[1] and close > open\nbounce'],
    [indOperand('rsi'), 'RSI was oversold in the last 5 bars and now crosses 40', 'wasLow = ta.lowest(IND0, 5)[1] < 30\nwasLow and ta.crossover(IND0, 40)'],
    [indOperand('supertrend'), 'supertrend turns up and volume is above average', 'flip = ta.crossunder(IND1, 0)\nflip and volume > ta.sma(volume, 20)'],
    [indOperand('ema', 0, [20]), 'EMA 20 rising for 3 bars and price above it', 'ta.rising(IND0, 3) and close > IND0'],
  ];
  for (const [subj, text, reply] of cases) {
    const code = await genCondition(subj, text, seq('```\n' + reply + '\n```').fn);
    assert.equal(code, reply);
  }
});
