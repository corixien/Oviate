# AGENTS.md

Oviate: keyboard-first desktop charting tool (TradingView alternative). Linux first, portable design (core separated from UI).

## Stack
Tauri 2 + Rust core (`src-tauri/`) + Svelte 5/SvelteKit (SPA, adapter-static) + TypeScript (`src/`). Custom WebGL2/Canvas chart renderer (no charting lib).

## Commands (repo root)
- `npm run tauri dev` - run app
- `npm run check` - svelte-check
- `npm test` - `cargo test` in `src-tauri`
- `npm run tauri build` - bundle

## Architecture rules
- Rust core owns: data providers (Alpaca primary, Yahoo fallback), SQLite candle cache, Pine interpreter, alerts, keyring access. UI only renders and sends commands.
- Keep core free of Tauri types where possible so it ports to other shells.
- Every action must be reachable via keyboard / the Spotlight command bar.

## Secrets
Alpaca keys live in the OS keyring only. Never in repo, logs, commits, `.env.example` values. Paper trading only until told otherwise.

## Git
Push directly to `main`. No PRs unless asked.
