// Strategy broker: simulates order fills bar by bar (TradingView-style: orders placed on a bar fill on the next one).
import type { Ctx } from './natives.ts';
import { NATIVES, VARS, truthy, isNa } from './natives.ts';
import type { PendingOrder, StrategyResult, TradeRec } from './types.ts';

type Dir = 'long' | 'short';

interface Lot { id: string; dir: Dir; qty: number; price: number; raw: number; bar: number; time: number; commission: number; mfe: number; mae: number; comment: string }
interface Order { id: string; kind: 'entry' | 'order' | 'close' | 'close_all'; dir: Dir | ''; qty: number; limit?: number; stop?: number; comment: string; qtyPercent?: number }
interface ExitOrder {
  id: string; from: string; qty: number; qtyPercent: number;
  stop?: number; limit?: number; profitTicks?: number; lossTicks?: number;
  trailPrice?: number; trailPoints?: number; trailOffset?: number; comment: string;
  /** trailing state per lot id */
  trail: Map<string, number>;
}

export interface BrokerConfig {
  initialCapital: number;
  qtyType: 'fixed' | 'cash' | 'percent_of_equity';
  qtyValue: number;
  pyramiding: number;
  commissionType: 'percent' | 'cash_per_order' | 'cash_per_contract';
  commissionValue: number;
  slippageTicks: number;
}

const EPS = 1e-9;

export class Broker {
  cfg: BrokerConfig;
  private x: Ctx;
  lots: Lot[] = [];
  closed: TradeRec[] = [];
  private orders: Order[] = [];
  private exits: ExitOrder[] = [];
  realized = 0;
  private equityArr: Float64Array;
  private lastClose = NaN;

  constructor(x: Ctx, cfg: BrokerConfig) {
    this.x = x;
    this.cfg = cfg;
    this.equityArr = new Float64Array(x.n).fill(NaN);
  }

  // ---------- state ----------
  get positionSize(): number { return this.lots.reduce((s, l) => s + (l.dir === 'long' ? l.qty : -l.qty), 0); }
  get avgPrice(): number {
    const size = this.lots.reduce((s, l) => s + l.qty, 0);
    return size ? this.lots.reduce((s, l) => s + l.price * l.qty, 0) / size : NaN;
  }
  openProfit(price = this.lastClose): number {
    return this.lots.reduce((s, l) => s + (l.dir === 'long' ? price - l.price : l.price - price) * l.qty, 0);
  }
  equity(price = this.lastClose): number { return this.cfg.initialCapital + this.realized + (Number.isNaN(price) ? 0 : this.openProfit(price)); }

  // ---------- script API ----------
  entry(id: string, dir: Dir, qty: number, limit: number | undefined, stop: number | undefined, comment: string, kind: 'entry' | 'order' = 'entry') {
    this.orders = this.orders.filter((o) => !(o.id === id && (o.kind === 'entry' || o.kind === 'order')));
    this.orders.push({ id, kind, dir, qty, limit, stop, comment });
  }
  close(id: string, comment: string, qty: number, qtyPercent?: number) { this.orders.push({ id, kind: 'close', dir: '', qty, comment, qtyPercent }); }
  closeAll(comment: string) { this.orders.push({ id: '', kind: 'close_all', dir: '', qty: NaN, comment }); }
  exit(e: Omit<ExitOrder, 'trail'>) {
    // scripts re-issue strategy.exit every bar: keep the trailing-stop state of the order being replaced
    const prev = this.exits.find((o) => o.id === e.id && o.from === e.from);
    this.exits = this.exits.filter((o) => o !== prev);
    this.exits.push({ ...e, trail: prev?.trail ?? new Map() });
  }
  cancel(id: string) { this.orders = this.orders.filter((o) => o.id !== id); this.exits = this.exits.filter((o) => o.id !== id); }
  cancelAll() { this.orders = []; this.exits = []; }

