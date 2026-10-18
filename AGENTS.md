# AGENTS.md

Oviate: keyboard-first desktop charting tool (TradingView alternative). Linux first, portable design (core separated from UI).

## Stack
Tauri 2 + Rust core (`src-tauri/`) + Svelte 5/SvelteKit (SPA, adapter-static) + TypeScript (`src/`). Custom WebGL2/Canvas chart renderer (no charting lib).

## Commands (repo root)
- `npm run tauri dev` - run app
- `npm run check` - svelte-check
- `npm test` - `cargo test` in `src-tauri`
- `npm run tauri build` - bundle

## Pine scripts
- `indicators/*.pine` (bundled, 94 files) are seeded into `<app data>/indicators` on first start; users add more via `/ind add new`. `strategies/` ships empty; users add theirs via `/strat add new`. Plain `.pine` files, edited in the in-app editor.
- The Pine engine is TypeScript (`src/lib/pine/`: parser, interp, natives, ta, strategy), runs in a Web Worker (`runner.ts`). It supports a Pine v5/v6 subset; `request.security` is a passthrough, label/line/box drawings are accepted but not rendered.
- Paper trading is pure logic in `src/lib/paper/engine.ts` (tested), state in `paper.svelte.ts`, persisted in the SQLite `kv` table.
- Tests: `npm test` runs `node --test` (Pine engine, library, strategies, paper engine; needs Node 22.18+ for TS type stripping) and `cargo test`. Test files must avoid TS-only syntax that Node cannot strip (no parameter properties, no enums).

## Architecture rules
- Rust core owns: data providers (Alpaca primary, Yahoo fallback), SQLite candle cache, Pine interpreter, alerts, keyring access. UI only renders and sends commands.
- Keep core free of Tauri types where possible so it ports to other shells.
- Every action must be reachable via keyboard / the Spotlight command bar.

## Secrets
Alpaca keys live in the OS keyring only. Never in repo, logs, commits, `.env.example` values. Paper trading only until told otherwise.

## Git
Push directly to `main`. No PRs unless asked.
