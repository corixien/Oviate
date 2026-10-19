# Project Resume

> Instruction for Claude: read this whole file first. Then read every file under "Must read before any change". Do not modify anything until you have fully understood the project. Keep this file updated as you work (see "Maintenance rules" in the resume-writer skill).

Last updated: 2026-10-18 (navigation, tools, logos)

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
- Branch / last commit: main, `c15630d` (all work below is uncommitted)
- Working tree: modified `renderer.ts`, `Chart.svelte`, `LeftBar`, `Icons`, `Spotlight`, `OrderDialog`, `AccountDialog`, `IndicatorDialog`, `Settings`, `app.svelte.ts`, `+page.svelte`, `capabilities/default.json`; new `logos/`, `project-resume.md`
- Goal of current task: chart navigation, app zoom, dialog polish, more drawing tools, logo concepts.

### Done
- [x] Wheel navigation in `renderer.ts` (eased via rAF target `tgt`): scroll = time, Shift+scroll = price, Ctrl+scroll = zoom both axes, stops when either axis hits its limit (`BAR_MIN/BAR_MAX`, `spanLimits()` = 4x data range)
- [x] Empty area left/right of data viewable (`clampStartV`), time ticks and crosshair extend into it, history prefetch earlier (`checkHistory`)
- [x] App zoom Ctrl +/-/0 (`app.zoomBy/setZoom`, Tauri webview zoom, perm `core:webview:allow-set-webview-zoom`), commands `/zoom`; Chart key handler ignores Ctrl combos
- [x] Dialog flash fix attempt: removed all fade/pop animations on Spotlight/Order/Account/Indicator/Settings dialogs (WebKitGTK compositing suspected, not verified visually)
- [x] All dialogs share one outline (`1px glass-line` + faint purple ring), no glow
- [x] 17 new drawing tools (extline, hray, crossline, channel, pitchfork, ellipse, circle, triangle, fibext, longpos, shortpos, pricerange, daterange, brush, arrowup, arrowdown, callout); toolbar grouped (`DRAW_GROUPS`)
- [x] Text/callout tools: bordered box, inline contenteditable editor in `Chart.svelte` (click to edit, Enter commit, Shift+Enter newline, Esc cancel, empty = delete)
- [x] Hold-and-drag pan rewritten: `applyPan()` runs once per frame in `draw()` from latest cursor pos, 1:1 whole-pixel shift on both axes; auto price range eases (`autoSm`) instead of jumping; Chart.svelte defers live ticks, polling and Pine reruns while `r.dragging`; auto price range fits last 30+ bars when view is mostly empty
- [x] Right scroll limit: hard stop at newest candle + `RIGHT_PAD` (10) empty bars (`clampStartV`, resetView, scrollToEnd)
- [x] Logo adopted: breakout concept without background, icons/favicon/README updated
- [x] 10 logo concepts in `logos/` (SVG + `index.html` gallery)

### In progress
- none

### Next steps
1. Logo chosen (breakout, transparent): `logos/oviate-logo.svg`; app icons regenerated via `npx tauri icon`, favicon and README header set. Other concepts stay in `logos/` for reference.
2. User tests in `npm run tauri dev`: wheel feel, dialog flash, text editor, new tools. Tune `wheelTime` (0.6), zoom speed (0.003), easing (65 ms) if needed.
3. Always commit `project-resume.md` together with other changes and push to main when asked.

### Open questions / blockers
- Dialog flash cause unverified (only GUI can confirm).
- none

## 7. Decisions log
- 2026-10-18 - project-resume.md created; global CLAUDE.md rule added to keep it updated.
- 2026-10-18 - Ctrl+wheel zoom blocks at first axis limit; price max span = 4x whole-data range, bar width 1.2..80 px.
- 2026-10-18 - Dialog animations removed entirely instead of tuned (flash suspected from animated fixed layers in WebKitGTK).

## 8. Resume prompt
> Read project-resume.md in this project fully. Read every file it lists under "Must read before any change". Then continue from "Current state". Do not change anything before you have understood the project. Keep project-resume.md updated.
