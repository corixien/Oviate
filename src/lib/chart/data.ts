export interface Candles {
  t: Float64Array;
  o: Float64Array;
  h: Float64Array;
  l: Float64Array;
  c: Float64Array;
  v: Float64Array;
  n: number;
}

export const emptyCandles = (): Candles => ({
  t: new Float64Array(0), o: new Float64Array(0), h: new Float64Array(0),
  l: new Float64Array(0), c: new Float64Array(0), v: new Float64Array(0), n: 0
});

/** Merge two time-sorted candle sets; `b` wins on equal timestamps. */
export function mergeCandles(a: Candles, b: Candles): Candles {
  if (!a.n) return b;
  if (!b.n) return a;
  const n = a.n + b.n;
  const out = {
    t: new Float64Array(n), o: new Float64Array(n), h: new Float64Array(n),
    l: new Float64Array(n), c: new Float64Array(n), v: new Float64Array(n), n: 0
  };
  let i = 0, j = 0, k = 0;
  const take = (s: Candles, x: number) => {
    out.t[k] = s.t[x]; out.o[k] = s.o[x]; out.h[k] = s.h[x];
    out.l[k] = s.l[x]; out.c[k] = s.c[x]; out.v[k] = s.v[x]; k++;
  };
  while (i < a.n || j < b.n) {
    if (j >= b.n || (i < a.n && a.t[i] < b.t[j])) take(a, i++);
    else if (i >= a.n || b.t[j] < a.t[i]) take(b, j++);
    else { take(b, j++); i++; }
  }
  out.n = k;
  return {
    n: k, t: out.t.subarray(0, k), o: out.o.subarray(0, k), h: out.h.subarray(0, k),
    l: out.l.subarray(0, k), c: out.c.subarray(0, k), v: out.v.subarray(0, k)
  };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Deterministic synthetic candles for browser/dev mode (no Tauri backend). */
export function synthColumns(symbol: string, step: number, from: number, to: number): Candles {
  const a = Math.ceil(from / step), b = Math.floor(to / step);
  const n = Math.max(0, b - a + 1);
  const c = { ...emptyCandles(), n } as Candles;
  c.t = new Float64Array(n); c.o = new Float64Array(n); c.h = new Float64Array(n);
  c.l = new Float64Array(n); c.c = new Float64Array(n); c.v = new Float64Array(n);
  const seed = hash(symbol);
  // Price at bar index k: smooth pseudo-random walk, independent of the requested range.
  const px = (k: number) => 100 * Math.exp(0.35 * Math.sin(k / 4000 + seed % 7) + 0.12 * Math.sin(k / 330 + seed % 13) + 0.02 * Math.sin(k / 17));
  for (let i = 0; i < n; i++) {
    const k = a + i;
    const o = px(k), cl = px(k + 1);
    const r = (((Math.imul(k, 2654435761) ^ seed) >>> 0) % 1000) / 1000;
    c.t[i] = k * step;
    c.o[i] = o; c.c[i] = cl;
    c.h[i] = Math.max(o, cl) * (1 + r * 0.004);
    c.l[i] = Math.min(o, cl) * (1 - (1 - r) * 0.004);
    c.v[i] = 1000 + r * 9000;
  }
  return c;
}
