<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from '$lib/app.svelte';
  import { onTick, streamSymbols } from '$lib/api';
  import Chart from '$lib/chart/Chart.svelte';
  import TopBar from '$lib/ui/TopBar.svelte';
  import LeftBar from '$lib/ui/LeftBar.svelte';
  import Watchlist from '$lib/ui/Watchlist.svelte';
  import AiIndicatorDialog from '$lib/ui/AiIndicatorDialog.svelte';
  import Analysis from '$lib/ui/Analysis.svelte';
  import StrategyBuilder from '$lib/ui/StrategyBuilder.svelte';
  import NewsPage from '$lib/ui/NewsPage.svelte';
  import ScriptEditor from '$lib/ui/ScriptEditor.svelte';
  import { library } from '$lib/library.svelte';
  import PaperPanel from '$lib/ui/PaperPanel.svelte';
  import OrderDialog from '$lib/ui/OrderDialog.svelte';
  import AccountDialog from '$lib/ui/AccountDialog.svelte';
  import { paper } from '$lib/paper/paper.svelte';
  import Spotlight from '$lib/ui/Spotlight.svelte';
  import Settings from '$lib/ui/Settings.svelte';
  import IndicatorDialog from '$lib/ui/IndicatorDialog.svelte';

  let center = $state<HTMLDivElement>();
  let ov = $state<HTMLDivElement>();
  let rcol = $state<HTMLDivElement>();
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const cols = $derived(['2v', '3', '4'].includes(app.layout) ? `${app.split.c}fr ${1 - app.split.c}fr` : undefined);
  const rows = $derived(['2h', '3', '4'].includes(app.layout) ? `${app.split.r}fr ${1 - app.split.r}fr` : undefined);

  function drag(e: PointerEvent, move: (ev: PointerEvent) => void) {
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); app.persist(); };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  }
  function startDrag(e: PointerEvent, axis: 'c' | 'r') {
    drag(e, (ev) => {
      if (!ov) return;
      const r = ov.getBoundingClientRect();
      app.split[axis] = axis === 'c' ? clamp((ev.clientX - r.left - 5) / (r.width - 10), 0.15, 0.85) : clamp((ev.clientY - r.top - 5) / (r.height - 10), 0.15, 0.85);
    });
  }
  function startRightDrag(e: PointerEvent) {
    drag(e, (ev) => { app.split.rightW = clamp(window.innerWidth - ev.clientX - 12, 220, Math.min(700, window.innerWidth * 0.5)); });
  }
  function startListDrag(e: PointerEvent) {
    drag(e, (ev) => {
      if (!rcol) return;
      const r = rcol.getBoundingClientRect();
      app.split.listFrac = clamp((ev.clientY - r.top - 5) / (r.height - 10), 0.12, 0.85);
    });
  }

  onMount(() => {
    app.load();
    library.load();
    paper.load();
    let off = () => {};
    onTick((t) => { app.ticks[t.symbol] = { p: t.price, s: t.size, t: t.t }; }).then((f) => (off = f));
    return () => off();
  });
  $effect(() => { if (app.ready) streamSymbols([...new Set(app.charts.slice(0, app.count).map((c) => c.symbol))]); });

  $effect(() => {
    document.documentElement.dataset.theme = app.theme;
    document.documentElement.dataset.anim = app.anim ? '1' : '0';
  });
  $effect(() => { if (app.ready) { void [app.layout, app.active, app.theme, app.lang, app.grid, app.magnet, app.sync, app.showWatchlist, app.charts.map((c) => [c.symbol, c.tf, c.type, c.log, c.volume, c.indicators.length])]; app.persist(); } });

  function key(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      if (e.key === '+' || e.key === '=') { e.preventDefault(); app.zoomBy(1); return; }
      if (e.key === '-' || e.key === '_') { e.preventDefault(); app.zoomBy(-1); return; }
      if (e.key === '0') { e.preventDefault(); app.setZoom(1); return; }
    }
    const el = e.target as HTMLElement;
    const typing = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
    if (typing || app.spotlight.open || app.settingsOpen) return;
    if (e.key === 'Enter') { e.preventDefault(); app.spotlight = { open: true, seed: '' }; }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); app.spotlight = { open: true, seed: '' }; }
    else if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1 && /[a-z0-9/]/i.test(e.key)) {
      e.preventDefault(); app.spotlight = { open: true, seed: e.key };
    }
  }
</script>

<svelte:window onkeydown={key} />

