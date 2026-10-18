// Technical-analysis natives (ta.*). Every function is stateful per call site and must be called once per bar.
import type { Ctx, Native } from './natives.ts';

type St = Record<string, any>;
const NaN_ = Number.NaN;
const isNa = (v: unknown) => v === undefined || v === null || (typeof v === 'number' && Number.isNaN(v));

function hist(st: St, key: string, v: number): number[] {
  const a: number[] = (st[key] ??= []);
  a.push(v);
  return a;
}

// ---- incremental building blocks (state lives in `s`) ----
export function smaStep(s: St, v: number, len: number): number {
  const a = hist(s, 'a', v);
  const i = a.length - 1;
  if (Number.isNaN(v)) s.nan = (s.nan ?? 0) + 1; else s.sum = (s.sum ?? 0) + v;
  if (i >= len) { const o = a[i - len]; if (Number.isNaN(o)) s.nan--; else s.sum -= o; }
  return i >= len - 1 && !s.nan ? s.sum / len : NaN_;
}

export function emaStep(s: St, v: number, len: number, alpha = 2 / (len + 1)): number {
  if (Number.isNaN(v)) return NaN_;
  if (s.prev === undefined) {
    s.seed ??= {};
    const m = smaStep(s.seed, v, len);
    if (!Number.isNaN(m)) s.prev = m; else return NaN_;
    return s.prev;
  }
  s.prev = alpha * v + (1 - alpha) * s.prev;
  return s.prev;
}

export const rmaStep = (s: St, v: number, len: number) => emaStep(s, v, len, 1 / len);

function window(a: number[], len: number): number[] | null {
  if (a.length < len) return null;
  return a.slice(a.length - len);
}

function wmaOf(a: number[], len: number): number {
  if (a.length < len) return NaN_;
  let sum = 0, norm = 0;
  for (let k = 0; k < len; k++) { const v = a[a.length - 1 - k]; if (Number.isNaN(v)) return NaN_; const w = len - k; sum += v * w; norm += w; }
  return sum / norm;
}

function stdevOf(w: number[], biased: boolean): number {
  const n = w.length;
  let m = 0;
  for (const v of w) { if (Number.isNaN(v)) return NaN_; m += v; }
  m /= n;
  let s = 0;
  for (const v of w) s += (v - m) * (v - m);
  return Math.sqrt(s / (biased ? n : n - 1));
}

export function trueRange(x: Ctx, bar = x.bar): number {
  if (bar === 0) return x.h[0] - x.l[0];
  return Math.max(x.h[bar] - x.l[bar], Math.abs(x.h[bar] - x.c[bar - 1]), Math.abs(x.l[bar] - x.c[bar - 1]));
}

/** Previous value of this call's input (for change/crossing helpers). */
function prevOf(st: St, key: string, v: number): number {
  const p = st[key] ?? NaN_;
  st[key] = v;
  return p;
}

function linregOf(w: number[]): { slope: number; intercept: number } {
  const n = w.length;
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { const y = w[i]; if (Number.isNaN(y)) return { slope: NaN_, intercept: NaN_ }; sx += i; sy += y; sxy += i * y; sxx += i * i; }
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx || 1);
  return { slope, intercept: (sy - slope * sx) / n };
}

export const TA: Record<string, Native> = {};
function def(name: string, params: string[], fn: Native['fn']) { TA[name] = { params, fn }; }

