import type { Candles } from './chart/data';
import { synthColumns } from './chart/data';

export type Tf = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d' | '1w' | '1M';
export const TIMEFRAMES: Tf[] = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M'];
export const TF_SECONDS: Record<Tf, number> = {
  '1m': 60, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400, '1d': 86400, '1w': 604800, '1M': 2592000
};

export interface SymbolHit { symbol: string; name: string; exchange: string; kind: string }

export const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

interface Raw { t: number[]; o: number[]; h: number[]; l: number[]; c: number[]; v: number[] }

function toCandles(r: Raw): Candles {
  const n = r.t.length;
  return {
    n,
    t: Float64Array.from(r.t),
    o: Float64Array.from(r.o),
    h: Float64Array.from(r.h),
    l: Float64Array.from(r.l),
    c: Float64Array.from(r.c),
    v: Float64Array.from(r.v)
  };
}

export async function getCandles(symbol: string, tf: Tf, from: number, to: number): Promise<Candles> {
  if (!inTauri) return synthColumns(symbol, TF_SECONDS[tf], from, to);
  return toCandles(await call<Raw>('get_candles', { symbol, tf, from, to }));
}

export async function searchSymbols(query: string): Promise<SymbolHit[]> {
  if (!inTauri) {
    const q = query.toUpperCase();
    return ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'GOOGL', 'META', 'SPY', 'QQQ', 'BTC/USD', 'ETH/USD']
      .filter((s) => s.includes(q))
      .map((s) => ({ symbol: s, name: s, exchange: 'DEMO', kind: 'EQUITY' }));
  }
  return call<SymbolHit[]>('search_symbols', { query });
}

export const saveAlpacaKeys = (keyId: string, secret: string) =>
  inTauri ? call<void>('save_alpaca_keys', { keyId, secret }) : Promise.resolve();
export const clearAlpacaKeys = () => (inTauri ? call<void>('clear_alpaca_keys') : Promise.resolve());
export const alpacaKeysSet = () => (inTauri ? call<boolean>('alpaca_keys_set') : Promise.resolve(false));

export async function kvGet(key: string): Promise<string | null> {
  if (inTauri) return call<string | null>('kv_get', { key });
  try { return localStorage.getItem('oviate:' + key); } catch { return null; }
}
export async function kvSet(key: string, value: string): Promise<void> {
  if (inTauri) return call<void>('kv_set', { key, value });
  try { localStorage.setItem('oviate:' + key, value); } catch { /* ignore */ }
}

export const streamSymbols = (symbols: string[]) => (inTauri ? call<void>('stream_symbols', { symbols }) : Promise.resolve());

export interface Tick { symbol: string; price: number; size: number; t: number }
export async function onTick(cb: (t: Tick) => void): Promise<() => void> {
  if (!inTauri) return () => {};
  const { listen } = await import('@tauri-apps/api/event');
  return listen<Tick>('tick', (e) => cb(e.payload));
}

export interface NewsItem { id: string; headline: string; source: string; provider: string; summary: string; url: string; ts: number; symbols: string[] }
export interface NewsResult { items: NewsItem[]; errors: { provider: string; error: string }[] }
export interface NewsStatus { finnhub: boolean; newsapi: boolean; alpaca: boolean; liquid: boolean; groq: boolean }
export interface Unusual { symbol: string; multiple: number; volume: string }

export const newsStatus = () => (inTauri ? call<NewsStatus>('news_status') : Promise.resolve({ finnhub: false, newsapi: false, alpaca: false, liquid: false, groq: false }));
/** Empty value clears the key. */
export const saveNewsKey = (provider: 'finnhub' | 'newsapi' | 'groq', value: string) => (inTauri ? call<void>('save_news_key', { provider, value }) : Promise.resolve());
export const liquidLogin = () => (inTauri ? call<void>('liquid_login') : Promise.reject('Liquid login needs the desktop app'));
export const liquidLogout = () => (inTauri ? call<void>('liquid_logout') : Promise.resolve());
/** News in [from, to] (unix seconds); symbol null = market-wide. Cached locally by the backend. */
export const newsWindow = (symbol: string | null, from: number, to: number) =>
  inTauri ? call<NewsResult>('news_window', { symbol, from, to }) : Promise.resolve({ items: [], errors: [] } as NewsResult);

export interface AiSummary { what: string; impact: string; direction: 'bullish' | 'bearish' | 'neutral' | 'mixed'; intensity: number; assets: string[]; horizon: string; model: string }
export const aiSummary = (id: string, lang: string, force = false) =>
  inTauri ? call<AiSummary>('ai_summary', { id, lang, force }) : Promise.reject('AI summaries need the desktop app');

export type ChatMsg = { role: 'system' | 'user' | 'assistant'; content: string };
export const aiComplete = (messages: ChatMsg[]) =>
  inTauri ? call<string>('ai_complete', { messages }) : Promise.reject('AI needs the desktop app');

export async function openUrl(url: string) {
  if (!inTauri) { window.open(url, '_blank'); return; }
  const m = await import('@tauri-apps/plugin-opener');
  await m.openUrl(url);
}
export const liquidUnusual = () => (inTauri ? call<Unusual[]>('liquid_unusual') : Promise.resolve([] as Unusual[]));
