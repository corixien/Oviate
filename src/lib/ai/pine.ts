// AI code generation for Pine indicators and strategies (prompts, repair loop, run-time checks). The model call is injected,
// so this stays pure and testable; the CLI (cli/oviate.ts) reuses the same checks and rules.
import { runPine } from '../pine/index.ts';
import type { PineCandles, PineResult } from '../pine/types.ts';

export type Msg = { role: 'system' | 'user' | 'assistant'; content: string };
export type Complete = (messages: Msg[]) => Promise<string>;

export const ENGINE = `The code runs in a small Pine Script v5 interpreter. Supported: ta.sma ema wma hma vwma rma rsi macd bb atr dmi supertrend sar stoch cci mfi wpr cmo roc mom tsi kc linreg stdev highest lowest highestbars lowestbars change crossover crossunder cross rising falling barssince valuewhen pivothigh pivotlow cum tr obv vwap median percentrank; math.* (abs max min sqrt log pow round sum avg); nz, na, fixnan; if/else, for, ternary, var, user functions, arrays; series history with [n]; built-in series open high low close volume hl2 hlc3 ohlc4 bar_index time; input.int/float/bool/source/string/color; plot, hline, fill, bgcolor, barcolor, plotshape, color.*; Oviate extension: plot(..., pane="Name") and hline(..., pane="Name") draw in their own chart pane (one pane per distinct name, any number of panes). Not supported: request.security (passthrough only), drawing objects (label/line/box are not rendered), libraries, imports. Call ta.* functions on every bar at the top level of a block, never inside if or ternary branches.`;

/** Strip chat noise: markdown fences and any text around the code. */
export function extractCode(text: string): string {
  const fence = /```(?:pine|pinescript|text)?\s*\n([\s\S]*?)```/i.exec(text);
  return (fence ? fence[1] : text).trim();
}

const INDICATOR_SYSTEM = `You are an expert Pine Script developer for the Oviate charting app, writing indicators in Pine Script **Version 6**. Your goal: clean, compiler-safe, visually perfect code for the user's request. ${ENGINE}

### 1. Visual and scaling rules (critical)
- Scale protection: with overlay=false never plot absolute asset prices, channel lines (Bollinger, Keltner) or static 0/1 levels in the same pane as an unbounded oscillator or momentum histogram. That destroys the Y-axis scale.
- Compute channels and bands silently as variables. Show squeeze states, triggers and buy/sell signals as colored dots or shapes ON the oscillator's zero line, e.g. plot(0, "Squeeze", style=plot.style_circles, color=on ? color.red : color.green, linewidth=2).
- overlay=true only when every plotted line is on the price scale (moving averages, bands, stops). Everything else is overlay=false.
- Use distinct, readable colors: color.lime / color.green for bullish, color.red / color.maroon for bearish, color.aqua / color.orange / color.fuchsia for extra lines.
- Add hline() for fixed levels (0, 30/70, ...). Give every plot a clear title.

### 2. Pine v6 standards
- Start with //@version=6, then exactly one indicator("Full Title", shorttitle="Short", overlay=...) line. Never use v5-or-older-only syntax.
- Namespaces only: ta.sma, ta.ema, ta.stdev, ta.atr, ta.linreg, math.abs, ...
- Expose every important number as input.int / input.float / input.source / input.bool with a clear title and the standard default value. Use an explicit type only where inference would be ambiguous.

### 3. Trading logic accuracy
- Known indicators must use their true mathematical definition and standard parameters (example: TTM Squeeze momentum is a linear regression of the price minus the average of the Donchian midpoint and SMA, not close - close[n]; the squeeze is on when the Bollinger Bands lie inside the Keltner Channel).
- Handle history references (x[1]) and na with nz() or na checks so nothing breaks in the first bars.

### Output
Before writing, silently work out the exact formula and the value scale of every plot. Reply with ONLY the code. No explanation, no markdown outside one code block.`;

/** Words of the request, lowercased, for matching against example scripts. */
const words = (t: string) => [...new Set(t.toLowerCase().match(/[a-z0-9%]{3,}/g) ?? [])];

export interface Example { name: string; title: string; code: string }

