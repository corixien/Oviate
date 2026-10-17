<script lang="ts">
  import { onMount, untrack, tick } from 'svelte';
  import { app, type ChartCfg } from '$lib/app.svelte';
  import { getCandles, TF_SECONDS } from '$lib/api';
  import { emptyCandles, mergeCandles, type Candles } from './data';
  import { transform } from './transforms';
  import { indicatorById } from './indicators';
  import { ChartRenderer, fmtPrice, type Theme, type ActiveIndicator } from './renderer';
  import { t } from '$lib/i18n';

  let { cfg, index }: { cfg: ChartCfg; index: number } = $props();

  let main: HTMLCanvasElement, over: HTMLCanvasElement, box: HTMLDivElement;
  let r: ChartRenderer | undefined;
  let raw = $state<Candles>(emptyCandles());
  let status = $state<'loading' | 'ok' | 'empty' | 'error'>('loading');
  let errMsg = $state('');
  let hover = $state<number | null>(null);
  let exhausted = false, loadingMore = false;

  const lookback: Record<string, number> = {
    '1m': 5, '5m': 25, '15m': 60, '30m': 90, '1h': 400, '4h': 700, '1d': 3650, '1w': 7300, '1M': 14600
  };
  const step = $derived(TF_SECONDS[cfg.tf]);

  const theme = $derived<Theme>(app.theme === 'dark'
    ? { up: '#2ee6a6', down: '#ff4d6a', grid: 'rgba(255,255,255,0.045)', text: 'rgba(255,255,255,0.5)', textStrong: 'rgba(255,255,255,0.9)',
        accent: '#a855f7', cross: 'rgba(255,255,255,0.28)', axisBg: '#000', panel: '#16101f' }
    : { up: '#0ea371', down: '#e5334f', grid: 'rgba(0,0,0,0.06)', text: 'rgba(0,0,0,0.55)', textStrong: 'rgba(0,0,0,0.9)',
        accent: '#7c3aed', cross: 'rgba(0,0,0,0.3)', axisBg: '#fff', panel: '#efe9fb' });

  const symDrawings = $derived(cfg.drawings.filter((d) => d.sym === cfg.symbol));
  const display = $derived(transform(raw, cfg.type));
  const active = $derived<ActiveIndicator[]>(cfg.indicators.flatMap((i) => {
    const def = indicatorById(i.id);
    return def ? [{ id: i.uid, def, lines: def.compute(display, i.params) }] : [];
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
      if (r) r.start += added;
    } finally { loadingMore = false; }
  }

  async function poll() {
    if (status !== 'ok' || document.hidden) return;
    try {
      const to = Math.floor(Date.now() / 1000) + step;
      const c = await getCandles(cfg.symbol, cfg.tf, to - step * 6, to);
      if (c.n) raw = mergeCandles(raw, c);
    } catch { /* keep showing cached data */ }
  }

  onMount(() => {
    r = new ChartRenderer(main, over, {
      onHover: (i, tm) => { hover = i; if (app.sync) app.crossT = { t: tm, from: cfg.id }; },
      onViewChange: () => {},
      onNeedHistory: () => loadMore(),
      onDrawings: (d) => { cfg.drawings = [...cfg.drawings.filter((x) => x.sym !== cfg.symbol), ...d.map((x) => ({ ...x, sym: cfg.symbol }))]; app.persist(); },
      onToolDone: () => { app.tool = 'cursor'; }
    }, {
      data: display, raw, type: cfg.type, step, indicators: active, drawings: symDrawings, theme,
      log: cfg.log, volume: cfg.volume, grid: app.grid, magnet: app.magnet, tool: app.tool
    });
    const ro = new ResizeObserver(([e]) => r!.resize(e.contentRect.width, e.contentRect.height));
    ro.observe(box);
    const iv = setInterval(poll, 5000);
    return () => { clearInterval(iv); ro.disconnect(); r?.destroy(); };
  });

  let lastKey = '';
  $effect(() => {
    const key = cfg.symbol + '|' + cfg.tf;
    if (key === lastKey) return;
    lastKey = key;
    untrack(() => { load(true); });
  });

  $effect(() => {
    r?.setState({
      data: display, raw, type: cfg.type, step, indicators: active, drawings: symDrawings, theme,
      log: cfg.log, volume: cfg.volume, grid: app.grid, magnet: app.magnet,
      tool: app.active === index ? app.tool : 'cursor'
    });
  });

  $effect(() => {
    if (!r) return;
    r.externalT = app.sync && app.crossT.from !== cfg.id ? app.crossT.t : null;
    r.setState({});
  });

  $effect(() => {
    if (app.active !== index || !r) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
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
    <div class="row head">
      <button class="sym" onclick={() => (app.spotlight = { open: true, seed: '' })}>{cfg.symbol}</button>
      <span class="dim">· {cfg.tf.toUpperCase()}</span>
      {#if bar >= 0}
        <span class="dim">O</span><span style:color={col}>{fmtPrice(display.o[bar])}</span>
        <span class="dim">H</span><span style:color={col}>{fmtPrice(display.h[bar])}</span>
        <span class="dim">L</span><span style:color={col}>{fmtPrice(display.l[bar])}</span>
        <span class="dim">C</span><span style:color={col}>{fmtPrice(display.c[bar])}</span>
        <span style:color={col}>{chg >= 0 ? '+' : ''}{fmtPrice(chg)} ({chgPct.toFixed(2)}%)</span>
      {/if}
    </div>
    {#each cfg.indicators as ind (ind.uid)}
      {@const def = indicatorById(ind.id)}
      {@const lines = active.find((a) => a.id === ind.uid)?.lines ?? []}
      <div class="row ind">
        <span class="dim">{def?.label.replace(/ \(.*\)/, '')} {Object.values(ind.params).join(' ')}</span>
        {#each lines as ln}
          {#if bar >= 0 && !Number.isNaN(ln.v[bar]) && ln.kind !== 'band'}<span style:color={ln.color}>{ln.v[bar].toFixed(2)}</span>{/if}
        {/each}
        <button class="x" title="Remove" onclick={() => { cfg.indicators = cfg.indicators.filter((q) => q.uid !== ind.uid); app.persist(); }}>×</button>
      </div>
    {/each}
  </div>

  {#if status !== 'ok'}
    <div class="state">{status === 'loading' ? t('loading', app.lang) : status === 'empty' ? t('noData', app.lang) : errMsg}</div>
  {/if}
</div>

<style>
  .pane { position: relative; min-width: 0; min-height: 0; background: var(--pane); border: 1px solid var(--line); overflow: hidden; }
  .pane.active { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent) inset; }
  .layer { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
  .top { touch-action: none; }
  .legend { position: absolute; top: 8px; left: 10px; display: flex; flex-direction: column; gap: 3px; pointer-events: none; font: 12px ui-monospace, 'JetBrains Mono', monospace; max-width: calc(100% - 90px); }
  .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .head { font-size: 12.5px; }
  .sym { pointer-events: auto; background: none; border: 0; color: var(--fg); font: 600 14px system-ui, sans-serif; cursor: pointer; padding: 0; }
  .sym:hover { color: var(--accent); }
  .dim { color: var(--dim); }
  .ind { font-size: 11.5px; }
  .x { pointer-events: auto; background: none; border: 0; color: var(--dim); cursor: pointer; font-size: 14px; padding: 0 2px; }
  .x:hover { color: var(--down); }
  .state { position: absolute; inset: 0; display: grid; place-items: center; color: var(--dim); font-size: 13px; pointer-events: none; }
</style>