  // ---------- helpers ----------
  private tick(): number { return this.x.mintick; }
  private slip(dir: Dir, price: number, opening: boolean): number {
    const s = this.cfg.slippageTicks * this.tick();
    // buying (long open / short close) pays up, selling receives less
    const buying = (dir === 'long') === opening;
    return buying ? price + s : price - s;
  }
  private commissionFor(qty: number, price: number): number {
    const { commissionType: t, commissionValue: v } = this.cfg;
    if (t === 'percent') return (qty * price * v) / 100;
    if (t === 'cash_per_contract') return qty * v;
    return v;
  }
  private defaultQty(price: number): number {
    const { qtyType, qtyValue } = this.cfg;
    if (qtyType === 'cash') return qtyValue / price;
    if (qtyType === 'percent_of_equity') return (this.equity(price) * qtyValue) / 100 / price;
    return qtyValue;
  }

  private openLot(id: string, dir: Dir, qty: number, price: number, comment: string, raw = price) {
    if (!(qty > EPS)) return;
    const b = this.x.bar;
    const commission = this.commissionFor(qty, price);
    this.realized -= commission;
    this.lots.push({ id, dir, qty, price, raw, bar: b, time: this.x.t[b], commission, mfe: 0, mae: 0, comment });
  }

  /** Close `qty` of a lot at `price`; returns the closed quantity. */
  private closeLot(lot: Lot, qty: number, price: number, comment: string, raw = price): number {
    const q = Math.min(qty, lot.qty);
    if (!(q > EPS)) return 0;
    const b = this.x.bar;
    const commission = this.commissionFor(q, price);
    const gross = (lot.dir === 'long' ? price - lot.price : lot.price - price) * q;
    const entryShare = lot.commission * (q / lot.qty);
    this.realized += gross - commission;
    this.closed.push({
      id: lot.id, dir: lot.dir, qty: q, entryBar: lot.bar, entryTime: lot.time, entryPrice: lot.price, exitBar: b, exitTime: this.x.t[b],
      exitPrice: price, pnl: gross - commission - entryShare, commission: commission + entryShare, entryComment: lot.comment, exitComment: comment,
      open: false, mfe: lot.mfe * (q / lot.qty), mae: lot.mae * (q / lot.qty), entryRaw: lot.raw, exitRaw: raw,
    });
    lot.commission -= entryShare;
    lot.mfe *= 1 - q / lot.qty; lot.mae *= 1 - q / lot.qty;
    lot.qty -= q;
    if (lot.qty <= EPS) this.lots = this.lots.filter((l) => l !== lot);
    return q;
  }

  private closeAllLots(dir: Dir | '', price: number, comment: string) {
    for (const lot of [...this.lots]) if (!dir || lot.dir === dir) this.closeLot(lot, lot.qty, this.slip(lot.dir, price, false), comment, price);
  }

  // ---------- per-bar processing ----------
  /** Fill pending orders against the bar that just opened. */
  beginBar(b: number) {
    const x = this.x;
    const o = x.o[b], h = x.h[b], l = x.l[b];
    const pending = this.orders;
    this.orders = [];
    for (const od of pending) {
      let fill: number | null = null;
      const buy = od.dir === 'long';
      if (od.kind === 'close' || od.kind === 'close_all' || (od.limit === undefined && od.stop === undefined)) fill = o;
      else {
        // stop first (if any), then limit
        let trig = od.stop === undefined;
        let price = o;
        if (od.stop !== undefined) {
          if (buy ? h >= od.stop : l <= od.stop) { trig = true; price = buy ? Math.max(o, od.stop) : Math.min(o, od.stop); }
        }
        if (trig && od.limit !== undefined) {
          if (buy ? (od.stop !== undefined ? Math.min(price, od.limit) >= l || l <= od.limit : l <= od.limit) : (od.stop !== undefined ? h >= od.limit : h >= od.limit)) price = buy ? Math.min(o, od.limit) : Math.max(o, od.limit);
          else trig = false;
        }
        if (trig) fill = price;
      }
      if (fill === null) { this.orders.push(od); continue; } // keeps waiting (GTC)
      this.fillOrder(od, fill);
    }
    this.processExits(b);
  }