/** Working scripts of this engine that look most like the request (few-shot style references). */
export function pickExamples(request: string, all: Example[], n = 2): Example[] {
  const w = words(request);
  const score = (e: Example) => {
    const name = (e.name + ' ' + e.title).toLowerCase();
    return w.reduce((s, x) => s + (name.includes(x) ? 3 : 0) + (e.code.toLowerCase().includes(x) ? 1 : 0), 0);
  };
  const ranked = all.map((e) => ({ e, s: score(e) })).sort((a, b) => b.s - a.s);
  const top = ranked.filter((r) => r.s > 0).slice(0, n).map((r) => r.e);
  const fallback = ['macd', 'bb'].map((k) => all.find((e) => e.name === k)).filter((e): e is Example => !!e);
  return (top.length ? top : fallback).slice(0, n);
}

/** Plot checks on a finished run (price scale of the sample data is about 100): empty, flat and badly scaled output that still compiles. */
function plotChecks(r: PineResult, close: Float64Array): string | null {
  const marks = r.shapes.some((x) => x.flags.some(Boolean)) || r.bgcolors.some(Boolean) || r.barcolors.some(Boolean);
  // plots of a named pane (pane="RSI") are judged as their own oscillator pane, the others by the script's overlay setting
  const groups = new Map<string, PineResult['plots']>();
  for (const p of r.plots) groups.set(p.pane ?? '', [...(groups.get(p.pane ?? '') ?? []), p]);
  for (const [pane, plots] of groups) {
    const err = groupChecks(plots, pane ? false : r.meta.overlay, marks, close);
    if (err) return pane ? `Pane "${pane}": ${err}` : err;
  }
  return null;
}

function groupChecks(plots: PineResult['plots'], overlay: boolean, marks: boolean, close: Float64Array): string | null {
  const stats = plots.map((p) => {
    const v = Array.from(p.values.slice(-120)).filter(Number.isFinite);
    const abs = v.map(Math.abs).sort((a, b) => a - b);
    return { title: p.title, n: v.length, flat: v.length > 0 && Math.max(...v) === Math.min(...v), med: abs.length ? abs[abs.length >> 1] : 0 };
  });
  // markers and signal plots may legitimately be na most of the time (plot(sqz ? 0 : na)): only judge plots that have data
  const live0 = stats.filter((x) => x.n > 0);
  if (!live0.length) return marks ? null : 'Every plot is na on the last 120 bars. Check warm-up, na handling and the formula.';
  if (live0.every((x) => x.flat)) return 'Every plot is a flat line. The formula produces no variation.';
  const price = 100; // the sample candles trade around 100
  if (overlay) {
    // an overlay plot must sit at the price level of the last 120 bars (an RSI or MACD drawn on the price chart does not)
    const w = Array.from(close.slice(-120));
    const pLo = Math.min(...w), pHi = Math.max(...w);
    const off = live0.find((x) => !x.flat && (x.med < pLo * 0.7 || x.med > pHi * 1.3));
    if (off) return `overlay=true but plot "${off.title}" is not on the price scale. Give it its own pane with plot(..., pane="Name") (or overlay=false when the whole script is an oscillator), or fix the formula.`;
  } else {
    const live = live0.filter((x) => !x.flat && x.med > 1e-9);
    if (live.length > 1) {
      const priceLike = live.find((x) => x.med >= price * 0.75 && x.med <= price * 1.25), small = live.find((x) => x.med < price * 0.55);
      if (priceLike && small) return `Scale mismatch: "${priceLike.title}" looks like an absolute price while "${small.title}" is an oscillator in the same pane. Compute price-scaled lines (bands, channels, averages) silently and plot only oscillator-scale values, or use overlay=true.`;
      const lo = Math.min(...live.map((x) => x.med)), hi = Math.max(...live.map((x) => x.med));
      if (hi / lo > 10) return `Scale mismatch: plots in the same pane differ by a factor of ${Math.round(hi / lo)} (e.g. "${live.find((x) => x.med === hi)!.title}" vs "${live.find((x) => x.med === lo)!.title}"). Do not plot price-scaled lines with an oscillator in one pane; compute them silently or use overlay=true.`;
    }
  }
  return null;
}

const errText = (r: PineResult) => `${r.error!.line ? 'line ' + r.error!.line + ': ' : ''}${r.error!.message}`;

/** Run-time sanity of an indicator on the sample data. Returns an error text or null. */
export function sanity(code: string): string | null {
  const r = runPine(code, SAMPLE);
  if (r.error) return errText(r);
  if (r.meta.kind !== 'indicator') return 'It must declare indicator(), not strategy().';
  if (!r.plots.length && !r.shapes.length && !r.bgcolors.some(Boolean) && !r.barcolors.some(Boolean)) return 'It draws nothing. Use plot(), plotshape() or bgcolor().';
  return plotChecks(r, SAMPLE.c);
}

