// Shared candles: Yahoo / Alpaca providers (ported from the desktop core) and a Postgres store that is filled once for all users and only asked for what is missing.
import type { Db } from './db.ts';

export type Tf = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d' | '1w' | '1M';
export const TF_SEC: Record<Tf, number> = { '1m': 60, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400, '1d': 86400, '1w': 604800, '1M': 2592000 };
export const isTf = (s: unknown): s is Tf => typeof s === 'string' && s in TF_SEC;

export interface Cols { t: number[]; o: number[]; h: number[]; l: number[]; c: number[]; v: number[] }
export const emptyCols = (): Cols => ({ t: [], o: [], h: [], l: [], c: [], v: [] });
const push = (c: Cols, t: number, o: number, h: number, l: number, cl: number, v: number) => { c.t.push(t); c.o.push(o); c.h.push(h); c.l.push(l); c.c.push(cl); c.v.push(v); };

const YAHOO_IV: Record<Tf, string> = { '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m', '1h': '60m', '4h': '60m', '1d': '1d', '1w': '1wk', '1M': '1mo' };
const ALPACA_TF: Record<Tf, string> = { '1m': '1Min', '5m': '5Min', '15m': '15Min', '30m': '30Min', '1h': '1Hour', '4h': '4Hour', '1d': '1Day', '1w': '1Week', '1M': '1Month' };
const UA = 'Mozilla/5.0 (X11; Linux x86_64) Oviate/0.1';
const DAY = 86400;
/** Yahoo limits intraday history */
const YAHOO_BACK: Partial<Record<Tf, number>> = { '1m': 7 * DAY, '5m': 59 * DAY, '15m': 59 * DAY, '30m': 59 * DAY, '1h': 729 * DAY, '4h': 729 * DAY };

export function parseYahoo(v: any): Cols {
  const res = v?.chart?.result?.[0];
  if (!res) throw new Error(`yahoo: ${v?.chart?.error?.description ?? 'no data'}`);
  const q = res.indicators?.quote?.[0] ?? {};
  const out = emptyCols();
  (res.timestamp ?? []).forEach((t: number, i: number) => {
    const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i];
    if (typeof t === 'number' && [o, h, l, c].every((x) => typeof x === 'number')) push(out, t, o, h, l, c, typeof q.volume?.[i] === 'number' ? q.volume[i] : 0);
  });
  return out;
}

export function aggregate(src: Cols, bucket: number): Cols {
  const out = emptyCols();
  let cur = -Infinity;
  for (let i = 0; i < src.t.length; i++) {
    const b = Math.floor(src.t[i] / bucket) * bucket;
    if (b !== cur) { push(out, b, src.o[i], src.h[i], src.l[i], src.c[i], src.v[i]); cur = b; }
    else { const k = out.t.length - 1; out.h[k] = Math.max(out.h[k], src.h[i]); out.l[k] = Math.min(out.l[k], src.l[i]); out.c[k] = src.c[i]; out.v[k] += src.v[i]; }
  }
  return out;
}

export type Fetch = typeof fetch;

