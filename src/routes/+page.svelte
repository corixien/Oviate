<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from '$lib/app.svelte';
  import { onTick, streamSymbols } from '$lib/api';
  import Chart from '$lib/chart/Chart.svelte';
  import TopBar from '$lib/ui/TopBar.svelte';
  import LeftBar from '$lib/ui/LeftBar.svelte';
  import Watchlist from '$lib/ui/Watchlist.svelte';
  import Analysis from '$lib/ui/Analysis.svelte';
  import Spotlight from '$lib/ui/Spotlight.svelte';
  import Settings from '$lib/ui/Settings.svelte';
  import IndicatorDialog from '$lib/ui/IndicatorDialog.svelte';

  onMount(() => {
    app.load();
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
  <div class="body">
    <LeftBar />
    <main class="grid l{app.layout}">
      {#each app.charts.slice(0, app.count) as c, i (c.id)}
        <Chart bind:cfg={app.charts[i]} index={i} />
      {/each}
    </main>
    {#if app.showWatchlist}<div class="rcol"><Watchlist /><Analysis /></div>{/if}
  </div>
  {#if app.toast}<div class="toast">{app.toast}</div>{/if}
</div>

<Spotlight />
<Settings />
<IndicatorDialog />

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
  :global(*) { scrollbar-width: thin; scrollbar-color: var(--line) transparent; }
  :global(:root[data-anim='0'] *) { animation-duration: 0s !important; transition-duration: 0s !important; }
  .app { display: flex; flex-direction: column; height: 100vh; }
  .body { flex: 1; display: flex; min-height: 0; }
  .grid { flex: 1; display: grid; gap: 10px; padding: 12px; background: var(--bg); min-width: 0; min-height: 0; }
  .rcol { width: 290px; flex: none; display: flex; flex-direction: column; gap: 10px; margin: 12px 12px 12px 2px; min-height: 0; }
  .l1 { grid-template: 1fr / 1fr; }
  .l2v { grid-template: 1fr / 1fr 1fr; }
  .l2h { grid-template: 1fr 1fr / 1fr; }
  .l3 { grid-template: 1fr 1fr / 1fr 1fr; }
  .l3 :global(.pane:first-child) { grid-row: 1 / span 2; }
  .l4 { grid-template: 1fr 1fr / 1fr 1fr; }
  .toast { position: fixed; bottom: 22px; left: 50%; transform: translateX(-50%); padding: 10px 18px; border-radius: 2px; font-size: 13px; background: var(--glass); border: 1px solid var(--glass-line); -webkit- z-index: 200; }
</style>
