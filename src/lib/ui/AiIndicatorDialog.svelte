<script lang="ts">
  import { app } from '$lib/app.svelte';
  import { library, scriptMeta } from '$lib/library.svelte';
  import { aiComplete } from '$lib/api';
  import { genIndicator } from '$lib/builder/ai.ts';

  let text = $state('');
  let code = $state('');
  let busy = $state(false);
  let error = $state('');
  let ta = $state<HTMLTextAreaElement>();

  const title = $derived(code ? scriptMeta(code).title : '');
  const close = () => { if (!busy) app.aiDialog = false; };

  $effect(() => { if (app.aiDialog) setTimeout(() => ta?.focus(), 30); });

  async function generate() {
    if (busy) return;
    busy = true; error = ''; code = '';
    try { code = await genIndicator(text, aiComplete, library.indicators); }
    catch (e) { error = e instanceof Error ? e.message : String(e); }
    finally { busy = false; }
  }

  async function add() {
    try {
      const name = await library.save('indicators', title || 'AI indicator', code);
      app.chart.indicators = [...app.chart.indicators, { uid: crypto.randomUUID(), id: name, params: {} }];
      app.persist();
      app.notify(`Added ${title}`);
      app.aiDialog = false; text = ''; code = '';
    } catch (e) { error = String(e); }
  }

  function key(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (code && !busy) add(); else generate(); }
  }
</script>

{#if app.aiDialog}
  <div class="scrim" onpointerdown={close} role="presentation">
    <div class="card" onpointerdown={(e) => e.stopPropagation()} onkeydown={key} role="dialog" tabindex="-1" aria-label="New indicator from text">
      <header><h2>New indicator from text</h2><button class="x" onclick={close} aria-label="Close">×</button></header>
      <section>
        <p class="dim">Describe the indicator in your own words. the AI writes the Pine code, it is saved as a normal indicator and added to the chart.</p>
        <textarea bind:this={ta} bind:value={text} rows="4" spellcheck="false" placeholder="e.g. RSI of the volume-weighted close, with a signal line (EMA 9) and highlighted zones above 70 and below 30"></textarea>
        {#if error}<p class="err">{error}</p>{/if}
        {#if code}<pre>{code}</pre>{/if}
      </section>
      <footer>
        <button onclick={generate} disabled={busy || !text.trim()}>{busy ? 'Generating…' : code ? 'Regenerate' : 'Generate'}{#if !code} <kbd>Ctrl+Enter</kbd>{/if}</button>
        {#if code}<button class="primary" onclick={add}>Add to chart <kbd>Ctrl+Enter</kbd></button>{/if}
      </footer>
    </div>
  </div>
{/if}

<style>
  .scrim { position: fixed; inset: 0; z-index: 95; display: grid; place-items: center; background: rgba(0, 0, 0, 0.7); }
  .card { width: min(640px, calc(100vw - 32px)); max-height: 86vh; overflow: auto; background: var(--glass); border: 1px solid var(--glass-line); box-shadow: 0 0 0 1px rgba(168, 85, 247, 0.22), 0 30px 90px rgba(0, 0, 0, 0.7); }
  header { display: flex; align-items: center; gap: 16px; padding: 14px 18px; border-bottom: 1px solid var(--line); }
  h2 { margin: 0; font-size: 16px; flex: 1; }
  .x { background: none; border: 0; color: var(--dim); font-size: 22px; cursor: pointer; } .x:hover { color: var(--fg); }
  section { padding: 12px 18px; }
  textarea { width: 100%; box-sizing: border-box; resize: vertical; padding: 10px 12px; background: #000; border: 1px solid var(--line); color: var(--fg); font: 13px/1.5 system-ui, sans-serif; outline: none; }
  textarea:focus { border-color: var(--accent); }
  .dim { color: var(--dim); font-size: 12.5px; margin: 0 0 10px; } .err { color: var(--down); font-size: 12.5px; }
  pre { margin: 12px 0 0; padding: 12px 14px; font: 12px/1.55 ui-monospace, monospace; color: var(--fg); background: #000; border: 1px solid var(--line); overflow: auto; max-height: 36vh; white-space: pre; }
  footer { display: flex; justify-content: flex-end; gap: 10px; padding: 12px 18px; border-top: 1px solid var(--line); }
  footer button { font: 600 13px system-ui, sans-serif; padding: 8px 16px; border: 1px solid var(--glass-line); background: none; color: var(--fg); cursor: pointer; }
  footer button:hover:not(:disabled) { border-color: var(--accent); } footer button:disabled { opacity: 0.5; cursor: default; }
  footer .primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  kbd { font: 10px ui-monospace, monospace; opacity: 0.7; margin-left: 6px; }
</style>
