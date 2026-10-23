<script lang="ts">
  import { app } from '$lib/app.svelte';
  import { DRAW_GROUPS } from '$lib/chart/renderer';
  import Icons from './Icons.svelte';
  const names: Record<string, string> = {
    cursor: 'Cursor', trend: 'Trend line', ray: 'Ray', extline: 'Extended line', hray: 'Horizontal ray', arrow: 'Arrow', arrowpath: 'Arrow path (click to extend, Enter / double click to finish)', hline: 'Horizontal line', vline: 'Vertical line', crossline: 'Cross line',
    channel: 'Parallel channel', pitchfork: 'Pitchfork', rect: 'Rectangle', ellipse: 'Ellipse', circle: 'Circle', triangle: 'Triangle',
    fib: 'Fib retracement', fibext: 'Trend-based fib extension', longpos: 'Long position', shortpos: 'Short position', measure: 'Measure', pricerange: 'Price range', daterange: 'Date range',
    brush: 'Brush', arrowup: 'Arrow up marker', arrowdown: 'Arrow down marker', text: 'Text', callout: 'Callout'
  };
</script>

<aside>
  {#each DRAW_GROUPS as group, gi}
    {#if gi > 0}<i></i>{/if}
    {#each group as tool}
      <button class:on={app.tool === tool} title={names[tool]} onclick={() => (app.tool = tool)}><Icons name={tool} /></button>
    {/each}
  {/each}
  <i></i>
  <button class:on={app.magnet} title="Magnet" onclick={() => { app.magnet = !app.magnet; app.persist(); }}><Icons name="magnet" /></button>
  <button title="Remove all drawings (this symbol)" onclick={() => (app.chart.drawings = app.chart.drawings.filter((d) => d.sym !== app.chart.symbol))}><Icons name="trash" /></button>
</aside>

<style>
  aside { width: 46px; flex: none; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 8px 0; overflow-y: auto; overflow-x: hidden; scrollbar-width: none; border-right: 1px solid var(--line); background: var(--bar); }
  button { width: 34px; height: 32px; flex: none; display: grid; place-items: center; background: none; border: 0; border-radius: 2px; color: var(--dim); cursor: pointer; transition: background 0.12s, color 0.12s; }
  button:hover { color: var(--fg); background: var(--hover); }
  button.on { color: #fff; background: var(--accent); }
  i { width: 22px; height: 1px; background: var(--line); margin: 4px 0; flex: none; }
</style>
