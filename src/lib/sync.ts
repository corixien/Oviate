// Script sync planning (pure, tested): which side wins for every script, deletions included.

export interface LocalScript { name: string; code: string; /** unix seconds */ modified: number; public: boolean }
export interface RemoteScript { name: string; code: string; public: boolean; /** unix milliseconds */ updatedAt: number }
/** What both sides looked like after the last successful sync of this script. */
export interface Seen { hash: string; public: boolean }
export type ScriptAction =
  | { op: 'pull'; name: string; code: string; public: boolean }
  | { op: 'push'; name: string; code: string; public: boolean }
  | { op: 'delLocal'; name: string }
  | { op: 'delRemote'; name: string }
  | { op: 'mark'; name: string; hash: string; public: boolean };

/** Change detection only (not security): a fast string hash. */
export function hashCode(s: string): string {
  let h1 = 5381, h2 = 52711;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = (h1 * 33) ^ c; h2 = (h2 * 33) ^ c; }
  return `${s.length}.${(h1 >>> 0).toString(36)}.${(h2 >>> 0).toString(36)}`;
}

/**
 * Three-way plan per script name: unchanged-on-one-side takes the other side, a script that disappeared on one side is deleted on the other
 * unless it was edited there since, and when both sides changed the newer edit wins.
 */
export function planScripts(local: LocalScript[], remote: RemoteScript[], seen: Record<string, Seen>): ScriptAction[] {
  const L = new Map(local.map((s) => [s.name, s])), R = new Map(remote.map((s) => [s.name, s]));
  const out: ScriptAction[] = [];
  for (const name of new Set([...L.keys(), ...R.keys()])) {
    const l = L.get(name), r = R.get(name), s = seen[name];
    const lh = l ? hashCode(l.code) : '', rh = r ? hashCode(r.code) : '';
    const changedL = !!l && (!s || lh !== s.hash || l.public !== s.public);
    const changedR = !!r && (!s || rh !== s.hash || r.public !== s.public);
    if (l && r) {
      if (lh === rh && l.public === r.public) { if (!s || s.hash !== lh || s.public !== l.public) out.push({ op: 'mark', name, hash: lh, public: l.public }); }
      else if (!changedL && changedR) out.push({ op: 'pull', name, code: r.code, public: r.public });
      else if (changedL && !changedR) out.push({ op: 'push', name, code: l.code, public: l.public });
      else out.push(l.modified * 1000 >= r.updatedAt ? { op: 'push', name, code: l.code, public: l.public } : { op: 'pull', name, code: r.code, public: r.public });
    } else if (l) out.push(s && !changedL ? { op: 'delLocal', name } : { op: 'push', name, code: l.code, public: l.public });
    else if (r) out.push(s && !changedR ? { op: 'delRemote', name } : { op: 'pull', name, code: r!.code, public: r!.public });
  }
  return out;
}

/** Pick a name that is free in the library (community scripts are imported next to your own). */
export function freeName(name: string, taken: string[], author?: string): string {
  if (!taken.includes(name)) return name;
  const base = author ? `${name} (${author})` : name;
  if (!taken.includes(base)) return base;
  for (let i = 2; ; i++) if (!taken.includes(`${base} ${i}`)) return `${base} ${i}`;
}

/** Which side holds the newer settings? Timestamps are unix milliseconds. */
export const stateDirection = (localAt: number, remoteAt: number | null): 'push' | 'pull' | 'none' =>
  remoteAt === null ? 'push' : remoteAt > localAt ? 'pull' : localAt > remoteAt ? 'push' : 'none';

export interface SecretPlan { push: string[]; delRemote: string[]; setLocal: string[]; delLocal: string[]; seen: Record<string, string> }

/**
 * Three-way plan for the API keys (name -> value): a key that exists on one side only is copied, a key removed on one side is removed on the other
 * unless it was changed there, and when both sides changed the value of this device wins.
 * `seen` holds the hash of every key at the last sync.
 */
