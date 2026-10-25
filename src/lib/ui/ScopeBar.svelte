<script lang="ts">
  import type { Snippet } from 'svelte';
  import { app } from '$lib/app.svelte';
  import { TIMEFRAMES } from '$lib/api';
  import { YEAR_CHOICES, COUNT_CHOICES, MAX_SYMBOLS } from '$lib/universe.ts';
  import Select from './Select.svelte';

  /** Settings bar of the Strategy Tester / Optimizer: how old the data is, how many securities, which timeframe ("Chart" = what the chart has). */
  let { which, children }: { which: 'tester' | 'optimizer'; children?: Snippet } = $props();
  const sc = $derived(app.scope[which]);
  const years = [{ value: '0', label: 'Chart' }, ...YEAR_CHOICES.map((y) => ({ value: String(y), label: y === 1 ? '1 year' : y + ' years' }))];
  const counts = [{ value: '0', label: 'Chart' }, ...COUNT_CHOICES.map((n) => ({ value: String(n), label: n === MAX_SYMBOLS ? n + ' (max)' : String(n) }))];
  const tfs = [{ value: 'chart', label: 'Chart' }, ...TIMEFRAMES.map((t) => ({ value: t, label: t.toUpperCase() }))];
  const set = (k: 'years' | 'count' | 'tf', v: string) => { app.scope[which] = { ...app.scope[which], [k]: k === 'tf' ? v : Number(v) }; app.persist(); };
</script>

<div class="scope">
  <label><span>Data age</span><Select value={String(sc.years)} options={years} onchange={(v) => set('years', v)} width="110px" /></label>
  <label><span>Securities</span><Select value={String(sc.count)} options={counts} onchange={(v) => set('count', v)} width="110px" /></label>
  <label><span>Timeframe</span><Select value={sc.tf} options={tfs} onchange={(v) => set('tf', v)} width="90px" /></label>
  {@render children?.()}
</div>

<style>
  .scope { flex: none; display: flex; align-items: center; gap: 14px; flex-wrap: wrap; padding: 8px 14px; border-bottom: 1px solid var(--line); font-size: 12px; }
  label { display: inline-flex; align-items: center; gap: 8px; } label > span { color: var(--dim); }
</style>