<div class="app">
  <TopBar />
  {#if app.page === 'news'}<NewsPage />{/if}
  {#if app.page === 'editor'}<ScriptEditor />{/if}
  {#if app.page === 'builder'}<StrategyBuilder />{/if}
  <div class="body" class:hid={app.page !== 'chart'}>
    <LeftBar />
    <div class="center">
     <div class="chartarea" bind:this={center}>
      <main class="grid l{app.layout}" style:grid-template-columns={cols} style:grid-template-rows={rows}>
        {#each app.charts.slice(0, app.count) as c, i (c.id)}
          <Chart bind:cfg={app.charts[i]} index={i} />
        {/each}
      </main>
      {#if ['2v', '3', '4'].includes(app.layout)}
        <div class="ov" bind:this={ov}>
          <div class="hv" style:left="calc((100% - 10px) * {app.split.c})" role="separator" aria-orientation="vertical" onpointerdown={(e) => startDrag(e, 'c')}></div>
          {#if app.layout === '3' || app.layout === '4'}
            <div class="hh" class:half={app.layout === '3'} style:top="calc((100% - 10px) * {app.split.r})" style:left={app.layout === '3' ? `calc((100% - 10px) * ${app.split.c} + 10px)` : '0'} role="separator" aria-orientation="horizontal" onpointerdown={(e) => startDrag(e, 'r')}></div>
          {/if}
        </div>
      {/if}
      {#if app.layout === '2h'}
        <div class="ov" bind:this={ov}>
          <div class="hh" style:top="calc((100% - 10px) * {app.split.r})" role="separator" aria-orientation="horizontal" onpointerdown={(e) => startDrag(e, 'r')}></div>
        </div>
      {/if}
     </div>
     <PaperPanel />
    </div>
    {#if app.showWatchlist}
      <div class="vsplit" role="separator" aria-orientation="vertical" onpointerdown={startRightDrag}></div>
      <div class="rcol" bind:this={rcol} style:width="{app.split.rightW}px" style:grid-template-rows="{app.split.listFrac}fr 10px {1 - app.split.listFrac}fr">
        <Watchlist />
        <div class="lsplit" role="separator" aria-orientation="horizontal" onpointerdown={startListDrag}></div>
        <Analysis />
      </div>
    {/if}
  </div>
  {#if app.toast}<div class="toast">{app.toast}</div>{/if}
</div>

<Spotlight />
<AiIndicatorDialog />
<Settings />
<IndicatorDialog />
<OrderDialog />
<AccountDialog />

<style>
  :global(:root), :global(:root[data-theme='dark']) {
    --bg: #000; --bar: #000; --pane: #000; --line: #2a1250; --fg: #f1eaff; --dim: #8f7fb0;
    --accent: #9d4dff; --accent-soft: rgba(157, 77, 255, 0.2); --hover: rgba(157, 77, 255, 0.14);
    --up: #22e5ff; --down: #ff2d95; --glass: #0a0614; --glass-line: #4a1f8f;
  }
  :global(:root[data-theme='light']) {
    --bg: #fff; --bar: #faf7ff; --pane: #fff; --line: #d9c8f5; --fg: #17082e; --dim: #7a68a0;
    --accent: #7a2cf0; --accent-soft: rgba(122, 44, 240, 0.12); --hover: rgba(122, 44, 240, 0.08);
    --up: #0891b2; --down: #d61f7c; --glass: #ffffff; --glass-line: #b99af0;
  }
  :global(html), :global(body) { margin: 0; height: 100%; background: var(--bg); color: var(--fg); font-family: Inter, system-ui, sans-serif; overflow: hidden; }
  :global(input[type='number']) { -moz-appearance: textfield; appearance: textfield; }
  :global(input[type='number']::-webkit-inner-spin-button), :global(input[type='number']::-webkit-outer-spin-button) { -webkit-appearance: none; appearance: none; margin: 0; display: none; }
  :global(select) { -webkit-appearance: none; appearance: none; background: #000 url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6'><path d='M1 1l4 4 4-4' fill='none' stroke='%239d4dff' stroke-width='1.5'/></svg>") no-repeat right 9px center; padding-right: 26px !important; border-radius: 0; }
  :global(option) { background: #000; color: #f1eaff; }
  :global(*) { scrollbar-width: thin; scrollbar-color: var(--line) transparent; }
  :global(:root[data-anim='0'] *) { animation-duration: 0s !important; transition-duration: 0s !important; }
  .app { display: flex; flex-direction: column; height: 100vh; }
  .body { flex: 1; display: flex; min-height: 0; }
  .body.hid { display: none; }
  .center { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
  .chartarea { flex: 1; position: relative; min-width: 0; min-height: 0; display: flex; }
  .grid { flex: 1; display: grid; gap: 10px; padding: 12px; background: var(--bg); min-width: 0; min-height: 0; }
  .rcol { flex: none; display: grid; margin: 12px 12px 12px 0; min-height: 0; min-width: 0; }
  .vsplit { width: 8px; flex: none; margin: 12px 0; cursor: col-resize; position: relative; }
  .vsplit::after, .lsplit::after, .hv::after, .hh::after { content: ''; position: absolute; inset: 0; margin: auto; background: var(--accent); opacity: 0; transition: opacity 0.15s; }
  .vsplit::after { width: 2px; height: 100%; } .lsplit::after { height: 2px; width: 100%; }
  .vsplit:hover::after, .lsplit:hover::after, .hv:hover::after, .hh:hover::after { opacity: 1; }
  .lsplit { cursor: row-resize; position: relative; }
  .ov { position: absolute; inset: 12px; pointer-events: none; }
  .hv, .hh { position: absolute; pointer-events: auto; }
  .hv { top: 0; bottom: 0; width: 10px; cursor: col-resize; } .hv::after { width: 2px; height: 100%; }
  .hh { left: 0; right: 0; height: 10px; cursor: row-resize; } .hh::after { height: 2px; width: 100%; }
  .l1 { grid-template: 1fr / 1fr; }
  .l2v { grid-template-rows: 1fr; }
  .l2h { grid-template-columns: 1fr; }
  .l3 :global(.pane:first-child) { grid-row: 1 / span 2; }
  .toast { position: fixed; bottom: 22px; left: 50%; transform: translateX(-50%); padding: 10px 18px; border-radius: 2px; font-size: 13px; background: var(--glass); border: 1px solid var(--glass-line); z-index: 200; }
</style>
