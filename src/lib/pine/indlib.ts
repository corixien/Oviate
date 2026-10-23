// Library indicators usable from a strategy: oviate.ind("Name", "Plot", "Input=value;Input2=value") returns that plot's value on the current bar.
// The indicator runs once per distinct input set over the same candles (see interp.ts). The registry below is how a run finds the source of an indicator.

let source: (name: string) => string | undefined = () => undefined;

/** Where indicator code comes from on this thread (the UI sets it to the script library, the CLI to the files on disk). */
export function setIndicatorSource(f: (name: string) => string | undefined) { source = f; }

export function indicatorCode(name: string, lib?: Record<string, string>): string | undefined { return lib?.[name] ?? source(name); }

/** Names of the indicators a strategy reads through oviate.ind. */
export function referencedIndicators(code: string): string[] {
  const out = new Set<string>();
  for (const m of code.matchAll(/oviate\.ind\(\s*"([^"]+)"/g)) out.add(m[1]);
  return [...out];
}

/** Source of every indicator the strategy needs, to hand to a worker that has no library of its own. */
export function neededLib(code: string): Record<string, string> | undefined {
  const names = referencedIndicators(code);
  if (!names.length) return undefined;
  const lib: Record<string, string> = {};
  for (const n of names) { const c = source(n); if (c) lib[n] = c; }
  return lib;
}

/** "Length=14;Factor=3" -> { Length: 14, Factor: 3 } (numbers and booleans are converted, the rest stays text). */
export function parseParams(s: string): Record<string, any> {
  const out: Record<string, any> = {};
  for (const part of s.split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const k = part.slice(0, i).trim(), v = part.slice(i + 1).trim();
    out[k] = v === 'true' ? true : v === 'false' ? false : v !== '' && Number.isFinite(Number(v)) ? Number(v) : v;
  }
  return out;
}
