<script lang="ts">
  import { app } from '$lib/app.svelte';
  import { library, scriptMeta } from '$lib/library.svelte';
  import { paper } from '$lib/paper/paper.svelte';
  import { aiComplete } from '$lib/api';
  import { genIndicator, genStrategy, strategyCheck, type StrategyOpts } from '$lib/ai/pine.ts';
  import AiStrategyFields from './AiStrategyFields.svelte';

  const kind = $derived(app.aiDialog);
  const strat = $derived(kind === 'strategies');

  let text = $state('');
  let code = $state('');
  let busy = $state(false);
  let error = $state('');
  let warn = $state('');
  let ta = $state<HTMLTextAreaElement>();

  // strategy form: size is required, stop loss / take profit are optional
  let qtyType = $state<StrategyOpts['qtyType']>('percent_of_equity');
  let qty = $state('100');
  let sl = $state('');
  let tp = $state('');
  let direction = $state<StrategyOpts['direction']>('auto');

  const num = (v: string) => { const n = parseFloat(v.replace(',', '.')); return Number.isFinite(n) ? n : NaN; };
  const qtyN = $derived(num(qty));
  const qtyOk = $derived(qtyN > 0 && (qtyType !== 'percent_of_equity' || qtyN <= 100));
  const title = $derived(code ? scriptMeta(code).title : '');
  const canGenerate = $derived(!busy && text.trim().length > 0 && (!strat || qtyOk));
  const close = () => { if (!busy) app.aiDialog = null; };

  $effect(() => { if (kind) setTimeout(() => ta?.focus(), 30); });
  $effect(() => { void kind; code = ''; error = ''; });

  async function generate() {
    if (!canGenerate) return;
    busy = true; error = ''; warn = ''; code = '';
    try {
      if (strat) {
        const opts: StrategyOpts = { qtyType, qty: qtyN, sl: num(sl) > 0 ? num(sl) : 0, tp: num(tp) > 0 ? num(tp) : 0, direction };
        code = await genStrategy(text, opts, aiComplete, library.strategies);
        warn = strategyCheck(code, opts).error ?? ''; // a draft that only fails softly (no trades on sample data) is kept: say so
      } else code = await genIndicator(text, aiComplete, library.indicators);
    } catch (e) { error = e instanceof Error ? e.message : String(e); }
    finally { busy = false; }
  }

  async function add() {
    if (!kind) return;
    try {
      const name = await library.save(kind, title || (strat ? 'AI strategy' : 'AI indicator'), code);
      if (strat) { app.addStrategy(name); paper.panelOpen = true; paper.panelTab = 'tester'; paper.persist(); }
      else app.chart.indicators = [...app.chart.indicators, { uid: crypto.randomUUID(), id: name, params: {} }];
      app.persist();
      app.notify(`Added ${title}`);
      app.aiDialog = null; text = ''; code = '';
    } catch (e) { error = String(e); }
  }

  function key(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (code && !busy) add(); else generate(); }
  }
</script>

{#if kind}
  <div class="scrim" onpointerdown={close} role="presentation">
    <div class="card" onpointerdown={(e) => e.stopPropagation()} onkeydown={key} role="dialog" tabindex="-1" aria-label={strat ? 'New strategy from text' : 'New indicator from text'}>
      <header><h2>{strat ? 'New strategy from text' : 'New indicator from text'}</h2><button class="x" onclick={close} aria-label="Close">×</button></header>
      <section>
        <p class="dim">{strat
          ? 'Describe the strategy in your own words: entries, exits, filters, which indicators. The AI writes the Pine strategy, it is checked with a test backtest, saved and put on the chart with the Strategy Tester.'
          : 'Describe the indicator in your own words. The AI writes the Pine code, it is saved as a normal indicator and added to the chart.'}</p>
        {#if strat}<div class="ff"><AiStrategyFields bind:qtyType bind:qty bind:sl bind:tp bind:direction /></div>{/if}
        <textarea bind:this={ta} bind:value={text} rows={strat ? 5 : 4} spellcheck="false"
          placeholder={strat
            ? 'e.g. Buy when the EMA 20 crosses above the EMA 50 and RSI is above 50. Sell when the EMA 20 crosses back below. Only trade when ADX is above 20.'
            : 'e.g. RSI of the volume-weighted close, with a signal line (EMA 9) and highlighted zones above 70 and below 30'}></textarea>
        {#if busy}<p class="dim">{strat ? 'Writing and test-running the strategy, this can take up to a minute…' : 'Writing and checking the code…'}</p>{/if}
        {#if error}<p class="err">{error}</p>{/if}
        {#if warn}<p class="warn">Check: {warn}</p>{/if}
        {#if code}<pre>{code}</pre>{/if}
      </section>
      <footer>
        <button onclick={generate} disabled={!canGenerate}>{busy ? 'Generating…' : code ? 'Regenerate' : 'Generate'}{#if !code} <kbd>Ctrl+Enter</kbd>{/if}</button>
        {#if code}<button class="primary" onclick={add}>{strat ? 'Add to chart & test' : 'Add to chart'} <kbd>Ctrl+Enter</kbd></button>{/if}
      </footer>
    </div>
  </div>
{/if}

<style>
  .ff { margin-bottom: 12px; }
  .scrim { position: fixed; inset: 0; z-index: 95; display: grid; place-items: center; background: rgba(0, 0, 0, 0.7); }
  .card { width: min(680px, calc(100vw - 32px)); max-height: 90vh; overflow: auto; background: var(--glass); border: 1px solid var(--glass-line); box-shadow: 0 0 0 1px rgba(168, 85, 247, 0.22), 0 30px 90px rgba(0, 0, 0, 0.7); }
  header { display: flex; align-items: center; gap: 16px; padding: 14px 18px; border-bottom: 1px solid var(--line); }
  h2 { margin: 0; font-size: 16px; flex: 1; }
  .x { background: none; border: 0; color: var(--dim); font-size: 22px; cursor: pointer; } .x:hover { color: var(--fg); }
  section { padding: 12px 18px; }
  textarea { width: 100%; box-sizing: border-box; resize: vertical; padding: 10px 12px; background: #000; border: 1px solid var(--line); color: var(--fg); font: 13px/1.5 system-ui, sans-serif; outline: none; }
  textarea:focus { border-color: var(--accent); }
  .warn { color: var(--accent); font-size: 12.5px; }
  .dim { color: var(--dim); font-size: 12.5px; margin: 0 0 10px; } .err { color: var(--down); font-size: 12.5px; }
  pre { margin: 12px 0 0; padding: 12px 14px; font: 12px/1.55 ui-monospace, monospace; color: var(--fg); background: #000; border: 1px solid var(--line); overflow: auto; max-height: 34vh; white-space: pre; }
  footer { display: flex; justify-content: flex-end; gap: 10px; padding: 12px 18px; border-top: 1px solid var(--line); }
  footer button { font: 600 13px system-ui, sans-serif; padding: 8px 16px; border: 1px solid var(--glass-line); background: none; color: var(--fg); cursor: pointer; }
  footer button:hover:not(:disabled) { border-color: var(--accent); } footer button:disabled { opacity: 0.5; cursor: default; }
  footer .primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  kbd { font: 10px ui-monospace, monospace; opacity: 0.7; margin-left: 6px; }
</style>
