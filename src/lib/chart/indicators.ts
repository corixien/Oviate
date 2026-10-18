import type { Candles } from './data';

export interface Line {
  name: string;
  v: Float64Array;
  color: string;
  kind?: 'line' | 'hist' | 'band';
  /** for kind 'band': second boundary series, filled between v and v2 */
  v2?: Float64Array;
}

export interface IndicatorDef {
  id: string;
  label: string;
  pane: 'price' | 'sub';
  params: Record<string, number>;
  /** sub-pane reference levels (e.g. RSI 30/70) */
  levels?: number[];
  compute: (c: Candles, p: Record<string, number>) => Line[];
}

const NaNs = (n: number) => new Float64Array(n).fill(NaN);

export function sma(src: Float64Array, len: number): Float64Array {
  const out = NaNs(src.length);
  let sum = 0, cnt = 0;
  for (let i = 0; i < src.length; i++) {
    const x = src[i];
    if (!Number.isNaN(x)) { sum += x; cnt++; }
    if (i >= len && !Number.isNaN(src[i - len])) { sum -= src[i - len]; cnt--; }
    if (cnt === len) out[i] = sum / len;
  }
  return out;
}

export function ema(src: Float64Array, len: number): Float64Array {
  const out = NaNs(src.length);
  const k = 2 / (len + 1);
  let prev = NaN, seed = 0, cnt = 0;
  for (let i = 0; i < src.length; i++) {
    const x = src[i];
    if (Number.isNaN(x)) continue;
    if (Number.isNaN(prev)) {
      seed += x; cnt++;
      if (cnt === len) { prev = seed / len; out[i] = prev; }
    } else { prev = x * k + prev * (1 - k); out[i] = prev; }
  }
  return out;
}

function rma(src: Float64Array, len: number): Float64Array {
  const out = NaNs(src.length);
  let prev = NaN, seed = 0, cnt = 0;
  for (let i = 0; i < src.length; i++) {
    const x = src[i];
    if (Number.isNaN(x)) continue;
    if (Number.isNaN(prev)) {
      seed += x; cnt++;
      if (cnt === len) { prev = seed / len; out[i] = prev; }
    } else { prev = (prev * (len - 1) + x) / len; out[i] = prev; }
  }
  return out;
}

function wma(src: Float64Array, len: number): Float64Array {
  const out = NaNs(src.length);
  const den = (len * (len + 1)) / 2;
  for (let i = len - 1; i < src.length; i++) {
    let s = 0;
    for (let j = 0; j < len; j++) s += src[i - j] * (len - j);
    out[i] = s / den;
  }
  return out;
}

function stdev(src: Float64Array, len: number): Float64Array {
  const out = NaNs(src.length);
  for (let i = len - 1; i < src.length; i++) {
    let m = 0;
    for (let j = 0; j < len; j++) m += src[i - j];
    m /= len;
    let s = 0;
    for (let j = 0; j < len; j++) s += (src[i - j] - m) ** 2;
    out[i] = Math.sqrt(s / len);
  }
  return out;
}

export function trueRange(c: Candles): Float64Array {
  const out = new Float64Array(c.n);
  for (let i = 0; i < c.n; i++) {
    out[i] = i === 0 ? c.h[i] - c.l[i]
      : Math.max(c.h[i] - c.l[i], Math.abs(c.h[i] - c.c[i - 1]), Math.abs(c.l[i] - c.c[i - 1]));
  }
  return out;
}

export function atr(c: Candles, len: number): Float64Array {
  return rma(trueRange(c), len);
}

export function rsi(src: Float64Array, len: number): Float64Array {
  const up = new Float64Array(src.length), dn = new Float64Array(src.length);
  for (let i = 1; i < src.length; i++) {
    const d = src[i] - src[i - 1];
    up[i] = Math.max(d, 0);
    dn[i] = Math.max(-d, 0);
  }
  const u = rma(up.subarray(1), len), d = rma(dn.subarray(1), len);
  const out = NaNs(src.length);
  for (let i = 0; i < u.length; i++) {
    if (Number.isNaN(u[i])) continue;
    out[i + 1] = d[i] === 0 ? 100 : 100 - 100 / (1 + u[i] / d[i]);
  }
  return out;
}

