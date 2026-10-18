<script lang="ts">
  import { app } from '$lib/app.svelte';
  import { indicatorById, indicatorCode } from '$lib/chart/indicators';

  const ind = $derived(app.chart.indicators.find((i) => i.uid === app.indDialog?.uid));
  const def = $derived(ind ? indicatorById(ind.id) : undefined);
  const defaultColors = $derived(def && ind ? def.compute({ n: 0, t: new Float64Array(0), o: new Float64Array(0), h: new Float64Array(0), l: new Float64Array(0), c: new Float64Array(0), v: new Float64Array(0) }, ind.params).map((l) => ({ name: l.name, color: l.color })) : []);
  const code = $derived(ind ? indicatorCode(ind.id, ind.params) : '');
  let copied = $state(false);

  const close = () => (app.indDialog = null);
  function setParam(k: string, v: string) {
    const n = parseFloat(v);
    if (ind && Number.isFinite(n) && n > 0) { ind.params[k] = n; app.persist(); }
  }
  function setColor(i: number, c: string) {
    if (!ind) return;
    const cols = ind.colors ? [...ind.colors] : [];
    cols[i] = c; ind.colors = cols; app.persist();
  }
  async function copy() {
    try { await navigator.clipboard.writeText(code); copied = true; setTimeout(() => (copied = false), 1200); } catch { /* clipboard unavailable */ }
  }
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape' && app.indDialog) close(); }} />

{#if app.indDialog && ind && def}
  <div class="scrim" onpointerdown={close} role="presentation">
    <div class="card" onpointerdown={(e) => e.stopPropagation()} role="dialog" tabindex="-1" aria-label={def.label}>
      <header>
        <h2>{def.label.replace(/ \(.*\)/, '')}</h2>
        <div class="tabs">
          <button class:on={app.indDialog.mode === 'settings'} onclick={() => (app.indDialog = { uid: ind.uid, mode: 'settings' })}>Settings</button>
          <button class:on={app.indDialog.mode === 'code'} onclick={() => (app.indDialog = { uid: ind.uid, mode: 'code' })}>Source code</button>
        </div>
        <button class="x" onclick={close} aria-label="Close">×</button>
      </header>

      {#if app.indDialog.mode === 'settings'}
        <section>
          <h3>Inputs</h3>
          {#each Object.entries(ind.params) as [k, v] (k)}
            <label><span>{k}</span><input type="number" step="any" min="0" value={v} onchange={(e) => setParam(k, e.currentTarget.value)} /></label>
          {:else}
            <p class="dim">No inputs.</p>
          {/each}
          <h3>Style</h3>
          {#each defaultColors as c, i (c.name)}
            <label><span>{c.name}</span><input type="color" value={ind.colors?.[i] ?? c.color} oninput={(e) => setColor(i, e.currentTarget.value)} /></label>
          {/each}
          <h3>Visibility</h3>
          <label><span>Visible</span><input type="checkbox" checked={!ind.hidden} onchange={(e) => { ind.hidden = !e.currentTarget.checked; app.persist(); }} /></label>
          <label><span>Show parameters in legend</span><input type="checkbox" checked={ind.showParams ?? app.showParams} onchange={(e) => { ind.showParams = e.currentTarget.checked; app.persist(); }} /></label>
        </section>
        <footer>
          <button onclick={() => { ind.params = { ...def.params }; ind.colors = undefined; app.persist(); }}>Defaults</button>
          <button class="primary" onclick={close}>Done</button>
        </footer>
      {:else}
        <pre>{code}</pre>
        <footer>
          <button onclick={copy}>{copied ? 'Copied' : 'Copy'}</button>
          <button class="primary" onclick={close}>Close</button>
        </footer>
      {/if}
    </div>
  </div>
{/if}

<style>
  .scrim { position: fixed; inset: 0; z-index: 95; display: grid; place-items: center; background: rgba(0, 0, 0, 0.7); animation: fade 0.15s ease both; }
  .card { width: min(520px, calc(100vw - 32px)); max-height: 86vh; overflow: auto; background: var(--glass); border: 1px solid var(--accent); box-shadow: 0 0 0 1px var(--accent), 0 0 40px rgba(157, 77, 255, 0.25); animation: pop 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) both; }
  @keyframes fade { from { opacity: 0 } }
  @keyframes pop { from { opacity: 0; transform: scale(0.95); } }
  header { display: flex; align-items: center; gap: 16px; padding: 14px 18px; border-bottom: 1px solid var(--line); }
  h2 { margin: 0; font-size: 16px; flex: 1; } h3 { margin: 16px 0 6px; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--accent); }
  .tabs { display: flex; border: 1px solid var(--line); }
  .tabs button { border: 0; background: none; color: var(--dim); padding: 6px 12px; font: 600 12px system-ui, sans-serif; cursor: pointer; }
  .tabs button.on { background: var(--accent); color: #fff; }
  .x { background: none; border: 0; color: var(--dim); font-size: 22px; cursor: pointer; } .x:hover { color: var(--fg); }
  section { padding: 4px 18px 8px; }
  label { display: flex; justify-content: space-between; align-items: center; padding: 7px 0; border-bottom: 1px solid var(--line); font-size: 13px; }
  label span { text-transform: capitalize; }
  input[type='number'] { width: 90px; padding: 6px 8px; background: #000; border: 1px solid var(--line); color: var(--fg); font: 13px ui-monospace, monospace; outline: none; }
  input[type='number']:focus { border-color: var(--accent); }
  input[type='color'] { width: 38px; height: 24px; border: 1px solid var(--line); background: none; padding: 0; cursor: pointer; }
  input[type='checkbox'] { accent-color: var(--accent); width: 16px; height: 16px; }
  .dim { color: var(--dim); font-size: 13px; }
  pre { margin: 0; padding: 16px 18px; font: 12.5px/1.6 ui-monospace, monospace; color: var(--fg); background: #000; overflow: auto; max-height: 50vh; white-space: pre; }
  footer { display: flex; justify-content: flex-end; gap: 10px; padding: 12px 18px; border-top: 1px solid var(--line); }
  footer button { font: 600 13px system-ui, sans-serif; padding: 8px 16px; border: 1px solid var(--glass-line); background: none; color: var(--fg); cursor: pointer; }
  footer button:hover { border-color: var(--accent); }
  footer .primary { background: var(--accent); border-color: var(--accent); color: #fff; }
</style>
