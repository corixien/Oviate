<script lang="ts">
  import { paper } from '$lib/paper/paper.svelte';
  import { app } from '$lib/app.svelte';
  import * as E from '$lib/paper/engine.ts';
  import Select from './Select.svelte';
  import type { OrderType, QtyMode, Tif } from '$lib/paper/engine.ts';

  const d = $derived(paper.orderDialog);
  const acc = $derived(paper.active);
  const sym = $derived(d.symbol);

  let side = $state<'buy' | 'sell'>('buy');
  let type = $state<OrderType>('market');
  let mode = $state<QtyMode>('units');
  let qtyVal = $state('1');
  let limit = $state(''), stop = $state('');
  let tif = $state<Tif>('gtc');
  let bracket = $state(false);
  let tp = $state(''), sl = $state('');
  let error = $state('');
  let wasOpen = false;

  const price = $derived(paper.prices[sym] ?? acc?.lastPrices[sym] ?? 0);
  const p = (v: number, dec = 2) => (v > 0 ? v.toFixed(price < 1 ? 5 : dec) : '—');

  $effect(() => {
    if (d.open && !wasOpen) { side = d.side; type = 'market'; mode = 'units'; qtyVal = '1'; limit = stop = tp = sl = ''; tif = 'gtc'; bracket = false; error = ''; }
    wasOpen = d.open;
  });
  $effect(() => { if (d.open) side = d.side; });

  const refPrice = $derived(type === 'limit' ? parseFloat(limit) || price : type === 'stop' ? parseFloat(stop) || price : price);
  const qty = $derived(acc ? E.resolveQty(acc, sym, mode, parseFloat(qtyVal) || 0, refPrice) : 0);
  const notional = $derived(qty * refPrice);
  const fee = $derived(acc ? (notional * acc.commissionPct) / 100 : 0);

  /** "105.5" is a price; "5%" is the move from the entry price (up for a buy's take profit and a sell's stop loss, down for the others). */
  function leg(v: string, role: 'tp' | 'sl'): number | undefined {
    const t = v.trim().replace(',', '.');
    if (t.endsWith('%')) {
      const pct = Math.abs(parseFloat(t));
      if (!(pct > 0) || !(refPrice > 0)) return undefined;
      const up = (role === 'tp') === (side === 'buy');
      return refPrice * (1 + (up ? pct : -pct) / 100);
    }
    return parseFloat(t) || undefined;
  }
  const tpPx = $derived(leg(tp, 'tp')), slPx = $derived(leg(sl, 'sl'));
  const input = $derived<E.OrderInput>({
    symbol: sym, side, type, qty,
    limit: type === 'limit' ? parseFloat(limit) || undefined : undefined,
    stop: type === 'stop' ? parseFloat(stop) || undefined : undefined,
    tif, bracket: bracket ? { takeProfit: tpPx, stopLoss: slPx } : undefined,
  });
  const problem = $derived(acc ? (qty > 0 ? E.validate(acc, input, price) : 'Quantity rounds down to 0 for this input') : 'Create a paper account first');
  const label = $derived(`${side === 'buy' ? 'Buy' : 'Sell'} ${qty || ''} ${sym} ${type === 'market' ? '@ market' : type.replace('_', ' ')}`);

  const close = () => (paper.orderDialog = { ...paper.orderDialog, open: false });
  function submit() {
    if (!acc || problem) { error = problem ?? ''; return; }
    const r = paper.place(acc.id, input);
    if (r.error) { error = r.error; return; }
    app.notify(r.order.status === 'filled' ? `${side === 'buy' ? 'Bought' : 'Sold'} ${r.order.qty} ${sym} @ ${r.order.fillPrice?.toFixed(2)}` : `Order placed: ${type.replace('_', ' ')} ${side} ${qty} ${sym}`);
    paper.panelOpen = true;
    close();
  }

  const TYPES: { id: OrderType; name: string }[] = [
    { id: 'market', name: 'Market' }, { id: 'limit', name: 'Limit' }, { id: 'stop', name: 'Stop' },
  ];
  const tip = $derived<Partial<Record<OrderType, { what: string; ex: string }>>>({
    market: {
      what: 'Executes right away at the best available price. Fast and certain, but the exact price can differ from what you see.',
      ex: `Example: ${sym} trades at ${p(price)}. "Buy 10 at market" fills immediately at about ${p(price)} per share.`,
    },
    limit: {
      what: 'Buy: only at your limit price or lower. Sell: only at your limit price or higher. You control the price, but the order may never fill.',
      ex: `Example: ${sym} is at ${p(price)}. A buy limit at ${p(price * 0.98)} waits until the price drops to ${p(price * 0.98)}, then buys.`,
    },
    stop: {
      what: 'Dormant until the price reaches the stop price, then becomes a market order. Used for stop-losses and breakout entries.',
      ex: `Example: you own ${sym} bought near ${p(price)}. A sell stop at ${p(price * 0.95)} sells at market once the price falls to ${p(price * 0.95)} to limit your loss.`,
    },
  });
  const tifTip = { gtc: 'Good till cancelled: stays active until it fills or you cancel it.', day: 'Valid until the end of the trading day (UTC), then it expires automatically.' };
