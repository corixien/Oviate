// Visual strategy builder: model, Pine generation, reading a model back from code, and per-indicator suggestions. Pure (tested).
// A strategy is built from conditions "left <comparison> right" where each side is a price series, a plot of a library indicator or a fixed value.
// Library indicators are read through oviate.ind (see pine/indlib.ts), so any indicator in the list can be used and every one of its inputs stays tunable.

export type PriceSrc = 'close' | 'open' | 'high' | 'low' | 'hl2' | 'hlc3' | 'ohlc4' | 'volume';
export const PRICE_SRCS: PriceSrc[] = ['close', 'open', 'high', 'low', 'hl2', 'hlc3', 'ohlc4', 'volume'];
export const PRICE_LABEL: Record<PriceSrc, string> = { close: 'Close', open: 'Open', high: 'High', low: 'Low', hl2: '(H+L)/2', hlc3: '(H+L+C)/3', ohlc4: '(O+H+L+C)/4', volume: 'Volume' };

export type Operand =
  | { k: 'price'; src: PriceSrc }
  /** `ind` = file name of the library indicator, `plot` = title of one of its plots, `p` = input values that differ from the indicator's defaults (by input title) */
  | { k: 'ind'; ind: string; plot: string; p: Record<string, number | string | boolean> }
  | { k: 'num'; v: number };

export type Cmp = 'cross_above' | 'cross_below' | 'above' | 'below' | 'rising' | 'falling' | 'turn_up' | 'turn_down';
export const BINARY: Cmp[] = ['cross_above', 'cross_below', 'above', 'below'];
export const UNARY: Cmp[] = ['rising', 'falling', 'turn_up', 'turn_down'];
export const CMP_LABEL: Record<Cmp, string> = {
  cross_above: 'crosses above', cross_below: 'crosses below', above: 'is above', below: 'is below',
  rising: 'is rising', falling: 'is falling', turn_up: 'turns up', turn_down: 'turns down',
};
export const isUnary = (c: Cmp) => UNARY.includes(c);

export interface Cond {
  l: Operand;
  cmp: Cmp;
  /** right side of a binary comparison; undefined = None (rising / falling / turns up / turns down only look at the left side) */
  r?: Operand;
  /** rising / falling: number of bars (default 1) */
  n?: number;
  /** the condition may have been true on any of the last N bars (default 1 = this bar only) */
  within?: number;
}
export interface Group { op: 'and' | 'or'; items: Cond[] }
export interface Side { on: boolean; entry: Group; exit: Group; sl: number; tp: number }
export interface Model {
  v: 2;
  name: string;
  qtyType: 'percent_of_equity' | 'cash' | 'fixed';
  qty: number;
  long: Side;
  short: Side;
}

/** What the builder needs to know about a library indicator (from describeScript). */
export interface IndInfo {
  title: string;
  short: string;
  overlay: boolean;
  plots: string[];
  inputs: { title: string; type: string; def: number | string | boolean; min?: number; max?: number; step?: number }[];
}
export type InfoFn = (ind: string) => IndInfo | undefined;

export const emptyGroup = (): Group => ({ op: 'and', items: [] });
export const emptySide = (on = false): Side => ({ on, entry: emptyGroup(), exit: emptyGroup(), sl: 0, tp: 0 });
export const newModel = (): Model => ({ v: 2, name: 'My Strategy', qtyType: 'percent_of_equity', qty: 100, long: emptySide(true), short: emptySide(false) });

const sideEntries = (m: Model): [string, Side][] => [['Long', m.long], ['Short', m.short]];

// ---------------------------------------------------------------- text

export function operandText(o: Operand | undefined, info: InfoFn): string {
  if (!o) return 'nothing';
  if (o.k === 'price') return PRICE_LABEL[o.src];
  if (o.k === 'num') return String(o.v);
  const i = info(o.ind);
  const base = i ? (i.plots.length > 1 ? `${i.short} ${o.plot}` : i.short) : o.ind;
  const ps = Object.entries(o.p);
  return ps.length ? `${base} (${ps.map(([, v]) => v).join(', ')})` : base;
}

