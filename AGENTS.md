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
- `src/lib/chart/`: renderer, chart component, data transforms. `src/lib/pine/`: parser, interp, natives, ta, strategy, worker. `src/lib/paper/`: engine (pure, tested) and store. `src/lib/ai/pine.ts`: AI prompts, checks, repair loop (pure, tested); `cli/oviate.ts`: the `oviate` CLI (Node, node:sqlite on the app's `oviate.db`, same engine; `cli/oviate.test.ts`); `skills/oviate/SKILL.md`: the `/oviate` Claude skill (copied to `~/.claude/skills` by `scripts/install-local.sh`). Keep the CLI help and the skill in sync when commands change; `src/lib/pine/stats.ts`: detailed strategy statistics (pure, tested). `src/lib/ui/`: panels, dialogs, pages (news, script editor). `src/lib/app.svelte.ts`: global app state (persisted in the SQLite `kv` table).
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
- Scripts added from outside the app (CLI) appear when the window gets focus (`library.load()` on `focus`).
- AI code generation: Rust `ai_complete` command (OpenRouter free models, `ai::CODE_MODELS` fallback chain, key `openrouter_key` in keyring; Groq stays for news summaries only) is a plain chat call; prompts, repair loop and validation live in `src/lib/builder/ai.ts` (pure, tested with a mock completer). Builder conditions are indicator + parameters + a sentence in plain words (AI by default; old fixed scenarios stay for legacy specs); unwritten AI conditions are generated on Save. AI builder conditions store `Cond.ai {text, code}`; code uses `IND0..` placeholders for the subject's outputs and is emitted as an `aiN()` function in the generated Pine.
- AI pipeline (`src/lib/ai/pine.ts`, pure, tested with a mock completer): `genIndicator` and `genStrategy` = system prompt (v6 rules, from `Syspromptvorschlag.md`; strategy prompt explains next-bar fills, strategy.exit, one-time indicator computation, two verified reference strategies) + similar scripts as few-shot -> run-time checks (`sanity` for indicators, `strategyCheck` on `STRAT_SAMPLE` for strategies: errors, never trades, wrong direction, missing SL/TP exit, scale) -> up to 4 repair rounds with the error fed back. The position size of the form is forced into `strategy()` by `setPositionSize`, never trusted to the model. One model call per round (free models are rate limited: Rust retries 429, then falls to the next model). Extend checks/prompts there, not in the UI.
- Paper trading commission is charged per fill (buy and sell each), as percent of trade value.
- Tests: Node runs TypeScript by type stripping, so test-covered files must avoid parameter properties and enums, and use `.ts` import extensions.

## Secrets
Alpaca, Finnhub, NewsAPI, Groq keys and Liquid tokens live in the OS keyring only. Never in repo, logs, commits, `.env.example` values. Liquid OAuth requests the `read` scope only, never `trade`. Paper trading only, no live orders.

## Local install (always)
The newest version of Oviate must always be installed on the user's computer. Right after every push to `main`, run `scripts/install-local.sh` (about 4 min, run it in the background) so the app-menu entry launches the new build, then tell the user to restart Oviate. Also do it whenever the user says the installed app lacks a feature.

## Git
Push directly to `main`. No PRs unless asked. Commit `project-resume.md` with every change. If `git push` fails with an invalid token, push once with `git -c credential.helper= -c "credential.helper=!gh auth git-credential" push origin main`. Commit messages end with the Co-Authored-By line from the session.
