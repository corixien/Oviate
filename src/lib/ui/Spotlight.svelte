<script lang="ts">
  import { tick } from 'svelte';
  import { app, newChart } from '$lib/app.svelte';
  import { searchSymbols, TIMEFRAMES, type SymbolHit } from '$lib/api';
  import { CHART_TYPES } from '$lib/chart/transforms';
  import { library } from '$lib/library.svelte';
  import { paper } from '$lib/paper/paper.svelte';
  import { DRAW_TOOLS } from '$lib/chart/renderer';
  import { t } from '$lib/i18n';

  interface Item { key: string; title: string; sub?: string; tag: string; run: () => void }

  let q = $state('');
  let sel = $state(0);
  let hits = $state<SymbolHit[]>([]);
  let input = $state<HTMLInputElement>();
  let closing = $state(false);

  const close = () => { if (closing) return; input?.blur(); closing = true; setTimeout(() => { app.spotlight = { open: false, seed: '' }; closing = false; q = ''; }, 0); };
  const setSymbol = (s: string) => { app.chart.symbol = s; app.persist(); close(); };

  const commands = $derived<Item[]>([
    { key: 'ind indicator indicators editor code pine files', title: 'Indicator code editor', sub: 'Open your indicators (search, edit, save)', tag: 'indicator', run: () => { app.openEditor('indicators'); } },
    { key: 'visual builder strategy conditions indicators no code build', title: 'Visual strategy builder', sub: 'Build a strategy from indicator conditions, no code', tag: 'strategy', run: () => { app.openBuilder(null); } },
    { key: 'strat strategy strategies editor code pine files', title: 'Strategy code editor', sub: 'Open your strategies (search, edit, save)', tag: 'strategy', run: () => { app.openEditor('strategies'); } },
    ...TIMEFRAMES.map((tf) => ({ key: `tf ${tf}`, title: `Timeframe ${tf}`, tag: 'tf', run: () => { app.chart.tf = tf; } })),
    ...CHART_TYPES.map((ct) => ({ key: `type ${ct}`, title: `Chart type: ${ct}`, tag: 'type', run: () => { app.chart.type = ct; } })),
    { key: 'ind add new create pine script editor', title: 'New indicator (Pine editor)', sub: 'Paste Pine code, saved as .pine', tag: 'indicator', run: () => { app.editor = { kind: 'indicators', name: null }; app.page = 'editor'; } },
    { key: 'strat add new create pine strategy editor', title: 'New strategy (Pine editor)', sub: 'Paste Pine code, saved as .pine', tag: 'strategy', run: () => { app.editor = { kind: 'strategies', name: null }; app.page = 'editor'; } },
    ...library.indicators.map((f) => ({ key: `ind add ${f.name} ${f.title}`, title: `Add ${f.title}`, sub: f.name, tag: 'indicator',
      run: () => { app.chart.indicators = [...app.chart.indicators, { uid: crypto.randomUUID(), id: f.name, params: {} }]; } })),
    { key: 'ind add ai text describe generate plain words new', title: 'New indicator from text (AI)', sub: 'Describe it in words, the AI writes the Pine code', tag: 'indicator', run: () => { app.aiDialog = 'indicators'; } },
    ...library.strategies.map((f) => ({ key: `strat add ${f.name} ${f.title}`, title: `Add strategy: ${f.title}`, sub: f.name, tag: 'strategy',
      run: () => { app.addStrategy(f.name); paper.panelOpen = true; paper.panelTab = 'tester'; paper.persist(); } })),
    { key: 'strat add ai text describe generate plain words new', title: 'New strategy from text (AI)', sub: 'Describe it in words, the AI writes the Pine strategy', tag: 'strategy', run: () => { app.aiDialog = 'strategies'; } },
    { key: 'strat remove delete strategy', title: 'Remove strategy from chart', tag: 'strategy', run: () => { app.chart.indicators = app.chart.indicators.filter((i) => !i.strategy); } },
    { key: 'paper new account create', title: 'New paper account', tag: 'paper', run: () => { paper.accountDialog = true; } },
    { key: 'paper panel toggle trading', title: 'Toggle paper trading panel', tag: 'paper', run: () => { paper.panelOpen = !paper.panelOpen; paper.persist(); } },
    { key: `buy ${app.chart.symbol} paper order`, title: `Buy ${app.chart.symbol}`, tag: 'paper', run: () => { paper.orderDialog = { open: true, side: 'buy', symbol: app.chart.symbol }; } },
    { key: `sell ${app.chart.symbol} paper order`, title: `Sell ${app.chart.symbol}`, tag: 'paper', run: () => { paper.orderDialog = { open: true, side: 'sell', symbol: app.chart.symbol }; } },
    { key: 'optimizer optimize strategy parameters tune', title: 'Open Strategy Optimizer', sub: 'Find the best parameters of the chart strategy', tag: 'paper', run: () => { paper.panelTab = 'optimizer'; paper.panelOpen = true; paper.persist(); } },
    { key: 'paper tester strategy panel', title: 'Open Strategy Tester', tag: 'paper', run: () => { paper.panelTab = 'tester'; paper.panelOpen = true; paper.persist(); } },
    ...paper.accounts.map((a) => ({ key: `paper account ${a.name}`, title: `Paper account: ${a.name}`, tag: 'paper', run: () => { paper.activeId = a.id; paper.panelTab = 'paper'; paper.panelOpen = true; paper.persist(); } })),
    { key: 'ind clear remove all indicators', title: 'Remove all indicators', tag: 'indicator', run: () => { app.chart.indicators = []; } },
    ...(['1', '2v', '2h', '3', '4'] as const).map((l) => ({ key: `layout ${l}`, title: `Layout: ${l === '1' ? 'single chart' : l === '2v' ? '2 charts side by side' : l === '2h' ? '2 charts stacked' : l + ' charts'}`, tag: 'layout', run: () => { app.setLayout(l); } })),
    ...DRAW_TOOLS.map((d) => ({ key: `draw ${d}`, title: `Draw: ${d === 'cursor' ? 'cursor' : d}`, tag: 'draw', run: () => { app.tool = d; } })),
    { key: 'draw clear delete all drawings', title: 'Delete all drawings', tag: 'draw', run: () => { app.chart.drawings = app.chart.drawings.filter((d) => d.sym !== app.chart.symbol); } },
    ...(['neon', 'mono', 'classic', 'custom'] as const).map((pl) => ({ key: `palette candles colors ${pl}`, title: `Candle colors: ${pl}`, tag: 'ui', run: () => { app.palette = pl; } })),
    { key: 'theme dark', title: 'Theme: dark', tag: 'ui', run: () => { app.theme = 'dark'; } },
    { key: 'theme light', title: 'Theme: light', tag: 'ui', run: () => { app.theme = 'light'; } },
    { key: 'lang en english', title: 'Language: English', tag: 'ui', run: () => { app.lang = 'en'; } },
    { key: 'lang de deutsch', title: 'Sprache: Deutsch', tag: 'ui', run: () => { app.lang = 'de'; } },
    { key: 'settings alpaca keys', title: t('settings', app.lang), sub: 'Alpaca keys, theme, language', tag: 'ui', run: () => { app.settingsOpen = true; } },
    { key: 'chart reset view zoom scale fit', title: 'Reset chart', sub: 'Fit the view like on a fresh timeframe (Alt+R)', tag: 'chart', run: () => { app.resetChart(); } },
    { key: 'replay bar replay mode scissors', title: 'Replay mode', sub: 'Pick a bar and play the market forward from there', tag: 'chart', run: () => { app.replayChart(); } },
    { key: 'log logarithmic scale', title: 'Toggle log scale', tag: 'chart', run: () => { app.chart.log = !app.chart.log; } },
    { key: 'volume toggle add', title: 'Volume indicator: toggle', tag: 'indicator', run: () => { app.chart.volume = !app.chart.volume; app.chart.volumeVisible = true; } },
    { key: 'grid toggle', title: 'Toggle grid', tag: 'chart', run: () => { app.grid = !app.grid; } },
    { key: 'magnet toggle', title: 'Toggle magnet', tag: 'chart', run: () => { app.magnet = !app.magnet; } },
    { key: 'sync crosshair toggle', title: 'Toggle crosshair sync', tag: 'chart', run: () => { app.sync = !app.sync; } },
    { key: 'zoom in app interface bigger', title: 'App zoom in (Ctrl +)', tag: 'ui', run: () => { app.zoomBy(1); } },
    { key: 'zoom out app interface smaller', title: 'App zoom out (Ctrl -)', tag: 'ui', run: () => { app.zoomBy(-1); } },
    { key: 'zoom reset app interface 100', title: 'App zoom reset (Ctrl 0)', tag: 'ui', run: () => { app.setZoom(1); } },
    { key: 'anim animations toggle', title: 'Toggle animations', tag: 'ui', run: () => { app.anim = !app.anim; } },
    { key: 'watch add watchlist', title: `Add ${app.chart.symbol} to watchlist`, tag: 'watch', run: () => { if (!app.list.symbols.includes(app.chart.symbol)) app.list.symbols = [...app.list.symbols, app.chart.symbol]; } },
    { key: 'watch toggle watchlist panel', title: 'Toggle watchlist panel', tag: 'watch', run: () => { app.showWatchlist = !app.showWatchlist; } },
    { key: 'news open page headlines', title: 'Open news', sub: 'All markets, last weeks', tag: 'news', run: () => { app.openNews(null, null); } },
    { key: `news symbol ${app.chart.symbol}`, title: `News for ${app.chart.symbol}`, tag: 'news', run: () => { app.openNews(app.chart.symbol, null); } },
    { key: 'calendar economic events macro open page', title: 'Economic calendar', sub: 'Upcoming and past macro events', tag: 'calendar', run: () => { app.page = 'calendar'; } },
    { key: 'news markers toggle chart', title: 'Toggle news markers on charts', tag: 'news', run: () => { app.showNews = !app.showNews; } },
    { key: 'charts back close news', title: 'Back to charts', tag: 'news', run: () => { app.page = 'chart'; } },
    { key: 'reset chart view', title: 'Reset chart', tag: 'chart', run: () => { const c = newChart(app.chart.symbol, app.chart.tf); Object.assign(app.chart, { indicators: [], drawings: [], type: 'candles', log: false, volume: true, id: c.id }); } }
  ]);

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
        <input bind:this={input} bind:value={q} onkeydown={key} placeholder={t('search', app.lang)} spellcheck="false" autocomplete="off" />
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
</style>
