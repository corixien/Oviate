// Strategy parameter optimizer (pure: shared by the app worker and the CLI).
//
// Search: pattern search on the parameter grid. A step that improves the score is repeated with a doubled step ("+1 was better, try +2, +4 ...");
// a step that does not improve is not extended ("+1 was worse, do not try +2"); when no parameter improves the steps are halved until they are one grid step.
// Several objectives (balanced, win rate, profit, drawdown) and several starting points are climbed over one shared cache of evaluated points.
//
// Scoring: the history is cut into SEGS equal parts and newer parts weigh more (RECENCY per part), so the long history guards against overfitting
// while recent market behaviour counts most. Win rate is shrunk towards 50% for few trades; too few trades scale the score down.
// The 10 variants come from the visited points: 3 best of one category (win rate, profit, drawdown) and 7 profiles in between, ranked by one balanced score
// that also looks at the neighbours of a point (a plateau beats a lone spike).
import { runPine } from './index.ts';
import type { PineCandles, PineInput, StrategyResult, TesterSettings } from './types.ts';

export interface ParamDef { id: string; title: string; type: 'int' | 'float'; def: number; min: number; max: number; step: number }

export const SEGS = 5;
export const RECENCY = 1.6;
const PRIOR = 6;

const NICE = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5];
const round = (v: number, step: number) => { const d = Math.max(0, Math.ceil(-Math.log10(step) - 1e-9) + 1); return Number(v.toFixed(Math.min(8, d))); };

/** Tunable numeric inputs of a strategy with a sensible search range: the script's minval/maxval/step where given, around the current value otherwise. */
export function paramSpace(inputs: PineInput[], current: Record<string, unknown> = {}): ParamDef[] {
  const out: ParamDef[] = [];
  for (const i of inputs) {
    if (i.type !== 'int' && i.type !== 'float') continue;
    const cur = Number(current[i.id] ?? i.def);
    if (!Number.isFinite(cur) || cur === 0) continue; // 0 usually means "off" (no stop loss, no filter)
    const isInt = i.type === 'int';
    let lo = i.min ?? (cur > 0 ? (isInt ? 1 : 0) : cur * 3);
    let hi = i.max ?? (cur > 0 ? cur * 4 : cur / 3);
    if (hi <= lo) hi = lo + (isInt ? 1 : cur);
    const step = i.step && i.step > 0 ? i.step : isInt ? 1 : (NICE.find((s) => s >= (hi - lo) / 60) ?? 5);
    if (isInt) { lo = Math.ceil(lo); hi = Math.floor(hi); }
    if (hi <= lo) continue;
    out.push({ id: i.id, title: i.title, type: i.type, def: cur, min: lo, max: hi, step });
  }
  return out;
}

const PAIRS: [string, string][] = [['fast', 'slow'], ['short', 'long'], ['min', 'max'], ['low', 'high'], ['lower', 'upper']];
/** Inputs that belong together as "smaller one first" (Fast/Slow EMA, Short/Long, Min/Max): swapping them would silently invert the strategy. Only pairs whose current values are ordered. */
export function orderedPairs(space: ParamDef[]): [string, string][] {
  const out: [string, string][] = [];
  for (const [lo, hi] of PAIRS) {
    for (const a of space) {
      const t = a.title.toLowerCase();
      const i = t.search(new RegExp(`\\b${lo}\\b`));
      if (i < 0) continue;
      const want = t.slice(0, i) + hi + t.slice(i + lo.length);
      const b = space.find((q) => q.title.toLowerCase() === want);
      if (b && a.def < b.def) out.push([a.id, b.id]);
    }
  }
  return out;
}

export interface Seg { n: number; wins: number; ret: number; dd: number }
export interface Metrics {
  trades: number; rawWinRate: number; ret: number; maxDD: number; profitFactor: number;
  /** recency-weighted figures the score is built from */
  winRate: number; retW: number; ddW: number;
  /** last segment only */
  recentWin: number; recentRet: number;
  segs: Seg[];
}

const growth = (n: number) => Array.from({ length: n }, (_, k) => RECENCY ** k);
const weights = (n: number) => { const g = growth(n), s = g.reduce((a, b) => a + b, 0); return g.map((x) => (x * n) / s); };

