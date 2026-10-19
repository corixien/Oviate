<script lang="ts">
  import { onMount, untrack, tick } from 'svelte';
  import { app, type ChartCfg } from '$lib/app.svelte';
  import { getCandles, newsWindow, TF_SECONDS, type NewsItem } from '$lib/api';
  import { emptyCandles, mergeCandles, type Candles } from './data';
  import { transform } from './transforms';
  import { library } from '$lib/library.svelte';
  import { runScript } from '$lib/pine/runner.ts';
  import type { PineResult } from '$lib/pine/types.ts';
  import Icons from '$lib/ui/Icons.svelte';
  import { ChartRenderer, fmtPrice, type Theme, type ActiveIndicator, type NewsMark, type TradeMark, type PriceLine } from './renderer';
  import { paper } from '$lib/paper/paper.svelte';
  import * as PE from '$lib/paper/engine.ts';
  import { t } from '$lib/i18n';

  let { cfg = $bindable(), index }: { cfg: ChartCfg; index: number } = $props();

  let main: HTMLCanvasElement, over: HTMLCanvasElement, box: HTMLDivElement;
  let r: ChartRenderer | undefined;
  let raw = $state<Candles>(emptyCandles());
  let status = $state<'loading' | 'ok' | 'empty' | 'error'>('loading');
  let errMsg = $state('');
  let hover = $state<number | null>(null);
  let exhausted = false, loadingMore = false;
  let menuFor = $state('');
  let selectedId = $state<string | null>(null);
  let news = $state<NewsItem[]>([]);

  // ----- inline editor for text / callout drawings -----
  let edit = $state<{ id: string; x: number; y: number; text: string } | null>(null);
  let editEl = $state<HTMLDivElement>();
  let editArmed = 0;
  function openEditor(id: string, x: number, y: number, text: string) {
    edit = { id, x, y, text };
    editArmed = Date.now() + 300;
    r!.editingId = id;
    tick().then(() => setTimeout(() => {
      if (!editEl) return;
      editEl.innerText = text;
      editEl.focus();
      const range = document.createRange(); range.selectNodeContents(editEl);
      if (!text) range.collapse(false);
      const sel = getSelection(); sel?.removeAllRanges(); sel?.addRange(range);
    }, 40));
  }
  function closeEditor(commit: boolean) {
    if (!edit) return;
    const { id } = edit;
    const value = editEl?.innerText ?? '';
    edit = null;
    r?.endEdit(id, commit ? value : null);
  }
  function editKey(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); closeEditor(true); }
    else if (e.key === 'Escape') { e.preventDefault(); closeEditor(false); }
  }
  function editPaste(e: ClipboardEvent) {
    e.preventDefault();
    document.execCommand('insertText', false, e.clipboardData?.getData('text/plain') ?? '');
  }

  async function loadNews() {
    const sym = cfg.symbol;
    const to = Math.floor(Date.now() / 1000);
    try {
      const res = await newsWindow(sym, to - 30 * 86400, to);
      if (sym === cfg.symbol) news = res.items;
    } catch { /* markers are optional */ }
  }

  /** Group news onto the bar they fall into (bar start <= time < next bar start). */
  const newsMarks = $derived.by<NewsMark[]>(() => {
    if (!app.showNews || !raw.n || !news.length) return [];
    const groups = new Map<number, NewsMark>();
    for (const it of news) {
      if (it.ts < raw.t[0]) continue;
      let lo = 0, hi = raw.n - 1;
      while (lo < hi) { const m = (lo + hi + 1) >> 1; if (raw.t[m] <= it.ts) lo = m; else hi = m - 1; }
      const g = groups.get(lo) ?? { t: raw.t[lo], ids: [], titles: [] };
      g.ids.push(it.id); g.titles.push(it.headline);
      groups.set(lo, g);
    }
    return [...groups.values()];
  });
  // ----- paper trading overlays: fills as arrows, open position and working orders as price lines -----
  const tradeMarks = $derived.by<TradeMark[]>(() => {
    const acc = paper.active;
    const out: TradeMark[] = [];
    if (acc) {
      for (const o of acc.orders) if (o.symbol === cfg.symbol && o.status === 'filled' && o.filledAt && o.fillPrice) out.push({ t: o.filledAt, price: o.fillPrice, side: o.side });
    }
    for (const t of stratTrades) out.push(t);
    return out;
  });
  const priceLines = $derived.by<PriceLine[]>(() => {
    const acc = paper.active;
    if (!acc) return [];
    const out: PriceLine[] = [];
    const pos = PE.positionOf(acc, cfg.symbol);
    const last = acc.lastPrices[cfg.symbol];
    if (pos) {
      const pnl = pos.qty * ((last ?? pos.avgPrice) - pos.avgPrice);
      out.push({ price: pos.avgPrice, color: pos.qty > 0 ? theme.up : theme.down, label: `${pos.qty > 0 ? 'LONG' : 'SHORT'} ${Math.abs(pos.qty)} @ ${fmtPrice(pos.avgPrice)}  ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}` });
    }
    for (const o of acc.orders) {
      if (o.symbol !== cfg.symbol || o.status !== 'open') continue;
      const px = o.type === 'stop_limit' && !o.triggered ? o.stop : o.limit ?? o.stop;
      if (px) out.push({ price: px, color: theme.accent, dash: true, label: `${o.side.toUpperCase()} ${o.type.replace('_', ' ')} ${o.qty}${o.note ? ' · ' + o.note : ''}` });
    }
    return out;
  });
  let stratTrades = $state<TradeMark[]>([]);

  let lastPoll = $state(0);
  let nowMs = $state(Date.now());
  const liveAge = $derived(Math.max(0, nowMs - Math.max(lastPoll, (app.ticks[cfg.symbol]?.t ?? 0) * 1000)));

  const lookback: Record<string, number> = {
    '1m': 5, '5m': 25, '15m': 60, '30m': 90, '1h': 400, '4h': 700, '1d': 3650, '1w': 7300, '1M': 14600
  };
  const step = $derived(TF_SECONDS[cfg.tf]);

  const PAL: Record<string, { up: string; down: string }> = {
    neon: { up: '#22e5ff', down: '#ff2d95' },
    mono: { up: '#e9e1ff', down: '#8a35ff' },
    classic: { up: '#2ee6a6', down: '#ff4d6a' }
  };
  const candleColors = $derived(app.palette === 'custom'
    ? { ...app.custom, up: app.custom.upBody, down: app.custom.downBody }
    : { up: PAL[app.palette].up, down: PAL[app.palette].down, upBody: PAL[app.palette].up, upBorder: PAL[app.palette].up, upWick: PAL[app.palette].up,
        downBody: PAL[app.palette].down, downBorder: PAL[app.palette].down, downWick: PAL[app.palette].down });
  const theme = $derived<Theme>({
    ...(app.theme === 'dark'
      ? { grid: 'rgba(157,77,255,0.10)', text: 'rgba(214,196,255,0.55)', textStrong: 'rgba(240,232,255,0.95)',
          accent: '#9d4dff', cross: 'rgba(190,140,255,0.45)', axisBg: '#000', panel: '#150a26' }
      : { grid: 'rgba(100,40,200,0.09)', text: 'rgba(40,20,80,0.6)', textStrong: 'rgba(20,10,40,0.9)',
          accent: '#7a2cf0', cross: 'rgba(90,40,180,0.4)', axisBg: '#fff', panel: '#efe6ff' }),
    ...candleColors
  });

  const symDrawings = $derived(cfg.drawings.filter((d) => d.sym === cfg.symbol));
  const display = $derived(transform(raw, cfg.type));
  // ----- Pine indicators: computed in a worker, coalesced so ticks cannot pile up -----
  let pineResults = $state<Record<string, PineResult>>({});
  let pineRunning = false, pineDirty = false, lastPineRun = 0;
  let pineTimer: ReturnType<typeof setTimeout> | undefined;

  async function runIndicators() {
    if (pineRunning) { pineDirty = true; return; }
    pineRunning = true;
    try {
      do {
        pineDirty = false;
        lastPineRun = Date.now();
        const d = display, st = step, sym = cfg.symbol;
        const list = $state.snapshot(cfg.indicators).filter((i) => !i.hidden);
        const out: Record<string, PineResult> = {};
        await Promise.all(list.map(async (i) => {
          const file = library.get(i.strategy ? 'strategies' : 'indicators', i.id);
          if (!file) return;
          out[i.uid] = await runScript(file.code, d, { params: i.params, step: st, symbol: sym });
        }));
        pineResults = out;
        publishStrategy(list, out, sym);
        liveSignals(list);
      } while (pineDirty);
    } finally { pineRunning = false; }
  }

  $effect(() => {
    void display; void step; void library.indicators;
    void JSON.stringify(cfg.indicators.map((i) => [i.uid, i.id, i.params, i.hidden]));
    untrack(() => {
      clearTimeout(pineTimer);
      const go = () => { if (r?.dragging) pineTimer = setTimeout(go, 250); else runIndicators(); };
      pineTimer = setTimeout(go, Date.now() - lastPineRun < 500 ? 500 : 30);
    });
  });

  /** Backtest result of the first strategy on this chart: feeds the tester panel and the trade arrows. */
  function publishStrategy(list: typeof cfg.indicators, out: Record<string, PineResult>, sym: string) {
    const s = list.find((i) => i.strategy && out[i.uid]?.strategy && !out[i.uid]?.error);
    if (!s) { delete app.strategyResults[cfg.id]; stratTrades = []; return; }
    const res = out[s.uid];
    app.strategyResults[cfg.id] = { uid: s.uid, name: s.id, symbol: sym, tf: cfg.tf, result: res };
    const marks: TradeMark[] = [];
    for (const t of res.strategy!.trades) {
      const long = t.dir === 'long';
      marks.push({ t: t.entryTime, price: t.entryPrice, side: long ? 'buy' : 'sell' });
      if (!t.open) marks.push({ t: t.exitTime, price: t.exitPrice, side: long ? 'sell' : 'buy' });
    }
    stratTrades = marks;
  }

  /** Strategies attached to a paper account: act on the orders the strategy has pending after each newly closed bar. */
  const liveBars = new Map<string, number>();
  async function liveSignals(list: typeof cfg.indicators) {
    for (const i of list) {
      if (!i.strategy || !i.account || raw.n < 3) continue;
      const file = library.get('strategies', i.id);
      const acc = paper.accounts.find((a) => a.id === i.account);
      if (!file || !acc) continue;
      const closed = raw.n - 2; // the last bar is still forming
      const barTime = raw.t[closed];
      const key = i.uid + '|' + i.account;
      const seen = liveBars.get(key);
      if (seen === undefined) { liveBars.set(key, barTime); continue; } // baseline: only future bar closes trade
      if (barTime <= seen) continue;
      liveBars.set(key, barTime);
      const sliced = transform(raw, cfg.type);
      const n = sliced.n - 1;
      const cut = { n, t: sliced.t.subarray(0, n), o: sliced.o.subarray(0, n), h: sliced.h.subarray(0, n), l: sliced.l.subarray(0, n), c: sliced.c.subarray(0, n), v: sliced.v.subarray(0, n) };
      const res = await runScript(file.code, cut, { params: $state.snapshot(i.params), step, symbol: cfg.symbol });
      if (res.strategy && !res.error) paper.applySignals(acc.id, cfg.symbol, res.strategy.pending, res.strategy.config, file.title);
    }
  }

  const active = $derived<ActiveIndicator[]>(cfg.indicators.flatMap((i) => {
    const r = pineResults[i.uid];
    if (!r || i.hidden) return [];
    const file = library.get(i.strategy ? 'strategies' : 'indicators', i.id);
    const result = i.colors?.some(Boolean) ? { ...r, plots: r.plots.map((p, k) => (i.colors?.[k] ? { ...p, color: i.colors[k]!, colors: undefined } : p)) } : r;
    return [{ id: i.uid, title: file?.shortTitle ?? i.id, overlay: r.error ? true : r.meta.overlay, result }];
  }));

  async function load(reset: boolean) {
    const sym = cfg.symbol, tf = cfg.tf;
    status = 'loading'; exhausted = false;
    const to = Math.floor(Date.now() / 1000) + step;
    const from = to - lookback[tf] * 86400;
    try {
      const c = await getCandles(sym, tf, from, to);
      if (sym !== cfg.symbol || tf !== cfg.tf) return;
      raw = c;
      status = c.n ? 'ok' : 'empty';
      if (c.n) paper.feed(sym, { last: c.c[c.n - 1], t: Math.floor(Date.now() / 1000) });
      await tick();
      if (reset) r?.resetView();
    } catch (e) { if (sym === cfg.symbol) { status = 'error'; errMsg = String(e); } }
  }

  async function loadMore() {
    if (loadingMore || exhausted || !raw.n) return;
    loadingMore = true;
    try {
      const to = raw.t[0] - 1;
      const from = to - lookback[cfg.tf] * 86400;
      const c = await getCandles(cfg.symbol, cfg.tf, from, to);
      if (!c.n) { exhausted = true; return; }
      const added = c.n;
      raw = mergeCandles(c, raw);
      r?.shiftIndex(added);
    } finally { loadingMore = false; }
  }

  async function poll() {
    if (status !== 'ok' || document.hidden || r?.dragging) return;
    try {
      const to = Math.floor(Date.now() / 1000) + step;
      const c = await getCandles(cfg.symbol, cfg.tf, to - step * 6, to);
      if (c.n) { raw = mergeCandles(raw, c); lastPoll = Date.now(); paper.feed(cfg.symbol, { last: raw.c[raw.n - 1], t: Math.floor(Date.now() / 1000) }); }
    } catch (e) { console.warn('poll failed', e); }
  }

  onMount(() => {
    r = new ChartRenderer(main, over, {
      onHover: (i, tm, yf) => { hover = i; if (app.sync) app.crossT = { t: tm, y: yf, from: cfg.id }; },
      onViewChange: () => { if (app.sync && r) { const [l, rr] = r.getTimeRange(); app.view = { l, r: rr, from: cfg.id }; } },
      onNeedHistory: () => loadMore(),
      onDrawings: (d) => { cfg.drawings = [...cfg.drawings.filter((x) => x.sym !== cfg.symbol), ...d.map((x) => ({ ...x, sym: cfg.symbol }))]; app.persist(); },
      onToolDone: () => { app.tool = 'cursor'; },
      onSelect: (id) => { selectedId = id; },
      onNewsClick: (m) => app.openNews(cfg.symbol, m.ids[0]),
      onEditText: (id, x, y, text) => openEditor(id, x, y, text)
    }, {
      data: display, raw, type: cfg.type, step, indicators: active, drawings: symDrawings, theme,
      log: cfg.log, volume: cfg.volume && cfg.volumeVisible !== false, grid: app.grid, magnet: app.magnet, tool: app.tool, news: newsMarks, trades: tradeMarks, lines: priceLines
    });
    const ro = new ResizeObserver(([e]) => r!.resize(e.contentRect.width, e.contentRect.height));
    ro.observe(box);
    const iv = setInterval(poll, step < 3600 ? 2500 : 6000);
    const clock = setInterval(() => (nowMs = Date.now()), 1000);
    return () => { clearInterval(iv); clearInterval(clock); ro.disconnect(); r?.destroy(); };
  });

  let lastKey = '';
  $effect(() => {
    const key = cfg.symbol + '|' + cfg.tf;
    if (key === lastKey) return;
    lastKey = key;
    untrack(() => { load(true); news = []; loadNews(); });
  });
  $effect(() => { const iv = setInterval(loadNews, 10 * 60 * 1000); return () => clearInterval(iv); });

  // Live ticks: batch to ~5 updates/s so indicators are not recomputed per trade.
  let tickTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const tk = app.ticks[cfg.symbol];
    if (!tk || tickTimer) return;
    const flush = () => { if (r?.dragging) { tickTimer = setTimeout(flush, 200); return; } tickTimer = undefined; const l = app.ticks[cfg.symbol]; if (l) applyTick(l.p, l.s, l.t); };
    tickTimer = setTimeout(flush, 200);
  });

  function applyTick(p: number, size: number, t: number) {
    if (!raw.n) return;
    const last = raw.n - 1;
    if (t < raw.t[last]) return;
    if (step < 86400 && t >= raw.t[last] + step) {
      const bt = Math.floor(t / step) * step;
      raw = mergeCandles(raw, { n: 1, t: Float64Array.of(bt), o: Float64Array.of(p), h: Float64Array.of(p), l: Float64Array.of(p), c: Float64Array.of(p), v: Float64Array.of(size) });
    } else {
      paper.feed(cfg.symbol, { last: p, t: Math.floor(Date.now() / 1000) });
      raw.c[last] = p;
      if (p > raw.h[last]) raw.h[last] = p;
      if (p < raw.l[last]) raw.l[last] = p;
      raw.v[last] += size;
      raw = { ...raw };
    }
  }

  $effect(() => {
    r?.setState({
      data: display, raw, type: cfg.type, step, indicators: active, drawings: symDrawings, theme,
      log: cfg.log, volume: cfg.volume && cfg.volumeVisible !== false, grid: app.grid, magnet: app.magnet,
      tool: app.active === index ? app.tool : 'cursor', news: newsMarks, trades: tradeMarks, lines: priceLines
    });
  });

  $effect(() => {
    if (!r) return;
    const ext = app.sync && app.crossT.from !== cfg.id;
    r.externalT = ext ? app.crossT.t : null;
    r.externalY = ext ? app.crossT.y : null;
    r.setState({});
  });

  // Zoom/scroll sync: follow the time window of whichever chart the user is moving.
  $effect(() => {
    const v = app.view;
    if (!r || !app.sync || !v || v.from === cfg.id) return;
    r.setTimeRange(v.l, v.r);
  });

  $effect(() => {
    if (app.active !== index || !r) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.isContentEditable) return;
      if (e.ctrlKey || e.metaKey) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { if (r!.deleteSelected()) e.preventDefault(); }
      else if (e.key === 'Escape') { r!.cancelDraft(); app.tool = 'cursor'; }
      else if (e.key === 'ArrowLeft') r!.panBars(e.shiftKey ? -20 : -3);
      else if (e.key === 'ArrowRight') r!.panBars(e.shiftKey ? 20 : 3);
      else if (e.key === '+' || e.key === '=') r!.zoomBars(1.2, (box.clientWidth - 66) / 2);
      else if (e.key === '-') r!.zoomBars(1 / 1.2, (box.clientWidth - 66) / 2);
      else if (e.altKey && e.key.toLowerCase() === 'r') r!.resetView();
      else if (e.key === 'End') r!.scrollToEnd();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const bar = $derived(raw.n ? (hover !== null && hover < display.n ? hover : display.n - 1) : -1);
  const chg = $derived(bar > 0 ? display.c[bar] - display.c[bar - 1] : 0);
  const chgPct = $derived(bar > 0 ? (chg / display.c[bar - 1]) * 100 : 0);
  const col = $derived(chg >= 0 ? 'var(--up)' : 'var(--down)');
</script>

<div class="pane" class:active={app.active === index} bind:this={box} onpointerdowncapture={() => (app.active = index)} role="presentation">
  <canvas bind:this={main} class="layer"></canvas>
  <canvas bind:this={over} class="layer top"></canvas>

  <div class="legend">
   <div class="top">
    <div class="pill tk">
      <span class="dot" class:live={liveAge < 20000} title={liveAge < 20000 ? 'Live' : 'No update for ' + Math.round(liveAge / 1000) + 's'}></span>
      <span class="nm">{cfg.symbol}</span><span class="dim">{cfg.tf.toUpperCase()}</span>
      <span class="acts">
        <button title="Change symbol" onclick={() => (app.spotlight = { open: true, seed: '' })}><Icons name="search" size={14} /></button>
      </span>
    </div>
    <div class="trade">
      <button class="b" title="Buy {cfg.symbol} (paper)" onclick={() => { app.active = index; paper.orderDialog = { open: true, side: 'buy', symbol: cfg.symbol }; }}>Buy</button>
      <button class="s" title="Sell {cfg.symbol} (paper)" onclick={() => { app.active = index; paper.orderDialog = { open: true, side: 'sell', symbol: cfg.symbol }; }}>Sell</button>
    </div>
   </div>
    {#if cfg.volume}
      <div class="pill" class:off={cfg.volumeVisible === false}>
        <span class="nm">Volume</span>
        <span class="acts">
          <button title={cfg.volumeVisible === false ? 'Show' : 'Hide'} onclick={() => { cfg.volumeVisible = cfg.volumeVisible === false; app.persist(); }}><Icons name={cfg.volumeVisible === false ? 'eyeoff' : 'eye'} size={14} /></button>
          <button title="Remove" onclick={() => { cfg.volume = false; app.persist(); }}><Icons name="trash" size={14} /></button>
        </span>
      </div>
    {/if}
    {#each cfg.indicators as ind (ind.uid)}
      {@const file = library.get(ind.strategy ? 'strategies' : 'indicators', ind.id)}
      {@const res = pineResults[ind.uid]}
      <div class="pill" class:off={ind.hidden} class:bad={!!res?.error || !file} title={res?.error ? res.error.message : !file ? 'Script not found: ' + ind.id : ''}>
        {#if ind.strategy}<span class="sbadge" title="Strategy">S</span>{/if}
        <span class="nm">{file?.shortTitle ?? ind.id}</span>
        {#if ind.account}<span class="live" title="Trading on paper account {paper.accounts.find((a) => a.id === ind.account)?.name ?? '?'}">LIVE</span>{/if}
        {#if ind.showParams ?? app.showParams}<span class="dim">{res ? res.inputs.map((i) => ind.params[i.id] ?? i.def).join(' ') : ''}</span>{/if}
        <span class="acts">
          <button title={ind.hidden ? 'Show' : 'Hide'} onclick={() => { ind.hidden = !ind.hidden; app.persist(); }}><Icons name={ind.hidden ? 'eyeoff' : 'eye'} size={14} /></button>
          <button title="Settings" onclick={() => (app.indDialog = { uid: ind.uid, mode: 'settings' })}><Icons name="gear" size={14} /></button>
          <button title="Source code" onclick={() => (app.indDialog = { uid: ind.uid, mode: 'code' })}><Icons name="braces" size={14} /></button>
          <button title="Remove" onclick={() => { cfg.indicators = cfg.indicators.filter((q) => q.uid !== ind.uid); app.persist(); }}><Icons name="trash" size={14} /></button>
          <span class="mwrap">
            <button title="More" onclick={() => (menuFor = menuFor === ind.uid ? '' : ind.uid)}><Icons name="more" size={14} /></button>
            {#if menuFor === ind.uid}
              <div class="mmenu" role="menu">
                <button onclick={() => { ind.showParams = !(ind.showParams ?? app.showParams); menuFor = ''; app.persist(); }}>{ind.showParams ?? app.showParams ? 'Hide parameters' : 'Show parameters'}</button>
                <button onclick={() => { cfg.indicators = [...cfg.indicators, { ...$state.snapshot(ind), uid: crypto.randomUUID() }]; menuFor = ''; app.persist(); }}>Duplicate</button>
                <button onclick={() => { ind.params = {}; ind.colors = undefined; menuFor = ''; app.persist(); }}>Reset to defaults</button>
                <button onclick={() => { app.editor = { kind: ind.strategy ? 'strategies' : 'indicators', name: ind.id }; app.page = 'editor'; menuFor = ''; }}>Edit source</button>
                {#if ind.strategy}
                  <button class="hd2" disabled>Trade on paper account</button>
                  {#each paper.accounts as acc (acc.id)}
                    <button onclick={() => { ind.account = ind.account === acc.id ? undefined : acc.id; liveBars.clear(); menuFor = ''; app.persist(); }}>{ind.account === acc.id ? '● ' : '○ '}{acc.name}</button>
                  {:else}
                    <button onclick={() => { paper.accountDialog = true; menuFor = ''; }}>Create paper account…</button>
                  {/each}
                {/if}
              </div>
            {/if}
          </span>
        </span>
      </div>
    {/each}
  </div>

  {#if edit}
    <div class="tedit" contenteditable="true" role="textbox" tabindex="0" bind:this={editEl} style:left="{edit.x}px" style:top="{edit.y}px"
      onkeydown={editKey} onpaste={editPaste} onblur={() => { if (Date.now() >= editArmed) closeEditor(true); }} onpointerdown={(e) => e.stopPropagation()}></div>
  {/if}

  {#if selectedId}
    <div class="seltools">
      <span>Drawing</span>
      <button title="Delete drawing (Del / middle click)" onclick={() => r?.deleteSelected()}><Icons name="trash" size={15} /> Delete</button>
    </div>
  {/if}

  {#if status !== 'ok'}
    <div class="state">{status === 'loading' ? t('loading', app.lang) : status === 'empty' ? t('noData', app.lang) : errMsg}</div>
  {/if}
</div>

<style>
  .pane { position: relative; min-width: 0; min-height: 0; background: var(--pane); border: 1px solid var(--line); overflow: hidden; }
  .pane.active { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent) inset, 0 0 0 1px var(--accent); }
  .layer { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
  .top { touch-action: none; }
  .legend { position: absolute; top: 8px; left: 10px; display: flex; flex-direction: column; gap: 3px; pointer-events: none; font: 12px ui-monospace, 'JetBrains Mono', monospace; max-width: calc(100% - 90px); }
  .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .head { font-size: 12.5px; }
  .sym { pointer-events: auto; background: none; border: 0; color: var(--fg); font: 600 14px system-ui, sans-serif; cursor: pointer; padding: 0; }
  .sym:hover { color: var(--accent); }
  .dim { color: var(--dim); }
  .pill { white-space: nowrap; pointer-events: auto; display: inline-flex; align-items: center; gap: 0; width: fit-content; padding: 3px 9px; border: 1px solid var(--accent); background: rgba(0, 0, 0, 0.55); font-size: 11.5px; }
  .pill.off { opacity: 0.55; }
  .pill.bad { border-color: var(--down); }
  .sbadge { font: 800 9px system-ui, sans-serif; background: var(--accent); color: #fff; padding: 1px 4px; margin-right: 6px; }
  .live { font: 800 8.5px system-ui, sans-serif; border: 1px solid var(--up); color: var(--up); padding: 0 4px; margin-left: 6px; letter-spacing: 0.06em; }
  .hd2 { color: var(--dim) !important; font-size: 10.5px !important; text-transform: uppercase; letter-spacing: 0.08em; }
  .trade { display: inline-flex; gap: 4px; pointer-events: auto; }
  .trade button { background: #000; border: 1px solid; padding: 3px 12px; font: 800 11px system-ui, sans-serif; letter-spacing: 0.06em; cursor: pointer; text-transform: uppercase; }
  .trade .b { color: var(--up); border-color: var(--up); } .trade .b:hover { background: var(--up); color: #000; }
  .trade .s { color: var(--down); border-color: var(--down); } .trade .s:hover { background: var(--down); color: #000; }
  .top { display: flex; gap: 8px; align-items: center; }
  .pill.bad .nm { color: var(--down); }
  .tk .dim { margin-left: 8px; }
  .dot { width: 7px; height: 7px; margin-right: 8px; background: var(--dim); flex: none; }
  .dot.live { background: var(--up); box-shadow: 0 0 8px var(--up); }
  .nm { color: var(--fg); font-family: system-ui, sans-serif; font-weight: 600; }
  .acts { display: inline-flex; align-items: center; gap: 1px; max-width: 0; margin-left: 0; opacity: 0; overflow: hidden; transition: max-width 0.28s cubic-bezier(0.34, 1.3, 0.64, 1), margin-left 0.28s, opacity 0.18s; }
  .pill:hover .acts, .pill:focus-within .acts { max-width: 160px; margin-left: 8px; opacity: 1; overflow: visible; }
  .acts button { display: grid; place-items: center; width: 22px; height: 22px; background: none; border: 0; color: var(--dim); cursor: pointer; }
  .acts button:hover { color: #fff; background: var(--accent); }
  .mwrap { position: relative; }
  .mmenu { position: absolute; top: 26px; right: 0; z-index: 30; min-width: 160px; display: flex; flex-direction: column; background: var(--glass); border: 1px solid var(--glass-line); }
  .mmenu button { width: auto; height: auto; padding: 8px 12px; text-align: left; color: var(--fg); font: 12px system-ui, sans-serif; }
  .tedit { position: absolute; z-index: 5; min-width: 40px; min-height: 17px; padding: 5px 7px; box-sizing: content-box; white-space: pre; outline: 0; background: var(--glass); border: 1px solid var(--accent); color: var(--fg); font: 13px/17px system-ui, sans-serif; margin: -1px 0 0 -1px; }
  .seltools { position: absolute; top: 8px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 10px; padding: 4px 4px 4px 12px; background: var(--glass); border: 1px solid var(--accent); font: 12px system-ui, sans-serif; color: var(--dim); animation: st 0.2s ease both; }
  .seltools button { display: inline-flex; align-items: center; gap: 6px; background: none; border: 0; color: var(--fg); padding: 5px 10px; cursor: pointer; font: 600 12px system-ui, sans-serif; }
  .seltools button:hover { background: var(--down); color: #fff; }
  @keyframes st { from { opacity: 0; transform: translate(-50%, -6px); } }
  .state { position: absolute; inset: 0; display: grid; place-items: center; color: var(--dim); font-size: 13px; pointer-events: none; }
</style>
