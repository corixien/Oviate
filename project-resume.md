# Project Resume

> Instruction for Claude: read this whole file first. Then read every file under "Must read before any change". Do not modify anything until you have fully understood the project. Keep this file updated as you work (see "Maintenance rules" in the resume-writer skill).

Last updated: 2026-10-19 (strategy builder)

## 1. What this project is
Oviate (Optimal Visions Inspire Accurate Trade Entries): keyboard-first desktop charting tool, TradingView alternative. Black/purple UI. Linux first, portable design (Rust core separate from UI). Tauri 2 + Rust core + Svelte 5/SvelteKit SPA (adapter-static) + TypeScript, custom Canvas2D renderer, Pine Script v5/v6 subset engine in TypeScript (Web Worker). MIT. Paper trading only, no live orders.

## 2. Must read before any change
1. `AGENTS.md` - rules, layout, design constraints, secrets policy
2. `README.md` - features, config, dev commands
3. `src/lib/app.svelte.ts` - global app state, persisted in SQLite `kv` table
4. `src-tauri/src/lib.rs` - all Tauri commands (UI to core boundary)
5. `src/lib/chart/Chart.svelte` + `renderer.ts` - chart rendering
6. `src/lib/pine/interp.ts`, `strategy.ts` - Pine engine and strategy broker
7. `src/lib/paper/engine.ts` - pure paper trading engine

## 3. How to navigate
- `src-tauri/src/`: `lib.rs` commands, `main.rs` (AT-SPI disable workaround), `providers/` (alpaca, yahoo; mod declared via lib.rs), `model.rs` types, `cache.rs` SQLite (candles, news, AI summaries, kv), `stream.rs` Alpaca WebSocket, `news.rs` news providers, `mcp.rs` OAuth + MCP client for Liquid, `ai.rs` Groq summaries, `pine_files.rs` user `.pine` file storage.
- `src/lib/chart/`: `Chart.svelte`, `renderer.ts`, `data.ts`, `transforms.ts` (Heikin-Ashi, Renko etc.), `indicators.ts`.
- `src/lib/pine/`: `parser.ts`, `interp.ts`, `natives.ts`, `ta.ts`, `strategy.ts`, `runner.ts`, `worker.ts`, `describe.ts`, `types.ts`; tests `*.test.ts`.
- `src/lib/paper/`: `engine.ts` (pure, tested), `paper.svelte.ts` (store).
- `src/lib/ui/`: panels, dialogs, pages (`NewsPage`, `ScriptEditor`, `PaperPanel`, `OrderDialog`, `AccountDialog`, `Settings`, `Select`, `Analysis`, `LeftBar`, `IndicatorDialog`, `Icons`).
- Other: `logos/` (logo concepts), `src/lib/api.ts` (invoke wrappers), `i18n.ts` (EN/DE), `library.svelte.ts` (script library).
- `indicators/*.pine`: 94 bundled indicators, seeded into `<app data>/indicators` on first start (deleted one stays deleted). `strategies/` ships empty.
- Flow: UI sends Tauri commands -> Rust fetches (Alpaca, Yahoo fallback), caches in SQLite, streams live via WebSocket -> UI renders; Pine runs in worker.
- Entry points: `src-tauri/src/main.rs`, `src/routes` (SvelteKit SPA).

## 4. Commands (run from repo root)
- `npm install`; `npm run tauri dev` run app; `npm run tauri build` bundle
- `npm run check` svelte-check (read whole output, errors print as `ERROR`)
- `npm test` node --test (pine + paper) then `cargo test`
- Requires Node 22.18+, Rust stable, Tauri Linux deps (webkit2gtk-4.1, libsoup3, gtk3, openssl)
- CI: `.github/workflows/ci.yml`

## 5. Invariants and gotchas
- Rust core owns providers, caches, news, keyring, file storage. UI only renders and sends commands. Keep core free of Tauri types where possible.
- Every action reachable via keyboard / command bar (`Enter`, `/commands`).
- Design: black, hard purple accents, 2px corners, no blur/backdrop-filter (WebKitGTK crash), no native `<select>` (use `ui/Select.svelte`), no number spinners.
- Keep AT-SPI bridge disable in `src-tauri/src/main.rs` (WebKitGTK crash workaround).
- Pine: `request.security` passthrough; label/line/box accepted but not rendered.
- Paper commission charged per fill (buy and sell each), percent of trade value.
- Tests run TS via type stripping: no parameter properties, no enums in tested files; use `.ts` import extensions.
- Secrets (Alpaca, Finnhub, NewsAPI, Groq, Liquid tokens) only in OS keyring. Never in repo, logs, commits. Liquid OAuth `read` scope only, never `trade`.
- Git: push directly to `main`, no PRs unless asked. Commit ends with Co-Authored-By line from session.

## 6. Current state
- Branch / last commit: main, everything committed and pushed
- Working tree: clean
- Goal of current task: none (visual strategy builder + detailed tester finished and pushed).

