// Pine interpreter: compiles the AST to closures and runs the script once per bar.
import { parse, PineSyntaxError } from './parser.ts';
import type { Expr, Stmt } from './parser.ts';
import { NATIVES, CONSTS, VARS, SERIES_NAMES, NOOP_NAMESPACES, isNa, truthy, registerSourceInput } from './natives.ts';
import type { Ctx, Native } from './natives.ts';
import type { PineCandles, PineResult, PineMeta, TesterSettings } from './types.ts';
import './strategy.ts';
import { indicatorCode, parseParams } from './indlib.ts';

const NaN_ = Number.NaN;

class Cell { v: any; hist?: any[]; constructor(v: any) { this.v = v; } }
class Scope {
  m = new Map<string, Cell>();
  parent: Scope | null;
  global: boolean;
  constructor(parent: Scope | null) { this.parent = parent; this.global = parent === null; }
  get(name: string): Cell | undefined {
    let s: Scope | null = this;
    while (s) { const c = s.m.get(name); if (c) return c; s = s.parent; }
    return undefined;
  }
}
interface Frame { scope: Scope; path: string }
type Fn = (f: Frame) => any;

class Break { }
class Continue { }
const BRK = new Break(), CNT = new Continue();

interface UserFunc { params: { name: string; def?: Fn }[]; body: Fn }

function dotted(e: Expr): string | null {
  if (e.k === 'id') return e.name;
  if (e.k === 'member') { const o = dotted(e.obj); return o === null ? null : `${o}.${e.name}`; }
  return null;
}

export class Interp {
  private x: Ctx;
  private global = new Scope(null);
  private funcs = new Map<string, UserFunc>();
  private persistent = new Map<string, Cell>();
  private nodeStates = new Map<number, Map<string, Record<string, any>>>();
  private rootStates = new Map<number, Record<string, any>>();
  private hist = new Map<string, any[]>();
  private program: Fn;
  private line = 0;

  constructor(code: string, x: Ctx) {
    this.x = x;
    const ast = parse(code);
    // hoist function definitions
    this.program = this.block(ast, false);
  }

  /** Run the whole script over all bars. */
  run() {
    const x = this.x;
    const frame: Frame = { scope: this.global, path: '' };
    for (let b = 0; b < x.n; b++) {
      x.bar = b;
      x.broker?.beginBar(b);
      this.program(frame);
      x.broker?.endBar(b);
      x.onBarEnd?.(b);
      for (const [name, cell] of this.global.m) {
        if (cell.hist) {
          while (cell.hist.length < b) cell.hist.push(NaN_);
          cell.hist[b] = cell.v;
        }
      }
    }
  }

  // ---------- state helpers ----------
  private state(id: number, path: string): Record<string, any> {
    if (path === '') {
      let s = this.rootStates.get(id);
      if (!s) { s = {}; this.rootStates.set(id, s); }
      return s;
    }
    let m = this.nodeStates.get(id);
    if (!m) { m = new Map(); this.nodeStates.set(id, m); }
    let s = m.get(path);
    if (!s) { s = {}; m.set(path, s); }
    return s;
  }

  // ---------- statements ----------
  private block(stmts: Stmt[], scoped: boolean): Fn {
    for (const s of stmts) if (s.k === 'func') this.funcs.set(s.name, { params: [], body: () => NaN_ });
    const fns = stmts.map((s) => this.stmt(s));
    const needs = scoped && stmts.some((s) => s.k === 'decl' || s.k === 'func');
    return (f) => {
      const fr = needs ? { scope: new Scope(f.scope), path: f.path } : f;
      let last: any = NaN_;
      for (let i = 0; i < fns.length; i++) last = fns[i](fr);
      return last;
    };
  }

  private stmt(s: Stmt): Fn {
    switch (s.k) {
      case 'expr': return this.expr(s.e);
      case 'break': return () => { throw BRK; };
      case 'continue': return () => { throw CNT; };
      case 'func': return this.funcStmt(s);
      case 'assign': return this.assign(s);
      case 'decl': return this.decl(s);
    }
  }

  private funcStmt(s: Extract<Stmt, { k: 'func' }>): Fn {
    const params = s.params.map((p) => ({ name: p.name, def: p.def ? this.expr(p.def) : undefined }));
    const body = this.block(s.body, false);
    this.funcs.set(s.name, { params, body });
    return () => NaN_;
  }

