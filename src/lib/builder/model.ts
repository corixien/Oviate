// Visual strategy builder: model, Pine generation, reading a model back from code, and per-indicator suggestions. Pure (tested).
// A strategy is built from conditions "left <comparison> right". Each side is a price series, a plot of a library indicator, a time of day / weekday,
// the high / low / open / close / volume of a daily time window (e.g. the pre-market session), the highest / lowest of the last N bars, something about the
// open position (entry price, bars in the trade, profit %), or a fixed value. Series sides can be shifted back N bars and scaled by a percent.
// Library indicators are read through oviate.ind (see pine/indlib.ts), so any indicator in the list can be used and every one of its inputs stays tunable.

export type PriceSrc = 'close' | 'open' | 'high' | 'low' | 'hl2' | 'hlc3' | 'ohlc4' | 'volume';
export const PRICE_SRCS: PriceSrc[] = ['close', 'open', 'high', 'low', 'hl2', 'hlc3', 'ohlc4', 'volume'];
export const PRICE_LABEL: Record<PriceSrc, string> = { close: 'Close', open: 'Open', high: 'High', low: 'Low', hl2: '(H+L)/2', hlc3: '(H+L+C)/3', ohlc4: '(O+H+L+C)/4', volume: 'Volume' };

/** Shift and scale shared by the series operands: value N bars ago, times (1 + pct / 100). */
interface Adjust { ago?: number; pct?: number }
export type SessStat = 'high' | 'low' | 'open' | 'close' | 'volume';
export const SESS_STATS: SessStat[] = ['high', 'low', 'open', 'close', 'volume'];
export const SESS_LABEL: Record<SessStat, string> = { high: 'High', low: 'Low', open: 'Open', close: 'Close', volume: 'Volume' };
export type PosField = 'entry' | 'bars' | 'pnl';
export const POS_LABEL: Record<PosField, string> = { entry: 'Entry price', bars: 'Bars in trade', pnl: 'Profit %' };
export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export type Operand =
  | ({ k: 'price'; src: PriceSrc } & Adjust)
  /** `ind` = file name of the library indicator, `plot` = title of one of its plots, `p` = input values that differ from the indicator's defaults (by input title) */
  | ({ k: 'ind'; ind: string; plot: string; p: Record<string, number | string | boolean> } & Adjust)
  | { k: 'num'; v: number }
  /** clock time of the bar in the strategy's time zone: `tod` = hhmm (9:30 is 930), `dow` = 1 (Mon) .. 7 (Sun) */
  | { k: 'time'; f: 'tod' | 'dow' }
  /** stat of the bars inside a daily window [from, to) in hhmm (e.g. 400 to 930 = pre-market): running while the window is open, kept afterwards until the next window */
  | ({ k: 'sess'; stat: SessStat; from: number; to: number } & Adjust)
  /** highest / lowest value of a series over the last n bars (use "bars ago" 1 for the previous n bars) */
  | ({ k: 'hl'; fn: 'highest' | 'lowest'; src: PriceSrc; n: number } & Adjust)
  /** the open position: average entry price, bars since it was opened, open profit in percent */
  | { k: 'pos'; f: PosField };

export type Cmp = 'cross_above' | 'cross_below' | 'above' | 'below' | 'at_least' | 'at_most' | 'equal' | 'not_equal' | 'between' | 'rising' | 'falling' | 'turn_up' | 'turn_down';
export const BINARY: Cmp[] = ['cross_above', 'cross_below', 'above', 'below', 'at_least', 'at_most', 'equal', 'not_equal', 'between'];
export const UNARY: Cmp[] = ['rising', 'falling', 'turn_up', 'turn_down'];
export const CMP_LABEL: Record<Cmp, string> = {
  cross_above: 'crosses above', cross_below: 'crosses below', above: 'is above', below: 'is below', at_least: 'is at or above', at_most: 'is at or below',
  equal: 'equals', not_equal: 'is not', between: 'is between',
  rising: 'is rising', falling: 'is falling', turn_up: 'turns up', turn_down: 'turns down',
};
export const isUnary = (c: Cmp) => UNARY.includes(c);

