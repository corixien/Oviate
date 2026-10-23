// Builder from words: the model answers with the builder model as JSON (never Pine code), which is validated against the real indicator list and repaired with the error fed back.
import type { Complete, Msg } from '../ai/pine.ts';
import { checkModel, normalizeModel, toPine, PRICE_SRCS, type IndInfo, type InfoFn, type Model } from './model.ts';
import { runPine } from '../pine/interp.ts';
import { STRAT_SAMPLE } from '../ai/pine.ts';

const SYSTEM = `You turn a trading idea into the JSON model of Oviate's visual strategy builder. Reply with ONE json code block and nothing else.

Model:
{ "name": string, "qtyType": "percent_of_equity" | "cash" | "fixed", "qty": number,
  "long":  { "on": boolean, "entry": GROUP, "exit": GROUP, "sl": number, "tp": number },
  "short": { "on": boolean, "entry": GROUP, "exit": GROUP, "sl": number, "tp": number } }
GROUP = { "op": "and" | "or", "items": [COND, ...] }       (all / any of the conditions)
COND  = { "l": OPERAND, "cmp": CMP, "r": OPERAND (only for binary cmp), "n": number (rising/falling: bars), "within": number (true on any of the last N bars) }
CMP   = binary: "cross_above" | "cross_below" | "above" | "below"   unary (no "r"): "rising" | "falling" | "turn_up" | "turn_down"
OPERAND = { "k": "price", "src": ${PRICE_SRCS.map((s) => `"${s}"`).join(' | ')} }
        | { "k": "ind", "ind": <indicator name from the list>, "plot": <exact plot title of that indicator>, "p": { "<input title>": number } }   ("p" only for inputs that differ from the default, else {})
        | { "k": "num", "v": number }   (only on the right side)

Rules:
- Use ONLY indicators and plot titles from the list below, spelled exactly. Input titles in "p" must be exact too.
- "sl" / "tp" are stop loss / take profit in percent (0 = none). qty: % of equity (1-100), cash amount, or units.
- A side needs at least one entry condition, or "on": false. Exit conditions are optional but a strategy without any exit, stop loss or take profit never closes a trade, so add one.
- Price crossing an overlay indicator (moving average, bands, Supertrend): left price, right the indicator. Oscillator levels: left the indicator plot, right a number.
- Unless the idea says otherwise: long only, qtyType percent_of_equity, qty 100.`;

export function catalogText(list: { name: string; info: IndInfo }[]): string {
  return list.map(({ name, info }) => `${name}: ${info.title} | ${info.overlay ? 'on price' : 'own pane'} | plots: ${info.plots.join(', ')} | inputs: ${info.inputs.filter((i) => i.type === 'int' || i.type === 'float').map((i) => `${i.title}=${i.def}`).join(', ') || '-'}`).join('\n');
}

function jsonOf(reply: string): any {
  const fence = /```(?:json)?\s*\n([\s\S]*?)```/i.exec(reply);
  const text = (fence ? fence[1] : reply).trim();
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  return JSON.parse(a >= 0 && b > a ? text.slice(a, b + 1) : text);
}

/** Validate a model, then run its generated code on sample candles: errors come back as text for the repair round. */
function problem(m: Model, info: InfoFn): string | null {
  const e = checkModel(m, info);
  if (e) return e;
  const r = runPine(toPine(m, info), STRAT_SAMPLE);
  return r.error ? r.error.message : null;
}

export async function aiBuilder(text: string, list: { name: string; info: IndInfo }[], complete: Complete, tries = 3): Promise<Model> {
  if (!text.trim()) throw new Error('Describe the strategy first.');
  const byName = new Map(list.map((x) => [x.name, x.info]));
  const info: InfoFn = (n) => byName.get(n);
  const msgs: Msg[] = [{ role: 'system', content: `${SYSTEM}\n\nIndicators (name: title | where | plots | numeric inputs):\n${catalogText(list)}` }, { role: 'user', content: `Strategy idea: ${text.trim()}` }];
  let last = '';
  for (let i = 0; i < tries; i++) {
    const reply = await complete(msgs);
    let err: string | null;
    let m: Model | null = null;
    try { m = normalizeModel(jsonOf(reply)); err = problem(m, info); } catch (e) { err = `The reply is not valid JSON (${e instanceof Error ? e.message : e}).`; }
    if (!err && m) return m;
    last = err ?? '';
    msgs.push({ role: 'assistant', content: reply }, { role: 'user', content: `That model fails: ${err}\nFix it and reply with ONLY the corrected json block.` });
  }
  throw new Error(`The AI could not build a working strategy (${last}). Try describing it differently.`);
}