/** Metrics of one finished backtest. */
export function metricsOf(res: StrategyResult, nBars: number): Metrics {
  const eq = Array.from(res.equity, (v, i) => (Number.isFinite(v) ? v : i ? NaN : res.initialCapital));
  for (let i = 0; i < eq.length; i++) if (!Number.isFinite(eq[i])) eq[i] = i ? eq[i - 1] : res.initialCapital;
  const closed = res.trades.filter((t) => !t.open);
  const segs: Seg[] = Array.from({ length: SEGS }, () => ({ n: 0, wins: 0, ret: 0, dd: 0 }));
  for (const t of closed) { const k = Math.min(SEGS - 1, Math.floor((t.exitBar * SEGS) / nBars)); segs[k].n++; if (t.pnl > 0) segs[k].wins++; }
  for (let k = 0; k < SEGS; k++) {
    const a = Math.floor((k * nBars) / SEGS), b = Math.min(nBars - 1, Math.floor(((k + 1) * nBars) / SEGS) - 1);
    const start = a > 0 ? eq[a - 1] : res.initialCapital;
    segs[k].ret = start > 0 ? (eq[b] / start - 1) * 100 : 0;
    let peak = start, dd = 0;
    for (let i = a; i <= b; i++) { peak = Math.max(peak, eq[i]); if (peak > 0) dd = Math.max(dd, ((peak - eq[i]) / peak) * 100); }
    segs[k].dd = dd;
  }
  const w = weights(SEGS);
  let wins = 0, n = 0, retW = 0, ddW = 0;
  segs.forEach((s, k) => { wins += w[k] * s.wins; n += w[k] * s.n; retW += (w[k] * s.ret) / SEGS; ddW += (w[k] * s.dd) / SEGS; });
  let peak = res.initialCapital, maxDD = 0;
  for (const v of eq) { peak = Math.max(peak, v); if (peak > 0) maxDD = Math.max(maxDD, ((peak - v) / peak) * 100); }
  const gp = closed.filter((t) => t.pnl > 0).reduce((s, t) => s + t.pnl, 0), gl = -closed.filter((t) => t.pnl < 0).reduce((s, t) => s + t.pnl, 0);
  const last = segs[SEGS - 1];
  return {
    trades: closed.length, rawWinRate: closed.length ? closed.filter((t) => t.pnl > 0).length / closed.length : 0,
    ret: res.initialCapital > 0 ? (eq[eq.length - 1] / res.initialCapital - 1) * 100 : 0, maxDD, profitFactor: gl > 0 ? gp / gl : gp > 0 ? Infinity : 0,
    winRate: (wins + PRIOR / 2) / (n + PRIOR), retW, ddW, recentWin: last.n ? last.wins / last.n : 0, recentRet: last.ret, segs,
  };
}

export const minTradesFor = (nBars: number) => Math.max(8, Math.min(30, Math.ceil(nBars / 200)));
const conf = (trades: number, minT: number) => (trades <= 0 ? 0 : Math.min(1, trades / minT) ** 0.5);
const P = (retW: number) => (Math.tanh(retW / 8) + 1) / 2;
const D = (ddW: number) => 1 - Math.min(ddW / 25, 1);

export type Weights = [number, number, number];
/** Blend of win rate, profit and drawdown (each 0..1) scaled by the trade count confidence. */
export const blend = (m: Metrics, minT: number, [a, b, c]: Weights) => (a * m.winRate + b * P(m.retW) + c * D(m.ddW)) * conf(m.trades, minT);

type Objective = (m: Metrics, minT: number) => number;
const OBJ: Record<'balanced' | 'win' | 'pnl' | 'dd', Objective> = {
  balanced: (m, t) => blend(m, t, [0.5, 0.3, 0.2]),
  // the three category objectives use the figures the table shows (whole history, not recency weighted): "best" must be the best visible value
  win: (m, t) => m.rawWinRate * conf(m.trades, t) * (m.ret > 0 ? 1 : 0.5),
  pnl: (m, t) => m.ret * conf(m.trades, t),
  dd: (m, t) => (m.trades < t ? -100 + m.trades : m.ret > 0 ? -m.maxDD : -50 - m.maxDD),
};

/** Scores of the 7 in-between profiles. */
const PROFILES: { kind: string; tag: string; score: (m: Metrics, t: number) => number }[] = [
  { kind: 'balanced', tag: 'Balanced', score: (m, t) => blend(m, t, [0.5, 0.3, 0.2]) },
  { kind: 'winrate', tag: 'Win-rate focus', score: (m, t) => blend(m, t, [0.7, 0.2, 0.1]) },
  { kind: 'profit', tag: 'Profit focus', score: (m, t) => blend(m, t, [0.2, 0.7, 0.1]) },
  { kind: 'safe', tag: 'Safety first', score: (m, t) => blend(m, t, [0.3, 0.15, 0.55]) },
  {
    kind: 'recent', tag: 'Recent market', score: (m, t) => {
      const [a, b] = m.segs.slice(-2);
      const n = a.n + b.n, wr = (a.wins + b.wins + PRIOR / 2) / (n + PRIOR);
      return (0.5 * wr + 0.3 * P((a.ret + b.ret) / 2) + 0.2 * D((a.dd + b.dd) / 2)) * conf(n, t / 2);
    },
  },
  { kind: 'consistent', tag: 'Consistent', score: (m, t) => (0.6 * (m.segs.filter((s) => s.ret > 0).length / SEGS) + 0.4 * P(m.retW)) * conf(m.trades, t) },
];