### Done
- [x] Visual strategy builder (`src/lib/ui/StrategyBuilder.svelte`, `src/lib/builder/model.ts`): 4 event blocks (long/short entry/exit), nestable ALL/ANY condition groups, 19 catalog indicators + price/value operands, comparators (cross, above/below, between, equals, rising/falling), SL/TP %. Generates Pine with spec JSON in a `// @oviate-builder` header; reopened via `parseSpec`. Command bar: `/strat add new builder`, `/strat edit builder`; "Visual builder" button in script editor; `app.editScript`, `app.addStrategy` (adds oscillator companion panes)
- [x] AI: `/ind ai` dialog (`AiIndicatorDialog.svelte`) and builder condition choice "Describe in words (AI)" via Groq (`ai_complete` in lib.rs, `builder/ai.ts`); top bar Strategies button opens `/strat add`. Untested against live Groq (no key in dev session) and not visually checked (browser tool unavailable)
- [x] Per-indicator scenarios in the builder (`SCENARIOS`/`PRICE_SC`/`GENERIC`, `scenariosFor`, `scenarioCond`; Cond.cmp is a scenario id, rhs/rhs2 = scenario args; old generic ids still resolve). Chart right-click menu "Reset chart" (`app.resetChart`, `/reset chart`, Alt+R; `resetView` also clears `autoSm`)
- [x] Position size (% account / cash / units) lives in the builder spec and the .pine file. Tester settings (`app.tester`, Settings tab): capital, commission %, slippage ticks; simulation only. Open builder with `/visual builder` (top bar button removed) (not in .pine, drawings use raw prices). Builder UI simplified (x in card corner, sub-group, help text), builder reachable via top bar "Strategies" and legend block button; draft kept when leaving the page
- [x] Strategy tester: last 20 trades drawn as entry-exit boxes (`TradeBox`, `drawBoxes` in renderer, `BOX_TRADES` in Chart.svelte), older trades stay arrows; detailed stats (`pine/stats.ts`: Sharpe/Sortino/Calmar, streaks, exposure, long vs short, drawdown curve) in `PaperPanel.svelte`
- [x] Wheel navigation in `renderer.ts` (eased via rAF target `tgt`): scroll = time, Shift+scroll = stretch/squeeze price axis around its centre (like dragging the price axis), Ctrl+scroll = zoom both axes, stops when either axis hits its limit (`BAR_MIN/BAR_MAX`, `spanLimits()` = 4x data range)
- [x] Empty area left/right of data viewable (`clampStartV`), time ticks and crosshair extend into it, history prefetch earlier (`checkHistory`)
- [x] App zoom Ctrl +/-/0 (`app.zoomBy/setZoom`, Tauri webview zoom, perm `core:webview:allow-set-webview-zoom`), commands `/zoom`; Chart key handler ignores Ctrl combos
- [x] Dialog flash fix attempt: removed all fade/pop animations on Spotlight/Order/Account/Indicator/Settings dialogs (WebKitGTK compositing suspected, not verified visually)
- [x] All dialogs share one outline (`1px glass-line` + faint purple ring), no glow
- [x] 17 new drawing tools (extline, hray, crossline, channel, pitchfork, ellipse, circle, triangle, fibext, longpos, shortpos, pricerange, daterange, brush, arrowup, arrowdown, callout); toolbar grouped (`DRAW_GROUPS`)
- [x] Text/callout tools: bordered box, inline contenteditable editor in `Chart.svelte` (click to edit, Enter commit, Shift+Enter newline, Esc cancel, empty = delete)
- [x] Hold-and-drag pan rewritten: `applyPan()` runs once per frame in `draw()` from latest cursor pos, 1:1 whole-pixel shift on both axes; auto price range eases (`autoSm`) instead of jumping; Chart.svelte defers live ticks, polling and Pine reruns while `r.dragging`; auto price range fits last 30+ bars when view is mostly empty
- [x] Right scroll limit: hard stop at newest candle + `RIGHT_PAD` (10) empty bars (`clampStartV`, resetView, scrollToEnd)
- [x] App-menu entry `~/.local/share/applications/oviate.desktop` -> `src-tauri/target/release/oviate` (release build, no bundle)
- [x] Logo adopted: breakout concept without background, icons/favicon/README updated
- [x] 10 logo concepts in `logos/` (SVG + `index.html` gallery)

### In progress
- none

### Next steps
1. No active task. Ask the user what to build next.
2. Local install rule: after every push to main run `scripts/install-local.sh` (rebuilds the release binary the menu entry launches), then user restarts the app. Builder untested in real Tauri app until user confirms.
3. After code changes the app-menu entry needs a rebuild: `npm run tauri build -- --no-bundle` (about 4 min), then restart the app.
4. Always commit `project-resume.md` with other changes; push to main only when asked.

### Open questions / blockers
- none

## 7. Decisions log
- 2026-10-18 - project-resume.md created; global CLAUDE.md rule added to keep it updated.
- 2026-10-18 - Ctrl+wheel zoom blocks at first axis limit; price max span = 4x whole-data range, bar width 1.2..80 px.
- 2026-10-18 - Dialog animations removed entirely instead of tuned (flash suspected from animated fixed layers in WebKitGTK).

- 2026-10-19 - Builder strategies = generated Pine + header spec (no new storage kind); oscillators shown via bundled indicators as companions, since one script has one overlay setting.

## 8. Resume prompt
> Read project-resume.md in this project fully. Read every file it lists under "Must read before any change". Then continue from "Current state". Do not change anything before you have understood the project. Keep project-resume.md updated.
