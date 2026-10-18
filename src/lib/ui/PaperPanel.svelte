<script lang="ts">
  import { paper, type PaperSub } from '$lib/paper/paper.svelte';
  import { app } from '$lib/app.svelte';
  import * as E from '$lib/paper/engine.ts';
  import { fmtPrice } from '$lib/chart/renderer';

  const acc = $derived(paper.active);
  const st = $derived(acc ? E.accountStats(acc) : null);
  const tester = $derived(app.strategyResults[app.chart.id]);

  const money = (v: number, d = 2) => (Number.isFinite(v) ? v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');
  const signed = (v: number, d = 2) => (v >= 0 ? '+' : '') + money(v, d);
  const cls = (v: number) => (v > 0 ? 'up' : v < 0 ? 'dn' : '');
  const when = (t: number) => (t ? new Date(t * 1000).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'medium' }) : '—');
  const pf = (v: number) => (v === Infinity ? '∞' : v.toFixed(2));

  let ordersFilter = $state<'open' | 'all'>('open');
  const orders = $derived([...(acc?.orders ?? [])].reverse().filter((o) => ordersFilter === 'all' || o.status === 'open'));
  const trades = $derived([...(acc?.trades ?? [])].reverse());

  const SUBS: [PaperSub, string][] = [['positions', 'Positions'], ['orders', 'Orders'], ['history', 'History'], ['stats', 'Statistics'], ['equity', 'Equity']];

  function setTab(t: 'paper' | 'tester') { paper.panelTab = t; paper.panelOpen = true; paper.persist(); }
  function toggle() { paper.panelOpen = !paper.panelOpen; paper.persist(); }

  // ----- drag to resize -----
  function startResize(e: PointerEvent) {
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const startY = e.clientY, startH = paper.panelHeight;
    const move = (ev: PointerEvent) => { paper.panelHeight = Math.min(Math.max(160, startH + (startY - ev.clientY)), window.innerHeight * 0.7); };
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); paper.persist(); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up);
  }

  // ----- equity svg -----
  function curve(pts: number[], w = 800, h = 150) {
    if (pts.length < 2) return { path: '', lo: 0, hi: 0, y0: h / 2 };
    const lo = Math.min(...pts), hi = Math.max(...pts), span = hi - lo || 1;
    const path = pts.map((v, i) => `${i ? 'L' : 'M'}${((i / (pts.length - 1)) * w).toFixed(1)},${(h - 6 - ((v - lo) / span) * (h - 12)).toFixed(1)}`).join('');
    return { path, lo, hi, y0: h - 6 - (((pts[0]) - lo) / span) * (h - 12) };
  }
  const paperCurve = $derived(curve((acc?.equityCurve ?? []).map((p) => p.eq)));

  // ----- strategy tester -----
  const sres = $derived(tester?.result.strategy);
  const sClosed = $derived((sres?.trades ?? []).filter((t) => !t.open));
  const sStats = $derived.by(() => {
    if (!sres) return null;
    const eq = Array.from(sres.equity).filter((v) => Number.isFinite(v));
    const last = eq[eq.length - 1] ?? sres.initialCapital;
    return E.statsFor(sClosed, eq.map((e) => ({ eq: e })), sres.initialCapital, last, (sres.trades.filter((t) => t.open).reduce((s, t) => s + t.pnl, 0)));
  });
  const sCurve = $derived(curve(sres ? Array.from(sres.equity).filter((v) => Number.isFinite(v)) : []));
  let testerSub = $state<'overview' | 'trades'>('overview');
  const sTrades = $derived([...(sres?.trades ?? [])].reverse());

  const deleteAcc = () => { if (acc && confirm(`Delete paper account "${acc.name}"?`)) paper.remove(acc.id); };
  const resetAcc = () => { if (acc && confirm(`Reset "${acc.name}" to its initial capital? Orders, positions and history are cleared.`)) paper.reset(acc.id); };
</script>

