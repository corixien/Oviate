export type Lang = 'en' | 'de';
const dict: Record<string, Record<Lang, string>> = {
  search: { en: 'Search symbol or type / for commands', de: 'Symbol suchen oder / für Befehle' },
  settings: { en: 'Settings', de: 'Einstellungen' },
  watchlist: { en: 'Watchlist', de: 'Watchlist' },
  indicators: { en: 'Indicators', de: 'Indikatoren' },
  alpacaKeys: { en: 'Alpaca API keys', de: 'Alpaca API-Keys' },
  keyId: { en: 'Key ID', de: 'Key-ID' },
  secret: { en: 'Secret key', de: 'Secret-Key' },
  save: { en: 'Save', de: 'Speichern' },
  clear: { en: 'Remove', de: 'Entfernen' },
  keysSet: { en: 'Keys stored in system keyring', de: 'Keys im System-Keyring gespeichert' },
  keysNone: { en: 'No keys set - using Yahoo Finance', de: 'Keine Keys - Yahoo Finance wird genutzt' },
  theme: { en: 'Theme', de: 'Design' },
  language: { en: 'Language', de: 'Sprache' },
  animations: { en: 'Animations', de: 'Animationen' },
  dark: { en: 'Dark', de: 'Dunkel' },
  light: { en: 'Light', de: 'Hell' },
  loading: { en: 'Loading…', de: 'Lädt…' },
  noData: { en: 'No data for this symbol', de: 'Keine Daten für dieses Symbol' },
  commands: { en: 'Commands', de: 'Befehle' },
  symbols: { en: 'Symbols', de: 'Symbole' },
  add: { en: 'Add', de: 'Hinzufügen' },
  close: { en: 'Close', de: 'Schließen' },
  tools: { en: 'Drawing tools', de: 'Zeichenwerkzeuge' }
};
export const t = (k: string, lang: Lang) => dict[k]?.[lang] ?? k;
