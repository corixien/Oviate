<script lang="ts">
  import type { StrategyOpts } from '$lib/ai/pine.ts';
  import Select from './Select.svelte';

  /** Strategy form shared by the "new strategy" dialog and the editor's AI edit: size is required, stop loss / take profit optional. */
  let { qtyType = $bindable(), qty = $bindable(), sl = $bindable(), tp = $bindable(), direction = $bindable(), part, commit, noSl = false, noTp = false, dirHint = '' }: {
    qtyType: StrategyOpts['qtyType']; qty: string; sl: string; tp: string; direction: StrategyOpts['direction'];
    /** show only the settings that need no AI ('params') or only the direction; default all */
    part?: 'params' | 'direction';
    /** called when a value is committed (blur / Enter / selection) */
    commit?: () => void;
    /** the code has no stop loss / take profit input to change */
    noSl?: boolean; noTp?: boolean;
    dirHint?: string;
  } = $props();

  const n = $derived(parseFloat(qty.replace(',', '.')));
  const ok = $derived(n > 0 && (qtyType !== 'percent_of_equity' || n <= 100));
</script>

<div class="form">
  {#if part !== 'direction'}
  <div class="f">
    <span>Position size per entry <b>required</b></span>
    <div class="inline">
      <Select value={qtyType} options={[{ value: 'percent_of_equity', label: '% of account' }, { value: 'cash', label: 'Cash amount ($)' }, { value: 'fixed', label: 'Amount (units)' }]} onchange={(v) => { qtyType = v as StrategyOpts['qtyType']; commit?.(); }} width="150px" />
      <input class="num" class:bad={!ok} bind:value={qty} onchange={commit} inputmode="decimal" aria-label="Position size" />
    </div>
  </div>
  <div class="f"><span>Stop loss % <i>optional</i></span><input class="num" bind:value={sl} onchange={commit} disabled={noSl} title={noSl ? 'The code has no stop loss input: add one with AI' : ''} inputmode="decimal" placeholder="none" aria-label="Stop loss percent" /></div>
  <div class="f"><span>Take profit % <i>optional</i></span><input class="num" bind:value={tp} onchange={commit} disabled={noTp} title={noTp ? 'The code has no take profit input: add one with AI' : ''} inputmode="decimal" placeholder="none" aria-label="Take profit percent" /></div>
  {/if}
  {#if part !== 'params'}
  <div class="f" title={dirHint}><span>Direction</span>
    <Select value={direction} options={[{ value: 'auto', label: 'As described' }, { value: 'long', label: 'Long only' }, { value: 'short', label: 'Short only' }, { value: 'both', label: 'Long and short' }]} onchange={(v) => { direction = v as StrategyOpts['direction']; commit?.(); }} width="150px" /></div>
  {/if}
</div>

<style>
  .form { display: flex; flex-wrap: wrap; gap: 10px 18px; }
  .f { display: flex; flex-direction: column; gap: 4px; font-size: 11.5px; color: var(--dim); }
  .f b { color: var(--accent); font-weight: 700; margin-left: 4px; text-transform: uppercase; font-size: 9.5px; letter-spacing: 0.06em; }
  .f i { font-style: normal; opacity: 0.7; margin-left: 4px; }
  .inline { display: flex; gap: 6px; }
  .num { width: 96px; padding: 7px 9px; background: #000; border: 1px solid var(--line); color: var(--fg); font: 12.5px ui-monospace, monospace; outline: none; box-sizing: border-box; }
  .num:focus { border-color: var(--accent); } .num.bad { border-color: var(--down); } .num:disabled { opacity: 0.4; }
</style>
