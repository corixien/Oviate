<script lang="ts">
  import { app } from '$lib/app.svelte';
  import { library } from '$lib/library.svelte';
  import { describeScript } from '$lib/pine/describe.ts';

  const ind = $derived(app.chart.indicators.find((i) => i.uid === app.indDialog?.uid));
  const file = $derived(ind ? library.get('indicators', ind.id) : undefined);
  const info = $derived(file ? describeScript(file.code) : null);
  let copied = $state(false);

  const close = () => (app.indDialog = null);
  const valueOf = (id: string, def: unknown) => (ind && ind.params[id] !== undefined ? ind.params[id] : def);

  function setParam(id: string, v: number | string | boolean) {
    if (!ind) return;
    ind.params = { ...ind.params, [id]: v };
    app.persist();
  }
  function setNumber(id: string, raw: string, int: boolean) {
    const n = parseFloat(raw);
    if (Number.isFinite(n)) setParam(id, int ? Math.trunc(n) : n);
  }
  function setColor(i: number, c: string) {
    if (!ind) return;
    const cols = ind.colors ? [...ind.colors] : [];
    cols[i] = c; ind.colors = cols; app.persist();
  }
  const hex6 = (c: string) => (c.length >= 7 ? c.slice(0, 7) : '#9d4dff');
  async function copy() {
    try { await navigator.clipboard.writeText(file?.code ?? ''); copied = true; setTimeout(() => (copied = false), 1200); } catch { /* clipboard unavailable */ }
  }
  function edit() {
    if (!ind) return;
    app.editor = { kind: 'indicators', name: ind.id };
    app.page = 'editor';
    close();
  }
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape' && app.indDialog) close(); }} />