export function planSecrets(local: Record<string, string>, remote: Record<string, string>, seen: Record<string, string>): SecretPlan {
  const plan: SecretPlan = { push: [], delRemote: [], setLocal: [], delLocal: [], seen: {} };
  for (const name of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    const l = local[name], r = remote[name], s = seen[name];
    if (l !== undefined && r !== undefined) {
      if (l === r) plan.seen[name] = hashCode(l);
      else if (s === hashCode(l)) { plan.setLocal.push(name); plan.seen[name] = hashCode(r); } // changed on the other device
      else { plan.push.push(name); plan.seen[name] = hashCode(l); }
    } else if (l !== undefined) {
      if (s !== undefined && s === hashCode(l)) plan.delLocal.push(name); // removed on the other device
      else { plan.push.push(name); plan.seen[name] = hashCode(l); }
    } else if (r !== undefined) {
      if (s !== undefined && s === hashCode(r)) plan.delRemote.push(name); // removed here
      else { plan.setLocal.push(name); plan.seen[name] = hashCode(r); }
    }
  }
  return plan;
}

export interface DrawingLike { id: string; sym?: string }

/** All drawings of a saved state. Older saves kept them per chart slot, newer ones in one list for every symbol: drawings belong to a symbol, not to a chart slot. */
export function collectDrawings<T extends DrawingLike>(s: { drawings?: T[]; charts?: { drawings?: T[] }[] }): T[] {
  const out: T[] = [], seen = new Set<string>();
  const add = (d: T) => { if (d && typeof d.id === 'string' && !seen.has(d.id)) { seen.add(d.id); out.push(d); } };
  if (Array.isArray(s.drawings)) s.drawings.forEach(add);
  else for (const c of s.charts ?? []) (c.drawings ?? []).forEach(add);
  return out;
}

/**
 * First sync of a device that has its own data: what the account has wins, but drawings and watchlists that only exist here are added (nothing made before
 * signing in is lost). Later syncs follow the newer side, so deletions travel.
 */
export function mergeFirstSync<D extends DrawingLike, W extends { id: string; symbols: string[] }>(local: { drawings: D[]; watchlists: W[] }, remote: { drawings: D[]; watchlists: W[] }) {
  const have = new Set(remote.drawings.map((d) => d.id));
  const drawings = [...remote.drawings, ...local.drawings.filter((d) => !have.has(d.id))];
  const lists = remote.watchlists.map((w) => {
    const mine = local.watchlists.find((x) => x.id === w.id);
    return mine ? { ...w, symbols: [...w.symbols, ...mine.symbols.filter((y) => !w.symbols.includes(y))] } : w;
  });
  const known = new Set(remote.watchlists.map((w) => w.id));
  return { drawings, watchlists: [...lists, ...local.watchlists.filter((w) => !known.has(w.id))] };
}

/** Union by id: what the account has, plus what only exists here. */
export function mergeById<T extends { id: string }>(remote: T[], local: T[]): T[] {
  const have = new Set(remote.map((x) => x.id));
  return [...remote, ...local.filter((x) => !have.has(x.id))];
}

/** Union of two content-addressed tables (insertion order = age); the oldest entries beyond `limit` are dropped. */
export function unionCapped<T>(remote: Record<string, T>, local: Record<string, T>, limit: number): Record<string, T> {
  const out: Record<string, T> = { ...remote };
  for (const [k, v] of Object.entries(local)) if (!(k in out)) out[k] = v;
  const keys = Object.keys(out);
  for (const k of keys.slice(0, Math.max(0, keys.length - limit))) delete out[k];
  return out;
}

export interface NewsLike { id: string; ts: number; url: string; headline: string }
/** News another device collected: only well-formed items with a web link are taken over (the shared cache is writable by every account). */
export const validNews = (x: unknown): x is NewsLike =>
  !!x && typeof (x as NewsLike).id === 'string' && typeof (x as NewsLike).ts === 'number' && typeof (x as NewsLike).headline === 'string' && (!(x as NewsLike).url || /^https?:\/\//.test((x as NewsLike).url));

/** Local and shared news of one symbol, newest first, no duplicates, nothing older than `since`, at most `cap` items. */
export function mergeNews<T extends NewsLike>(local: T[], shared: unknown, since: number, cap: number): T[] {
  const seen = new Set<string>(), out: T[] = [];
  for (const it of [...local, ...(Array.isArray(shared) ? (shared.filter(validNews) as T[]) : [])]) if (it.ts >= since && !seen.has(it.id)) { seen.add(it.id); out.push(it); }
  return out.sort((a, b) => b.ts - a.ts).slice(0, cap);
}
