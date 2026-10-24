// Trading journal: pure helpers over the closed trades of a paper account (filters, day / month roll-ups, calendar grid, summary).
import type { ClosedTrade } from './engine.ts';

export type JournalRange = 'all' | 'today' | '7d' | '30d' | 'month' | 'year';
export interface JournalFilter {
  range: JournalRange;
  /** '' = all symbols */
  symbol: string;
  side: 'all' | 'long' | 'short';
  result: 'all' | 'win' | 'loss';
  /** '' = all sources (manual, strategy names, ...) */
  source: string;
  /** one local day 'YYYY-MM-DD' (set by a click in the calendar), '' = none */
  day: string;
}

export const defaultFilter = (): JournalFilter => ({ range: 'all', symbol: '', side: 'all', result: 'all', source: '', day: '' });

const p2 = (n: number) => String(n).padStart(2, '0');
/** Local calendar day of a unix timestamp (seconds): 'YYYY-MM-DD'. */
export const dayKey = (t: number) => { const d = new Date(t * 1000); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
export const monthKey = (t: number) => dayKey(t).slice(0, 7);

function rangeStart(range: JournalRange, now: number): number {
  const d = new Date(now * 1000);
  const at = (y: number, m: number, day: number) => new Date(y, m, day).getTime() / 1000;
  switch (range) {
    case 'today': return at(d.getFullYear(), d.getMonth(), d.getDate());
    case '7d': return at(d.getFullYear(), d.getMonth(), d.getDate() - 6);
    case '30d': return at(d.getFullYear(), d.getMonth(), d.getDate() - 29);
    case 'month': return at(d.getFullYear(), d.getMonth(), 1);
    case 'year': return at(d.getFullYear(), 0, 1);
    default: return -Infinity;
  }
}

/** Filtered trades, newest first (by close time). */
export function filterTrades(trades: ClosedTrade[], f: JournalFilter, now: number): ClosedTrade[] {
  const from = rangeStart(f.range, now);
  return trades
    .filter((t) => t.exitTime >= from
      && (!f.symbol || t.symbol === f.symbol)
      && (f.side === 'all' || t.side === f.side)
      && (f.result === 'all' || (f.result === 'win' ? t.pnl > 0 : t.pnl < 0))
      && (!f.source || t.source === f.source)
      && (!f.day || dayKey(t.exitTime) === f.day))
    .sort((a, b) => b.exitTime - a.exitTime || b.id.localeCompare(a.id));
}

export interface DayStat { date: string; pnl: number; trades: number; wins: number; losses: number }
export interface MonthStat { month: string; pnl: number; trades: number; wins: number; losses: number; days: number; greenDays: number; redDays: number }

/** P&L per local day (by close time), keyed by date. */
export function dayStats(trades: ClosedTrade[]): Map<string, DayStat> {
  const m = new Map<string, DayStat>();
  for (const t of trades) {
    const k = dayKey(t.exitTime);
    const d = m.get(k) ?? { date: k, pnl: 0, trades: 0, wins: 0, losses: 0 };
    d.pnl += t.pnl; d.trades++; if (t.pnl > 0) d.wins++; else if (t.pnl < 0) d.losses++;
    m.set(k, d);
  }
  return m;
}

/** Days rolled up into months, newest month first. */
export function monthStats(days: Map<string, DayStat>): MonthStat[] {
  const m = new Map<string, MonthStat>();
  for (const d of days.values()) {
    const k = d.date.slice(0, 7);
    const s = m.get(k) ?? { month: k, pnl: 0, trades: 0, wins: 0, losses: 0, days: 0, greenDays: 0, redDays: 0 };
    s.pnl += d.pnl; s.trades += d.trades; s.wins += d.wins; s.losses += d.losses; s.days++;
    if (d.pnl > 0) s.greenDays++; else if (d.pnl < 0) s.redDays++;
    m.set(k, s);
  }
  return [...m.values()].sort((a, b) => b.month.localeCompare(a.month));
}

export interface CalCell { date: string; day: number; stat?: DayStat }
export interface CalWeek { cells: (CalCell | null)[]; pnl: number; trades: number }

/** Month grid (weeks start on Monday) with a weekly total per row. `month` = 'YYYY-MM'. */
export function calendarGrid(month: string, days: Map<string, DayStat>): CalWeek[] {
  const [y, mo] = month.split('-').map(Number);
  const first = new Date(y, mo - 1, 1);
  const count = new Date(y, mo, 0).getDate();
  const lead = (first.getDay() + 6) % 7;
  const weeks: CalWeek[] = [];
  let cells: (CalCell | null)[] = Array(lead).fill(null);
  const flush = () => {
    while (cells.length < 7) cells.push(null);
    let pnl = 0, trades = 0;
    for (const c of cells) if (c?.stat) { pnl += c.stat.pnl; trades += c.stat.trades; }
    weeks.push({ cells, pnl, trades }); cells = [];
  };
  for (let d = 1; d <= count; d++) {
    const date = `${y}-${p2(mo)}-${p2(d)}`;
    cells.push({ date, day: d, stat: days.get(date) });
    if (cells.length === 7) flush();
  }
  if (cells.length) flush();
  return weeks;
}

export const shiftMonth = (month: string, by: number) => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + by, 1);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}`;
};

export interface JournalSummary {
  trades: number; net: number; winRate: number; profitFactor: number; avgWin: number; avgLoss: number; expectancy: number;
  best: number; worst: number; fees: number; winStreak: number; lossStreak: number; avgHoldSec: number;
}

export function summarize(trades: ClosedTrade[]): JournalSummary {
  const wins = trades.filter((t) => t.pnl > 0), losses = trades.filter((t) => t.pnl < 0);
  const gw = wins.reduce((s, t) => s + t.pnl, 0), gl = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const net = trades.reduce((s, t) => s + t.pnl, 0);
  let ws = 0, ls = 0, cw = 0, cl = 0;
  for (const t of [...trades].sort((a, b) => a.exitTime - b.exitTime)) {
    if (t.pnl > 0) { cw++; cl = 0; } else if (t.pnl < 0) { cl++; cw = 0; } else { cw = 0; cl = 0; }
    ws = Math.max(ws, cw); ls = Math.max(ls, cl);
  }
  return {
    trades: trades.length, net, winRate: trades.length ? (wins.length / trades.length) * 100 : 0,
    profitFactor: gl > 0 ? gw / gl : gw > 0 ? Infinity : 0,
    avgWin: wins.length ? gw / wins.length : 0, avgLoss: losses.length ? -gl / losses.length : 0,
    expectancy: trades.length ? net / trades.length : 0,
    best: trades.length ? Math.max(...trades.map((t) => t.pnl)) : 0, worst: trades.length ? Math.min(...trades.map((t) => t.pnl)) : 0,
    fees: trades.reduce((s, t) => s + t.commission, 0), winStreak: ws, lossStreak: ls,
    avgHoldSec: trades.length ? trades.reduce((s, t) => s + (t.exitTime - t.entryTime), 0) / trades.length : 0,
  };
}

export function holdText(sec: number): string {
  if (!(sec >= 0)) return '—';
  if (sec < 90) return `${Math.round(sec)}s`;
  if (sec < 5400) return `${Math.round(sec / 60)}m`;
  if (sec < 172800) return `${(sec / 3600).toFixed(1)}h`;
  return `${(sec / 86400).toFixed(1)}d`;
}
