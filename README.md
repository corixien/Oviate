# Oviate

**O**ptimal **V**isions **I**nspire **A**ccurate **T**rade **E**ntries

Fast, keyboard-first desktop charting tool with a liquid-glass UI. Linux first, portable to Windows/macOS.

## Status

Early development (milestone 1: scaffold + rendering spike).

## Planned

- Candle data from Alpaca (primary) and yfinance/Yahoo (fallback), cached locally in SQLite
- Up to 4 simultaneous charts, live streaming, chart types (candles, Heikin-Ashi, Renko, line, area)
- Pine Script (v5/v6 subset) indicators and strategies, simple strategy tester
- Full drawing tools, watchlists, price alerts, saved layouts, Alpaca paper orders
- Spotlight-style command bar: `Enter` opens it, `/commands` control everything, plain typing searches tickers and companies
- English + German UI, dark/light, violet accent

## Scripts

Indicators and strategies are Pine Script files. 94 indicators ship in `indicators/`; add your own with `/ind add new` (paste Pine code, saved as a `.pine` file). Strategies: `/strat add new`. A strategy added to a chart shows its trades as arrows and a report in the Strategy Tester panel, and can trade a paper account.

## Paper trading

Create accounts with capital, leverage and commission; place market, limit, stop, stop-limit and trailing-stop orders with optional take-profit / stop-loss from the Buy / Sell buttons on every chart. Positions, orders, history and statistics live in the panel under the charts.

## Stack

Tauri 2, Rust core, Svelte 5 + TypeScript, custom WebGL2/Canvas chart renderer.

## Development

Requirements: Node 22+, Rust stable, Tauri Linux deps (webkit2gtk-4.1, libsoup3, gtk3, openssl).

```bash
npm install
npm run tauri dev
```

| Command | Purpose |
|---|---|
| `npm run check` | Svelte/TS type check |
| `npm test` | Rust unit tests |
| `npm run tauri build` | Release bundle |

Alpaca API keys are entered in the app's Settings and stored in the OS keyring. Never commit keys.

## License

MIT