export async function yahooCandles(symbol: string, tf: Tf, from: number, to: number, f: Fetch = fetch, now = Math.floor(Date.now() / 1000)): Promise<Cols> {
  const back = YAHOO_BACK[tf];
  if (back) from = Math.max(from, now - back);
  if (from >= to) return emptyCols();
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol.replace('/', '-'))}?interval=${YAHOO_IV[tf]}&period1=${from}&period2=${to}&includePrePost=false`;
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await f(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) });
      if (r.status === 429 || r.status >= 500) throw new Error(`yahoo: HTTP ${r.status}`);
      if (!r.ok && r.status !== 404) throw new Error(`yahoo: HTTP ${r.status}`);
      const c = parseYahoo(await r.json());
      return tf === '4h' ? aggregate(c, 14400) : c;
    } catch (e) {
      last = e;
      if (e instanceof Error && e.message.startsWith('yahoo: ') && !/HTTP (429|5\d\d)/.test(e.message)) throw e; // "no data" and similar: no retry
      await new Promise((res) => setTimeout(res, 400 * (attempt + 1)));
    }
  }
  throw last instanceof Error ? last : new Error('yahoo: request failed');
}

export interface AlpacaKeys { id: string; secret: string }
const isCrypto = (s: string) => s.includes('/');
export const alpacaSupports = (s: string) => isCrypto(s) || (!/[\^=.]/.test(s) && /^[A-Za-z-]+$/.test(s));

export async function alpacaCandles(keys: AlpacaKeys, symbol: string, tf: Tf, from: number, to: number, f: Fetch = fetch): Promise<Cols> {
  if (from >= to) return emptyCols();
  const crypto = isCrypto(symbol);
  const base = crypto ? 'https://data.alpaca.markets/v1beta3/crypto/us/bars' : `https://data.alpaca.markets/v2/stocks/${encodeURIComponent(symbol)}/bars`;
  const out = emptyCols();
  let token: string | undefined;
  for (let page = 0; page < 200; page++) {
    const q = new URLSearchParams({ timeframe: ALPACA_TF[tf], start: new Date(from * 1000).toISOString(), end: new Date(to * 1000).toISOString(), limit: '10000', sort: 'asc' });
    if (crypto) q.set('symbols', symbol); else { q.set('adjustment', 'split'); q.set('feed', 'iex'); }
    if (token) q.set('page_token', token);
    const r = await f(`${base}?${q}`, { headers: { 'APCA-API-KEY-ID': keys.id, 'APCA-API-SECRET-KEY': keys.secret }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`alpaca: HTTP ${r.status}`);
    const v: any = await r.json();
    const arr = crypto ? v.bars?.[symbol] : v.bars;
    for (const b of Array.isArray(arr) ? arr : []) {
      const t = Date.parse(b.t) / 1000;
      if ([t, b.o, b.h, b.l, b.c].every((x) => typeof x === 'number' && Number.isFinite(x))) push(out, t, b.o, b.h, b.l, b.c, typeof b.v === 'number' ? b.v : 0);
    }
    token = v.next_page_token ?? undefined;
    if (!token) break;
  }
  return out;
}

/** Alpaca first (when the server has keys and supports the symbol), else Yahoo. */
export type Provider = (symbol: string, tf: Tf, from: number, to: number) => Promise<Cols>;
export function makeProvider(keys: AlpacaKeys | null, f: Fetch = fetch): Provider {
  return async (symbol, tf, from, to) => {
    if (keys && alpacaSupports(symbol)) {
      try { const c = await alpacaCandles(keys, symbol, tf, from, to, f); if (c.t.length) return c; } catch (e) { console.warn('alpaca failed, using yahoo:', (e as Error).message); }
    }
    return yahooCandles(symbol, tf, from, to, f);
  };
}

const CHUNK = 1000;
const MAX_ROWS = 150_000;

/** Candles of every user live here once: a request fetches only the part the table does not cover yet. */
export class CandleStore {
  private db: Db; private provider: Provider; private now: () => number;
  private locks = new Map<string, Promise<unknown>>();
  private tailAt = new Map<string, number>();

  constructor(db: Db, provider: Provider, now: () => number = () => Math.floor(Date.now() / 1000)) { this.db = db; this.provider = provider; this.now = now; }

