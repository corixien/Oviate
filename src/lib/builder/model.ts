// Visual strategy builder: spec model, indicator catalog and Pine code generator.
// A builder strategy is saved as an ordinary .pine file; the spec rides along in a header comment so the builder can reopen it.

export type PriceSrc = 'close' | 'open' | 'high' | 'low' | 'hl2' | 'hlc3' | 'ohlc4' | 'volume';
export type Cmp = 'cross_above' | 'cross_below' | 'above' | 'below' | 'above_eq' | 'below_eq' | 'equals' | 'between' | 'rising' | 'falling';

export type Operand =
  | { k: 'price'; src: PriceSrc }
  | { k: 'ind'; ind: string; p: number[]; out: number }
  | { k: 'num'; v: number };

export interface Cond { t: 'cond'; lhs: Operand; cmp: Cmp; rhs: Operand; rhs2?: Operand }
export interface Group { t: 'group'; op: 'and' | 'or'; items: (Cond | Group)[] }

export interface Side { on: boolean; entry: Group; exit: Group; sl: number; tp: number }

export interface Spec {
  v: 1;
  name: string;
  /** position size per entry: % of equity, units, or cash amount */
  qtyType: 'percent_of_equity' | 'fixed' | 'cash';
  qty: number;
  long: Side;
  short: Side;
}

export interface ParamDef { id: string; label: string; def: number; min?: number; step?: number; float?: boolean }
export interface IndDef {
  key: string;
  label: string;
  group: 'Trend' | 'Momentum' | 'Volatility' | 'Volume';
  /** true: plotted on the price scale inside the strategy; false: shown as its own pane (companion indicator) */
  overlay: boolean;
  params: ParamDef[];
  outputs: string[];
  /** outputs that are not plotted on the chart (e.g. a direction flag) */
  noPlot?: number[];
  /** p: Pine expressions for the parameters, o: output variable names */
  pine: (p: string[], o: string[]) => string[];
  /** bundled indicator used to show this one live in its own pane; titles = its input titles in param order */
  panel?: { id: string; titles: string[] };
}

const len = (def: number): ParamDef => ({ id: 'length', label: 'Length', def, min: 1 });
const ma = (key: string, label: string, fn: string, def: number): IndDef => ({
  key, label, group: 'Trend', overlay: true, params: [len(def)], outputs: [label], pine: (p, o) => [`${o[0]} = ${fn}(close, ${p[0]})`],
});
const osc = (key: string, label: string, panelId: string, fn: string, def: number, src = 'close', group: IndDef['group'] = 'Momentum'): IndDef => ({
  key, label, group, overlay: false, params: [len(def)], outputs: [label], pine: (p, o) => [`${o[0]} = ${fn}(${src === '' ? '' : src + ', '}${p[0]})`],
  panel: { id: panelId, titles: ['Length'] },
});