</script>

<svelte:window onkeydown={(e) => { if (d.open) { if (e.key === 'Escape') close(); else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit(); } }} />

{#if d.open}
  <div class="scrim" onpointerdown={close} role="presentation">
    <div class="card" onpointerdown={(e) => e.stopPropagation()} role="dialog" tabindex="-1" aria-label="Order">
      <header>
        <h2>{sym}</h2>
        <span class="px">{price ? p(price) : 'no price yet'}</span>
        <div class="side">
          <button class="b" class:on={side === 'buy'} onclick={() => (side = 'buy')}>Buy</button>
          <button class="s" class:on={side === 'sell'} onclick={() => (side = 'sell')}>Sell</button>
        </div>
        <button class="x" onclick={close} aria-label="Close">×</button>
      </header>

      <section>
        <div class="row">
          <span class="lab">Account</span>
          <div class="acct">
            {#if paper.accounts.length}
              <Select value={paper.activeId} options={paper.accounts.map((a) => ({ value: a.id, label: a.name }))} onchange={(v) => { paper.activeId = v; paper.persist(); }} width="170px" />
            {/if}
            <button class="mini" onclick={() => (paper.accountDialog = true)}>+ New</button>
          </div>
        </div>
        {#if acc}
          <div class="meta">
            <span>Equity <b>{E.equity(acc).toFixed(2)}</b></span>
            <span>Buying power <b>{E.buyingPower(acc).toFixed(2)}</b></span>
            <span>Leverage <b>{acc.leverage}x</b></span>
            {#if E.positionOf(acc, sym)}<span>Position <b>{E.positionOf(acc, sym)!.qty}</b></span>{/if}
          </div>
        {/if}

        <div class="row top">
          <span class="lab">Order type</span>
          <div class="types">
            {#each TYPES as t}
              <div class="tipwrap">
                <button class:on={type === t.id} onclick={() => (type = t.id)}>{t.name}</button>
                <div class="bubble"><b>{t.name}</b><p>{tip[t.id]?.what}</p><p class="ex">{tip[t.id]?.ex}</p></div>
              </div>
            {/each}
          </div>
        </div>

        {#if type === 'limit'}
          <label class="row"><span class="lab">Limit price</span><span class="inp"><input type="number" step="any" bind:value={limit} placeholder={p(price)} /></span></label>
        {/if}
        {#if type === 'stop'}
          <label class="row"><span class="lab">Stop price</span><span class="inp"><input type="number" step="any" bind:value={stop} placeholder={p(price)} /></span></label>
        {/if}
        <div class="row top">
          <span class="lab">Quantity</span>
          <div class="qty">
            <div class="inp">
              <input type="number" min="0" step="any" bind:value={qtyVal} placeholder="0" />
              <Select value={mode} options={[{ value: 'units', label: sym.includes('/') ? 'Units' : 'Shares' }, { value: 'cash', label: 'Amount ($)' }, { value: 'percent', label: '% of buying power' }]} onchange={(v) => (mode = v as QtyMode)} width="170px" />
            </div>
            <div class="calc">= <b>{qty}</b> {sym.includes('/') ? 'units' : 'shares'} <span>≈ {notional.toFixed(2)} {acc?.currency ?? 'USD'}</span>{#if mode !== 'units'} <em>(rounded down)</em>{/if}</div>
          </div>
        </div>

        <div class="row">
          <span class="lab">Time in force</span>
          <div class="types">
            {#each [['gtc', 'GTC'], ['day', 'Day']] as [id, nm]}
              <div class="tipwrap"><button class:on={tif === id} onclick={() => (tif = id as Tif)}>{nm}</button><div class="bubble small"><p>{tifTip[id as Tif]}</p></div></div>
            {/each}
          </div>
        </div>

        <div class="row top">
          <span class="lab">Bracket</span>
          <div class="qty">
            <div class="tipwrap">
              <label class="chk"><input type="checkbox" bind:checked={bracket} /> Take profit / Stop loss</label>
              <div class="bubble small"><p>Attach a take-profit (limit) and a stop-loss (stop) to the order. When your order fills, both are placed as a pair: when one fills, the other is cancelled (OCO).</p></div>
            </div>
            {#if bracket}
              <div class="inp"><input type="text" inputmode="decimal" bind:value={tp} placeholder="Take profit: price or % (5%)" />{#if tp.trim().endsWith('%') && tpPx}<small>= {p(tpPx)}</small>{/if}</div>
              <div class="inp"><input type="text" inputmode="decimal" bind:value={sl} placeholder="Stop loss: price or % (2%)" />{#if sl.trim().endsWith('%') && slPx}<small>= {p(slPx)}</small>{/if}</div>
            {/if}
          </div>
        </div>

        <div class="sum">
          <span>Est. value <b>{notional.toFixed(2)}</b></span>
          <span>Commission <b>{fee.toFixed(2)}</b></span>
          {#if acc}<span>Buying power after <b>{Math.max(0, E.buyingPower(acc) - (qty > 0 ? Math.max(0, Math.abs((E.positionOf(acc, sym)?.qty ?? 0) + (side === 'buy' ? qty : -qty)) - Math.abs(E.positionOf(acc, sym)?.qty ?? 0)) * refPrice : 0)).toFixed(2)}</b></span>{/if}
        </div>
        {#if error || (problem && qty > 0 && acc)}<p class="err">{error || problem}</p>{/if}
      </section>

      <footer>
        <button onclick={close}>Cancel</button>
        <button class="go" class:buy={side === 'buy'} class:sell={side === 'sell'} disabled={!!problem} onclick={submit}>{label}</button>
      </footer>
    </div>
  </div>
{/if}

<style>
  .scrim { position: fixed; inset: 0; z-index: 94; display: grid; place-items: center; background: rgba(0, 0, 0, 0.7); }
  .card { width: min(560px, calc(100vw - 24px)); max-height: 92vh; overflow: visible; background: var(--glass); border: 1px solid var(--glass-line); box-shadow: 0 0 0 1px rgba(168, 85, 247, 0.22), 0 30px 90px rgba(0, 0, 0, 0.7); }
  header { display: flex; align-items: center; gap: 14px; padding: 12px 18px; border-bottom: 1px solid var(--line); }
  h2 { margin: 0; font-size: 18px; } .px { font: 600 15px ui-monospace, monospace; color: var(--dim); flex: 1; }
  .side { display: flex; border: 1px solid var(--line); }
  .side button { background: none; border: 0; padding: 7px 18px; font: 800 12px system-ui, sans-serif; letter-spacing: 0.06em; text-transform: uppercase; cursor: pointer; color: var(--dim); }
  .side .b.on { background: var(--up); color: #000; } .side .s.on { background: var(--down); color: #000; }
  .x { background: none; border: 0; color: var(--dim); font-size: 22px; cursor: pointer; } .x:hover { color: var(--fg); }
  section { padding: 6px 18px 12px; }
  .row { display: flex; align-items: center; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--line); }
  .row.top { align-items: flex-start; }
  .lab { width: 104px; flex: none; font-size: 12px; color: var(--dim); padding-top: 2px; }
  .meta { display: flex; gap: 16px; flex-wrap: wrap; padding: 6px 0 4px; font-size: 11.5px; color: var(--dim); } .meta b { color: var(--fg); font-family: ui-monospace, monospace; margin-left: 4px; }
  .acct, .inp { display: flex; gap: 6px; align-items: center; flex: 1; }
  .inp small { color: var(--dim); font: 11px ui-monospace, monospace; white-space: nowrap; }
  .types { display: flex; flex-wrap: wrap; gap: 0; }
  .types button { background: none; border: 1px solid var(--line); margin-right: -1px; color: var(--fg); padding: 6px 11px; font: 600 12px system-ui, sans-serif; cursor: pointer; }
  .types button.on { background: var(--accent); border-color: var(--accent); color: #fff; position: relative; z-index: 1; }
  .types button:hover:not(.on) { border-color: var(--accent); position: relative; z-index: 1; }
  input[type='number'], input[type='text'] { box-sizing: border-box; height: 30px; background: #000; border: 1px solid var(--line); color: var(--fg); padding: 0 9px; font: 13px ui-monospace, monospace; outline: none; min-width: 0; }
  input[type='number'], input[type='text'] { flex: 1; } input:focus, select:focus { border-color: var(--accent); }
  .qty { flex: 1; display: flex; flex-direction: column; gap: 6px; }
  .mini { background: none; border: 1px solid var(--line); color: var(--dim); padding: 0 12px; height: 30px; box-sizing: border-box; font: 600 12px system-ui, sans-serif; cursor: pointer; }
  .mini:hover { border-color: var(--accent); color: var(--fg); }
  .calc { font-size: 12px; color: var(--dim); } .calc b { color: var(--fg); font-size: 14px; font-family: ui-monospace, monospace; } .calc em { font-size: 11px; opacity: 0.8; }
  .chk { display: flex; gap: 8px; align-items: center; font-size: 13px; cursor: pointer; } .chk input { accent-color: var(--accent); width: 15px; height: 15px; }
  .sum { display: flex; gap: 16px; flex-wrap: wrap; padding: 10px 0 2px; font-size: 12px; color: var(--dim); } .sum b { color: var(--fg); font-family: ui-monospace, monospace; margin-left: 4px; }
  .err { color: var(--down); font-size: 12.5px; margin: 8px 0 0; }
  footer { display: flex; justify-content: flex-end; gap: 10px; padding: 12px 18px; border-top: 1px solid var(--line); }
  footer button { font: 700 13px system-ui, sans-serif; padding: 10px 18px; border: 1px solid var(--glass-line); background: none; color: var(--fg); cursor: pointer; }
  footer .go { text-transform: none; min-width: 200px; color: #000; border: 0; } footer .go.buy { background: var(--up); } footer .go.sell { background: var(--down); } footer .go:disabled { opacity: 0.35; cursor: not-allowed; }
  /* tooltips */
  .tipwrap { position: relative; display: inline-block; }
  .bubble { display: none; position: absolute; left: 0; top: calc(100% + 8px); z-index: 20; width: 300px; padding: 10px 12px; background: #0d0718; border: 1px solid var(--accent); box-shadow: 0 10px 30px rgba(0, 0, 0, 0.7); font-size: 12px; line-height: 1.45; color: var(--fg); }
  .bubble.small { width: 240px; }
  .bubble b { color: var(--accent); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; }
  .bubble p { margin: 5px 0 0; } .bubble .ex { color: var(--dim); font-family: ui-monospace, monospace; font-size: 11.5px; }
  .tipwrap:hover > .bubble { display: block; }
</style>
