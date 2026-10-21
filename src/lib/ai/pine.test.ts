import { test } from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { extractCode, genIndicator, genStrategy, strategyCheck, strategyRequest, setPositionSize, sanity, pickExamples, STRATEGY_EXAMPLE_LONG, STRATEGY_EXAMPLE_BOTH, STRAT_SAMPLE } from './pine.ts';
import type { StrategyOpts } from './pine.ts';
import { runPine } from '../pine/index.ts';

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

// ---------------------------------------------------------------- strategies
const OPTS: StrategyOpts = { qtyType: 'percent_of_equity', qty: 100, sl: 2, tp: 4, direction: 'long' };

test('reference strategies of the system prompt run and trade on the sample', () => {
  const a = strategyCheck(STRATEGY_EXAMPLE_LONG, OPTS);
  assert.equal(a.error, null); assert.ok(a.trades > 3);
  const b = strategyCheck(STRATEGY_EXAMPLE_BOTH, { ...OPTS, sl: 3, tp: 0, direction: 'both' });
  assert.equal(b.error, null); assert.ok(b.trades > 3);
});

test('strategyCheck enforces what the form asked for', () => {
  assert.match(strategyCheck(STRATEGY_EXAMPLE_LONG, { ...OPTS, direction: 'short' }).error!, /SHORT ONLY/);
  assert.match(strategyCheck(STRATEGY_EXAMPLE_LONG, { ...OPTS, direction: 'both' }).error!, /BOTH/);
  assert.match(strategyCheck(STRATEGY_EXAMPLE_BOTH, { ...OPTS, direction: 'long' }).error!, /LONG ONLY/);
  const noExit = STRATEGY_EXAMPLE_LONG.replace(/if strategy\.position_size > 0\n {4}strategy\.exit[^\n]*\n/, '');
  assert.match(strategyCheck(noExit, OPTS).error!, /strategy\.exit/);
  assert.equal(strategyCheck(noExit, { ...OPTS, sl: 0, tp: 0 }).error, null);
  assert.match(strategyCheck('//@version=6\nindicator("x")\nplot(close)', OPTS).error!, /must declare strategy/);
  assert.match(strategyCheck('//@version=6\nstrategy("x")\nif close > 1e9\n    strategy.entry("L", strategy.long)', { ...OPTS, sl: 0, tp: 0 }).error!, /never trades/);
  assert.match(strategyCheck('//@version=6\nstrategy("x")\nplot(close)', { ...OPTS, sl: 0, tp: 0 }).error!, /strategy\.entry/);
  assert.match(strategyCheck('//@version=6\nstrategy("x"\nplot(', OPTS).error!, /./);
});

test('position size from the form is forced into strategy(), whatever the model wrote', () => {
  const messy = '//@version=6\nstrategy(\n    "T (x)", overlay=true,\n    default_qty_type=strategy.fixed, default_qty_value=7, pyramiding=0)\nif close > 0\n    strategy.entry("L", strategy.long)';
  const out = setPositionSize(messy, 'cash', 2500);
  assert.doesNotMatch(out, /strategy\.fixed/);
  const r = runPine(out, STRAT_SAMPLE);
  assert.equal(r.error, undefined);
  assert.equal(r.meta.title, 'T (x)');
  assert.equal(r.strategy!.config.qtyType, 'cash'); assert.equal(r.strategy!.config.qtyValue, 2500);
  assert.equal(setPositionSize('plot(close)', 'fixed', 3), 'plot(close)');
});

test('strategyRequest lists the form fields; optional ones only when set', () => {
  const full = strategyRequest('buy dips', { qtyType: 'cash', qty: 500, sl: 2, tp: 5, direction: 'both' });
  assert.match(full, /500 \(account currency\)/); assert.match(full, /Stop loss: 2%/); assert.match(full, /Take profit: 5%/); assert.match(full, /BOTH long and short/);
  const bare = strategyRequest('buy dips', { qtyType: 'fixed', qty: 3, direction: 'auto' });
  assert.match(bare, /3 units/); assert.match(bare, /Stop loss: none/); assert.match(bare, /Take profit: none/);
});