export const INDICATORS: IndDef[] = [
  ma('sma', 'SMA', 'ta.sma', 20),
  ma('ema', 'EMA', 'ta.ema', 20),
  ma('wma', 'WMA', 'ta.wma', 20),
  ma('hma', 'HMA', 'ta.hma', 20),
  ma('vwma', 'VWMA', 'ta.vwma', 20),
  { key: 'bb', label: 'Bollinger Bands', group: 'Volatility', overlay: true, outputs: ['Basis', 'Upper', 'Lower'],
    params: [len(20), { id: 'mult', label: 'StdDev', def: 2, min: 0.1, step: 0.1, float: true }],
    pine: (p, o) => [`[${o[0]}, ${o[1]}, ${o[2]}] = ta.bb(close, ${p[0]}, ${p[1]})`] },
  { key: 'donchian', label: 'Donchian (prev bar)', group: 'Volatility', overlay: true, outputs: ['Highest', 'Lowest'], params: [len(20)],
    pine: (p, o) => [`${o[0]}_h = ta.highest(high, ${p[0]})`, `${o[1]}_l = ta.lowest(low, ${p[0]})`, `${o[0]} = ${o[0]}_h[1]`, `${o[1]} = ${o[1]}_l[1]`] },
  { key: 'supertrend', label: 'Supertrend', group: 'Trend', overlay: true, outputs: ['Line', 'Direction (-1 up, 1 down)'], noPlot: [1],
    params: [{ id: 'factor', label: 'Factor', def: 3, min: 0.1, step: 0.1, float: true }, len(10)],
    pine: (p, o) => [`[${o[0]}, ${o[1]}] = ta.supertrend(${p[0]}, ${p[1]})`] },
  { key: 'sar', label: 'Parabolic SAR', group: 'Trend', overlay: true, outputs: ['SAR'],
    params: [{ id: 'start', label: 'Start', def: 0.02, step: 0.01, float: true }, { id: 'inc', label: 'Increment', def: 0.02, step: 0.01, float: true }, { id: 'max', label: 'Maximum', def: 0.2, step: 0.01, float: true }],
    pine: (p, o) => [`${o[0]} = ta.sar(${p[0]}, ${p[1]}, ${p[2]})`] },
  osc('rsi', 'RSI', 'rsi', 'ta.rsi', 14),
  { key: 'macd', label: 'MACD', group: 'Momentum', overlay: false, outputs: ['MACD', 'Signal', 'Histogram'],
    params: [{ id: 'fast', label: 'Fast', def: 12, min: 1 }, { id: 'slow', label: 'Slow', def: 26, min: 1 }, { id: 'signal', label: 'Signal', def: 9, min: 1 }],
    pine: (p, o) => [`[${o[0]}, ${o[1]}, ${o[2]}] = ta.macd(close, ${p[0]}, ${p[1]}, ${p[2]})`],
    panel: { id: 'macd', titles: ['Fast Length', 'Slow Length', 'Signal Length'] } },
  { key: 'stoch', label: 'Stochastic', group: 'Momentum', overlay: false, outputs: ['%K', '%D'],
    params: [{ id: 'k', label: '%K', def: 14, min: 1 }, { id: 'smooth', label: 'Smooth', def: 1, min: 1 }, { id: 'd', label: '%D', def: 3, min: 1 }],
    pine: (p, o) => [`${o[0]} = ta.sma(ta.stoch(close, high, low, ${p[0]}), ${p[1]})`, `${o[1]} = ta.sma(${o[0]}, ${p[2]})`],
    panel: { id: 'stoch', titles: ['%K Length', '%K Smoothing', '%D Smoothing'] } },
  { key: 'adx', label: 'ADX / DMI', group: 'Trend', overlay: false, outputs: ['+DI', '-DI', 'ADX'],
    params: [{ id: 'di', label: 'DI', def: 14, min: 1 }, { id: 'smooth', label: 'Smooth', def: 14, min: 1 }],
    pine: (p, o) => [`[${o[0]}, ${o[1]}, ${o[2]}] = ta.dmi(${p[0]}, ${p[1]})`],
    panel: { id: 'adx', titles: ['DI Length', 'ADX Smoothing'] } },
  osc('cci', 'CCI', 'cci', 'ta.cci', 20, 'hlc3'),
  osc('wpr', 'Williams %R', 'williams-r', 'ta.wpr', 14, ''),
  osc('mfi', 'MFI', 'mfi', 'ta.mfi', 14, 'hlc3', 'Volume'),
  osc('mom', 'Momentum', 'momentum', 'ta.mom', 10),
  osc('roc', 'ROC', 'roc', 'ta.roc', 9),
  { key: 'atr', label: 'ATR', group: 'Volatility', overlay: false, outputs: ['ATR'], params: [len(14)], pine: (p, o) => [`${o[0]} = ta.atr(${p[0]})`], panel: { id: 'atr', titles: ['Length'] } },
  { key: 'obv', label: 'OBV', group: 'Volume', overlay: false, outputs: ['OBV'], params: [], pine: (_p, o) => [`${o[0]} = ta.obv`], panel: { id: 'obv', titles: [] } },
];

