<script lang="ts">
  import { app } from '$lib/app.svelte';
  import { library, type ScriptKind } from '$lib/library.svelte';
  import { describeScript } from '$lib/pine/describe.ts';
  import { tick } from 'svelte';

  const kind = $derived<ScriptKind>(app.editor.kind);
  const files = $derived(library.list(kind));
  const label = $derived(kind === 'indicators' ? 'Indicator' : 'Strategy');

  const TEMPLATES: Record<ScriptKind, string> = {
    indicators: `//@version=5
indicator("My Indicator", shorttitle="Mine", overlay=false)

length = input.int(14, "Length", minval=1)
src = input.source(close, "Source")

value = ta.sma(src, length)
plot(value, "Value", color=color.purple)
`,
    strategies: `//@version=5
strategy("My Strategy", overlay=true, initial_capital=10000, default_qty_type=strategy.percent_of_equity, default_qty_value=100)

// Write your entry and exit rules here, for example:
// if <condition>
//     strategy.entry("Long", strategy.long)
// if <condition>
//     strategy.close("Long")
`,
  };

  let name = $state('');
  let code = $state('');
  let loadedKey = '';
  let status = $state<{ ok: boolean; text: string } | null>(null);
  let saving = $state(false);
  let ta = $state<HTMLTextAreaElement>();
  let gutter = $state<HTMLDivElement>();
  const lines = $derived(code.split('\n').length);
  const isNew = $derived(app.editor.name === null);

  function open(k: ScriptKind, n: string | null) {
    app.editor = { kind: k, name: n };
  }

  $effect(() => {
    const key = kind + '|' + (app.editor.name ?? '');
    if (key === loadedKey) return;
    loadedKey = key;
    status = null;
    if (app.editor.name === null) { name = ''; code = TEMPLATES[kind]; }
    else {
      const f = library.get(kind, app.editor.name);
      name = f?.name ?? app.editor.name;
      code = f?.code ?? '';
    }
  });

  function check(): boolean {
    const info = describeScript(code);
    if (info.error) { status = { ok: false, text: `${info.error.line ? 'Line ' + info.error.line + ': ' : ''}${info.error.message}` }; return false; }
    const expected = kind === 'indicators' ? 'indicator' : 'strategy';
    if (info.meta.kind !== expected && info.meta.kind !== 'indicator') { status = { ok: false, text: `Expected a ${expected}() declaration` }; return false; }
    status = { ok: true, text: `OK: "${info.meta.title}", ${info.inputs.length} input${info.inputs.length === 1 ? '' : 's'}, ${info.plots.length} plot${info.plots.length === 1 ? '' : 's'}` };
    return true;
  }

  async function save() {
    if (saving) return;
    const info = describeScript(code);
    const finalName = (name.trim() || info.meta.title || '').trim();
    if (!finalName) { status = { ok: false, text: 'Give the script a name' }; return; }
    if (!check()) return;
    saving = true;
    try {
      const saved = await library.save(kind, finalName, code);
      name = saved;
      loadedKey = kind + '|' + saved;
      app.editor = { kind, name: saved };
      status = { ok: true, text: `Saved as ${saved}.pine` };
      app.notify(`${label} saved`);
    } catch (e) { status = { ok: false, text: String(e) }; }
    finally { saving = false; }
  }

  async function remove() {
    if (!app.editor.name) return;
    if (!confirm(`Delete ${app.editor.name}.pine?`)) return;
    await library.remove(kind, app.editor.name);
    app.editor = { kind, name: null };
  }

  function addToChart() {
    if (kind !== 'indicators' || !app.editor.name) return;
    app.chart.indicators = [...app.chart.indicators, { uid: crypto.randomUUID(), id: app.editor.name, params: {} }];
    app.persist();
    app.page = 'chart';
  }

  function onKey(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
    else if (e.key === 'Tab' && ta && document.activeElement === ta) {
      e.preventDefault();
      const s = ta.selectionStart, en = ta.selectionEnd;
      code = code.slice(0, s) + '    ' + code.slice(en);
      tick().then(() => { ta!.selectionStart = ta!.selectionEnd = s + 4; });
    }
  }
  const sync = () => { if (gutter && ta) gutter.scrollTop = ta.scrollTop; };
  const back = () => (app.page = 'chart');
</script>

<svelte:window onkeydown={(e) => { if (app.page === 'editor') { onKey(e); if (e.key === 'Escape' && document.activeElement !== ta) back(); } }} />

