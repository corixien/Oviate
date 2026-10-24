// Builder from words: the model answers with the builder model as JSON (never Pine code), which is validated against the real indicator list and repaired with the error fed back.
import type { Complete, Msg } from '../ai/pine.ts';
import { checkModel, normalizeModel, toPine, PRICE_SRCS, type Cond, type Group, type IndInfo, type InfoFn, type Model, type Operand, type Side } from './model.ts';
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
        | { "k": "num", "v": number }   (only on the right side; times are hhmm numbers, 9:30 = 930, 15:55 = 1555; weekdays 1 = Monday .. 7 = Sunday)
        | { "k": "time", "f": "tod" | "dow" }   (clock time of the bar / weekday, left side; compare with "num")
        | { "k": "sess", "stat": "high" | "low" | "open" | "close" | "volume", "from": hhmm, "to": hhmm }   (stat of the bars of a daily window, e.g. pre-market 400 to 930)
        | { "k": "hl", "fn": "highest" | "lowest", "src": <price src>, "n": number }   (extreme of the last n bars)
        | { "k": "pos", "f": "entry" | "bars" | "pnl" }   (open position: entry price, bars in trade, profit percent)
price / ind / sess / hl operands may also carry "ago": number (value N bars ago, e.g. 1 for the previous bar) and "pct": number (scale by 1 + pct/100).
More CMP: "at_least" (>=), "at_most" (<=), "equal", "not_equal", "between" (needs "r" = lower and "r2" = upper end). A side may carry "maxPerDay": number (entries per day, 0 = unlimited). The model may carry "tz" (IANA time zone for the time operands, default "America/New_York").

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

async function buildLoop(userContent: string, list: { name: string; info: IndInfo }[], complete: Complete, tries: number): Promise<Model> {
  const byName = new Map(list.map((x) => [x.name, x.info]));
  const info: InfoFn = (n) => byName.get(n);
  const msgs: Msg[] = [{ role: 'system', content: `${SYSTEM}\n\nIndicators (name: title | where | plots | numeric inputs):\n${catalogText(list)}` }, { role: 'user', content: userContent }];
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

export async function aiBuilder(text: string, list: { name: string; info: IndInfo }[], complete: Complete, tries = 3): Promise<Model> {
  if (!text.trim()) throw new Error('Describe the strategy first.');
  return buildLoop(`Strategy idea: ${text.trim()}`, list, complete, tries);
}

/** Pine code that was not made by the builder, read into the builder: the same entries and exits expressed with the indicators of the list. */
export async function aiBuilderFromCode(code: string, list: { name: string; info: IndInfo }[], complete: Complete, tries = 3): Promise<Model> {
  const req = `Convert this Pine Script strategy into the builder model. Keep its entry and exit rules, sides, position size, stop loss and take profit; express every indicator it uses with the closest indicator of the list, using its input values (put the code's lengths into "p"). If a rule cannot be expressed exactly, use the closest equivalent.\n\n\`\`\`pine\n${code.slice(0, 6000)}\n\`\`\``;
  return buildLoop(req, list, complete, tries);
}

/** The model with the missing side written as the exact opposite of the existing one (long entry becomes short entry, levels mirrored, exits mirrored). */
export async function aiMirrorSide(model: Model, from: 'long' | 'short', list: { name: string; info: IndInfo }[], complete: Complete, tries = 3): Promise<Model> {
  const to = from === 'long' ? 'short' : 'long';
  const req = `Here is a strategy. Its "${from}" side is complete, its "${to}" side is empty. Return the SAME model with the "${to}" side filled in as the exact opposite of the "${from}" side: every ${from} entry condition becomes the mirrored ${to} entry condition (crosses above <-> crosses below, is above <-> is below, rising <-> falling, turns up <-> turns down, oscillator levels mirrored such as RSI 30 -> 70, price above an average <-> below it, a breakout of a high <-> a breakdown of the matching low, session high <-> session low), the exit conditions are mirrored the same way, stop loss and take profit are copied, times, windows and "maxPerDay" stay the same. Set "on" true for both sides and keep the "${from}" side unchanged.\n\n\`\`\`json\n${JSON.stringify(model)}\n\`\`\``;
  return buildLoop(req, list, complete, tries);
}

const FLIP: Partial<Record<Cond['cmp'], Cond['cmp']>> = {
  cross_above: 'cross_below', cross_below: 'cross_above', above: 'below', below: 'above', at_least: 'at_most', at_most: 'at_least',
  rising: 'falling', falling: 'rising', turn_up: 'turn_down', turn_down: 'turn_up',
};
const FLIP_SESS: Record<string, string> = { high: 'low', low: 'high' };

/** Offline fallback of aiMirrorSide: flips the comparisons, mirrors levels on a 0-100 scale (or around zero) and session / N-bar highs and lows. */
export function mirrorSideLocal(side: Side): Side {
  const operand = (o: Operand, other?: Operand): Operand => {
    if (o.k === 'num' && other && other.k !== 'time') return { k: 'num', v: o.v >= 0 && o.v <= 100 && other.k === 'ind' ? 100 - o.v : -o.v };
    if (o.k === 'sess' && FLIP_SESS[o.stat]) return { ...o, stat: FLIP_SESS[o.stat] as typeof o.stat };
    if (o.k === 'hl') return { ...o, fn: o.fn === 'highest' ? 'lowest' : 'highest', src: o.src === 'high' ? 'low' : o.src === 'low' ? 'high' : o.src };
    return structuredClone(o);
  };
  const cond = (c: Cond): Cond => {
    const out: Cond = { ...structuredClone(c), cmp: FLIP[c.cmp] ?? c.cmp };
    if (c.r) out.r = operand(c.r, c.l);
    if (c.r2) out.r2 = operand(c.r2, c.l);
    return out;
  };
  const group = (g: Group): Group => ({ op: g.op, items: g.items.map(cond) });
  return { ...structuredClone(side), on: true, entry: group(side.entry), exit: group(side.exit) };
}
