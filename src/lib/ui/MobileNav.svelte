<script lang="ts">
  import { app } from '$lib/app.svelte';
  import { paper } from '$lib/paper/paper.svelte';
  import { sync } from '$lib/sync.svelte';
  import { TIMEFRAMES } from '$lib/api';
  import { CHART_TYPES } from '$lib/chart/transforms';
  import Icons from './Icons.svelte';

  const lab = (tf: string) => tf.replace('1d', '1D').replace('1w', '1W');
  const go = (p: typeof app.page) => { app.page = p; app.sheet = ''; if (p === 'trade') { paper.panelOpen = true; paper.persist(); } };
  const draw = () => { app.page = 'chart'; app.sheet = ''; app.drawOpen = !app.drawOpen; if (!app.drawOpen) app.tool = 'cursor'; };
  const more = (f: () => void) => () => { app.sheet = ''; f(); };

  // swipe the sheet down to close it (it follows the finger; a short pull springs back)
  let dragY = $state(0), dragFrom: number | null = null, dragT = 0;
  const down = (e: PointerEvent) => { dragFrom = e.clientY; dragT = e.timeStamp; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); };
  const move = (e: PointerEvent) => { if (dragFrom !== null) dragY = Math.max(0, e.clientY - dragFrom); };
  const up = (e: PointerEvent) => {
    if (dragFrom === null) return;
    const fast = dragY / Math.max(1, e.timeStamp - dragT) > 0.5; // px per ms
    dragFrom = null;
    if (dragY > 90 || (fast && dragY > 25)) app.sheet = '';
    dragY = 0;
  };
</script>

<nav>
  <button class:on={app.page === 'chart' && !app.drawOpen} onclick={() => { go('chart'); app.drawOpen = false; }}><Icons name="candle" /><span>Chart</span></button>
  <button class:on={app.page === 'watchlist'} onclick={() => go('watchlist')}><Icons name="list" /><span>Watchlist</span></button>
  <button class:on={app.page === 'chart' && app.drawOpen} onclick={draw}><Icons name="trend" /><span>Draw</span></button>
  <button class:on={app.page === 'trade'} onclick={() => go('trade')}><Icons name="wallet" /><span>Trade</span></button>
  <button class:on={app.sheet === 'more' || ['news', 'calendar', 'editor'].includes(app.page)} onclick={() => (app.sheet = app.sheet === 'more' ? '' : 'more')}><Icons name="blocks" /><span>More</span></button>
</nav>

{#if app.sheet}
  <div class="mscrim" onpointerdown={() => (app.sheet = '')} role="presentation">
    <div class="sheet" style:transform={dragY ? `translateY(${dragY}px)` : undefined} onpointerdown={(e) => { e.stopPropagation(); down(e); }} onpointermove={move} onpointerup={up} onpointercancel={up} role="dialog" aria-label="Menu">
      <i class="grab"></i>
      {#if app.sheet === 'tf'}
        <h4>Timeframe</h4>
        <div class="grid">{#each TIMEFRAMES as tf}<button class:on={app.chart.tf === tf} onclick={() => { app.chart.tf = tf; app.sheet = ''; app.persist(); }}>{lab(tf)}</button>{/each}</div>
      {:else if app.sheet === 'type'}
        <h4>Chart type</h4>
        <div class="grid">{#each CHART_TYPES as ct}<button class:on={app.chart.type === ct} onclick={() => { app.chart.type = ct; app.sheet = ''; app.persist(); }}>{ct}</button>{/each}</div>
      {:else}
        <div class="list">
          <button onclick={more(() => go('news'))}><Icons name="news" /> News</button>
          <button onclick={more(() => go('calendar'))}><Icons name="calendar" /> Economic calendar</button>
          <button onclick={more(() => app.openEditor('strategies'))}><Icons name="blocks" /> Strategies: code editor</button>
          <button onclick={more(() => app.openEditor('indicators'))}><Icons name="ind" /> Indicators: code editor</button>
          <button onclick={more(() => (app.replayReq = { id: app.chart.id, n: app.replayReq.n + 1 }))}><Icons name="candle" /> Replay</button>
          <button onclick={more(() => (app.sessionsOpen = true))}><Icons name="calendar" /> Session times</button>
          <button onclick={more(() => (app.settingsOpen = true))}><Icons name="gear" /> Settings{sync.signedIn ? ' · ' + sync.user?.name : ''}</button>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  nav { display: flex; flex: none; height: calc(56px + env(safe-area-inset-bottom)); padding: 0 env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); border-top: 1px solid var(--line); background: var(--bar); }
  nav button { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; background: none; border: 0; color: var(--dim); font: 600 10.5px system-ui, sans-serif; letter-spacing: 0.04em; }
  nav button.on { color: var(--accent); }
  .mscrim { position: fixed; inset: 0; z-index: 90; background: rgba(0, 0, 0, 0.55); display: flex; align-items: flex-end; }
  .sheet { touch-action: none; width: 100%; max-height: 80vh; overflow: auto; padding: 8px 12px calc(14px + env(safe-area-inset-bottom)); background: var(--glass); border-top: 1px solid var(--glass-line); box-shadow: 0 -1px 0 1px rgba(168, 85, 247, 0.22); }
  .grab { display: block; width: 38px; height: 4px; background: var(--line); margin: 2px auto 10px; }
  h4 { margin: 0 4px 10px; font: 700 11px system-ui, sans-serif; letter-spacing: 0.1em; text-transform: uppercase; color: var(--accent); }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .grid button, .list button { height: 48px; background: none; border: 1px solid var(--line); color: var(--fg); font: 600 14px system-ui, sans-serif; text-transform: capitalize; border-radius: 2px; }
  .grid button.on { background: var(--accent); border-color: var(--accent); color: #fff; }
  .list { display: flex; flex-direction: column; gap: 8px; }
  .list button { display: flex; align-items: center; gap: 12px; padding: 0 14px; text-transform: none; text-align: left; }
  .list button :global(svg) { color: var(--accent); }
</style>