<div class="page">
  <header>
    <button class="back" onclick={back}>← Charts</button>
    <h1>{label} editor</h1>
    <div class="seg">
      <button class:on={kind === 'indicators'} onclick={() => open('indicators', null)}>Indicators</button>
      <button class:on={kind === 'strategies'} onclick={() => open('strategies', null)}>Strategies</button>
    </div>
    <span class="path" title="Scripts are plain .pine files in this folder">{library.folder[kind] || 'browser storage'}</span>
  </header>

  <div class="cols">
    <aside>
      <button class="new" class:on={isNew} onclick={() => open(kind, null)}>+ New {label.toLowerCase()}</button>
      <div class="list">
        {#each files as f (f.name)}
          <button class:on={app.editor.name === f.name} onclick={() => open(kind, f.name)} title={f.title}>{f.name}</button>
        {:else}
          <p class="dim">No {kind} yet.</p>
        {/each}
      </div>
    </aside>

    <section class="main">
      <div class="bar">
        <input class="name" bind:value={name} placeholder={isNew ? 'File name (default: script title)' : 'File name'} spellcheck="false" disabled={!isNew} />
        <span class="ext">.pine</span>
        <div class="spacer"></div>
        <button onclick={check}>Check</button>
        {#if kind === 'indicators' && !isNew}<button onclick={addToChart}>Add to chart</button>{/if}
        {#if !isNew}<button class="danger" onclick={remove}>Delete</button>{/if}
        <button class="primary" onclick={save} disabled={saving}>Save <kbd>Ctrl+S</kbd></button>
      </div>
      <div class="editor">
        <div class="gutter" bind:this={gutter}>{#each Array(lines) as _, i}<div>{i + 1}</div>{/each}</div>
        <textarea bind:this={ta} bind:value={code} onscroll={sync} spellcheck="false" autocomplete="off" wrap="off" placeholder={`Paste your Pine Script v5 ${label.toLowerCase()} here`}></textarea>
      </div>
      {#if status}<div class="status" class:ok={status.ok}>{status.text}</div>{/if}
    </section>
  </div>
</div>

<style>
  .page { flex: 1; min-height: 0; min-width: 0; display: flex; flex-direction: column; background: var(--bg); }
  header { display: flex; align-items: center; gap: 14px; padding: 10px 16px; border-bottom: 1px solid var(--line); }
  h1 { margin: 0; font-size: 15px; letter-spacing: 0.12em; text-transform: uppercase; }
  .back { background: none; border: 1px solid var(--line); color: var(--fg); padding: 6px 12px; font: 600 12px system-ui, sans-serif; cursor: pointer; }
  .back:hover { border-color: var(--accent); color: var(--accent); }
  .seg { display: flex; border: 1px solid var(--line); }
  .seg button { background: none; border: 0; color: var(--dim); padding: 6px 12px; font: 600 12px system-ui, sans-serif; cursor: pointer; }
  .seg button.on { background: var(--accent); color: #fff; }
  .path { margin-left: auto; color: var(--dim); font: 11.5px ui-monospace, monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 50%; }
  .cols { flex: 1; min-height: 0; display: grid; grid-template-columns: 240px 1fr; }
  aside { border-right: 1px solid var(--line); display: flex; flex-direction: column; min-height: 0; }
  .new { margin: 10px; padding: 9px; background: none; border: 1px dashed var(--accent); color: var(--accent); font: 700 12px system-ui, sans-serif; cursor: pointer; }
  .new.on, .new:hover { background: var(--accent-soft); }
  .list { overflow-y: auto; flex: 1; }
  .list button { display: block; width: 100%; text-align: left; background: none; border: 0; border-left: 2px solid transparent; color: var(--fg); padding: 7px 14px; font: 12.5px ui-monospace, monospace; cursor: pointer; }
  .list button:hover { background: var(--hover); }
  .list button.on { background: var(--accent-soft); border-left-color: var(--accent); }
  .dim { color: var(--dim); font-size: 13px; padding: 10px 14px; }
  .main { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  .bar { display: flex; align-items: center; gap: 8px; padding: 8px 14px; border-bottom: 1px solid var(--line); }
  .name { width: 280px; background: #000; border: 1px solid var(--line); color: var(--fg); padding: 6px 10px; font: 13px ui-monospace, monospace; outline: none; }
  .name:focus { border-color: var(--accent); } .name:disabled { opacity: 0.7; }
  .ext { color: var(--dim); font: 13px ui-monospace, monospace; }
  .spacer { flex: 1; }
  .bar button { background: none; border: 1px solid var(--line); color: var(--fg); padding: 7px 14px; font: 600 12px system-ui, sans-serif; cursor: pointer; }
  .bar button:hover { border-color: var(--accent); }
  .bar .primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  .bar .danger:hover { border-color: var(--down); color: var(--down); }
  kbd { font: 10px ui-monospace, monospace; opacity: 0.8; margin-left: 6px; }
  .editor { flex: 1; min-height: 0; display: flex; background: #000; }
  .gutter { width: 48px; flex: none; overflow: hidden; text-align: right; padding: 12px 8px 12px 0; color: var(--dim); font: 13px/1.55 ui-monospace, monospace; border-right: 1px solid var(--line); user-select: none; }
  textarea { flex: 1; min-width: 0; resize: none; background: #000; color: var(--fg); border: 0; outline: 0; padding: 12px 14px; font: 13px/1.55 ui-monospace, monospace; tab-size: 4; white-space: pre; overflow: auto; }
  .status { padding: 8px 16px; border-top: 1px solid var(--line); font: 12.5px ui-monospace, monospace; color: var(--down); }
  .status.ok { color: var(--up); }
</style>
