// Detailed strategy performance statistics (pure, shared by the Strategy Tester panel).
import type { StrategyResult, TradeRec } from './types.ts';

export interface SideStats { trades: number; wins: number; winRate: number; net: number; grossProfit: number; grossLoss: number; profitFactor: number; avg: number; best: number; worst: number }

export interface DetailedStats {
  initial: number; equity: number; netProfit: number; returnPct: number; openPnl: number;
  grossProfit: number; grossLoss: number; profitFactor: number; commission: number;
  trades: number; wins: number; losses: number; even: number; winRate: number;
  avgTrade: number; avgTradePct: number; avgWin: number; avgLoss: number; payoff: number; expectancy: number;
  best: number; worst: number; bestPct: number; worstPct: number;
  maxWinStreak: number; maxLossStreak: number; curStreak: number;
  avgBars: number; avgBarsWin: number; avgBarsLoss: number; exposurePct: number;
  maxDrawdown: number; maxDrawdownPct: number; maxRunup: number; recovery: number; calmar: number; ulcer: number;
  sharpe: number; sortino: number;
  avgMfe: number; avgMae: number;
  /** underlying price change over the whole tested period, percent */
  buyHold: number;
  /** compounded underlying price change over only the time the strategy was invested (entry to exit of every trade), percent */
  buyHoldInvested: number;
  long: SideStats; short: SideStats;
  /** drawdown from the running peak per bar, in percent (<= 0) */
  drawdown: number[];
}

export interface StatsOpts { stepSec: number; firstClose: number; lastClose: number }

const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
const mean = (a: number[]) => (a.length ? sum(a) / a.length : 0);

function side(ts: TradeRec[]): SideStats {
  const wins = ts.filter((t) => t.pnl > 0), losses = ts.filter((t) => t.pnl < 0);
  const gp = sum(wins.map((t) => t.pnl)), gl = -sum(losses.map((t) => t.pnl));
  return {
    trades: ts.length, wins: wins.length, winRate: ts.length ? (wins.length / ts.length) * 100 : 0, net: gp - gl, grossProfit: gp, grossLoss: gl,
    profitFactor: gl > 0 ? gp / gl : gp > 0 ? Infinity : 0, avg: ts.length ? (gp - gl) / ts.length : 0,
    best: ts.length ? Math.max(...ts.map((t) => t.pnl)) : 0, worst: ts.length ? Math.min(...ts.map((t) => t.pnl)) : 0,
  };
}

/** Price change of the underlying while the strategy held a position: every trade's raw entry to exit move (no slippage), compounded; overlapping trades count once. */
function investedMove(trades: TradeRec[]): number {
  const spans = trades.map((t) => ({ a: t.entryBar, b: t.open ? Infinity : t.exitBar, p0: t.entryRaw ?? t.entryPrice, p1: t.open ? t.exitPrice : t.exitRaw ?? t.exitPrice }))
    .filter((s) => s.p0 > 0).sort((x, y) => x.a - y.a);
  let growth = 1, lastEnd = -1;
  for (const s of spans) {
    if (s.a <= lastEnd) continue; // pyramided or overlapping lot: the market was already counted
    growth *= s.p1 / s.p0;
    lastEnd = s.b;
  }
  return (growth - 1) * 100;
}