  private decl(s: Extract<Stmt, { k: 'decl' }>): Fn {
    const init = this.expr(s.init);
    if (s.tuple) {
      return (f) => {
        const v = init(f);
        const arr = Array.isArray(v) ? v : [v];
        s.names.forEach((n, i) => {
          const cell = f.scope.m.get(n);
          const val = arr[i] === undefined ? NaN_ : arr[i];
          if (cell) cell.v = val; else this.newCell(f, n, val);
        });
        return v;
      };
    }
    const name = s.names[0];
    if (s.mode === 'var' || s.mode === 'varip') {
      return (f) => {
        const key = f.path + '|' + s.id;
        let cell = this.persistent.get(key);
        if (!cell) { cell = new Cell(init(f)); if (f.scope.global) cell.hist = []; this.persistent.set(key, cell); }
        f.scope.m.set(name, cell);
        return cell.v;
      };
    }
    return (f) => {
      const v = init(f);
      const cell = f.scope.m.get(name);
      if (cell) cell.v = v; else this.newCell(f, name, v);
      return v;
    };
  }

  private newCell(f: Frame, name: string, v: any) {
    const c = new Cell(v);
    if (f.scope.global) { c.hist = []; for (let i = 0; i < this.x.bar; i++) c.hist.push(NaN_); }
    f.scope.m.set(name, c);
  }

  private assign(s: Extract<Stmt, { k: 'assign' }>): Fn {
    const val = this.expr(s.value);
    const name = s.target;
    const op = s.op;
    return (f) => {
      const cell = f.scope.get(name);
      if (!cell) throw new Error(`cannot assign to undeclared variable '${name}'`);
      let v = val(f);
      if (op !== ':=') {
        const cur = cell.v;
        v = op === '+=' ? add(cur, v) : op === '-=' ? cur - v : op === '*=' ? cur * v : op === '/=' ? cur / v : cur % v;
      }
      cell.v = v;
      return v;
    };
  }

  // ---------- expressions ----------
  private expr(e: Expr): Fn {
    switch (e.k) {
      case 'num': { const v = e.v; return () => v; }
      case 'str': { const v = e.v; return () => v; }
      case 'bool': { const v = e.v; return () => v; }
      case 'color': { const v = e.v.toUpperCase(); return () => v; }
      case 'na': return () => NaN_;
      case 'id': return this.ident(e.name, e.line);
      case 'member': return this.member(e);
      case 'arr': { const items = e.items.map((i) => this.expr(i)); return (f) => items.map((i) => i(f)); }
      case 'unary': {
        const v = this.expr(e.e);
        if (e.op === 'not') return (f) => !truthy(v(f));
        if (e.op === '-') return (f) => -v(f);
        return v;
      }
      case 'bin': return this.binary(e);
      case 'tern': {
        const c = this.expr(e.c), a = this.expr(e.a), b = this.expr(e.b);
        return (f) => (truthy(c(f)) ? a(f) : b(f));
      }
      case 'index': return this.index(e);
      case 'call': return this.call(e);
      case 'if': {
        const c = this.expr(e.cond), t = this.block(e.then, true), el = e.else ? this.block(e.else, true) : null;
        return (f) => (truthy(c(f)) ? t(f) : el ? el(f) : NaN_);
      }
      case 'for': return this.forLoop(e);
      case 'forin': return this.forIn(e);
      case 'while': {
        const c = this.expr(e.cond), body = this.block(e.body, true);
        return (f) => {
          let last: any = NaN_, guard = 0;
          while (truthy(c(f))) {
            if (++guard > 1_000_000) throw new Error('while loop exceeded 1,000,000 iterations');
            try { last = body(f); } catch (err) { if (err === BRK) break; if (err !== CNT) throw err; }
          }
          return last;
        };
      }
      case 'switch': {
        const subject = e.subject ? this.expr(e.subject) : null;
        const cases = e.cases.map((c) => ({ test: c.test ? this.expr(c.test) : null, body: this.block(c.body, true) }));
        return (f) => {
          const sv = subject ? subject(f) : undefined;
          for (const c of cases) {
            if (!c.test) return c.body(f);
            const t = c.test(f);
            if (subject ? t === sv : truthy(t)) return c.body(f);
          }
          return NaN_;
        };
      }
    }
  }