export const indDef = (key: string): IndDef | undefined => INDICATORS.find((i) => i.key === key);
export const PRICE_SRCS: PriceSrc[] = ['close', 'open', 'high', 'low', 'hl2', 'hlc3', 'ohlc4', 'volume'];

export const CMP_LABEL: Record<Cmp, string> = {
  cross_above: 'crosses above', cross_below: 'crosses below', above: 'is above', below: 'is below', above_eq: 'is at or above', below_eq: 'is at or below',
  equals: 'equals', between: 'is between', rising: 'is rising for (bars)', falling: 'is falling for (bars)',
};

// ---------- constructors ----------
export const emptyGroup = (op: 'and' | 'or' = 'and'): Group => ({ t: 'group', op, items: [] });
export const defaultParams = (key: string): number[] => (indDef(key)?.params ?? []).map((p) => p.def);
export const indOperand = (ind: string, out = 0, p?: number[]): Operand => ({ k: 'ind', ind, p: p ?? defaultParams(ind), out });
export const priceOperand = (src: PriceSrc = 'close'): Operand => ({ k: 'price', src });
export const numOperand = (v = 0): Operand => ({ k: 'num', v });
export const cond = (lhs: Operand, cmp: Cmp, rhs: Operand, rhs2?: Operand): Cond => ({ t: 'cond', lhs, cmp, rhs, ...(rhs2 ? { rhs2 } : {}) });

export function defaultSpec(): Spec {
  const fast = indOperand('ema', 0, [20]), slow = indOperand('ema', 0, [50]);
  const grp = (c: Cond): Group => ({ t: 'group', op: 'and', items: [c] });
  return {
    v: 1, name: 'My Builder Strategy', qtyType: 'percent_of_equity', qty: 100,
    long: { on: true, entry: grp(cond(fast, 'cross_above', slow)), exit: grp(cond(fast, 'cross_below', slow)), sl: 0, tp: 0 },
    short: { on: false, entry: grp(cond(fast, 'cross_below', slow)), exit: grp(cond(fast, 'cross_above', slow)), sl: 0, tp: 0 },
  };
}

// ---------- readable labels ----------
export function operandLabel(o: Operand): string {
  if (o.k === 'num') return String(o.v);
  if (o.k === 'price') return o.src;
  const d = indDef(o.ind);
  if (!d) return o.ind;
  const out = d.outputs.length > 1 ? ' ' + d.outputs[o.out] : '';
  return `${d.label}(${o.p.join(',')})${out}`;
}

// ---------- code generation ----------
interface Inst { sig: string; n: number; def: IndDef; p: number[]; vars: string[]; pvars: string[] }

const walkOperands = (g: Group, f: (o: Operand) => void) => {
  for (const it of g.items) {
    if (it.t === 'group') walkOperands(it, f);
    else { f(it.lhs); f(it.rhs); if (it.rhs2) f(it.rhs2); }
  }
};

function collect(spec: Spec): Inst[] {
  const out: Inst[] = [];
  const see = (o: Operand) => {
    if (o.k !== 'ind') return;
    const def = indDef(o.ind);
    if (!def) return;
    const p = def.params.map((d, i) => (Number.isFinite(o.p[i]) ? o.p[i] : d.def));
    const sig = def.key + '|' + p.join(',');
    if (out.some((i) => i.sig === sig)) return;
    const n = out.length + 1;
    out.push({ sig, n, def, p, vars: def.outputs.map((_, k) => `i${n}_${k}`), pvars: def.params.map((_, k) => `i${n}_p${k}`) });
  };
  for (const side of [spec.long, spec.short]) { walkOperands(side.entry, see); walkOperands(side.exit, see); }
  return out;
}

