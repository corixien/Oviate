import type { Candles } from './data';
import { atr } from './indicators';

export type ChartType = 'candles' | 'hollow' | 'bars' | 'line' | 'area' | 'baseline' | 'heikin' | 'renko';
export const CHART_TYPES: ChartType[] = ['candles', 'hollow', 'bars', 'line', 'area', 'baseline', 'heikin', 'renko'];

function blank(n: number): Candles {
  return { n, t: new Float64Array(n), o: new Float64Array(n), h: new Float64Array(n), l: new Float64Array(n), c: new Float64Array(n), v: new Float64Array(n) };
}

export function heikinAshi(c: Candles): Candles {
  const o = blank(c.n);
  for (let i = 0; i < c.n; i++) {
    const hc = (c.o[i] + c.h[i] + c.l[i] + c.c[i]) / 4;
    const ho = i === 0 ? (c.o[0] + c.c[0]) / 2 : (o.o[i - 1] + o.c[i - 1]) / 2;
    o.t[i] = c.t[i]; o.c[i] = hc; o.o[i] = ho;
    o.h[i] = Math.max(c.h[i], ho, hc);
    o.l[i] = Math.min(c.l[i], ho, hc);
    o.v[i] = c.v[i];
  }
  return o;
}

/** Renko bricks sized by ATR(14) of the last bar (min 0.01% of price). One brick per output bar. */
export function renko(c: Candles): Candles {
  if (c.n < 2) return c;
  const a = atr(c, 14);
  let size = a[c.n - 1];
  if (!(size > 0)) size = c.c[c.n - 1] * 0.005;
  size = Math.max(size, c.c[c.n - 1] * 0.0001);
  const t: number[] = [], op: number[] = [], cl: number[] = [], vol: number[] = [];
  let base = Math.round(c.c[0] / size) * size;
  let acc = 0;
  for (let i = 0; i < c.n; i++) {
    acc += c.v[i];
    for (;;) {
      if (c.c[i] >= base + size) { t.push(c.t[i]); op.push(base); cl.push(base + size); vol.push(acc); acc = 0; base += size; }
      else if (c.c[i] <= base - size) { t.push(c.t[i]); op.push(base); cl.push(base - size); vol.push(acc); acc = 0; base -= size; }
      else break;
    }
  }
  const o = blank(t.length);
  for (let i = 0; i < t.length; i++) {
    o.t[i] = t[i]; o.o[i] = op[i]; o.c[i] = cl[i];
    o.h[i] = Math.max(op[i], cl[i]); o.l[i] = Math.min(op[i], cl[i]); o.v[i] = vol[i];
  }
  return o;
}

export function transform(c: Candles, type: ChartType): Candles {
  if (type === 'heikin') return heikinAshi(c);
  if (type === 'renko') return renko(c);
  return c;
}
