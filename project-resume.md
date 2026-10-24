# Project Resume

> Instruction for Claude: read this whole file first. Then read every file under "Must read before any change". Do not modify anything until you have fully understood the project. Keep this file updated as you work (see "Maintenance rules" in the resume-writer skill).

Last updated: 2026-10-24 (economic calendar, advanced builder, direction mirroring, tester buy & hold lines, control heights)

## 1. What this project is
Oviate (Optimal Visions Inspire Accurate Trade Entries): keyboard-first desktop charting tool, TradingView alternative. Black/purple UI. Linux first, portable design (Rust core separate from UI). Tauri 2 + Rust core + Svelte 5/SvelteKit SPA (adapter-static) + TypeScript, custom Canvas2D renderer, Pine Script v5/v6 subset engine in TypeScript (Web Worker). MIT. Paper trading only, no live orders.

## 2. Must read before any change
1. `AGENTS.md` - rules, layout, design constraints, secrets policy, local-install rule (it also documents sync, replay, builder, editor settings in detail)
2. `README.md` - features, config, dev commands
3. `src/lib/app.svelte.ts` - global app state, persisted in SQLite `kv` table (`app.page`, `app.editor`, `app.replay`, calendar flags)
4. `src-tauri/src/lib.rs` - all Tauri commands (UI to core boundary)
5. `src/lib/chart/Chart.svelte` + `renderer.ts` - chart rendering, sync, replay, drawings, news / calendar markers
6. `src/lib/pine/interp.ts`, `strategy.ts`, `indlib.ts` - Pine engine, broker, `oviate.*` natives
7. `src/lib/ai/pine.ts` - AI prompts, checks, repair loop, algorithmic editor settings
8. `src/lib/builder/model.ts` - visual builder model, Pine generation
9. `src/lib/pine/optimizer.ts` - strategy optimizer

## 3. How to navigate
- `src-tauri/src/`: `lib.rs` commands (incl. `ai_complete`, `news_window`, `calendar_window`), `ai.rs` (Groq news summaries + OpenRouter code chat with 429 retry and `CODE_MODELS` fallback), `cache.rs` SQLite (candles, news, kv; file `oviate.db`), `calendar.rs` (economic calendar: Forex Factory weekly JSON + optional FMP), `stream.rs`, `news.rs`, `mcp.rs`, `pine_files.rs`, `providers/`.
- `src/lib/chart/`: `Chart.svelte`, `renderer.ts` (drawing, drawings incl. `arrowpath`, sync `live`/`chartSync`, news + calendar markers, replay pick), `candleStore.ts`, `data.ts`, `transforms.ts`, `indicators.ts`.
- `src/lib/pine/`: engine (`parser`, `interp` incl. natives `oviate.ind`, `oviate.hhmm/dow/date`, `natives`, `ta`, `strategy`), `indlib.ts` (library indicator registry for `oviate.ind`), `panes.ts`, `stats.ts` (tester statistics + `buyHoldCurves`), `optimizer.ts` + worker + runner, `runner.ts`, `worker.ts`, `describe.ts`, `types.ts`; tests `*.test.ts`.
- `src/lib/builder/`: `model.ts` (pure, tested: model, `toPine`, `parseModel`, `builderModelOf`, `checkModel`, `suggest`, `TEMPLATES`), `ai.ts` (`aiBuilder`, `aiBuilderFromCode`, `aiMirrorSide`, `mirrorSideLocal`), `info.ts` (IndInfo of library indicators).
- `src/lib/ai/pine.ts`: `genIndicator`, `genStrategy`, `editIndicator`, `editStrategy`, `extractStrategyForm`, `setPositionSize`, `setStrategyParams` (size + SL/TP, injects a block when absent), `setDirection` / `readDirection` / `codeSides`, `sanity`, `strategyCheck`, `STRAT_SAMPLE`.
- `src/lib/ui/`: `ScriptEditor` (code editor + visual builder view; name = script title; settings row + AI row), `BuilderPane` + `OperandPicker` (builder UI), `CalendarPage`, `PaperPanel` (tabs Paper Trading / Strategy Tester / Optimizer), `OptimizerPanel`, `AiDialog`, `AiStrategyFields`, `OrderDialog` (bracket legs accept %), `Spotlight` (command bar), `Settings`, `NewsPage`, `TopBar`, `LeftBar`, etc.
- `src/lib/optimizer.svelte.ts`, `src/lib/paper/`, `library.svelte.ts` (script library, reloads on window focus; `setIndicatorSource` for `oviate.ind`).
- `cli/oviate.ts` (+ wrapper, tests): the `oviate` CLI. `skills/oviate/SKILL.md`: the `/oviate` skill. `scripts/install-local.sh`: rebuild + install.
- `indicators/*.pine`: 94 bundled indicators, seeded into `<app data>/indicators`. `strategies/` ships empty. `Syspromptvorschlag.md`: base of the AI indicator system prompt.
- App data: `~/.local/share/dev.oviate.app/` (`indicators/`, `strategies/`, `oviate.db`).