  private fillOrder(od: Order, price: number) {
    if (od.kind === 'close_all') { this.closeAllLots('', price, od.comment); return; }
    if (od.kind === 'close') {
      let remaining = od.qtyPercent !== undefined && !Number.isNaN(od.qtyPercent) ? NaN : od.qty;
      const lots = this.lots.filter((l) => l.id === od.id);
      const total = lots.reduce((s, l) => s + l.qty, 0);
      if (od.qtyPercent !== undefined && !Number.isNaN(od.qtyPercent)) remaining = (total * od.qtyPercent) / 100;
      for (const lot of lots) {
        const q = Number.isNaN(remaining) ? lot.qty : Math.min(lot.qty, remaining);
        const done = this.closeLot(lot, q, this.slip(lot.dir, price, false), od.comment, price);
        if (!Number.isNaN(remaining)) remaining -= done;
        if (!Number.isNaN(remaining) && remaining <= EPS) break;
      }
      return;
    }
    const dir = od.dir as Dir;
    const qty = Number.isNaN(od.qty) ? this.defaultQty(price) : od.qty;
    const fillPrice = this.slip(dir, price, true);
    const opposite = this.lots.filter((l) => l.dir !== dir);
    if (od.kind === 'entry') {
      if (opposite.length) {
        this.closeAllLots(dir === 'long' ? 'short' : 'long', price, 'reverse');
      } else if (this.lots.length > this.cfg.pyramiding) {
        return; // pyramiding limit reached
      }
      this.openLot(od.id, dir, qty, fillPrice, od.comment, price);
      return;
    }
    // strategy.order: net the position, no reversal rules
    let rest = qty;
    for (const lot of opposite) {
      if (rest <= EPS) break;
      rest -= this.closeLot(lot, rest, fillPrice, od.comment, price);
    }
    if (rest > EPS) this.openLot(od.id, dir, rest, fillPrice, od.comment, price);
  }