test('genStrategy: repairs a never-trading draft, forces the size, rejects empty form', async () => {
  const dead = '//@version=6\nstrategy("d", default_qty_value=3)\nif close > 1e9\n    strategy.entry("L", strategy.long)';
  const m = seq('```pine\n' + dead + '\n```', '```pine\n' + STRATEGY_EXAMPLE_LONG + '\n```');
  const code = await genStrategy('ema cross', { ...OPTS, qtyType: 'cash', qty: 1000, sl: 0, tp: 0 }, m.fn);
  assert.equal(m.seen.length, 2);
  assert.match(m.seen[1][m.seen[1].length - 1], /never trades/);
  assert.match(code, /default_qty_type=strategy\.cash, default_qty_value=1000/);
  assert.match(m.seen[0][1], /1000 \(account currency\)/);
  await assert.rejects(genStrategy('  ', OPTS, m.fn), /Describe/);
  await assert.rejects(genStrategy('x', { ...OPTS, qty: 0 }, m.fn), /position size/);
  // never trading is only a soft complaint: after the last repair round the draft is kept (the UI warns), any hard error still fails
  assert.match(await genStrategy('x', { ...OPTS, sl: 0, tp: 0 }, seq(dead).fn), /strategy\.entry/);
  await assert.rejects(genStrategy('x', { ...OPTS, sl: 0, tp: 0 }, seq('//@version=6\nstrategy("n")\nplot(close)').fn), /could not produce/);
});

test('strategy system prompt carries the engine rules the model must know', async () => {
  const m = seq('```pine\n' + STRATEGY_EXAMPLE_LONG + '\n```');
  await genStrategy('x', OPTS, m.fn);
  const sys = m.seen[0][0];
  for (const must of ['NEXT BAR', 'strategy.exit', 'position_avg_price', 'version=6', 'ONCE', 'pane=', 'Two complete reference strategies']) assert.ok(sys.includes(must), must);
});

