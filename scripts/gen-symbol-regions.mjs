// Builds src/lib/data/symbol-regions.json: the economic regions (calendar currencies) of the ~1500 largest US-listed stocks.
// Source: Nasdaq stock screener (country per symbol, market cap). Run: node scripts/gen-symbol-regions.mjs
// The country -> currency rule is the same as `country_currencies` in src-tauri/src/regions.rs: keep them in sync.
import { writeFileSync } from 'node:fs';

const EURO = ['Netherlands', 'Germany', 'France', 'Spain', 'Italy', 'Ireland', 'Belgium', 'Luxembourg', 'Finland', 'Austria', 'Portugal', 'Greece', 'Cyprus', 'Estonia', 'Latvia', 'Lithuania', 'Malta', 'Slovakia', 'Slovenia', 'Croatia'];
function currencies(country) {
  const c = country.trim();
  if (EURO.includes(c)) return ['EUR', 'USD'];
  if (c === 'Canada') return ['CAD', 'USD'];
  if (c === 'United Kingdom' || c === 'Guernsey' || c === 'Jersey' || c === 'Isle of Man') return ['GBP', 'USD'];
  if (c === 'Japan') return ['JPY', 'USD'];
  if (c === 'Australia') return ['AUD', 'USD'];
  if (c === 'New Zealand') return ['NZD', 'USD'];
  if (c === 'Switzerland') return ['CHF', 'USD'];
  if (c === 'China' || c === 'Hong Kong' || c === 'Macau') return ['CNY', 'USD'];
  return ['USD'];
}

const H = { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/120.0', Accept: 'application/json', Origin: 'https://www.nasdaq.com', Referer: 'https://www.nasdaq.com/' };
const r = await fetch('https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=10000&offset=0&download=true', { headers: H, signal: AbortSignal.timeout(60000) });
const rows = (await r.json()).data?.rows ?? [];
const cap = (x) => parseFloat(String(x.marketCap || '0').replace(/[^0-9.]/g, '')) || 0;
rows.sort((a, b) => cap(b) - cap(a));
const out = {};
for (const x of rows.slice(0, 1500)) out[x.symbol.trim().toUpperCase().replace(/\//g, '.')] = currencies(x.country || '').join(',');
writeFileSync(new URL('../src/lib/data/symbol-regions.json', import.meta.url), JSON.stringify(out));
console.log(Object.keys(out).length, 'symbols');