  private forLoop(e: Extract<Expr, { k: 'for' }>): Fn {
    const from = this.expr(e.from), to = this.expr(e.to), by = e.by ? this.expr(e.by) : null;
    const body = this.block(e.body, false);
    const name = e.v;
    return (f) => {
      const a = from(f), b = to(f);
      let step = by ? by(f) : a <= b ? 1 : -1;
      if (step === 0) step = 1;
      const scope = new Scope(f.scope);
      scope.global = false;
      const cell = new Cell(a);
      scope.m.set(name, cell);
      const fr: Frame = { scope, path: f.path };
      let last: any = NaN_;
      for (let i = a; step > 0 ? i <= b : i >= b; i += step) {
        cell.v = i;
        try { last = body(fr); } catch (err) { if (err === BRK) break; if (err !== CNT) throw err; }
      }
      return last;
    };
  }

  private forIn(e: Extract<Expr, { k: 'forin' }>): Fn {
    const iter = this.expr(e.iter);
    const body = this.block(e.body, false);
    return (f) => {
      const a = iter(f);
      if (!Array.isArray(a)) throw new Error('for...in needs an array');
      const scope = new Scope(f.scope);
      scope.global = false;
      const fr: Frame = { scope, path: f.path };
      let last: any = NaN_;
      for (let i = 0; i < a.length; i++) {
        if (e.vars.length === 2) { scope.m.set(e.vars[0], new Cell(i)); scope.m.set(e.vars[1], new Cell(a[i])); }
        else scope.m.set(e.vars[0], new Cell(a[i]));
        try { last = body(fr); } catch (err) { if (err === BRK) break; if (err !== CNT) throw err; }
      }
      return last;
    };
  }

  private binary(e: Extract<Expr, { k: 'bin' }>): Fn {
    const l = this.expr(e.l), r = this.expr(e.r);
    switch (e.op) {
      case '+': return (f) => add(l(f), r(f));
      case '-': return (f) => l(f) - r(f);
      case '*': return (f) => l(f) * r(f);
      case '/': return (f) => l(f) / r(f);
      case '%': return (f) => l(f) % r(f);
      case '==': return (f) => { const a = l(f), b = r(f); return isNa(a) && isNa(b) ? true : a === b; };
      case '!=': return (f) => { const a = l(f), b = r(f); return isNa(a) && isNa(b) ? false : a !== b; };
      case '<': return (f) => l(f) < r(f);
      case '<=': return (f) => l(f) <= r(f);
      case '>': return (f) => l(f) > r(f);
      case '>=': return (f) => l(f) >= r(f);
      case 'and': return (f) => truthy(l(f)) && truthy(r(f));
      case 'or': return (f) => truthy(l(f)) || truthy(r(f));
    }
    throw new Error(`unknown operator ${e.op}`);
  }

  /** Value of a builtin series at bar (bar - back). */
  private seriesAt(name: string, back: number): any {
    const x = this.x;
    const b = x.bar - back;
    if (b < 0) return NaN_;
    switch (name) {
      case 'open': return x.o[b];
      case 'high': return x.h[b];
      case 'low': return x.l[b];
      case 'close': return x.c[b];
      case 'volume': return x.v[b];
      case 'time': return x.tms[b];
      case 'time_close': return x.tms[b] + x.step * 1000;
      case 'bar_index': return b;
      case 'hl2': return (x.h[b] + x.l[b]) / 2;
      case 'hlc3': return (x.h[b] + x.l[b] + x.c[b]) / 3;
      case 'ohlc4': return (x.o[b] + x.h[b] + x.l[b] + x.c[b]) / 4;
      case 'hlcc4': return (x.h[b] + x.l[b] + 2 * x.c[b]) / 4;
      case 'tr': return b === 0 ? x.h[0] - x.l[0] : Math.max(x.h[b] - x.l[b], Math.abs(x.h[b] - x.c[b - 1]), Math.abs(x.l[b] - x.c[b - 1]));
    }
    return NaN_;
  }