/** Run `ask` until the code passes `validate` (returns an error text or null); at most `tries` attempts. */
async function loop(system: string, request: string, complete: Complete, validate: (code: string) => string | null, tries = 3, post: (code: string) => string = (c) => c, soft: (err: string) => boolean = () => false): Promise<string> {
  const msgs: Msg[] = [{ role: 'system', content: system }, { role: 'user', content: request }];
  let last = '';
  for (let i = 0; i < tries; i++) {
    const reply = await complete(msgs);
    const code = post(extractCode(reply));
    const err = code ? validate(code) : 'The reply contained no code.';
    if (!err) return code;
    last = err;
    if (soft(err) && i === tries - 1) return code; // only a soft complaint left on the last round: keep the draft, the caller re-checks and warns
    msgs.push({ role: 'assistant', content: reply }, { role: 'user', content: `That code fails: ${err}\nFix it and reply with ONLY the corrected code.` });
  }
  throw new Error(`The AI could not produce working Pine code (${last}). Try describing it differently.`);
}

/** Indicator from text: v6 system prompt plus similar working scripts as references, run-time checks and repair rounds. One model call per round (free models are rate limited). */
export async function genIndicator(request: string, complete: Complete, examples: Example[] = []): Promise<string> {
  const text = request.trim();
  if (!text) throw new Error('Describe the indicator first.');
  const refs = pickExamples(text, examples).map((e) => `--- ${e.title} ---\n${e.code.slice(0, 1800)}`).join('\n\n');
  const req = [`Indicator wanted: ${text}`, refs && `Working scripts of this exact interpreter, copy their style and function usage (they may declare //@version=5; you still write //@version=6):\n${refs}`].filter(Boolean).join('\n\n');
  return loop(INDICATOR_SYSTEM, req, complete, sanity, 4);
}

const SAMPLE = (() => {
  const n = 260;
  const t = new Float64Array(n), o = new Float64Array(n), h = new Float64Array(n), l = new Float64Array(n), c = new Float64Array(n), v = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const p = 100 + Math.sin(i / 9) * 12 + Math.sin(i / 3.1) * 2;
    t[i] = 1_700_000_000 + i * 86400; o[i] = p; c[i] = p + Math.cos(i / 2); h[i] = Math.max(o[i], c[i]) + 0.8; l[i] = Math.min(o[i], c[i]) - 0.8; v[i] = 1000 + (i % 10) * 100;
  }
  return { n, t, o, h, l, c, v };
})();

/** Deterministic random-walk candles with trends and pauses (price about 100): enough bars for a strategy to trade several times. */
export const STRAT_SAMPLE: PineCandles = (() => {
  const n = 1500;
  const t = new Float64Array(n), o = new Float64Array(n), h = new Float64Array(n), l = new Float64Array(n), c = new Float64Array(n), v = new Float64Array(n);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) - 0.5;
  let p = 100, drift = 0;
  for (let i = 0; i < n; i++) {
    if (i % 120 === 0) drift = rnd() * 0.5;
    const open = p;
    p = Math.max(20, p * (1 + (drift * 0.01 + rnd() * 0.03) * 0.5));
    t[i] = 1_700_000_000 + i * 86400; o[i] = open; c[i] = p;
    h[i] = Math.max(open, p) * (1 + Math.abs(rnd()) * 0.01); l[i] = Math.min(open, p) * (1 - Math.abs(rnd()) * 0.01);
    v[i] = 1000 * Math.exp(rnd() * 3); // volume with spikes, like real markets
  }
  return { n, t, o, h, l, c, v };
})();

// ---------------------------------------------------------------- strategies

export interface StrategyOpts {
  qtyType: 'percent_of_equity' | 'cash' | 'fixed';
  qty: number;
  /** stop loss / take profit in percent of the entry price; 0 or undefined = not wanted */
  sl?: number;
  tp?: number;
  direction: 'auto' | 'long' | 'short' | 'both';
}

