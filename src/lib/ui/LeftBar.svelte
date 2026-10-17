<script lang="ts">
  import { app } from '$lib/app.svelte';
  import { DRAW_TOOLS } from '$lib/chart/renderer';
  import Icons from './Icons.svelte';
  const names: Record<string, string> = { cursor: 'Cursor', trend: 'Trend line', ray: 'Ray', arrow: 'Arrow', hline: 'Horizontal line', vline: 'Vertical line', rect: 'Rectangle', fib: 'Fib retracement', text: 'Text', measure: 'Measure' };
</script>

<aside>
  {#each DRAW_TOOLS as tool}
    <button class:on={app.tool === tool} title={names[tool]} onclick={() => (app.tool = tool)}><Icons name={tool} /></button>
  {/each}
  <i></i>
  <button class:on={app.magnet} title="Magnet" onclick={() => { app.magnet = !app.magnet; app.persist(); }}><Icons name="magnet" /></button>
  <button title="Remove all drawings (this symbol)" onclick={() => (app.chart.drawings = app.chart.drawings.filter((d) => d.sym !== app.chart.symbol))}><Icons name="trash" /></button>
</aside>

<style>
  aside { width: 46px; flex: none; display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 8px 0; border-right: 1px solid var(--line); background: var(--bar); }
  button { width: 34px; height: 34px; display: grid; place-items: center; background: none; border: 0; border-radius: 9px; color: var(--dim); cursor: pointer; transition: background 0.12s, color 0.12s; }
  button:hover { color: var(--fg); background: var(--hover); }
  button.on { color: #fff; background: var(--accent); }
  i { width: 22px; height: 1px; background: var(--line); margin: 6px 0; }
</style>