export function detailedStats(res: StrategyResult, o: StatsOpts): DetailedStats {
  const closed = res.trades.filter((t) => !t.open);
  const open = res.trades.filter((t) => t.open);
  const eq = Array.from(res.equity).filter((v) => Number.isFinite(v));
  const initial = res.initialCapital;
  const last = eq.length ? eq[eq.length - 1] : initial;
  const wins = closed.filter((t) => t.pnl > 0), losses = closed.filter((t) => t.pnl < 0);
  const gp = sum(wins.map((t) => t.pnl)), gl = -sum(losses.map((t) => t.pnl));
  const net = gp - gl;
  const pct = (t: TradeRec) => (t.entryPrice * t.qty ? (t.pnl / (t.entryPrice * t.qty)) * 100 : 0);

  // streaks
  let maxW = 0, maxL = 0, w = 0, l = 0;
  for (const t of closed) {
    if (t.pnl > 0) { w++; l = 0; } else if (t.pnl < 0) { l++; w = 0; } else { w = 0; l = 0; }
    maxW = Math.max(maxW, w); maxL = Math.max(maxL, l);
  }
  const cur = w > 0 ? w : l > 0 ? -l : 0;

  // equity curve: drawdown, run-up, returns
  let peak = initial, ddAbs = 0, ddPct = 0, trough = initial, runup = 0, sq = 0;
  const drawdown: number[] = [];
  const rets: number[] = [];
  for (let i = 0; i < eq.length; i++) {
    const v = eq[i];
    peak = Math.max(peak, v);
    const d = peak - v, dp = peak > 0 ? (d / peak) * 100 : 0;
    ddAbs = Math.max(ddAbs, d); ddPct = Math.max(ddPct, dp); sq += dp * dp;
    drawdown.push(-dp);
    trough = Math.min(trough, v); runup = Math.max(runup, v - trough);
    if (i > 0 && eq[i - 1] > 0) rets.push(v / eq[i - 1] - 1);
  }
  const perYear = o.stepSec > 0 ? (365 * 86400) / o.stepSec : 252;
  const m = mean(rets);
  const sd = Math.sqrt(mean(rets.map((r) => (r - m) ** 2)));
  const dsd = Math.sqrt(mean(rets.map((r) => Math.min(0, r) ** 2)));
  const years = eq.length / perYear;
  const cagr = years > 0 && initial > 0 && last > 0 ? (Math.pow(last / initial, 1 / years) - 1) * 100 : 0;

  // time in market
  const bars = res.equity.length;
  const inMarket = new Uint8Array(bars);
  for (const t of res.trades) for (let b = Math.max(0, t.entryBar); b <= (t.open ? bars - 1 : Math.min(bars - 1, t.exitBar)); b++) inMarket[b] = 1;
  const held = (t: TradeRec) => Math.max(0, (t.open ? bars - 1 : t.exitBar) - t.entryBar);

  return {
    initial, equity: last, netProfit: net, returnPct: initial ? ((last - initial) / initial) * 100 : 0, openPnl: sum(open.map((t) => t.pnl)),
    grossProfit: gp, grossLoss: gl, profitFactor: gl > 0 ? gp / gl : gp > 0 ? Infinity : 0, commission: sum(res.trades.map((t) => t.commission)),
    trades: closed.length, wins: wins.length, losses: losses.length, even: closed.length - wins.length - losses.length, winRate: closed.length ? (wins.length / closed.length) * 100 : 0,
    avgTrade: closed.length ? net / closed.length : 0, avgTradePct: mean(closed.map(pct)),
    avgWin: wins.length ? gp / wins.length : 0, avgLoss: losses.length ? -gl / losses.length : 0,
    payoff: losses.length && wins.length ? gp / wins.length / (gl / losses.length) : 0,
    expectancy: closed.length ? (wins.length / closed.length) * (wins.length ? gp / wins.length : 0) - (losses.length / closed.length) * (losses.length ? gl / losses.length : 0) : 0,
    best: closed.length ? Math.max(...closed.map((t) => t.pnl)) : 0, worst: closed.length ? Math.min(...closed.map((t) => t.pnl)) : 0,
    bestPct: closed.length ? Math.max(...closed.map(pct)) : 0, worstPct: closed.length ? Math.min(...closed.map(pct)) : 0,
    maxWinStreak: maxW, maxLossStreak: maxL, curStreak: cur,
    avgBars: mean(closed.map(held)), avgBarsWin: mean(wins.map(held)), avgBarsLoss: mean(losses.map(held)),
    exposurePct: bars ? (inMarket.reduce((s, v) => s + v, 0) / bars) * 100 : 0,
    maxDrawdown: ddAbs, maxDrawdownPct: ddPct, maxRunup: runup, recovery: ddAbs > 0 ? net / ddAbs : 0, calmar: ddPct > 0 ? cagr / ddPct : 0,
    ulcer: eq.length ? Math.sqrt(sq / eq.length) : 0,
    sharpe: sd > 0 ? (m / sd) * Math.sqrt(perYear) : 0, sortino: dsd > 0 ? (m / dsd) * Math.sqrt(perYear) : 0,
    avgMfe: mean(closed.map((t) => t.mfe)), avgMae: mean(closed.map((t) => t.mae)),
    buyHold: o.firstClose > 0 ? ((o.lastClose - o.firstClose) / o.firstClose) * 100 : 0,
    buyHoldInvested: investedMove(res.trades),
    long: side(closed.filter((t) => t.dir === 'long')), short: side(closed.filter((t) => t.dir === 'short')),
    drawdown,
  };
}