export function condText(c: Cond, info: InfoFn): string {
  const l = operandText(c.l, info);
  const bars = c.n && c.n > 1 ? ` for ${c.n} bars` : '';
  const core = isUnary(c.cmp) ? `${l} ${CMP_LABEL[c.cmp]}${c.cmp === 'rising' || c.cmp === 'falling' ? bars : ''}` : `${l} ${CMP_LABEL[c.cmp]} ${operandText(c.r, info)}`;
  return c.within && c.within > 1 ? `${core} (within the last ${c.within} bars)` : core;
}

// ---------------------------------------------------------------- validation

/** Error text for a model that cannot be turned into a working strategy, else null. */
export function checkModel(m: Model, info: InfoFn): string | null {
  if (!(m.qty > 0) || (m.qtyType === 'percent_of_equity' && m.qty > 100)) return 'Position size is not valid.';
  const opErr = (o: Operand | undefined, what: string): string | null => {
    if (!o) return `${what}: missing.`;
    if (o.k === 'num') return Number.isFinite(o.v) ? null : `${what}: the value is not a number.`;
    if (o.k === 'price') return PRICE_SRCS.includes(o.src) ? null : `${what}: unknown price "${o.src}".`;
    const i = info(o.ind);
    if (!i) return `${what}: indicator "${o.ind}" is not in the list.`;
    if (!i.plots.includes(o.plot)) return `${what}: indicator "${o.ind}" has no plot "${o.plot}" (plots: ${i.plots.join(', ')}).`;
    return null;
  };
  for (const [side, s] of sideEntries(m)) {
    if (!s.on) continue;
    if (!s.entry.items.length) return `${side}: add at least one entry condition (or switch ${side.toLowerCase()} off).`;
    for (const [kind, g] of [['entry', s.entry], ['exit', s.exit]] as const) {
      for (const [k, c] of g.items.entries()) {
        const w = `${side} ${kind} ${k + 1}`;
        if (!BINARY.includes(c.cmp) && !UNARY.includes(c.cmp)) return `${w}: unknown comparison "${c.cmp}".`;
        const e = opErr(c.l, w + ' left');
        if (e) return e;
        if (isUnary(c.cmp)) { if (c.l.k === 'num') return `${w}: "${CMP_LABEL[c.cmp]}" needs a price or indicator on the left.`; }
        else { const e2 = opErr(c.r, w + ' right'); if (e2) return e2; if (c.l.k === 'num') return `${w}: the left side cannot be a fixed value.`; }
      }
    }
  }
  if (!m.long.on && !m.short.on) return 'Switch on long or short.';
  return null;
}

/** Make parsed JSON (file comment or AI reply) a well-formed Model, filling gaps with defaults. Unknown content is kept so checkModel can name it. */
export function normalizeModel(raw: any): Model {
  const d = newModel();
  const num = (v: any, f: number) => (typeof v === 'number' && Number.isFinite(v) ? v : f);
  const operand = (o: any): Operand | undefined => {
    if (!o || typeof o !== 'object') return undefined;
    if (o.k === 'num') return { k: 'num', v: num(o.v, NaN) };
    if (o.k === 'price') return { k: 'price', src: o.src };
    if (o.k === 'ind') return { k: 'ind', ind: String(o.ind ?? ''), plot: String(o.plot ?? ''), p: o.p && typeof o.p === 'object' ? { ...o.p } : {} };
    return undefined;
  };
  const cond = (c: any): Cond | null => {
    const l = operand(c?.l);
    if (!l || typeof c.cmp !== 'string') return null;
    const out: Cond = { l, cmp: c.cmp };
    const r = operand(c.r); if (r && !isUnary(c.cmp)) out.r = r;
    if (c.n > 1) out.n = Math.floor(c.n);
    if (c.within > 1) out.within = Math.floor(c.within);
    return out;
  };
  const group = (g: any): Group => ({ op: g?.op === 'or' ? 'or' : 'and', items: Array.isArray(g?.items) ? g.items.map(cond).filter((c: Cond | null): c is Cond => !!c) : [] });
  const side = (s: any, on: boolean): Side => ({ on: typeof s?.on === 'boolean' ? s.on : on, entry: group(s?.entry), exit: group(s?.exit), sl: Math.max(0, num(s?.sl, 0)), tp: Math.max(0, num(s?.tp, 0)) });
  return {
    v: 2,
    name: typeof raw?.name === 'string' && raw.name.trim() ? raw.name.trim() : d.name,
    qtyType: ['percent_of_equity', 'cash', 'fixed'].includes(raw?.qtyType) ? raw.qtyType : d.qtyType,
    qty: num(raw?.qty, d.qty),
    long: side(raw?.long, true),
    short: side(raw?.short, false),
  };
}