export interface Variant { rank: number; tag: string; kind: string; /** every category this point is the absolute best of, plus its own kind */ kinds: string[]; params: Record<string, number>; metrics: Metrics; score: number; robust: number }
export interface OptimizeProgress { evals: number; budget: number; best: number; phase: string }
export interface OptimizeOpts {
  code: string; /** library indicators the strategy reads (oviate.ind) */ lib?: Record<string, string>; data: PineCandles; stepSec: number; space: ParamDef[]; settings: TesterSettings;
  /** inputs that are not tuned keep these values */
  base?: Record<string, number | boolean | string>;
  budget?: number;
  /** test hook: replaces the Pine backtest */
  run?: (params: Record<string, number | boolean | string>) => StrategyResult | null;
  onProgress?: (p: OptimizeProgress) => void;
  shouldStop?: () => boolean;
}
export interface OptimizeResult { variants: Variant[]; baseline: Metrics | null; evals: number; minTrades: number; space: ParamDef[]; stopped: boolean }

interface Point { idx: number[]; m: Metrics }

export function optimize(o: OptimizeOpts): OptimizeResult {
  const { space, data } = o;
  const budget = o.budget ?? 600;
  const minT = minTradesFor(data.n);
  const K = space.map((p) => Math.round((p.max - p.min) / p.step));
  const cache = new Map<string, Point | null>();
  let evals = 0, stopped = false, bestSeen = 0, phase = 'start';
  const pairs = orderedPairs(space).map(([a, b]) => [space.findIndex((p) => p.id === a), space.findIndex((p) => p.id === b)] as const);
  const valueOf = (idx: number[]) => Object.fromEntries(space.map((p, i) => [p.id, round(p.min + idx[i] * p.step, p.step)])) as Record<string, number>;
  const key = (idx: number[]) => idx.join(',');
  const stop = () => { if (!stopped && o.shouldStop?.()) stopped = true; return stopped; };

  function evalAt(idx: number[]): Point | null {
    const k = key(idx);
    if (cache.has(k)) return cache.get(k)!;
    const params = { ...(o.base ?? {}), ...valueOf(idx) };
    if (pairs.some(([a, b]) => Number(params[space[a].id]) >= Number(params[space[b].id]))) { cache.set(k, null); return null; } // keep Fast < Slow
    let res: StrategyResult | null;
    if (o.run) res = o.run(params);
    else { const r = runPine(o.code, data, { params, step: o.stepSec, broker: o.settings, lib: o.lib }); res = r.error ? null : r.strategy ?? null; }
    const pt = res ? { idx, m: metricsOf(res, data.n) } : null;
    cache.set(k, pt);
    evals++;
    if (pt) bestSeen = Math.max(bestSeen, OBJ.balanced(pt.m, minT));
    if (evals % 10 === 0) o.onProgress?.({ evals, budget, best: bestSeen, phase });
    return pt;
  }
  const outOfBudget = () => evals >= budget || stop();
  const clamp = (idx: number[], i: number, v: number) => { const c = idx.slice(); c[i] = Math.max(0, Math.min(K[i], v)); return c; };

  /** Pattern search with step doubling on success. */
  function climb(start: number[], obj: Objective) {
    let cur = start, curS = (() => { const p = evalAt(cur); return p ? obj(p.m, minT) : -Infinity; })();
    let scale = K.map((k) => Math.max(1, Math.round(k / 6)));
    for (;;) {
      let improved = false;
      for (let i = 0; i < space.length && !outOfBudget(); i++) {
        for (const dir of [1, -1]) {
          let k = scale[i], moved = false;
          while (!outOfBudget()) {
            const cand = clamp(cur, i, cur[i] + dir * k);
            if (cand[i] === cur[i]) break;
            const p = evalAt(cand), s = p ? obj(p.m, minT) : -Infinity;
            if (s > curS + 1e-9) { cur = cand; curS = s; moved = true; improved = true; k *= 2; } else break; // better: try twice as far; worse: stop in this direction
          }
          if (moved) break;
        }
      }
      if (outOfBudget()) return;
      if (!improved) { if (scale.every((s) => s <= 1)) return; scale = scale.map((s) => Math.max(1, Math.floor(s / 2))); }
    }
  }

  let seed = 987654321;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const startIdx = space.map((p, i) => Math.max(0, Math.min(K[i], Math.round((p.def - p.min) / p.step))));
  const randomIdx = () => K.map((k) => Math.round(rnd() * k));

  const baseline = evalAt(startIdx)?.m ?? null;
  const plan: [string, Objective, number][] = [['balanced', OBJ.balanced, 3], ['win rate', OBJ.win, 2], ['profit', OBJ.pnl, 2], ['drawdown', OBJ.dd, 2]];
  for (const [name, obj, starts] of plan) {
    phase = name;
    for (let s = 0; s < starts && !outOfBudget(); s++) climb(s === 0 ? startIdx : randomIdx(), obj);
  }

  // neighbours of the best balanced points: a plateau is more trustworthy than a spike (extra evaluations on top of the budget)
  phase = 'robustness';
  const pts = () => [...cache.values()].filter((p): p is Point => !!p);
  const top = pts().sort((a, b) => OBJ.balanced(b.m, minT) - OBJ.balanced(a.m, minT)).slice(0, 24);
  const robust = new Map<string, number>();
  if (!stop()) {
    for (const p of top) {
      const own = OBJ.balanced(p.m, minT), ns: number[] = [];
      for (let i = 0; i < space.length; i++) for (const d of [-1, 1]) {
        const c = clamp(p.idx, i, p.idx[i] + d);
        if (c[i] === p.idx[i]) continue;
        const q = evalAt(c);
        ns.push(q ? OBJ.balanced(q.m, minT) : 0);
      }
      robust.set(key(p.idx), ns.length ? (own + ns.reduce((a, b) => a + b, 0) / ns.length) / 2 : own);
      if (stop()) break;
    }
  }
  const rob = (p: Point) => robust.get(key(p.idx)) ?? OBJ.balanced(p.m, minT);
  const rankScore = (p: Point) => 0.65 * OBJ.balanced(p.m, minT) + 0.35 * rob(p);

  // ---- pick the 10 variants
  const all = pts().filter((p) => p.m.trades > 0);
  const ok = (p: Point, needProfit: boolean) => p.m.trades >= minT && (!needProfit || p.m.ret > 0);
  const chosen: { p: Point; tag: string; kind: string; kinds: string[] }[] = [];
  const near = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) / Math.max(1, K[i]) < 0.04);
  const pick = (kind: string, tag: string, score: (p: Point) => number, pool: Point[]) => {
    const free = pool.filter((p) => !chosen.some((c) => key(c.p.idx) === key(p.idx)));
    const distinct = free.filter((p) => !chosen.some((c) => near(c.p.idx, p.idx)));
    const best = (distinct.length ? distinct : free).sort((a, b) => score(b) - score(a))[0];
    if (best) chosen.push({ p: best, tag, kind, kinds: [kind] });
  };
  /** Category winner: the absolute best value of the table column among the guarded points. A point that wins several categories carries all tags. */
  const category = (kind: string, tag: string, score: (p: Point) => number, pool: Point[]) => {
    const best = pool.slice().sort((a, b) => score(b) - score(a) || b.m.trades - a.m.trades)[0];
    if (!best) return;
    const same = chosen.find((c) => key(c.p.idx) === key(best.idx));
    if (same) { same.tag += ' + ' + tag; same.kinds.push(kind); } else chosen.push({ p: best, tag, kind, kinds: [kind] });
  };
  const guarded = (needProfit: boolean) => { const g = all.filter((p) => ok(p, needProfit)); return g.length ? g : all; };
  category('best-win', 'Best win rate', (p) => p.m.rawWinRate, guarded(true));
  category('best-profit', 'Best profit', (p) => p.m.ret, guarded(false));
  category('best-drawdown', 'Lowest drawdown', (p) => -p.m.maxDD, guarded(true));
  for (const pr of PROFILES) pick(pr.kind, pr.tag, (p) => pr.score(p.m, minT), guarded(true));
  const hasRob = all.filter((p) => robust.has(key(p.idx)));
  pick('robust', 'Robust plateau', (p) => rob(p), hasRob.length ? hasRob : guarded(true));
  // a point that won several categories leaves slots free: fill them with the next best settings
  while (chosen.length < 10 && chosen.length < guarded(true).length) { const n = chosen.length; pick('next', 'Next best', rankScore, guarded(true)); if (chosen.length === n) break; }

  const variants = chosen.sort((a, b) => rankScore(b.p) - rankScore(a.p)).map((c, i): Variant => ({
    rank: i + 1, tag: c.tag, kind: c.kind, kinds: c.kinds, params: valueOf(c.p.idx), metrics: c.p.m, score: rankScore(c.p), robust: rob(c.p),
  }));
  o.onProgress?.({ evals, budget, best: bestSeen, phase: 'done' });
  return { variants, baseline, evals, minTrades: minT, space, stopped };
}
