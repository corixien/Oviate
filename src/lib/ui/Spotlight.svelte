<script lang="ts">
  import { tick } from 'svelte';
  import { app } from '$lib/app.svelte';
  import { searchSymbols, type SymbolHit } from '$lib/api';
  import { t } from '$lib/i18n';
  import { buildCommands, commandText } from '$lib/commands.svelte';

  interface Item { key: string; title: string; sub?: string; tag: string; run: () => void }

  let q = $state('');
  let sel = $state(0);
  let hits = $state<SymbolHit[]>([]);
  let input = $state<HTMLInputElement>();
  let closing = $state(false);

  const close = () => { if (closing) return; input?.blur(); closing = true; setTimeout(() => { app.spotlight = { open: false, seed: '' }; closing = false; q = ''; }, 0); };
  const setSymbol = (s: string) => { app.chart.symbol = s; app.persist(); close(); };

  const commands = $derived<Item[]>(buildCommands().map((c) => ({ ...c, key: commandText(c) })));

  const isCmd = $derived(q.startsWith('/'));
  const items = $derived.by<Item[]>(() => {
    if (isCmd) {
      const words = q.slice(1).toLowerCase().split(/\s+/).filter(Boolean);
      const lead = q.slice(1).trim().toLowerCase();
      // commands that start with what was typed come first (/ind add ai -> the AI dialog), list order otherwise
      return commands.filter((c) => words.every((w) => c.key.toLowerCase().includes(w))).map((c, i) => ({ c, r: (c.key.toLowerCase().startsWith(lead) ? 0 : 1) * 1000 + i })).sort((a, b) => a.r - b.r).map((x) => x.c).slice(0, 40);
    }
    const local = app.list.symbols.filter((s) => q && s.toLowerCase().includes(q.toLowerCase())).map((s) => ({ key: s, title: s, sub: 'Watchlist', tag: 'symbol', run: () => setSymbol(s) }));
    const remote = hits.filter((h) => !local.some((l) => l.key === h.symbol)).map((h) => ({ key: h.symbol, title: h.symbol, sub: `${h.name}${h.exchange ? ' · ' + h.exchange : ''}`, tag: h.kind.toLowerCase() || 'symbol', run: () => setSymbol(h.symbol) }));
    return [...local, ...remote];
  });

  let timer: ReturnType<typeof setTimeout>;
  $effect(() => {
    const v = q;
    sel = 0;
    clearTimeout(timer);
    if (v.startsWith('/') || !v.trim()) { hits = []; return; }
    timer = setTimeout(async () => {
      try { const r = await searchSymbols(v.trim()); if (v === q) hits = r; } catch { hits = []; }
    }, 140);
  });

  $effect(() => {
    if (app.spotlight.open) { q = app.spotlight.seed; tick().then(() => input?.focus()); }
  });

  function run(it?: Item) {
    if (!it) { if (!isCmd && q.trim()) setSymbol(q.trim().toUpperCase()); return; }
    it.run();
    if (it.tag !== 'symbol') { app.persist(); close(); }
  }

  function key(e: KeyboardEvent) {
    if (closing) { e.preventDefault(); return; }
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, items.length - 1); scroll(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); scroll(); }
    else if (e.key === 'Enter') { e.preventDefault(); run(items[sel]); }
    else if (e.key === 'Tab' && isCmd && items[sel]) { e.preventDefault(); q = '/' + items[sel].key; }
  }
  const scroll = () => tick().then(() => document.querySelector('.sp-item.sel')?.scrollIntoView({ block: 'nearest' }));
</script>