// ---------------------------------------------------------------- Pine generation

const ident = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'x';
const lit = (v: number | string | boolean) => (typeof v === 'string' ? `"${v.replace(/"/g, "'")}"` : String(v));
const pickColors = ['color.orange', 'color.aqua', 'color.fuchsia', 'color.lime', 'color.yellow', 'color.blue', 'color.red', 'color.purple'];

export const MARKER = '// @oviate-builder ';

/** The Pine strategy for a model. Needs info() for every indicator used (checkModel first). */
export function toPine(m: Model, info: InfoFn): string {
  const inputs: string[] = [];
  const calc: string[] = [];
  const plots: string[] = [];
  const titles = new Set<string>();
  const uniqueTitle = (t: string) => { let u = t, k = 2; while (titles.has(u)) u = `${t} #${k++}`; titles.add(u); return u; };

  // one oviate.ind call (and one set of tunable inputs) per distinct indicator + input set; one series variable per plot
  const groups = new Map<string, { call: string; info: IndInfo }>();
  const series = new Map<string, string>();
  let colorIdx = 0;
  const indVar = (o: Extract<Operand, { k: 'ind' }>): string => {
    const i = info(o.ind)!;
    const gkey = o.ind + '|' + JSON.stringify(Object.entries(o.p).sort());
    let g = groups.get(gkey);
    if (!g) {
      const gid = `g${groups.size + 1}_${ident(o.ind)}`;
      const parts: string[] = [];
      for (const inp of i.inputs) {
        const over = o.p[inp.title];
        if (inp.type === 'int' || inp.type === 'float') {
          const def = typeof over === 'number' ? over : Number(inp.def);
          const vname = `${gid}_${ident(inp.title)}`;
          const fn = inp.type === 'int' ? 'input.int' : 'input.float';
          const extra = (inp.min !== undefined ? `, minval=${inp.min}` : '') + (inp.step !== undefined ? `, step=${inp.step}` : '');
          inputs.push(`${vname} = ${fn}(${def}, "${uniqueTitle(`${i.short} · ${inp.title}`)}"${extra})`);
          parts.push(`"${inp.title}=" + str.tostring(${vname})`);
        } else if (over !== undefined) parts.push(`"${inp.title}=${String(over).replace(/[";]/g, '')}"`);
      }
      g = { call: parts.length ? parts.join(' + ";" + ') : '""', info: i };
      groups.set(gkey, g);
    }
    const skey = gkey + '|' + o.plot;
    let v = series.get(skey);
    if (!v) {
      v = `v${series.size + 1}_${ident(o.ind)}`;
      series.set(skey, v);
      calc.push(`${v} = oviate.ind("${o.ind}", "${o.plot}", ${g.call})`);
      const pane = i.overlay ? '' : `, pane="${i.short}"`;
      plots.push(`plot(${v}, "${i.plots.length > 1 ? `${i.short} ${o.plot}` : i.short}", color=${pickColors[colorIdx++ % pickColors.length]}${pane})`);
    }
    return v;
  };

  const conds: string[] = [];
  const exprs: Record<string, string> = {};
  const rules: string[] = [];
  let numIdx = 0;

  for (const [side, s] of sideEntries(m)) {
    if (!s.on) continue;
    const dir = side.toLowerCase();
    for (const kind of ['entry', 'exit'] as const) {
      const g = s[kind];
      const names: string[] = [];
      g.items.forEach((c, k) => {
        const operand = (o: Operand, role: string): string => {
          if (o.k === 'price') return o.src;
          if (o.k === 'ind') return indVar(o);
          const nm = `n${++numIdx}_${dir}_${kind}${k + 1}`;
          const lhs = c.l.k === 'ind' ? info(c.l.ind) : undefined;
          inputs.push(`${nm} = input.float(${o.v}, "${uniqueTitle(`${side} ${kind} ${k + 1} · ${role}`)}")`);
          if (lhs && !lhs.overlay) plots.push(`hline(${o.v}, "${side} ${kind} ${k + 1} level", color=color.gray, pane="${lhs.short}")`);
          return nm;
        };
        const a = operand(c.l, 'value'), b = c.r && !isUnary(c.cmp) ? operand(c.r, 'value') : '';
        const n = c.n && c.n > 1 ? c.n : 1;
        let e: string;
        switch (c.cmp) {
          case 'cross_above': e = `ta.crossover(${a}, ${b})`; break;
          case 'cross_below': e = `ta.crossunder(${a}, ${b})`; break;
          case 'above': e = `${a} > ${b}`; break;
          case 'below': e = `${a} < ${b}`; break;
          case 'rising': e = `ta.rising(${a}, ${n})`; break;
          case 'falling': e = `ta.falling(${a}, ${n})`; break;
          case 'turn_up': e = `(${a} > ${a}[1] and ${a}[1] <= ${a}[2])`; break;
          default: e = `(${a} < ${a}[1] and ${a}[1] >= ${a}[2])`; break;
        }
        const name = `c_${dir}_${kind}${k + 1}`;
        // every condition is computed on every bar (also when an earlier one is false) so ta.* state stays correct
        conds.push(c.within && c.within > 1 ? `${name} = ta.barssince(${e}) < ${c.within}` : `${name} = ${e}`);
        names.push(name);
      });
      exprs[dir + kind] = names.length ? names.join(g.op === 'or' ? ' or ' : ' and ') : 'false';
    }
    inputs.push(`${dir}Sl = input.float(${s.sl}, "${side} stop loss %", minval=0, step=0.1)`);
    inputs.push(`${dir}Tp = input.float(${s.tp}, "${side} take profit %", minval=0, step=0.1)`);
    const long = dir === 'long';
    const id = side;
    const sgn = long ? 1 : -1;
    rules.push(
      `${dir}Entry = ${exprs[dir + 'entry']}`,
      `${dir}Exit = ${exprs[dir + 'exit']}`,
      `if ${dir}Exit and strategy.position_size ${long ? '>' : '<'} 0`,
      `    strategy.close("${id}", comment="${side} exit")`,
      `if ${dir}Entry and strategy.position_size ${long ? '<=' : '>='} 0`,
      `    strategy.entry("${id}", strategy.${dir}, comment="${side} entry")`,
      `if strategy.position_size ${long ? '>' : '<'} 0`,
      `    strategy.exit("${id} SL/TP", "${id}", stop=${dir}Sl > 0 ? strategy.position_avg_price * (1 ${long ? '-' : '+'} ${dir}Sl / 100) : na, limit=${dir}Tp > 0 ? strategy.position_avg_price * (1 ${long ? '+' : '-'} ${dir}Tp / 100) : na)`,
      '',
    );
    void sgn;
  }

  const title = m.name.replace(/"/g, "'");
  return [
    '//@version=5',
    `strategy("${title}", overlay=true, initial_capital=10000, default_qty_type=strategy.${m.qtyType}, default_qty_value=${m.qty}, pyramiding=0)`,
    MARKER + JSON.stringify(m),
    '// Generated by the Oviate strategy builder (open it with /visual). Capital, commission and slippage come from the Strategy Tester settings.',
    '// Edit it in the builder; manual changes are lost on the next save from the builder.',
    '',
    '// parameters',
    ...inputs,
    '',
    '// indicator values',
    ...calc,
    ...plots,
    '',
    '// conditions',
    ...conds,
    '',
    '// rules: while flat or opposite, scan the entry; while in the trade, scan the exit',
    ...rules,
  ].join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/** The model stored in a builder-generated strategy, with size and stop loss / take profit as they stand in the code now (the editor's parameter bar changes them). */
export function parseModel(code: string): Model | null {
  const line = code.split('\n').find((l) => l.startsWith(MARKER));
  if (!line) return null;
  let raw: any;
  try { raw = JSON.parse(line.slice(MARKER.length)); } catch { return null; }
  if (raw?.v !== 2) return null;
  const m = normalizeModel(raw);
  const decl = /strategy\s*\(([^\n]*)\)/.exec(code)?.[1] ?? '';
  const t = /default_qty_type\s*=\s*strategy\.(percent_of_equity|cash|fixed)/.exec(decl)?.[1];
  const q = Number(/default_qty_value\s*=\s*([\d.]+)/.exec(decl)?.[1]);
  if (t) m.qtyType = t as Model['qtyType'];
  if (q > 0) m.qty = q;
  for (const [side, s] of [['Long', m.long], ['Short', m.short]] as const) {
    const sl = /input\.float\(\s*([\d.]+)\s*,\s*"(\w+) stop loss %"/g, tp = /input\.float\(\s*([\d.]+)\s*,\s*"(\w+) take profit %"/g;
    for (const x of code.matchAll(sl)) if (x[2] === side) s.sl = Number(x[1]);
    for (const x of code.matchAll(tp)) if (x[2] === side) s.tp = Number(x[1]);
  }
  return m;
}

// ---------------------------------------------------------------- suggestions

/** Levels that mean something for common oscillators: [low, high]. */
const LEVELS: Record<string, [number, number]> = {
  rsi: [30, 70], 'rsi-ma': [30, 70], stoch: [20, 80], 'stoch-rsi': [20, 80], mfi: [20, 80], cci: [-100, 100], 'williams-r': [-80, -20], cmo: [-50, 50],
  'connors-rsi': [10, 90], 'ultimate-oscillator': [30, 70], smi: [-40, 40], fisher: [-1.5, 1.5], 'percent-b': [0, 1], rvi: [-0.5, 0.5],
};
const ZERO_LINE = new Set(['macd', 'ppo', 'apo', 'trix', 'awesome-oscillator', 'accelerator-oscillator', 'momentum', 'roc', 'kst', 'coppock', 'tsi', 'cmf', 'force-index',
  'elder-ray', 'chaikin-oscillator', 'volume-oscillator', 'percent-change', 'linreg-slope', 'dpo', 'bop', 'aroon-oscillator', 'volume-roc', 'vortex']);

export interface Suggestion { label: string; cond: Cond }

/** Ready-made conditions that fit one indicator, built from what it is: price against an overlay, levels of a bounded oscillator, zero line and signal crosses. */
export function suggest(ind: string, i: IndInfo): Suggestion[] {
  const out: Suggestion[] = [];
  const op = (plot: string): Operand => ({ k: 'ind', ind, plot, p: {} });
  const add = (c: Cond) => out.push({ label: condText(c, (n) => (n === ind ? i : undefined)), cond: c });
  const price: Operand = { k: 'price', src: 'close' };
  const main = i.plots[0];
  if (!main) return out;
  if (i.overlay) {
    for (const p of i.plots.slice(0, 3)) {
      add({ l: price, cmp: 'cross_above', r: op(p) }); add({ l: price, cmp: 'cross_below', r: op(p) });
    }
    add({ l: price, cmp: 'above', r: op(main) }); add({ l: price, cmp: 'below', r: op(main) });
    add({ l: op(main), cmp: 'rising' }); add({ l: op(main), cmp: 'falling' });
    return out;
  }
  const lv = LEVELS[ind];
  if (lv) {
    add({ l: op(main), cmp: 'cross_below', r: { k: 'num', v: lv[0] } });
    add({ l: op(main), cmp: 'cross_above', r: { k: 'num', v: lv[1] } });
    add({ l: op(main), cmp: 'cross_above', r: { k: 'num', v: lv[0] } });
    add({ l: op(main), cmp: 'cross_below', r: { k: 'num', v: lv[1] } });
    add({ l: op(main), cmp: 'below', r: { k: 'num', v: lv[0] } });
    add({ l: op(main), cmp: 'above', r: { k: 'num', v: lv[1] } });
  } else if (ZERO_LINE.has(ind) || !i.overlay) {
    add({ l: op(main), cmp: 'cross_above', r: { k: 'num', v: 0 } });
    add({ l: op(main), cmp: 'cross_below', r: { k: 'num', v: 0 } });
    add({ l: op(main), cmp: 'above', r: { k: 'num', v: 0 } });
    add({ l: op(main), cmp: 'below', r: { k: 'num', v: 0 } });
  }
  // two lines of one oscillator (MACD / Signal, %K / %D): crossing each other
  const lines = i.plots.filter((p) => !/hist|volume/i.test(p));
  if (lines.length >= 2) {
    add({ l: op(lines[0]), cmp: 'cross_above', r: op(lines[1]) });
    add({ l: op(lines[0]), cmp: 'cross_below', r: op(lines[1]) });
  }
  add({ l: op(main), cmp: 'rising' }); add({ l: op(main), cmp: 'falling' });
  add({ l: op(main), cmp: 'turn_up' }); add({ l: op(main), cmp: 'turn_down' });
  return out;
}