// typical v6 strategies of a code model (flips, filters, ATR stops, trailing, time stops, typed vars, volume): all must run and trade
const STRATEGY_CASES: Record<string, [string, Partial<StrategyOpts>]> = {
supertrend: [`//@version=6
strategy("Supertrend Flip", overlay=true, initial_capital=10000, default_qty_type=strategy.percent_of_equity, default_qty_value=100, pyramiding=0)
atrLen = input.int(10, "ATR Length", minval=1)
factor = input.float(3.0, "Factor", minval=0.1, step=0.1)
[st, dir] = ta.supertrend(factor, atrLen)
flipUp = ta.crossunder(dir, 0)
flipDown = ta.crossover(dir, 0)
if flipUp
    strategy.entry("Long", strategy.long)
if flipDown
    strategy.entry("Short", strategy.short)
plot(st, "Supertrend", color = dir < 0 ? color.green : color.red, style=plot.style_linebr)`, {direction:'both'}],
macdFilter: [`//@version=6
strategy("MACD + EMA200", overlay=true, default_qty_type=strategy.percent_of_equity, default_qty_value=100)
fastLen = input.int(12, "Fast")
slowLen = input.int(26, "Slow")
sigLen = input.int(9, "Signal")
trendLen = input.int(100, "Trend EMA")
slPct = input.float(2.0, "Stop loss %")
tpPct = input.float(5.0, "Take profit %")
[macdLine, signalLine, hist] = ta.macd(close, fastLen, slowLen, sigLen)
trend = ta.ema(close, trendLen)
longSignal = ta.crossover(macdLine, signalLine) and close > trend
exitSignal = ta.crossunder(macdLine, signalLine)
if longSignal
    strategy.entry("Long", strategy.long)
if exitSignal and strategy.position_size > 0
    strategy.close("Long")
if strategy.position_size > 0
    strategy.exit("Exit", "Long", stop=strategy.position_avg_price * (1 - slPct / 100), limit=strategy.position_avg_price * (1 + tpPct / 100))
plot(trend, "Trend EMA", color=color.orange)`, {direction:'long', sl:2, tp:5}],
boll: [`//@version=6
strategy("Bollinger Mean Reversion", overlay=true, default_qty_type=strategy.cash, default_qty_value=2000)
len = input.int(20, "Length")
mult = input.float(2.0, "Mult")
[basis, upper, lower] = ta.bb(close, len, mult)
longCond = close < lower
shortCond = close > upper
exitLong = close >= basis
exitShort = close <= basis
if longCond
    strategy.entry("Long", strategy.long)
if shortCond
    strategy.entry("Short", strategy.short)
if exitLong
    strategy.close("Long")
if exitShort
    strategy.close("Short")
plot(basis, "Basis", color=color.gray)
plot(upper, "Upper", color=color.red)
plot(lower, "Lower", color=color.green)`, {direction:'both'}],
donchian: [`//@version=6
strategy("Donchian Breakout ATR", overlay=true, default_qty_type=strategy.percent_of_equity, default_qty_value=50)
entryLen = input.int(20, "Entry Length")
exitLen = input.int(10, "Exit Length")
atrLen = input.int(14, "ATR")
atrMult = input.float(2.0, "ATR stop mult")
upper = ta.highest(high, entryLen)[1]
lowerExit = ta.lowest(low, exitLen)[1]
atr = ta.atr(atrLen)
if close > upper
    strategy.entry("Long", strategy.long)
if close < lowerExit
    strategy.close("Long")
if strategy.position_size > 0
    strategy.exit("ATR stop", "Long", stop=strategy.position_avg_price - atr * atrMult)
plot(upper, "Upper", color=color.aqua)
plot(lowerExit, "Exit", color=color.orange)`, {direction:'long'}],
rsiStoch: [`//@version=6
strategy("RSI Stoch", overlay=false, default_qty_type=strategy.fixed, default_qty_value=10)
rsiLen = input.int(14, "RSI")
kLen = input.int(14, "Stoch")
rsi = ta.rsi(close, rsiLen)
k = ta.sma(ta.stoch(close, high, low, kLen), 3)
buy = rsi < 35 and ta.crossover(k, 20)
sell = rsi > 65 and ta.crossunder(k, 80)
if buy
    strategy.entry("Long", strategy.long)
if sell
    strategy.entry("Short", strategy.short)
plot(rsi, "RSI", color=color.purple)
plot(k, "%K", color=color.aqua)
hline(70)
hline(30)`, {direction:'both'}],
trail: [`//@version=6
strategy("Trailing", overlay=true, default_qty_type=strategy.percent_of_equity, default_qty_value=100)
len = input.int(30, "Len")
ma = ta.sma(close, len)
up = ta.crossover(close, ma)
if up
    strategy.entry("Long", strategy.long)
if strategy.position_size > 0
    strategy.exit("Trail", "Long", trail_points=close * 0.03 / syminfo.mintick, trail_offset=close * 0.01 / syminfo.mintick)
plot(ma, "MA", color=color.blue)`, {direction:'long'}],
timeStop: [`//@version=6
strategy("Time stop", overlay=true, default_qty_type=strategy.percent_of_equity, default_qty_value=100)
maxBars = input.int(10, "Max bars in trade")
len = input.int(20, "Len")
sig = ta.crossover(close, ta.ema(close, len))
var int entryBar = na
if sig and strategy.position_size == 0
    strategy.entry("Long", strategy.long)
    entryBar := bar_index
if strategy.position_size > 0 and bar_index - entryBar >= maxBars
    strategy.close("Long", comment="time stop")
plot(ta.ema(close, len), "EMA", color=color.aqua)`, {direction:'long'}],
toggles: [`//@version=6
strategy("Toggles", overlay=true, default_qty_type=strategy.percent_of_equity, default_qty_value=100)
enableLong = input.bool(true, "Enable long")
enableShort = input.bool(true, "Enable short")
f = ta.ema(close, 12)
s = ta.ema(close, 26)
up = ta.crossover(f, s)
dn = ta.crossunder(f, s)
if enableLong and up
    strategy.entry("Long", strategy.long)
if enableShort and dn
    strategy.entry("Short", strategy.short)
plot(f, "Fast", color=color.aqua)
plot(s, "Slow", color=color.orange)`, {direction:'both'}],
typed: [`//@version=6
strategy("Typed", overlay=true, default_qty_type=strategy.percent_of_equity, default_qty_value=100)
int len = input.int(20, "Len")
float src = close
float ma = ta.sma(src, len)
bool longOk = ta.crossover(src, ma)
bool exitOk = ta.crossunder(src, ma)
if longOk
    strategy.entry("L", strategy.long)
if exitOk
    strategy.close("L")
plot(ma, "MA")`, {direction:'long'}],
volumeFilter: [`//@version=6
strategy("Volume breakout", overlay=true, default_qty_type=strategy.percent_of_equity, default_qty_value=100)
len = input.int(20, "Len")
volMult = input.float(1.5, "Vol mult")
hh = ta.highest(high, len)[1]
volAvg = ta.sma(volume, len)
breakout = close > hh and volume > volAvg * volMult
if breakout
    strategy.entry("Long", strategy.long)
if close < ta.ema(close, len)
    strategy.close("Long")
plot(hh, "Highest", color=color.aqua)`, {direction:'long'}],
};

