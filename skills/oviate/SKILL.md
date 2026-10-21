---
name: oviate
description: Build, check, install and backtest Pine Script indicators and strategies for the Oviate charting app with the `oviate` CLI, on the real candle data Oviate has cached. Use when the user asks to create, write, improve or test an Oviate indicator or strategy, to backtest a strategy on a symbol/timeframe, to add a script to Oviate, or says "/oviate", even without naming the CLI.
---

# Oviate CLI

`oviate` is a command line tool next to the Oviate desktop app (`/home/mateo/Oviate`). It shares the app's Pine engine, so a script that passes here behaves the same in the app. If `oviate` is not on PATH use `node --disable-warning=ExperimentalWarning /home/mateo/Oviate/cli/oviate.ts`.

## Commands

| Command | Use |
|---|---|
| `oviate guide` | Pine dialect and backtester rules (what the engine supports, how orders fill). Read it before writing code. |
| `oviate examples` | Two complete, valid reference strategies. |
| `oviate data` | Cached candles: symbol, timeframe, bars, date range. Backtests run only on these. |
| `oviate list [indicators\|strategies]` | Scripts already in the app. |
| `oviate show <kind> <name>` | Print a script's source. |
| `oviate check <file\|-> [--strict]` | Compile and run. Prints kind, inputs, plots, hints. `--strict` exits 1 on scale/flat/na hints. |
| `oviate add <indicator\|strategy> <file\|-> [--name N] [--force]` | Validate, then install into the app. Never overwrites without `--force`. |
| `oviate backtest <name\|file\|-> --symbol S --tf TF [...]` | Backtest on cached candles. |

`backtest` options: `--from/--to 2023-01-01`, `--capital 10000`, `--commission 0.05` (percent per fill), `--slippage 0` (ticks), `--param "Input title=value"` (repeatable, title is the `input.*` title), `--trades 10`, `--json`. The position size comes from the strategy's `strategy()` declaration (`default_qty_type/value`), not from flags. Add `--json` when you want to process the numbers.

## Workflow

1. Understand the request. Run `oviate guide` (once per session) and `oviate list` / `oviate data` to see what exists.
2. Write the script to a temp file (or pipe it with `-`). Pine v6. Indicators: `indicator(...)`; strategies: `strategy(...)`.
3. `oviate check file.pine --strict` and fix every error and hint.
4. Strategies: `oviate backtest file.pine --symbol <S> --tf <TF>` on one or two cached series. Judge trades, win rate, profit factor, drawdown, Sharpe, long vs short, and compare with buy and hold. Zero trades or one huge trade means the logic is wrong. Vary `--param` values to test robustness instead of curve-fitting one setting; use `--from/--to` for an out-of-sample check.
5. `oviate add strategy file.pine` (or `indicator`). Tell the user it appears in Oviate after the window is focused: add with `/ind add` or `/strat add`.

## Rules

- Backtests are not predictions. Report numbers honestly, including bad ones, and name the weaknesses (few trades, one regime, huge drawdown). No investment advice.
- Only data Oviate cached is available. If a symbol or timeframe is missing, tell the user to open it once in Oviate. Do not invent data.
- Do not overwrite or delete the user's scripts: use a new `--name`, use `--force` only when the user asked to replace that script.
- Orders fill at the next bar's open; position size, capital, commission and slippage are not part of the script logic. Strategy `overlay=true` only for price-scaled plots; oscillator strategies use `overlay=false`.
