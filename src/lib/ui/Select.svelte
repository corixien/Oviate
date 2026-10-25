<script lang="ts">
  import { history } from '$lib/history.ts';
  interface Opt { value: string; label: string }
  let { value, options, onchange, width = '' }: { value: string; options: Opt[]; onchange: (v: string) => void; width?: string } = $props();
  let open = $state(false);
  let root = $state<HTMLDivElement>();
  const current = $derived(options.find((o) => o.value === value)?.label ?? value);

  // a change made by the user is a back / forward step
  function change(v: string) {
    const prev = value;
    onchange(v);
    history.push({ undo: () => { onchange(prev); }, redo: () => { onchange(v); } });
  }
  function pick(v: string) { open = false; if (v !== value) change(v); }
  function key(e: KeyboardEvent) {
    if (e.key === 'Escape') { open = false; return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const i = options.findIndex((o) => o.value === value);
      const n = Math.min(options.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)));
      if (options[n].value !== value) change(options[n].value);
    }
  }
</script>

<svelte:window onpointerdown={(e) => { if (open && root && !root.contains(e.target as Node)) open = false; }} />

<div class="sel" bind:this={root} style:width={width || undefined}>
  <button type="button" class="btn" class:open onclick={() => (open = !open)} onkeydown={key}>
    <span>{current}</span>
    <svg width="10" height="6" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" /></svg>
  </button>
  {#if open}
    <div class="list" role="listbox">
      {#each options as o (o.value)}
        <button type="button" role="option" aria-selected={o.value === value} class:on={o.value === value} onclick={() => pick(o.value)}>{o.label}</button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .sel { position: relative; display: inline-block; min-width: 90px; }
  .btn { width: 100%; display: flex; justify-content: space-between; align-items: center; gap: 10px; background: #000; border: 1px solid var(--line); color: var(--fg); padding: 0 10px; height: 30px; box-sizing: border-box; font: 12.5px system-ui, sans-serif; cursor: pointer; text-align: left; }
  .btn:hover, .btn.open { border-color: var(--accent); }
  .btn svg { color: var(--accent); flex: none; transition: transform 0.15s; } .btn.open svg { transform: rotate(180deg); }
  .list { position: absolute; top: calc(100% + 2px); left: 0; min-width: 100%; z-index: 300; background: #07040d; border: 1px solid var(--accent); box-shadow: 0 10px 30px rgba(0, 0, 0, 0.7); max-height: 260px; overflow-y: auto; }
  .list button { display: block; width: 100%; background: none; border: 0; color: var(--fg); padding: 8px 12px; text-align: left; font: 12.5px system-ui, sans-serif; cursor: pointer; white-space: nowrap; }
  .list button:hover { background: var(--accent-soft); }
  .list button.on { background: var(--accent); color: #fff; }
</style>
