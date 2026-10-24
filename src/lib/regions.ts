// Which calendar currencies matter for a symbol: the economic regions whose macro events belong on its chart.
// Order of lookup: forex pair / crypto / index / exchange suffix rules, then the bundled table of the ~1500 largest US-listed stocks
// (`data/symbol-regions.json`, built by `scripts/gen-symbol-regions.mjs`), then the backend (`symbol_regions`: Nasdaq company profile, else the AI).
import table from './data/symbol-regions.json' with { type: 'json' };

/** Currencies the macro calendar (Forex Factory) uses; "All" events are shown everywhere. */
export const CAL_CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'NZD', 'CHF', 'CNY'];
const SUFFIX: Record<string, string> = {
  DE: 'EUR', F: 'EUR', PA: 'EUR', AS: 'EUR', MI: 'EUR', MC: 'EUR', BR: 'EUR', VI: 'EUR', HE: 'EUR', LS: 'EUR', IR: 'EUR', AT: 'EUR',
  L: 'GBP', SW: 'CHF', TO: 'CAD', V: 'CAD', AX: 'AUD', NZ: 'NZD', T: 'JPY', HK: 'CNY', SS: 'CNY', SZ: 'CNY',
};
const INDEX: Record<string, string> = {
  '^GSPC': 'USD', '^IXIC': 'USD', '^DJI': 'USD', '^RUT': 'USD', '^VIX': 'USD', '^NDX': 'USD',
  '^GDAXI': 'EUR', '^STOXX50E': 'EUR', '^FCHI': 'EUR', '^IBEX': 'EUR', '^FTSE': 'GBP', '^N225': 'JPY', '^HSI': 'CNY', '^AXJO': 'AUD', '^GSPTSE': 'CAD', '^SSMI': 'CHF',
};
const CRYPTO = new Set(['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'ADA', 'LTC', 'BNB', 'AVAX', 'DOT', 'LINK', 'MATIC', 'SHIB', 'BCH']);

const uniq = (a: string[]) => [...new Set(a)];

/** Currencies for the symbol, or null when nothing is known (ask the backend). */
export function knownCurrencies(symbol: string): string[] | null {
  const s = symbol.trim().toUpperCase();
  if (!s) return null;
  if (INDEX[s]) return [INDEX[s]];
  // pairs: EUR/USD, EURUSD=X, EUR-USD
  const pair = /^([A-Z]{3})[\/\-]([A-Z]{3})$/.exec(s) ?? /^([A-Z]{3})([A-Z]{3})=X$/.exec(s);
  if (pair) {
    if (CRYPTO.has(pair[1])) return CAL_CURRENCIES.includes(pair[2]) ? [pair[2]] : ['USD'];
    const c = [pair[1], pair[2]].filter((x) => CAL_CURRENCIES.includes(x));
    return c.length ? uniq(c) : ['USD'];
  }
  if (CRYPTO.has(s.replace(/-?USD[T]?$/, ''))) return ['USD'];
  const dot = /\.([A-Z]{1,2})$/.exec(s);
  if (dot && SUFFIX[dot[1]]) return uniq([SUFFIX[dot[1]], 'USD']);
  const hit = (table as Record<string, string>)[s.replace('/', '.')];
  return hit ? hit.split(',') : null;
}

/** Is a macro event of this region relevant for these currencies? "All" (IMF meetings, G20, ...) always is. */
export const regionMatches = (country: string, currencies: string[]) => country === 'All' || currencies.includes(country);
