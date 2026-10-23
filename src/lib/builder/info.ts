// IndInfo of the library indicators (plots, inputs, overlay), read by running each script once. Cached per script text.
import { library } from '../library.svelte';
import { describeScript } from '../pine/describe.ts';
import type { IndInfo } from './model.ts';

const cache = new Map<string, { code: string; info: IndInfo | undefined }>();

export function indInfo(name: string): IndInfo | undefined {
  const f = library.get('indicators', name);
  if (!f) return undefined;
  const hit = cache.get(name);
  if (hit && hit.code === f.code) return hit.info;
  const d = describeScript(f.code);
  const info: IndInfo | undefined = d.error ? undefined : { title: f.title, short: f.shortTitle, overlay: d.meta.overlay, plots: d.plots.map((p) => p.title), inputs: d.inputs };
  cache.set(name, { code: f.code, info });
  return info;
}

/** Every usable library indicator with its info (for the AI catalog). */
export function allInfos(): { name: string; info: IndInfo }[] {
  return library.indicators.flatMap((f) => { const info = indInfo(f.name); return info && info.plots.length ? [{ name: f.name, info }] : []; });
}
