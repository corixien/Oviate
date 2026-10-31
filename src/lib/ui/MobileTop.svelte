<script lang="ts">
  import { app } from '$lib/app.svelte';
  import Icons from './Icons.svelte';
  const lab = (tf: string) => tf.replace('1d', '1D').replace('1w', '1W');
</script>

<!-- phone top bar: symbol, timeframe, chart type, indicators, menu -->
<header>
  <button class="sym" onclick={() => (app.spotlight = { open: true, seed: '' })}><Icons name="search" size={16} /> {app.chart.symbol}</button>
  <button onclick={() => (app.sheet = 'tf')}>{lab(app.chart.tf)}</button>
  <button class="ic" onclick={() => (app.sheet = 'type')} aria-label="Chart type"><Icons name="candle" /></button>
  <button class="ic" onclick={() => (app.spotlight = { open: true, seed: '/ind add ' })} aria-label="Indicators"><Icons name="ind" /></button>
  <button class="ic" onclick={() => (app.spotlight = { open: true, seed: '/strat add ' })} aria-label="Strategies"><Icons name="blocks" /></button>
</header>

<style>
  header { display: flex; align-items: center; gap: 6px; height: calc(48px + env(safe-area-inset-top)); padding: env(safe-area-inset-top) calc(8px + env(safe-area-inset-right)) 0 calc(8px + env(safe-area-inset-left)); border-bottom: 1px solid var(--line); background: var(--bar); flex: none; }
  .grow { flex: 1; }
  button { box-sizing: border-box; height: 40px; min-width: 40px; background: none; border: 1px solid transparent; color: var(--fg); font: 700 14px system-ui, sans-serif; padding: 0 10px; border-radius: 2px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
  button:active { background: var(--accent-soft); }
  /* every button has the outline of the search button */
  button { border-color: var(--line); }
  .sym { padding: 0 12px; max-width: 42vw; overflow: hidden; white-space: nowrap; }
  .ic { padding: 0; color: var(--dim); }
</style>
