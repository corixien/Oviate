export interface Candles {
  t: Float64Array;
  o: Float32Array;
  h: Float32Array;
  l: Float32Array;
  c: Float32Array;
  n: number;
}

/** Deterministic synthetic random-walk candles for rendering benchmarks. */
export function synthCandles(n: number, seed = 1): Candles {
  let s = seed >>> 0 || 1;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const t = new Float64Array(n), o = new Float32Array(n), h = new Float32Array(n);
  const l = new Float32Array(n), c = new Float32Array(n);
  let price = 100;
  const t0 = Date.UTC(2020, 0, 1) / 1000;
  for (let i = 0; i < n; i++) {
    const open = price;
    const close = open * (1 + (rnd() - 0.5) * 0.02);
    t[i] = t0 + i * 60;
    o[i] = open;
    c[i] = close;
    h[i] = Math.max(open, close) * (1 + rnd() * 0.005);
    l[i] = Math.min(open, close) * (1 - rnd() * 0.005);
    price = close;
  }
  return { t, o, h, l, c, n };
}
