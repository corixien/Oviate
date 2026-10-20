<p align="center"><img src="logos/oviate-logo.svg" alt="Oviate" width="120"></p>

# Oviate

**O**ptimal **V**isions **I**nspire **A**ccurate **T**rade **E**ntries

Fast, keyboard-first desktop charting tool with a black and purple UI. Linux first, designed to port to Windows and macOS.

## Features

- **Charts:** 1, 2, 3 or 4 charts with draggable splits, 8 chart types (candles, hollow, bars, line, area, baseline, Heikin-Ashi, Renko), log scale, volume, crosshair/zoom/scroll sync between charts, 26 drawing tools (lines, rays, channels, pitchfork, shapes, Fibonacci retracement and extension, long/short position, price and date range, measure, brush, markers, text and callout with an inline editor).
- **Navigation:** scroll = move through time, `Shift`+scroll = stretch or squeeze the price axis, `Ctrl`+scroll = zoom both axes (stops when one axis reaches its limit), hold and drag = move the chart 1:1 with the cursor. Scrolling stops 10 candles after the newest one. `Ctrl` `+`/`-`/`0` zooms the whole app.
- **Data:** Alpaca (primary, live WebSocket for stocks and crypto) with Yahoo Finance as fallback. Candles and news are cached locally in SQLite, only missing ranges are fetched.
- **Command bar:** `Enter` (or typing a letter) opens it. Plain text searches tickers and companies, `/` runs commands (timeframe, chart type, layout, indicators, strategies, news, paper trading, settings).
- **Indicators and strategies:** Pine Script (v5/v6 subset) files. 94 indicators ship in `indicators/`, strategies are user-written. Add your own with `/ind add new` and `/strat add new` (paste Pine code, saved as a `.pine` file).
- **Visual strategy builder:** `/strat add new builder` builds a strategy from indicator blocks, Scratch style. Four event blocks (long entry, long exit, short entry, short exit), each with conditions (cross above/below, above/below, between, equals, rising/falling) between indicators, prices and values, combined with ALL/ANY groups (nestable), plus optional stop loss / take profit. Open it with `/visual builder` or the block button on a strategy's chart legend. Position size (% of account, cash amount or units) is part of the strategy and saved in the `.pine` file. Capital, commission and slippage are Strategy Tester settings (Settings tab): they apply to the simulation only, not to the strategy file or the chart boxes. While flat the strategy scans for entries, while in a trade for exits. It is saved as a normal `.pine` file (the block layout rides along in a header comment, so the builder can reopen it).
- **Strategy tester:** a strategy on a chart shows its last 20 trades as entry-to-exit boxes (older ones as arrows), its indicators live on the chart, and a detailed report in the panel under the charts: equity and drawdown curves, performance, trade, risk (Sharpe, Sortino, Calmar, ...) and long-vs-short statistics, trade list.
- **Paper trading:** multiple accounts (capital, leverage, commission), market/limit/stop orders with optional take-profit and stop-loss, positions, orders, history, statistics and equity curve in the panel under the charts. Strategies can trade a paper account.
- **News:** markers on the chart for news about the symbol, a `/news` page with all headlines (week by week, cached locally), AI summary per headline via Groq.
- **Watchlists, analysis panel, English and German UI, dark and light theme, custom candle colors.**

## Stack

Tauri 2, Rust core (data providers, SQLite cache, news, keyring, Pine file storage), Svelte 5 + TypeScript UI, custom Canvas2D chart renderer, Pine engine in TypeScript running in a Web Worker.

## Development

Requirements: Node 22.18+ (tests run TypeScript directly), Rust stable, Tauri Linux dependencies (webkit2gtk-4.1, libsoup3, gtk3, openssl).

```bash
npm install
npm run tauri dev
```

| Command | Purpose |
|---|---|
| `npm run tauri dev` | Run the app |
| `npm run check` | Svelte/TypeScript type check |
| `npm test` | Pine engine, indicator library, strategy, builder and paper engine tests (Node), then Rust tests |
| `npm run tauri build` | Release bundle |

## Desktop launcher (Linux)

`npm run tauri build -- --no-bundle` builds `src-tauri/target/release/oviate`. A `~/.local/share/applications/oviate.desktop` entry pointing at that binary puts Oviate in the app menu; rebuild after code changes.

## Configuration

All secrets are entered in the app's Settings and stored in the OS keyring. Never commit keys.

| Setting | Used for |
|---|---|
| Alpaca key id and secret | Candles, live stream, Alpaca News |
| Finnhub, NewsAPI keys | Additional news providers |
| Liquid MCP login | Market brief (OAuth in the browser, read-only scope) |
| Groq key | AI news summaries |

Without any key, Oviate uses Yahoo Finance for candles and Google News, Yahoo and RSS feeds for news.

User scripts live as `.pine` files in the app data folder (`indicators/` and `strategies/`); the folder path is shown in the script editor.

## License

MIT