## 4. Commands (run from repo root)
- `npm install`; `npm run tauri dev` run app; `npm run tauri build -- --no-bundle` release binary
- `npm run check` svelte-check (read whole output, errors print as `ERROR`)
- `npm test` node --test (pine, paper, ai, builder, cli) then `cargo test`
- `scripts/install-local.sh` after every push to main (about 4 min), then restart Oviate
- `oviate help` for the CLI
- Requires Node 22.18+ (type stripping, `node:sqlite`), Rust stable, Tauri Linux deps (webkit2gtk-4.1, libsoup3, gtk3, openssl)
- CI: `.github/workflows/ci.yml`
- Visual check without the app: `npm run dev -- --port 1420` (browser mode, synthetic data) + headless `google-chrome --remote-debugging-port` driven over CDP (a small node script with `WebSocket`: navigate, `Runtime.evaluate`, `Input.dispatchMouseEvent`, `Page.captureScreenshot`). Open the command bar with an `Enter` keydown on `window`, type `/visual` etc. Never `pkill -f vite` (matches the shell itself: use `pkill -f "[v]ite"`).

## 5. Invariants and gotchas
- Rust core owns providers, caches, news, calendar, keyring, file storage. UI only renders and sends commands. Keep core free of Tauri types where possible.
- Every action reachable via keyboard / command bar (`Enter`, `/commands`).
- Design: black, hard purple accents, 2px corners, no blur/backdrop-filter (WebKitGTK crash), no native `<select>` (use `ui/Select.svelte`), no number spinners. Form controls are 30px high (top bar 32px); keep rows of controls equal in height.
- Keep AT-SPI bridge disable in `src-tauri/src/main.rs`.
- Pine: `request.security` passthrough; label/line/box accepted but not rendered. Oviate extensions: `pane="Name"` on plot/hline, `oviate.ind(name, plot, "Input=value;...")`, `oviate.hhmm/dow/date(tz)`. `when=` on entries is used by the direction switches (v5 syntax).
- Strategy Tester settings (`app.tester`) override `strategy()` capital/commission/slippage/fill; position size stays in the strategy declaration. Paper-trading signals run with fillOnClose off.
- Editor settings (size, SL/TP, direction) are applied to the code algorithmically; only a side the code does not have yet is created by the AI (`extendCode` / `fillSide`, with an offline fallback in the builder).
- Chart sync: leader pushes view at the end of its draw; do not add reactive round trips. Effects must read reactive state before an early return (a `$effect` that returns before reading anything never re-runs).
- AI keys: OpenRouter (code) and Groq (news) and FMP (calendar, optional) in the OS keyring only. OpenRouter free models are rate limited: one model call per repair round.
- Tests run TS via type stripping: no parameter properties, no enums in tested files; use `.ts` import extensions.
- Secrets never in repo, logs, commits. Liquid OAuth `read` scope only.
- Git: push directly to `main`, no PRs. Commit ends with the Co-Authored-By line from the session. After every push run `scripts/install-local.sh` and restart the app for the user.

## 6. Current state
- Branch / last commit: main, everything committed and pushed (see git log)
- Working tree: clean
- Goal of current task: none

