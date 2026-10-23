// Native function registry: math, str, array, color, input, plot*, request, misc. ta.* lives in ta.ts.
import type { PineCandles, PineInput, PlotOut, ShapeOut, HLineOut, FillOut, PineMeta } from './types.ts';
import { TA, TA_VARS } from './ta.ts';

export interface Ctx extends PineCandles {
  bar: number;
  /** time in milliseconds (Pine convention) */
  tms: Float64Array;
  params: Record<string, any>;
  inputs: PineInput[];
  plots: PlotOut[];
  shapes: ShapeOut[];
  hlines: HLineOut[];
  fills: FillOut[];
  bgcolors: (string | undefined)[];
  barcolors: (string | undefined)[];
  warnings: string[];
  meta: PineMeta;
  step: number;
  symbol: string;
  mintick: number;
  broker?: any;
  /** Strategy Tester overrides for strategy() */
  brokerCfg?: import('./types.ts').TesterSettings;
  /** sources of the library indicators this run may read through oviate.ind (else the thread's registry is used) */
  lib?: Record<string, string>;
  /** results of oviate.ind runs, per indicator and input set */
  indCache?: Map<string, import('./types.ts').PineResult>;
  seriesByName(name: string): Float64Array | undefined;
}

export interface Native {
  params: string[];
  fn: (a: any[], x: Ctx, st: Record<string, any>, call: any) => any;
}

export const NATIVES: Record<string, Native> = { ...TA };
const NaN_ = Number.NaN;
export const isNa = (v: unknown) => v === undefined || v === null || (typeof v === 'number' && Number.isNaN(v));
export const truthy = (v: unknown) => v === true || (typeof v === 'number' && v !== 0 && !Number.isNaN(v));

function def(name: string, params: string[], fn: Native['fn']) { NATIVES[name] = { params, fn }; }

// ---------------- constants ----------------
export const COLORS: Record<string, string> = {
  aqua: '#00BCD4', black: '#363A45', blue: '#2962FF', fuchsia: '#E040FB', gray: '#787B86', green: '#4CAF50', lime: '#00E676',
  maroon: '#880E4F', navy: '#311B92', olive: '#808000', orange: '#FF9800', purple: '#9C27B0', red: '#FF5252', silver: '#B2B5BE',
  teal: '#00897B', white: '#FFFFFF', yellow: '#FDD835',
};

