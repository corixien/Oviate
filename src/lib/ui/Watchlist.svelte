<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from '$lib/app.svelte';
  import { getCandles } from '$lib/api';
  import { fmtPrice } from '$lib/chart/renderer';
  import { t } from '$lib/i18n';

  let quotes = $state<Record<string, { last: number; chg: number }>>({});

  async function refresh() {
    const to = Math.floor(Date.now() / 1000) + 86400, from = to - 12 * 86400;
    await Promise.all(app.list.symbols.map(async (s) => {
      try {
        const c = await getCandles(s, '1d', from, to);
        if (c.n >= 2) quotes[s] = { last: c.c[c.n - 1], chg: ((c.c[c.n - 1] - c.c[c.n - 2]) / c.c[c.n - 2]) * 100 };
      } catch { /* ignore single failures */ }
    }));
  }
  onMount(() => { refresh(); const iv = setInterval(refresh, 30000); return () => clearInterval(iv); });
  let known = '';
  $effect(() => { const k = app.list.symbols.join(','); if (k !== known) { known = k; refresh(); } });

  const remove = (s: string) => { app.list.symbols = app.list.symbols.filter((x) => x !== s); app.persist(); };
  let menu = $state(false), naming = $state<'' | 'new' | 'rename'>(''), nameVal = $state('');
  function startNaming(mode: 'new' | 'rename') { naming = mode; nameVal = mode === 'rename' ? app.list.name : ''; menu = false; }
  function commitName() {
    const nm = nameVal.trim();
    if (nm && naming === 'new') { const id = crypto.randomUUID(); app.watchlists = [...app.watchlists, { id, name: nm, symbols: [] }]; app.activeList = id; }
    else if (nm && naming === 'rename') app.list.name = nm;
    naming = ''; app.persist();
  }
  function deleteList() {
    if (app.watchlists.length < 2) return;
    app.watchlists = app.watchlists.filter((w) => w.id !== app.activeList);
    app.activeList = app.watchlists[0].id; menu = false; app.persist();
  }
</script>

<aside>
  <div class="hd">
    {#if naming}
      <input class="nm" bind:value={nameVal} placeholder="List name" onkeydown={(e) => { if (e.key === 'Enter') commitName(); else if (e.key === 'Escape') naming = ''; }} onblur={commitName} />
    {:else}
      <button class="ln" onclick={() => (menu = !menu)} title="Switch watchlist">{app.list.name} <span class="caret">⌄</span></button>
    {/if}
    <button title={t('add', app.lang)} onclick={() => (app.spotlight = { open: true, seed: '' })}>+</button>
    {#if menu}
      <div class="lmenu" role="menu">
        {#each app.watchlists as w (w.id)}
          <button class:on={w.id === app.activeList} onclick={() => { app.activeList = w.id; menu = false; app.persist(); }}>{w.name}<span>{w.symbols.length}</span></button>
        {/each}
        <i></i>
        <button onclick={() => startNaming('new')}>New list</button>
        <button onclick={() => startNaming('rename')}>Rename</button>
        <button class="del" disabled={app.watchlists.length < 2} onclick={deleteList}>Delete list</button>
      </div>
    {/if}
  </div>
  <div class="rows">
    {#each app.list.symbols as s (s)}
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
  aside { min-height: 0; min-width: 0; display: flex; flex-direction: column; border: 1px solid var(--line); background: var(--bar); }
  .hd { position: relative; display: flex; justify-content: space-between; align-items: center; height: 40px; padding: 0 14px; font: 700 12px system-ui, sans-serif; letter-spacing: 0.08em; text-transform: uppercase; color: var(--dim); border-bottom: 1px solid var(--line); }
  .hd button { background: none; border: 1px solid var(--line); color: var(--fg); width: 24px; height: 24px; border-radius: 2px; cursor: pointer; font-size: 16px; line-height: 1; }
  .hd button:hover { border-color: var(--accent); color: var(--accent); }
  .hd .ln { width: auto; height: auto; border: 0; padding: 0; color: var(--fg); font: 700 12px system-ui, sans-serif; letter-spacing: 0.08em; text-transform: uppercase; display: inline-flex; gap: 6px; align-items: center; }
  .hd .ln:hover { color: var(--accent); border: 0; }
  .nm { background: #000; border: 1px solid var(--accent); color: var(--fg); padding: 4px 8px; font: 13px system-ui, sans-serif; outline: none; width: 150px; }
  .lmenu { position: absolute; top: 41px; left: 0; right: 0; z-index: 20; display: flex; flex-direction: column; background: var(--glass); border: 1px solid var(--accent); }
  .lmenu button { width: auto; height: auto; border: 0; border-radius: 0; text-align: left; display: flex; justify-content: space-between; padding: 9px 14px; font: 600 12px system-ui, sans-serif; letter-spacing: 0; text-transform: none; color: var(--fg); }
  .lmenu button:hover { background: var(--hover); border: 0; color: var(--fg); }
  .lmenu button.on { color: var(--accent); } .lmenu button span { color: var(--dim); } .lmenu .del { color: var(--down); } .lmenu .del:disabled { opacity: 0.4; }
  .lmenu i { height: 1px; background: var(--line); }
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
