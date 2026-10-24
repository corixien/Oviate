// Paper trading engine: pure functions over an Account value. No Svelte, no network.

export type Side = 'buy' | 'sell';
export type OrderType = 'market' | 'limit' | 'stop' | 'stop_limit' | 'trailing_stop';
export type Tif = 'gtc' | 'day';

export interface PaperOrder {
  id: string;
  symbol: string;
  side: Side;
  type: OrderType;
  qty: number;
  limit?: number;
  stop?: number;
  trailAmount?: number;
  trailPercent?: number;
  tif: Tif;
  status: 'open' | 'filled' | 'cancelled' | 'rejected';
  createdAt: number;
  filledAt?: number;
  fillPrice?: number;
  note?: string;
  source: string;
  /** orders sharing an OCO group cancel each other when one fills */
  oco?: string;
  reduceOnly?: boolean;
  /** stop-limit: the stop was reached and the limit is now working */
  triggered?: boolean;
  /** trailing stop: best price seen since placement */
  trailRef?: number;
  /** take profit / stop loss attached to an entry, created when the entry fills */
  bracket?: { takeProfit?: number; stopLoss?: number };
  expiresAt?: number;
}

export interface Position { symbol: string; qty: number; avgPrice: number; openedAt: number }

export interface ClosedTrade {
  id: string; symbol: string; side: 'long' | 'short'; qty: number; entryPrice: number; exitPrice: number;
  entryTime: number; exitTime: number; pnl: number; commission: number; source: string; reason: string;
  /** journal note written by the user */
  note?: string;
}

export interface Account {
  id: string;
  name: string;
  currency: string;
  initialCapital: number;
  /** cash balance: initial capital + realized P&L - commissions */
  balance: number;
  leverage: number;
  commissionPct: number;
  createdAt: number;
  orders: PaperOrder[];
  positions: Position[];
  trades: ClosedTrade[];
  equityCurve: { t: number; eq: number }[];
  lastPrices: Record<string, number>;
  seq: number;
}

export interface Quote { last: number; high?: number; low?: number; t: number }

export function newAccount(p: { id: string; name: string; initialCapital: number; leverage: number; commissionPct: number; currency?: string; now: number }): Account {
  return {
    id: p.id, name: p.name, currency: p.currency ?? 'USD', initialCapital: p.initialCapital, balance: p.initialCapital, leverage: p.leverage,
    commissionPct: p.commissionPct, createdAt: p.now, orders: [], positions: [], trades: [], equityCurve: [{ t: p.now, eq: p.initialCapital }], lastPrices: {}, seq: 0,
  };
}

const EPS = 1e-9;
export const qtyStep = (symbol: string) => (symbol.includes('/') || symbol.endsWith('-USD') ? 1e-6 : 1);
export const floorQty = (q: number, symbol: string) => {
  const s = qtyStep(symbol);
  return Math.floor(q / s + 1e-9) * s;
};

export function unrealized(acc: Account): number {
  return acc.positions.reduce((s, p) => s + p.qty * ((acc.lastPrices[p.symbol] ?? p.avgPrice) - p.avgPrice), 0);
}
export const equity = (acc: Account) => acc.balance + unrealized(acc);
export const exposure = (acc: Account) => acc.positions.reduce((s, p) => s + Math.abs(p.qty) * (acc.lastPrices[p.symbol] ?? p.avgPrice), 0);
export const buyingPower = (acc: Account) => Math.max(0, equity(acc) * acc.leverage - exposure(acc));
export const positionOf = (acc: Account, symbol: string) => acc.positions.find((p) => p.symbol === symbol);

// ---------- quantity helpers (used by the order dialog) ----------
export type QtyMode = 'units' | 'cash' | 'percent';
/** Convert the user's input into a quantity, rounded DOWN to the tradable step. */
export function resolveQty(acc: Account, symbol: string, mode: QtyMode, value: number, price: number): number {
  if (!(price > 0) || !(value > 0)) return 0;
  const raw = mode === 'units' ? value : mode === 'cash' ? value / price : ((buyingPower(acc) + 0) * (value / 100)) / price;
  return floorQty(raw, symbol);
}

