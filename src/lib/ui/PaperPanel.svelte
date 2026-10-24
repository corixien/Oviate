<script lang="ts">
  import { paper, type PaperSub } from '$lib/paper/paper.svelte';
  import { app } from '$lib/app.svelte';
  import * as E from '$lib/paper/engine.ts';
  import { fmtPrice } from '$lib/chart/renderer';
  import Select from './Select.svelte';
  import OptimizerPanel from './OptimizerPanel.svelte';
  import JournalPanel from './JournalPanel.svelte';
  import { detailedStats, buyHoldCurves } from '$lib/pine/stats.ts';

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

  function setTab(t: 'paper' | 'tester' | 'optimizer' | 'journal') { paper.panelTab = t; paper.panelOpen = true; paper.persist(); }
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
  /** Equity line; y0 is the baseline (`base`, default the first value) so the part below it can be drawn red. */
  function curve(pts: number[], w = 800, h = 150, base = pts[0]) {
    if (pts.length < 2) return { path: '', lo: 0, hi: 0, y0: h / 2 };
    const lo = Math.min(...pts, base), hi = Math.max(...pts, base), span = hi - lo || 1;
    const path = pts.map((v, i) => `${i ? 'L' : 'M'}${((i / (pts.length - 1)) * w).toFixed(1)},${(h - 6 - ((v - lo) / span) * (h - 12)).toFixed(1)}`).join('');
    return { path, lo, hi, y0: h - 6 - ((base - lo) / span) * (h - 12) };
  }
  const paperCurve = $derived(curve((acc?.equityCurve ?? []).map((p) => p.eq)));

  // ----- strategy tester -----
  const sres = $derived(tester?.result.strategy);
  const dstats = $derived(sres && tester ? detailedStats(sres, { stepSec: tester.stepSec, firstClose: tester.firstClose, lastClose: tester.lastClose }) : null);
  const bhCurves = $derived(sres && tester ? buyHoldCurves(sres, tester.closes) : { full: [], invested: [] });
  // equity chart: which lines are shown and which scale they share
  // remembered choice: app.eqView is persisted with the app state
  const toggleLine = (k: 'eq' | 'bh' | 'bhi') => { app.eqView[k] = !app.eqView[k]; app.persist(); };
  const setScale = (v: 'equity' | 'all') => { app.eqView.scale = v; app.persist(); };
  const sCurve = $derived.by(() => {
    const eq = sres ? Array.from(sres.equity).filter((v) => Number.isFinite(v)) : [];
    const c = curve(eq, 800, 150, sres?.initialCapital);
    if (eq.length < 2) return { ...c, full: '', invested: '', clipped: false };
    const init = sres!.initialCapital;
    const shown = [...(app.eqView.bh ? bhCurves.full : []), ...(app.eqView.bhi ? bhCurves.invested : [])].filter((v) => Number.isFinite(v));
    const eLo = Math.min(...eq, init), eHi = Math.max(...eq, init), eSpan = eHi - eLo || 1;
    // "equity": the equity keeps its own scale and the buy & hold lines may widen it by at most 0.6 of its span (beyond that they are cut off, so a runaway
    // buy & hold cannot flatten the equity). "all lines": one scale that holds every shown line completely.
    let lo = eLo, hi = eHi;
    if (shown.length) {
      const bLo = Math.min(...shown), bHi = Math.max(...shown);
      if (app.eqView.scale === 'all') { lo = app.eqView.eq ? Math.min(eLo, bLo) : Math.min(init, bLo); hi = app.eqView.eq ? Math.max(eHi, bHi) : Math.max(init, bHi); }
      else { lo = Math.min(eLo, Math.max(bLo, eLo - eSpan * 0.6)); hi = Math.max(eHi, Math.min(bHi, eHi + eSpan * 0.6)); }
    } else if (!app.eqView.eq) { lo = init - 1; hi = init + 1; }
    const span = hi - lo || 1;
    const line = (pts: number[]) => pts.map((v, i) => `${i ? 'L' : 'M'}${((i / (pts.length - 1)) * 800).toFixed(1)},${(144 - ((v - lo) / span) * 138).toFixed(1)}`).join('');
    const clipped = shown.some((v) => v < lo || v > hi);
    return { path: line(eq), lo, hi, y0: 144 - ((init - lo) / span) * 138, full: app.eqView.bh && bhCurves.full.length > 1 ? line(bhCurves.full) : '', invested: app.eqView.bhi && bhCurves.invested.length > 1 ? line(bhCurves.invested) : '', clipped };
  });
  const endOf = (a: number[]) => (a.length ? a[a.length - 1] : NaN);
  function setT(k: 'initialCapital' | 'commissionValue' | 'slippagePct', e: Event) {
    let v = parseFloat((e.currentTarget as HTMLInputElement).value);
    if (!Number.isFinite(v) || v < 0) return;
    if (k === 'initialCapital' && v <= 0) return;
    app.tester[k] = v; app.persist();
  }
  const dur = (bars: number) => (Number.isFinite(bars) ? bars.toFixed(1) : '—');
  let testerSub = $state<'overview' | 'trades' | 'settings'>('overview');
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
      <button class:on={paper.panelOpen && paper.panelTab === 'optimizer'} onclick={() => setTab('optimizer')}>Optimizer</button>
      <button class:on={paper.panelOpen && paper.panelTab === 'journal'} onclick={() => setTab('journal')}>Journal</button>
    </div>
    <div class="sp"></div>
    <button class="chev" onclick={toggle} title={paper.panelOpen ? 'Collapse' : 'Expand'}>{paper.panelOpen ? '⌄' : '⌃'}</button>
  </div>

  {#if paper.panelOpen}
    {#if paper.panelTab === 'paper'}
      {#if !acc}
        <div class="empty"><p>No paper account yet.</p><button class="primary" onclick={() => (paper.accountDialog = true)}>Create paper account</button></div>
      {:else}
        <div class="acc">
          <Select value={acc.id} options={paper.accounts.map((a) => ({ value: a.id, label: a.name }))} onchange={(v) => { paper.activeId = v; paper.persist(); }} width="170px" />
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
    {:else if paper.panelTab === 'optimizer'}
      <OptimizerPanel />
    {:else if paper.panelTab === 'journal'}
      <JournalPanel />
    {:else}
      {#if !tester || !sres || !dstats}
        <div class="empty"><p>No strategy on the active chart.</p><p class="dim">Type <kbd>/strat add</kbd> in the command bar to add one, or <kbd>/strat add new</kbd> to write your own in Pine.</p></div>
      {:else}
        <div class="acc">
          <b class="sname">{tester.name}</b><span class="dim">{tester.symbol} · {tester.tf.toUpperCase()}</span>
          <span class="m">Net profit <b class={cls(dstats.netProfit)}>{signed(dstats.netProfit)}</b></span>
          <span class="m">Return <b class={cls(dstats.returnPct)}>{signed(dstats.returnPct)}%</b></span>
          <span class="m">Trades <b>{dstats.trades}</b></span>
          <span class="m">Win rate <b>{dstats.winRate.toFixed(1)}%</b></span>
          <span class="m">Profit factor <b>{pf(dstats.profitFactor)}</b></span>
          <span class="m">Max DD <b class="dn">{dstats.maxDrawdownPct.toFixed(1)}%</b></span>
          {#if dstats.trades === 0 && sres.trades.length > 0}<span class="m">Only one open trade: the strategy never exits (no <b>strategy.close</b> / <b>strategy.exit</b> fires).</span>{/if}
        </div>
        <div class="subs">
          <button class:on={testerSub === 'overview'} onclick={() => (testerSub = 'overview')}>Overview</button>
          <button class:on={testerSub === 'trades'} onclick={() => (testerSub = 'trades')}>Trades<i>{sres.trades.length}</i></button>
          <button class:on={testerSub === 'settings'} onclick={() => (testerSub = 'settings')}>Settings</button>
        </div>
        <div class="body">
          {#if testerSub === 'overview'}
            <h5>Equity <span class="dim">red = negative result</span></h5>
            <div class="legend">
              <button class:off={!app.eqView.eq} onclick={() => toggleLine('eq')} title="Show or hide the strategy equity"><i class="sw eq"></i>Strategy equity <b>{money(dstats.equity)}</b></button>
              <button class:off={!app.eqView.bh} onclick={() => toggleLine('bh')} title="What the same capital would be worth if you bought at the start and held to the end"><i class="sw bh"></i>Buy &amp; hold <b>{money(endOf(bhCurves.full))}</b></button>
              <button class:off={!app.eqView.bhi} onclick={() => toggleLine('bhi')} title="Buy & hold growth, applied only for the share of time the strategy was invested"><i class="sw bi"></i>Buy &amp; hold, invested time only <b>{money(endOf(bhCurves.invested))}</b></button>
              <span class="grow"></span>
              <span class="dim">Scale</span>
              <div class="mseg"><button class:on={app.eqView.scale === 'equity'} onclick={() => setScale('equity')} title="Scale to the equity; far-off buy & hold lines are cut at the edge">Equity</button><button class:on={app.eqView.scale === 'all'} onclick={() => setScale('all')} title="Scale so every shown line is fully visible">All lines</button></div>
            </div>

            <svg viewBox="0 0 800 150" preserveAspectRatio="none" class="eq">
              <line x1="0" x2="800" y1={sCurve.y0} y2={sCurve.y0} class="base" />
              {#if sCurve.full}<path d={sCurve.full} fill="none" stroke="#b9a8e6" stroke-opacity="0.7" stroke-width="1.5" vector-effect="non-scaling-stroke" />{/if}
              {#if sCurve.invested}<path d={sCurve.invested} fill="none" stroke="#22e5ff" stroke-opacity="0.75" stroke-width="1.5" stroke-dasharray="5 4" vector-effect="non-scaling-stroke" />{/if}
              {#if app.eqView.eq}
                <path d={sCurve.path} fill="none" stroke={dstats.equity < sres.initialCapital ? 'var(--down)' : 'var(--accent)'} stroke-width="2" vector-effect="non-scaling-stroke" />
              {/if}
            </svg>
            {#if sCurve.clipped}<p class="eqnote">A buy &amp; hold line leaves the chart on this scale: switch to "All lines" to see it completely.</p>{/if}
            {#each [
              ['Performance', [['Net profit', signed(dstats.netProfit), cls(dstats.netProfit)], ['Return', signed(dstats.returnPct) + '%', cls(dstats.returnPct)], ['Buy & hold, whole period', signed(dstats.buyHold) + '%', cls(dstats.buyHold)], ['Buy & hold, invested time only', signed(dstats.buyHoldInvested) + '%', cls(dstats.buyHoldInvested)],
                ['Initial capital', money(dstats.initial), ''], ['Final equity', money(dstats.equity), cls(dstats.equity - dstats.initial)], ['Profit factor', pf(dstats.profitFactor), ''], ['Fees paid', money(dstats.commission), '']]],
              ['Trades', [['Closed trades', String(dstats.trades), ''], ['Win rate', dstats.winRate.toFixed(1) + '%', ''], ['Wins / losses', dstats.wins + ' / ' + dstats.losses + (dstats.even ? ' / ' + dstats.even : ''), ''], ['Avg trade', signed(dstats.avgTrade) + '  (' + signed(dstats.avgTradePct) + '%)', cls(dstats.avgTrade)],
                ['Avg win', signed(dstats.avgWin), 'up'], ['Avg loss', signed(dstats.avgLoss), 'dn'], ['Payoff ratio', dstats.payoff ? dstats.payoff.toFixed(2) : '—', ''], ['Expectancy', signed(dstats.expectancy), cls(dstats.expectancy)],
                ['Best trade', signed(dstats.best) + '  (' + signed(dstats.bestPct) + '%)', 'up'], ['Worst trade', signed(dstats.worst) + '  (' + signed(dstats.worstPct) + '%)', 'dn'], ['Max win streak', String(dstats.maxWinStreak), ''], ['Max loss streak', String(dstats.maxLossStreak), ''],
                ['Avg bars in trade', dur(dstats.avgBars), ''], ['Avg bars win / loss', dur(dstats.avgBarsWin) + ' / ' + dur(dstats.avgBarsLoss), ''], ['Time in market', dstats.exposurePct.toFixed(1) + '%', ''], ['Avg run-up / drawdown', money(dstats.avgMfe) + ' / ' + money(dstats.avgMae), '']]],
              ['Risk', [['Max drawdown', money(dstats.maxDrawdown) + '  (' + dstats.maxDrawdownPct.toFixed(2) + '%)', 'dn'], ['Max run-up', money(dstats.maxRunup), 'up'], ['Recovery factor', dstats.recovery ? dstats.recovery.toFixed(2) : '—', ''], ['Ulcer index', dstats.ulcer.toFixed(2), ''],
                ['Sharpe ratio', dstats.sharpe.toFixed(2), cls(dstats.sharpe)], ['Sortino ratio', dstats.sortino.toFixed(2), cls(dstats.sortino)], ['Calmar ratio', dstats.calmar.toFixed(2), cls(dstats.calmar)]]],
            ] as [title, cells]}
              <h5 class="sec">{title}</h5>
              <div class="grid">
                {#each cells as [k, v, c]}<div class="cell"><span>{k}</span><b class={c}>{v}</b></div>{/each}
              </div>
            {/each}
            <h5 class="sec">Long vs short</h5>
            <table class="ls">
              <thead><tr><th></th><th>Trades</th><th>Win rate</th><th>Net profit</th><th>Gross profit</th><th>Gross loss</th><th>Profit factor</th><th>Avg trade</th><th>Best</th><th>Worst</th></tr></thead>
              <tbody>
                {#each [{ nm: 'Long', ss: dstats.long }, { nm: 'Short', ss: dstats.short }] as { nm, ss }}
                  <tr><td><b class={nm === 'Long' ? 'up' : 'dn'}>{nm}</b></td><td>{ss.trades}</td><td>{ss.winRate.toFixed(1)}%</td><td class={cls(ss.net)}>{signed(ss.net)}</td><td class="up">{money(ss.grossProfit)}</td><td class="dn">{money(ss.grossLoss)}</td>
                    <td>{pf(ss.profitFactor)}</td><td class={cls(ss.avg)}>{signed(ss.avg)}</td><td class="up">{signed(ss.best)}</td><td class="dn">{signed(ss.worst)}</td></tr>
                {/each}
              </tbody>
            </table>
          {:else if testerSub === 'settings'}
            <div class="tset">
              <p class="dim">Capital, fees and slippage only change the simulation in the Strategy Tester. They are not saved in the strategy and do not change the entry and exit boxes on the chart.</p>
              <label><span>Initial capital</span><input class="in" type="number" min="0" step="any" value={app.tester.initialCapital} oninput={(e) => setT('initialCapital', e)} /></label>
              <label><span>Position size</span><b class="fixed">{sres.config.qtyType === 'percent_of_equity' ? sres.config.qtyValue + '% of equity' : sres.config.qtyType === 'cash' ? money(sres.config.qtyValue) + ' per entry' : sres.config.qtyValue + ' units'}</b><span class="unit">set in the strategy (AI form or Pine script)</span></label>
              <label><span>Commission per fill</span><input class="in" type="number" min="0" step="any" value={app.tester.commissionValue} oninput={(e) => setT('commissionValue', e)} /><span class="unit">% of trade value, on buy and sell</span></label>
              <label><span>Slippage</span><input class="in" type="number" min="0" step="0.05" value={app.tester.slippagePct} oninput={(e) => setT('slippagePct', e)} /><span class="unit">% of the price per fill, against you (default 0.1)</span></label>
              <label><span>Order fills</span><Select value={app.tester.fillOnClose ? 'close' : 'open'} options={[{ value: 'close', label: 'At the close of the signal bar' }, { value: 'open', label: 'At the next bar open' }]} onchange={(v) => { app.tester.fillOnClose = v === 'close'; app.persist(); }} width="230px" /><span class="unit">close = where the cross is confirmed (default)</span></label>
              <button class="mini" onclick={() => { app.tester = { initialCapital: 10000, commissionValue: 0, slippagePct: 0.1, fillOnClose: true }; app.persist(); }}>Reset to defaults</button>
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
  /* outlined like the chart panes: touches the charts above (borders collapse) and lines up with the right column */
  .panel { flex: none; position: relative; display: flex; flex-direction: column; border: 1px solid var(--line); margin: -1px 0 12px 12px; box-sizing: border-box; background: var(--bar); min-height: 0; overflow: hidden; }
  .grip { position: absolute; top: -3px; left: 0; right: 0; height: 7px; cursor: row-resize; z-index: 5; }
  .grip:hover { background: var(--accent); opacity: 0.6; }
  .bar { display: flex; align-items: center; gap: 14px; padding: 0 12px; height: 38px; flex: none; border-bottom: 1px solid var(--line); }
  .tabs { display: flex; gap: 2px; height: 100%; }
  .tabs button { background: none; border: 0; border-bottom: 2px solid transparent; color: var(--dim); padding: 0 14px; font: 700 12px system-ui, sans-serif; letter-spacing: 0.06em; text-transform: uppercase; cursor: pointer; }
  .tabs button:hover { color: var(--fg); } .tabs button.on { color: var(--accent); border-bottom-color: var(--accent); }
  .sp { flex: 1; }
  .chev { background: none; border: 1px solid var(--line); color: var(--fg); width: 28px; height: 24px; cursor: pointer; font-size: 15px; line-height: 1; }
  .chev:hover { border-color: var(--accent); color: var(--accent); }
  .acc { display: flex; align-items: center; gap: 14px; padding: 8px 14px; flex-wrap: wrap; border-bottom: 1px solid var(--line); flex: none; font-size: 12px; }
  .sname { font-size: 13px; } .m { color: var(--dim); } .m b { color: var(--fg); font-family: ui-monospace, monospace; margin-left: 4px; }
  .mini { background: none; border: 1px solid var(--line); color: var(--fg); padding: 4px 10px; font: 600 11px system-ui, sans-serif; cursor: pointer; margin-right: 4px; }
  .acc .mini { height: 30px; box-sizing: border-box; padding: 0 12px; font-size: 12px; }
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
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); margin: 12px; padding: 0 1px 1px 0; }
  .cell { border: 1px solid var(--line); margin: 0 -1px -1px 0; padding: 10px 12px; display: flex; flex-direction: column; gap: 3px; } .cell span { color: var(--dim); font-size: 11px; } .cell b { font: 600 14px ui-monospace, monospace; }
  .eq { width: calc(100% - 24px); height: 150px; margin: 12px; background: #000; border: 1px solid var(--line); } .eq.small { height: 110px; }
  .legend { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 8px 12px 0; font: 11.5px system-ui, sans-serif; color: var(--dim); }
  .legend button { display: inline-flex; align-items: center; gap: 7px; box-sizing: border-box; height: 26px; padding: 0 10px; background: none; border: 1px solid var(--line); color: var(--fg); font: 600 11.5px system-ui, sans-serif; cursor: pointer; }
  .legend button:hover { border-color: var(--accent); } .legend button.off { opacity: 0.45; } .legend button b { font: 600 11.5px ui-monospace, monospace; color: var(--dim); }
  .legend .grow { flex: 1; }
  .sw { display: inline-block; width: 18px; height: 0; border-top: 2px solid; } .sw.eq { border-color: var(--accent); } .sw.bh { border-color: #b9a8e6; } .sw.bi { border-top-style: dashed; border-color: #22e5ff; }
  .mseg { display: inline-flex; border: 1px solid var(--line); } .mseg button { border: 0; height: 24px; color: var(--dim); } .mseg button.on { background: var(--accent); color: #fff; }
  .eqnote { margin: 0 12px 10px; color: var(--dim); font-size: 11.5px; }
  .base { stroke: var(--line); stroke-dasharray: 4 4; } .eqinfo { display: flex; gap: 18px; padding: 0 14px 12px; color: var(--dim); font: 11.5px ui-monospace, monospace; }
  h5 { margin: 12px 14px 0; font: 700 10.5px system-ui, sans-serif; letter-spacing: 0.1em; text-transform: uppercase; color: var(--accent); } h5 .dim { color: var(--dim); text-transform: none; letter-spacing: 0; margin-left: 6px; }
  h5.sec { margin-top: 14px; } .ls { margin: 8px 12px 14px; width: calc(100% - 24px); }
  .tset { padding: 12px 16px; display: flex; flex-direction: column; gap: 10px; align-items: flex-start; } .tset p { margin: 0 0 2px; max-width: 640px; }
  .tset label { display: flex; align-items: center; gap: 10px; font-size: 12.5px; } .tset label > span:first-child { width: 170px; color: var(--dim); }
  .in { width: 110px; height: 30px; padding: 0 8px; background: #000; border: 1px solid var(--line); color: var(--fg); font: 12.5px ui-monospace, monospace; outline: none; box-sizing: border-box; } .in:focus { border-color: var(--accent); }
  .fixed { font: 600 13px ui-monospace, monospace; }
  .unit { color: var(--dim); font-size: 11.5px; }
  .empty { padding: 26px; text-align: center; color: var(--fg); } .empty p { margin: 6px 0; } .empty .dim { color: var(--dim); font-size: 13px; }
  .primary { background: var(--accent); border: 1px solid var(--accent); color: #fff; padding: 9px 18px; font: 700 13px system-ui, sans-serif; cursor: pointer; margin-top: 8px; }
  kbd { font: 11px ui-monospace, monospace; border: 1px solid var(--line); padding: 1px 6px; }
</style>