export interface Cond {
  l: Operand;
  cmp: Cmp;
  /** right side of a binary comparison; undefined = None (rising / falling / turns up / turns down only look at the left side) */
  r?: Operand;
  /** upper end of "is between" (r is the lower end) */
  r2?: Operand;
  /** rising / falling: number of bars (default 1) */
  n?: number;
  /** the condition may have been true on any of the last N bars (default 1 = this bar only) */
  within?: number;
}
export interface Group { op: 'and' | 'or'; items: Cond[] }
export interface Side {
  on: boolean; entry: Group; exit: Group; sl: number; tp: number;
  /** at most this many entries per day (0 = unlimited) */
  maxPerDay?: number;
}
export interface Model {
  v: 2;
  name: string;
  qtyType: 'percent_of_equity' | 'cash' | 'fixed';
  qty: number;
  long: Side;
  short: Side;
  /** time zone of the time operands and the day limit (IANA name) */
  tz?: string;
}
export const DEFAULT_TZ = 'America/New_York';
export const TIME_ZONES = ['America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Asia/Tokyo', 'Asia/Hong_Kong', 'Australia/Sydney', 'UTC'];

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

/** 930 -> "09:30" */
export const hhmmText = (v: number) => `${String(Math.floor(v / 100)).padStart(2, '0')}:${String(Math.round(v) % 100).padStart(2, '0')}`;
/** "9:30" / "0930" / "930" -> 930, NaN when not a time */
export function parseHhmm(t: string): number {
  const m = /^\s*(\d{1,2})\s*[:.]?\s*(\d{2})\s*$/.exec(t) ?? /^\s*(\d{1,2})\s*$/.exec(t);
  if (!m) return NaN;
  const h = Number(m[1]), mi = Number(m[2] ?? 0);
  return h <= 24 && mi < 60 ? h * 100 + mi : NaN;
}

export function operandText(o: Operand | undefined, info: InfoFn, other?: Operand): string {
  if (!o) return 'nothing';
  if (o.k === 'num') {
    if (other?.k === 'time') return other.f === 'tod' ? hhmmText(o.v) : DAY_NAMES[o.v - 1] ?? String(o.v);
    return String(o.v);
  }
  let base: string;
  if (o.k === 'price') base = PRICE_LABEL[o.src];
  else if (o.k === 'time') return o.f === 'tod' ? 'Time of day' : 'Day of week';
  else if (o.k === 'sess') base = `${hhmmText(o.from)}-${hhmmText(o.to)} session ${SESS_LABEL[o.stat].toLowerCase()}`;
  else if (o.k === 'hl') base = `${o.fn === 'highest' ? 'Highest' : 'Lowest'} ${PRICE_LABEL[o.src].toLowerCase()} of ${o.n} bars`;
  else if (o.k === 'pos') return POS_LABEL[o.f];
  else {
    const i = info(o.ind);
    base = i ? (i.plots.length > 1 ? `${i.short} ${o.plot}` : i.short) : o.ind;
    const ps = Object.entries(o.p);
    if (ps.length) base += ` (${ps.map(([, v]) => v).join(', ')})`;
  }
  if (o.ago && o.ago > 0) base += ` ${o.ago} bar${o.ago > 1 ? 's' : ''} ago`;
  if (o.pct) base += ` ${o.pct > 0 ? '+' : ''}${o.pct}%`;
  return base;
}

export function condText(c: Cond, info: InfoFn): string {
  const l = operandText(c.l, info);
  const bars = c.n && c.n > 1 ? ` for ${c.n} bars` : '';
  let core: string;
  if (isUnary(c.cmp)) core = `${l} ${CMP_LABEL[c.cmp]}${c.cmp === 'rising' || c.cmp === 'falling' ? bars : ''}`;
  else if (c.cmp === 'between') core = `${l} is between ${operandText(c.r, info, c.l)} and ${operandText(c.r2, info, c.l)}`;
  else core = `${l} ${CMP_LABEL[c.cmp]} ${operandText(c.r, info, c.l)}`;
  return c.within && c.within > 1 ? `${core} (within the last ${c.within} bars)` : core;
}