  private ident(name: string, line: number): Fn {
    if (SERIES_NAMES.has(name)) return () => this.seriesAt(name, 0);
    return (f) => {
      const cell = f.scope.get(name);
      if (cell) return cell.v;
      const v = VARS[name];
      if (v) return v(this.x, this.varState(name));
      if (name in CONSTS) return CONSTS[name];
      this.line = line;
      throw new Error(`undeclared identifier '${name}'`);
    };
  }

  private varStates = new Map<string, Record<string, any>>();
  private varState(name: string) {
    let s = this.varStates.get(name);
    if (!s) { s = {}; this.varStates.set(name, s); }
    return s;
  }

  private member(e: Extract<Expr, { k: 'member' }>): Fn {
    const name = dotted(e);
    if (name === null) {
      const obj = this.expr(e.obj);
      return (f) => { const o = obj(f); if (o && typeof o === 'object' && e.name in o) return o[e.name]; throw new Error(`'.${e.name}' is not a field of a function result: take the values with [a, b] = fn(...)`); };
    }
    const first = name.split('.')[0];
    return (f) => {
      if (name in CONSTS) return CONSTS[name];
      const v = VARS[name];
      if (v) return v(this.x, this.varState(name));
      if (f.scope.get(first)) throw new Error(`property access on variables is not supported: ${name}`);
      const nat = NATIVES[name];
      if (nat && nat.params.length === 0) return nat.fn([], this.x, this.varState(name), null);
      if (name.startsWith('strategy.') || name.startsWith('syminfo.') || name.startsWith('barstate.')) return NaN_;
      throw new Error(`unknown identifier '${name}'`);
    };
  }

  private index(e: Extract<Expr, { k: 'index' }>): Fn {
    const idx = this.expr(e.idx);
    const base = e.base;
    if (base.k === 'id' && SERIES_NAMES.has(base.name)) {
      const nm = base.name;
      return (f) => { const n = idx(f); return Number.isNaN(n) ? NaN_ : this.seriesAt(nm, n | 0); };
    }
    if (base.k === 'id') {
      const name = base.name;
      const fallback = this.expr(base);
      return (f) => {
        const n = idx(f) | 0;
        const cell = f.scope.get(name);
        if (cell && cell.hist) {
          if (n === 0) return cell.v;
          const v = cell.hist[this.x.bar - n];
          return v === undefined ? NaN_ : v;
        }
        if (n === 0) return fallback(f);
        // non-global variables: keep a per-bar history keyed by path+name
        return this.localHistory(f, name, cell ? cell.v : NaN_, n);
      };
    }
    // arbitrary expression: record its value each bar it is evaluated
    const inner = this.expr(base);
    return (f) => {
      const n = idx(f) | 0;
      const st = this.state(e.id, f.path);
      const cur = inner(f);
      const h: any[] = (st.h ??= []);
      h[this.x.bar] = cur;
      if (n === 0) return cur;
      const v = h[this.x.bar - n];
      return v === undefined ? NaN_ : v;
    };
  }

  private localHistory(f: Frame, name: string, cur: any, n: number): any {
    const key = f.path + '#' + name;
    let h = this.hist.get(key);
    if (!h) { h = []; this.hist.set(key, h); }
    h[this.x.bar] = cur;
    const v = h[this.x.bar - n];
    return v === undefined ? NaN_ : v;
  }

