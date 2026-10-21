// Visual strategy builder: spec model, indicator catalog and Pine code generator.
// A builder strategy is saved as an ordinary .pine file; the spec rides along in a header comment so the builder can reopen it.

export type PriceSrc = 'close' | 'open' | 'high' | 'low' | 'hl2' | 'hlc3' | 'ohlc4' | 'volume';
/** Scenario id: what the condition checks (see SCENARIOS / PRICE_SC / GENERIC). */
export type Cmp = string;

export type Operand =
  | { k: 'price'; src: PriceSrc }
  | { k: 'ind'; ind: string; p: number[]; out: number }
  | { k: 'num'; v: number };

/** Free-text condition: `text` is what the user wants, `code` the Pine generated from it (IND0, IND1 ... stand for the subject's outputs). */
export interface AiCond { text: string; code: string; uid: string }
export interface Cond { t: 'cond'; lhs: Operand; cmp: Cmp; rhs: Operand; rhs2?: Operand; ai?: AiCond }
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

// ---------- scenarios: what each indicator can do ----------
export interface ArgDef { label: string; /** number only (no indicator choice) */ num?: boolean; /** whole number >= 1 */ int?: boolean; def: () => Operand }
export interface Scenario {
  id: string;
  label: string;
  args?: ArgDef[];
  /** generic "compare one output" scenario: the output is picked next to the indicator */
  adv?: boolean;
  /** o: output variable names of the subject, a: argument expressions, out: selected output index */
  code: (o: string[], a: string[], out: number) => string;
}

const lvl = (label: string, v: number): ArgDef => ({ label, num: true, def: () => numOperand(v) });
const bars = (label = 'bars', v = 3): ArgDef => ({ label, num: true, int: true, def: () => numOperand(v) });
const opnd = (label: string, f: () => Operand): ArgDef => ({ label, def: f });

/** Compare one value with another: works for every single line. Ids are stable (saved in specs). */
export const GENERIC: Scenario[] = [
  { id: 'cross_above', label: 'crosses above', args: [opnd('value', () => numOperand(0))], code: (o, a, k) => `ta.crossover(${o[k]}, ${a[0]})` },
  { id: 'cross_below', label: 'crosses below', args: [opnd('value', () => numOperand(0))], code: (o, a, k) => `ta.crossunder(${o[k]}, ${a[0]})` },
  { id: 'above', label: 'is above', args: [opnd('value', () => numOperand(0))], code: (o, a, k) => `(${o[k]} > ${a[0]})` },
  { id: 'below', label: 'is below', args: [opnd('value', () => numOperand(0))], code: (o, a, k) => `(${o[k]} < ${a[0]})` },
  { id: 'above_eq', label: 'is at or above', args: [opnd('value', () => numOperand(0))], code: (o, a, k) => `(${o[k]} >= ${a[0]})` },
  { id: 'below_eq', label: 'is at or below', args: [opnd('value', () => numOperand(0))], code: (o, a, k) => `(${o[k]} <= ${a[0]})` },
  { id: 'equals', label: 'equals', args: [opnd('value', () => numOperand(0))], code: (o, a, k) => `(math.abs(${o[k]} - ${a[0]}) <= 0.000001)` },
  { id: 'between', label: 'is between', args: [opnd('from', () => numOperand(30)), opnd('to', () => numOperand(70))], code: (o, a, k) => `(${o[k]} >= math.min(${a[0]}, ${a[1]}) and ${o[k]} <= math.max(${a[0]}, ${a[1]}))` },
  { id: 'rising', label: 'is rising for (bars)', args: [bars()], code: (o, a, k) => `ta.rising(${o[k]}, ${a[0]})` },
  { id: 'falling', label: 'is falling for (bars)', args: [bars()], code: (o, a, k) => `ta.falling(${o[k]}, ${a[0]})` },
];
const generic = (id: string) => GENERIC.find((g) => g.id === id)!;
const advanced = (): Scenario[] => GENERIC.map((g) => ({ ...g, adv: true, label: 'Compare output: ' + g.label }));

