<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from '$lib/app.svelte';
  import Chart from '$lib/chart/Chart.svelte';
  import TopBar from '$lib/ui/TopBar.svelte';
  import LeftBar from '$lib/ui/LeftBar.svelte';
  import Watchlist from '$lib/ui/Watchlist.svelte';
  import Spotlight from '$lib/ui/Spotlight.svelte';
  import Settings from '$lib/ui/Settings.svelte';

  onMount(() => { app.load(); });

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
      e.preventDefault(); app.spotlight = { open: true, seed: e.key.toUpperCase() === e.key && e.key !== '/' ? e.key : e.key };
    }
  }
</script>

<svelte:window onkeydown={key} />

<div class="app">
  <TopBar />
  <div class="body">
    <LeftBar />
    <main class="grid l{app.layout}">
      {#each app.charts.slice(0, app.count) as cfg, i (cfg.id)}
        <Chart {cfg} index={i} />
      {/each}
    </main>
    {#if app.showWatchlist}<Watchlist />{/if}
  </div>
  {#if app.toast}<div class="toast">{app.toast}</div>{/if}
</div>

<Spotlight />
<Settings />

<style>
  :global(:root), :global(:root[data-theme='dark']) {
    --bg: #000; --bar: #08060c; --pane: #000; --line: #1c1626; --fg: #ece8f4; --dim: #7d7790;
    --accent: #a855f7; --accent-soft: rgba(168, 85, 247, 0.16); --hover: rgba(255, 255, 255, 0.06);
    --up: #2ee6a6; --down: #ff4d6a; --glass: rgba(14, 10, 22, 0.62); --glass-line: rgba(255, 255, 255, 0.12);
  }
  :global(:root[data-theme='light']) {
    --bg: #fff; --bar: #f7f5fb; --pane: #fff; --line: #e4def0; --fg: #17121f; --dim: #766f87;
    --accent: #7c3aed; --accent-soft: rgba(124, 58, 237, 0.12); --hover: rgba(0, 0, 0, 0.05);
    --up: #0ea371; --down: #e5334f; --glass: rgba(255, 255, 255, 0.7); --glass-line: rgba(0, 0, 0, 0.12);
  }
  :global(html), :global(body) { margin: 0; height: 100%; background: var(--bg); color: var(--fg); font-family: Inter, system-ui, sans-serif; overflow: hidden; }
  :global(*) { scrollbar-width: thin; scrollbar-color: var(--line) transparent; }
  :global(:root[data-anim='0'] *) { animation-duration: 0s !important; transition-duration: 0s !important; }
  .app { display: flex; flex-direction: column; height: 100vh; }
  .body { flex: 1; display: flex; min-height: 0; }
  .grid { flex: 1; display: grid; gap: 2px; background: var(--line); min-width: 0; min-height: 0; }
  .l1 { grid-template: 1fr / 1fr; }
  .l2v { grid-template: 1fr / 1fr 1fr; }
  .l2h { grid-template: 1fr 1fr / 1fr; }
  .l3 { grid-template: 1fr 1fr / 1fr 1fr; }
  .l3 :global(.pane:first-child) { grid-row: 1 / span 2; }
  .l4 { grid-template: 1fr 1fr / 1fr 1fr; }
  .toast { position: fixed; bottom: 22px; left: 50%; transform: translateX(-50%); padding: 10px 18px; border-radius: 999px; font-size: 13px; background: var(--glass); border: 1px solid var(--glass-line); backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px); z-index: 200; }
</style>