{#if app.spotlight.open}
  <div class="scrim" class:out={closing} class:noanim={!app.anim} onpointerdown={close} role="presentation">
    <div class="panel" class:out={closing} onpointerdown={(e) => e.stopPropagation()} role="dialog" aria-label="Command bar">
      <div class="field">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input data-nohist bind:this={input} bind:value={q} onkeydown={key} placeholder={app.mobile ? 'Symbol or /command' : t('search', app.lang)} spellcheck="false" autocomplete="off" />
        <kbd>esc</kbd>
      </div>
      {#if items.length}
        <div class="list">
          <div class="cap">{isCmd ? t('commands', app.lang) : t('symbols', app.lang)}</div>
          {#each items as it, i (it.key + i)}
            <button class="sp-item" class:sel={i === sel} onpointermove={() => (sel = i)} onclick={() => run(it)}>
              <span class="tag">{it.tag}</span>
              <span class="ti">{it.title}</span>
              {#if it.sub}<span class="sub">{it.sub}</span>{/if}
              {#if i === sel}<kbd>↵</kbd>{/if}
            </button>
          {/each}
        </div>
      {:else if q}
        <div class="empty">{isCmd ? 'No command' : '…'}</div>
      {:else}
        <div class="hint"><span><kbd>/</kbd> commands</span><span>type to search tickers & companies</span><span><kbd>↑</kbd><kbd>↓</kbd> navigate</span></div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .scrim { position: fixed; inset: 0; z-index: 100; display: flex; justify-content: center; align-items: flex-start; padding-top: 14vh;
    background: rgba(0, 0, 0, 0.55); }
  .panel { width: min(680px, calc(100vw - 32px)); max-height: 62vh; display: flex; flex-direction: column; border-radius: 2px; overflow: hidden;
    background: var(--glass); border: 1px solid var(--glass-line); 
    box-shadow: 0 0 0 1px rgba(168, 85, 247, 0.22), 0 30px 90px rgba(0, 0, 0, 0.7); }
  .field { display: flex; align-items: center; gap: 12px; padding: 18px 20px; border-bottom: 1px solid var(--glass-line); color: var(--dim); }
  .field:focus-within { color: var(--accent); }
  input { flex: 1; background: none; border: 0; outline: 0; color: var(--fg); font: 500 19px system-ui, sans-serif; min-width: 0; }
  input::placeholder { color: var(--dim); }
  kbd { font: 11px ui-monospace, monospace; padding: 2px 7px; border-radius: 2px; border: 1px solid var(--glass-line); color: var(--dim); background: rgba(255, 255, 255, 0.04); }
  .list { overflow-y: auto; padding: 8px; }
  .cap { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--dim); padding: 8px 12px 6px; }
  .sp-item { display: flex; align-items: center; gap: 12px; width: 100%; text-align: left; padding: 10px 12px; border: 0; border-radius: 2px; background: none; color: var(--fg); cursor: pointer; font: 14px system-ui, sans-serif; transition: background 0.12s; }
  .sp-item.sel { background: var(--accent); color: #fff; }
  .sp-item.sel .tag, .sp-item.sel .sub { color: rgba(255, 255, 255, 0.8); border-color: rgba(255, 255, 255, 0.35); }
  .tag { font: 10.5px ui-monospace, monospace; text-transform: uppercase; color: var(--accent); border: 1px solid var(--glass-line); border-radius: 2px; padding: 2px 6px; min-width: 52px; text-align: center; }
  .ti { font-weight: 600; }
  .sub { color: var(--dim); font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
  .sp-item kbd { margin-left: auto; }
  .empty, .hint { padding: 18px 22px; color: var(--dim); font-size: 13px; display: flex; gap: 22px; flex-wrap: wrap; }
  .hint kbd { margin-right: 4px; }
  /* phone: below the status bar, centred, and inside the part of the screen the keyboard leaves free */
  @media (max-width: 719px), (max-height: 479px) {
    .scrim { padding: calc(env(safe-area-inset-top) + 14dvh) 12px 8px; box-sizing: border-box; }
    .panel { width: 100%; max-height: calc(100dvh - 14dvh - env(safe-area-inset-top) - 16px); }
    .field { padding: 14px 16px; }
    .sp-item { padding: 12px; }
  }
</style>
