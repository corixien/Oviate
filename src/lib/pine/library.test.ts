import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { runPine } from './index.ts';

function candles(n = 400, seed = 11) {
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const t = new Float64Array(n), o = new Float64Array(n), h = new Float64Array(n), l = new Float64Array(n), c = new Float64Array(n), v = new Float64Array(n);
  let p = 100;
  for (let i = 0; i < n; i++) {
    o[i] = p * (1 + (rnd() - 0.5) * 0.02); c[i] = o[i] * (1 + (rnd() - 0.5) * 0.04);
    h[i] = Math.max(o[i], c[i]) * (1 + rnd() * 0.01); l[i] = Math.min(o[i], c[i]) * (1 - rnd() * 0.01);
    v[i] = 1000 + rnd() * 5000; t[i] = 1700000000 + i * 86400; p = c[i];
  }
  return { n, t, o, h, l, c, v };
}

const dir = new URL('../../../indicators/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.pine'));

test('indicator library is complete', () => { assert.ok(files.length >= 80, `${files.length} files`); });

for (const f of files) {
  test(`indicator ${f} runs and produces output`, () => {
    const code = readFileSync(new URL(f, dir), 'utf8');
    const r = runPine(code, candles());
    assert.equal(r.error, undefined, r.error?.message + ' @line ' + r.error?.line);
    assert.equal(r.meta.kind, 'indicator');
    const finite = r.plots.some((p) => p.values.some((v) => Number.isFinite(v))) || r.shapes.some((s) => s.flags.some((x) => x === 1));
    assert.ok(finite, 'no finite plot values and no shapes');
    assert.ok(r.warnings.length === 0, r.warnings.join('; '));
  });
}