{#if app.indDialog && ind && file && info}
  <div class="scrim" onpointerdown={close} role="presentation">
    <div class="card" onpointerdown={(e) => e.stopPropagation()} role="dialog" tabindex="-1" aria-label={file.title}>
      <header>
        <h2>{file.title}</h2>
        <div class="tabs">
          <button class:on={app.indDialog.mode === 'settings'} onclick={() => (app.indDialog = { uid: ind.uid, mode: 'settings' })}>Settings</button>
          <button class:on={app.indDialog.mode === 'code'} onclick={() => (app.indDialog = { uid: ind.uid, mode: 'code' })}>Source code</button>
        </div>
        <button class="x" onclick={close} aria-label="Close">×</button>
      </header>

      {#if app.indDialog.mode === 'settings'}
        <section>
          {#if info.error}<p class="err">Script error{info.error.line ? ` (line ${info.error.line})` : ''}: {info.error.message}</p>{/if}
          <h3>Inputs</h3>
          {#each info.inputs as inp (inp.id)}
            <label>
              <span>{inp.title}</span>
              {#if inp.type === 'bool'}
                <input type="checkbox" checked={valueOf(inp.id, inp.def) === true} onchange={(e) => setParam(inp.id, e.currentTarget.checked)} />
              {:else if inp.type === 'color'}
                <input type="color" value={hex6(String(valueOf(inp.id, inp.def)))} oninput={(e) => setParam(inp.id, e.currentTarget.value.toUpperCase())} />
              {:else if inp.type === 'source' || (inp.options && inp.options.length)}
                <select value={String(valueOf(inp.id, inp.def))} onchange={(e) => setParam(inp.id, inp.type === 'int' || inp.type === 'float' ? Number(e.currentTarget.value) : e.currentTarget.value)}>
                  {#each inp.options ?? [] as o}<option value={String(o)}>{o}</option>{/each}
                </select>
              {:else if inp.type === 'int' || inp.type === 'float'}
                <input type="number" step={inp.step ?? (inp.type === 'int' ? 1 : 'any')} min={inp.min} max={inp.max} value={Number(valueOf(inp.id, inp.def))}
                  onchange={(e) => setNumber(inp.id, e.currentTarget.value, inp.type === 'int')} />
              {:else}
                <input type="text" value={String(valueOf(inp.id, inp.def))} onchange={(e) => setParam(inp.id, e.currentTarget.value)} />
              {/if}
            </label>
          {:else}
            <p class="dim">This script has no inputs.</p>
          {/each}
          {#if info.plots.length}
            <h3>Style</h3>
            {#each info.plots as p, i (p.title + i)}
              <label><span>{p.title}</span><input type="color" value={hex6(ind.colors?.[i] ?? p.color)} oninput={(e) => setColor(i, e.currentTarget.value.toUpperCase())} /></label>
            {/each}
          {/if}
          <h3>Visibility</h3>
          <label><span>Visible</span><input type="checkbox" checked={!ind.hidden} onchange={(e) => { ind.hidden = !e.currentTarget.checked; app.persist(); }} /></label>
          <label><span>Show parameters in legend</span><input type="checkbox" checked={ind.showParams ?? app.showParams} onchange={(e) => { ind.showParams = e.currentTarget.checked; app.persist(); }} /></label>
        </section>
        <footer>
          <button onclick={() => { ind.params = {}; ind.colors = undefined; app.persist(); }}>Defaults</button>
          <button class="primary" onclick={close}>Done</button>
        </footer>
      {:else}
        <pre>{file.code}</pre>
        <footer>
          <button onclick={copy}>{copied ? 'Copied' : 'Copy'}</button>
          <button onclick={edit}>Edit</button>
          <button class="primary" onclick={close}>Close</button>
        </footer>
      {/if}
    </div>
  </div>
{/if}

<style>
  .scrim { position: fixed; inset: 0; z-index: 95; display: grid; place-items: center; background: rgba(0, 0, 0, 0.7); animation: fade 0.15s ease both; }
  .card { width: min(560px, calc(100vw - 32px)); max-height: 86vh; overflow: auto; background: var(--glass); border: 1px solid var(--accent); box-shadow: 0 0 0 1px var(--accent), 0 0 40px rgba(157, 77, 255, 0.25); animation: pop 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) both; }
  @keyframes fade { from { opacity: 0 } }
  @keyframes pop { from { opacity: 0; transform: scale(0.95); } }
  header { display: flex; align-items: center; gap: 16px; padding: 14px 18px; border-bottom: 1px solid var(--line); }
  h2 { margin: 0; font-size: 16px; flex: 1; } h3 { margin: 16px 0 6px; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--accent); }
  .tabs { display: flex; border: 1px solid var(--line); }
  .tabs button { border: 0; background: none; color: var(--dim); padding: 6px 12px; font: 600 12px system-ui, sans-serif; cursor: pointer; }
  .tabs button.on { background: var(--accent); color: #fff; }
  .x { background: none; border: 0; color: var(--dim); font-size: 22px; cursor: pointer; } .x:hover { color: var(--fg); }
  section { padding: 4px 18px 8px; }
  label { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 7px 0; border-bottom: 1px solid var(--line); font-size: 13px; }
  input[type='number'], input[type='text'], select { width: 130px; padding: 6px 8px; background: #000; border: 1px solid var(--line); color: var(--fg); font: 13px ui-monospace, monospace; outline: none; }
  input[type='number']:focus, input[type='text']:focus, select:focus { border-color: var(--accent); }
  input[type='color'] { width: 38px; height: 24px; border: 1px solid var(--line); background: none; padding: 0; cursor: pointer; }
  input[type='checkbox'] { accent-color: var(--accent); width: 16px; height: 16px; }
  .dim { color: var(--dim); font-size: 13px; } .err { color: var(--down); font-size: 13px; }
  pre { margin: 0; padding: 16px 18px; font: 12.5px/1.6 ui-monospace, monospace; color: var(--fg); background: #000; overflow: auto; max-height: 50vh; white-space: pre; }
  footer { display: flex; justify-content: flex-end; gap: 10px; padding: 12px 18px; border-top: 1px solid var(--line); }
  footer button { font: 600 13px system-ui, sans-serif; padding: 8px 16px; border: 1px solid var(--glass-line); background: none; color: var(--fg); cursor: pointer; }
  footer button:hover { border-color: var(--accent); }
  footer .primary { background: var(--accent); border-color: var(--accent); color: #fff; }
</style>
