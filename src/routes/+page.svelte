<script lang="ts">
  import { onMount } from 'svelte';
  import ChartPane from '$lib/chart/ChartPane.svelte';

  let fps = $state(0);
  const symbols = ['AAPL', 'MSFT', 'BTC/USD', 'SPY'];

  onMount(() => {
    let frames = 0, last = performance.now(), id = 0;
    const loop = (t: number) => {
      frames++;
      if (t - last >= 500) { fps = Math.round((frames * 1000) / (t - last)); frames = 0; last = t; }
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  });
</script>

<main>
  <div class="grid">
    {#each symbols as s, i}
      <ChartPane symbol={s} seed={i + 1} />
    {/each}
  </div>
  <div class="hud glass">Oviate · spike · {fps} fps · drag to pan, wheel to zoom</div>
</main>

<style>
  :global(:root) {
    --bg: #0b0a14; --pane-bg: rgba(20, 18, 36, 0.55); --stroke: rgba(255, 255, 255, 0.09);
    --accent: #8b5cf6; --fg: rgba(255, 255, 255, 0.9);
    --glass-bg: rgba(255, 255, 255, 0.07);
  }
  @media (prefers-color-scheme: light) {
    :global(:root) {
      --bg: #f2f0fa; --pane-bg: rgba(255, 255, 255, 0.6); --stroke: rgba(0, 0, 0, 0.08);
      --fg: rgba(0, 0, 0, 0.85); --glass-bg: rgba(255, 255, 255, 0.55);
    }
  }
  :global(html, body) { margin: 0; height: 100%; background: var(--bg); color: var(--fg);
    font-family: Inter, system-ui, sans-serif; overflow: hidden; }
  :global(.glass) { background: var(--glass-bg); border: 1px solid var(--stroke);
    backdrop-filter: blur(20px) saturate(160%); -webkit-backdrop-filter: blur(20px) saturate(160%);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12), 0 8px 32px rgba(0, 0, 0, 0.25); }
  main { height: 100vh; position: relative;
    background: radial-gradient(900px 600px at 15% 10%, color-mix(in srgb, var(--accent) 35%, transparent), transparent),
                radial-gradient(800px 600px at 90% 90%, rgba(56, 189, 248, 0.2), transparent), var(--bg); }
  .grid { position: absolute; inset: 12px; display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; gap: 12px; }
  .hud { position: absolute; bottom: 24px; left: 50%; transform: translateX(-50%); padding: 8px 18px; border-radius: 999px; font-size: 12px; }
</style>