export const CONSTS: Record<string, any> = {
  'math.pi': Math.PI, 'math.e': Math.E, 'math.phi': 1.6180339887498949, 'math.rphi': 0.6180339887498949,
  'plot.style_line': 'line', 'plot.style_histogram': 'histogram', 'plot.style_columns': 'columns', 'plot.style_circles': 'circles',
  'plot.style_cross': 'cross', 'plot.style_area': 'area', 'plot.style_stepline': 'stepline', 'plot.style_linebr': 'linebr',
  'plot.style_areabr': 'areabr', 'plot.style_stepline_diamond': 'stepline',
  'shape.xcross': 'xcross', 'shape.cross': 'cross', 'shape.triangleup': 'triangleup', 'shape.triangledown': 'triangledown',
  'shape.flag': 'flag', 'shape.circle': 'circle', 'shape.arrowup': 'arrowup', 'shape.arrowdown': 'arrowdown',
  'shape.labelup': 'labelup', 'shape.labeldown': 'labeldown', 'shape.square': 'square', 'shape.diamond': 'diamond',
  'location.abovebar': 'abovebar', 'location.belowbar': 'belowbar', 'location.top': 'top', 'location.bottom': 'bottom', 'location.absolute': 'absolute',
  'size.auto': 'auto', 'size.tiny': 'tiny', 'size.small': 'small', 'size.normal': 'normal', 'size.large': 'large', 'size.huge': 'huge',
  'hline.style_solid': 'solid', 'hline.style_dotted': 'dotted', 'hline.style_dashed': 'dashed',
  'line.style_solid': 'solid', 'line.style_dotted': 'dotted', 'line.style_dashed': 'dashed',
  'display.all': 'all', 'display.none': 'none', 'display.pane': 'pane', 'display.data_window': 'data_window', 'display.status_line': 'status',
  'format.price': 'price', 'format.volume': 'volume', 'format.percent': 'percent', 'format.mintick': 'mintick',
  'extend.none': 'none', 'extend.left': 'left', 'extend.right': 'right', 'extend.both': 'both',
  'dayofweek.sunday': 1, 'dayofweek.monday': 2, 'dayofweek.tuesday': 3, 'dayofweek.wednesday': 4, 'dayofweek.thursday': 5, 'dayofweek.friday': 6, 'dayofweek.saturday': 7,
  'strategy.long': 'long', 'strategy.short': 'short', 'strategy.fixed': 'fixed', 'strategy.cash': 'cash', 'strategy.percent_of_equity': 'percent_of_equity',
  'strategy.commission.percent': 'percent', 'strategy.commission.cash_per_order': 'cash_per_order', 'strategy.commission.cash_per_contract': 'cash_per_contract',
  'strategy.oca.none': 'none', 'strategy.oca.cancel': 'cancel', 'strategy.oca.reduce': 'reduce',
  'xloc.bar_index': 'bar_index', 'xloc.bar_time': 'bar_time', 'yloc.price': 'price', 'yloc.abovebar': 'abovebar', 'yloc.belowbar': 'belowbar',
  'label.style_label_up': 'up', 'label.style_label_down': 'down', 'label.style_none': 'none',
  'text.align_center': 'center', 'text.align_left': 'left', 'text.align_right': 'right',
  'barmerge.gaps_on': true, 'barmerge.gaps_off': false, 'barmerge.lookahead_on': true, 'barmerge.lookahead_off': false,
  'adjustment.none': 'none', 'adjustment.splits': 'splits', 'adjustment.dividends': 'dividends',
  'session.regular': 'regular', 'session.extended': 'extended',
};
for (const [k, v] of Object.entries(COLORS)) CONSTS['color.' + k] = v;

/** Builtin series available as plain identifiers. */
export const SERIES_NAMES = new Set(['open', 'high', 'low', 'close', 'volume', 'time', 'hl2', 'hlc3', 'ohlc4', 'hlcc4', 'bar_index', 'time_close', 'tr']);

// ---------------- helpers ----------------
export function hexToRgba(c: string): [number, number, number, number] {
  const h = c.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), h.length >= 8 ? parseInt(h.slice(6, 8), 16) : 255];
}
const hex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0').toUpperCase();
export function rgba(r: number, g: number, b: number, a = 255): string {
  return '#' + hex2(r) + hex2(g) + hex2(b) + (a >= 255 ? '' : hex2(a));
}
export const isColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(v);

// ---------------- math ----------------
const m1 = (name: string, f: (x: number) => number) => def('math.' + name, ['number'], (a) => f(a[0]));
m1('abs', Math.abs); m1('acos', Math.acos); m1('asin', Math.asin); m1('atan', Math.atan); m1('ceil', Math.ceil); m1('cos', Math.cos);
m1('exp', Math.exp); m1('floor', Math.floor); m1('log', Math.log); m1('log10', Math.log10); m1('sign', Math.sign); m1('sin', Math.sin);
m1('sqrt', Math.sqrt); m1('tan', Math.tan); m1('todegrees', (x) => (x * 180) / Math.PI); m1('toradians', (x) => (x * Math.PI) / 180);
def('math.pow', ['base', 'exponent'], (a) => Math.pow(a[0], a[1]));
def('math.round', ['number', 'precision'], (a) => {
  if (a[1] === undefined) return Math.round(a[0]);
  const f = Math.pow(10, a[1]);
  return Math.round(a[0] * f) / f;
});
def('math.round_to_mintick', ['number'], (a, x) => Math.round(a[0] / x.mintick) * x.mintick);
def('math.max', ['...'], (a) => (a.some(isNa) ? NaN_ : Math.max(...a)));
def('math.min', ['...'], (a) => (a.some(isNa) ? NaN_ : Math.min(...a)));
def('math.avg', ['...'], (a) => (a.some(isNa) ? NaN_ : a.reduce((p, c) => p + c, 0) / a.length));
def('math.random', ['min', 'max', 'seed'], (a) => (a[0] ?? 0) + Math.random() * ((a[1] ?? 1) - (a[0] ?? 0)));
def('math.sum', ['source', 'length'], (a, x, st) => {
  const h: number[] = (st.a ??= []);
  h.push(a[0]);
  const len = a[1] | 0;
  if (h.length < len) return NaN_;
  let s = 0;
  for (let k = 0; k < len; k++) s += h[h.length - 1 - k];
  return s;
});