interface LineOpts {
  /** true: arguments may be another indicator / price; false: plain level numbers */
  operand?: boolean;
  opDef?: () => Operand;
  crossUp?: number; crossDn?: number; above?: number; below?: number; lo?: number; hi?: number;
  labels?: { crossUp?: string; crossDn?: string; above?: string; below?: string };
}
/** Scenarios for a single line (RSI, CCI, moving average ...), with levels that suit the indicator. */
function lineSc(o: LineOpts = {}): Scenario[] {
  const arg = (label: string, v: number): ArgDef => (o.operand ? opnd(label, o.opDef ?? (() => numOperand(v))) : lvl(label, v));
  const L = o.labels ?? {};
  const noun = o.operand ? '' : ' level';
  const mk = (id: string, label: string, v: number): Scenario => ({ ...generic(id), label, args: [arg(o.operand ? 'than' : 'level', v)] });
  return [
    mk('cross_above', L.crossUp ?? 'crosses above' + noun, o.crossUp ?? 0),
    mk('cross_below', L.crossDn ?? 'crosses below' + noun, o.crossDn ?? 0),
    mk('above', L.above ?? 'is above' + noun, o.above ?? 0),
    mk('below', L.below ?? 'is below' + noun, o.below ?? 0),
    { ...generic('between'), label: 'is between levels', args: [lvl('from', o.lo ?? 30), lvl('to', o.hi ?? 70)] },
    generic('rising'), generic('falling'),
  ];
}

const maSc = (): Scenario[] => [
  { id: 'price_cross_above', label: 'Price crosses above it', code: (o) => `ta.crossover(close, ${o[0]})` },
  { id: 'price_cross_below', label: 'Price crosses below it', code: (o) => `ta.crossunder(close, ${o[0]})` },
  { id: 'price_above', label: 'Price is above it', code: (o) => `(close > ${o[0]})` },
  { id: 'price_below', label: 'Price is below it', code: (o) => `(close < ${o[0]})` },
  ...lineSc({ operand: true, opDef: () => indOperand('ema', 0, [50]), labels: { crossUp: 'crosses above another line', crossDn: 'crosses below another line', above: 'is above another line', below: 'is below another line' } }).filter((x) => x.id !== 'between'),
];

