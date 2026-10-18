import { kvGet, kvSet } from '../api';
import * as E from './engine.ts';
import type { Account, OrderInput, PaperOrder, Quote } from './engine.ts';
import type { PendingOrder, StrategyConfig } from '../pine/types.ts';

export type PanelTab = 'paper' | 'tester';
export type PaperSub = 'positions' | 'orders' | 'history' | 'stats' | 'equity';

export interface LiveStrategy { uid: string; accountId: string; symbol: string; name: string; lastBar: number }

const now = () => Math.floor(Date.now() / 1000);

class Paper {
  accounts = $state<Account[]>([]);
  activeId = $state('');
  panelOpen = $state(false);
  panelTab = $state<PanelTab>('paper');
  sub = $state<PaperSub>('positions');
  panelHeight = $state(300);
  live = $state<LiveStrategy[]>([]);
  /** Latest known price per symbol, independent of any account. */
  prices = $state<Record<string, number>>({});
  /** dialogs */
  orderDialog = $state<{ open: boolean; side: 'buy' | 'sell'; symbol: string }>({ open: false, side: 'buy', symbol: '' });
  accountDialog = $state(false);
  ready = $state(false);

  get active(): Account | undefined { return this.accounts.find((a) => a.id === this.activeId) ?? this.accounts[0]; }

  async load() {
    try {
      const raw = await kvGet('paper');
      if (raw) {
        const s = JSON.parse(raw);
        this.accounts = s.accounts ?? [];
        this.activeId = s.activeId ?? this.accounts[0]?.id ?? '';
        this.panelOpen = s.panelOpen ?? false;
        this.panelTab = s.panelTab ?? 'paper';
        this.sub = s.sub ?? 'positions';
        this.panelHeight = s.panelHeight ?? 300;
        this.live = s.live ?? [];
      }
    } catch { /* corrupt state: start empty */ }
    this.ready = true;
  }