  private processExits(b: number) {
    const x = this.x;
    const o = x.o[b], h = x.h[b], l = x.l[b];
    // price path assumption: if the open is closer to the high, the high comes first
    const highFirst = Math.abs(h - o) < Math.abs(l - o);
    for (const ex of [...this.exits]) {
      const lots = this.lots.filter((lt) => !ex.from || lt.id === ex.from);
      for (const lot of lots) {
        const long = lot.dir === 'long';
        const ref = lot.price;
        const tick = this.tick();
        let stop = ex.stop, limit = ex.limit;
        if (stop === undefined && ex.lossTicks !== undefined) stop = long ? ref - ex.lossTicks * tick : ref + ex.lossTicks * tick;
        if (limit === undefined && ex.profitTicks !== undefined) limit = long ? ref + ex.profitTicks * tick : ref - ex.profitTicks * tick;
        // trailing stop: the stop level that is live depends on whether the favorable extreme or the adverse one comes first
        let trailLive: number | undefined, trailPrev: number | undefined;
        let stopIsTrail = false;
        if (ex.trailPrice !== undefined || ex.trailPoints !== undefined) {
          const activate = ex.trailPrice !== undefined ? ex.trailPrice : long ? ref + (ex.trailPoints ?? 0) * tick : ref - (ex.trailPoints ?? 0) * tick;
          const off = (ex.trailOffset ?? 0) * tick;
          const prevBest = ex.trail.get(lot.id);
          trailPrev = prevBest !== undefined ? (long ? prevBest - off : prevBest + off) : undefined;
          const reached = prevBest !== undefined || (long ? h >= activate : l <= activate);
          if (reached) {
            const bestNow = long ? Math.max(prevBest ?? -Infinity, h) : Math.min(prevBest ?? Infinity, l);
            ex.trail.set(lot.id, bestNow);
            const nowTs = long ? bestNow - off : bestNow + off;
            const extremeFirst = long ? highFirst : !highFirst;
            trailLive = extremeFirst ? nowTs : trailPrev;
          }
          if (trailLive !== undefined) {
            stopIsTrail = stop === undefined || (long ? trailLive > stop : trailLive < stop);
            stop = stop === undefined ? trailLive : long ? Math.max(stop, trailLive) : Math.min(stop, trailLive);
          }
        }
        if (stop === undefined && limit === undefined) continue;
        const stopHit = stop !== undefined && (long ? l <= stop : h >= stop);
        const limitHit = limit !== undefined && (long ? h >= limit : l <= limit);
        if (!stopHit && !limitHit) continue;
        // gap handling: a stop gapped through fills at the open, a limit gapped through also at the open
        let useStop = stopHit;
        if (stopHit && limitHit) useStop = long ? !highFirst : highFirst;
        const qty = ex.qtyPercent > 0 && !Number.isNaN(ex.qtyPercent) ? (lot.qty * ex.qtyPercent) / 100 : Number.isNaN(ex.qty) ? lot.qty : Math.min(ex.qty, lot.qty);
        if (useStop) {
          const gapped = trailPrev !== undefined && (long ? o <= trailPrev : o >= trailPrev);
          const px = stopIsTrail && !gapped ? stop! : long ? Math.min(o, stop!) : Math.max(o, stop!);
          this.closeLot(lot, qty, this.slip(lot.dir, px, false), ex.comment || (ex.trail.has(lot.id) ? 'trailing' : 'stop'), px);
        } else {
          const px = long ? Math.max(o, limit!) : Math.min(o, limit!);
          this.closeLot(lot, qty, px, ex.comment || 'limit', px);
        }
      }
    }
    // drop exits whose entry is gone (they belong to closed positions)
    this.exits = this.exits.filter((ex) => this.lots.some((lt) => !ex.from || lt.id === ex.from) || this.orders.some((od) => od.id === ex.from));
  }

  /** Called after the script ran on bar b: update excursions and the equity curve. */
  endBar(b: number) {
    const x = this.x;
    this.lastClose = x.c[b];
    for (const lot of this.lots) {
      const fav = lot.dir === 'long' ? x.h[b] - lot.price : lot.price - x.l[b];
      const adv = lot.dir === 'long' ? lot.price - x.l[b] : x.h[b] - lot.price;
      lot.mfe = Math.max(lot.mfe, fav * lot.qty);
      lot.mae = Math.max(lot.mae, adv * lot.qty);
    }
    this.equityArr[b] = this.equity(x.c[b]);
  }