function highest(src: Float64Array, len: number): Float64Array {
  const out = NaNs(src.length);
  for (let i = len - 1; i < src.length; i++) {
    let m = -Infinity;
    for (let j = 0; j < len; j++) m = Math.max(m, src[i - j]);
    out[i] = m;
  }
  return out;
}
function lowest(src: Float64Array, len: number): Float64Array {
  const out = NaNs(src.length);
  for (let i = len - 1; i < src.length; i++) {
    let m = Infinity;
    for (let j = 0; j < len; j++) m = Math.min(m, src[i - j]);
    out[i] = m;
  }
  return out;
}

const PURPLE = '#a855f7', CYAN = '#22d3ee', AMBER = '#fbbf24', PINK = '#f472b6', BLUE = '#60a5fa', WHITE = '#e5e7eb';

export const INDICATORS: IndicatorDef[] = [
  { id: 'sma', label: 'Moving Average (SMA)', pane: 'price', params: { length: 20 },
    compute: (c, p) => [{ name: `SMA ${p.length}`, v: sma(c.c, p.length), color: AMBER }] },
  { id: 'ema', label: 'Moving Average Exponential (EMA)', pane: 'price', params: { length: 21 },
    compute: (c, p) => [{ name: `EMA ${p.length}`, v: ema(c.c, p.length), color: CYAN }] },
  { id: 'wma', label: 'Weighted Moving Average (WMA)', pane: 'price', params: { length: 20 },
    compute: (c, p) => [{ name: `WMA ${p.length}`, v: wma(c.c, p.length), color: PINK }] },
  { id: 'bb', label: 'Bollinger Bands', pane: 'price', params: { length: 20, mult: 2 },
    compute: (c, p) => {
      const m = sma(c.c, p.length), s = stdev(c.c, p.length);
      const up = m.map((x, i) => x + p.mult * s[i]), lo = m.map((x, i) => x - p.mult * s[i]);
      return [
        { name: 'BB basis', v: m, color: AMBER },
        { name: 'BB upper', v: up, v2: lo, color: PURPLE, kind: 'band' },
        { name: 'BB lower', v: lo, color: PURPLE }
      ];
    } },
  { id: 'vwap', label: 'VWAP', pane: 'price', params: {},
    compute: (c) => {
      const out = NaNs(c.n);
      let pv = 0, vv = 0, day = -1;
      for (let i = 0; i < c.n; i++) {
        const d = Math.floor(c.t[i] / 86400);
        if (d !== day) { day = d; pv = 0; vv = 0; }
        const tp = (c.h[i] + c.l[i] + c.c[i]) / 3;
        pv += tp * c.v[i]; vv += c.v[i];
        out[i] = vv ? pv / vv : tp;
      }
      return [{ name: 'VWAP', v: out, color: BLUE }];
    } },
  { id: 'supertrend', label: 'Supertrend', pane: 'price', params: { length: 10, mult: 3 },
    compute: (c, p) => {
      const a = atr(c, p.length), out = NaNs(c.n);
      let fu = NaN, fl = NaN, dir = 1;
      for (let i = 0; i < c.n; i++) {
        if (Number.isNaN(a[i])) continue;
        const hl2 = (c.h[i] + c.l[i]) / 2;
        const bu = hl2 + p.mult * a[i], bl = hl2 - p.mult * a[i];
        fu = Number.isNaN(fu) || bu < fu || c.c[i - 1] > fu ? bu : fu;
        fl = Number.isNaN(fl) || bl > fl || c.c[i - 1] < fl ? bl : fl;
        if (dir === 1 && c.c[i] < fl) dir = -1;
        else if (dir === -1 && c.c[i] > fu) dir = 1;
        out[i] = dir === 1 ? fl : fu;
      }
      return [{ name: 'Supertrend', v: out, color: PURPLE }];
    } },
  { id: 'rsi', label: 'Relative Strength Index (RSI)', pane: 'sub', params: { length: 14 }, levels: [30, 70],
    compute: (c, p) => [{ name: `RSI ${p.length}`, v: rsi(c.c, p.length), color: PURPLE }] },
  { id: 'macd', label: 'MACD', pane: 'sub', params: { fast: 12, slow: 26, signal: 9 }, levels: [0],
    compute: (c, p) => {
      const m = ema(c.c, p.fast).map((x, i) => x - ema(c.c, p.slow)[i]);
      const macd = new Float64Array(m);
      const sig = ema(macd, p.signal);
      const hist = macd.map((x, i) => x - sig[i]);
      return [
        { name: 'Hist', v: hist, color: CYAN, kind: 'hist' },
        { name: 'MACD', v: macd, color: BLUE },
        { name: 'Signal', v: sig, color: AMBER }
      ];
    } },
  { id: 'stoch', label: 'Stochastic', pane: 'sub', params: { k: 14, d: 3 }, levels: [20, 80],
    compute: (c, p) => {
      const hh = highest(c.h, p.k), ll = lowest(c.l, p.k);
      const k = c.c.map((x, i) => ((x - ll[i]) / (hh[i] - ll[i])) * 100);
      return [{ name: '%K', v: k, color: BLUE }, { name: '%D', v: sma(k, p.d), color: AMBER }];
    } },
  { id: 'atr', label: 'Average True Range (ATR)', pane: 'sub', params: { length: 14 },
    compute: (c, p) => [{ name: `ATR ${p.length}`, v: atr(c, p.length), color: PINK }] },
  { id: 'obv', label: 'On Balance Volume', pane: 'sub', params: {},
    compute: (c) => {
      const out = new Float64Array(c.n);
      for (let i = 1; i < c.n; i++) out[i] = out[i - 1] + (c.c[i] > c.c[i - 1] ? c.v[i] : c.c[i] < c.c[i - 1] ? -c.v[i] : 0);
      return [{ name: 'OBV', v: out, color: WHITE }];
    } }
];

