// Pine code -> builder model conversions done by the AI are stored (by a hash of the code), so the same code is never converted twice.
// A background job converts strategies whose code changed, so opening the visual builder is instant.
import { kvGet, kvSet, aiComplete } from '../api';
import { library } from '../library.svelte';
import { aiBuilderFromCode } from './ai.ts';
import { builderModelOf, type Model } from './model.ts';
import { allInfos, indInfo } from './info';

const KEY = 'builder_cache';
const LIMIT = 300;
export const CHECK_EVERY_MS = 30 * 60 * 1000;

/** FNV-1a over the trimmed code. */
export function codeHash(code: string): string {
  let h = 0x811c9dc5;
  const t = code.trim();
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36) + ':' + t.length;
}

let mem: Record<string, Model> | null = null;
async function table(): Promise<Record<string, Model>> {
  if (mem) return mem;
  try { mem = JSON.parse((await kvGet(KEY)) ?? '{}'); } catch { mem = {}; }
  return mem!;
}

export async function cachedModel(code: string): Promise<Model | undefined> {
  const m = (await table())[codeHash(code)];
  return m ? structuredClone(m) : undefined;
}

async function remember(code: string, model: Model) {
  const t = await table();
  const h = codeHash(code);
  delete t[h]; t[h] = structuredClone(model); // insertion order = age
  const keys = Object.keys(t);
  for (const k of keys.slice(0, Math.max(0, keys.length - LIMIT))) delete t[k];
  await kvSet(KEY, JSON.stringify(t));
}

const inflight = new Map<string, Promise<Model>>();

/** The builder model of foreign Pine code: from the store when the code is unchanged, else converted by the AI (and stored). */
export function convertCode(code: string): Promise<Model> {
  const h = codeHash(code);
  const run = inflight.get(h) ?? (async () => {
    const hit = await cachedModel(code);
    if (hit) return hit;
    const model = await aiBuilderFromCode(code, allInfos(), aiComplete);
    await remember(code, model);
    return model;
  })().finally(() => inflight.delete(h));
  inflight.set(h, run);
  return run;
}

/** One pass: convert every strategy that has no builder model yet (not made by the builder, not stored for this exact code). Stops at the first failure. */
export async function convertChanged(): Promise<number> {
  if (!library.loaded) return 0;
  let done = 0;
  for (const f of [...library.strategies]) {
    if (!f.code.trim() || /strategy\.entry|strategy\.order/.test(f.code) === false) continue;
    if (builderModelOf(f.code, indInfo)) continue;
    if (await cachedModel(f.code)) continue;
    try { await convertCode(f.code); done++; } catch { break; }
  }
  return done;
}

let started = false;
/** First pass shortly after start, then every 30 minutes. */
export function startBuilderBackground() {
  if (started) return;
  started = true;
  setTimeout(() => { void convertChanged(); setInterval(() => void convertChanged(), CHECK_EVERY_MS); }, 30_000);
}