  // ---------- calls ----------
  private call(e: Extract<Expr, { k: 'call' }>): Fn {
    const name = dotted(e.callee);
    const pos: Fn[] = [], named: { name: string; fn: Fn }[] = [];
    for (const a of e.args) { if (a.name) named.push({ name: a.name, fn: this.expr(a.value) }); else pos.push(this.expr(a.value)); }
    const line = e.line;

    // user-defined function
    if (name && !name.includes('.') && this.funcs.has(name)) {
      return (f) => {
        const fn = this.funcs.get(name)!;
        const scope = new Scope(this.global);
        scope.global = false;
        const argVals = pos.map((p) => p(f));
        fn.params.forEach((p, i) => {
          let v: any;
          const nm = named.find((n) => n.name === p.name);
          if (i < argVals.length) v = argVals[i];
          else if (nm) v = nm.fn(f);
          else v = p.def ? p.def({ scope, path: f.path }) : NaN_;
          scope.m.set(p.name, new Cell(v));
        });
        this.line = line;
        return fn.body({ scope, path: f.path + '>' + e.id });
      };
    }

    if (!name) {
      // method call on an expression result: arr().push(x) etc. is not supported
      throw new PineSyntaxError('unsupported call target', line);
    }

    // input.source(close, "title") needs the identifier, not its value
    if ((name === 'input.source' || name === 'input') && e.args[0]?.value.k === 'id' && SERIES_NAMES.has((e.args[0].value as any).name)) {
      const defName = (e.args[0].value as any).name as string;
      const titleArg = e.args.find((a) => a.name === 'title') ?? e.args[1];
      const titleFn = titleArg && !titleArg.name || titleArg?.name === 'title' ? this.expr(titleArg!.value) : null;
      return (f) => {
        const st = this.state(e.id, f.path);
        const title = titleFn ? String(titleFn(f)) : '';
        const chosen = registerSourceInput(this.x, st, title, defName);
        return this.seriesAt(chosen, 0);
      };
    }

    const ns = name.split('.')[0];
    const nat: Native | undefined = NATIVES[name];

    // method-style call on an array variable: myArray.push(x)
    const parts = name.split('.');
    if (!nat && parts.length === 2) {
      const method = NATIVES['array.' + parts[1]];
      if (method) {
        return (f) => {
          const cell = f.scope.get(parts[0]);
          if (!cell) throw new Error(`unknown function '${name}'`);
          return method.fn([cell.v, ...pos.map((p) => p(f))], this.x, this.state(e.id, f.path), e);
        };
      }
    }

    if (!nat) {
      if (NOOP_NAMESPACES.has(ns) || ns === 'strategy' || name.startsWith('strategy.')) {
        const strat = NATIVES[name];
        if (!strat) return (f) => { for (const p of pos) p(f); return NaN_; };
      }
      return () => { this.line = line; throw new Error(`unknown function '${name}'`); };
    }

    const params = nat.params;
    const rest = params[params.length - 1] === '...';
    const slotOf = named.map((n) => params.indexOf(n.name));
    return (f) => {
      const a: any[] = new Array(rest ? 0 : params.length);
      for (let i = 0; i < pos.length; i++) a[i] = pos[i](f);
      for (let i = 0; i < named.length; i++) {
        const slot = slotOf[i];
        if (slot >= 0) a[slot] = named[i].fn(f);
        else if (!rest) { /* unknown named argument: evaluate for side effects, ignore */ named[i].fn(f); }
      }
      this.line = line;
      const r = nat.fn(a, this.x, this.state(e.id, f.path), e);
      // plot()/hline() ids carry their kind so fill() can tell them apart
      if (name === 'hline') return { kind: 'hline', id: r };
      if (name === 'plot') return { kind: 'plot', id: r };
      return r;
    };
  }
}

function add(a: any, b: any) {
  if (typeof a === 'string' || typeof b === 'string') return String(isNa(a) ? '' : a) + String(isNa(b) ? '' : b);
  return a + b;
}

export interface RunOptions {
  params?: Record<string, any>;
  step?: number;
  symbol?: string;
  mintick?: number;
  /** Strategy Tester settings overriding the strategy() declaration */
  broker?: TesterSettings;
  /** sources of the library indicators the script reads with oviate.ind (workers have no library of their own) */
  lib?: Record<string, string>;
  /** strategy runs: the equity so far, about 60 times per run (bar index, copy of the equity values up to that bar) */
  onEquity?: (bar: number, equity: Float64Array) => void;
}