test('strategies: oscillators need their own pane; several panes are fine', () => {
  const base = '//@version=6\nstrategy("p", overlay=true, default_qty_type=strategy.percent_of_equity, default_qty_value=100)\nr = ta.rsi(close, 14)\n[m, s, h] = ta.macd(close, 12, 26, 9)\nif ta.crossover(r, 40)\n    strategy.entry("L", strategy.long)\nif ta.crossunder(r, 60)\n    strategy.close("L")\nplot(ta.ema(close, 20), "EMA")\n';
  const o = { qtyType: 'percent_of_equity' as const, qty: 100, sl: 0, tp: 0, direction: 'auto' as const };
  assert.match(strategyCheck(base + 'plot(r, "RSI")', o).error!, /not on the price scale/);
  assert.equal(strategyCheck(base + 'plot(r, "RSI", pane="RSI")\nplot(m, "MACD", pane="MACD")\nplot(s, "Signal", pane="MACD")', o).error, null);
  assert.match(strategyCheck(base + 'plot(r, "RSI", pane="Mix")\nplot(close, "Price", pane="Mix")', o).error!, /Pane "Mix": Scale mismatch/);
});

test('realistic model strategies run and trade on the sample', () => {
  for (const [k, [code, o]] of Object.entries(STRATEGY_CASES)) {
    const r = strategyCheck(code, { qtyType: 'percent_of_equity', qty: 100, sl: 0, tp: 0, direction: 'auto', ...o });
    assert.equal(r.error, null, k);
  }
});

// ---------------------------------------------------------------- editing
import { extractStrategyForm, editIndicator, editStrategy, setStrategyParams, hasLimitInput } from './pine.ts';