// ---------- order placement ----------
export interface OrderInput {
  symbol: string; side: Side; type: OrderType; qty: number; limit?: number; stop?: number; trailAmount?: number; trailPercent?: number;
  tif?: Tif; source?: string; reduceOnly?: boolean; oco?: string; bracket?: PaperOrder['bracket'];
}

/** Notional the order would add to the exposure (closing an opposite position is free). */
function addedExposure(acc: Account, o: { symbol: string; side: Side; qty: number }, price: number): number {
  const pos = positionOf(acc, o.symbol)?.qty ?? 0;
  const signed = o.side === 'buy' ? o.qty : -o.qty;
  const after = pos + signed;
  return Math.max(0, Math.abs(after) - Math.abs(pos)) * price;
}

export function validate(acc: Account, o: OrderInput, refPrice: number | undefined): string | null {
  if (!(o.qty > 0)) return 'Quantity must be greater than zero';
  if (o.type === 'limit' && !(o.limit! > 0)) return 'Limit price required';
  if ((o.type === 'stop' || o.type === 'stop_limit') && !(o.stop! > 0)) return 'Stop price required';
  if (o.type === 'stop_limit' && !(o.limit! > 0)) return 'Limit price required';
  if (o.type === 'trailing_stop' && !(o.trailAmount! > 0 || o.trailPercent! > 0)) return 'Trail amount or percent required';
  const price = o.type === 'market' || o.type === 'trailing_stop' ? refPrice : (o.limit ?? o.stop ?? refPrice);
  if (!(price! > 0)) return 'No price available for this symbol yet';
  if (!o.reduceOnly && addedExposure(acc, o, price!) > buyingPower(acc) + EPS) return `Insufficient buying power (${buyingPower(acc).toFixed(2)} available)`;
  return null;
}

export function placeOrder(acc: Account, o: OrderInput, now: number): { order: PaperOrder; error?: string } {
  const ref = acc.lastPrices[o.symbol];
  const err = validate(acc, o, ref);
  acc.seq += 1;
  const order: PaperOrder = {
    id: `${acc.id}-${acc.seq}`, symbol: o.symbol, side: o.side, type: o.type, qty: o.qty, limit: o.limit, stop: o.stop,
    trailAmount: o.trailAmount, trailPercent: o.trailPercent, tif: o.tif ?? 'gtc', status: 'open', createdAt: now, source: o.source ?? 'manual',
    reduceOnly: o.reduceOnly, oco: o.oco, bracket: o.bracket,
  };
  if (order.tif === 'day') order.expiresAt = (Math.floor(now / 86400) + 1) * 86400;
  if (order.type === 'trailing_stop') order.trailRef = ref;
  if (err) { order.status = 'rejected'; order.note = err; acc.orders.push(order); return { order, error: err }; }
  acc.orders.push(order);
  if (order.type === 'market') fillOrder(acc, order, ref, now);
  else processOrders(acc, o.symbol, { last: ref ?? 0, t: now }, true);
  return { order };
}

export function cancelOrder(acc: Account, id: string, note = 'Cancelled') {
  const o = acc.orders.find((x) => x.id === id);
  if (o && o.status === 'open') { o.status = 'cancelled'; o.note = note; }
}