### Done (recent, newest first)
- [x] Wheel navigation: Ctrl zoom keeps the x / y ratio (joint factor), Ctrl+Shift zooms toward the first candle, Alt+scroll stretches time, plain scroll re-enables the auto price scale; tester equity line is fully red when the result is negative, else fully purple.
- [x] Tester equity view (lines + scale) remembered in `app.eqView`, buy & hold lines off by default. Note: with tiny trades the equity hugs the starting capital, so on the "All lines" scale it looks flat and its red / purple split (below / above start) flips along the baseline; that is correct, not a bug.
- [x] Calendar list anchored on the next upcoming event / the clicked chart event (ranges only ±7 and ±14 days); tester equity legend with final values, per-line toggles and an Equity / All lines scale switch (the buy & hold lines were invisible when far off the equity scale).
- [x] Chart calendar markers filtered by symbol region: bundled table of the 1500 largest US-listed stocks (country -> currencies), rules for pairs / crypto / indices / exchange suffixes, backend `symbol_regions` for unknown symbols (Nasdaq profile, else Groq, cached forever). A TSLA chart no longer shows GBP events.
- [x] Calendar polish: list opens at today (ranges: today, this week, next week, ±7, ±14 days), empty Actual/Forecast/Previous boxes removed (free feed has no actuals), Forex Factory 429 cooldown + FMP 402 block (user's FMP key has no calendar access: ignored for 24 h with a hint), bottom panel outlined like the panes, tester equity line back on its own scale with the faint buy & hold lines behind it.
- [x] Calendar rebuilt: one data flow in `calendar::window` (cache first, background refresh, dedup by id: duplicate ids had blanked the list), new page with list + detail pane, filters (type, impact, region, my symbols, search, range tabs), next-event countdown, surprise colouring, Groq reading per event (`calendar_summary`), chart markers for every macro event (declutter by importance, click opens the event); the show-on-chart settings are gone.
- [x] Markers: calendar and news tags are square, glow-free; overlapping markers collapse to the most important one when zoomed out. Calendar "Loading…" bug fixed (request timeouts, background flag guard, label only when the list is empty); chart asks for -7/+10 days only; latest news / events are re-checked every few minutes and on window focus (news TTL 5 min, NewsPage refresh).
- [x] Calendar (all markets): `/calendar` page + Calendar button next to News. Macro from Forex Factory (no key, 9 currencies) + optional FMP key (Settings); company events from Nasdaq (keyless): quarterly earnings with EPS estimate / last year / market cap, ex-dividends, splits, IPOs. Chart markers: macro by impact filter, company events only on their own symbol. Cached in `kv` per day; the command answers from the cache at once and fetches missing days in the background (`pending`, UI polls).
- [x] Strategy Tester equity chart: faint buy & hold and buy & hold invested-time-only lines (`buyHoldCurves` in `stats.ts`).
- [x] Visual builder advanced: time of day / weekday, session stats of a daily window (pre-market high/low), highest/lowest of N bars, position fields (entry price, bars in trade, profit %), "bars ago" and +-% on operands, between / at least / at most / equals, max entries per day, time zone, 5 templates (incl. pre-market and opening-range breakout). The pre-market high/low strategy is buildable (test in `model.test.ts`; needs intraday data that contains pre-market bars).
- [x] Direction dropdown without "As described": builder creates a missing side as the mirror of the other (AI, offline fallback), code strategies get the missing side from the AI; removing a side uses `allowLong`/`allowShort` switches. Size / SL / TP are written into the code directly.
- [x] Control heights unified (30px) in editor, builder, order dialog, news page, indicator dialog, tester inputs; top bar 32px.
- [x] Chart sync v3 (leader/follower, aligned last price lines, axis/reset/replay mirrored), shared replay (`app.replay`), borderless pane drag, resize flicker fix, `%` bracket legs.
- [x] Editor: Builder/Editor toggle swaps only the code area, always-visible settings + AI row, name = script title = file name (Save renames, charts follow), Save & add to chart, non-builder Pine read into the builder by the AI.
- [x] Earlier: visual builder v2 on the engine extension `oviate.ind`, replay mode, arrow path tool, far zoom-out, `scriptMeta` title fix, stats `buyHoldInvested` redefined, strategy params bar, optimizer fixes, AI edit in the editor, optimizer tab, tester fills at signal-bar close, multi-pane scripts, AI strategies/indicators, `oviate` CLI + skill, strategy tester boxes + detailed stats.

### In progress
- none

### Next steps
1. No active task. Ask the user what to build next.
2. Possible follow-ups not asked for yet: calendar events as strategy conditions (e.g. no trades 30 min around high-impact news), per-side stop loss / take profit in the builder settings row, optimizer out-of-sample check, more bundled strategies.

### Open questions / blockers
- Macro for other countries than the 9 currency areas, and actual values, need the FMP key; its free tier may not include the economic calendar endpoint (unverified). Nasdaq endpoints are unofficial and could change; failures show as a provider error on the calendar page. Next-week file is published late in the week (404 before that is normal).
- Pre-market strategies need candles that include extended hours; whether Alpaca / Yahoo return them for the chosen timeframe was not verified.
- OpenRouter free models are the quality limit of the AI features; `CODE_MODELS` in `src-tauri/src/ai.rs` can be changed.
- Visual checks of the real Tauri window are only done by the user (browser-mode screenshots were used in development).

## 7. Decisions log
- 2026-10-18 - project-resume.md created; global CLAUDE.md rule added to keep it updated.
- 2026-10-18 - Ctrl+wheel zoom blocks at first axis limit; later replaced: time and price clamp independently, `BAR_MIN` 0.03.
- 2026-10-18 - Dialog animations removed entirely (flash in WebKitGTK).
- 2026-10-21 - Visual builder dropped for AI text strategies, then brought back in v2 (indicator list based) on 2026-10-22.
- 2026-10-21 - Tester fills at the signal-bar close by default; slippage is percent of price.
- 2026-10-21 - Optimizer category winners use the visible raw figures.
- 2026-10-22 - Builder strategies read library indicators through `oviate.ind` (Oviate extension) so any indicator is usable and tunable; not valid on TradingView.
- 2026-10-23 - Chart sync is a leader/follower push inside the renderer, not reactive state.
- 2026-10-23 - Editor settings are algorithmic (no LLM) except creating a missing trade side.
- 2026-10-24 - Calendar: keyless Forex Factory (macro) + Nasdaq (earnings, dividends, splits, IPOs) as baseline, FMP key optional (Finnhub / Trading Economics economic calendars are paid).

## 8. Resume prompt
> Read project-resume.md in this project fully. Read every file it lists under "Must read before any change". Then continue from "Current state". Do not change anything before you have understood the project. Keep project-resume.md updated.