// ---- moving averages ----
def('ta.sma', ['source', 'length'], (a, x, st) => smaStep(st, a[0], a[1]));
def('ta.ema', ['source', 'length'], (a, x, st) => emaStep(st, a[0], a[1]));
def('ta.rma', ['source', 'length'], (a, x, st) => rmaStep(st, a[0], a[1]));
def('ta.wma', ['source', 'length'], (a, x, st) => wmaOf(hist(st, 'a', a[0]), a[1]));
def('ta.swma', ['source'], (a, x, st) => {
  const h = hist(st, 'a', a[0]);
  if (h.length < 4) return NaN_;
  const n = h.length;
  return (h[n - 4] * 1 + h[n - 3] * 2 + h[n - 2] * 2 + h[n - 1] * 1) / 6;
});
def('ta.vwma', ['source', 'length'], (a, x, st) => {
  const num = smaStep((st.n ??= {}), a[0] * x.v[x.bar], a[1]);
  const den = smaStep((st.d ??= {}), x.v[x.bar], a[1]);
  return num / den;
});
def('ta.hma', ['source', 'length'], (a, x, st) => {
  const len = a[1] | 0;
  const half = Math.max(1, Math.floor(len / 2)), sq = Math.max(1, Math.round(Math.sqrt(len)));
  const src = hist(st, 'src', a[0]);
  const w1 = wmaOf(src, half), w2 = wmaOf(src, len);
  const diff = hist(st, 'diff', 2 * w1 - w2);
  return wmaOf(diff, sq);
});
def('ta.alma', ['series', 'length', 'offset', 'sigma'], (a, x, st) => {
  const len = a[1] | 0, off = a[2] ?? 0.85, sigma = a[3] ?? 6;
  const h = hist(st, 'a', a[0]);
  if (h.length < len) return NaN_;
  const m = off * (len - 1), s = len / sigma;
  let sum = 0, norm = 0;
  for (let i = 0; i < len; i++) { const w = Math.exp(-((i - m) * (i - m)) / (2 * s * s)); sum += h[h.length - len + i] * w; norm += w; }
  return sum / norm;
});
def('ta.linreg', ['source', 'length', 'offset'], (a, x, st) => {
  const len = a[1] | 0, off = a[2] ?? 0;
  const w = window(hist(st, 'a', a[0]), len);
  if (!w) return NaN_;
  const { slope, intercept } = linregOf(w);
  return intercept + slope * (len - 1 - off);
});

// ---- statistics ----
def('ta.stdev', ['source', 'length', 'biased'], (a, x, st) => {
  const w = window(hist(st, 'a', a[0]), a[1] | 0);
  return w ? stdevOf(w, a[2] ?? true) : NaN_;
});
def('ta.variance', ['source', 'length', 'biased'], (a, x, st) => {
  const w = window(hist(st, 'a', a[0]), a[1] | 0);
  if (!w) return NaN_;
  const s = stdevOf(w, a[2] ?? true);
  return s * s;
});
def('ta.dev', ['source', 'length'], (a, x, st) => {
  const w = window(hist(st, 'a', a[0]), a[1] | 0);
  if (!w) return NaN_;
  const m = w.reduce((p, c) => p + c, 0) / w.length;
  return w.reduce((p, c) => p + Math.abs(c - m), 0) / w.length;
});
def('ta.median', ['source', 'length'], (a, x, st) => {
  const w = window(hist(st, 'a', a[0]), a[1] | 0);
  if (!w) return NaN_;
  const s = [...w].sort((p, q) => p - q);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
});
def('ta.percentrank', ['source', 'length'], (a, x, st) => {
  const len = a[1] | 0;
  const h = hist(st, 'a', a[0]);
  if (h.length <= len) return NaN_;
  let c = 0;
  for (let k = 1; k <= len; k++) if (h[h.length - 1 - k] <= a[0]) c++;
  return (c / len) * 100;
});
def('ta.correlation', ['source1', 'source2', 'length'], (a, x, st) => {
  const len = a[2] | 0;
  const w1 = window(hist(st, 'a', a[0]), len), w2 = window(hist(st, 'b', a[1]), len);
  if (!w1 || !w2) return NaN_;
  const m1 = w1.reduce((p, c) => p + c, 0) / len, m2 = w2.reduce((p, c) => p + c, 0) / len;
  let sxy = 0, sx = 0, sy = 0;
  for (let i = 0; i < len; i++) { sxy += (w1[i] - m1) * (w2[i] - m2); sx += (w1[i] - m1) ** 2; sy += (w2[i] - m2) ** 2; }
  return sxy / Math.sqrt(sx * sy || 1);
});