  private async store(symbol: string, tf: Tf, c: Cols, from: number, to: number) {
    for (let i = 0; i < c.t.length; i += CHUNK) {
      const n = Math.min(CHUNK, c.t.length - i), params: unknown[] = [], rows: string[] = [];
      for (let k = 0; k < n; k++) {
        const j = i + k, b = params.length;
        params.push(symbol, tf, c.t[j], c.o[j], c.h[j], c.l[j], c.c[j], c.v[j]);
        rows.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8})`);
      }
      await this.db.query(`INSERT INTO candles (symbol, tf, t, o, h, l, c, v) VALUES ${rows.join(',')} ON CONFLICT (symbol, tf, t) DO UPDATE SET o = EXCLUDED.o, h = EXCLUDED.h, l = EXCLUDED.l, c = EXCLUDED.c, v = EXCLUDED.v`, params);
    }
    const cov = await this.db.query<{ from_t: number; to_t: number }>('SELECT from_t, to_t FROM candle_cov WHERE symbol = $1 AND tf = $2', [symbol, tf]);
    const old = cov.rows[0];
    await this.db.query(
      'INSERT INTO candle_cov (symbol, tf, from_t, to_t) VALUES ($1,$2,$3,$4) ON CONFLICT (symbol, tf) DO UPDATE SET from_t = $3, to_t = $4',
      [symbol, tf, old ? Math.min(old.from_t, from) : from, old ? Math.max(old.to_t, to) : to],
    );
  }

  private async ensure(symbol: string, tf: Tf, from: number, to: number) {
    const now = this.now(), toEff = Math.min(to, now), step = TF_SEC[tf];
    const cov = (await this.db.query<{ from_t: number; to_t: number }>('SELECT from_t, to_t FROM candle_cov WHERE symbol = $1 AND tf = $2', [symbol, tf])).rows[0];
    if (!cov) { await this.store(symbol, tf, await this.provider(symbol, tf, from, toEff), from, toEff); this.tailAt.set(`${symbol}|${tf}`, Date.now()); return; }
    if (from < cov.from_t) await this.store(symbol, tf, await this.provider(symbol, tf, from, cov.from_t), from, cov.from_t);
    const key = `${symbol}|${tf}`;
    // the newest bars change while the market is open: re-fetch the tail, but at most every 30 s for all users together
    if (toEff > cov.to_t - 2 * step && Date.now() - (this.tailAt.get(key) ?? 0) > 30_000) {
      this.tailAt.set(key, Date.now());
      const start = Math.max(cov.to_t - 2 * step, from);
      try { await this.store(symbol, tf, await this.provider(symbol, tf, start, toEff), start, toEff); }
      catch (e) { console.warn(`tail refresh failed for ${key}, serving the stored candles:`, (e as Error).message); }
    }
  }

  async get(symbol: string, tf: Tf, from: number, to: number): Promise<Cols> {
    const key = `${symbol}|${tf}`;
    const prev = this.locks.get(key) ?? Promise.resolve();
    const run = prev.catch(() => {}).then(() => this.ensure(symbol, tf, from, to));
    this.locks.set(key, run);
    try { await run; } finally { if (this.locks.get(key) === run) this.locks.delete(key); }
    const r = await this.db.query<{ t: number; o: number; h: number; l: number; c: number; v: number }>(
      'SELECT t, o, h, l, c, v FROM candles WHERE symbol = $1 AND tf = $2 AND t >= $3 AND t <= $4 ORDER BY t DESC LIMIT $5', [symbol, tf, from, to, MAX_ROWS]);
    const out = emptyCols();
    for (let i = r.rows.length - 1; i >= 0; i--) { const x = r.rows[i]; push(out, x.t, x.o, x.h, x.l, x.c, x.v); }
    return out;
  }
}

export async function searchSymbols(q: string, f: Fetch = fetch): Promise<{ symbol: string; name: string; exchange: string; kind: string }[]> {
  const r = await f(`https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=12&newsCount=0`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`yahoo search: HTTP ${r.status}`);
  const v: any = await r.json();
  return (Array.isArray(v.quotes) ? v.quotes : []).filter((x: any) => typeof x.symbol === 'string')
    .map((x: any) => ({ symbol: x.symbol, name: x.longname ?? x.shortname ?? '', exchange: x.exchDisp ?? '', kind: x.quoteType ?? '' }));
}
