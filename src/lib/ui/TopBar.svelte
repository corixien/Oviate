<script lang="ts">
  import { app, type LayoutId } from '$lib/app.svelte';
  import { TIMEFRAMES, type Tf } from '$lib/api';
  import { CHART_TYPES } from '$lib/chart/transforms';
  import Icons from './Icons.svelte';

  const quick: Tf[] = ['1m', '5m', '15m', '1h', '4h', '1d', '1w'];
  let menu = $state<'' | 'tf' | 'type' | 'layout'>('');
  const layouts: LayoutId[] = ['1', '2v', '2h', '3', '4'];
  const lab = (tf: string) => tf.replace('1d', '1D').replace('1w', '1W').replace('1M', '1M');
  const toggle = (m: 'tf' | 'type' | 'layout') => (menu = menu === m ? '' : m);
</script>

<svelte:window onpointerdown={(e) => { if (!(e.target as HTMLElement).closest('.menuwrap')) menu = ''; }} />

<header>
  <div class="logo" title="Oviate">O<span>V</span>IATE</div>
  <button class="sym" onclick={() => (app.spotlight = { open: true, seed: '' })}>
    <Icons name="search" size={15} /> {app.chart.symbol}
  </button>
  <i class="sep"></i>
  <div class="tfs">
    {#each quick as tf}
      <button class:on={app.chart.tf === tf} onclick={() => (app.chart.tf = tf)}>{lab(tf)}</button>
    {/each}
    <div class="menuwrap">
      <button class="more" class:on={!quick.includes(app.chart.tf)} onclick={() => toggle('tf')}>{quick.includes(app.chart.tf) ? '⌄' : lab(app.chart.tf)}</button>
      {#if menu === 'tf'}
        <div class="menu">{#each TIMEFRAMES as tf}<button class:on={app.chart.tf === tf} onclick={() => { app.chart.tf = tf; menu = ''; }}>{lab(tf)}</button>{/each}</div>
      {/if}
    </div>
  </div>
  <i class="sep"></i>
  <div class="menuwrap">
    <button class="ib" onclick={() => toggle('type')} title="Chart type"><Icons name="candle" /> <span>{app.chart.type}</span></button>
    {#if menu === 'type'}
      <div class="menu">{#each CHART_TYPES as ct}<button class:on={app.chart.type === ct} onclick={() => { app.chart.type = ct; menu = ''; }}>{ct}</button>{/each}</div>
    {/if}
  </div>
  <button class="ib" onclick={() => (app.spotlight = { open: true, seed: '/ind add ' })} title="Indicators"><Icons name="ind" /> <span>Indicators</span></button>
  <div class="grow"></div>
  <div class="menuwrap">
    <button class="ib" onclick={() => toggle('layout')} title="Layout"><Icons name="layout" /> <span>{app.layout}</span></button>
    {#if menu === 'layout'}
      <div class="menu right">{#each layouts as l}<button class:on={app.layout === l} onclick={() => { app.layout = l; if (app.active >= app.count) app.active = 0; app.persist(); menu = ''; }}>{l === '1' ? 'Single' : l === '2v' ? '2 side by side' : l === '2h' ? '2 stacked' : l + ' charts'}</button>{/each}</div>
    {/if}
  </div>
  <button class="ib sq" class:on={app.sync} onclick={() => { app.sync = !app.sync; app.persist(); }} title="Sync crosshair"><Icons name="sync" /></button>
  <button class="ib sq" class:on={app.showWatchlist} onclick={() => { app.showWatchlist = !app.showWatchlist; app.persist(); }} title="Watchlist"><Icons name="list" /></button>
  <button class="ib sq" onclick={() => (app.settingsOpen = true)} title="Settings"><Icons name="gear" /></button>
</header>

<style>
  header { display: flex; align-items: center; gap: 4px; height: 46px; padding: 0 10px; border-bottom: 1px solid var(--line); background: var(--bar); flex: none; }
  .logo { font: 800 14px system-ui, sans-serif; letter-spacing: 0.32em; color: var(--fg); margin: 0 14px 0 4px; user-select: none; }
  .logo span { color: var(--accent); }
  .sep { width: 1px; height: 20px; background: var(--line); margin: 0 8px; }
  .grow { flex: 1; }
  button { background: none; border: 1px solid transparent; color: var(--fg); font: 600 13px system-ui, sans-serif; padding: 6px 10px; border-radius: 8px; cursor: pointer; display: inline-flex; gap: 7px; align-items: center; transition: background 0.12s, color 0.12s; }
  button:hover { background: var(--hover); }
  button.on { color: var(--accent); background: var(--accent-soft); }
  .sym { border-color: var(--line); padding: 6px 14px; }
  .sym:hover { border-color: var(--accent); }
  .tfs { display: flex; gap: 2px; align-items: center; }
  .ib span { text-transform: capitalize; }
  .sq { padding: 7px; }
  .menuwrap { position: relative; }
  .menu { position: absolute; top: calc(100% + 6px); left: 0; z-index: 50; min-width: 150px; padding: 6px; border-radius: 14px; display: flex; flex-direction: column;
    background: var(--glass); border: 1px solid var(--glass-line); backdrop-filter: blur(30px) saturate(180%); -webkit-backdrop-filter: blur(30px) saturate(180%);
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6); animation: m 0.22s cubic-bezier(0.34, 1.56, 0.64, 1) both; transform-origin: top left; }
  .menu.right { left: auto; right: 0; transform-origin: top right; }
  .menu button { justify-content: flex-start; text-transform: capitalize; font-weight: 500; }
  @keyframes m { from { opacity: 0; transform: scale(0.92) translateY(-6px); filter: blur(6px); } }
</style>
