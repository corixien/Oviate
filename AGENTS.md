# AGENTS.md

Oviate: keyboard-first desktop charting tool (TradingView alternative). Linux first, portable design (core separated from UI).

## Stack
Tauri 2 + Rust core (`src-tauri/`) + Svelte 5/SvelteKit (SPA, adapter-static) + TypeScript (`src/`). Custom Canvas2D chart renderer (no charting lib). Pine engine in TypeScript.

## Commands (repo root)
- `npm run tauri dev` - run app
- `npm run check` - svelte-check. Read the whole output: errors are printed as `ERROR` (upper case)
- `npm test` - `node --test` (Pine engine, indicator library, strategies, paper engine) then `cargo test`
- `npm run tauri build` - bundle. `npm run tauri build -- --no-bundle` - release binary only (what the app-menu entry `~/.local/share/applications/oviate.desktop` launches; rebuild after changes, otherwise the menu app runs an old version)

## Layout
- `src-tauri/src/`: `lib.rs` (Tauri commands), `providers/` (alpaca, yahoo), `cache.rs` (SQLite candles, news, AI summaries, kv), `stream.rs` (Alpaca WebSocket), `news.rs` (news providers), `mcp.rs` (OAuth + MCP client for Liquid), `ai.rs` (Groq), `pine_files.rs` (user `.pine` files).
- `src/lib/chart/`: renderer, chart component, data transforms. `src/lib/pine/`: parser, interp, natives, ta, strategy, worker. `src/lib/paper/`: engine (pure, tested) and store. `src/lib/builder/model.ts`: visual strategy builder spec, indicator catalog and Pine generator (pure, tested); `src/lib/pine/stats.ts`: detailed strategy statistics (pure, tested). `src/lib/ui/`: panels, dialogs, pages (news, script editor). `src/lib/app.svelte.ts`: global app state (persisted in the SQLite `kv` table).
- `logos/`: logo concepts; `logos/oviate-logo.svg` is the app logo (icons generated with `npx tauri icon`). `project-resume.md`: handoff file, keep updated and committed.
- `indicators/*.pine`: bundled indicators, seeded into `<app data>/indicators` on first start (a deleted one stays deleted). `strategies/` ships empty.

## Rules
- Rust core owns data providers, caches, news, keyring access and file storage. UI only renders and sends commands. Keep core free of Tauri types where possible.
- Every action must be reachable via keyboard / the command bar (`Enter`, `/commands`).
- Design: black, hard purple accents, 2px corners, no blur or backdrop-filter (WebKitGTK crashes/freezes on it), no native `<select>` (use `ui/Select.svelte`), no number spinners.
- WebKitGTK crash workaround: `src-tauri/src/main.rs` disables the AT-SPI accessibility bridge. Keep it.
- Chart navigation lives in `renderer.ts`: wheel input eases toward a target (`tgt`), hold-and-drag is applied once per frame in `applyPan()`, auto price range eases (`autoSm`). Right scroll limit is `RIGHT_PAD` empty bars after the newest candle (hard stop). Do heavy background work (ticks, polling, Pine reruns) only when `r.dragging` is false.
- No animations on dialogs (fade/pop caused a flash in WebKitGTK); all dialogs share one outline (`1px glass-line` + faint purple ring, no glow).
- Pine engine supports a v5/v6 subset: `request.security` is a passthrough, label/line/box drawings are accepted but not rendered.
- Builder strategies are plain `.pine` files generated from a spec; the spec JSON sits in a `// @oviate-builder` header line (`parseSpec`). Keep it right after the `strategy()` line (`scriptMeta` reads the first `strategy(`). Each builder indicator has its own scenario list (`SCENARIOS`, `PRICE_SC`, `GENERIC` in `builder/model.ts`; ids are saved in specs, so never rename them; add new ones). Position size is part of the builder spec (written into `strategy()`); capital/commission/slippage are `app.tester` (`TesterSettings`, persisted in the workspace, passed to `runScript` as `broker`, overrides `strategy()` in `strategy.ts`); chart boxes and arrows use `entryRaw/exitRaw` (no slippage). Oscillators of a builder strategy show as companion bundled indicators (`companions()`, `app.addStrategy`). The chart draws the last 20 strategy trades as boxes (`BOX_TRADES` in `Chart.svelte`).
- AI code generation: Rust `ai_complete` command (OpenRouter free models, `ai::CODE_MODELS` fallback chain, key `openrouter_key` in keyring; Groq stays for news summaries only) is a plain chat call; prompts, repair loop and validation live in `src/lib/builder/ai.ts` (pure, tested with a mock completer). AI builder conditions store `Cond.ai {text, code}`; code uses `IND0..` placeholders for the subject's outputs and is emitted as an `aiN()` function in the generated Pine.
- AI indicator pipeline (`genIndicator` in `builder/ai.ts`): analyst plan call (exact math) -> code call with the v6 system prompt (from `Syspromptvorschlag.md`) plus 2 similar bundled indicators as few-shot references (`pickExamples`) -> `sanity()` run on sample data (na, flat, price-vs-oscillator scale, overlay checks) -> up to 4 repair rounds with the error fed back. Extend `sanity`/prompts there, not in the UI.
- Paper trading commission is charged per fill (buy and sell each), as percent of trade value.
- Tests: Node runs TypeScript by type stripping, so test-covered files must avoid parameter properties and enums, and use `.ts` import extensions.

## Secrets
Alpaca, Finnhub, NewsAPI, Groq keys and Liquid tokens live in the OS keyring only. Never in repo, logs, commits, `.env.example` values. Liquid OAuth requests the `read` scope only, never `trade`. Paper trading only, no live orders.

## Local install (always)
The newest version of Oviate must always be installed on the user's computer. Right after every push to `main`, run `scripts/install-local.sh` (about 4 min, run it in the background) so the app-menu entry launches the new build, then tell the user to restart Oviate. Also do it whenever the user says the installed app lacks a feature.

## Git
Push directly to `main`. No PRs unless asked. Commit `project-resume.md` with every change. If `git push` fails with an invalid token, push once with `git -c credential.helper= -c "credential.helper=!gh auth git-credential" push origin main`. Commit messages end with the Co-Authored-By line from the session.