// ---------------------------------------------------------------- validation

/** Error text for a model that cannot be turned into a working strategy, else null. */
export function checkModel(m: Model, info: InfoFn): string | null {
  if (!(m.qty > 0) || (m.qtyType === 'percent_of_equity' && m.qty > 100)) return 'Position size is not valid.';
  const hhmmOk = (v: number) => Number.isFinite(v) && v >= 0 && v <= 2400 && v % 100 < 60;
  const opErr = (o: Operand | undefined, what: string): string | null => {
    if (!o) return `${what}: missing.`;
    if (o.k === 'num') return Number.isFinite(o.v) ? null : `${what}: the value is not a number.`;
    if (o.k === 'time') return o.f === 'tod' || o.f === 'dow' ? null : `${what}: unknown time field.`;
    if (o.k === 'pos') return o.f in POS_LABEL ? null : `${what}: unknown position field.`;
    if ('ago' in o && o.ago !== undefined && !(Number.isInteger(o.ago) && o.ago >= 0 && o.ago <= 500)) return `${what}: "bars ago" must be a whole number from 0 to 500.`;
    if ('pct' in o && o.pct !== undefined && !Number.isFinite(o.pct)) return `${what}: the percent is not a number.`;
    if (o.k === 'price') return PRICE_SRCS.includes(o.src) ? null : `${what}: unknown price "${o.src}".`;
    if (o.k === 'sess') {
      if (!SESS_STATS.includes(o.stat)) return `${what}: unknown session value "${o.stat}".`;
      return hhmmOk(o.from) && hhmmOk(o.to) && o.from !== o.to ? null : `${what}: the session times are not valid.`;
    }
    if (o.k === 'hl') {
      if (o.fn !== 'highest' && o.fn !== 'lowest') return `${what}: unknown highest / lowest.`;
      if (!PRICE_SRCS.includes(o.src)) return `${what}: unknown price "${o.src}".`;
      return Number.isInteger(o.n) && o.n >= 1 && o.n <= 5000 ? null : `${what}: the number of bars must be a whole number from 1 to 5000.`;
    }
    if (o.k !== 'ind') return `${what}: unknown source.`;
    const i = info(o.ind);
    if (!i) return `${what}: indicator "${o.ind}" is not in the list.`;
    if (!i.plots.includes(o.plot)) return `${what}: indicator "${o.ind}" has no plot "${o.plot}" (plots: ${i.plots.join(', ')}).`;
    return null;
  };
  if (m.tz !== undefined) { try { new Intl.DateTimeFormat('en-US', { timeZone: m.tz }); } catch { return `Unknown time zone "${m.tz}".`; } }
  for (const [side, s] of sideEntries(m)) {
    if (!s.on) continue;
    if (!s.entry.items.length) return `${side}: add at least one entry condition (or switch ${side.toLowerCase()} off).`;
    if (s.maxPerDay !== undefined && !(Number.isInteger(s.maxPerDay) && s.maxPerDay >= 0)) return `${side}: entries per day must be a whole number (0 = unlimited).`;
    for (const [kind, g] of [['entry', s.entry], ['exit', s.exit]] as const) {
      for (const [k, c] of g.items.entries()) {
        const w = `${side} ${kind} ${k + 1}`;
        if (!BINARY.includes(c.cmp) && !UNARY.includes(c.cmp)) return `${w}: unknown comparison "${c.cmp}".`;
        const e = opErr(c.l, w + ' left');
        if (e) return e;
        if (c.l.k === 'num') return `${w}: the left side cannot be a fixed value.`;
        if (isUnary(c.cmp)) { if (c.l.k === 'time' || c.l.k === 'pos' && c.l.f === 'entry') return `${w}: "${CMP_LABEL[c.cmp]}" needs a price, indicator or value series on the left.`; }
        else {
          const e2 = opErr(c.r, w + ' right'); if (e2) return e2;
          if (c.cmp === 'between') { const e3 = opErr(c.r2, w + ' upper end'); if (e3) return e3; }
          if ((c.cmp === 'cross_above' || c.cmp === 'cross_below') && c.l.k === 'time') return `${w}: a time cannot cross; use "is at or above" / "is between".`;
        }
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
  const adj = (o: any): Adjust => {
    const a: Adjust = {};
    if (o.ago !== undefined && o.ago !== 0) a.ago = typeof o.ago === 'number' ? Math.floor(o.ago) : NaN;
    if (o.pct !== undefined && o.pct !== 0) a.pct = typeof o.pct === 'number' ? o.pct : NaN;
    return a;
  };
  const operand = (o: any): Operand | undefined => {
    if (!o || typeof o !== 'object') return undefined;
    if (o.k === 'num') return { k: 'num', v: num(o.v, NaN) };
    if (o.k === 'price') return { k: 'price', src: o.src, ...adj(o) };
    if (o.k === 'ind') return { k: 'ind', ind: String(o.ind ?? ''), plot: String(o.plot ?? ''), p: o.p && typeof o.p === 'object' ? { ...o.p } : {}, ...adj(o) };
    if (o.k === 'time') return { k: 'time', f: o.f };
    if (o.k === 'pos') return { k: 'pos', f: o.f };
    if (o.k === 'sess') return { k: 'sess', stat: o.stat, from: num(o.from, NaN), to: num(o.to, NaN), ...adj(o) };
    if (o.k === 'hl') return { k: 'hl', fn: o.fn, src: o.src ?? 'high', n: num(o.n, NaN), ...adj(o) };
    return undefined;
  };
  const cond = (c: any): Cond | null => {
    const l = operand(c?.l);
    if (!l || typeof c.cmp !== 'string') return null;
    const out: Cond = { l, cmp: c.cmp };
    const r = operand(c.r); if (r && !isUnary(c.cmp)) out.r = r;
    const r2 = operand(c.r2); if (r2 && c.cmp === 'between') out.r2 = r2;
    if (c.n > 1) out.n = Math.floor(c.n);
    if (c.within > 1) out.within = Math.floor(c.within);
    return out;
  };
  const group = (g: any): Group => ({ op: g?.op === 'or' ? 'or' : 'and', items: Array.isArray(g?.items) ? g.items.map(cond).filter((c: Cond | null): c is Cond => !!c) : [] });
  const side = (s: any, on: boolean): Side => {
    const out: Side = { on: typeof s?.on === 'boolean' ? s.on : on, entry: group(s?.entry), exit: group(s?.exit), sl: Math.max(0, num(s?.sl, 0)), tp: Math.max(0, num(s?.tp, 0)) };
    if (s?.maxPerDay > 0) out.maxPerDay = Math.floor(s.maxPerDay);
    return out;
  };
  const out: Model = {
    v: 2,
    name: typeof raw?.name === 'string' && raw.name.trim() ? raw.name.trim() : d.name,
    qtyType: ['percent_of_equity', 'cash', 'fixed'].includes(raw?.qtyType) ? raw.qtyType : d.qtyType,
    qty: num(raw?.qty, d.qty),
    long: side(raw?.long, true),
    short: side(raw?.short, false),
  };
  if (typeof raw?.tz === 'string' && raw.tz) out.tz = raw.tz;
  return out;
}

// ---------------------------------------------------------------- Pine generation

const ident = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'x';
const pickColors = ['color.orange', 'color.aqua', 'color.fuchsia', 'color.lime', 'color.yellow', 'color.blue', 'color.red', 'color.purple'];

export const MARKER = '// @oviate-builder ';

/** The Pine strategy for a model. Needs info() for every indicator used (checkModel first). */
export function toPine(m: Model, info: InfoFn): string {
  const tz = m.tz || DEFAULT_TZ;
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

  // shared helper series, created on first use
  const helpers = new Map<string, string>();
  const helper = (key: string, make: () => string[], name: string) => {
    if (!helpers.has(key)) { calc.push(...make()); helpers.set(key, name); }
    return name;
  };
  const tod = () => helper('tod', () => [`tod = oviate.hhmm("${tz}")`], 'tod');
  const dow = () => helper('dow', () => [`dow = oviate.dow("${tz}")`], 'dow');
  const dayNo = () => helper('date', () => [`dayNo = oviate.date("${tz}")`], 'dayNo');
  const posBars = () => helper('posBars', () => ['var posBars = 0', 'posBars := strategy.position_size != 0 ? posBars + 1 : 0'], 'posBars');
  const sessVar = (o: Extract<Operand, { k: 'sess' }>) => {
    const key = `sess|${o.stat}|${o.from}|${o.to}`;
    const id = `s${o.from}_${o.to}`;
    const inName = `${id}_in`;
    helper(`in|${o.from}|${o.to}`, () => {
      const t = tod();
      const cond = o.from < o.to ? `${t} >= ${o.from} and ${t} < ${o.to}` : `${t} >= ${o.from} or ${t} < ${o.to}`;
      return [`${inName} = ${cond}`, `${id}_start = ${inName} and (bar_index == 0 or not ${inName}[1])`];
    }, inName);
    const v = `${id}_${o.stat}`;
    return helper(key, () => {
      const upd = o.stat === 'high' ? `math.max(${v}, high)` : o.stat === 'low' ? `math.min(${v}, low)` : o.stat === 'close' ? 'close' : o.stat === 'volume' ? `${v} + volume` : null;
      const first = o.stat === 'volume' ? 'volume' : o.stat === 'close' ? 'close' : o.stat;
      return [`var ${v} = na`, `if ${id}_start`, `    ${v} := ${first}`, ...(upd ? [`else if ${inName}`, `    ${v} := ${upd}`] : [])];
    }, v);
  };

  let adjIdx = 0;
  /** Pine series expression of an operand; shifted / scaled operands (and anything the history operator needs a name for) get their own variable. */
  const exprOf = (o: Operand, ctx: { dir: string; kind: string; k: number; role: string; other?: Operand }): string => {
    let base: string;
    switch (o.k) {
      case 'price': base = o.src; break;
      case 'ind': base = indVar(o); break;
      case 'time': return o.f === 'tod' ? tod() : dow();
      case 'pos':
        if (o.f === 'bars') return posBars();
        return o.f === 'entry' ? 'strategy.position_avg_price'
          : 'strategy.position_size > 0 ? (close / strategy.position_avg_price - 1) * 100 : strategy.position_size < 0 ? (strategy.position_avg_price / close - 1) * 100 : 0';
      case 'sess': base = sessVar(o); break;
      case 'hl': {
        const name = `hl_${o.fn}_${o.src}_${o.n}`;
        base = helper(name, () => [`${name} = ta.${o.fn}(${o.src}, ${o.n})`], name);
        break;
      }
      case 'num': {
        const nm = `n${++numIdx}_${ctx.dir}_${ctx.kind}${ctx.k + 1}`;
        const t = ctx.other?.k === 'time';
        const title = uniqueTitle(`${ctx.dir === 'long' ? 'Long' : 'Short'} ${ctx.kind} ${ctx.k + 1} · ${ctx.role}`);
        inputs.push(`${nm} = input.${t ? 'int' : 'float'}(${o.v}, "${title}")`);
        const lhs = ctx.other?.k === 'ind' ? info(ctx.other.ind) : undefined;
        if (lhs && !lhs.overlay && ctx.role === 'value') plots.push(`hline(${o.v}, "${title}", color=color.gray, pane="${lhs.short}")`);
        return nm;
      }
    }
    const ago = 'ago' in o && o.ago ? o.ago : 0, pct = 'pct' in o && o.pct ? o.pct : 0;
    if (!ago && !pct) return base;
    const name = `x${++adjIdx}_${ident(base)}`;
    let e = ago ? `${base}[${ago}]` : base;
    if (pct) e = `${e} * ${1 + pct / 100}`;
    calc.push(`${name} = ${e}`);
    return name;
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
        const ctx = (role: string, other?: Operand) => ({ dir, kind, k, role, other });
        const a = exprOf(c.l, ctx('value'));
        const b = c.r && !isUnary(c.cmp) ? exprOf(c.r, ctx(c.cmp === 'between' ? 'from' : 'value', c.l)) : '';
        const b2 = c.r2 && c.cmp === 'between' ? exprOf(c.r2, ctx('to', c.l)) : '';
        const n = c.n && c.n > 1 ? c.n : 1;
        // the history operator needs a named series: copy an expression into a variable first
        const named = (x: string) => { if (/^[A-Za-z_]\w*$/.test(x)) return x; const nm = `h${++adjIdx}`; calc.push(`${nm} = ${x}`); return nm; };
        let e: string;
        switch (c.cmp) {
          case 'cross_above': e = `ta.crossover(${a}, ${b})`; break;
          case 'cross_below': e = `ta.crossunder(${a}, ${b})`; break;
          case 'above': e = `${a} > ${b}`; break;
          case 'below': e = `${a} < ${b}`; break;
          case 'at_least': e = `${a} >= ${b}`; break;
          case 'at_most': e = `${a} <= ${b}`; break;
          case 'equal': e = `${a} == ${b}`; break;
          case 'not_equal': e = `${a} != ${b}`; break;
          case 'between': e = `(${a} >= ${b} and ${a} <= ${b2})`; break;
          case 'rising': e = `ta.rising(${a}, ${n})`; break;
          case 'falling': e = `ta.falling(${a}, ${n})`; break;
          case 'turn_up': { const x = named(a); e = `(${x} > ${x}[1] and ${x}[1] <= ${x}[2])`; break; }
          default: { const x = named(a); e = `(${x} < ${x}[1] and ${x}[1] >= ${x}[2])`; break; }
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
    const cap = s.maxPerDay && s.maxPerDay > 0 ? s.maxPerDay : 0;
    if (cap) {
      const d = dayNo();
      calc.push(`var ${dir}Cnt = 0`, `var ${dir}Day = 0`, `if ${d} != ${dir}Day`, `    ${dir}Day := ${d}`, `    ${dir}Cnt := 0`);
    }
    rules.push(
      `${dir}Entry = ${exprs[dir + 'entry']}`,
      `${dir}Exit = ${exprs[dir + 'exit']}`,
      `if ${dir}Exit and strategy.position_size ${long ? '>' : '<'} 0`,
      `    strategy.close("${id}", comment="${side} exit")`,
      `if ${dir}Entry and strategy.position_size ${long ? '<=' : '>='} 0${cap ? ` and ${dir}Cnt < ${cap}` : ''}`,
      `    strategy.entry("${id}", strategy.${dir}, comment="${side} entry")`,
      ...(cap ? [`    ${dir}Cnt := ${dir}Cnt + 1`] : []),
      `if strategy.position_size ${long ? '>' : '<'} 0`,
      `    strategy.exit("${id} SL/TP", "${id}", stop=${dir}Sl > 0 ? strategy.position_avg_price * (1 ${long ? '-' : '+'} ${dir}Sl / 100) : na, limit=${dir}Tp > 0 ? strategy.position_avg_price * (1 ${long ? '+' : '-'} ${dir}Tp / 100) : na)`,
      '',
    );
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

// ---------------------------------------------------------------- templates

const px = (src: PriceSrc = 'close'): Operand => ({ k: 'price', src });
const tod: Operand = { k: 'time', f: 'tod' };
const val = (v: number): Operand => ({ k: 'num', v });

/** Ready-made starting points; they only use what the builder offers, so every one can be edited freely. */
export const TEMPLATES: { id: string; label: string; build: () => Model }[] = [
  { id: 'rsi', label: 'RSI reversal (long)', build: () => {
    const m = newModel(); m.name = 'RSI reversal';
    m.long.entry.items.push({ l: { k: 'ind', ind: 'rsi', plot: 'RSI', p: {} }, cmp: 'cross_above', r: val(30) });
    m.long.exit.items.push({ l: { k: 'ind', ind: 'rsi', plot: 'RSI', p: {} }, cmp: 'cross_above', r: val(70) });
    m.long.sl = 3; return m;
  } },
  { id: 'ema', label: 'EMA cross with trend filter (long and short)', build: () => {
    const m = newModel(); m.name = 'EMA cross'; m.short.on = true;
    const ema = (n: number): Operand => ({ k: 'ind', ind: 'ema', plot: 'EMA', p: { Length: n } });
    m.long.entry.items.push({ l: ema(10), cmp: 'cross_above', r: ema(40) }, { l: px(), cmp: 'above', r: ema(200) });
    m.long.exit.items.push({ l: ema(10), cmp: 'cross_below', r: ema(40) });
    m.short.entry.items.push({ l: ema(10), cmp: 'cross_below', r: ema(40) }, { l: px(), cmp: 'below', r: ema(200) });
    m.short.exit.items.push({ l: ema(10), cmp: 'cross_above', r: ema(40) });
    return m;
  } },
  { id: 'premarket', label: 'Pre-market high / low breakout (needs intraday data with pre-market)', build: () => {
    const m = newModel(); m.name = 'Pre-market breakout'; m.short.on = true; m.tz = DEFAULT_TZ;
    const pm = (stat: SessStat): Operand => ({ k: 'sess', stat, from: 400, to: 930 });
    const session: Cond = { l: tod, cmp: 'between', r: val(930), r2: val(1500) };
    m.long.entry.items.push({ l: px(), cmp: 'cross_above', r: pm('high') }, { ...session });
    m.long.exit.op = 'or';
    m.long.exit.items.push({ l: px(), cmp: 'cross_below', r: pm('low') }, { l: tod, cmp: 'at_least', r: val(1555) });
    m.short.entry.items.push({ l: px(), cmp: 'cross_below', r: pm('low') }, { ...session });
    m.short.exit.op = 'or';
    m.short.exit.items.push({ l: px(), cmp: 'cross_above', r: pm('high') }, { l: tod, cmp: 'at_least', r: val(1555) });
    m.long.maxPerDay = 1; m.short.maxPerDay = 1;
    return m;
  } },
  { id: 'orb', label: 'Opening range breakout, first 30 minutes (intraday)', build: () => {
    const m = newModel(); m.name = 'Opening range breakout'; m.short.on = true; m.tz = DEFAULT_TZ;
    const or = (stat: SessStat): Operand => ({ k: 'sess', stat, from: 930, to: 1000 });
    m.long.entry.items.push({ l: px(), cmp: 'cross_above', r: or('high') }, { l: tod, cmp: 'between', r: val(1000), r2: val(1500) });
    m.long.exit.items.push({ l: tod, cmp: 'at_least', r: val(1555) });
    m.short.entry.items.push({ l: px(), cmp: 'cross_below', r: or('low') }, { l: tod, cmp: 'between', r: val(1000), r2: val(1500) });
    m.short.exit.items.push({ l: tod, cmp: 'at_least', r: val(1555) });
    m.long.maxPerDay = 1; m.short.maxPerDay = 1; m.long.sl = 1; m.short.sl = 1;
    return m;
  } },
  { id: 'breakout', label: 'N-bar breakout with time stop (long)', build: () => {
    const m = newModel(); m.name = 'Breakout';
    m.long.entry.items.push({ l: px(), cmp: 'cross_above', r: { k: 'hl', fn: 'highest', src: 'high', n: 20, ago: 1 } });
    m.long.exit.op = 'or';
    m.long.exit.items.push({ l: px(), cmp: 'cross_below', r: { k: 'hl', fn: 'lowest', src: 'low', n: 10, ago: 1 } }, { l: { k: 'pos', f: 'bars' }, cmp: 'at_least', r: val(30) });
    return m;
  } },
];

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

/** The model of a builder-made script, but only while its conditions are still the ones the builder generated (hand-edited logic returns null). */
export function builderModelOf(code: string, info: InfoFn): Model | null {
  const m = parseModel(code);
  if (!m || checkModel(m, info)) return null;
  const tail = (c: string) => (c.split('// indicator values')[1] ?? '').replace(/\s+/g, '');
  return tail(toPine(m, info)) === tail(code) ? m : null;
}