  result(): StrategyResult {
    const last = this.x.n - 1;
    const open: TradeRec[] = this.lots.map((lt) => ({
      id: lt.id, dir: lt.dir, qty: lt.qty, entryBar: lt.bar, entryTime: lt.time, entryPrice: lt.price, exitBar: -1, exitTime: 0,
      exitPrice: this.x.c[last], pnl: (lt.dir === 'long' ? this.x.c[last] - lt.price : lt.price - this.x.c[last]) * lt.qty - lt.commission,
      commission: lt.commission, entryComment: lt.comment, exitComment: '', open: true, mfe: lt.mfe, mae: lt.mae, entryRaw: lt.raw, exitRaw: this.x.c[last],
    }));
    const pending: PendingOrder[] = [
      ...this.orders.map((o): PendingOrder => ({ id: o.id, kind: o.kind, dir: o.dir, qty: o.qty, limit: o.limit, stop: o.stop, comment: o.comment })),
      ...this.exits.map((e): PendingOrder => {
        // tick-based exits are relative to the matching lot's entry price
        const lot = this.lots.find((l) => !e.from || l.id === e.from);
        const long = lot?.dir === 'long';
        const tick = this.tick();
        const stop = e.stop ?? (lot && e.lossTicks !== undefined ? (long ? lot.price - e.lossTicks * tick : lot.price + e.lossTicks * tick) : undefined);
        const limit = e.limit ?? (lot && e.profitTicks !== undefined ? (long ? lot.price + e.profitTicks * tick : lot.price - e.profitTicks * tick) : undefined);
        return { id: e.id, kind: 'exit', dir: '', qty: e.qty, fromEntry: e.from, comment: e.comment, exitStop: stop, exitLimit: limit };
      }),
    ];
    const size = this.positionSize;
    return {
      config: { qtyType: this.cfg.qtyType, qtyValue: this.cfg.qtyValue, pyramiding: this.cfg.pyramiding, initialCapital: this.cfg.initialCapital },
      pending, trades: [...this.closed, ...open], equity: this.equityArr, netProfit: this.realized + this.openProfit(), initialCapital: this.cfg.initialCapital,
      openPosition: size === 0 ? null : { dir: size > 0 ? 'long' : 'short', qty: Math.abs(size), avg: this.avgPrice },
    };
  }
}

// ---------------- natives ----------------
const str = (v: any, d = '') => (v === undefined || isNa(v) ? d : String(v));
const num = (v: any) => (v === undefined || isNa(v) ? undefined : (v as number));
const broker = (x: Ctx): Broker => {
  if (!x.broker) throw new Error('strategy.* calls need a strategy() declaration');
  return x.broker as Broker;
};

NATIVES['strategy'] = {
  params: ['title', 'shorttitle', 'overlay', 'format', 'precision', 'scale', 'pyramiding', 'calc_on_order_fills', 'calc_on_every_tick', 'max_bars_back',
    'backtest_fill_limits_assumption', 'default_qty_type', 'default_qty_value', 'initial_capital', 'currency', 'slippage', 'commission_type',
    'commission_value', 'process_orders_on_close', 'close_entries_rule', 'margin_long', 'margin_short'],
  fn: (a, x) => {
    x.meta.kind = 'strategy'; x.meta.title = a[0] ?? 'Strategy'; x.meta.shorttitle = a[1] ?? x.meta.title; x.meta.overlay = !!a[2];
    const cfg: BrokerConfig = {
      initialCapital: num(a[13]) ?? 100000,
      qtyType: (['fixed', 'cash', 'percent_of_equity'].includes(a[11]) ? a[11] : 'fixed') as BrokerConfig['qtyType'],
      qtyValue: num(a[12]) ?? 1,
      pyramiding: num(a[6]) ?? 0,
      commissionType: (['percent', 'cash_per_order', 'cash_per_contract'].includes(a[16]) ? a[16] : 'percent') as BrokerConfig['commissionType'],
      commissionValue: num(a[17]) ?? 0,
      slippageTicks: num(a[15]) ?? 0,
    };
    const ov = x.brokerCfg;
    if (ov) { cfg.initialCapital = ov.initialCapital; cfg.qtyType = ov.qtyType; cfg.qtyValue = ov.qtyValue; cfg.commissionType = 'percent'; cfg.commissionValue = ov.commissionValue; cfg.slippageTicks = ov.slippageTicks; }
    x.meta.initialCapital = cfg.initialCapital; x.meta.pyramiding = cfg.pyramiding;
    if (!x.broker) x.broker = new Broker(x, cfg); // the declaration runs on every bar; create the broker once
    return NaN;
  },
};