export const STRATEGY_EXAMPLE_LONG = `//@version=6
strategy("EMA Trend Pullback", overlay=true, initial_capital=10000, default_qty_type=strategy.percent_of_equity, default_qty_value=100, pyramiding=0)

fastLen = input.int(20, "Fast EMA", minval=1)
slowLen = input.int(50, "Slow EMA", minval=1)
rsiLen = input.int(14, "RSI Length", minval=1)
slPct = input.float(2.0, "Stop loss %", minval=0, step=0.1)
tpPct = input.float(4.0, "Take profit %", minval=0, step=0.1)

fast = ta.ema(close, fastLen)
slow = ta.ema(close, slowLen)
rsi = ta.rsi(close, rsiLen)
crossUp = ta.crossover(fast, slow)
crossDown = ta.crossunder(fast, slow)

longEntry = crossUp and rsi > 50
longExit = crossDown

if longEntry
    strategy.entry("Long", strategy.long)
if longExit
    strategy.close("Long", comment="Trend ended")

if strategy.position_size > 0
    strategy.exit("Long SL/TP", "Long", stop=slPct > 0 ? strategy.position_avg_price * (1 - slPct / 100) : na, limit=tpPct > 0 ? strategy.position_avg_price * (1 + tpPct / 100) : na)

plot(fast, "Fast EMA", color=color.aqua)
plot(slow, "Slow EMA", color=color.orange)
`;

export const STRATEGY_EXAMPLE_BOTH = `//@version=6
strategy("RSI Reversal Long/Short", overlay=true, initial_capital=10000, default_qty_type=strategy.percent_of_equity, default_qty_value=50, pyramiding=0)

len = input.int(14, "RSI Length", minval=1)
oversold = input.int(30, "Oversold", minval=1)
overbought = input.int(70, "Overbought", minval=1)
slPct = input.float(3.0, "Stop loss %", minval=0, step=0.1)

rsi = ta.rsi(close, len)
backUp = ta.crossover(rsi, oversold)
backDown = ta.crossunder(rsi, overbought)
midUp = ta.crossover(rsi, 50)
midDown = ta.crossunder(rsi, 50)

if backUp
    strategy.entry("Long", strategy.long)
if backDown
    strategy.entry("Short", strategy.short)
if midUp and strategy.position_size < 0
    strategy.close("Short", comment="RSI back at 50")
if midDown and strategy.position_size > 0
    strategy.close("Long", comment="RSI back at 50")

if strategy.position_size > 0
    strategy.exit("Long SL", "Long", stop=slPct > 0 ? strategy.position_avg_price * (1 - slPct / 100) : na)
if strategy.position_size < 0
    strategy.exit("Short SL", "Short", stop=slPct > 0 ? strategy.position_avg_price * (1 + slPct / 100) : na)

hline(overbought, "Overbought", color=color.red, pane="RSI")
hline(oversold, "Oversold", color=color.green, pane="RSI")
plot(rsi, "RSI", color=color.purple, pane="RSI")
plot(ta.ema(close, 50), "EMA 50", color=color.orange)
`;