// highest/lowest accept (source, len) or just (len) using high/low
function hiLo(name: string, hi: boolean, bars: boolean) {
  def(name, ['source', 'length'], (a, x, st) => {
    let src = a[0], len = a[1];
    if (len === undefined) { len = src; src = hi ? x.h[x.bar] : x.l[x.bar]; }
    len |= 0;
    const h = hist(st, 'a', src);
    if (h.length < len) return NaN_;
    let best = hi ? -Infinity : Infinity, at = 0;
    for (let k = 0; k < len; k++) {
      const v = h[h.length - 1 - k];
      if (Number.isNaN(v)) return NaN_;
      if (hi ? v > best : v < best) { best = v; at = k; }
    }
    return bars ? -at : best;
  });
}
hiLo('ta.highest', true, false); hiLo('ta.lowest', false, false);
hiLo('ta.highestbars', true, true); hiLo('ta.lowestbars', false, true);
def('ta.range', ['source', 'length'], (a, x, st) => {
  const h = hist(st, 'a', a[0]);
  const len = a[1] | 0;
  if (h.length < len) return NaN_;
  const w = h.slice(h.length - len);
  return Math.max(...w) - Math.min(...w);
});

// ---- change / momentum ----
def('ta.change', ['source', 'length'], (a, x, st) => {
  const h = hist(st, 'a', a[0]);
  const len = a[1] === undefined ? 1 : a[1] | 0;
  return h.length > len ? a[0] - h[h.length - 1 - len] : NaN_;
});
def('ta.mom', ['source', 'length'], (a, x, st) => {
  const h = hist(st, 'a', a[0]);
  const len = a[1] | 0;
  return h.length > len ? a[0] - h[h.length - 1 - len] : NaN_;
});
def('ta.roc', ['source', 'length'], (a, x, st) => {
  const h = hist(st, 'a', a[0]);
  const len = a[1] | 0;
  if (h.length <= len) return NaN_;
  const p = h[h.length - 1 - len];
  return (100 * (a[0] - p)) / p;
});
def('ta.cum', ['source'], (a, x, st) => { st.s = (st.s ?? 0) + (Number.isNaN(a[0]) ? 0 : a[0]); return st.s; });
def('ta.rsi', ['source', 'length'], (a, x, st) => {
  const h = hist(st, 'a', a[0]);
  const len = a[1] | 0;
  if (h.length < 2) return NaN_;
  const ch = a[0] - h[h.length - 2];
  const up = rmaStep((st.u ??= {}), Math.max(ch, 0), len);
  const dn = rmaStep((st.d ??= {}), Math.max(-ch, 0), len);
  if (Number.isNaN(up) || Number.isNaN(dn)) return NaN_;
  return dn === 0 ? 100 : up === 0 ? 0 : 100 - 100 / (1 + up / dn);
});
def('ta.cmo', ['source', 'length'], (a, x, st) => {
  const h = hist(st, 'a', a[0]);
  const len = a[1] | 0;
  if (h.length <= len) return NaN_;
  let up = 0, dn = 0;
  for (let k = 0; k < len; k++) { const d = h[h.length - 1 - k] - h[h.length - 2 - k]; if (d > 0) up += d; else dn -= d; }
  return up + dn === 0 ? 0 : (100 * (up - dn)) / (up + dn);
});
def('ta.cci', ['source', 'length'], (a, x, st) => {
  const len = a[1] | 0;
  const w = window(hist(st, 'a', a[0]), len);
  if (!w) return NaN_;
  const m = w.reduce((p, c) => p + c, 0) / len;
  const dev = w.reduce((p, c) => p + Math.abs(c - m), 0) / len;
  return dev === 0 ? 0 : (a[0] - m) / (0.015 * dev);
});
def('ta.mfi', ['series', 'length'], (a, x, st) => {
  const len = a[1] | 0, src = a[0];
  const prev = prevOf(st, 'p', src);
  const ch = src - prev;
  const up = smaStep((st.u ??= {}), Number.isNaN(ch) ? NaN_ : ch <= 0 ? 0 : x.v[x.bar] * src, len);
  const dn = smaStep((st.d ??= {}), Number.isNaN(ch) ? NaN_ : ch >= 0 ? 0 : x.v[x.bar] * src, len);
  if (Number.isNaN(up) || Number.isNaN(dn)) return NaN_;
  return dn === 0 ? 100 : 100 - 100 / (1 + up / dn);
});
def('ta.stoch', ['source', 'high', 'low', 'length'], (a, x, st) => {
  const len = a[3] | 0;
  const hh = hist(st, 'h', a[1]), ll = hist(st, 'l', a[2]);
  if (hh.length < len) return NaN_;
  const H = Math.max(...hh.slice(hh.length - len)), L = Math.min(...ll.slice(ll.length - len));
  return H === L ? 0 : (100 * (a[0] - L)) / (H - L);
});
def('ta.wpr', ['length'], (a, x, st) => {
  const len = a[0] | 0;
  const hh = hist(st, 'h', x.h[x.bar]), ll = hist(st, 'l', x.l[x.bar]);
  if (hh.length < len) return NaN_;
  const H = Math.max(...hh.slice(hh.length - len)), L = Math.min(...ll.slice(ll.length - len));
  return H === L ? 0 : (100 * (x.c[x.bar] - H)) / (H - L);
});
def('ta.tsi', ['source', 'short_length', 'long_length'], (a, x, st) => {
  const h = hist(st, 'a', a[0]);
  if (h.length < 2) return NaN_;
  const m = a[0] - h[h.length - 2];
  const num = emaStep((st.s1 ??= {}), emaStep((st.l1 ??= {}), m, a[2] | 0), a[1] | 0);
  const den = emaStep((st.s2 ??= {}), emaStep((st.l2 ??= {}), Math.abs(m), a[2] | 0), a[1] | 0);
  return den === 0 ? 0 : 100 * (num / den);
});
def('ta.cog', ['source', 'length'], (a, x, st) => {
  const len = a[1] | 0;
  const w = window(hist(st, 'a', a[0]), len);
  if (!w) return NaN_;
  let num = 0, den = 0;
  for (let i = 0; i < len; i++) { const v = w[len - 1 - i]; num += v * (i + 1); den += v; }
  return -num / den;
});