const entryFn = (kind: 'entry' | 'order') => (a: any[], x: Ctx) => {
  if (a[8] === false) return NaN; // when=false
  broker(x).entry(str(a[0]), a[1] === 'short' ? 'short' : 'long', num(a[2]) ?? NaN, num(a[3]), num(a[4]), str(a[7]), kind);
  return NaN;
};
NATIVES['strategy.entry'] = { params: ['id', 'direction', 'qty', 'limit', 'stop', 'oca_name', 'oca_type', 'comment', 'when', 'alert_message'], fn: entryFn('entry') };
NATIVES['strategy.order'] = { params: ['id', 'direction', 'qty', 'limit', 'stop', 'oca_name', 'oca_type', 'comment', 'when', 'alert_message'], fn: entryFn('order') };
NATIVES['strategy.close'] = {
  params: ['id', 'comment', 'qty', 'qty_percent', 'alert_message', 'immediately', 'when'],
  fn: (a, x) => { if (a[6] === false) return NaN; broker(x).close(str(a[0]), str(a[1]), num(a[2]) ?? NaN, num(a[3])); return NaN; },
};
NATIVES['strategy.close_all'] = { params: ['comment', 'alert_message', 'immediately', 'when'], fn: (a, x) => { if (a[3] === false) return NaN; broker(x).closeAll(str(a[0])); return NaN; } };
NATIVES['strategy.exit'] = {
  params: ['id', 'from_entry', 'qty', 'qty_percent', 'profit', 'limit', 'loss', 'stop', 'trail_price', 'trail_points', 'trail_offset', 'oca_name', 'comment',
    'comment_profit', 'comment_loss', 'comment_trailing', 'alert_message', 'when'],
  fn: (a, x) => {
    if (a[17] === false) return NaN;
    broker(x).exit({
      id: str(a[0]), from: str(a[1]), qty: num(a[2]) ?? NaN, qtyPercent: num(a[3]) ?? NaN,
      profitTicks: num(a[4]), limit: num(a[5]), lossTicks: num(a[6]), stop: num(a[7]),
      trailPrice: num(a[8]), trailPoints: num(a[9]), trailOffset: num(a[10]), comment: str(a[12]),
    });
    return NaN;
  },
};
NATIVES['strategy.cancel'] = { params: ['id'], fn: (a, x) => { broker(x).cancel(str(a[0])); return NaN; } };
NATIVES['strategy.cancel_all'] = { params: [], fn: (a, x) => { broker(x).cancelAll(); return NaN; } };
for (const n of ['strategy.risk.allow_entry_in', 'strategy.risk.max_drawdown', 'strategy.risk.max_intraday_loss', 'strategy.risk.max_position_size', 'strategy.risk.max_cons_loss_days', 'strategy.risk.max_intraday_filled_orders'])
  NATIVES[n] = { params: ['...'], fn: () => NaN };

const sv = (f: (b: Broker, x: Ctx) => number) => (x: Ctx) => (x.broker ? f(x.broker as Broker, x) : NaN);
Object.assign(VARS, {
  'strategy.position_size': sv((b) => b.positionSize),
  'strategy.position_avg_price': sv((b) => b.avgPrice),
  'strategy.equity': sv((b, x) => b.equity(x.c[x.bar])),
  'strategy.netprofit': sv((b) => b.realized),
  'strategy.openprofit': sv((b, x) => b.openProfit(x.c[x.bar])),
  'strategy.initial_capital': sv((b) => b.cfg.initialCapital),
  'strategy.closedtrades': sv((b) => b.closed.length),
  'strategy.opentrades': sv((b) => b.lots.length),
  'strategy.wintrades': sv((b) => b.closed.filter((t) => t.pnl > 0).length),
  'strategy.losstrades': sv((b) => b.closed.filter((t) => t.pnl < 0).length),
  'strategy.eventrades': sv((b) => b.closed.filter((t) => t.pnl === 0).length),
  'strategy.grossprofit': sv((b) => b.closed.filter((t) => t.pnl > 0).reduce((s, t) => s + t.pnl, 0)),
  'strategy.grossloss': sv((b) => -b.closed.filter((t) => t.pnl < 0).reduce((s, t) => s + t.pnl, 0)),
});
void truthy;