// ---------------- core ----------------
def('na', ['x'], (a) => isNa(a[0]));
def('nz', ['source', 'replacement'], (a) => (isNa(a[0]) ? (a[1] ?? 0) : a[0]));
def('int', ['x'], (a) => (isNa(a[0]) ? NaN_ : Math.trunc(a[0])));
def('float', ['x'], (a) => a[0]);
def('bool', ['x'], (a) => truthy(a[0]));
def('timeframe.in_seconds', ['timeframe'], (a, x) => x.step);
for (const n of ['alert', 'alertcondition', 'log.info', 'log.warning', 'log.error', 'max_bars_back', 'timeframe.change']) def(n, ['...'], () => NaN_);
def('runtime.error', ['message'], (a) => { throw new Error(String(a[0])); });
def('request.security', ['symbol', 'timeframe', 'expression', 'gaps', 'lookahead'], (a, x) => {
  if (!x.warnings.includes('request.security: other symbols/timeframes are not supported, using the chart series')) x.warnings.push('request.security: other symbols/timeframes are not supported, using the chart series');
  return a[2];
});
def('request.financial', ['...'], () => NaN_);
def('request.economic', ['...'], () => NaN_);

// ---------------- str ----------------
const fmtNum = (v: any, f?: string) => {
  if (typeof v !== 'number') return String(v);
  if (Number.isNaN(v)) return 'NaN';
  if (!f || f === '#.##########' || f === '#') return String(+v.toFixed(10));
  const dec = (f.split('.')[1] ?? '').replace(/[^#0]/g, '').length;
  return v.toFixed(dec);
};
def('str.tostring', ['value', 'format'], (a) => fmtNum(a[0], a[1]));
def('str.tonumber', ['string'], (a) => parseFloat(a[0]));
def('str.length', ['string'], (a) => String(a[0]).length);
def('str.upper', ['string'], (a) => String(a[0]).toUpperCase());
def('str.lower', ['string'], (a) => String(a[0]).toLowerCase());
def('str.contains', ['source', 'str'], (a) => String(a[0]).includes(String(a[1])));
def('str.startswith', ['source', 'str'], (a) => String(a[0]).startsWith(String(a[1])));
def('str.endswith', ['source', 'str'], (a) => String(a[0]).endsWith(String(a[1])));
def('str.replace_all', ['source', 'target', 'replacement'], (a) => String(a[0]).split(String(a[1])).join(String(a[2])));
def('str.substring', ['source', 'begin', 'end'], (a) => String(a[0]).substring(a[1], a[2]));
def('str.trim', ['source'], (a) => String(a[0]).trim());
def('str.format', ['formatString', '...'], (a) => String(a[0]).replace(/\{(\d+)(?:,[^}]*)?\}/g, (_, i) => fmtNum(a[+i + 1])));

// ---------------- color ----------------
def('color.new', ['color', 'transp'], (a) => {
  const [r, g, b] = hexToRgba(a[0]);
  return rgba(r, g, b, 255 * (1 - (a[1] ?? 0) / 100));
});
def('color.rgb', ['red', 'green', 'blue', 'transp'], (a) => rgba(a[0], a[1], a[2], 255 * (1 - (a[3] ?? 0) / 100)));
def('color.from_gradient', ['value', 'bottom_value', 'top_value', 'bottom_color', 'top_color'], (a) => {
  const t = a[2] === a[1] ? 0 : Math.max(0, Math.min(1, (a[0] - a[1]) / (a[2] - a[1])));
  const c1 = hexToRgba(a[3]), c2 = hexToRgba(a[4]);
  return rgba(c1[0] + (c2[0] - c1[0]) * t, c1[1] + (c2[1] - c1[1]) * t, c1[2] + (c2[2] - c1[2]) * t, c1[3] + (c2[3] - c1[3]) * t);
});
def('color.r', ['color'], (a) => hexToRgba(a[0])[0]);
def('color.g', ['color'], (a) => hexToRgba(a[0])[1]);
def('color.b', ['color'], (a) => hexToRgba(a[0])[2]);
def('color.t', ['color'], (a) => 100 * (1 - hexToRgba(a[0])[3] / 255));

// ---------------- array ----------------
const arr = (v: any): any[] => { if (!Array.isArray(v)) throw new Error('array expected'); return v; };
for (const t of ['float', 'int', 'bool', 'string', 'color']) {
  def(`array.new_${t}`, ['size', 'initial_value'], (a) => new Array(a[0] | 0).fill(a[1] ?? (t === 'string' ? '' : t === 'bool' ? false : NaN_)));
}
def('array.new', ['size', 'initial_value'], (a) => new Array(a[0] | 0).fill(a[1] ?? NaN_));
def('array.from', ['...'], (a) => [...a]);
def('array.push', ['id', 'value'], (a) => { arr(a[0]).push(a[1]); return NaN_; });
def('array.pop', ['id'], (a) => arr(a[0]).pop() ?? NaN_);
def('array.shift', ['id'], (a) => arr(a[0]).shift() ?? NaN_);
def('array.unshift', ['id', 'value'], (a) => { arr(a[0]).unshift(a[1]); return NaN_; });
def('array.get', ['id', 'index'], (a) => { const v = arr(a[0])[a[1]]; return v === undefined ? NaN_ : v; });
def('array.set', ['id', 'index', 'value'], (a) => { arr(a[0])[a[1]] = a[2]; return NaN_; });
def('array.size', ['id'], (a) => arr(a[0]).length);
def('array.clear', ['id'], (a) => { arr(a[0]).length = 0; return NaN_; });
def('array.insert', ['id', 'index', 'value'], (a) => { arr(a[0]).splice(a[1], 0, a[2]); return NaN_; });
def('array.remove', ['id', 'index'], (a) => arr(a[0]).splice(a[1], 1)[0] ?? NaN_);
def('array.includes', ['id', 'value'], (a) => arr(a[0]).includes(a[1]));
def('array.indexof', ['id', 'value'], (a) => arr(a[0]).indexOf(a[1]));
def('array.first', ['id'], (a) => arr(a[0])[0] ?? NaN_);
def('array.last', ['id'], (a) => { const v = arr(a[0]); return v.length ? v[v.length - 1] : NaN_; });
def('array.sum', ['id'], (a) => arr(a[0]).reduce((p, c) => p + c, 0));
def('array.avg', ['id'], (a) => { const v = arr(a[0]); return v.length ? v.reduce((p, c) => p + c, 0) / v.length : NaN_; });
def('array.min', ['id'], (a) => { const v = arr(a[0]); return v.length ? Math.min(...v) : NaN_; });
def('array.max', ['id'], (a) => { const v = arr(a[0]); return v.length ? Math.max(...v) : NaN_; });
def('array.median', ['id'], (a) => { const v = [...arr(a[0])].sort((p, q) => p - q); if (!v.length) return NaN_; const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; });
def('array.sort', ['id', 'order'], (a) => { const v = arr(a[0]); v.sort((p, q) => p - q); if (a[1] === 'desc') v.reverse(); return NaN_; });
def('array.reverse', ['id'], (a) => { arr(a[0]).reverse(); return NaN_; });
def('array.copy', ['id'], (a) => [...arr(a[0])]);
def('array.slice', ['id', 'index_from', 'index_to'], (a) => arr(a[0]).slice(a[1], a[2]));
def('array.concat', ['id1', 'id2'], (a) => { arr(a[0]).push(...arr(a[1])); return a[0]; });
def('array.fill', ['id', 'value'], (a) => { arr(a[0]).fill(a[1]); return NaN_; });
def('array.join', ['id', 'separator'], (a) => arr(a[0]).join(a[1] ?? ','));
def('array.stdev', ['id'], (a) => { const v = arr(a[0]); const m = v.reduce((p, c) => p + c, 0) / v.length; return Math.sqrt(v.reduce((p, c) => p + (c - m) ** 2, 0) / v.length); });

// ---------------- drawing objects (accepted, not rendered) ----------------
export const NOOP_NAMESPACES = new Set(['label', 'line', 'box', 'table', 'linefill', 'polyline', 'chart', 'matrix', 'map']);

// ---------------- input ----------------
function registerInput(x: Ctx, st: Record<string, any>, input: Omit<PineInput, 'id'>, parse: (v: any) => any): any {
  if (!st.reg) {
    st.reg = true;
    const title = input.title || `Input ${x.inputs.length + 1}`;
    st.id = title;
    x.inputs.push({ ...input, title, id: title });
  }
  const override = x.params[st.id];
  if (override === undefined || override === null || override === '') return input.def;
  const v = parse(override);
  return isNa(v) ? input.def : v;
}
const num = (v: any) => (typeof v === 'number' ? v : parseFloat(v));
const optionsOf = (v: any) => (Array.isArray(v) ? v : undefined);
def('input.int', ['defval', 'title', 'minval', 'maxval', 'step', 'tooltip', 'inline', 'group', 'confirm', 'options'], (a, x, st) =>
  Math.trunc(registerInput(x, st, { title: a[1] ?? '', type: 'int', def: a[0], min: a[2], max: a[3], step: a[4], options: optionsOf(a[9]), group: a[7] }, num)));
def('input.float', ['defval', 'title', 'minval', 'maxval', 'step', 'tooltip', 'inline', 'group', 'confirm', 'options'], (a, x, st) =>
  registerInput(x, st, { title: a[1] ?? '', type: 'float', def: a[0], min: a[2], max: a[3], step: a[4], options: optionsOf(a[9]), group: a[7] }, num));
def('input.bool', ['defval', 'title', 'tooltip', 'inline', 'group', 'confirm'], (a, x, st) =>
  registerInput(x, st, { title: a[1] ?? '', type: 'bool', def: !!a[0], group: a[4] }, (v) => v === true || v === 'true' || v === 1));
def('input.string', ['defval', 'title', 'options', 'tooltip', 'inline', 'group', 'confirm'], (a, x, st) =>
  registerInput(x, st, { title: a[1] ?? '', type: 'string', def: a[0], options: optionsOf(a[2]), group: a[5] }, String));
def('input.color', ['defval', 'title', 'tooltip', 'inline', 'group', 'confirm'], (a, x, st) =>
  registerInput(x, st, { title: a[1] ?? '', type: 'color', def: a[0], group: a[4] }, (v) => (isColor(v) ? v : a[0])));
def('input.timeframe', ['defval', 'title', 'options', 'tooltip', 'inline', 'group', 'confirm'], (a, x, st) =>
  registerInput(x, st, { title: a[1] ?? '', type: 'timeframe', def: a[0], options: optionsOf(a[2]), group: a[5] }, String));
def('input.symbol', ['defval', 'title', 'tooltip', 'inline', 'group', 'confirm'], (a, x, st) =>
  registerInput(x, st, { title: a[1] ?? '', type: 'symbol', def: a[0], group: a[4] }, String));
def('input.session', ['defval', 'title', 'options', 'tooltip', 'inline', 'group', 'confirm'], (a, x, st) =>
  registerInput(x, st, { title: a[1] ?? '', type: 'string', def: a[0], options: optionsOf(a[2]), group: a[5] }, String));
def('input.price', ['defval', 'title', 'tooltip', 'inline', 'group', 'confirm'], (a, x, st) =>
  registerInput(x, st, { title: a[1] ?? '', type: 'float', def: a[0], group: a[4] }, num));
// Untyped input(): infer from the default value.
def('input', ['defval', 'title', 'tooltip', 'inline', 'group', 'confirm'], (a, x, st) => {
  const d = a[0];
  const type = typeof d === 'boolean' ? 'bool' : typeof d === 'number' ? (Number.isInteger(d) ? 'int' : 'float') : isColor(d) ? 'color' : 'string';
  return registerInput(x, st, { title: a[1] ?? '', type, def: d, group: a[4] }, type === 'bool' ? (v) => v === true || v === 'true' : type === 'string' || type === 'color' ? String : num);
});
/** input.source is special-cased by the interpreter (needs the identifier). This receives the resolved choice. */
export function registerSourceInput(x: Ctx, st: Record<string, any>, title: string, defName: string): string {
  if (!st.reg) {
    st.reg = true;
    st.id = title || `Input ${x.inputs.length + 1}`;
    x.inputs.push({ id: st.id, title: st.id, type: 'source', def: defName, options: ['open', 'high', 'low', 'close', 'hl2', 'hlc3', 'ohlc4', 'hlcc4', 'volume'] });
  }
  const o = x.params[st.id];
  return typeof o === 'string' && x.seriesByName(o) ? o : defName;
}

// ---------------- declarations & outputs ----------------
def('indicator', ['title', 'shorttitle', 'overlay'], (a, x) => {
  x.meta.kind = 'indicator'; x.meta.title = a[0] ?? 'Indicator'; x.meta.shorttitle = a[1] ?? x.meta.title; x.meta.overlay = !!a[2];
  return NaN_;
});
def('study', ['title', 'shorttitle', 'overlay'], (a, x) => NATIVES['indicator'].fn(a, x, {}, null));
def('library', ['title'], (a, x) => { x.meta.kind = 'library'; x.meta.title = a[0] ?? 'Library'; return NaN_; });

const PLOT_OUT = (x: Ctx, st: Record<string, any>, make: () => any, store: any[]) => {
  if (!st.o) { st.o = make(); st.o.id = store.length; store.push(st.o); }
  return st.o;
};
const colorOf = (c: any, fallback: string) => (isColor(c) ? c : fallback);
function setColor(o: { color: string; colors?: (string | undefined)[] }, x: Ctx, c: any) {
  if (!isColor(c)) { if (o.colors) o.colors[x.bar] = undefined; return; }
  if (!o.colors && c.toLowerCase() !== (o.color ?? '').toLowerCase() && x.bar > 0 && o.color) {
    // color varies by bar: switch to per-bar storage, backfilling the base color
    o.colors = new Array(x.n).fill(o.color);
  }
  if (!o.color) o.color = c;
  if (o.colors) o.colors[x.bar] = c;
}

def('plot', ['series', 'title', 'color', 'linewidth', 'style', 'trackprice', 'histbase', 'offset', 'join', 'editable', 'show_last', 'display', 'force_overlay', 'pane'], (a, x, st) => {
  const o: PlotOut = PLOT_OUT(x, st, () => ({
    title: a[1] ?? `Plot ${x.plots.length + 1}`, values: new Float64Array(x.n).fill(NaN_), color: '', style: a[4] ?? 'line',
    linewidth: a[3] ?? 1, offset: a[7] ?? 0, histbase: a[6] ?? 0, pane: typeof a[13] === 'string' && a[13] ? a[13] : undefined,
  }), x.plots);
  const v = a[0];
  o.values[x.bar] = typeof v === 'number' ? v : v === true ? 1 : v === false ? 0 : NaN_;
  setColor(o, x, a[2] ?? x.params['__color']);
  if (!o.color) o.color = '#9D4DFF';
  return o.id;
});
def('plotshape', ['series', 'title', 'style', 'location', 'color', 'offset', 'text', 'textcolor', 'editable', 'size', 'show_last', 'display', 'force_overlay'], (a, x, st) => {
  const o: ShapeOut = PLOT_OUT(x, st, () => ({
    title: a[1] ?? `Shape ${x.shapes.length + 1}`, style: a[2] ?? 'xcross', location: a[3] ?? 'abovebar', color: '', textColor: colorOf(a[7], '#FFFFFF'),
    text: a[6] ?? '', size: a[9] ?? 'small', flags: new Uint8Array(x.n), offset: a[5] ?? 0,
  }), x.shapes);
  if (truthy(a[0])) { o.flags[x.bar] = 1; setColor(o, x, a[4]); }
  if (!o.color) o.color = colorOf(a[4], '#9D4DFF');
  return o.id;
});
def('plotchar', ['series', 'title', 'char', 'location', 'color', 'offset', 'text', 'textcolor', 'editable', 'size', 'show_last', 'display', 'force_overlay'], (a, x, st) => {
  const o: ShapeOut = PLOT_OUT(x, st, () => ({
    title: a[1] ?? `Char ${x.shapes.length + 1}`, style: 'char', location: a[3] ?? 'abovebar', color: '', textColor: colorOf(a[7], '#FFFFFF'),
    text: a[2] ?? '•', size: a[9] ?? 'small', flags: new Uint8Array(x.n), offset: a[5] ?? 0,
  }), x.shapes);
  if (truthy(a[0])) { o.flags[x.bar] = 1; setColor(o, x, a[4]); }
  if (!o.color) o.color = colorOf(a[4], '#9D4DFF');
  return o.id;
});
def('plotarrow', ['series', 'title', 'colorup', 'colordown', 'offset', 'minheight', 'maxheight', 'editable', 'show_last', 'display', 'force_overlay'], (a, x, st) => {
  const o: ShapeOut = PLOT_OUT(x, st, () => ({
    title: a[1] ?? 'Arrow', style: 'arrowup', location: 'abovebar', color: '', textColor: '#FFFFFF', text: '', size: 'small', flags: new Uint8Array(x.n), offset: a[4] ?? 0,
  }), x.shapes);
  const v = a[0];
  if (typeof v === 'number' && !Number.isNaN(v) && v !== 0) {
    o.flags[x.bar] = 1;
    setColor(o, x, v > 0 ? colorOf(a[2], '#2ee6a6') : colorOf(a[3], '#ff4d6a'));
  }
  if (!o.color) o.color = '#2ee6a6';
  return o.id;
});
def('hline', ['price', 'title', 'color', 'linestyle', 'linewidth', 'editable', 'display', 'pane'], (a, x, st) => {
  if (!st.o) { st.o = { id: x.hlines.length, price: a[0], title: a[1] ?? '', color: colorOf(a[2], '#787B86'), style: a[3] ?? 'dashed', linewidth: a[4] ?? 1, pane: typeof a[7] === 'string' && a[7] ? a[7] : undefined }; x.hlines.push(st.o); }
  return st.o.id;
});
def('fill', ['hline1', 'hline2', 'color', 'title', 'editable', 'fillgaps', 'display'], (a, x, st) => {
  // plot() and hline() return ids; ids of plots and hlines are encoded as {kind,id} objects by the interpreter.
  if (!st.o) {
    const ref = (v: any) => (v && typeof v === 'object' && 'kind' in v ? v : { kind: 'plot', id: v });
    st.o = { a: ref(a[0]), b: ref(a[1]), color: '', colors: undefined };
    x.fills.push(st.o);
  }
  setColor(st.o, x, a[2]);
  if (!st.o.color) st.o.color = '#9D4DFF33';
  return NaN_;
});
def('bgcolor', ['color', 'offset', 'editable', 'show_last', 'title', 'display', 'force_overlay'], (a, x) => { if (isColor(a[0])) x.bgcolors[x.bar] = a[0]; return NaN_; });
def('barcolor', ['color', 'offset', 'editable', 'show_last', 'title', 'display'], (a, x) => { if (isColor(a[0])) x.barcolors[x.bar] = a[0]; return NaN_; });
for (const n of ['plotcandle', 'plotbar', 'fill_gradient']) def(n, ['...'], () => NaN_);

// ---------------- builtin variables that are not simple series ----------------
export const VARS: Record<string, (x: Ctx, st: Record<string, any>) => any> = {
  ...TA_VARS,
  'barstate.isfirst': (x) => x.bar === 0,
  'barstate.islast': (x) => x.bar === x.n - 1,
  'barstate.ishistory': (x) => x.bar < x.n - 1,
  'barstate.isrealtime': (x) => x.bar === x.n - 1,
  'barstate.isnew': () => true,
  'barstate.isconfirmed': (x) => x.bar < x.n - 1,
  'barstate.islastconfirmedhistory': (x) => x.bar === x.n - 2,
  'last_bar_index': (x) => x.n - 1,
  'last_bar_time': (x) => x.tms[x.n - 1],
  'timenow': () => Date.now(),
  'syminfo.tickerid': (x) => x.symbol,
  'syminfo.ticker': (x) => x.symbol.replace(/^.*:/, ''),
  'syminfo.mintick': (x) => x.mintick,
  'syminfo.pointvalue': () => 1,
  'syminfo.currency': () => 'USD',
  'syminfo.type': (x) => (x.symbol.includes('/') ? 'crypto' : 'stock'),
  'syminfo.timezone': () => 'UTC',
  'syminfo.description': (x) => x.symbol,
  'timeframe.period': (x) => tfString(x.step),
  'timeframe.multiplier': (x) => (x.step >= 86400 ? Math.round(x.step / 86400) : x.step >= 3600 ? Math.round(x.step / 3600) : Math.round(x.step / 60)),
  'timeframe.isintraday': (x) => x.step < 86400,
  'timeframe.isdaily': (x) => x.step === 86400,
  'timeframe.isweekly': (x) => x.step === 604800,
  'timeframe.ismonthly': (x) => x.step >= 2592000,
  'timeframe.isminutes': (x) => x.step < 3600,
  'timeframe.isseconds': () => false,
  'year': (x) => new Date(x.tms[x.bar]).getUTCFullYear(),
  'month': (x) => new Date(x.tms[x.bar]).getUTCMonth() + 1,
  'dayofmonth': (x) => new Date(x.tms[x.bar]).getUTCDate(),
  'dayofweek': (x) => new Date(x.tms[x.bar]).getUTCDay() + 1,
  'hour': (x) => new Date(x.tms[x.bar]).getUTCHours(),
  'minute': (x) => new Date(x.tms[x.bar]).getUTCMinutes(),
  'second': () => 0,
  'weekofyear': (x) => { const d = new Date(x.tms[x.bar]); const s = Date.UTC(d.getUTCFullYear(), 0, 1); return Math.floor((d.getTime() - s) / 604800000) + 1; },
};

function tfString(step: number): string {
  if (step >= 2592000) return 'M';
  if (step >= 604800) return 'W';
  if (step >= 86400) return step === 86400 ? 'D' : `${Math.round(step / 86400)}D`;
  if (step >= 3600) return String(Math.round(step / 60));
  return String(Math.round(step / 60));
}
