<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from '$lib/app.svelte';
  import { getCandles } from '$lib/api';
  import { fmtPrice } from '$lib/chart/renderer';
  import { t } from '$lib/i18n';

  let quotes = $state<Record<string, { last: number; chg: number }>>({});

  async function refresh() {
    const to = Math.floor(Date.now() / 1000) + 86400, from = to - 12 * 86400;
    await Promise.all(app.watchlist.map(async (s) => {
      try {
        const c = await getCandles(s, '1d', from, to);
        if (c.n >= 2) quotes[s] = { last: c.c[c.n - 1], chg: ((c.c[c.n - 1] - c.c[c.n - 2]) / c.c[c.n - 2]) * 100 };
      } catch { /* ignore single failures */ }
    }));
  }
  onMount(() => { refresh(); const iv = setInterval(refresh, 30000); return () => clearInterval(iv); });
  let known = '';
  $effect(() => { const k = app.watchlist.join(','); if (k !== known) { known = k; refresh(); } });

  const remove = (s: string) => { app.watchlist = app.watchlist.filter((x) => x !== s); app.persist(); };
</script>

<aside>
  <div class="hd"><span>{t('watchlist', app.lang)}</span>
    <button title={t('add', app.lang)} onclick={() => (app.spotlight = { open: true, seed: '' })}>+</button></div>
  <div class="rows">
    {#each app.watchlist as s (s)}
      {@const q = quotes[s]}
      <div class="row" class:cur={app.chart.symbol === s} role="button" tabindex="0" onclick={() => (app.chart.symbol = s)} onkeydown={(e) => e.key === 'Enter' && (app.chart.symbol = s)}>
        <b>{s}</b>
        <span class="px">{q ? fmtPrice(q.last) : '—'}</span>
        <span class="ch" class:up={q && q.chg >= 0} class:dn={q && q.chg < 0}>{q ? (q.chg >= 0 ? '+' : '') + q.chg.toFixed(2) + '%' : ''}</span>
        <button class="rm" title="Remove" onclick={(e) => { e.stopPropagation(); remove(s); }}>×</button>
      </div>
    {/each}
  </div>
</aside>

<style>
  aside { width: 270px; flex: none; display: flex; flex-direction: column; margin: 12px 12px 12px 2px; border: 1px solid var(--line); background: var(--bar); }
  .hd { display: flex; justify-content: space-between; align-items: center; height: 40px; padding: 0 14px; font: 700 12px system-ui, sans-serif; letter-spacing: 0.08em; text-transform: uppercase; color: var(--dim); border-bottom: 1px solid var(--line); }
  .hd button { background: none; border: 1px solid var(--line); color: var(--fg); width: 24px; height: 24px; border-radius: 2px; cursor: pointer; font-size: 16px; line-height: 1; }
  .hd button:hover { border-color: var(--accent); color: var(--accent); }
  .rows { overflow-y: auto; flex: 1; }
  .row { display: grid; grid-template-columns: 1fr auto auto 18px; gap: 10px; align-items: center; padding: 9px 14px; cursor: pointer; font: 13px ui-monospace, monospace; border-left: 2px solid transparent; }
  .row:hover { background: var(--hover); }
  .row.cur { background: var(--accent-soft); border-left-color: var(--accent); }
  b { font: 600 13px system-ui, sans-serif; }
  .px { color: var(--fg); } .ch { min-width: 62px; text-align: right; color: var(--dim); }
  .up { color: var(--up); } .dn { color: var(--down); }
  .rm { background: none; border: 0; color: var(--dim); cursor: pointer; opacity: 0; font-size: 15px; padding: 0; }
  .row:hover .rm { opacity: 1; } .rm:hover { color: var(--down); }
</style>