test('extractStrategyForm reads size, stop loss, take profit and directions from existing code', () => {
  const a = extractStrategyForm(STRATEGY_EXAMPLE_LONG);
  assert.deepEqual(a, { qtyType: 'percent_of_equity', qty: 100, sl: 2, tp: 4, direction: 'long' });
  const b = extractStrategyForm(STRATEGY_EXAMPLE_BOTH);
  assert.deepEqual(b, { qtyType: 'percent_of_equity', qty: 50, sl: 3, tp: 0, direction: 'both' });
  const c = extractStrategyForm('//@version=5\nstrategy("x", default_qty_type=strategy.cash, default_qty_value=2500)\nstopPct = input.float(1.5, "SL %")\nif close > open\n    strategy.entry("S", strategy.short)');
  assert.deepEqual(c, { qtyType: 'cash', qty: 2500, sl: 1.5, tp: 0, direction: 'short' });
  assert.equal(extractStrategyForm('//@version=6\nstrategy("n")').qty, 100);
});

test('editIndicator: asks for the code with the change, rejects no-ops, accepts a real edit', async () => {
  const orig = '//@version=6\nindicator("T", overlay=false)\nlen = input.int(14, "Length")\nplot(ta.rsi(close, len), "RSI")';
  const edited = '//@version=6\nindicator("T", overlay=false)\nlen = input.int(14, "Length")\nplot(ta.rsi(close, len), "RSI")\nhline(70, "OB")\nhline(30, "OS")';
  const m = seq('```pine\n' + orig + '\n```', '```pine\n' + edited + '\n```');
  assert.equal(await editIndicator(orig, 'add overbought and oversold lines', m.fn), edited);
  assert.equal(m.seen.length, 2);
  assert.match(m.seen[0][0], /EDITING an existing script/); assert.match(m.seen[0][1], /Current script:[\s\S]*ta\.rsi[\s\S]*Change wanted: add overbought/);
  assert.match(m.seen[1][m.seen[1].length - 1], /Nothing was changed/);
  await assert.rejects(editIndicator(orig, '  ', m.fn), /Describe the change/);
});

test('editStrategy: a no-op reply is rejected and repaired; the form size is forced into the result', async () => {
  const same = extractStrategyForm(STRATEGY_EXAMPLE_LONG);
  const edited = STRATEGY_EXAMPLE_LONG.replace('rsi > 50', 'rsi > 55');
  const m = seq('```pine\n' + STRATEGY_EXAMPLE_LONG + '\n```', '```pine\n' + edited + '\n```');
  assert.match(await editStrategy(STRATEGY_EXAMPLE_LONG, 'require RSI above 55', same, m.fn), /rsi > 55/);
  assert.equal(m.seen.length, 2);
  assert.match(m.seen[1][m.seen[1].length - 1], /Nothing was changed/);
  assert.match(m.seen[0][0], /EDITING an existing script/); assert.match(m.seen[0][0], /NEXT BAR/);
  const opts = { ...same, qtyType: 'cash' as const, qty: 750, sl: 3 };
  const m2 = seq('```pine\n' + edited + '\n```');
  const out = await editStrategy(STRATEGY_EXAMPLE_LONG, 'require RSI above 55', opts, m2.fn);
  assert.match(out, /default_qty_type=strategy\.cash, default_qty_value=750/);
  assert.match(m2.seen[0][1], /750 \(account currency\)/); assert.match(m2.seen[0][1], /Stop loss: 3%/);
  await assert.rejects(editStrategy(STRATEGY_EXAMPLE_LONG, 'x', { ...opts, qty: 0 }, m2.fn), /position size/);
});

test('setStrategyParams changes size and stop loss / take profit defaults without AI', () => {
  const c = setStrategyParams(STRATEGY_EXAMPLE_LONG, { qtyType: 'cash', qty: 500, sl: 3.5, tp: 0 });
  const f = extractStrategyForm(c);
  assert.equal(f.qtyType, 'cash'); assert.equal(f.qty, 500); assert.equal(f.sl, 3.5); assert.equal(f.tp, 0);
  assert.ok(hasLimitInput(c, 'sl') && hasLimitInput(c, 'tp'));
  assert.ok(!hasLimitInput('strategy("x")\nif close > open\n    strategy.entry("L", strategy.long)', 'sl'));
});