export const indicatorById = (id: string) => INDICATORS.find((d) => d.id === id);

const CODE: Record<string, string> = {
  sma: `//@version=6
indicator("Moving Average", overlay = true)
length = input.int({length}, "Length")
plot(ta.sma(close, length), "SMA", color.orange)`,
  ema: `//@version=6
indicator("Moving Average Exponential", overlay = true)
length = input.int({length}, "Length")
plot(ta.ema(close, length), "EMA", color.aqua)`,
  wma: `//@version=6
indicator("Weighted Moving Average", overlay = true)
length = input.int({length}, "Length")
plot(ta.wma(close, length), "WMA", color.fuchsia)`,
  bb: `//@version=6
indicator("Bollinger Bands", overlay = true)
length = input.int({length}, "Length")
mult = input.float({mult}, "StdDev")
basis = ta.sma(close, length)
dev = mult * ta.stdev(close, length)
upper = basis + dev
lower = basis - dev
plot(basis, "Basis", color.orange)
p1 = plot(upper, "Upper", color.purple)
p2 = plot(lower, "Lower", color.purple)
fill(p1, p2, color.new(color.purple, 90))`,
  vwap: `//@version=6
indicator("VWAP", overlay = true)
plot(ta.vwap(hlc3), "VWAP", color.blue)`,
  supertrend: `//@version=6
indicator("Supertrend", overlay = true)
length = input.int({length}, "ATR Length")
mult = input.float({mult}, "Factor")
[st, dir] = ta.supertrend(mult, length)
plot(st, "Supertrend", color.purple)`,
  rsi: `//@version=6
indicator("Relative Strength Index")
length = input.int({length}, "Length")
r = ta.rsi(close, length)
plot(r, "RSI", color.purple)
hline(70)
hline(30)`,
  macd: `//@version=6
indicator("MACD")
fast = input.int({fast}, "Fast")
slow = input.int({slow}, "Slow")
sig = input.int({signal}, "Signal")
macd = ta.ema(close, fast) - ta.ema(close, slow)
signal = ta.ema(macd, sig)
plot(macd - signal, "Histogram", style = plot.style_histogram)
plot(macd, "MACD", color.blue)
plot(signal, "Signal", color.orange)`,
  stoch: `//@version=6
indicator("Stochastic")
k = input.int({k}, "%K")
d = input.int({d}, "%D")
kk = ta.stoch(close, high, low, k)
plot(kk, "%K", color.blue)
plot(ta.sma(kk, d), "%D", color.orange)`,
  atr: `//@version=6
indicator("Average True Range")
length = input.int({length}, "Length")
plot(ta.atr(length), "ATR", color.fuchsia)`,
  obv: `//@version=6
indicator("On Balance Volume")
plot(ta.obv, "OBV", color.white)`
};

export function indicatorCode(id: string, params: Record<string, number>): string {
  return (CODE[id] ?? '').replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? ''));
}
