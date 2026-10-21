# Project Resume

> Instruction for Claude: read this whole file first. Then read every file under "Must read before any change". Do not modify anything until you have fully understood the project. Keep this file updated as you work (see "Maintenance rules" in the resume-writer skill).

Last updated: 2026-10-21 (optimizer fixes, AI edit in the code editor)

## 1. What this project is
Oviate (Optimal Visions Inspire Accurate Trade Entries): keyboard-first desktop charting tool, TradingView alternative. Black/purple UI. Linux first, portable design (Rust core separate from UI). Tauri 2 + Rust core + Svelte 5/SvelteKit SPA (adapter-static) + TypeScript, custom Canvas2D renderer, Pine Script v5/v6 subset engine in TypeScript (Web Worker). MIT. Paper trading only, no live orders.

## 2. Must read before any change
1. `AGENTS.md` - rules, layout, design constraints, secrets policy, local-install rule
2. `README.md` - features, config, dev commands
3. `src/lib/app.svelte.ts` - global app state, persisted in SQLite `kv` table
4. `src-tauri/src/lib.rs` - all Tauri commands (UI to core boundary)
5. `src/lib/chart/Chart.svelte` + `renderer.ts` - chart rendering
6. `src/lib/pine/interp.ts`, `strategy.ts` - Pine engine and strategy broker
7. `src/lib/ai/pine.ts` - AI prompts, checks, repair loop (indicators, strategies, edits)
8. `src/lib/pine/optimizer.ts` - strategy optimizer

## 3. How to navigate
- `src-tauri/src/`: `lib.rs` commands (incl. `ai_complete`), `ai.rs` (Groq news summaries + OpenRouter code chat with 429 retry and `CODE_MODELS` fallback), `cache.rs` SQLite (candles, news, kv; file `oviate.db`), `stream.rs`, `news.rs`, `mcp.rs`, `pine_files.rs`, `providers/`.
- `src/lib/chart/`: `Chart.svelte`, `renderer.ts`, `candleStore.ts` (candles of each chart for the optimizer), `data.ts`, `transforms.ts`, `indicators.ts`.
- `src/lib/pine/`: engine (`parser`, `interp`, `natives`, `ta`, `strategy`), `panes.ts` (`plot(..., pane="X")` split), `stats.ts` (tester statistics), `optimizer.ts` + `optimizer.worker.ts` + `optimizer-runner.ts`, `runner.ts`, `worker.ts`, `describe.ts`, `types.ts`; tests `*.test.ts`.
- `src/lib/ai/pine.ts`: `genIndicator`, `genStrategy`, `editIndicator`, `editStrategy`, `extractStrategyForm`, `sanity`, `strategyCheck`, `setPositionSize`, `STRAT_SAMPLE`.
- `src/lib/optimizer.svelte.ts` (optimizer state), `src/lib/paper/` (paper engine + store), `library.svelte.ts` (script library, reloads on window focus).
- `src/lib/ui/`: `PaperPanel` (tabs Paper Trading / Strategy Tester / Optimizer), `OptimizerPanel`, `AiDialog` (`/ind add ai`, `/strat add ai`), `AiStrategyFields` (size/SL/TP/direction form, shared), `ScriptEditor` (code editor with search, AI edit, blank state), `Spotlight` (command bar), `Settings`, etc.
- `cli/oviate.ts` (+ `cli/oviate` wrapper, `cli/oviate.test.ts`): the `oviate` CLI. `skills/oviate/SKILL.md`: the `/oviate` Claude skill. `scripts/install-local.sh`: rebuild + install (also symlinks the CLI to `~/.local/bin` and copies the skill to `~/.claude/skills/oviate`).
- `indicators/*.pine`: 94 bundled indicators, seeded into `<app data>/indicators` on first start. `strategies/` ships empty. `Syspromptvorschlag.md`: the user's base for the AI indicator system prompt.
- App data: `~/.local/share/dev.oviate.app/` (`indicators/`, `strategies/`, `oviate.db`).

## 4. Commands (run from repo root)
- `npm install`; `npm run tauri dev` run app; `npm run tauri build -- --no-bundle` release binary
- `npm run check` svelte-check (read whole output, errors print as `ERROR`)
- `npm test` node --test (pine, paper, ai, cli) then `cargo test`
- `scripts/install-local.sh` after every push to main (about 4 min), then restart Oviate
- `oviate help` for the CLI
- Requires Node 22.18+ (type stripping, `node:sqlite`), Rust stable, Tauri Linux deps (webkit2gtk-4.1, libsoup3, gtk3, openssl)
- CI: `.github/workflows/ci.yml`
- Visual check without the app: `npm run dev -- --port 1420` (browser mode, synthetic data) and headless `google-chrome` over CDP (see how it was done in the session: seed `localStorage` keys `oviate:workspace`, `oviate:paper`, `oviate:scripts:strategies`).

