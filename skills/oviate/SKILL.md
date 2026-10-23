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
| `oviate optimize <name\|file\|-> --symbol S --tf TF [...]` | Find good parameters: 10 ranked variants. |

`backtest` options: `--from/--to 2023-01-01`, `--capital 10000`, `--commission 0.05` (percent per fill), `--slippage 0.1` (percent of price per fill, default 0.1), `--fill close|next-open` (default `close`: market orders fill at the close of the bar that signalled, i.e. where a cross is confirmed; `next-open` is the stricter next-bar-open fill), `--param "Input title=value"` (repeatable, title is the `input.*` title), `--trades 10`, `--json`. The position size comes from the strategy's `strategy()` declaration (`default_qty_type/value`), not from flags. Add `--json` when you want to process the numbers.

## Workflow

1. Understand the request. Run `oviate guide` (once per session) and `oviate list` / `oviate data` to see what exists.
2. Write the script to a temp file (or pipe it with `-`). Pine v6. Indicators: `indicator(...)`; strategies: `strategy(...)`.
3. `oviate check file.pine --strict` and fix every error and hint.
4. Strategies: `oviate backtest file.pine --symbol <S> --tf <TF>` on one or two cached series. Judge trades, win rate, profit factor, drawdown, Sharpe, long vs short, and compare with buy and hold. Zero trades or one huge trade means the logic is wrong. Vary `--param` values to test robustness instead of curve-fitting one setting; use `--from/--to` for an out-of-sample check.
5. Tune it: `oviate optimize file.pine --symbol <S> --tf <TF>` (see below), then verify the chosen variant with `oviate backtest ... --param ...` on a DIFFERENT period (`--from/--to`) than the one it was optimized on.
6. `oviate add strategy file.pine` (or `indicator`). Tell the user it appears in Oviate after the window is focused: add with `/ind add` or `/strat add`.

## Optimizer

`oviate optimize <strategy> --symbol AAPL --tf 1d [--budget 600] [--only "Fast EMA,Slow EMA"] [--range "Fast EMA=5:50:1"]... [--param "Input=value"]... [--json]`

- Tunes the strategy's numeric `input.int` / `input.float` inputs (default 0 = "off" inputs are skipped). Ranges come from `minval/maxval/step` of the input, else around the default; override with `--range "Title=min:max[:step]"`, restrict with `--only`. Inputs that look like pairs (Fast/Slow, Short/Long, Min/Max) keep their order.
- Search: pattern search on the parameter grid. A step that improves is repeated with double size, a step that does not improve is not extended; steps shrink to one grid step. Several objectives (balanced, win rate, profit, drawdown) and start points share one cache of tests (`--budget` = number of backtests, default 600; a 2500-bar run takes a few seconds).
- Scoring: the whole cached history (use `--from/--to` to limit) is cut into 5 parts, newer parts weigh up to 6.5x more. Win rate matters most (shrunk toward 50% for few trades), then profit, then drawdown. Too few trades scales the score down. Variants also look at their neighbours (plateau beats spike).
- Output: 10 ranked variants: 3 best of one category (win rate, profit, lowest drawdown) and 7 mixes (Balanced, Win-rate focus, Profit focus, Safety first, Recent market, Consistent, Robust plateau), each with win rate, return, max drawdown, trades, last-fifth return, score and the `--param` flags to reproduce it. The three category variants are the best value of their column among points with enough trades (a point that wins several categories carries all tags, e.g. "Best win rate + Best profit"); the 7 mixes are scored with the recency weighting. The app has the same optimizer in the Strategy Tester's "Optimizer" tab (Apply puts a variant on the chart).
- Judge honestly: the result is fitted to past data. Prefer variants that sit on a plateau, have enough trades, and also hold in a period the optimizer did not see (`--from/--to`). Report win rate AND return AND drawdown, not just the best number, and name the overfitting risk. Not investment advice.

## Builder strategies

Strategies made with the app's visual builder (`/visual`) read library indicators through the Oviate extension `oviate.ind("indicator file name", "Plot title", "Input title=value;Other=value")`, which returns that plot's value on the current bar (not valid TradingView Pine). You can write it too: `r = oviate.ind("rsi", "RSI", "Length=" + str.tostring(len))`. Names come from `oviate list indicators`; plot titles from `oviate check <indicator file>`. `ta.crossover(r, 30)` etc. work on the result. The builder's model sits in an `// @oviate-builder {...}` comment; editing such a file by hand is fine, saving it again from the builder regenerates the code.

## Rules

- Backtests are not predictions. Report numbers honestly, including bad ones, and name the weaknesses (few trades, one regime, huge drawdown). No investment advice.
- Only data Oviate cached is available. If a symbol or timeframe is missing, tell the user to open it once in Oviate. Do not invent data.
- Do not overwrite or delete the user's scripts: use a new `--name`, use `--force` only when the user asked to replace that script.
- Orders fill at the next bar's open; position size, capital, commission and slippage are not part of the script logic. Strategy `overlay=true` only for price-scaled plots; oscillator strategies use `overlay=false`.