const STRATEGY_SYSTEM = `You are an expert Pine Script developer writing trading STRATEGIES in Pine Script **Version 6** for the Oviate charting app. The user describes a strategy in words; you deliver a complete, compiler-safe, backtestable strategy that does exactly what was described. ${ENGINE}

### 1. How this backtester works (important)
- strategy.entry() / strategy.close() / strategy.exit() orders are placed on the bar where the condition is true and FILL AT THE NEXT BAR'S OPEN. Never try to fill at the signal bar's close.
- strategy.entry(id, strategy.long|strategy.short) while holding the opposite direction closes that position first and reverses. With pyramiding=0 an entry in the direction already held is ignored.
- strategy.close(id) closes the position opened by entry id. strategy.close_all() closes everything.
- strategy.exit(exitId, fromEntryId, stop=price, limit=price) sets a protective stop and/or a take-profit as ABSOLUTE PRICES. Call it on every bar while a position is open: wrap it in \`if strategy.position_size > 0\` (long) or \`< 0\` (short). Compute the prices from strategy.position_avg_price. Pass \`na\` for a level that is not wanted.
- strategy.position_size is > 0 long, < 0 short, 0 flat. Orders do not take a \`when\` argument in v6: use if blocks.
- Position size, capital, commission and slippage are handled by the app: do not size positions yourself and do not pass qty to strategy.entry.

### 2. Structure of the answer
- Start with //@version=6, then exactly one strategy("Title", overlay=..., initial_capital=10000, default_qty_type=..., default_qty_value=..., pyramiding=0) line. Use the position size given in the request.
- Put every tunable number in an input.int / input.float / input.bool with a clear title and a sensible default (periods, thresholds, stop loss %, take profit %).
- Compute every indicator ONCE at the top level into variables (ta.* must never run inside if / ternary / and-or short circuits): first the indicators and the crossover / crossunder flags, then the entry and exit conditions, then the orders, then the plots.
- Cover EVERY part of the description: all entry conditions, all exit conditions, the directions (long, short, both), filters, and every stop loss / take profit / size the request lists. If the description is vague, choose the standard textbook version and parameters of the named indicators.
- A position needs a way out: an exit condition, or a stop / take profit, or reversal by the opposite entry.

### 3. Chart rules
- Use strategy(overlay=true). Plot the strategy's price-scaled indicators plainly (moving averages, bands, stops, channels) so they appear on the price chart.
- Every OSCILLATOR-scale indicator the strategy uses (RSI, MACD, Stochastic, ADX, CCI, volume ...) goes in its OWN pane: add pane="Name" to its plot() and hline() calls, e.g. plot(rsi, "RSI", color=color.purple, pane="RSI"), hline(70, "Overbought", pane="RSI"). Any number of panes is fine (RSI and MACD each get one), plots with the same pane name share a pane. Never mix price-scaled and oscillator-scale values in one pane.
- Plot every indicator that drives an entry or exit, so the user sees why it trades. Markers for signals: plotshape on the price chart.
- Colors: color.lime / color.green bullish, color.red / color.maroon bearish, color.aqua / color.orange / color.fuchsia for lines. Give every plot a title.
- Handle na and history references (x[1]) with nz() where needed.

### 4. Two complete reference strategies (valid for this interpreter: copy their structure)
Long only, overlay, with stop loss and take profit:
\`\`\`pine
${STRATEGY_EXAMPLE_LONG}\`\`\`
Long and short, oscillator in its own pane (pane=...), reversal entries, stop loss only:
\`\`\`pine
${STRATEGY_EXAMPLE_BOTH}\`\`\`

### Output
Before writing, silently work out every entry, exit and filter rule and which side(s) trade. Reply with ONLY the code in one code block, no explanation.`;

/** Find the `strategy(` call: returns [index of "(", index of matching ")"] or null. */
function declSpan(code: string): [number, number] | null {
  const m = /^[ \t]*strategy\s*\(/m.exec(code);
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  let depth = 0, q = '';
  for (let i = open; i < code.length; i++) {
    const ch = code[i];
    if (q) { if (ch === q && code[i - 1] !== '\\') q = ''; continue; }
    if (ch === '"' || ch === "'") q = ch;
    else if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) return [open, i];
  }
  return null;
}