// ---- volatility ----
def('ta.tr', ['handle_na'], (a, x) => trueRange(x));
def('ta.atr', ['length'], (a, x, st) => rmaStep(st, trueRange(x), a[0] | 0));
def('ta.bb', ['series', 'length', 'mult'], (a, x, st) => {
  const len = a[1] | 0;
  const w = window(hist(st, 'a', a[0]), len);
  const basis = smaStep((st.m ??= {}), a[0], len);
  if (!w) return [NaN_, NaN_, NaN_];
  const d = a[2] * stdevOf(w, true);
  return [basis, basis + d, basis - d];
});
def('ta.bbw', ['series', 'length', 'mult'], (a, x, st) => {
  const r = TA['ta.bb'].fn(a, x, (st.b ??= {}), null) as number[];
  return (r[1] - r[2]) / r[0];
});
def('ta.kc', ['series', 'length', 'mult', 'useTrueRange'], (a, x, st) => {
  const len = a[1] | 0;
  const range = (a[3] ?? true) ? trueRange(x) : x.h[x.bar] - x.l[x.bar];
  const basis = emaStep((st.m ??= {}), a[0], len);
  const r = emaStep((st.r ??= {}), range, len);
  return [basis, basis + r * a[2], basis - r * a[2]];
});
def('ta.kcw', ['series', 'length', 'mult', 'useTrueRange'], (a, x, st) => {
  const r = TA['ta.kc'].fn(a, x, (st.b ??= {}), null) as number[];
  return (r[1] - r[2]) / r[0];
});