## 5. Invariants and gotchas
- Rust core owns providers, caches, news, keyring, file storage. UI only renders and sends commands. Keep core free of Tauri types where possible.
- Every action reachable via keyboard / command bar (`Enter`, `/commands`).
- Design: black, hard purple accents, 2px corners, no blur/backdrop-filter (WebKitGTK crash), no native `<select>` (use `ui/Select.svelte`), no number spinners.
- Keep AT-SPI bridge disable in `src-tauri/src/main.rs` (WebKitGTK crash workaround).
- Pine: `request.security` passthrough; label/line/box accepted but not rendered. Oviate extension `pane="Name"` on plot/hline = own chart pane.
- Strategy Tester settings (`app.tester`: capital, commission %, slippage % of price default 0.1, fill on signal-bar close default) override `strategy()` in the engine; position size stays in the strategy. Paper-trading signals run with fillOnClose off.
- AI keys: OpenRouter (code) and Groq (news) in the OS keyring only. OpenRouter free models are rate limited: one model call per repair round.
- Tests run TS via type stripping: no parameter properties, no enums in tested files; use `.ts` import extensions.
- Secrets never in repo, logs, commits. Liquid OAuth `read` scope only.
- Git: push directly to `main`, no PRs. Commit ends with the Co-Authored-By line from the session. After every push run `scripts/install-local.sh` and restart the app for the user.

## 6. Current state
- Branch / last commit: main, everything committed and pushed (see git log)
- Working tree: clean
- Goal of current task: none

### Done (recent, newest first)
- [x] Strategy editor: size / stop loss / take profit bar always above the code (`setStrategyParams` in `ai/pine.ts`, no AI; mirrors the code, SL/TP disabled when the code has no such input); AI strip keeps Direction only. Pine engine: `.field` on a function result (e.g. `ta.supertrend(..).direction`) is now an error instead of silent na (it made exit conditions never fire -> a strategy with a single open trade). Tester shows a hint when a strategy never exits. Old builder-generated strategies in the user's data (`Supertrend.pine` ai3, `Golden Cross Strategy.pine` without exit) are NOT edited by Claude.
- [x] Buy & hold "invested time only" now = (1 + whole-period change)^(invested bars / total bars) - 1 (average per-bar growth applied over invested bars, `stats.ts`). Optimizer parameter table wrapper fits its content so the right border shows.
- [x] Optimizer: category winners ("Best win rate / profit / Lowest drawdown") are the absolute best visible value of their column (raw whole-history figures, with trade-count and profit guards); a point winning several categories carries all tags; scoring of the mixes stays recency weighted. Layout fixed (vertical stack, tables in scroll wrappers).
- [x] Code editor: `/ind` and `/strat` open with nothing selected; search bar; AI button left of Check opens an AI edit strip (`editIndicator`/`editStrategy`): strategy form prefilled from the code (`extractStrategyForm`), result goes into the editor (not saved), "Undo last AI edit".
- [x] Strategy Optimizer tab (`pine/optimizer.ts`, worker, `OptimizerPanel`, `oviate optimize`): pattern search with step doubling, 5 recency-weighted segments, 10 variants, Fast<Slow ordering kept, Apply puts a variant on the chart.
- [x] Fill at signal-bar close (tester default) instead of next bar open.
- [x] Multi-pane scripts (`pane=`), tester slippage in percent, red equity below start capital, buy & hold over invested time.
- [x] AI strategies (`/strat add ai`) and indicators (`/ind add ai`) via OpenRouter free models; visual builder removed.
- [x] `oviate` CLI + `/oviate` skill (list, show, check, add, data, backtest, optimize, guide, examples).
- [x] Strategy tester: last 20 trades as entry-exit boxes, detailed stats, red/purple equity line.
- [x] Chart: right-click menu "Reset chart" (Alt+R, `/reset chart`), wheel/drag navigation, 17 drawing tools, app zoom, logo, launcher entry.

### In progress
- none

### Next steps
1. No active task. Ask the user what to build next.
2. Possible follow-ups the user has not asked for yet: optimizer out-of-sample check button, strategy panes for AI indicators of other kinds, more bundled strategies.

### Open questions / blockers
- OpenRouter free models are the quality limit of the AI features; `CODE_MODELS` in `src-tauri/src/ai.rs` can be changed to a stronger model.
- Visual checks of the real Tauri window are only done by the user (browser-mode screenshots were used in development).

## 7. Decisions log
- 2026-10-18 - project-resume.md created; global CLAUDE.md rule added to keep it updated.
- 2026-10-18 - Ctrl+wheel zoom blocks at first axis limit; price max span = 4x whole-data range, bar width 1.2..80 px.
- 2026-10-18 - Dialog animations removed entirely instead of tuned (flash suspected from animated fixed layers in WebKitGTK).
- 2026-10-21 - Visual builder dropped in favor of AI text strategies (conditions were too rigid); CLI + skill added so Claude can build and backtest scripts outside the app.
- 2026-10-21 - Tester fills at the signal-bar close by default (entries looked one bar late vs the cross); slippage is percent of price because ticks need a per-symbol tick size the app does not have.
- 2026-10-21 - Optimizer category winners use the visible raw figures, not the recency weighted ones, so "best" is never beaten by another row.

## 8. Resume prompt
> Read project-resume.md in this project fully. Read every file it lists under "Must read before any change". Then continue from "Current state". Do not change anything before you have understood the project. Keep project-resume.md updated.
