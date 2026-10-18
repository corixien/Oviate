# AGENTS.md

Oviate: keyboard-first desktop charting tool (TradingView alternative). Linux first, portable design (core separated from UI).

## Stack
Tauri 2 + Rust core (`src-tauri/`) + Svelte 5/SvelteKit (SPA, adapter-static) + TypeScript (`src/`). Custom Canvas2D chart renderer (no charting lib). Pine engine in TypeScript.

## Commands (repo root)
- `npm run tauri dev` - run app
- `npm run check` - svelte-check. Read the whole output: errors are printed as `ERROR` (upper case)
- `npm test` - `node --test` (Pine engine, indicator library, strategies, paper engine) then `cargo test`
- `npm run tauri build` - bundle

## Layout
- `src-tauri/src/`: `lib.rs` (Tauri commands), `providers/` (alpaca, yahoo), `cache.rs` (SQLite candles, news, AI summaries, kv), `stream.rs` (Alpaca WebSocket), `news.rs` (news providers), `mcp.rs` (OAuth + MCP client for Liquid), `ai.rs` (Groq), `pine_files.rs` (user `.pine` files).
- `src/lib/chart/`: renderer, chart component, data transforms. `src/lib/pine/`: parser, interp, natives, ta, strategy, worker. `src/lib/paper/`: engine (pure, tested) and store. `src/lib/ui/`: panels, dialogs, pages (news, script editor). `src/lib/app.svelte.ts`: global app state (persisted in the SQLite `kv` table).
- `indicators/*.pine`: bundled indicators, seeded into `<app data>/indicators` on first start (a deleted one stays deleted). `strategies/` ships empty.

## Rules
- Rust core owns data providers, caches, news, keyring access and file storage. UI only renders and sends commands. Keep core free of Tauri types where possible.
- Every action must be reachable via keyboard / the command bar (`Enter`, `/commands`).
- Design: black, hard purple accents, 2px corners, no blur or backdrop-filter (WebKitGTK crashes/freezes on it), no native `<select>` (use `ui/Select.svelte`), no number spinners.
- WebKitGTK crash workaround: `src-tauri/src/main.rs` disables the AT-SPI accessibility bridge. Keep it.
- Pine engine supports a v5/v6 subset: `request.security` is a passthrough, label/line/box drawings are accepted but not rendered.
- Paper trading commission is charged per fill (buy and sell each), as percent of trade value.
- Tests: Node runs TypeScript by type stripping, so test-covered files must avoid parameter properties and enums, and use `.ts` import extensions.

## Secrets
Alpaca, Finnhub, NewsAPI, Groq keys and Liquid tokens live in the OS keyring only. Never in repo, logs, commits, `.env.example` values. Liquid OAuth requests the `read` scope only, never `trade`. Paper trading only, no live orders.

## Git
Push directly to `main`. No PRs unless asked. Commit messages end with the Co-Authored-By line from the session.