// ---------- fills ----------
function fillOrder(acc: Account, o: PaperOrder, price: number, now: number) {
  const pos = positionOf(acc, o.symbol);
  const signed = o.side === 'buy' ? o.qty : -o.qty;
  let qty = o.qty;
  if (o.reduceOnly) {
    const cur = pos?.qty ?? 0;
    if (cur === 0 || Math.sign(cur) === Math.sign(signed)) { o.status = 'cancelled'; o.note = 'No position to reduce'; return; }
    qty = Math.min(qty, Math.abs(cur));
  } else if (addedExposure(acc, { symbol: o.symbol, side: o.side, qty }, price) > buyingPower(acc) + EPS) {
    o.status = 'rejected'; o.note = 'Insufficient buying power at fill'; return;
  }
  const commission = (qty * price * acc.commissionPct) / 100;
  acc.balance -= commission;
  let remaining = qty;
  const dir = o.side === 'buy' ? 1 : -1;
  if (pos && Math.sign(pos.qty) !== dir) {
    const closeQty = Math.min(remaining, Math.abs(pos.qty));
    const pnl = (pos.qty > 0 ? price - pos.avgPrice : pos.avgPrice - price) * closeQty;
    acc.balance += pnl;
    acc.trades.push({
      id: `${o.id}#${acc.trades.length + 1}`, symbol: o.symbol, side: pos.qty > 0 ? 'long' : 'short', qty: closeQty, entryPrice: pos.avgPrice, exitPrice: price,
      entryTime: pos.openedAt, exitTime: now, pnl: pnl - commission * (closeQty / qty), commission: commission * (closeQty / qty), source: o.source,
      reason: o.type === 'market' ? 'market' : o.type === 'limit' ? 'limit' : o.type.replace('_', ' '),
    });
    pos.qty += dir * closeQty;
    remaining -= closeQty;
    if (Math.abs(pos.qty) < EPS) acc.positions = acc.positions.filter((p) => p !== pos);
  }
  if (remaining > EPS) {
    const cur = positionOf(acc, o.symbol);
    if (cur) { cur.avgPrice = (cur.avgPrice * Math.abs(cur.qty) + price * remaining) / (Math.abs(cur.qty) + remaining); cur.qty += dir * remaining; }
    else acc.positions.push({ symbol: o.symbol, qty: dir * remaining, avgPrice: price, openedAt: now });
  }
  o.status = 'filled'; o.filledAt = now; o.fillPrice = price; o.qty = qty;
  acc.lastPrices[o.symbol] = price;
  // OCO: cancel siblings
  if (o.oco) for (const s of acc.orders) if (s !== o && s.oco === o.oco && s.status === 'open') { s.status = 'cancelled'; s.note = 'OCO'; }
  // bracket: attach take profit / stop loss as an OCO pair that only reduces the position
  if (o.bracket && (o.bracket.takeProfit || o.bracket.stopLoss)) {
    const exitSide: Side = o.side === 'buy' ? 'sell' : 'buy';
    const group = `${o.id}-oco`;
    for (const [kind, px] of [['takeProfit', o.bracket.takeProfit], ['stopLoss', o.bracket.stopLoss]] as const) {
      if (!px) continue;
      acc.seq += 1;
      acc.orders.push({
        id: `${acc.id}-${acc.seq}`, symbol: o.symbol, side: exitSide, type: kind === 'takeProfit' ? 'limit' : 'stop', qty, limit: kind === 'takeProfit' ? px : undefined,
        stop: kind === 'stopLoss' ? px : undefined, tif: 'gtc', status: 'open', createdAt: now, source: o.source, reduceOnly: true, oco: group,
        note: kind === 'takeProfit' ? 'Take profit' : 'Stop loss',
      });
    }
  }
}

/** Evaluate working orders for `symbol` against a new quote. `initial` skips trailing-ref updates for fresh orders. */
export function processOrders(acc: Account, symbol: string, q: Quote, initial = false) {
  acc.lastPrices[symbol] = q.last;
  const hi = Math.max(q.high ?? q.last, q.last), lo = Math.min(q.low ?? q.last, q.last);
  for (const o of acc.orders.filter((x) => x.symbol === symbol && x.status === 'open').sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))) {
    if (o.status !== 'open') continue; // may have been cancelled by an OCO fill earlier in this loop
    if (o.expiresAt && q.t >= o.expiresAt) { o.status = 'cancelled'; o.note = 'Expired (day order)'; continue; }
    const buy = o.side === 'buy';
    switch (o.type) {
      case 'market': fillOrder(acc, o, q.last, q.t); break;
      case 'limit': {
        if (buy ? lo <= o.limit! : hi >= o.limit!) fillOrder(acc, o, buy ? Math.min(o.limit!, q.last <= o.limit! ? q.last : o.limit!) : Math.max(o.limit!, q.last >= o.limit! ? q.last : o.limit!), q.t);
        break;
      }
      case 'stop': {
        if (buy ? hi >= o.stop! : lo <= o.stop!) fillOrder(acc, o, buy ? Math.max(o.stop!, q.last) : Math.min(o.stop!, q.last), q.t);
        break;
      }
      case 'stop_limit': {
        if (!o.triggered && (buy ? hi >= o.stop! : lo <= o.stop!)) o.triggered = true;
        if (o.triggered && (buy ? lo <= o.limit! : hi >= o.limit!)) fillOrder(acc, o, o.limit!, q.t);
        break;
      }
      case 'trailing_stop': {
        // a sell trailing stop protects a long: it trails the high; a buy trailing stop trails the low
        const ref0 = o.trailRef ?? q.last;
        const ref = buy ? Math.min(ref0, initial ? q.last : lo) : Math.max(ref0, initial ? q.last : hi);
        o.trailRef = ref;
        const dist = o.trailAmount ?? (ref * (o.trailPercent ?? 0)) / 100;
        const level = buy ? ref + dist : ref - dist;
        if (!initial && (buy ? hi >= level : lo <= level)) fillOrder(acc, o, buy ? Math.max(level, q.last) : Math.min(level, q.last), q.t);
        break;
      }
    }
  }
}