<div class="panel" class:open={paper.panelOpen} style:height={paper.panelOpen ? paper.panelHeight + 'px' : '38px'}>
  {#if paper.panelOpen}<div class="grip" onpointerdown={startResize} role="separator" aria-orientation="horizontal"></div>{/if}
  <div class="bar">
    <div class="tabs">
      <button class:on={paper.panelOpen && paper.panelTab === 'paper'} onclick={() => setTab('paper')}>Paper Trading</button>
      <button class:on={paper.panelOpen && paper.panelTab === 'tester'} onclick={() => setTab('tester')}>Strategy Tester</button>
    </div>
    {#if acc}
      <span class="sum">{acc.name}<b>{money(E.equity(acc))}</b><b class={cls(E.equity(acc) - acc.initialCapital)}>{signed(E.equity(acc) - acc.initialCapital)}</b></span>
    {/if}
    <div class="sp"></div>
    <button class="chev" onclick={toggle} title={paper.panelOpen ? 'Collapse' : 'Expand'}>{paper.panelOpen ? '⌄' : '⌃'}</button>
  </div>

  {#if paper.panelOpen}
    {#if paper.panelTab === 'paper'}
      {#if !acc}
        <div class="empty"><p>No paper account yet.</p><button class="primary" onclick={() => (paper.accountDialog = true)}>Create paper account</button></div>
      {:else}
        <div class="acc">
          <select value={acc.id} onchange={(e) => { paper.activeId = e.currentTarget.value; paper.persist(); }}>{#each paper.accounts as a (a.id)}<option value={a.id}>{a.name}</option>{/each}</select>
          <button class="mini" onclick={() => (paper.accountDialog = true)}>+ New</button>
          <span class="m">Balance <b>{money(acc.balance)}</b></span>
          <span class="m">Equity <b>{money(E.equity(acc))}</b></span>
          <span class="m">Open P&L <b class={cls(E.unrealized(acc))}>{signed(E.unrealized(acc))}</b></span>
          <span class="m">Buying power <b>{money(E.buyingPower(acc))}</b></span>
          <span class="m">Leverage <b>{acc.leverage}x</b></span>
          <span class="m">Commission <b>{acc.commissionPct}%</b></span>
          <div class="sp"></div>
          <button class="mini" onclick={resetAcc}>Reset</button>
          <button class="mini del" onclick={deleteAcc}>Delete</button>
        </div>
        <div class="subs">
          {#each SUBS as [id, nm]}<button class:on={paper.sub === id} onclick={() => { paper.sub = id; paper.persist(); }}>{nm}{#if id === 'orders'}<i>{acc.orders.filter((o) => o.status === 'open').length}</i>{:else if id === 'positions'}<i>{acc.positions.length}</i>{/if}</button>{/each}
          {#if paper.sub === 'orders'}<div class="sp"></div><button class="mini" onclick={() => (ordersFilter = ordersFilter === 'open' ? 'all' : 'open')}>{ordersFilter === 'open' ? 'Show all' : 'Open only'}</button>{/if}
        </div>
        <div class="body">
          {#if paper.sub === 'positions'}
            <table>
              <thead><tr><th>Symbol</th><th>Side</th><th>Qty</th><th>Avg price</th><th>Last</th><th>Value</th><th>P&L</th><th>P&L %</th><th></th></tr></thead>
              <tbody>
                {#each acc.positions as p (p.symbol)}
                  {@const last = acc.lastPrices[p.symbol] ?? p.avgPrice}
                  {@const pnl = p.qty * (last - p.avgPrice)}
                  <tr>
                    <td><b>{p.symbol}</b></td><td class={p.qty > 0 ? 'up' : 'dn'}>{p.qty > 0 ? 'Long' : 'Short'}</td><td>{Math.abs(p.qty)}</td><td>{fmtPrice(p.avgPrice)}</td><td>{fmtPrice(last)}</td>
                    <td>{money(Math.abs(p.qty) * last)}</td><td class={cls(pnl)}>{signed(pnl)}</td><td class={cls(pnl)}>{signed((pnl / (Math.abs(p.qty) * p.avgPrice)) * 100)}%</td>
                    <td class="act"><button class="mini" onclick={() => paper.closePosition(acc.id, p.symbol)}>Close</button><button class="mini" onclick={() => { app.chart.symbol = p.symbol; }}>Chart</button></td>
                  </tr>
                {:else}<tr><td colspan="9" class="none">No open positions.</td></tr>{/each}
              </tbody>
            </table>
          {:else if paper.sub === 'orders'}
            <table>
              <thead><tr><th>Time</th><th>Symbol</th><th>Side</th><th>Type</th><th>Qty</th><th>Price</th><th>Status</th><th>Source</th><th></th></tr></thead>
              <tbody>
                {#each orders as o (o.id)}
                  <tr>
                    <td>{when(o.filledAt ?? o.createdAt)}</td><td><b>{o.symbol}</b></td><td class={o.side === 'buy' ? 'up' : 'dn'}>{o.side}</td><td>{o.type.replace('_', ' ')}{o.tif === 'day' ? ' · day' : ''}</td><td>{o.qty}</td>
                    <td>{o.fillPrice ? fmtPrice(o.fillPrice) : [o.stop ? 'stop ' + fmtPrice(o.stop) : '', o.limit ? 'limit ' + fmtPrice(o.limit) : '', o.trailAmount ? 'trail ' + o.trailAmount : '', o.trailPercent ? 'trail ' + o.trailPercent + '%' : ''].filter(Boolean).join(' · ') || 'market'}</td>
                    <td class="st {o.status}">{o.status}{o.note ? ' · ' + o.note : ''}</td><td class="dim">{o.source}</td>
                    <td class="act">{#if o.status === 'open'}<button class="mini" onclick={() => paper.cancel(acc.id, o.id)}>Cancel</button>{/if}</td>
                  </tr>
                {:else}<tr><td colspan="9" class="none">No orders.</td></tr>{/each}
              </tbody>
            </table>
          {:else if paper.sub === 'history'}
            <table>
              <thead><tr><th>Closed</th><th>Symbol</th><th>Side</th><th>Qty</th><th>Entry</th><th>Exit</th><th>P&L</th><th>Fees</th><th>Exit reason</th><th>Source</th></tr></thead>
              <tbody>
                {#each trades as t (t.id)}
                  <tr><td>{when(t.exitTime)}</td><td><b>{t.symbol}</b></td><td class={t.side === 'long' ? 'up' : 'dn'}>{t.side}</td><td>{t.qty}</td><td>{fmtPrice(t.entryPrice)}</td><td>{fmtPrice(t.exitPrice)}</td>
                    <td class={cls(t.pnl)}>{signed(t.pnl)}</td><td>{money(t.commission)}</td><td>{t.reason}</td><td class="dim">{t.source}</td></tr>
                {:else}<tr><td colspan="10" class="none">No closed trades yet.</td></tr>{/each}
              </tbody>
            </table>
          {:else if paper.sub === 'stats' && st}
            <div class="grid">
              {#each [['Net profit', signed(st.netProfit), cls(st.netProfit)], ['Return', signed(st.returnPct) + '%', cls(st.returnPct)], ['Trades', String(st.trades), ''], ['Win rate', st.winRate.toFixed(1) + '%', ''],
                ['Profit factor', pf(st.profitFactor), ''], ['Avg trade', signed(st.avgTrade), cls(st.avgTrade)], ['Avg win', signed(st.avgWin), 'up'], ['Avg loss', signed(st.avgLoss), 'dn'],
                ['Best trade', signed(st.best), 'up'], ['Worst trade', signed(st.worst), 'dn'], ['Max drawdown', money(st.maxDrawdown) + ' (' + st.maxDrawdownPct.toFixed(1) + '%)', 'dn'], ['Fees paid', money(st.commission), '']] as [k, v, c]}
                <div class="cell"><span>{k}</span><b class={c}>{v}</b></div>
              {/each}
            </div>
          {:else if paper.sub === 'equity'}
            <svg viewBox="0 0 800 150" preserveAspectRatio="none" class="eq">
              <line x1="0" x2="800" y1={paperCurve.y0} y2={paperCurve.y0} class="base" />
              <path d={paperCurve.path} fill="none" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke" />
            </svg>
            <div class="eqinfo"><span>Low {money(paperCurve.lo)}</span><span>High {money(paperCurve.hi)}</span><span>{acc.equityCurve.length} points</span></div>
          {/if}
        </div>
      {/if}
    {:else}
      {#if !tester || !sres || !sStats}
        <div class="empty"><p>No strategy on the active chart.</p><p class="dim">Type <kbd>/strat add</kbd> in the command bar to add one, or <kbd>/strat add new</kbd> to write your own in Pine.</p></div>
      {:else}
        <div class="acc">
          <b class="sname">{tester.name}</b><span class="dim">{tester.symbol} · {tester.tf.toUpperCase()}</span>
          <span class="m">Net profit <b class={cls(sStats.netProfit)}>{signed(sStats.netProfit)}</b></span>
          <span class="m">Return <b class={cls(sStats.returnPct)}>{signed(sStats.returnPct)}%</b></span>
          <span class="m">Trades <b>{sStats.trades}</b></span>
          <span class="m">Win rate <b>{sStats.winRate.toFixed(1)}%</b></span>
          <span class="m">Profit factor <b>{pf(sStats.profitFactor)}</b></span>
          <span class="m">Max DD <b class="dn">{sStats.maxDrawdownPct.toFixed(1)}%</b></span>
        </div>
        <div class="subs">
          <button class:on={testerSub === 'overview'} onclick={() => (testerSub = 'overview')}>Overview</button>
          <button class:on={testerSub === 'trades'} onclick={() => (testerSub = 'trades')}>Trades<i>{sres.trades.length}</i></button>
        </div>
        <div class="body">
          {#if testerSub === 'overview'}
            <svg viewBox="0 0 800 150" preserveAspectRatio="none" class="eq small">
              <line x1="0" x2="800" y1={sCurve.y0} y2={sCurve.y0} class="base" />
              <path d={sCurve.path} fill="none" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke" />
            </svg>
            <div class="grid">
              {#each [['Initial capital', money(sres.initialCapital), ''], ['Final equity', money(sStats.equity), cls(sStats.equity - sres.initialCapital)], ['Open P&L', signed(sStats.openPnl), cls(sStats.openPnl)], ['Gross profit', money(sStats.grossProfit), 'up'],
                ['Gross loss', money(sStats.grossLoss), 'dn'], ['Avg trade', signed(sStats.avgTrade), cls(sStats.avgTrade)], ['Avg win', signed(sStats.avgWin), 'up'], ['Avg loss', signed(sStats.avgLoss), 'dn'],
                ['Best trade', signed(sStats.best), 'up'], ['Worst trade', signed(sStats.worst), 'dn'], ['Max drawdown', money(sStats.maxDrawdown), 'dn'], ['Fees', money(sStats.commission), '']] as [k, v, c]}
                <div class="cell"><span>{k}</span><b class={c}>{v}</b></div>
              {/each}
            </div>
          {:else}
            <table>
              <thead><tr><th>#</th><th>Entry</th><th>Exit</th><th>Side</th><th>Qty</th><th>Entry px</th><th>Exit px</th><th>P&L</th><th>Run-up</th><th>Drawdown</th></tr></thead>
              <tbody>
                {#each sTrades as t, i}
                  <tr><td>{sTrades.length - i}</td><td>{when(t.entryTime)}</td><td>{t.open ? 'open' : when(t.exitTime)}</td><td class={t.dir === 'long' ? 'up' : 'dn'}>{t.dir}</td><td>{+t.qty.toFixed(4)}</td><td>{fmtPrice(t.entryPrice)}</td><td>{fmtPrice(t.exitPrice)}</td>
                    <td class={cls(t.pnl)}>{signed(t.pnl)}</td><td class="up">{money(t.mfe)}</td><td class="dn">{money(t.mae)}</td></tr>
                {:else}<tr><td colspan="10" class="none">The strategy has not traded on this data.</td></tr>{/each}
              </tbody>
            </table>
          {/if}
        </div>
      {/if}
    {/if}
  {/if}
</div>

<style>
  .panel { flex: none; position: relative; display: flex; flex-direction: column; border-top: 1px solid var(--line); background: var(--bar); min-height: 0; overflow: hidden; }
  .grip { position: absolute; top: -3px; left: 0; right: 0; height: 7px; cursor: row-resize; z-index: 5; }
  .grip:hover { background: var(--accent); opacity: 0.6; }
  .bar { display: flex; align-items: center; gap: 14px; padding: 0 12px; height: 38px; flex: none; border-bottom: 1px solid var(--line); }
  .tabs { display: flex; gap: 2px; height: 100%; }
  .tabs button { background: none; border: 0; border-bottom: 2px solid transparent; color: var(--dim); padding: 0 14px; font: 700 12px system-ui, sans-serif; letter-spacing: 0.06em; text-transform: uppercase; cursor: pointer; }
  .tabs button:hover { color: var(--fg); } .tabs button.on { color: var(--accent); border-bottom-color: var(--accent); }
  .sum { font: 12px ui-monospace, monospace; color: var(--dim); display: flex; gap: 10px; } .sum b { color: var(--fg); }
  .sp { flex: 1; }
  .chev { background: none; border: 1px solid var(--line); color: var(--fg); width: 28px; height: 24px; cursor: pointer; font-size: 15px; line-height: 1; }
  .chev:hover { border-color: var(--accent); color: var(--accent); }
  .acc { display: flex; align-items: center; gap: 14px; padding: 8px 14px; flex-wrap: wrap; border-bottom: 1px solid var(--line); flex: none; font-size: 12px; }
  .sname { font-size: 13px; } .m { color: var(--dim); } .m b { color: var(--fg); font-family: ui-monospace, monospace; margin-left: 4px; }
  select { background: #000; border: 1px solid var(--line); color: var(--fg); padding: 5px 8px; font: 12px system-ui, sans-serif; outline: none; }
  select:focus { border-color: var(--accent); }
  .mini { background: none; border: 1px solid var(--line); color: var(--fg); padding: 4px 10px; font: 600 11px system-ui, sans-serif; cursor: pointer; margin-right: 4px; }
  .mini:hover { border-color: var(--accent); color: var(--accent); } .mini.del:hover { border-color: var(--down); color: var(--down); }
  .subs { display: flex; gap: 2px; padding: 0 12px; border-bottom: 1px solid var(--line); flex: none; align-items: center; }
  .subs button { background: none; border: 0; border-bottom: 2px solid transparent; color: var(--dim); padding: 7px 12px; font: 600 12px system-ui, sans-serif; cursor: pointer; }
  .subs button.on { color: var(--fg); border-bottom-color: var(--accent); } .subs button:hover { color: var(--fg); }
  .subs i { font-style: normal; background: var(--accent-soft); color: var(--accent); padding: 0 6px; margin-left: 6px; font-size: 10.5px; }
  .body { flex: 1; min-height: 0; overflow: auto; }
  table { width: 100%; border-collapse: collapse; font: 12px ui-monospace, monospace; }
  th { position: sticky; top: 0; background: var(--bar); text-align: left; color: var(--dim); font: 600 10.5px system-ui, sans-serif; letter-spacing: 0.06em; text-transform: uppercase; padding: 7px 12px; border-bottom: 1px solid var(--line); }
  td { padding: 6px 12px; border-bottom: 1px solid var(--line); white-space: nowrap; }
  tr:hover td { background: var(--hover); }
  .none { text-align: center; color: var(--dim); padding: 22px; font-family: system-ui, sans-serif; }
  .up { color: var(--up); } .dn { color: var(--down); } .dim { color: var(--dim); }
  .act { text-align: right; } td.st.open { color: var(--accent); } td.st.filled { color: var(--up); } td.st.rejected, td.st.cancelled { color: var(--dim); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 1px; background: var(--line); margin: 12px; border: 1px solid var(--line); }
  .cell { background: var(--bar); padding: 10px 12px; display: flex; flex-direction: column; gap: 3px; } .cell span { color: var(--dim); font-size: 11px; } .cell b { font: 600 14px ui-monospace, monospace; }
  .eq { width: calc(100% - 24px); height: 150px; margin: 12px; background: #000; border: 1px solid var(--line); } .eq.small { height: 110px; }
  .base { stroke: var(--line); stroke-dasharray: 4 4; } .eqinfo { display: flex; gap: 18px; padding: 0 14px 12px; color: var(--dim); font: 11.5px ui-monospace, monospace; }
  .empty { padding: 26px; text-align: center; color: var(--fg); } .empty p { margin: 6px 0; } .empty .dim { color: var(--dim); font-size: 13px; }
  .primary { background: var(--accent); border: 1px solid var(--accent); color: #fff; padding: 9px 18px; font: 700 13px system-ui, sans-serif; cursor: pointer; margin-top: 8px; }
  kbd { font: 11px ui-monospace, monospace; border: 1px solid var(--line); padding: 1px 6px; }
</style>