/** Scenarios per indicator key. Anything not listed falls back to the generic compare list. */
export const SCENARIOS: Record<string, Scenario[]> = {
  sma: maSc(), ema: maSc(), wma: maSc(), hma: maSc(), vwma: maSc(),
  rsi: lineSc({ crossUp: 30, crossDn: 70, above: 70, below: 30, lo: 40, hi: 60, labels: { crossUp: 'leaves oversold (crosses above level)', crossDn: 'leaves overbought (crosses below level)', above: 'is overbought (above level)', below: 'is oversold (below level)' } }),
  cci: lineSc({ crossUp: -100, crossDn: 100, above: 100, below: -100, lo: -100, hi: 100, labels: { crossUp: 'leaves oversold (crosses above level)', crossDn: 'leaves overbought (crosses below level)', above: 'is overbought (above level)', below: 'is oversold (below level)' } }),
  wpr: lineSc({ crossUp: -80, crossDn: -20, above: -20, below: -80, lo: -80, hi: -20, labels: { crossUp: 'leaves oversold (crosses above level)', crossDn: 'leaves overbought (crosses below level)', above: 'is overbought (above level)', below: 'is oversold (below level)' } }),
  mfi: lineSc({ crossUp: 20, crossDn: 80, above: 80, below: 20, lo: 40, hi: 60, labels: { crossUp: 'leaves oversold (crosses above level)', crossDn: 'leaves overbought (crosses below level)', above: 'is overbought (above level)', below: 'is oversold (below level)' } }),
  mom: lineSc({ crossUp: 0, crossDn: 0, above: 0, below: 0, lo: -1, hi: 1, labels: { crossUp: 'turns positive (crosses above level)', crossDn: 'turns negative (crosses below level)', above: 'is positive (above level)', below: 'is negative (below level)' } }),
  roc: lineSc({ crossUp: 0, crossDn: 0, above: 0, below: 0, lo: -1, hi: 1, labels: { crossUp: 'turns positive (crosses above level)', crossDn: 'turns negative (crosses below level)', above: 'is positive (above level)', below: 'is negative (below level)' } }),
  atr: [
    { ...generic('above'), label: 'volatility is above level', args: [lvl('level', 1)] },
    { ...generic('below'), label: 'volatility is below level', args: [lvl('level', 1)] },
    { ...generic('rising'), label: 'volatility is rising for (bars)' },
    { ...generic('falling'), label: 'volatility is falling for (bars)' },
  ],
  obv: [
    { id: 'rising', label: 'is rising for (bars)', args: [bars()], code: (o, a) => `ta.rising(${o[0]}, ${a[0]})` },
    { id: 'falling', label: 'is falling for (bars)', args: [bars()], code: (o, a) => `ta.falling(${o[0]}, ${a[0]})` },
    { id: 'above_ma', label: 'is above its average (bars)', args: [bars('average', 20)], code: (o, a) => `(${o[0]} > ta.sma(${o[0]}, ${a[0]}))` },
    { id: 'below_ma', label: 'is below its average (bars)', args: [bars('average', 20)], code: (o, a) => `(${o[0]} < ta.sma(${o[0]}, ${a[0]}))` },
  ],
  stoch: [
    { id: 'k_cross_above_d', label: '%K crosses above %D', code: (o) => `ta.crossover(${o[0]}, ${o[1]})` },
    { id: 'k_cross_below_d', label: '%K crosses below %D', code: (o) => `ta.crossunder(${o[0]}, ${o[1]})` },
    { id: 'bull_cross_oversold', label: '%K crosses above %D while oversold', args: [lvl('below', 20)], code: (o, a) => `(ta.crossover(${o[0]}, ${o[1]}) and ${o[0]} < ${a[0]})` },
    { id: 'bear_cross_overbought', label: '%K crosses below %D while overbought', args: [lvl('above', 80)], code: (o, a) => `(ta.crossunder(${o[0]}, ${o[1]}) and ${o[0]} > ${a[0]})` },
    { id: 'oversold', label: '%K is oversold (below level)', args: [lvl('level', 20)], code: (o, a) => `(${o[0]} < ${a[0]})` },
    { id: 'overbought', label: '%K is overbought (above level)', args: [lvl('level', 80)], code: (o, a) => `(${o[0]} > ${a[0]})` },
    { id: 'leave_oversold', label: '%K leaves oversold (crosses above level)', args: [lvl('level', 20)], code: (o, a) => `ta.crossover(${o[0]}, ${a[0]})` },
    { id: 'leave_overbought', label: '%K leaves overbought (crosses below level)', args: [lvl('level', 80)], code: (o, a) => `ta.crossunder(${o[0]}, ${a[0]})` },
    { id: 'k_above_d', label: '%K is above %D', code: (o) => `(${o[0]} > ${o[1]})` },
    { id: 'k_below_d', label: '%K is below %D', code: (o) => `(${o[0]} < ${o[1]})` },
    ...advanced(),
  ],
  macd: [
    { id: 'cross_above_signal', label: 'MACD crosses above signal', code: (o) => `ta.crossover(${o[0]}, ${o[1]})` },
    { id: 'cross_below_signal', label: 'MACD crosses below signal', code: (o) => `ta.crossunder(${o[0]}, ${o[1]})` },
    { id: 'above_signal', label: 'MACD is above signal', code: (o) => `(${o[0]} > ${o[1]})` },
    { id: 'below_signal', label: 'MACD is below signal', code: (o) => `(${o[0]} < ${o[1]})` },
    { id: 'cross_above_zero', label: 'MACD crosses above zero', code: (o) => `ta.crossover(${o[0]}, 0)` },
    { id: 'cross_below_zero', label: 'MACD crosses below zero', code: (o) => `ta.crossunder(${o[0]}, 0)` },
    { id: 'above_zero', label: 'MACD is above zero', code: (o) => `(${o[0]} > 0)` },
    { id: 'below_zero', label: 'MACD is below zero', code: (o) => `(${o[0]} < 0)` },
    { id: 'hist_pos', label: 'Histogram turns positive', code: (o) => `ta.crossover(${o[2]}, 0)` },
    { id: 'hist_neg', label: 'Histogram turns negative', code: (o) => `ta.crossunder(${o[2]}, 0)` },
    { id: 'hist_rising', label: 'Histogram is rising for (bars)', args: [bars()], code: (o, a) => `ta.rising(${o[2]}, ${a[0]})` },
    { id: 'hist_falling', label: 'Histogram is falling for (bars)', args: [bars()], code: (o, a) => `ta.falling(${o[2]}, ${a[0]})` },
    ...advanced(),
  ],
  bb: [
    { id: 'cross_above_lower', label: 'Price crosses back above the lower band (bounce)', code: (o) => `ta.crossover(close, ${o[2]})` },
    { id: 'cross_below_upper', label: 'Price crosses back below the upper band (rejection)', code: (o) => `ta.crossunder(close, ${o[1]})` },
    { id: 'close_above_upper', label: 'Price closes above the upper band (breakout)', code: (o) => `(close > ${o[1]})` },
    { id: 'close_below_lower', label: 'Price closes below the lower band (breakdown)', code: (o) => `(close < ${o[2]})` },
    { id: 'touch_lower', label: 'Price touches the lower band', code: (o) => `(low <= ${o[2]})` },
    { id: 'touch_upper', label: 'Price touches the upper band', code: (o) => `(high >= ${o[1]})` },
    { id: 'cross_above_basis', label: 'Price crosses above the middle line', code: (o) => `ta.crossover(close, ${o[0]})` },
    { id: 'cross_below_basis', label: 'Price crosses below the middle line', code: (o) => `ta.crossunder(close, ${o[0]})` },
    { id: 'squeeze', label: 'Bands squeeze (width below % of price)', args: [lvl('width %', 4)], code: (o, a) => `((${o[1]} - ${o[2]}) / ${o[0]} * 100 < ${a[0]})` },
    { id: 'expand', label: 'Bands are wide (width above % of price)', args: [lvl('width %', 8)], code: (o, a) => `((${o[1]} - ${o[2]}) / ${o[0]} * 100 > ${a[0]})` },
    ...advanced(),
  ],
  donchian: [
    { id: 'break_high', label: 'Price breaks above the channel high (breakout)', code: (o) => `ta.crossover(close, ${o[0]})` },
    { id: 'break_low', label: 'Price breaks below the channel low (breakdown)', code: (o) => `ta.crossunder(close, ${o[1]})` },
    { id: 'above_high', label: 'Price is above the channel high', code: (o) => `(close > ${o[0]})` },
    { id: 'below_low', label: 'Price is below the channel low', code: (o) => `(close < ${o[1]})` },
    ...advanced(),
  ],
  supertrend: [
    { id: 'up', label: 'is up (bullish)', code: (o) => `(${o[1]} < 0)` },
    { id: 'down', label: 'is down (bearish)', code: (o) => `(${o[1]} > 0)` },
    { id: 'flip_up', label: 'flips to up', code: (o) => `ta.crossunder(${o[1]}, 0)` },
    { id: 'flip_down', label: 'flips to down', code: (o) => `ta.crossover(${o[1]}, 0)` },
    { id: 'price_above', label: 'Price is above the line', code: (o) => `(close > ${o[0]})` },
    { id: 'price_below', label: 'Price is below the line', code: (o) => `(close < ${o[0]})` },
  ],
  sar: [
    { id: 'flip_bull', label: 'flips to bullish (price crosses above SAR)', code: (o) => `ta.crossover(close, ${o[0]})` },
    { id: 'flip_bear', label: 'flips to bearish (price crosses below SAR)', code: (o) => `ta.crossunder(close, ${o[0]})` },
    { id: 'bull', label: 'is bullish (price above SAR)', code: (o) => `(close > ${o[0]})` },
    { id: 'bear', label: 'is bearish (price below SAR)', code: (o) => `(close < ${o[0]})` },
  ],
  adx: [
    { id: 'di_bull_cross', label: '+DI crosses above -DI (bullish)', code: (o) => `ta.crossover(${o[0]}, ${o[1]})` },
    { id: 'di_bear_cross', label: '-DI crosses above +DI (bearish)', code: (o) => `ta.crossover(${o[1]}, ${o[0]})` },
    { id: 'di_bull', label: '+DI is above -DI', code: (o) => `(${o[0]} > ${o[1]})` },
    { id: 'di_bear', label: '-DI is above +DI', code: (o) => `(${o[1]} > ${o[0]})` },
    { id: 'strong_bull', label: 'Strong uptrend (ADX above level, +DI above -DI)', args: [lvl('ADX', 25)], code: (o, a) => `(${o[2]} > ${a[0]} and ${o[0]} > ${o[1]})` },
    { id: 'strong_bear', label: 'Strong downtrend (ADX above level, -DI above +DI)', args: [lvl('ADX', 25)], code: (o, a) => `(${o[2]} > ${a[0]} and ${o[1]} > ${o[0]})` },
    { id: 'strong', label: 'Trend is strong (ADX above level)', args: [lvl('level', 25)], code: (o, a) => `(${o[2]} > ${a[0]})` },
    { id: 'weak', label: 'Trend is weak (ADX below level)', args: [lvl('level', 20)], code: (o, a) => `(${o[2]} < ${a[0]})` },
    { id: 'adx_rising', label: 'ADX is rising for (bars)', args: [bars()], code: (o, a) => `ta.rising(${o[2]}, ${a[0]})` },
    { id: 'adx_falling', label: 'ADX is falling for (bars)', args: [bars()], code: (o, a) => `ta.falling(${o[2]}, ${a[0]})` },
    ...advanced(),
  ],
};