// ---- trend ----
def('ta.macd', ['source', 'fastlen', 'slowlen', 'siglen'], (a, x, st) => {
  const f = emaStep((st.f ??= {}), a[0], a[1] | 0), s = emaStep((st.s ??= {}), a[0], a[2] | 0);
  const m = f - s;
  const sig = emaStep((st.g ??= {}), m, a[3] | 0);
  return [m, sig, m - sig];
});
def('ta.dmi', ['diLength', 'adxSmoothing'], (a, x, st) => {
  const b = x.bar, len = a[0] | 0;
  if (b === 0) { rmaStep((st.tr ??= {}), trueRange(x), len); return [NaN_, NaN_, NaN_]; }
  const up = x.h[b] - x.h[b - 1], dn = x.l[b - 1] - x.l[b];
  const pdm = up > dn && up > 0 ? up : 0, mdm = dn > up && dn > 0 ? dn : 0;
  const tr = rmaStep((st.tr ??= {}), trueRange(x), len);
  const p = (100 * rmaStep((st.p ??= {}), pdm, len)) / tr, m = (100 * rmaStep((st.m ??= {}), mdm, len)) / tr;
  const sum = p + m;
  const adx = 100 * rmaStep((st.a ??= {}), Math.abs(p - m) / (sum === 0 ? 1 : sum), a[1] | 0);
  return [p, m, adx];
});
def('ta.supertrend', ['factor', 'atrPeriod'], (a, x, st) => {
  const b = x.bar;
  const atr = rmaStep((st.atr ??= {}), trueRange(x), a[1] | 0);
  if (Number.isNaN(atr)) return [NaN_, 1];
  const src = (x.h[b] + x.l[b]) / 2;
  let up = src + a[0] * atr, lo = src - a[0] * atr;
  const pLo = st.lo ?? lo, pUp = st.up ?? up, pc = b > 0 ? x.c[b - 1] : x.c[b];
  lo = lo > pLo || pc < pLo ? lo : pLo;
  up = up < pUp || pc > pUp ? up : pUp;
  let dir: number;
  if (st.st === undefined) dir = 1;
  else if (st.st === pUp) dir = x.c[b] > up ? -1 : 1;
  else dir = x.c[b] < lo ? 1 : -1;
  const stv = dir === -1 ? lo : up;
  st.lo = lo; st.up = up; st.st = stv;
  return [stv, dir];
});
def('ta.sar', ['start', 'inc', 'max'], (a, x, st) => {
  const b = x.bar, start = a[0], inc = a[1], max = a[2];
  if (b === 0) { return NaN_; }
  if (b === 1) {
    st.rising = x.c[1] > x.c[0];
    st.af = start;
    st.ep = st.rising ? x.h[1] : x.l[1];
    st.sar = st.rising ? x.l[0] : x.h[0];
    return st.sar;
  }
  let sar = st.sar + st.af * (st.ep - st.sar);
  if (st.rising) {
    sar = Math.min(sar, x.l[b - 1], b > 1 ? x.l[b - 2] : x.l[b - 1]);
    if (x.l[b] < sar) { st.rising = false; sar = st.ep; st.ep = x.l[b]; st.af = start; }
    else if (x.h[b] > st.ep) { st.ep = x.h[b]; st.af = Math.min(st.af + inc, max); }
  } else {
    sar = Math.max(sar, x.h[b - 1], b > 1 ? x.h[b - 2] : x.h[b - 1]);
    if (x.h[b] > sar) { st.rising = true; sar = st.ep; st.ep = x.h[b]; st.af = start; }
    else if (x.l[b] < st.ep) { st.ep = x.l[b]; st.af = Math.min(st.af + inc, max); }
  }
  st.sar = sar;
  return sar;
});

// ---- volume-based (variables or functions) ----
def('ta.vwap', ['source'], (a, x, st) => {
  const day = Math.floor(x.t[x.bar] / 86400000);
  if (st.day !== day) { st.day = day; st.pv = 0; st.vv = 0; }
  st.pv += a[0] * x.v[x.bar]; st.vv += x.v[x.bar];
  return st.vv ? st.pv / st.vv : a[0];
});
export const TA_VARS: Record<string, (x: Ctx, st: St) => number> = {
  'ta.tr': (x) => trueRange(x),
  'ta.obv': (x, st) => {
    const b = x.bar;
    st.s = (st.s ?? 0) + (b > 0 ? Math.sign(x.c[b] - x.c[b - 1]) * x.v[b] : 0);
    return st.s;
  },
  'ta.accdist': (x, st) => {
    const b = x.bar, hl = x.h[b] - x.l[b];
    st.s = (st.s ?? 0) + (hl === 0 ? 0 : ((x.c[b] - x.l[b] - (x.h[b] - x.c[b])) / hl) * x.v[b]);
    return st.s;
  },
  'ta.pvt': (x, st) => {
    const b = x.bar;
    st.s = (st.s ?? 0) + (b > 0 ? ((x.c[b] - x.c[b - 1]) / x.c[b - 1]) * x.v[b] : 0);
    return st.s;
  },
  'ta.nvi': (x, st) => {
    const b = x.bar;
    st.s ??= 1000;
    if (b > 0 && x.v[b] < x.v[b - 1]) st.s += ((x.c[b] - x.c[b - 1]) / x.c[b - 1]) * st.s;
    return st.s;
  },
  'ta.pvi': (x, st) => {
    const b = x.bar;
    st.s ??= 1000;
    if (b > 0 && x.v[b] > x.v[b - 1]) st.s += ((x.c[b] - x.c[b - 1]) / x.c[b - 1]) * st.s;
    return st.s;
  },
  'ta.wad': (x, st) => {
    const b = x.bar;
    st.s ??= 0;
    if (b > 0) {
      const trh = Math.max(x.h[b], x.c[b - 1]), trl = Math.min(x.l[b], x.c[b - 1]);
      const m = x.c[b] > x.c[b - 1] ? x.c[b] - trl : x.c[b] < x.c[b - 1] ? x.c[b] - trh : 0;
      st.s += m;
    }
    return st.s;
  },
  'ta.iii': (x) => { const b = x.bar, d = (x.h[b] - x.l[b]) * x.v[b]; return d === 0 ? 0 : (2 * x.c[b] - x.h[b] - x.l[b]) / d; },
  'ta.wvad': (x) => { const b = x.bar, d = x.h[b] - x.l[b]; return d === 0 ? 0 : ((x.c[b] - x.o[b]) / d) * x.v[b]; },
};

