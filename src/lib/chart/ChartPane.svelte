<script lang="ts">
  import { onMount } from 'svelte';
  import { ChartRenderer } from './renderer';
  import { synthCandles } from './data';

  let { symbol, seed, bars = 100_000 }: { symbol: string; seed: number; bars?: number } = $props();

  let canvas: HTMLCanvasElement;
  let box: HTMLDivElement;
  let r: ChartRenderer;

  onMount(() => {
    const dark = () => matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = () => ({
      up: '#34d399',
      down: '#f87171',
      grid: dark() ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)',
      text: dark() ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.55)'
    });
    r = new ChartRenderer(canvas, synthCandles(bars, seed), theme());
    const ro = new ResizeObserver(([e]) => r.resize(e.contentRect.width, e.contentRect.height));
    ro.observe(box);

    let drag = false;
    const down = (e: PointerEvent) => { drag = true; canvas.setPointerCapture(e.pointerId); };
    const up = () => (drag = false);
    const move = (e: PointerEvent) => drag && r.pan(e.movementX);
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      r.zoom(Math.exp(-e.deltaY * 0.0015), e.offsetX);
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('wheel', wheel, { passive: false });
    return () => { ro.disconnect(); r.destroy(); };
  });
</script>

<div class="pane" bind:this={box}>
  <canvas bind:this={canvas}></canvas>
  <div class="tag glass">{symbol} · 1m · {bars.toLocaleString()} bars</div>
</div>

<style>
  .pane { position: relative; min-width: 0; min-height: 0; border-radius: 18px; overflow: hidden;
    background: var(--pane-bg); border: 1px solid var(--stroke); }
  canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; cursor: crosshair; touch-action: none; }
  .tag { position: absolute; top: 10px; left: 12px; padding: 5px 12px; border-radius: 999px; font-size: 12px; pointer-events: none; }
</style>
