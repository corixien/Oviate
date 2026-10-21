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

const INDICATOR_SYSTEM = `You write Pine Script v5 indicators for the Oviate charting app. ${ENGINE}
Rules: reply with ONLY the code, no explanation. Start with //@version=5 and one indicator("Full Title", shorttitle="Short", overlay=true or false) line (overlay=true only when the lines belong on the price scale). Expose the important numbers as input.int / input.float / input.source with clear titles and sensible defaults. Plot every output with plot(..., "Title", color=...) and add hline() for fixed levels when useful. Keep it short and correct.`;

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

export function genIndicator(request: string, complete: Complete): Promise<string> {
  const text = request.trim();
  if (!text) return Promise.reject(new Error('Describe the indicator first.'));
  return loop(INDICATOR_SYSTEM, `Indicator wanted: ${text}`, complete, (code) => {
    const info = describeScript(code);
    if (info.error) return `${info.error.line ? 'line ' + info.error.line + ': ' : ''}${info.error.message}`;
    if (info.meta.kind !== 'indicator') return 'It must declare indicator(), not strategy().';
    if (!info.plots.length) return 'It plots nothing. Use plot().';
    return null;
  });
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