/** Top-level comma split (ignores commas inside parentheses and strings). */
function splitArgs(text: string): string[] {
  const out: string[] = []; let depth = 0, q = '', cur = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { cur += ch; if (ch === q && text[i - 1] !== '\\') q = ''; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; }
    else if (ch === '(' || ch === '[') { depth++; cur += ch; }
    else if (ch === ')' || ch === ']') { depth--; cur += ch; }
    else if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Force the position size the user chose into the strategy() declaration (the model's own value is replaced). */
export function setPositionSize(code: string, type: StrategyOpts['qtyType'], qty: number): string {
  const span = declSpan(code);
  if (!span) return code;
  const args = splitArgs(code.slice(span[0] + 1, span[1])).filter((a) => !/^default_qty_(type|value)\s*=/.test(a));
  args.push(`default_qty_type=strategy.${type}`, `default_qty_value=${Number.isFinite(qty) ? qty : 100}`);
  return code.slice(0, span[0] + 1) + args.join(', ') + code.slice(span[1]);
}

const LIMIT_TITLE = { sl: /stop\s*loss|\bsl\b/i, tp: /take\s*profit|\btp\b/i };
const LIMIT_INPUT = /(input\.(?:float|int)\(\s*)(-?[\d.]+)(\s*,\s*"([^"]*)")/g;

/** Does the code have a stop loss / take profit input (a float or int input titled so)? */
export function hasLimitInput(code: string, k: 'sl' | 'tp'): boolean {
  for (const m of code.matchAll(LIMIT_INPUT)) if (LIMIT_TITLE[k].test(m[4])) return true;
  return false;
}

/** Change the form values that need no AI: position size, and the default of the stop loss / take profit inputs the code already has (0 or empty = off). */
export function setStrategyParams(code: string, o: Pick<StrategyOpts, 'qtyType' | 'qty' | 'sl' | 'tp'>): string {
  let out = setPositionSize(code, o.qtyType, o.qty);
  for (const k of ['sl', 'tp'] as const) {
    const v = o[k] && o[k]! > 0 ? o[k]! : 0;
    out = out.replace(LIMIT_INPUT, (all, a, _val, b, title) => (LIMIT_TITLE[k].test(title) ? a + String(v) + b : all));
  }
  return out;
}

export interface StrategyCheck { error: string | null; trades: number; result?: PineResult }

/** Run a strategy on the sample candles and check what the user asked for. */
export function strategyCheck(code: string, opts: StrategyOpts, data: PineCandles = STRAT_SAMPLE): StrategyCheck {
  const r = runPine(code, data);
  if (r.error) return { error: errText(r), trades: 0 };
  if (r.meta.kind !== 'strategy' || !r.strategy) return { error: 'It must declare strategy(), not indicator().', trades: 0 };
  const trades = r.strategy.trades;
  const fail = (error: string): StrategyCheck => ({ error, trades: trades.length, result: r });
  if (!/strategy\.(entry|order)\s*\(/.test(code)) return fail('It never calls strategy.entry().');
  if ((opts.sl ?? 0) > 0 || (opts.tp ?? 0) > 0) {
    if (!/strategy\.exit\s*\(/.test(code)) return fail('A stop loss / take profit was requested: implement it with strategy.exit(...) using strategy.position_avg_price, called on every bar while in a position.');
  }
  if (!trades.length) return fail(`It never trades on ${data.n} sample bars. The entry conditions are too strict, contradictory, or never reach strategy.entry(). Re-check the logic (cross conditions, thresholds, filters) so entries fire regularly.`);
  const longs = trades.filter((t) => t.dir === 'long').length, shorts = trades.length - longs;
  if (opts.direction === 'long' && shorts) return fail('The request is LONG ONLY but the strategy opens short trades. Remove all short entries and reversals into short.');
  if (opts.direction === 'short' && longs) return fail('The request is SHORT ONLY but the strategy opens long trades. Remove all long entries and reversals into long.');
  if (opts.direction === 'both' && (!longs || !shorts)) return fail(`The request needs BOTH long and short trades, but only ${longs ? 'long' : 'short'} trades happened on the sample. Add or fix the ${longs ? 'short' : 'long'} entry.`);
  const pc = plotChecks(r, data.c);
  if (pc) return fail(pc);
  return { error: null, trades: trades.length, result: r };
}

/** The request as the model sees it: description plus the fixed settings from the form. */
export function strategyRequest(text: string, o: StrategyOpts): string {
  const size = o.qtyType === 'percent_of_equity' ? `${o.qty}% of equity per entry` : o.qtyType === 'cash' ? `${o.qty} (account currency) invested per entry` : `${o.qty} units per entry`;
  const dir = { auto: 'as described', long: 'LONG ONLY (no short trades at all)', short: 'SHORT ONLY (no long trades at all)', both: 'BOTH long and short' }[o.direction];
  return [
    `Strategy wanted: ${text.trim()}`,
    'Settings chosen by the user (follow them exactly):',
    `- Position size: ${size}. Put it in default_qty_type / default_qty_value of strategy(); do not size positions any other way.`,
    `- Directions: ${dir}.`,
    o.sl ? `- Stop loss: ${o.sl}% from the entry price (below it for longs, above it for shorts). Expose it as input.float "Stop loss %" with default ${o.sl} and implement it with strategy.exit.` : '- Stop loss: none requested (only add one if the description asks for it).',
    o.tp ? `- Take profit: ${o.tp}% from the entry price (above it for longs, below it for shorts). Expose it as input.float "Take profit %" with default ${o.tp} and implement it with strategy.exit.` : '- Take profit: none requested (only add one if the description asks for it).',
  ].join('\n');
}

/** Strategy from text. Position size is forced into the declaration, then the code is run on sample candles and checked against the form. */
export async function genStrategy(text: string, opts: StrategyOpts, complete: Complete, examples: Example[] = []): Promise<string> {
  if (!text.trim()) throw new Error('Describe the strategy first.');
  if (!(opts.qty > 0)) throw new Error('Set the position size first.');
  const refs = pickExamples(text, examples, 1).map((e) => `--- ${e.title} (the user's own strategy) ---\n${e.code.slice(0, 2000)}`).join('\n\n');
  const req = [strategyRequest(text, opts), refs && `A working strategy of the user, for style:\n${refs}`].filter(Boolean).join('\n\n');
  return loop(STRATEGY_SYSTEM, req, complete, (code) => strategyCheck(code, opts).error, 4, (code) => setPositionSize(code, opts.qtyType, opts.qty), (err) => err.startsWith('It never trades'));
}

// ---------------------------------------------------------------- editing existing scripts

const EDIT_RULES = `

### You are EDITING an existing script
The request contains the current script and the change wanted. Return the COMPLETE modified script. Change only what the request needs: keep every other input, variable, plot and rule exactly as it is, keep the script's own //@version line and its title, and keep its style. Do not rewrite or "improve" parts that were not asked about. If an input or setting is listed as fixed in the request, the result must have exactly that.`;

const sameCode = (a: string, b: string) => a.replace(/\s+/g, '') === b.replace(/\s+/g, '');

/** Read the strategy form back out of existing code: position size from strategy(), stop loss / take profit from inputs titled so, directions from the orders used. */
export function extractStrategyForm(code: string): StrategyOpts {
  const out: StrategyOpts = { qtyType: 'percent_of_equity', qty: 100, sl: 0, tp: 0, direction: 'auto' };
  const span = declSpan(code);
  if (span) {
    const args = splitArgs(code.slice(span[0] + 1, span[1]));
    const arg = (k: string) => args.find((a) => new RegExp(`^${k}\\s*=`).test(a))?.replace(/^[^=]+=\s*/, '');
    const t = arg('default_qty_type')?.replace('strategy.', '');
    if (t === 'percent_of_equity' || t === 'cash' || t === 'fixed') out.qtyType = t;
    const v = Number(arg('default_qty_value'));
    if (Number.isFinite(v) && v > 0) out.qty = v;
  }
  for (const m of code.matchAll(/input\.(?:float|int)\(\s*(-?[\d.]+)\s*,\s*"([^"]*)"/g)) {
    const val = Number(m[1]), title = m[2];
    if (/stop\s*loss|\bsl\b/i.test(title) && val > 0) out.sl = val;
    else if (/take\s*profit|\btp\b/i.test(title) && val > 0) out.tp = val;
  }
  const long = /strategy\.long\b/.test(code), short = /strategy\.short\b/.test(code);
  out.direction = long && short ? 'both' : long ? 'long' : short ? 'short' : 'auto';
  return out;
}

/** Change an existing indicator as described. The result is checked like a new one and must differ from the input. */
export async function editIndicator(code: string, change: string, complete: Complete): Promise<string> {
  if (!change.trim()) throw new Error('Describe the change first.');
  const req = `Current script:\n\`\`\`pine\n${code}\n\`\`\`\n\nChange wanted: ${change.trim()}`;
  return loop(INDICATOR_SYSTEM + EDIT_RULES, req, complete, (c) => (sameCode(c, code) ? 'Nothing was changed. Apply the requested change.' : sanity(c)), 4);
}

/** Change an existing strategy as described, with the settings of the form (size, stop loss, take profit, direction) holding after the edit. */
export async function editStrategy(code: string, change: string, opts: StrategyOpts, complete: Complete): Promise<string> {
  if (!change.trim() && !opts.qty) throw new Error('Describe the change first.');
  if (!(opts.qty > 0)) throw new Error('Set the position size first.');
  const req = `Current script:\n\`\`\`pine\n${code}\n\`\`\`\n\nChange wanted: ${change.trim() || '(only the settings below changed)'}\n\n${strategyRequest('the edited strategy (same strategy as above, with the change applied)', opts).split('\n').slice(1).join('\n')}`;
  const settled = setPositionSize(code, opts.qtyType, opts.qty); // the original with the form's size: a reply equal to it changed nothing
  return loop(STRATEGY_SYSTEM + EDIT_RULES, req, complete, (c) => {
    const same = change.trim() && sameCode(c, settled) ? 'Nothing was changed. Apply the requested change.' : null;
    return same ?? strategyCheck(c, opts).error;
  }, 4, (c) => setPositionSize(c, opts.qtyType, opts.qty), (err) => err.startsWith('It never trades'));
}

/** Rules of the Pine dialect and the backtester, for humans and for the CLI guide. */
export const GUIDE = { indicator: INDICATOR_SYSTEM, strategy: STRATEGY_SYSTEM };