export function runPine(code: string, data: PineCandles, opts: RunOptions = {}): PineResult {
  const meta: PineMeta = { kind: 'indicator', title: 'Script', shorttitle: 'Script', overlay: false };
  const tms = new Float64Array(data.n);
  for (let i = 0; i < data.n; i++) tms[i] = data.t[i] * 1000;
  const x: Ctx = {
    ...data, bar: 0, tms, params: opts.params ?? {}, inputs: [], plots: [], shapes: [], hlines: [], fills: [],
    bgcolors: new Array(data.n), barcolors: new Array(data.n), warnings: [], meta, step: opts.step ?? 86400,
    symbol: opts.symbol ?? 'SYMBOL', mintick: opts.mintick ?? 0.01, brokerCfg: opts.broker, lib: opts.lib,
    seriesByName: (n: string) => (SERIES_NAMES.has(n) ? new Float64Array(0) : undefined),
  };
  if (opts.onEquity) {
    const every = Math.max(10, Math.floor(data.n / 60)), cb = opts.onEquity;
    x.onBarEnd = (b) => { if ((b % every === 0 || b === data.n - 1) && x.broker) cb(b, x.broker.equityUpTo(b)); };
  }
  const result = (): PineResult => ({
    meta, inputs: x.inputs, plots: x.plots, shapes: x.shapes, hlines: x.hlines, fills: x.fills,
    bgcolors: x.bgcolors, barcolors: x.barcolors, warnings: x.warnings,
    strategy: x.broker?.result?.(),
  });
  let it: Interp | null = null;
  try {
    it = new Interp(code, x);
    it.run();
    return result();
  } catch (e: any) {
    const r = result();
    r.error = { message: e?.message ?? String(e), line: e instanceof PineSyntaxError ? e.line : undefined };
    return r;
  }
}

// oviate.ind: plot value of a library indicator, computed once over the same candles and read per bar
NATIVES['oviate.ind'] = {
  params: ['name', 'plot', 'inputs'],
  fn: (a, x) => {
    const name = String(a[0]);
    const code = indicatorCode(name, x.lib);
    if (!code) throw new Error(`oviate.ind: indicator "${name}" not found`);
    const inputs = typeof a[2] === 'string' ? a[2] : '';
    const key = name + '|' + inputs;
    const cache = (x.indCache ??= new Map());
    let res = cache.get(key);
    if (!res) {
      res = runPine(code, x, { params: parseParams(inputs), step: x.step, symbol: x.symbol, mintick: x.mintick, lib: x.lib });
      if (res.error) throw new Error(`oviate.ind "${name}": ${res.error.message}`);
      cache.set(key, res);
    }
    const pl = typeof a[1] === 'number' ? res.plots[a[1]] : res.plots.find((p: { title: string }) => p.title === a[1]);
    if (!pl) throw new Error(`oviate.ind: "${name}" has no plot "${a[1]}" (${res.plots.map((p: { title: string }) => p.title).join(', ')})`);
    const v = pl.values[x.bar - pl.offset];
    return v === undefined ? Number.NaN : v;
  },
};

// oviate.hhmm / oviate.dow / oviate.date: wall-clock time of each bar in a time zone (IANA name, "UTC" default), computed once per zone.
// hhmm = hour * 100 + minute (9:30 -> 930), dow = 1 (Monday) .. 7 (Sunday), date = yyyymmdd.
const zoneFmt = new Map<string, Intl.DateTimeFormat>();
function zoneTimes(x: import('./natives.ts').Ctx, tz: string) {
  const cache = ((x as any).zoneCache ??= new Map<string, { hhmm: Float64Array; dow: Float64Array; date: Float64Array }>()) as Map<string, { hhmm: Float64Array; dow: Float64Array; date: Float64Array }>;
  let c = cache.get(tz);
  if (c) return c;
  let f = zoneFmt.get(tz);
  if (!f) {
    try { f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' }); }
    catch { throw new Error(`unknown time zone "${tz}"`); }
    zoneFmt.set(tz, f);
  }
  const DOW: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  c = { hhmm: new Float64Array(x.n), dow: new Float64Array(x.n), date: new Float64Array(x.n) };
  for (let i = 0; i < x.n; i++) {
    const p: Record<string, string> = {};
    for (const q of f.formatToParts(x.t[i] * 1000)) p[q.type] = q.value;
    c.hhmm[i] = Number(p.hour) * 100 + Number(p.minute);
    c.dow[i] = DOW[p.weekday] ?? 0;
    c.date[i] = Number(p.year) * 10000 + Number(p.month) * 100 + Number(p.day);
  }
  cache.set(tz, c);
  return c;
}
for (const [name, key] of [['oviate.hhmm', 'hhmm'], ['oviate.dow', 'dow'], ['oviate.date', 'date']] as const) {
  NATIVES[name] = { params: ['tz'], fn: (a, x) => zoneTimes(x, typeof a[0] === 'string' && a[0] ? a[0] : 'UTC')[key][x.bar] };
}