/** Scenarios when the subject is a price (close, high, ...). */
export const PRICE_SC: Scenario[] = [
  ...lineSc({ operand: true, opDef: () => indOperand('ema', 0, [20]), labels: { crossUp: 'crosses above', crossDn: 'crosses below', above: 'is above', below: 'is below' } }).filter((x) => x.id !== 'between'),
  { id: 'bullish_candle', label: 'candle is bullish (close above open)', code: () => '(close > open)' },
  { id: 'bearish_candle', label: 'candle is bearish (close below open)', code: () => '(close < open)' },
  { id: 'new_high', label: 'closes above the previous high of (bars)', args: [bars('bars', 20)], code: (_o, a) => `(close > ta.highest(high[1], ${a[0]}))` },
  { id: 'new_low', label: 'closes below the previous low of (bars)', args: [bars('bars', 20)], code: (_o, a) => `(close < ta.lowest(low[1], ${a[0]}))` },
  generic('between'),
];

/** Last choice of every list: describe the condition in words, the AI writes the Pine. */
export const AI_ID = 'ai';
const AI_SC: Scenario = { id: AI_ID, label: 'Describe in words (AI)', code: () => 'false' };

/** What the condition can check, depending on its subject. */
export function scenariosFor(lhs: Operand): Scenario[] {
  const own = lhs.k === 'ind' ? SCENARIOS[lhs.ind] ?? GENERIC : lhs.k === 'price' ? PRICE_SC : GENERIC;
  return [...own, AI_SC];
}
export function scenarioFor(lhs: Operand, id: string): Scenario {
  return scenariosFor(lhs).find((s) => s.id === id) ?? GENERIC.find((s) => s.id === id) ?? GENERIC[0];
}
/** Condition for a subject with the scenario's default arguments. */
export function scenarioCond(lhs: Operand, id?: string, keep?: AiCond): Cond {
  const s = id ? scenarioFor(lhs, id) : scenariosFor(lhs)[0];
  if (s.id === AI_ID) return { t: 'cond', lhs, cmp: AI_ID, rhs: numOperand(0), ai: keep ?? { text: '', code: '', uid: crypto.randomUUID() } };
  return { t: 'cond', lhs, cmp: s.id, rhs: s.args?.[0] ? s.args[0].def() : numOperand(0), ...(s.args?.[1] ? { rhs2: s.args[1].def() } : {}) };
}