/** Market-close (part of) a position. */
export function closePosition(acc: Account, symbol: string, now: number, qty?: number, source = 'manual'): PaperOrder | null {
  const pos = positionOf(acc, symbol);
  const price = acc.lastPrices[symbol];
  if (!pos || !(price > 0)) return null;
  const q = Math.min(qty ?? Math.abs(pos.qty), Math.abs(pos.qty));
  const { order } = placeOrder(acc, { symbol, side: pos.qty > 0 ? 'sell' : 'buy', type: 'market', qty: q, source, reduceOnly: true }, now);
  return order;
}

export function recordEquity(acc: Account, t: number, minGap = 30) {
  const last = acc.equityCurve[acc.equityCurve.length - 1];
  const eq = equity(acc);
  if (last && t - last.t < minGap && Math.abs(last.eq - eq) < 1e-9) return;
  if (last && t - last.t < minGap) { last.t = t; last.eq = eq; return; }
  acc.equityCurve.push({ t, eq });
  if (acc.equityCurve.length > 20000) acc.equityCurve.splice(1, 2000);
}

// ---------- statistics ----------
export interface Stats {
  trades: number; wins: number; losses: number; winRate: number; netProfit: number; grossProfit: number; grossLoss: number; profitFactor: number;
  avgWin: number; avgLoss: number; best: number; worst: number; avgTrade: number; commission: number;
  equity: number; returnPct: number; maxDrawdown: number; maxDrawdownPct: number; openPnl: number;
}

export function statsFor(trades: { pnl: number; commission: number }[], curve: { eq: number }[], initial: number, currentEquity: number, openPnl = 0): Stats {
  const wins = trades.filter((t) => t.pnl > 0), losses = trades.filter((t) => t.pnl < 0);
  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0), grossLoss = -losses.reduce((s, t) => s + t.pnl, 0);
  let peak = initial, dd = 0, ddPct = 0;
  for (const p of curve) { peak = Math.max(peak, p.eq); const d = peak - p.eq; if (d > dd) dd = d; if (peak > 0 && d / peak > ddPct) ddPct = d / peak; }
  const n = trades.length;
  return {
    trades: n, wins: wins.length, losses: losses.length, winRate: n ? (wins.length / n) * 100 : 0,
    netProfit: grossProfit - grossLoss, grossProfit, grossLoss, profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    avgWin: wins.length ? grossProfit / wins.length : 0, avgLoss: losses.length ? -grossLoss / losses.length : 0,
    best: n ? Math.max(...trades.map((t) => t.pnl)) : 0, worst: n ? Math.min(...trades.map((t) => t.pnl)) : 0, avgTrade: n ? (grossProfit - grossLoss) / n : 0,
    commission: trades.reduce((s, t) => s + t.commission, 0), equity: currentEquity, returnPct: initial ? ((currentEquity - initial) / initial) * 100 : 0,
    maxDrawdown: dd, maxDrawdownPct: ddPct * 100, openPnl,
  };
}

export const accountStats = (acc: Account) => statsFor(acc.trades, acc.equityCurve, acc.initialCapital, equity(acc), unrealized(acc));