const num = (v: number) => (Number.isFinite(v) ? String(v) : '0');
const q = (s: string) => s.replace(/["\\\r\n]/g, "'");
const instTitle = (i: Inst) => `${i.def.label}(${i.p.join(',')})`;
const PALETTE = ['aqua', 'orange', 'fuchsia', 'yellow', 'lime', 'blue', 'purple', 'red'];

export function generate(spec: Spec): string {
  const insts = collect(spec);
  const ref = (o: Operand): string => {
    if (o.k === 'num') return num(o.v);
    if (o.k === 'price') return o.src;
    const def = indDef(o.ind);
    const sig = def ? def.key + '|' + def.params.map((d, i) => (Number.isFinite(o.p[i]) ? o.p[i] : d.def)).join(',') : '';
    const inst = insts.find((i) => i.sig === sig);
    return inst ? inst.vars[Math.min(Math.max(0, o.out), inst.vars.length - 1)] : 'na';
  };
  const condExpr = (c: Cond): string => {
    const a = ref(c.lhs), b = ref(c.rhs);
    switch (c.cmp) {
      case 'cross_above': return `ta.crossover(${a}, ${b})`;
      case 'cross_below': return `ta.crossunder(${a}, ${b})`;
      case 'above': return `(${a} > ${b})`;
      case 'below': return `(${a} < ${b})`;
      case 'above_eq': return `(${a} >= ${b})`;
      case 'below_eq': return `(${a} <= ${b})`;
      case 'equals': return `(math.abs(${a} - ${b}) <= 0.000001)`;
      case 'between': { const hi = c.rhs2 ? ref(c.rhs2) : b; return `(${a} >= math.min(${b}, ${hi}) and ${a} <= math.max(${b}, ${hi}))`; }
      case 'rising': return `ta.rising(${a}, ${Math.max(1, Math.trunc(c.rhs.k === 'num' ? c.rhs.v : 1))})`;
      case 'falling': return `ta.falling(${a}, ${Math.max(1, Math.trunc(c.rhs.k === 'num' ? c.rhs.v : 1))})`;
    }
  };
  const groupExpr = (g: Group): string => {
    const parts = g.items.map((it) => (it.t === 'group' ? groupExpr(it) : condExpr(it))).filter((s) => s !== 'false');
    if (!parts.length) return 'false';
    return parts.length === 1 ? parts[0] : '(' + parts.join(g.op === 'and' ? ' and ' : ' or ') + ')';
  };

  const L: string[] = [];
  L.push('//@version=5');
  L.push(`strategy("${q(spec.name) || 'Builder Strategy'}", overlay=true, initial_capital=10000, default_qty_type=strategy.${spec.qtyType}, default_qty_value=${num(spec.qty)}, pyramiding=0)`);
  L.push('// @oviate-builder ' + JSON.stringify(spec));
  L.push('// Generated by the Oviate strategy builder. Capital, commission and slippage come from the Strategy Tester settings.');
  L.push('// Edit it in the builder; manual changes are lost on the next save from the builder.');
  L.push('');
  const lines: string[] = [];
  for (const i of insts) {
    i.def.params.forEach((pd, k) => {
      const title = `${instTitle(i)} ${pd.label}`;
      const extra = [pd.min !== undefined ? `minval=${pd.min}` : '', pd.step !== undefined ? `step=${pd.step}` : ''].filter(Boolean).join(', ');
      lines.push(`${i.pvars[k]} = input.${pd.float ? 'float' : 'int'}(${num(i.p[k])}, "${q(title)}"${extra ? ', ' + extra : ''})`);
    });
  }
  if (lines.length) L.push('// parameters', ...lines, '');
  if (insts.length) {
    L.push('// indicators');
    for (const i of insts) L.push(...i.def.pine(i.pvars, i.vars));
    for (const i of insts) {
      if (!i.def.overlay) continue;
      i.def.outputs.forEach((out, k) => {
        if (i.def.noPlot?.includes(k)) return;
        L.push(`plot(${i.vars[k]}, "${q(instTitle(i) + (i.def.outputs.length > 1 ? ' ' + out : ''))}", color=color.${PALETTE[(i.n + k) % PALETTE.length]})`);
      });
    }
    L.push('');
  }
  L.push('// scenarios');
  const sides: [string, 'long' | 'short', Side][] = [['long', 'long', spec.long], ['short', 'short', spec.short]];
  for (const [nm, , s] of sides) {
    if (!s.on) continue;
    L.push(`${nm}Entry = ${groupExpr(s.entry)}`, `${nm}Exit = ${groupExpr(s.exit)}`);
    L.push(`${nm}Sl = input.float(${num(s.sl)}, "${nm === 'long' ? 'Long' : 'Short'} stop loss %", minval=0, step=0.1)`);
    L.push(`${nm}Tp = input.float(${num(s.tp)}, "${nm === 'long' ? 'Long' : 'Short'} take profit %", minval=0, step=0.1)`);
  }
  L.push('');
  L.push('// rules: while flat or opposite, scan the entry; while in the trade, scan the exit');
  for (const [nm, dir, s] of sides) {
    if (!s.on) continue;
    const Id = nm === 'long' ? 'Long' : 'Short';
    const inPos = dir === 'long' ? 'strategy.position_size > 0' : 'strategy.position_size < 0';
    const notIn = dir === 'long' ? 'strategy.position_size <= 0' : 'strategy.position_size >= 0';
    L.push(`if ${nm}Exit and ${inPos}`, `    strategy.close("${Id}", comment="${Id} exit")`);
    L.push(`if ${nm}Entry and ${notIn}`, `    strategy.entry("${Id}", strategy.${dir}, comment="${Id} entry")`);
    const sgn = dir === 'long' ? ['1 - ', '1 + '] : ['1 + ', '1 - '];
    L.push(`if ${inPos}`);
    L.push(`    strategy.exit("${Id} SL/TP", "${Id}", stop=${nm}Sl > 0 ? strategy.position_avg_price * (${sgn[0]}${nm}Sl / 100) : na, limit=${nm}Tp > 0 ? strategy.position_avg_price * (${sgn[1]}${nm}Tp / 100) : na)`);
  }
  return L.join('\n') + '\n';
}

/** Companion indicators that show the oscillators of a spec live in their own panes. */
export function companions(spec: Spec): { id: string; params: Record<string, number> }[] {
  const out: { id: string; params: Record<string, number> }[] = [];
  for (const i of collect(spec)) {
    const pn = i.def.panel;
    if (!pn || i.def.overlay) continue;
    const params: Record<string, number> = {};
    pn.titles.forEach((t, k) => { params[t] = i.p[k]; });
    if (!out.some((o) => o.id === pn.id && JSON.stringify(o.params) === JSON.stringify(params))) out.push({ id: pn.id, params });
  }
  return out;
}

const HEADER = /^\/\/ @oviate-builder (.+)$/m;
/** Recover the spec from a saved builder script; null for ordinary Pine files. */
export function parseSpec(code: string): Spec | null {
  const m = HEADER.exec(code);
  if (!m) return null;
  try {
    const s = JSON.parse(m[1]);
    if (s && s.v === 1 && s.long && s.short) {
      for (const k of ['capital', 'commission', 'slippage']) delete s[k]; // legacy fields: now Strategy Tester settings
      if (!['percent_of_equity', 'fixed', 'cash'].includes(s.qtyType) || !Number.isFinite(s.qty)) { s.qtyType = 'percent_of_equity'; s.qty = 100; }
      return s as Spec;
    }
  } catch { /* corrupt header: treat as plain Pine */ }
  return null;
}