  private timer: ReturnType<typeof setTimeout> | undefined;
  persist() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      kvSet('paper', JSON.stringify({
        accounts: $state.snapshot(this.accounts), activeId: this.activeId, panelOpen: this.panelOpen, panelTab: this.panelTab,
        sub: this.sub, panelHeight: this.panelHeight, live: $state.snapshot(this.live),
      }));
    }, 600);
  }

  // ---------- accounts ----------
  create(name: string, initialCapital: number, leverage: number, commissionPct: number): Account {
    const acc = E.newAccount({ id: crypto.randomUUID().slice(0, 8), name: name.trim() || `Account ${this.accounts.length + 1}`, initialCapital, leverage, commissionPct, now: now() });
    acc.lastPrices = { ...this.prices };
    this.accounts.push(acc);
    this.activeId = acc.id;
    this.persist();
    return this.accounts[this.accounts.length - 1];
  }

  remove(id: string) {
    this.accounts = this.accounts.filter((a) => a.id !== id);
    this.live = this.live.filter((l) => l.accountId !== id);
    if (this.activeId === id) this.activeId = this.accounts[0]?.id ?? '';
    this.persist();
  }

  reset(id: string) {
    const a = this.accounts.find((x) => x.id === id);
    if (!a) return;
    const fresh = E.newAccount({ id: a.id, name: a.name, initialCapital: a.initialCapital, leverage: a.leverage, commissionPct: a.commissionPct, currency: a.currency, now: now() });
    Object.assign(a, { ...fresh, lastPrices: a.lastPrices });
    this.persist();
  }

  // ---------- trading ----------
  place(accountId: string, input: OrderInput): { order: PaperOrder; error?: string } {
    const acc = this.accounts.find((a) => a.id === accountId);
    if (!acc) throw new Error('No paper account');
    const known = this.prices[input.symbol];
    if (known > 0) acc.lastPrices[input.symbol] = known;
    const r = E.placeOrder(acc, input, now());
    E.recordEquity(acc, now(), 0);
    this.persist();
    return r;
  }

  cancel(accountId: string, orderId: string) {
    const acc = this.accounts.find((a) => a.id === accountId);
    if (acc) { E.cancelOrder(acc, orderId); this.persist(); }
  }

  closePosition(accountId: string, symbol: string, qty?: number) {
    const acc = this.accounts.find((a) => a.id === accountId);
    if (!acc) return;
    E.closePosition(acc, symbol, now(), qty);
    E.recordEquity(acc, now(), 0);
    this.persist();
  }

  /** Price feed from the charts: evaluates working orders on every account. */
  feed(symbol: string, q: Quote) {
    this.prices[symbol] = q.last;
    let changed = false;
    for (const acc of this.accounts) {
      const hasWork = acc.orders.some((o) => o.symbol === symbol && o.status === 'open') || acc.positions.some((p) => p.symbol === symbol);
      if (!hasWork) { acc.lastPrices[symbol] = q.last; continue; }
      const before = acc.orders.filter((o) => o.status !== 'open').length + acc.trades.length;
      E.processOrders(acc, symbol, q);
      E.recordEquity(acc, q.t, 30);
      if (acc.orders.filter((o) => o.status !== 'open').length + acc.trades.length !== before) changed = true;
    }
    if (changed) this.persist();
  }

  // ---------- strategy signals ----------
  /** Turn the orders a strategy has pending on the last closed bar into paper orders. */
  applySignals(accountId: string, symbol: string, pending: PendingOrder[], cfg: StrategyConfig, name: string) {
    const acc = this.accounts.find((a) => a.id === accountId);
    if (!acc) return;
    const price = acc.lastPrices[symbol];
    if (!(price > 0)) return;
    const pos = () => E.positionOf(acc, symbol)?.qty ?? 0;
    const qtyFor = (q: number) => {
      if (!Number.isNaN(q) && q > 0) return E.floorQty(q, symbol);
      if (cfg.qtyType === 'cash') return E.floorQty(cfg.qtyValue / price, symbol);
      if (cfg.qtyType === 'percent_of_equity') return E.floorQty((E.equity(acc) * (cfg.qtyValue / 100)) / price, symbol);
      return E.floorQty(cfg.qtyValue, symbol);
    };
    const src = `strategy:${name}`;
    // replace this strategy's previous protective exits
    for (const o of acc.orders) if (o.status === 'open' && o.symbol === symbol && o.source === src && o.oco?.startsWith('strat-exit')) E.cancelOrder(acc, o.id, 'Replaced');
    for (const p of pending) {
      if (p.kind === 'close_all' || p.kind === 'close') { if (pos() !== 0) E.closePosition(acc, symbol, now(), undefined, src); continue; }
      if (p.kind === 'entry' || p.kind === 'order') {
        const buy = p.dir === 'long';
        const cur = pos();
        const same = cur !== 0 && Math.sign(cur) === (buy ? 1 : -1);
        if (p.kind === 'entry' && same && cfg.pyramiding === 0) continue;
        const q = qtyFor(p.qty);
        if (q <= 0) continue;
        const total = p.kind === 'entry' && cur !== 0 && !same ? q + Math.abs(cur) : q;
        const type = p.limit !== undefined && p.stop !== undefined ? 'stop_limit' : p.limit !== undefined ? 'limit' : p.stop !== undefined ? 'stop' : 'market';
        E.placeOrder(acc, { symbol, side: buy ? 'buy' : 'sell', type, qty: total, limit: p.limit, stop: p.stop, source: src }, now());
        continue;
      }
      if (p.kind === 'exit' && pos() !== 0 && (p.exitStop || p.exitLimit)) {
        const long = pos() > 0;
        const q = Math.abs(pos());
        const group = `strat-exit-${symbol}`;
        if (p.exitLimit) E.placeOrder(acc, { symbol, side: long ? 'sell' : 'buy', type: 'limit', qty: q, limit: p.exitLimit, reduceOnly: true, oco: group, source: src }, now());
        if (p.exitStop) E.placeOrder(acc, { symbol, side: long ? 'sell' : 'buy', type: 'stop', qty: q, stop: p.exitStop, reduceOnly: true, oco: group, source: src }, now());
      }
    }
    E.recordEquity(acc, now(), 0);
    this.persist();
  }
}

export const paper = new Paper();