// ---- signals ----
def('ta.crossover', ['source1', 'source2'], (a, x, st) => {
  const r = a[0] > a[1] && st.p0 <= st.p1;
  st.p0 = a[0]; st.p1 = a[1];
  return r;
});
def('ta.crossunder', ['source1', 'source2'], (a, x, st) => {
  const r = a[0] < a[1] && st.p0 >= st.p1;
  st.p0 = a[0]; st.p1 = a[1];
  return r;
});
def('ta.cross', ['source1', 'source2'], (a, x, st) => {
  const r = (a[0] > a[1] && st.p0 <= st.p1) || (a[0] < a[1] && st.p0 >= st.p1);
  st.p0 = a[0]; st.p1 = a[1];
  return r;
});
def('ta.rising', ['source', 'length'], (a, x, st) => {
  const h = hist(st, 'a', a[0]);
  const len = a[1] | 0;
  if (h.length <= len) return false;
  for (let k = 0; k < len; k++) if (!(h[h.length - 1 - k] > h[h.length - 2 - k])) return false;
  return true;
});
def('ta.falling', ['source', 'length'], (a, x, st) => {
  const h = hist(st, 'a', a[0]);
  const len = a[1] | 0;
  if (h.length <= len) return false;
  for (let k = 0; k < len; k++) if (!(h[h.length - 1 - k] < h[h.length - 2 - k])) return false;
  return true;
});
def('ta.barssince', ['condition'], (a, x, st) => {
  if (a[0] === true || (typeof a[0] === 'number' && a[0] !== 0 && !Number.isNaN(a[0]))) st.c = 0;
  else if (st.c !== undefined) st.c++;
  return st.c ?? NaN_;
});
def('ta.valuewhen', ['condition', 'source', 'occurrence'], (a, x, st) => {
  const list: number[] = (st.l ??= []);
  if (a[0] === true || (typeof a[0] === 'number' && a[0] !== 0 && !Number.isNaN(a[0]))) list.push(a[1]);
  const occ = a[2] | 0;
  return list.length > occ ? list[list.length - 1 - occ] : NaN_;
});
def('ta.pivothigh', ['source', 'leftbars', 'rightbars'], (a, x, st) => pivot(a, x, st, true));
def('ta.pivotlow', ['source', 'leftbars', 'rightbars'], (a, x, st) => pivot(a, x, st, false));
function pivot(a: any[], x: Ctx, st: St, hi: boolean): number {
  let src = a[0], left = a[1], right = a[2];
  if (right === undefined) { right = left; left = src; src = hi ? x.h[x.bar] : x.l[x.bar]; }
  left |= 0; right |= 0;
  const h = hist(st, 'a', src);
  const i = h.length - 1 - right;
  if (i < left) return NaN_;
  const c = h[i];
  for (let k = 1; k <= left; k++) if (hi ? h[i - k] > c : h[i - k] < c) return NaN_;
  for (let k = 1; k <= right; k++) if (hi ? h[i + k] >= c : h[i + k] <= c) return NaN_;
  return c;
}
def('ta.fixnan', ['source'], (a, x, st) => { if (!isNa(a[0])) st.v = a[0]; return st.v ?? NaN_; });