/** Describe an indicator subject for the AI: name, parameters and what IND0.. mean. */
export function subjectInfo(lhs: Operand): { name: string; outputs: string[] } {
  if (lhs.k === 'price') return { name: `price (${lhs.src})`, outputs: [lhs.src] };
  if (lhs.k === 'num') return { name: 'a fixed value', outputs: [String(lhs.v)] };
  const d = indDef(lhs.ind);
  if (!d) return { name: lhs.ind, outputs: [] };
  return { name: `${d.label}(${lhs.p.join(', ')})`, outputs: d.outputs };
}

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
  const fns: string[] = [];
  const condExpr = (c: Cond): string => {
    if (c.cmp === AI_ID) {
      const code = c.ai?.code.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim()).join('\n') ?? '';
      if (!code) return 'false';
      let names: string[];
      if (c.lhs.k === 'ind') {
        const def = indDef(c.lhs.ind);
        const p = c.lhs.p;
        const sig = def ? def.key + '|' + def.params.map((d, i) => (Number.isFinite(p[i]) ? p[i] : d.def)).join(',') : '';
        names = insts.find((i) => i.sig === sig)?.vars ?? ['na'];
      } else names = [ref(c.lhs)];
      const body = code.replace(/\bIND(\d)\b/g, (_m, k) => names[Math.min(Number(k), names.length - 1)]);
      const fn = `ai${fns.length + 1}`;
      fns.push(`${fn}() =>`, ...body.split('\n').map((l) => '    ' + l));
      return `${fn}()`;
    }
    const sc = scenarioFor(c.lhs, c.cmp);
    let o: string[];
    if (c.lhs.k === 'ind') {
      const def = indDef(c.lhs.ind);
      const sig = def ? def.key + '|' + def.params.map((d, i) => (Number.isFinite((c.lhs as { p: number[] }).p[i]) ? (c.lhs as { p: number[] }).p[i] : d.def)).join(',') : '';
      o = insts.find((i) => i.sig === sig)?.vars ?? ['na'];
    } else o = [ref(c.lhs)];
    const out = c.lhs.k === 'ind' ? Math.min(Math.max(0, c.lhs.out), o.length - 1) : 0;
    const a = (sc.args ?? []).map((d, i) => {
      const opd = i === 0 ? c.rhs : c.rhs2;
      if (!opd) return '0';
      if (d.int) return String(Math.max(1, Math.trunc(opd.k === 'num' ? opd.v : 1)));
      return ref(opd);
    });
    return sc.code(o, a, out);
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
  const S: string[] = [];
  S.push('// scenarios');
  const sides: [string, 'long' | 'short', Side][] = [['long', 'long', spec.long], ['short', 'short', spec.short]];
  for (const [nm, , s] of sides) {
    if (!s.on) continue;
    S.push(`${nm}Entry = ${groupExpr(s.entry)}`, `${nm}Exit = ${groupExpr(s.exit)}`);
    S.push(`${nm}Sl = input.float(${num(s.sl)}, "${nm === 'long' ? 'Long' : 'Short'} stop loss %", minval=0, step=0.1)`);
    S.push(`${nm}Tp = input.float(${num(s.tp)}, "${nm === 'long' ? 'Long' : 'Short'} take profit %", minval=0, step=0.1)`);
  }
  S.push('');
  S.push('// rules: while flat or opposite, scan the entry; while in the trade, scan the exit');
  for (const [nm, dir, s] of sides) {
    if (!s.on) continue;
    const Id = nm === 'long' ? 'Long' : 'Short';
    const inPos = dir === 'long' ? 'strategy.position_size > 0' : 'strategy.position_size < 0';
    const notIn = dir === 'long' ? 'strategy.position_size <= 0' : 'strategy.position_size >= 0';
    S.push(`if ${nm}Exit and ${inPos}`, `    strategy.close("${Id}", comment="${Id} exit")`);
    S.push(`if ${nm}Entry and ${notIn}`, `    strategy.entry("${Id}", strategy.${dir}, comment="${Id} entry")`);
    const sgn = dir === 'long' ? ['1 - ', '1 + '] : ['1 + ', '1 - '];
    S.push(`if ${inPos}`);
    S.push(`    strategy.exit("${Id} SL/TP", "${Id}", stop=${nm}Sl > 0 ? strategy.position_avg_price * (${sgn[0]}${nm}Sl / 100) : na, limit=${nm}Tp > 0 ? strategy.position_avg_price * (${sgn[1]}${nm}Tp / 100) : na)`);
  }
  if (fns.length) L.push('// AI conditions (generated from text)', ...fns, '');
  L.push(...S);
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
