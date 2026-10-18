<script lang="ts">
  import { onMount, untrack, tick } from 'svelte';
  import { app, type ChartCfg } from '$lib/app.svelte';
  import { getCandles, TF_SECONDS } from '$lib/api';
  import { emptyCandles, mergeCandles, type Candles } from './data';
  import { transform } from './transforms';
  import { indicatorById } from './indicators';
  import Icons from '$lib/ui/Icons.svelte';
  import { ChartRenderer, fmtPrice, type Theme, type ActiveIndicator } from './renderer';
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
  const active = $derived<ActiveIndicator[]>(cfg.indicators.flatMap((i) => {
    const def = indicatorById(i.id);
    if (!def || i.hidden) return [];
    const lines = def.compute(display, i.params).map((ln, k) => (i.colors?.[k] ? { ...ln, color: i.colors[k] } : ln));
    return [{ id: i.uid, def, lines }];
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
      if (c.n) { raw = mergeCandles(raw, c); lastPoll = Date.now(); }
    } catch (e) { console.warn('poll failed', e); }
  }

  onMount(() => {
    r = new ChartRenderer(main, over, {
      onHover: (i, tm) => { hover = i; if (app.sync) app.crossT = { t: tm, from: cfg.id }; },
      onViewChange: () => {},
      onNeedHistory: () => loadMore(),
      onDrawings: (d) => { cfg.drawings = [...cfg.drawings.filter((x) => x.sym !== cfg.symbol), ...d.map((x) => ({ ...x, sym: cfg.symbol }))]; app.persist(); },
      onToolDone: () => { app.tool = 'cursor'; },
      onSelect: (id) => { selectedId = id; }
    }, {
      data: display, raw, type: cfg.type, step, indicators: active, drawings: symDrawings, theme,
      log: cfg.log, volume: cfg.volume && cfg.volumeVisible !== false, grid: app.grid, magnet: app.magnet, tool: app.tool
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
    untrack(() => { load(true); });
  });

  // Live ticks: batch to ~5 updates/s so indicators are not recomputed per trade.
  let tickTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const tk = app.ticks[cfg.symbol];
    if (!tk || tickTimer) return;
    tickTimer = setTimeout(() => { tickTimer = undefined; const l = app.ticks[cfg.symbol]; if (l) applyTick(l.p, l.s, l.t); }, 200);
  });

  function applyTick(p: number, size: number, t: number) {
    if (!raw.n) return;
    const last = raw.n - 1;
    if (t < raw.t[last]) return;
    if (step < 86400 && t >= raw.t[last] + step) {
      const bt = Math.floor(t / step) * step;
      raw = mergeCandles(raw, { n: 1, t: Float64Array.of(bt), o: Float64Array.of(p), h: Float64Array.of(p), l: Float64Array.of(p), c: Float64Array.of(p), v: Float64Array.of(size) });
    } else {
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
    <div class="pill tk">
      <span class="dot" class:live={liveAge < 20000} title={liveAge < 20000 ? 'Live' : 'No update for ' + Math.round(liveAge / 1000) + 's'}></span>
      <span class="nm">{cfg.symbol}</span><span class="dim">{cfg.tf.toUpperCase()}</span>
      <span class="acts">
        <button title="Change symbol" onclick={() => (app.spotlight = { open: true, seed: '' })}><Icons name="search" size={14} /></button>
      </span>
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
      {@const def = indicatorById(ind.id)}
      <div class="pill" class:off={ind.hidden}>
        <span class="nm">{def?.label.replace(/ \(.*\)/, '')}</span>
        {#if ind.showParams ?? app.showParams}<span class="dim">{Object.values(ind.params).join(' ')}</span>{/if}
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
                <button onclick={() => { if (def) ind.params = { ...def.params }; ind.colors = undefined; menuFor = ''; app.persist(); }}>Reset to defaults</button>
              </div>
            {/if}
          </span>
        </span>
      </div>
    {/each}
  </div>

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
  .seltools { position: absolute; top: 8px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 10px; padding: 4px 4px 4px 12px; background: var(--glass); border: 1px solid var(--accent); font: 12px system-ui, sans-serif; color: var(--dim); animation: st 0.2s ease both; }
  .seltools button { display: inline-flex; align-items: center; gap: 6px; background: none; border: 0; color: var(--fg); padding: 5px 10px; cursor: pointer; font: 600 12px system-ui, sans-serif; }
  .seltools button:hover { background: var(--down); color: #fff; }
  @keyframes st { from { opacity: 0; transform: translate(-50%, -6px); } }
  .state { position: absolute; inset: 0; display: grid; place-items: center; color: var(--dim); font-size: 13px; pointer-events: none; }
</style>
