// AI code generation (Groq) for Pine indicators and builder conditions. The model call is injected, so this stays pure and testable.
import { runPine } from '../pine/index.ts';
import { describeScript } from '../pine/describe.ts';
import { defaultSpec, generate, emptyGroup, scenarioCond, AI_ID, subjectInfo } from './model.ts';
import type { Operand } from './model.ts';

export type Msg = { role: 'system' | 'user' | 'assistant'; content: string };
export type Complete = (messages: Msg[]) => Promise<string>;

const ENGINE = `The code runs in a small Pine Script v5 interpreter. Supported: ta.sma ema wma hma vwma rma rsi macd bb atr dmi supertrend sar stoch cci mfi wpr cmo roc mom tsi kc linreg stdev highest lowest highestbars lowestbars change crossover crossunder cross rising falling barssince valuewhen pivothigh pivotlow cum tr obv vwap median percentrank; math.* (abs max min sqrt log pow round sum avg); nz, na, fixnan; if/else, for, ternary, var, user functions, arrays; series history with [n]; built-in series open high low close volume hl2 hlc3 ohlc4 bar_index time; input.int/float/bool/source/string/color; plot, hline, fill, bgcolor, barcolor, plotshape, color.*. Not supported: request.security (passthrough only), drawing objects (label/line/box are not rendered), libraries, imports. Call ta.* functions on every bar at the top level of a block, never inside if or ternary branches.`;

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

/** Runtime sanity on the sample data: catches empty, flat and badly scaled output that still compiles. */
export function sanity(code: string): string | null {
  const r = runPine(code, SAMPLE);
  if (r.error) return `${r.error.line ? 'line ' + r.error.line + ': ' : ''}${r.error.message}`;
  if (r.meta.kind !== 'indicator') return 'It must declare indicator(), not strategy().';
  if (!r.plots.length && !r.shapes.length && !r.bgcolors.some(Boolean) && !r.barcolors.some(Boolean)) return 'It draws nothing. Use plot(), plotshape() or bgcolor().';
  const marks = r.shapes.some((x) => x.flags.some(Boolean)) || r.bgcolors.some(Boolean) || r.barcolors.some(Boolean);
  if (!r.plots.length) return null;
  const stats = r.plots.map((p) => {
    const v = Array.from(p.values.slice(-120)).filter(Number.isFinite);
    const abs = v.map(Math.abs).sort((a, b) => a - b);
    return { title: p.title, n: v.length, flat: v.length > 0 && Math.max(...v) === Math.min(...v), med: abs.length ? abs[abs.length >> 1] : 0 };
  });
  // markers and signal plots may legitimately be na most of the time (plot(sqz ? 0 : na)): only judge plots that have data
  const live0 = stats.filter((x) => x.n > 0);
  if (!live0.length) return marks ? null : 'Every plot is na on the last 120 bars. Check warm-up, na handling and the formula.';
  if (live0.every((x) => x.flat)) return 'Every plot is a flat line. The formula produces no variation.';
  const price = 100;
  if (r.meta.overlay) {
    const off = live0.find((x) => !x.flat && (x.med < price * 0.2 || x.med > price * 5));
    if (off) return `overlay=true but plot "${off.title}" is not on the price scale. Use overlay=false for oscillators, or fix the formula.`;
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

const CONDITION_SYSTEM = `You turn a trading condition written in words into Pine Script v5 code for a strategy builder. ${ENGINE}
The condition is attached to one subject (an indicator or the price). Its outputs are available as the variables IND0, IND1, ... (listed in the request) with full history, so IND0[1] is the previous bar. Use open/high/low/close/volume directly and compute any other indicator the user mentions inline with ta.*.
Rules: reply with ONLY code lines, no explanation, no function header, no plot/strategy/input calls. You may define helper variables first. The LAST line must be one boolean expression that is true on bars where the condition fires (for crosses use ta.crossover / ta.crossunder). Use ta.* calls only as full statements or at the top of expressions, never inside if/ternary.`;

/** Run `ask` until the code passes `validate` (returns an error text or null); at most `tries` attempts. */
async function loop(system: string, request: string, complete: Complete, validate: (code: string) => string | null, tries = 3): Promise<string> {
  const msgs: Msg[] = [{ role: 'system', content: system }, { role: 'user', content: request }];
  let last = '';
  for (let i = 0; i < tries; i++) {
    const reply = await complete(msgs);
    const code = extractCode(reply);
    const err = code ? validate(code) : 'The reply contained no code.';
    if (!err) return code;
    last = err;
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

/** Condition code for `subject`; checked by building a one-condition strategy and running it. */
export function genCondition(subject: Operand, text: string, complete: Complete): Promise<string> {
  const want = text.trim();
  if (!want) return Promise.reject(new Error('Describe the condition first.'));
  const { name, outputs } = subjectInfo(subject);
  const list = outputs.length ? outputs.map((o, i) => `IND${i} = ${o}`).join('; ') : 'none';
  const request = `Subject: ${name}\nOutputs: ${list}\nCondition: ${want}`;
  return loop(CONDITION_SYSTEM, request, complete, (code) => {
    const spec = defaultSpec();
    spec.short.on = false;
    const c = scenarioCond(subject, AI_ID);
    c.ai!.code = code;
    spec.long.entry = { ...emptyGroup(), items: [c] };
    const r = runPine(generate(spec), SAMPLE);
    return r.error ? r.error.message : null;
  });
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
